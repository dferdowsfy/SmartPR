/**
 * Voice audit logging. Every voice authentication event and every
 * authenticated voice API call is appended to voice_audit_log. The log is
 * append-only from the application's perspective (no update/delete helpers
 * are exposed here).
 */

export type VoiceAuditAction =
  | "enrollment"
  | "phone_changed"
  | "pin_changed"
  | "pin_reset"
  | "disabled"
  | "re_enabled"
  | "pin_attempt"
  | "pin_success"
  | "pin_failed"
  | "pin_locked"
  | "session_issued"
  | "session_validated"
  | "session_revoked"
  | "session_expired"
  | "tool_call"
  | "email_sent"
  | "lookup"
  // Phase 3
  | "pending_action_created"
  | "pending_action_confirmed"
  | "pending_action_executed"
  | "pending_action_failed"
  | "pending_action_cancelled"
  | "project_created"
  | "fact_changed"
  | "requirements_recalculated"
  | "secure_link_generated"
  | "secure_link_redeemed"
  | "secure_link_denied"
  | "deliverable_generated"
  | "note_added";

interface DbLike {
  query: (text: string, params?: unknown[]) => Promise<unknown>;
}

export async function logVoiceAudit(
  db: DbLike,
  entry: {
    userId?: string | null;
    phoneE164?: string | null;
    action: VoiceAuditAction;
    details?: Record<string, unknown>;
    ip?: string | null;
  }
): Promise<void> {
  try {
    await db.query(
      `INSERT INTO voice_audit_log (user_id, phone_e164, action, details, ip)
       VALUES ($1, $2, $3, $4::jsonb, $5)`,
      [
        entry.userId ?? null,
        entry.phoneE164 ?? null,
        entry.action,
        JSON.stringify(entry.details ?? {}),
        entry.ip ?? null,
      ]
    );
  } catch (err) {
    // Audit must never break the request path; log and continue.
    console.error("[voice-audit] write failed:", (err as Error).message);
  }
}
