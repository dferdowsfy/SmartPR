/**
 * SmartPR Voice Phase 3: secure action/upload links.
 *
 * Links are:
 * - unguessable (256-bit random token, stored as SHA-256)
 * - expiring (upload: 7 days; action: 24 hours)
 * - scoped (user + workspace + business + purpose)
 * - validated at use time (signed-in user must match; business access
 *   re-checked on redemption)
 * - single-purpose (upload links allow a few uses; action links are one-shot)
 * - auditable (creation + every redemption)
 *
 * The raw token never appears in query parameters beyond the path segment,
 * and never in logs — only the hash is stored.
 */

import { createHash, randomBytes } from "crypto";
import {
  requireBusinessAccess,
  VoiceAuthError,
  type Db,
  type VoiceContext,
} from "./context";
import { logVoiceAudit } from "./audit";
import { sendComplianceEmail } from "../compliance-reminders";
import { getSiteUrl } from "../siteUrl";

export type SecureLinkPurpose = "upload_evidence" | "secure_action";

const UPLOAD_TTL_MINUTES = 7 * 24 * 60;
const ACTION_TTL_MINUTES = 24 * 60;

export function hashLinkToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function newLinkToken(): string {
  return `valt_${randomBytes(32).toString("base64url")}`;
}

export interface CreateSecureLinkOpts {
  ctx: VoiceContext;
  purpose: SecureLinkPurpose;
  businessId: string;
  matterId?: string | null;
  obligationId?: string | null;
  /** For secure_action: which prohibited action this link completes. */
  actionType?: string | null;
  /** Human label naming the action, shown in the email. */
  label: string;
  payload?: Record<string, unknown>;
  ttlMinutes?: number;
  maxUses?: number;
}

export interface SecureLinkResult {
  linkUrl: string;
  expiresAt: string;
  emailed: boolean;
}

export async function createSecureLink(
  db: Db,
  opts: CreateSecureLinkOpts
): Promise<SecureLinkResult> {
  const business = await requireBusinessAccess(db, opts.ctx, opts.businessId);
  const token = newLinkToken();
  const ttl =
    opts.ttlMinutes ??
    (opts.purpose === "upload_evidence" ? UPLOAD_TTL_MINUTES : ACTION_TTL_MINUTES);
  const { rows } = await db.query<{ expires_at: string }>(
    `INSERT INTO voice_action_links
       (token_hash, purpose, user_id, workspace_id, business_id, matter_id,
        obligation_id, action_type, label, payload_json, expires_at, max_uses)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb,
             now() + ($11 || ' minutes')::interval, $12)
     RETURNING expires_at`,
    [
      hashLinkToken(token),
      opts.purpose,
      opts.ctx.userId,
      opts.ctx.workspaceId,
      business.id,
      opts.matterId ?? null,
      opts.obligationId ?? null,
      opts.actionType ?? null,
      opts.label,
      JSON.stringify(opts.payload ?? {}),
      String(ttl),
      opts.maxUses ?? (opts.purpose === "upload_evidence" ? 10 : 1),
    ]
  );
  const expiresAt = String(rows[0].expires_at);
  const linkUrl = `${getSiteUrl()}/api/voice/action/${token}`;

  // Destination is ALWAYS the verified account email — never caller-supplied.
  const recipient = opts.ctx.email;
  let emailed = false;
  if (recipient && recipient.includes("@")) {
    const subject = `Your SmartPR secure link: ${opts.label}`;
    const text =
      `Hello,\n\nHere is your secure SmartPR link for ${business.name}:\n${linkUrl}\n\n` +
      `This link is for: ${opts.label}\n` +
      `It expires on ${expiresAt} and only works for your signed-in SmartPR account.\n\n` +
      `Sent from your SmartPR voice call.`;
    const html =
      `<p>Here is your secure SmartPR link for <strong>${escapeHtml(business.name)}</strong>:</p>` +
      `<p><a href="${escapeHtml(linkUrl)}">${escapeHtml(linkUrl)}</a></p>` +
      `<p>This link is for: <strong>${escapeHtml(opts.label)}</strong><br/>` +
      `It expires on ${escapeHtml(expiresAt)} and only works for your signed-in SmartPR account.</p>` +
      `<p style="color:#666;font-size:12px">Sent from your SmartPR voice call.</p>`;
    emailed = await sendComplianceEmail(recipient, subject, text, html);
  }

  await logVoiceAudit(db, {
    userId: opts.ctx.userId,
    action: "secure_link_generated",
    details: {
      purpose: opts.purpose,
      business_id: business.id,
      label: opts.label,
      action_type: opts.actionType ?? null,
      emailed,
      // The token hash is never logged — only that a link was created.
    },
  });
  return { linkUrl, expiresAt, emailed };
}

export interface RedeemedLink {
  purpose: SecureLinkPurpose;
  userId: string;
  workspaceId: string;
  businessId: string | null;
  matterId: string | null;
  obligationId: string | null;
  actionType: string | null;
  label: string;
  payload: Record<string, unknown>;
}

/**
 * Validate a presented link token. Checks hash, expiry, and use budget.
 * Authorization (signed-in user match + business access) happens in the
 * route, which has the request's auth context.
 */
export async function lookupSecureLink(
  db: Db,
  token: string
): Promise<RedeemedLink | null> {
  if (!token || !token.startsWith("valt_")) return null;
  const { rows } = await db.query<{
    purpose: SecureLinkPurpose;
    user_id: string;
    workspace_id: string;
    business_id: string | null;
    matter_id: string | null;
    obligation_id: string | null;
    action_type: string | null;
    label: string;
    payload_json: Record<string, unknown>;
    expires_at: string;
    max_uses: number;
    uses: number;
  }>(
    `SELECT purpose, user_id, workspace_id, business_id, matter_id,
            obligation_id, action_type, label, payload_json, expires_at,
            max_uses, uses
       FROM voice_action_links WHERE token_hash = $1 LIMIT 1`,
    [hashLinkToken(token)]
  );
  const row = rows[0];
  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) return null;
  if (row.uses >= row.max_uses) return null;
  return {
    purpose: row.purpose,
    userId: row.user_id,
    workspaceId: row.workspace_id,
    businessId: row.business_id,
    matterId: row.matter_id,
    obligationId: row.obligation_id,
    actionType: row.action_type,
    label: row.label,
    payload: (row.payload_json as Record<string, unknown>) ?? {},
  };
}

/** Record one redemption (increments uses; stamps used_at when exhausted). */
export async function recordLinkUse(db: Db, token: string): Promise<void> {
  try {
    await db.query(
      `UPDATE voice_action_links
          SET uses = uses + 1,
              used_at = CASE WHEN uses + 1 >= max_uses THEN now() ELSE used_at END
        WHERE token_hash = $1`,
      [hashLinkToken(token)]
    );
  } catch {
    /* best-effort */
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
