// Lead capture + founder notifications.
//
// When someone clicks "Start my application" on the landing page we capture
// the minimum needed to follow up (name + email) before the assessment
// begins. The founder gets an email for every new lead and every signup,
// sent directly from the SmartPR Google Workspace mailbox
// (darius@getsmartpr.com) via Gmail SMTP. Notifications are fire-and-forget:
// they never throw and never block the user flow.
//
// Required env: GMAIL_SMTP_APP_PASSWORD (a Google "app password" for the
// mailbox — create at myaccount.google.com → Security → 2-Step Verification
// → App passwords). Optional: GMAIL_SMTP_USER (defaults to
// darius@getsmartpr.com), GMAIL_FROM (defaults to
// "SmartPR <darius@getsmartpr.com>").
//
// History: this previously used FormSubmit's ajax endpoint, which rejects
// server-side requests (no browser Origin header) with HTTP 200 +
// {"success":"false"} — so every notification silently died. Never use
// FormSubmit from the server again.
import { randomUUID } from "crypto";
import nodemailer from "nodemailer";
import type { Pool } from "pg";

const FOUNDER_EMAIL = "dferdows@gmail.com";
const SMTP_USER = process.env.GMAIL_SMTP_USER || "darius@getsmartpr.com";
const MAIL_FROM = process.env.GMAIL_FROM || "SmartPR <darius@getsmartpr.com>";

interface Mailer {
  sendMail(options: Record<string, unknown>): Promise<unknown>;
}

// Test seam: tests replace the SMTP transport with a fake.
let mailerOverride: Mailer | null = null;
export function setMailerForTests(mailer: Mailer | null): void {
  mailerOverride = mailer;
}

function getMailer(): Mailer {
  if (mailerOverride) return mailerOverride;
  return nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: SMTP_USER, pass: process.env.GMAIL_SMTP_APP_PASSWORD || "" },
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

export async function notifyFounder(subject: string, fields: Record<string, string>): Promise<void> {
  const line = `[founder-notify] ${subject} :: ${Object.entries(fields).map(([k, v]) => `${k}=${v}`).join(" | ")}`;
  console.info(line);
  if (!process.env.GMAIL_SMTP_APP_PASSWORD && !mailerOverride) {
    // Loud on purpose: a missing credential means the founder hears nothing.
    console.error("[founder-notify] skipped: GMAIL_SMTP_APP_PASSWORD is not set");
    return;
  }
  const rows = Object.entries(fields)
    .map(([k, v]) => `<tr><td><strong>${escapeHtml(k)}</strong></td><td>${escapeHtml(v)}</td></tr>`)
    .join("");
  const text = Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join("\n");
  try {
    // nodemailer throws on delivery failure (unlike fetch, there is no
    // silent 200-with-error-payload case), so try/catch is the check.
    await getMailer().sendMail({
      from: MAIL_FROM,
      to: FOUNDER_EMAIL,
      subject: `[SmartPR] ${subject}`,
      text: `[SmartPR] ${subject}\n\n${text}`,
      html: `<h2>${escapeHtml(`[SmartPR] ${subject}`)}</h2><table>${rows}</table>`,
    });
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

function splitName(user: LeadUser): { first: string; last: string } {
  const meta = user.user_metadata ?? {};
  const first = typeof meta.first_name === "string" ? meta.first_name.trim() : "";
  const last = typeof meta.last_name === "string" ? meta.last_name.trim() : "";
  if (first || last) return { first, last };
  const full =
    (typeof meta.full_name === "string" && meta.full_name.trim()) ||
    (typeof meta.name === "string" && meta.name.trim()) ||
    "";
  if (full) {
    const parts = full.split(/\s+/);
    return { first: parts[0] || "", last: parts.slice(1).join(" ") };
  }
  return { first: "", last: "" };
}

/** The person-level fields every signup/lead alert carries. */
function personFields(user: LeadUser, source: string): Record<string, string> {
  const { first, last } = splitName(user);
  return {
    "First name": first || "—",
    "Last name": last || "—",
    Email: (user.email || "").trim().toLowerCase(),
    "Signed up": easternNow(),
    Source: source,
  };
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
    await notifyFounder(
      "New signup",
      personFields(user, "Signed up directly (no prior lead capture).")
    );
    return;
  }
  // Attach the account even when the lead was already converted elsewhere.
  await pool.query(`UPDATE leads SET user_id = COALESCE(user_id, $2) WHERE id = $1`, [existing.id, user.id]);
  if (await markLeadConverted(pool, existing.id, user.id)) {
    await notifyFounder(
      "Lead converted to signup",
      personFields(user, "Started as a landing-page lead, now created an account.")
    );
  }
}
