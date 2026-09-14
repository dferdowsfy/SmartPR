/**
 * Compliance-reminder engine: pure helpers + the email sender used by the
 * daily cron (POST /api/cron/compliance-reminders).
 *
 * Founder constraints enforced here:
 * - Email ONLY (Gmail SMTP, from alerts@getsmartpr.com).
 * - Free workspaces never get reminders; paid plans do.
 * - Global / per-business / per-obligation mutes are honored.
 * - A reminder is sent only when the obligation still has a stored due date
 *   with a real provenance (never "UNKNOWN", never NULL) — no estimates.
 */
import { createHmac, randomUUID } from "crypto";
import nodemailer from "nodemailer";
import type { Pool, PoolClient } from "pg";
import { getWorkspacePlanState } from "./billing/access";
import { buildReminderEmail, tierFromNotificationType, type ReminderEmailInput } from "./compliance-reminder-emails";
import { getSiteUrl } from "./siteUrl";

type Db = Pool | PoolClient;

export const REMINDER_FROM = "SmartPR <alerts@getsmartpr.com>";

// ---------------------------------------------------------------------------
// Paywall gating
// ---------------------------------------------------------------------------

/** Free = no reminders. Every paid plan gets them. */
export function planAllowsReminders(planId: string): boolean {
  return planId !== "free";
}

// ---------------------------------------------------------------------------
// Opt-outs
// ---------------------------------------------------------------------------

export interface PreferenceRow {
  scope: "global" | "business" | "obligation";
  business_id: string | null;
  obligation_id: string | null;
  muted: boolean;
}

/** Pure: is this (user, business, obligation) muted at any scope? */
export function isMuted(
  prefs: PreferenceRow[],
  target: { businessId: string; obligationId: string | null }
): boolean {
  for (const p of prefs) {
    if (!p.muted) continue;
    if (p.scope === "global") return true;
    if (p.scope === "business" && p.business_id === target.businessId) return true;
    if (
      p.scope === "obligation" &&
      target.obligationId &&
      p.obligation_id === target.obligationId
    )
      return true;
  }
  return false;
}

export async function loadPreferences(
  db: Db,
  userId: string
): Promise<PreferenceRow[]> {
  try {
    const { rows } = await db.query<PreferenceRow>(
      `SELECT scope, business_id, obligation_id, muted
         FROM notification_preferences
        WHERE user_id = $1 AND channel = 'EMAIL'`,
      [userId]
    );
    return rows;
  } catch {
    // Table not yet migrated — treat as "no preferences set".
    return [];
  }
}

// ---------------------------------------------------------------------------
// Due-notification selection (pure)
// ---------------------------------------------------------------------------

export interface DueNotificationRow {
  id: string;
  user_id: string;
  workspace_id: string | null;
  business_id: string;
  obligation_id: string | null;
  type: string;
  scheduled_for: string;
}

export function selectDueNotifications(
  rows: DueNotificationRow[],
  now: Date = new Date()
): DueNotificationRow[] {
  return rows.filter((r) => {
    if (r.type === "STALLED_NUDGE") return false; // handled by its own sweep
    if (!tierFromNotificationType(r.type)) return false;
    return new Date(r.scheduled_for).getTime() <= now.getTime();
  });
}

// ---------------------------------------------------------------------------
// Email sending (Gmail SMTP — same transport as verification mail)
// ---------------------------------------------------------------------------

let mailerOverride: { sendMail: (opts: Record<string, unknown>) => Promise<unknown> } | null = null;
/** Test seam (mirrors src/lib/enterprise-reminders.ts). */
export function setComplianceMailerForTests(
  mailer: { sendMail: (opts: Record<string, unknown>) => Promise<unknown> } | null
): void {
  mailerOverride = mailer;
}

export async function sendComplianceEmail(
  to: string,
  subject: string,
  text: string,
  html: string
): Promise<boolean> {
  if (!to || !to.includes("@")) return false;
  if (!process.env.GMAIL_SMTP_APP_PASSWORD && !mailerOverride) {
    console.error("[compliance-reminders] email skipped: GMAIL_SMTP_APP_PASSWORD is not set");
    return false;
  }
  try {
    const mailer =
      mailerOverride ??
      nodemailer.createTransport({
        host: "smtp.gmail.com",
        port: 465,
        secure: true,
        auth: {
          user: process.env.GMAIL_SMTP_USER || "alerts@getsmartpr.com",
          pass: process.env.GMAIL_SMTP_APP_PASSWORD || "",
        },
      });
    await mailer.sendMail({ from: REMINDER_FROM, to, subject, text, html });
    return true;
  } catch (err) {
    console.error(`[compliance-reminders] email delivery failed: ${(err as Error)?.message || err}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Unsubscribe tokens (HMAC-signed, no DB lookup needed)
// ---------------------------------------------------------------------------

function unsubscribeSecret(): string {
  return (
    process.env.COMPLIANCE_UNSUBSCRIBE_SECRET ||
    process.env.ENTERPRISE_CRON_SECRET ||
    "dev-only-unsubscribe-secret"
  );
}

export function signUnsubscribeToken(userId: string): string {
  const sig = createHmac("sha256", unsubscribeSecret()).update(userId).digest("hex");
  return Buffer.from(`${userId}.${sig}`).toString("base64url");
}

export function verifyUnsubscribeToken(token: string): string | null {
  try {
    const decoded = Buffer.from(token, "base64url").toString("utf8");
    const dot = decoded.lastIndexOf(".");
    if (dot < 0) return null;
    const userId = decoded.slice(0, dot);
    const sig = decoded.slice(dot + 1);
    const expected = createHmac("sha256", unsubscribeSecret()).update(userId).digest("hex");
    if (sig.length !== expected.length) return null;
    let diff = 0;
    for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
    return diff === 0 ? userId : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Cron worker
// ---------------------------------------------------------------------------

export interface CronSummary {
  renewal_sent: number;
  stalled_sent: number;
  skipped_plan: number;
  skipped_optout: number;
  skipped_no_date: number;
  errors: string[];
}

interface ObligationContext {
  obligation_id: string;
  obligation_name: string;
  business_id: string;
  business_name: string;
  agency: string | null;
  workspace_id: string | null;
  due_date: string | null;
  due_date_source: string | null;
  status: string;
  business_public_id: string | null;
}

async function obligationContext(db: Db, obligationId: string): Promise<ObligationContext | null> {
  const { rows } = await db.query<ObligationContext>(
    `SELECT o.id AS obligation_id, o.name AS obligation_name, o.business_id,
            COALESCE(b.legal_name, b.name) AS business_name, o.agency,
            b.workspace_id, o.due_date::text AS due_date, o.due_date_source,
            o.status, b.public_id AS business_public_id
       FROM obligations o
       JOIN businesses b ON b.id = o.business_id
      WHERE o.id = $1`,
    [obligationId]
  );
  return rows[0] ?? null;
}

async function userEmail(db: Db, userId: string): Promise<string | null> {
  try {
    const { rows } = await db.query<{ email: string | null }>(
      `SELECT email FROM auth.users WHERE id = $1`,
      [userId]
    );
    return typeof rows[0]?.email === "string" ? rows[0].email : null;
  } catch {
    return null;
  }
}

async function userLang(db: Db, userId: string): Promise<"en" | "es"> {
  try {
    const { rows } = await db.query<{ lang: string | null }>(
      `SELECT (raw_user_meta_data->>'lang') AS lang FROM auth.users WHERE id = $1`,
      [userId]
    );
    return rows[0]?.lang === "es" ? "es" : "en";
  } catch {
    return "en";
  }
}

/**
 * A stored due date counts only when it has real provenance. "UNKNOWN" or
 * NULL means the system does not actually know the date — never remind.
 */
export function hasStoredDueDate(ctx: ObligationContext): boolean {
  return (
    Boolean(ctx.due_date) &&
    ctx.due_date_source !== null &&
    ctx.due_date_source !== "UNKNOWN" &&
    ctx.status !== "COMPLETED"
  );
}

async function sendRenewalReminder(
  db: Db,
  n: DueNotificationRow,
  ctx: ObligationContext,
  summary: CronSummary
): Promise<void> {
  const tier = tierFromNotificationType(n.type);
  if (!tier || !ctx.due_date) return;
  const email = await userEmail(db, n.user_id);
  if (!email) {
    summary.errors.push(`no email for user ${n.user_id}`);
    return;
  }
  const lang = await userLang(db, n.user_id);
  const businessRef = ctx.business_public_id || ctx.business_id;
  const emailInput: ReminderEmailInput = {
    kind: "renewal",
    tier,
    lang,
    obligationName: ctx.obligation_name,
    businessName: ctx.business_name,
    agency: ctx.agency,
    dueDate: ctx.due_date,
    actionUrl: `${getSiteUrl()}/businesses/${businessRef}#obligation-${ctx.obligation_id}`,
    unsubscribeUrl: `${getSiteUrl()}/api/notifications/unsubscribe?token=${signUnsubscribeToken(n.user_id)}`,
  };
  const built = buildReminderEmail(emailInput);
  const ok = await sendComplianceEmail(email, built.subject, built.text, built.html);
  if (ok) {
    await db.query(
      `UPDATE notifications SET status = 'DELIVERED', delivered_at = now() WHERE id = $1 AND status = 'PENDING'`,
      [n.id]
    );
    summary.renewal_sent += 1;
  } else {
    summary.errors.push(`send failed for notification ${n.id}`);
  }
}

/** Stalled filings: IN_PROGRESS obligations untouched for 14+ days, max one nudge per 14 days. */
async function sweepStalledFilings(db: Db, summary: CronSummary): Promise<void> {
  const { rows } = await db.query<{
    obligation_id: string;
    obligation_name: string;
    business_id: string;
    business_name: string;
    agency: string | null;
    workspace_id: string | null;
    user_id: string;
    business_public_id: string | null;
  }>(
    `SELECT o.id AS obligation_id, o.name AS obligation_name, o.business_id,
            COALESCE(b.legal_name, b.name) AS business_name, o.agency,
            b.workspace_id, b.user_id, b.public_id AS business_public_id
       FROM obligations o
       JOIN businesses b ON b.id = o.business_id
      WHERE o.status = 'IN_PROGRESS'
        AND o.updated_at < now() - interval '14 days'
        AND NOT EXISTS (
          SELECT 1 FROM notifications n2
          WHERE n2.obligation_id = o.id
            AND n2.type = 'STALLED_NUDGE'
            AND n2.created_at > now() - interval '14 days'
        )
      LIMIT 200`
  );
  for (const row of rows) {
    if (!row.workspace_id) {
      summary.skipped_plan += 1;
      continue;
    }
    const plan = await getWorkspacePlanState(db, row.workspace_id);
    if (!planAllowsReminders(plan.planId)) {
      summary.skipped_plan += 1;
      continue;
    }
    const prefs = await loadPreferences(db, row.user_id);
    if (isMuted(prefs, { businessId: row.business_id, obligationId: row.obligation_id })) {
      summary.skipped_optout += 1;
      continue;
    }
    const email = await userEmail(db, row.user_id);
    if (!email) {
      summary.errors.push(`no email for user ${row.user_id}`);
      continue;
    }
    const lang = await userLang(db, row.user_id);
    const businessRef = row.business_public_id || row.business_id;
    const built = buildReminderEmail({
      kind: "stalled",
      lang,
      obligationName: row.obligation_name,
      businessName: row.business_name,
      agency: row.agency,
      actionUrl: `${getSiteUrl()}/businesses/${businessRef}#obligation-${row.obligation_id}`,
      unsubscribeUrl: `${getSiteUrl()}/api/notifications/unsubscribe?token=${signUnsubscribeToken(row.user_id)}`,
    });
    const ok = await sendComplianceEmail(email, built.subject, built.text, built.html);
    // Record the nudge (idempotency: the 14-day EXISTS guard above).
    await db.query(
      `INSERT INTO notifications
         (id, user_id, workspace_id, business_id, obligation_id, type, channel, scheduled_for, message, status, delivered_at)
       VALUES ($1,$2,$3,$4,$5,'STALLED_NUDGE','EMAIL',now(),$6,$7, CASE WHEN $7='DELIVERED' THEN now() END)`,
      [
        randomUUID(),
        row.user_id,
        row.workspace_id,
        row.business_id,
        row.obligation_id,
        `Stalled filing nudge: ${row.obligation_name}`,
        ok ? "DELIVERED" : "PENDING",
      ]
    );
    if (ok) summary.stalled_sent += 1;
    else summary.errors.push(`stalled send failed for obligation ${row.obligation_id}`);
  }
}

export async function runComplianceReminderCron(db: Db, now = new Date()): Promise<CronSummary> {
  const summary: CronSummary = {
    renewal_sent: 0,
    stalled_sent: 0,
    skipped_plan: 0,
    skipped_optout: 0,
    skipped_no_date: 0,
    errors: [],
  };

  const { rows } = await db.query<DueNotificationRow>(
    `SELECT id, user_id, workspace_id, business_id, obligation_id, type,
            scheduled_for::text AS scheduled_for
       FROM notifications
      WHERE status = 'PENDING' AND channel = 'EMAIL'
        AND scheduled_for <= now()
      ORDER BY scheduled_for
      LIMIT 500`
  );
  const due = selectDueNotifications(rows, now);

  for (const n of due) {
    try {
      if (!n.obligation_id || !n.workspace_id) {
        summary.skipped_no_date += 1;
        continue;
      }
      const plan = await getWorkspacePlanState(db, n.workspace_id);
      if (!planAllowsReminders(plan.planId)) {
        summary.skipped_plan += 1;
        continue;
      }
      const prefs = await loadPreferences(db, n.user_id);
      if (isMuted(prefs, { businessId: n.business_id, obligationId: n.obligation_id })) {
        summary.skipped_optout += 1;
        continue;
      }
      const ctx = await obligationContext(db, n.obligation_id);
      if (!ctx || !hasStoredDueDate(ctx)) {
        // Founder rule: no stored date with provenance = no reminder, ever.
        // Cancel the stale schedule so it never fires.
        await db.query(`UPDATE notifications SET status = 'CANCELLED' WHERE id = $1`, [n.id]);
        summary.skipped_no_date += 1;
        continue;
      }
      await sendRenewalReminder(db, n, ctx, summary);
    } catch (err) {
      summary.errors.push(`notification ${n.id}: ${(err as Error)?.message || err}`);
    }
  }

  await sweepStalledFilings(db, summary);
  return summary;
}
