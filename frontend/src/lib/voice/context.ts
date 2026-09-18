/**
 * Voice request context pipeline.
 *
 * Every account-specific voice API request follows this pipeline:
 *
 *   voice session token
 *     -> validate session (not expired, not revoked)
 *     -> derive user (user_id comes from the SESSION, never from the caller)
 *     -> derive workspace membership (existing SmartPR workspace resolution)
 *     -> verify resource access (existing business access logic)
 *     -> check plan entitlement where applicable (existing billing system)
 *     -> perform SmartPR operation
 *     -> audit
 *     -> return safe result
 *
 * Architectural rule: Grok must never provide or choose userId,
 * workspaceId, account role, subscription plan, email recipient, or
 * authorization level. All of these are derived server-side from the
 * validated voice session.
 */

import type { Pool, PoolClient } from "pg";
import { getPool, isEnabled } from "../../app/graph/db";
import { ensureUserWorkspace, userCanAccessBusiness } from "../../app/compliance/server";
import { getWorkspaceRole } from "../admin";
import { entitlementsFor, type WorkspacePlanState } from "../billing/entitlements";
import { getWorkspacePlanState } from "../billing/access";
import { isUserAdmin } from "../admin";
import { extractSessionToken, hashSessionToken, renewedSessionExpiresAt } from "./session";
import { logVoiceAudit } from "./audit";
import { incrementVoiceUsage } from "./usage";

export type Db = Pool | PoolClient;

export class VoiceAuthError extends Error {
  status: number;
  code: string;
  constructor(code: string, message: string, status = 401) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export interface VoiceContext {
  /** Validated session id (voice_sessions.id). */
  sessionId: string;
  /** SmartPR user id, derived from the session. */
  userId: string;
  /** Verified SmartPR email on file (denormalized at phone enrollment). */
  email: string | null;
  /** Workspace id, resolved via the existing workspace bootstrap. */
  workspaceId: string;
  /** Workspace role (OWNER/ADMIN/MEMBER/VIEWER) or null. */
  workspaceRole: string | null;
  /** Billing plan state from the existing subscription system. */
  plan: WorkspacePlanState;
  entitlements: ReturnType<typeof entitlementsFor>;
  /** True when the user is a platform admin (enterprise plan treatment). */
  platformAdmin: boolean;
}

interface SessionRow {
  id: string;
  user_id: string;
  phone_e164: string;
  issued_at: string;
  expires_at: string;
  revoked_at: string | null;
}

function requirePool(): Pool {
  if (!isEnabled()) throw new VoiceAuthError("no_database", "Database is not configured.", 503);
  const pool = getPool();
  if (!pool) throw new VoiceAuthError("no_database", "Database is unavailable.", 503);
  return pool;
}

/**
 * Validate a voice session bearer token and derive the full voice context.
 * Throws VoiceAuthError when the token is missing, unknown, expired, or revoked.
 */
export async function resolveVoiceContext(
  authorizationHeader: string | null | undefined,
  db?: Db
): Promise<VoiceContext> {
  const pool = db ?? requirePool();
  const token = extractSessionToken(authorizationHeader);
  if (!token) {
    throw new VoiceAuthError("missing_token", "A voice session token is required.", 401);
  }
  const { rows } = await pool.query<SessionRow>(
    `SELECT id, user_id, phone_e164, issued_at, expires_at, revoked_at
       FROM voice_sessions WHERE token_hash = $1 LIMIT 1`,
    [hashSessionToken(token)]
  );
  const session = rows[0];
  if (!session) {
    throw new VoiceAuthError("invalid_token", "Voice session is not valid.", 401);
  }
  if (session.revoked_at) {
    await logVoiceAudit(pool, {
      userId: session.user_id,
      phoneE164: session.phone_e164,
      action: "session_expired",
      details: { session_id: session.id, reason: "revoked_token_presented" },
    });
    throw new VoiceAuthError("session_revoked", "Voice session has been revoked.", 401);
  }
  if (new Date(session.expires_at).getTime() <= Date.now()) {
    throw new VoiceAuthError("session_expired", "Voice session has expired.", 401);
  }

  // Sliding renew: extend idle TTL, capped by absolute lifetime from issued_at.
  // Awaited so the extension is durable before the tool proceeds; DB errors
  // are swallowed so a touch failure never fails an otherwise-valid call.
  const renewedExpires = renewedSessionExpiresAt(new Date(session.issued_at));
  try {
    await pool.query(
      `UPDATE voice_sessions
          SET last_used_at = now(), expires_at = $2
        WHERE id = $1`,
      [session.id, renewedExpires.toISOString()]
    );
  } catch {
    // best-effort renew
  }

  const access = (
    await pool.query<{ email: string | null }>(
      `SELECT email FROM voice_access WHERE user_id = $1 LIMIT 1`,
      [session.user_id]
    )
  ).rows[0];

  const workspaceId = await ensureUserWorkspace(pool, {
    id: session.user_id,
    email: access?.email ?? null,
    user_metadata: {},
  });
  const workspaceRole = await getWorkspaceRole(session.user_id, workspaceId);
  const platformAdmin = await isUserAdmin(access?.email ?? undefined);
  const plan: WorkspacePlanState = platformAdmin
    ? { planId: "enterprise", status: "active" }
    : await getWorkspacePlanState(pool, workspaceId);

  return {
    sessionId: session.id,
    userId: session.user_id,
    email: access?.email ?? null,
    workspaceId,
    workspaceRole,
    plan,
    entitlements: entitlementsFor(plan.planId),
    platformAdmin,
  };
}

export interface VoiceBusinessRow {
  id: string;
  public_id: string | null;
  name: string;
  legal_name: string | null;
  business_structure: string | null;
  business_type: string | null;
  industry: string | null;
  municipality: string | null;
  physical_address: string | null;
  archived: boolean;
  created_at: string;
}

/**
 * Verify the caller may access a business, then return its row.
 * Uses the existing business-access rule (owner or workspace member).
 * Throws VoiceAuthError(403/404) when access is denied or missing.
 */
export async function requireBusinessAccess(
  db: Db,
  ctx: VoiceContext,
  businessId: string
): Promise<VoiceBusinessRow> {
  if (!businessId) throw new VoiceAuthError("bad_request", "A business id is required.", 400);
  const allowed = await userCanAccessBusiness(db, ctx.userId, businessId);
  if (!allowed) {
    await logVoiceAudit(db, {
      userId: ctx.userId,
      action: "tool_call",
      details: { tool: "business_access_denied", business_id: businessId },
    });
    throw new VoiceAuthError("forbidden", "You do not have access to that business.", 403);
  }
  const { rows } = await db.query<VoiceBusinessRow>(
    `SELECT id, public_id, name, legal_name, business_structure, business_type,
            industry, municipality, physical_address, archived, created_at::text AS created_at
       FROM businesses WHERE id = $1 LIMIT 1`,
    [businessId]
  );
  const business = rows[0];
  if (!business) throw new VoiceAuthError("not_found", "Business not found.", 404);
  return business;
}

/**
 * List the businesses the caller may access. Same access rule as the
 * signed-in businesses list (owner or workspace member, not archived).
 */
export async function listAccessibleBusinesses(
  db: Db,
  ctx: VoiceContext
): Promise<VoiceBusinessRow[]> {
  const { rows } = await db.query<VoiceBusinessRow>(
    `SELECT b.id, b.public_id, b.name, b.legal_name, b.business_structure, b.business_type,
            b.industry, b.municipality, b.physical_address, b.archived, b.created_at::text AS created_at
       FROM businesses b
       LEFT JOIN workspace_members wm ON wm.workspace_id = b.workspace_id AND wm.user_id = $1
      WHERE (b.user_id = $1 OR wm.user_id IS NOT NULL) AND b.archived = false
      ORDER BY b.created_at DESC`,
    [ctx.userId]
  );
  return rows;
}

/** Audit + usage wrapper for a voice tool call. */
export async function auditedToolCall<T>(
  db: Db,
  ctx: VoiceContext,
  tool: string,
  details: Record<string, unknown>,
  run: () => Promise<T>
): Promise<T> {
  const result = await run();
  await logVoiceAudit(db, {
    userId: ctx.userId,
    action: "tool_call",
    details: { tool, ...details },
  });
  await incrementVoiceUsage(db, ctx.userId, "tool_calls", 1);
  return result;
}

/** JSON error response helper for voice routes. */
export function voiceError(err: unknown): Response {
  if (err instanceof VoiceAuthError) {
    return Response.json({ error: err.code, message: err.message }, { status: err.status });
  }
  console.error("[voice] request failed:", (err as Error)?.message || err);
  return Response.json({ error: "internal_error" }, { status: 500 });
}
