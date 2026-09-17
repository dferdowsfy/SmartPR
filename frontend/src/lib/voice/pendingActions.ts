/**
 * SmartPR Voice Phase 3: server-side pending actions.
 *
 * The model must never "remember" that a confirmation is pending. Every
 * confirmation-requiring write is stored here with a frozen payload; the
 * model only ever sees an opaque pendingActionId. Confirmation executes the
 * exact server-stored proposal — Grok cannot modify the payload.
 *
 * Safety properties:
 * - confirmation is bound to the same voice session AND the same user
 * - pending actions expire (default 15 minutes)
 * - confirm is atomic: UPDATE ... WHERE status='pending' — a second confirm
 *   of the same id can never execute twice
 * - already-executed confirms return the original result (idempotent)
 * - re-authorization happens at confirm time (business still accessible,
 *   entitlement still valid)
 */

import { randomUUID } from "crypto";
import {
  requireBusinessAccess,
  VoiceAuthError,
  type Db,
  type VoiceContext,
} from "./context";
import { logVoiceAudit } from "./audit";

export type PendingActionStatus =
  | "pending"
  | "confirmed"
  | "executed"
  | "expired"
  | "cancelled"
  | "failed";

export type PendingActionType =
  | "create_draft_project"
  | "update_project_fact"
  | "add_note";

export interface PendingActionRow {
  id: string;
  voice_session_id: string;
  user_id: string;
  workspace_id: string;
  business_id: string | null;
  matter_id: string | null;
  action_type: PendingActionType;
  payload_json: Record<string, unknown>;
  confirmation_summary: string;
  status: PendingActionStatus;
  created_at: string;
  expires_at: string;
  confirmed_at: string | null;
  executed_at: string | null;
}

export const PENDING_ACTION_TTL_MINUTES = 15;

function toRow(r: Record<string, unknown>): PendingActionRow {
  return {
    id: String(r.id),
    voice_session_id: String(r.voice_session_id),
    user_id: String(r.user_id),
    workspace_id: String(r.workspace_id),
    business_id: r.business_id ? String(r.business_id) : null,
    matter_id: r.matter_id ? String(r.matter_id) : null,
    action_type: r.action_type as PendingActionType,
    payload_json: (r.payload_json as Record<string, unknown>) ?? {},
    confirmation_summary: String(r.confirmation_summary),
    status: r.status as PendingActionStatus,
    created_at: String(r.created_at),
    expires_at: String(r.expires_at),
    confirmed_at: r.confirmed_at ? String(r.confirmed_at) : null,
    executed_at: r.executed_at ? String(r.executed_at) : null,
  };
}

/** Mark stale pending rows expired. Best-effort; never throws. */
async function sweepExpired(db: Db): Promise<void> {
  try {
    await db.query(
      `UPDATE voice_pending_actions SET status = 'expired'
        WHERE status = 'pending' AND expires_at <= now()`
    );
  } catch {
    /* observability must not break the call path */
  }
}

export interface CreatePendingActionOpts {
  voiceSessionId: string;
  ctx: VoiceContext;
  actionType: PendingActionType;
  businessId: string | null;
  matterId?: string | null;
  /** Frozen proposal — executed verbatim on confirmation. */
  payload: Record<string, unknown>;
  /** Deterministic, speakable summary generated from the payload. */
  confirmationSummary: string;
  ttlMinutes?: number;
}

export async function createPendingAction(
  db: Db,
  opts: CreatePendingActionOpts
): Promise<{ pendingActionId: string; confirmationSummary: string; expiresAt: string }> {
  // Re-verify business access at proposal time (the model's selection is
  // never trusted as authorization).
  let businessId: string | null = null;
  if (opts.businessId) {
    businessId = (await requireBusinessAccess(db, opts.ctx, opts.businessId)).id;
  }
  const ttl = Math.max(1, Math.min(60, opts.ttlMinutes ?? PENDING_ACTION_TTL_MINUTES));
  const { rows } = await db.query<Record<string, unknown>>(
    `INSERT INTO voice_pending_actions
       (id, voice_session_id, user_id, workspace_id, business_id, matter_id,
        action_type, payload_json, confirmation_summary, status, idempotency_key, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, 'pending', $10, now() + ($11 || ' minutes')::interval)
     RETURNING id, expires_at`,
    [
      randomUUID(),
      opts.voiceSessionId,
      opts.ctx.userId,
      opts.ctx.workspaceId,
      businessId,
      opts.matterId ?? null,
      opts.actionType,
      JSON.stringify(opts.payload),
      opts.confirmationSummary,
      randomUUID(),
      String(ttl),
    ]
  );
  const row = rows[0];
  await logVoiceAudit(db, {
    userId: opts.ctx.userId,
    action: "pending_action_created",
    details: {
      pending_action_id: String(row.id),
      action_type: opts.actionType,
      business_id: businessId,
    },
  });
  return {
    pendingActionId: String(row.id),
    confirmationSummary: opts.confirmationSummary,
    expiresAt: String(row.expires_at),
  };
}

/** Executor runs the frozen server-stored payload. Never receives model input. */
export type PendingActionExecutor = (
  db: Db,
  ctx: VoiceContext,
  action: PendingActionRow
) => Promise<Record<string, unknown>>;

export interface ConfirmResult {
  /** True when the action executed (or had already executed — idempotent). */
  executed: boolean;
  alreadyExecuted?: boolean;
  result?: Record<string, unknown>;
}

/**
 * Confirm and execute a pending action. Atomic: only one confirm can win.
 * Re-verifies session ownership, user, expiry, business access, and
 * entitlement before executing the frozen payload.
 */
export async function confirmPendingAction(
  db: Db,
  ctx: VoiceContext,
  pendingActionId: string,
  execute: PendingActionExecutor
): Promise<ConfirmResult> {
  await sweepExpired(db);
  if (!pendingActionId || typeof pendingActionId !== "string") {
    throw new VoiceAuthError("bad_request", "A pending action id is required.", 400);
  }

  // Atomic claim: only a pending, unexpired action belonging to THIS session
  // and THIS user can transition to confirmed.
  const claimed = await db.query<Record<string, unknown>>(
    `UPDATE voice_pending_actions
        SET status = 'confirmed', confirmed_at = now()
      WHERE id = $1 AND status = 'pending'
        AND voice_session_id = $2 AND user_id = $3
        AND expires_at > now()
      RETURNING *`,
    [pendingActionId, ctx.sessionId, ctx.userId]
  );
  if (claimed.rows.length > 0) {
    const action = toRow(claimed.rows[0]);
    await logVoiceAudit(db, {
      userId: ctx.userId,
      action: "pending_action_confirmed",
      details: { pending_action_id: action.id, action_type: action.action_type },
    });
    // Re-authorize at execution time: the business must still be accessible.
    if (action.business_id) {
      await requireBusinessAccess(db, ctx, action.business_id);
    }
    try {
      const result = await execute(db, ctx, action);
      await db.query(
        `UPDATE voice_pending_actions SET status = 'executed', executed_at = now()
          WHERE id = $1`,
        [action.id]
      );
      await logVoiceAudit(db, {
        userId: ctx.userId,
        action: "pending_action_executed",
        details: { pending_action_id: action.id, action_type: action.action_type },
      });
      return { executed: true, result };
    } catch (err) {
      await db.query(
        `UPDATE voice_pending_actions SET status = 'failed' WHERE id = $1`,
        [action.id]
      );
      await logVoiceAudit(db, {
        userId: ctx.userId,
        action: "pending_action_failed",
        details: {
          pending_action_id: action.id,
          action_type: action.action_type,
          error: err instanceof VoiceAuthError ? err.code : "internal",
        },
      });
      throw err;
    }
  }

  // The claim failed — figure out why, with safe errors.
  const existing = await db.query<Record<string, unknown>>(
    `SELECT * FROM voice_pending_actions WHERE id = $1 LIMIT 1`,
    [pendingActionId]
  );
  const row = existing.rows[0];
  if (!row) {
    throw new VoiceAuthError("not_found", "That pending action was not found.", 404);
  }
  const found = toRow(row);
  if (found.voice_session_id !== ctx.sessionId || found.user_id !== ctx.userId) {
    // Never reveal another session's pending actions.
    throw new VoiceAuthError(
      "forbidden",
      "That pending action does not belong to this call.",
      403
    );
  }
  if (found.status === "executed" || found.status === "confirmed") {
    // Idempotent: a retry after a network timeout returns success without
    // executing again. The original result is not replayed (it may contain
    // since-changed state); the caller sees a stable confirmation.
    return { executed: true, alreadyExecuted: true };
  }
  if (found.status === "expired" || new Date(found.expires_at).getTime() <= Date.now()) {
    throw new VoiceAuthError(
      "bad_request",
      "That confirmation expired. Please start the request again.",
      400
    );
  }
  if (found.status === "cancelled") {
    throw new VoiceAuthError(
      "bad_request",
      "That pending action was cancelled.",
      400
    );
  }
  throw new VoiceAuthError("bad_request", "That pending action cannot be confirmed.", 400);
}

export async function cancelPendingAction(
  db: Db,
  ctx: VoiceContext,
  pendingActionId: string
): Promise<{ cancelled: boolean }> {
  await sweepExpired(db);
  if (!pendingActionId || typeof pendingActionId !== "string") {
    throw new VoiceAuthError("bad_request", "A pending action id is required.", 400);
  }
  const { rows } = await db.query<Record<string, unknown>>(
    `UPDATE voice_pending_actions SET status = 'cancelled'
      WHERE id = $1 AND status = 'pending'
        AND voice_session_id = $2 AND user_id = $3
      RETURNING id`,
    [pendingActionId, ctx.sessionId, ctx.userId]
  );
  if (rows.length > 0) {
    await logVoiceAudit(db, {
      userId: ctx.userId,
      action: "pending_action_cancelled",
      details: { pending_action_id: pendingActionId },
    });
    return { cancelled: true };
  }
  // Cancelling an unknown/foreign action is a safe no-op outcome, but a
  // foreign session's id must not be distinguishable from unknown.
  const existing = await db.query<Record<string, unknown>>(
    `SELECT voice_session_id, user_id, status FROM voice_pending_actions WHERE id = $1 LIMIT 1`,
    [pendingActionId]
  );
  const found = existing.rows[0];
  if (
    found &&
    String(found.voice_session_id) === ctx.sessionId &&
    String(found.user_id) === ctx.userId
  ) {
    return { cancelled: false }; // already settled — nothing to cancel
  }
  throw new VoiceAuthError("not_found", "That pending action was not found.", 404);
}
