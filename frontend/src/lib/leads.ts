// Lead capture + founder notifications.
//
// When someone clicks "Start my application" on the landing page we capture
// the minimum needed to follow up (name + email) before the assessment
// begins. The founder gets an email for every new lead and every signup —
// via FormSubmit, the same no-key channel the permit quiz already uses.
// Notifications are fire-and-forget: they never throw and never block the
// user flow.
import { randomUUID } from "crypto";
import type { Pool } from "pg";

const FOUNDER_EMAIL = "dferdows@gmail.com";

export async function notifyFounder(subject: string, fields: Record<string, string>): Promise<void> {
  const line = `[founder-notify] ${subject} :: ${Object.entries(fields).map(([k, v]) => `${k}=${v}`).join(" | ")}`;
  console.info(line);
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(`https://formsubmit.co/ajax/${FOUNDER_EMAIL}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ _subject: `[SmartPR] ${subject}`, ...fields }),
        signal: controller.signal,
      });
      if (!response.ok) {
        console.error(`[founder-notify] delivery failed: HTTP ${response.status}`);
      }
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    // Notification failed — the lead is already stored; never break the flow.
  }
}

interface LeadUser {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
}

function displayName(user: LeadUser, fallback: string | null): string {
  const meta = user.user_metadata ?? {};
  const first = typeof meta.first_name === "string" ? meta.first_name : "";
  const last = typeof meta.last_name === "string" ? meta.last_name : "";
  const fromMeta = `${first} ${last}`.trim();
  if (fromMeta) return fromMeta;
  const full = typeof meta.full_name === "string" ? meta.full_name : "";
  if (full) return full;
  const name = typeof meta.name === "string" ? meta.name : "";
  return name || fallback || "(no name given)";
}

/**
 * Flip a CAPTURED lead to CONVERTED exactly once. The conditional UPDATE is
 * the deduplication guard: concurrent callers (CTA tracking vs. auth
 * bootstrap) can't both win, so the founder is notified at most once per
 * conversion. Returns true when this call performed the flip.
 */
export async function markLeadConverted(
  pool: Pool,
  leadId: string,
  userId: string | null
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE leads
        SET user_id = COALESCE(user_id, $2),
            status = 'CONVERTED',
            converted_at = COALESCE(converted_at, now()),
            notified_at = now()
      WHERE id = $1 AND status = 'CAPTURED'`,
    [leadId, userId]
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Link a lead to a freshly signed-up user. Creates the lead row when the
 * user signed up without going through landing capture. Notifies the founder
 * exactly once per conversion.
 */
export async function convertLeadForUser(pool: Pool, user: LeadUser): Promise<void> {
  const email = (user.email || "").trim().toLowerCase();
  if (!email) return;
  const { rows } = await pool.query<{ id: string; name: string | null; status: string }>(
    `SELECT id, name, status FROM leads WHERE lower(email) = $1 LIMIT 1`,
    [email]
  );
  const existing = rows[0];
  if (!existing) {
    const name = displayName(user, null);
    await pool.query(
      `INSERT INTO leads (id, email, name, user_id, status, source, notified_at, converted_at)
       VALUES ($1,$2,$3,$4,'CONVERTED','signup_direct',now(),now())`,
      [randomUUID(), email, name, user.id]
    );
    await notifyFounder("New signup", {
      Name: name,
      Email: email,
      Detail: "Signed up directly (no prior lead capture).",
    });
    return;
  }
  // Attach the account even when the lead was already converted elsewhere.
  await pool.query(`UPDATE leads SET user_id = COALESCE(user_id, $2) WHERE id = $1`, [existing.id, user.id]);
  if (await markLeadConverted(pool, existing.id, user.id)) {
    await notifyFounder("Lead converted to signup", {
      Name: existing.name || displayName(user, null),
      Email: email,
      Detail: "Started as a landing-page lead, now created an account.",
    });
  }
}
