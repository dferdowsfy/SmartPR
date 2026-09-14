/**
 * Monthly compliance-digest cron: pure helpers + the sender used by the
 * monthly cron (POST /api/cron/compliance-digest).
 *
 * Runs on the 1st of the month (~8:00am ET). Queries Supabase LIVE at send
 * time — the digest always reflects the current deadline data.
 *
 * Founder constraints enforced here (same as the transactional reminders):
 * - Email ONLY (Gmail SMTP, from alerts@getsmartpr.com).
 * - Free workspaces never get the digest; paid plans do
 *   (Core = oldest business only, Operator/Partner+ = all businesses).
 * - The digest has its OWN opt-out (scope='digest'), independent of the
 *   transactional reminders. The global EMAIL mute covers both.
 * - A due item appears ONLY when the obligation carries a stored due date
 *   with real provenance (never "UNKNOWN", never NULL). Obligations without
 *   a date appear ONLY in the "missing dates" section — never with a
 *   fabricated deadline.
 */
import type { Pool, PoolClient } from "pg";
import { getWorkspacePlanState } from "./billing/access";
import {
  planAllowsReminders,
  coreCoveredBusinessId,
  businessCoveredByPlan,
  loadPreferences,
  isMuted,
  sendComplianceEmail,
  signUnsubscribeToken,
  type PreferenceRow,
} from "./compliance-reminders";
import {
  buildDigestEmail,
  bucketDigestItem,
  sortDigestSoonestFirst,
  type DigestDueItem,
  type DigestStalledItem,
  type DigestMissingItem,
} from "./compliance-digest-emails";
import { getSiteUrl } from "./siteUrl";

type Db = Pool | PoolClient;

export interface DigestSummary {
  digests_sent: number;
  skipped_plan: number;
  skipped_optout: number;
  skipped_already_sent: number;
  skipped_empty: number;
  errors: string[];
}

/**
 * Pure: is the monthly digest muted for this user?
 * - scope='digest' mute → digest off (transactional reminders unaffected).
 * - scope='global' EMAIL mute → everything off, including the digest.
 */
export function isDigestMuted(prefs: PreferenceRow[]): boolean {
  return prefs.some((p) => p.muted && (p.scope === "global" || p.scope === "digest"));
}

interface DigestObligationRow {
  id: string;
  name: string;
  agency: string | null;
  status: string;
  due_date: string | null;
  due_date_source: string | null;
  renewal_frequency_months: number | null;
  updated_at: string | null;
  business_id: string;
  business_name: string;
  business_public_id: string | null;
}

/** A stored due date counts only with real provenance — same rule as reminders. */
export function digestHasStoredDueDate(o: DigestObligationRow): boolean {
  return (
    Boolean(o.due_date) &&
    o.due_date_source !== null &&
    o.due_date_source !== "UNKNOWN"
  );
}

function startOfTodayUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function daysBetween(fromUtc: Date, isoDate: string): number {
  const d = new Date(`${isoDate}T00:00:00Z`);
  return Math.round((d.getTime() - fromUtc.getTime()) / 86_400_000);
}

function digestPeriod(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(now: Date, lang: "en" | "es"): string {
  return now.toLocaleDateString(lang === "es" ? "es-PR" : "en-US", {
    month: "long",
    year: "numeric",
  });
}

async function workspaceOwnerId(db: Db, workspaceId: string): Promise<string | null> {
  const { rows } = await db.query<{ user_id: string }>(
    `SELECT user_id FROM workspace_members
      WHERE workspace_id = $1 AND role = 'OWNER'
      ORDER BY created_at ASC NULLS LAST, user_id ASC
      LIMIT 1`,
    [workspaceId]
  );
  if (rows[0]?.user_id) return rows[0].user_id;
  const fallback = await db.query<{ user_id: string }>(
    `SELECT user_id FROM businesses
      WHERE workspace_id = $1 AND archived = false AND user_id IS NOT NULL
      ORDER BY created_at ASC LIMIT 1`,
    [workspaceId]
  );
  return fallback.rows[0]?.user_id ?? null;
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

async function userName(db: Db, userId: string): Promise<string | null> {
  try {
    const { rows } = await db.query<{ name: string | null }>(
      `SELECT COALESCE(raw_user_meta_data->>'full_name', raw_user_meta_data->>'name') AS name
         FROM auth.users WHERE id = $1`,
      [userId]
    );
    return typeof rows[0]?.name === "string" && rows[0].name.trim() ? rows[0].name.trim() : null;
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

interface DigestBuckets {
  dueSoon: DigestDueItem[];
  dueLater: DigestDueItem[];
  stalled: DigestStalledItem[];
  missingDates: DigestMissingItem[];
  totalActive: number;
}

function obligationUrl(businessPublicId: string | null, businessId: string, obligationId: string): string {
  const ref = businessPublicId || businessId;
  return `${getSiteUrl()}/businesses/${ref}#obligation-${obligationId}`;
}

/**
 * Pure: split obligation rows into the digest sections for one workspace.
 * Applies plan coverage + per-business/obligation mutes. Never invents a date.
 */
export function bucketDigestObligations(
  rows: DigestObligationRow[],
  opts: {
    now: Date;
    planId: string;
    coveredBusinessId: string | null;
    prefs: PreferenceRow[];
  }
): DigestBuckets {
  const today = startOfTodayUtc(opts.now);
  const buckets: DigestBuckets = { dueSoon: [], dueLater: [], stalled: [], missingDates: [], totalActive: 0 };
  for (const o of rows) {
    if (o.status === "COMPLETED") continue;
    buckets.totalActive += 1;
    if (!businessCoveredByPlan(opts.planId, opts.coveredBusinessId, o.business_id)) continue;
    if (isMuted(opts.prefs, { businessId: o.business_id, obligationId: o.id })) continue;

    if (digestHasStoredDueDate(o) && o.due_date) {
      const days = daysBetween(today, o.due_date);
      const bucket = bucketDigestItem(days);
      if (bucket) {
        const item: DigestDueItem = {
          obligationId: o.id,
          name: o.name,
          businessName: o.business_name,
          businessRef: o.business_public_id || o.business_id,
          agency: o.agency,
          dueDate: o.due_date,
          daysRemaining: days,
          actionUrl: obligationUrl(o.business_public_id, o.business_id, o.id),
        };
        (bucket === "dueSoon" ? buckets.dueSoon : buckets.dueLater).push(item);
        continue;
      }
    }
    if (o.status === "IN_PROGRESS" && o.updated_at) {
      const idleMs = opts.now.getTime() - new Date(o.updated_at).getTime();
      if (idleMs >= 14 * 86_400_000) {
        buckets.stalled.push({
          obligationId: o.id,
          name: o.name,
          businessName: o.business_name,
          businessRef: o.business_public_id || o.business_id,
          agency: o.agency,
          daysStalled: Math.floor(idleMs / 86_400_000),
          actionUrl: obligationUrl(o.business_public_id, o.business_id, o.id),
        });
        continue;
      }
    }
    // Renewable but no stored date → "missing dates" only. Never a fake date.
    if (o.renewal_frequency_months !== null && o.renewal_frequency_months > 0) {
      buckets.missingDates.push({
        obligationId: o.id,
        name: o.name,
        businessName: o.business_name,
        businessRef: o.business_public_id || o.business_id,
        agency: o.agency,
        actionUrl: obligationUrl(o.business_public_id, o.business_id, o.id),
      });
    }
  }
  buckets.dueSoon = sortDigestSoonestFirst(buckets.dueSoon);
  buckets.dueLater = sortDigestSoonestFirst(buckets.dueLater);
  return buckets;
}

async function digestAlreadySent(db: Db, workspaceId: string, period: string): Promise<boolean> {
  try {
    const { rows } = await db.query(
      `SELECT 1 FROM compliance_digest_log WHERE workspace_id = $1 AND period = $2 LIMIT 1`,
      [workspaceId, period]
    );
    return rows.length > 0;
  } catch {
    // Table not yet migrated — treat as "not sent".
    return false;
  }
}

async function loadDigestObligations(db: Db, workspaceId: string): Promise<DigestObligationRow[]> {
  const { rows } = await db.query<DigestObligationRow>(
    `SELECT o.id, o.name, o.agency, o.status,
            o.due_date::text AS due_date, o.due_date_source,
            o.renewal_frequency_months,
            o.updated_at::text AS updated_at,
            o.business_id,
            COALESCE(b.legal_name, b.name) AS business_name,
            b.public_id AS business_public_id
       FROM obligations o
       JOIN businesses b ON b.id = o.business_id
      WHERE b.workspace_id = $1 AND b.archived = false
      ORDER BY o.due_date NULLS LAST, o.updated_at`,
    [workspaceId]
  );
  return rows;
}

export async function runComplianceDigestCron(db: Db, now = new Date()): Promise<DigestSummary> {
  const summary: DigestSummary = {
    digests_sent: 0,
    skipped_plan: 0,
    skipped_optout: 0,
    skipped_already_sent: 0,
    skipped_empty: 0,
    errors: [],
  };
  const period = digestPeriod(now);

  const { rows: workspaces } = await db.query<{ workspace_id: string }>(
    `SELECT DISTINCT workspace_id FROM businesses
      WHERE archived = false AND workspace_id IS NOT NULL`
  );

  for (const w of workspaces) {
    const workspaceId = w.workspace_id;
    try {
      const plan = await getWorkspacePlanState(db, workspaceId);
      if (!planAllowsReminders(plan.planId)) {
        summary.skipped_plan += 1;
        continue;
      }
      if (await digestAlreadySent(db, workspaceId, period)) {
        summary.skipped_already_sent += 1;
        continue;
      }
      const ownerId = await workspaceOwnerId(db, workspaceId);
      if (!ownerId) {
        summary.errors.push(`no owner for workspace ${workspaceId}`);
        continue;
      }
      const prefs = await loadPreferences(db, ownerId);
      if (isDigestMuted(prefs)) {
        summary.skipped_optout += 1;
        continue;
      }
      const coveredBusinessId =
        plan.planId === "core" ? await coreCoveredBusinessId(db, workspaceId) : null;
      const obligationRows = await loadDigestObligations(db, workspaceId);
      const buckets = bucketDigestObligations(obligationRows, {
        now,
        planId: plan.planId,
        coveredBusinessId,
        prefs,
      });
      if (buckets.totalActive === 0) {
        summary.skipped_empty += 1;
        continue;
      }

      const email = await userEmail(db, ownerId);
      if (!email) {
        summary.errors.push(`no email for user ${ownerId}`);
        continue;
      }
      const lang = await userLang(db, ownerId);
      const name = await userName(db, ownerId);
      const site = getSiteUrl();
      const built = buildDigestEmail({
        lang,
        monthLabel: monthLabel(now, lang),
        userName: name,
        dueSoon: buckets.dueSoon,
        dueLater: buckets.dueLater,
        stalled: buckets.stalled,
        missingDates: buckets.missingDates,
        dashboardUrl: `${site}/dashboard`,
        manageUrl: `${site}/settings`,
        unsubscribeUrl: `${site}/api/notifications/unsubscribe?token=${signUnsubscribeToken(ownerId)}&lang=${lang}`,
      });
      const ok = await sendComplianceEmail(email, built.subject, built.text, built.html);
      if (!ok) {
        summary.errors.push(`digest send failed for workspace ${workspaceId}`);
        continue;
      }
      // Idempotency: UNIQUE (workspace_id, period) — a concurrent run loses the race.
      const logged = await db.query(
        `INSERT INTO compliance_digest_log (workspace_id, user_id, period, item_count)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (workspace_id, period) DO NOTHING`,
        [
          workspaceId,
          ownerId,
          period,
          buckets.dueSoon.length + buckets.dueLater.length + buckets.stalled.length + buckets.missingDates.length,
        ]
      );
      if ((logged.rowCount ?? 0) > 0) summary.digests_sent += 1;
      else summary.skipped_already_sent += 1;
    } catch (err) {
      summary.errors.push(`workspace ${workspaceId}: ${(err as Error)?.message || err}`);
    }
  }
  return summary;
}
