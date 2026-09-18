/**
 * Voice auto-recap sweep.
 *
 * Server-side backstop for call recaps: after a voice session ends, the
 * sweep emails an automatic recap of what happened on the call to the
 * verified account email — no agent tool call required, no call-time
 * spent, no extra voice credits.
 *
 * Rules:
 * - Only ENDED sessions are swept: revoked, or past expires_at (the 30m
 *   sliding idle / 120m absolute window). A session that is merely idle
 *   is never swept, so a recap can never fire mid-call.
 * - Only for users whose voice_access.auto_recap_enabled is true
 *   (default true; toggled in Settings > Phone access).
 * - Skipped when: no verified email on file; the session had no account
 *   tool activity (nothing to recap); the agent already sent a manual
 *   recap via email_my_summary during the call.
 * - Each session is processed exactly once: recap_sent_at is set whether
 *   the recap was sent or deliberately skipped. Delivery failures leave
 *   recap_sent_at NULL so the next sweep retries.
 * - The recap content is deterministic — built from the session's actual
 *   successful tool-call history via buildCallActivityRecap. Never an
 *   account dump.
 */

import { buildCallActivityRecap, VOICE_SUMMARY_FROM } from "./tools";
import { sendComplianceEmail } from "../compliance-reminders";
import { logVoiceAudit } from "./audit";
import { incrementVoiceUsage } from "./usage";
import type { Db } from "./context";

export interface AutoRecapSummary {
  sessions_checked: number;
  recaps_sent: number;
  skipped: number;
  failed: number;
}

interface CandidateSession {
  id: string;
  user_id: string;
  phone_e164: string | null;
}

interface VoiceAccessPref {
  auto_recap_enabled: boolean;
  email: string | null;
}

const SWEEP_BATCH_LIMIT = 50;

function esc(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function isVerifiedEmail(email: string | null | undefined): email is string {
  return !!email && email.includes("@");
}

export async function runAutoRecapSweep(db: Db): Promise<AutoRecapSummary> {
  const summary: AutoRecapSummary = {
    sessions_checked: 0,
    recaps_sent: 0,
    skipped: 0,
    failed: 0,
  };

  let candidates: CandidateSession[] = [];
  try {
    const res = await db.query<CandidateSession>(
      `SELECT id, user_id, phone_e164
         FROM voice_sessions
        WHERE recap_sent_at IS NULL
          AND (revoked_at IS NOT NULL OR expires_at <= now())
        ORDER BY expires_at ASC
        LIMIT ${SWEEP_BATCH_LIMIT}
        FOR UPDATE SKIP LOCKED`
    );
    candidates = res.rows;
  } catch (err) {
    console.error("[voice-auto-recap] candidate query failed:", (err as Error).message);
    return summary;
  }

  for (const session of candidates) {
    summary.sessions_checked += 1;
    try {
      const outcome = await processSession(db, session);
      if (outcome === "sent") summary.recaps_sent += 1;
      else if (outcome === "failed") summary.failed += 1;
      else summary.skipped += 1;
    } catch (err) {
      summary.failed += 1;
      console.error(
        `[voice-auto-recap] session ${session.id} failed:`,
        (err as Error).message
      );
    }
  }
  return summary;
}

type SessionOutcome = "sent" | "skipped" | "failed";

async function markProcessed(
  db: Db,
  session: CandidateSession,
  reason: string,
  details: Record<string, unknown> = {}
): Promise<void> {
  await db.query(`UPDATE voice_sessions SET recap_sent_at = now() WHERE id = $1`, [
    session.id,
  ]);
  await logVoiceAudit(db, {
    userId: session.user_id,
    phoneE164: session.phone_e164,
    action: "email_sent",
    details: { scope: "auto_recap", status: "skipped", reason, session_id: session.id, ...details },
  });
}

async function processSession(db: Db, session: CandidateSession): Promise<SessionOutcome> {
  // 1. User preference + verified email.
  const prefRes = await db.query<VoiceAccessPref>(
    `SELECT auto_recap_enabled, email FROM voice_access WHERE user_id = $1 LIMIT 1`,
    [session.user_id]
  );
  const pref = prefRes.rows[0];
  if (!pref || pref.auto_recap_enabled === false) {
    await markProcessed(db, session, "auto_recap_disabled");
    return "skipped";
  }
  if (!isVerifiedEmail(pref.email)) {
    await markProcessed(db, session, "no_verified_email");
    return "skipped";
  }

  // 2. A manual recap during the call wins — never double-send.
  const manualRes = await db.query<{ n: string }>(
    `SELECT 1 AS n FROM voice_tool_calls
      WHERE session_id = $1 AND tool_name = 'email_my_summary' AND success = true
      LIMIT 1`,
    [session.id]
  );
  if (manualRes.rows.length > 0) {
    await markProcessed(db, session, "manual_recap_sent");
    return "skipped";
  }

  // 3. Deterministic recap from what actually happened on the call.
  const lines = await buildCallActivityRecap(db, session.id, null);
  if (lines.length === 0) {
    await markProcessed(db, session, "no_activity");
    return "skipped";
  }

  // 4. Deliver.
  const recipient = pref.email as string;
  const subject = "Your SmartPR call recap";
  const body = `Here's what happened on your SmartPR call:\n\n${lines.join("\n")}`;
  const text = `${body}\n\nSent automatically after your SmartPR voice call.`;
  const html =
    `<p>${esc(body).replace(/\n/g, "<br/>")}</p>` +
    `<p style="color:#666;font-size:12px">Sent automatically after your SmartPR voice call.</p>`;

  const delivered = await sendComplianceEmail(recipient, subject, text, html, VOICE_SUMMARY_FROM);
  if (!delivered) {
    await logVoiceAudit(db, {
      userId: session.user_id,
      phoneE164: session.phone_e164,
      action: "email_sent",
      details: {
        scope: "auto_recap",
        status: "failed",
        session_id: session.id,
        to_domain: recipient.split("@")[1],
      },
    });
    return "failed";
  }

  await db.query(`UPDATE voice_sessions SET recap_sent_at = now() WHERE id = $1`, [
    session.id,
  ]);
  await incrementVoiceUsage(db, session.user_id, "emails_sent", 1);
  await logVoiceAudit(db, {
    userId: session.user_id,
    phoneE164: session.phone_e164,
    action: "email_sent",
    details: {
      scope: "auto_recap",
      status: "sent",
      session_id: session.id,
      to_domain: recipient.split("@")[1],
    },
  });
  return "sent";
}
