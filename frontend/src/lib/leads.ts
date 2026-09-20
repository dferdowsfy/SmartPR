// Lead capture + founder notifications.
//
// When someone clicks "Start my application" on the landing page we capture
// the minimum needed to follow up (name + email) before the assessment
// begins. The founder gets an email for every new lead and every signup.
//
// Delivery runs through the Supabase email path (owner direction
// 2026-09-20): notifications are enqueued into the `email_outbox` table and
// the `email-sender` edge function delivers them via Resend. The app server
// never touches SMTP or provider APIs directly — this replaces the old
// Gmail SMTP wiring, which was never configured in production and silently
// dropped every alert. Notifications are fire-and-forget: they never throw
// and never block the user flow.
//
// Optional: GMAIL_FROM (defaults to "SmartPR <alerts@getsmartpr.com>").
// The From address must be authorized in Resend for getsmartpr.com.
import { randomUUID } from "crypto";
import type { Pool } from "pg";
import { enqueueEmail } from "./email-outbox";

const FOUNDER_EMAIL = "dferdows@gmail.com";
const MAIL_FROM = process.env.GMAIL_FROM || "SmartPR <alerts@getsmartpr.com>";

interface Mailer {
  sendMail(options: Record<string, unknown>): Promise<unknown>;
}

// Test seam: tests replace the outbox enqueue with a fake.
let mailerOverride: Mailer | null = null;
export function setMailerForTests(mailer: Mailer | null): void {
  mailerOverride = mailer;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

/**
 * Branded HTML body for founder alerts. Table layout + inline styles so it
 * renders in Gmail/phone mail clients. The same design is mirrored in
 * supabase/functions/signup-alert (the Supabase-side signup hook) so both
 * senders look identical.
 */
export function buildAlertHtml(subject: string, fields: Record<string, string>): string {
  const rows = Object.entries(fields)
    .map(
      ([k, v]) =>
        `<tr>` +
        `<td style="padding:10px 12px;border-bottom:1px solid #eef1f4;color:#5b6b7b;font-size:13px;width:38%;vertical-align:top;">${escapeHtml(k)}</td>` +
        `<td style="padding:10px 12px;border-bottom:1px solid #eef1f4;color:#12212f;font-size:13px;vertical-align:top;">${escapeHtml(v)}</td>` +
        `</tr>`
    )
    .join("");
  return (
    `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f2f5f7;">` +
    `<div style="max-width:560px;margin:0 auto;padding:24px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">` +
    `<div style="background:#0f2a43;border-radius:12px 12px 0 0;padding:20px 24px;">` +
    `<div style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:.2px;">SmartPR</div>` +
    `<div style="color:#9fb4c7;font-size:14px;margin-top:2px;">${escapeHtml(subject)}</div>` +
    `</div>` +
    `<div style="background:#ffffff;border-radius:0 0 12px 12px;padding:8px 12px 16px;">` +
    `<table role="presentation" style="width:100%;border-collapse:collapse;">${rows}</table>` +
    `</div>` +
    `<div style="color:#8a99a8;font-size:12px;text-align:center;margin-top:12px;">Sent automatically by SmartPR founder alerts</div>` +
    `</div></body></html>`
  );
}

export async function notifyFounder(subject: string, fields: Record<string, string>): Promise<void> {
  const line = `[founder-notify] ${subject} :: ${Object.entries(fields).map(([k, v]) => `${k}=${v}`).join(" | ")}`;
  console.info(line);
  const text = Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join("\n");
  const html = buildAlertHtml(subject, fields);
  const mail = {
    from: MAIL_FROM,
    to: FOUNDER_EMAIL,
    subject: `[SmartPR] ${subject}`,
    text: `[SmartPR] ${subject}\n\n${text}`,
    html,
  };
  try {
    if (mailerOverride) {
      // Test seam (and only the test seam) sends directly.
      await mailerOverride.sendMail(mail);
      return;
    }
    // Production path: enqueue into the Supabase email outbox. The
    // `email-sender` edge function delivers via Resend.
    const queued = await enqueueEmail({
      senderKey: "lead_alert",
      from: mail.from,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
    if (!queued) {
      // Loud on purpose: a failed enqueue means the founder hears nothing.
      console.error("[founder-notify] enqueue failed — founder alert was not queued");
    }
  } catch (err) {
    // Notification failed — the lead is already stored; never break the flow.
    console.error(`[founder-notify] delivery failed: ${(err as Error)?.message || err}`);
  }
}

interface LeadUser {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
}

function easternNow(): string {
  return (
    new Date().toLocaleString("en-US", {
      timeZone: "America/New_York",
      dateStyle: "medium",
      timeStyle: "short",
    }) + " ET"
  );
}

export interface NewBusinessAlert {
  businessName: string;
  businessType?: string | null;
  industry?: string | null;
  municipality?: string | null;
  onboardingMode?: string | null;
  publicId?: string | null;
  ownerName?: string | null;
  ownerEmail?: string | null;
}

/**
 * Fired when a user starts a business (new-business intake or manual
 * creation). This is where "what they're trying to do" shows up: the
 * business type, industry, and municipality are the distilled intent from
 * the intake. The raw natural-language prompt is not persisted, so it
 * cannot be included reliably.
 */
export async function notifyNewBusiness(b: NewBusinessAlert): Promise<void> {
  await notifyFounder("New business started", {
    "Business name": b.businessName,
    "Business type": b.businessType || "—",
    Industry: b.industry || "—",
    Municipality: b.municipality || "—",
    "New or existing": b.onboardingMode === "EXISTING" ? "Existing business" : "New business",
    Owner: b.ownerName || "—",
    "Owner email": b.ownerEmail || "—",
    Started: easternNow(),
    "View in SmartPR": b.publicId ? `https://www.getsmartpr.com/businesses/${b.publicId}` : "—",
  });
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
 * user signed up without going through landing capture.
 *
 * Founder notification for signups is owned by the database trigger
 * `trg_users_new_signup` (data/email_outbox_schema.sql), which fires on the
 * public.users insert — this function deliberately does NOT notify, so a
 * signup can never alert twice.
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
    return;
  }
  // Attach the account even when the lead was already converted elsewhere.
  await pool.query(`UPDATE leads SET user_id = COALESCE(user_id, $2) WHERE id = $1`, [existing.id, user.id]);
  await markLeadConverted(pool, existing.id, user.id);
}
