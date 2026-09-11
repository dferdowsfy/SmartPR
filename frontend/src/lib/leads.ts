// Lead capture + founder notifications.
//
// When someone clicks "Start my application" on the landing page we capture
// the minimum needed to follow up (name + email) before the assessment
// begins. The founder gets an email for every new lead and every signup via
// Resend (server-side transactional email). Notifications are fire-and-forget:
// they never throw and never block the user flow.
//
// Required env: RESEND_API_KEY. Optional: RESEND_FROM (defaults to
// "SmartPR <notifications@getsmartpr.com>"). The sending domain must be
// verified in Resend before mail will deliver.
//
// History: this previously used FormSubmit's ajax endpoint, which rejects
// server-side requests (no browser Origin header) with HTTP 200 +
// {"success":"false"} — so every notification silently died. Never use
// FormSubmit from the server again.
import { randomUUID } from "crypto";
import type { Pool } from "pg";

const FOUNDER_EMAIL = "dferdows@gmail.com";
const RESEND_FROM = process.env.RESEND_FROM || "SmartPR <notifications@getsmartpr.com>";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

export async function notifyFounder(subject: string, fields: Record<string, string>): Promise<void> {
  const line = `[founder-notify] ${subject} :: ${Object.entries(fields).map(([k, v]) => `${k}=${v}`).join(" | ")}`;
  console.info(line);
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    // Loud on purpose: a missing key means the founder hears nothing.
    console.error("[founder-notify] skipped: RESEND_API_KEY is not set");
    return;
  }
  const rows = Object.entries(fields)
    .map(([k, v]) => `<tr><td><strong>${escapeHtml(k)}</strong></td><td>${escapeHtml(v)}</td></tr>`)
    .join("");
  const text = Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join("\n");
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: RESEND_FROM,
          to: [FOUNDER_EMAIL],
          subject: `[SmartPR] ${subject}`,
          html: `<h2>${escapeHtml(`[SmartPR] ${subject}`)}</h2><table>${rows}</table>`,
          text: `[SmartPR] ${subject}\n\n${text}`,
        }),
        signal: controller.signal,
      });
      // Check the body, not just the status: some providers answer HTTP 200
      // with an error payload (this exact bug killed every notification
      // sent through the previous provider).
      const body = (await response.json().catch(() => ({}))) as { error?: unknown; id?: string };
      if (!response.ok || body.error) {
        console.error(
          `[founder-notify] delivery failed: HTTP ${response.status} ${JSON.stringify(body).slice(0, 300)}`
        );
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
