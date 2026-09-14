/**
 * Monthly compliance-digest cron: pure helpers + the sender used by the
 * monthly cron (POST /api/cron/compliance-digest).
 *
 * Runs on the 1st of the month (~8:00am ET), AFTER the regulatory scan
 * (recommended 6:00am ET the same day). Queries Supabase LIVE at send time —
 * the digest always reflects the current deadline data.
 *
 * The digest behaves like a proactive compliance officer: executive summary,
 * ACTION REQUIRED, COMING UP, WHAT CHANGED, SMARTPR NEEDS FROM YOU, and
 * COMPLIANCE HEALTH (see spec section 10).
 *
 * Founder constraints enforced here (same as the transactional reminders):
 * - Email ONLY (Gmail SMTP, from alerts@getsmartpr.com).
 * - Free workspaces never get the digest; paid plans do
 *   (Core = oldest business only, Operator/Partner+ = all businesses).
 * - The digest has its OWN opt-out (scope='digest'), independent of the
 *   transactional reminders. The global EMAIL mute covers both.
 * - A due item appears ONLY when the obligation still carries a stored due
 *   date with real provenance (never "UNKNOWN", never NULL). Obligations
 *   without a date appear ONLY in "SMARTPR needs from you" — never with a
 *   fabricated deadline.
 * - A regulatory development reaches the digest ONLY when verified
 *   (review_status='verified') AND matched to the business with an
 *   explainable basis. No generic news, ever.
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
  bucketComingItem,
  sortDigestSoonestFirst,
  type DigestActionItem,
  type DigestChangeItem,
  type DigestComingItem,
  type DigestEmailInput,
  type DigestHealth,
  type DigestNeedItem,
} from "./compliance-digest-emails";
import {
  developmentApplicability,
  guidanceForRequirement,
  matchDevelopmentToBusiness,
  obligationApplicability,
  sortByPriority,
  type ApplicabilityLabel,
  type DigestBusinessProfile,
  type DigestLang,
  type DigestObligationProfile,
  type RegulatoryDevelopment,
} from "./compliance-regulatory";
import { getSiteUrl } from "./siteUrl";

type Db = Pool | PoolClient;

/** Display caps: the digest must stay readable in under 2 minutes. */
export const DIGEST_CAPS = { action: 10, coming: 8, changes: 5, needs: 6 } as const;

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

export interface DigestObligationRow {
  id: string;
  name: string;
  agency: string | null;
  status: string;
  due_date: string | null;
  due_date_source: string | null;
  renewal_frequency_months: number | null;
  updated_at: string | null;
  requirement_id: string | null;
  next_action: string | null;
  source_reference: string | null;
  mandatory: boolean;
  evidence_count: number;
  business_id: string;
  business_name: string;
  business_public_id: string | null;
  business_type: string | null;
  industry: string | null;
  municipality: string | null;
  business_structure: string | null;
}

/** A stored due date counts only with real provenance — same rule as reminders. */
export function digestHasStoredDueDate(o: Pick<DigestObligationRow, "due_date" | "due_date_source">): boolean {
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

function monthLabel(now: Date, lang: DigestLang): string {
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

async function userLang(db: Db, userId: string): Promise<DigestLang> {
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

// ---------------------------------------------------------------------------
// Localized fallback copy. The validated knowledge-graph guidance is always
// preferred; these honest generics apply only when no guidance concept
// exists for the requirement. They state no specific penalty, fee, or date.
// ---------------------------------------------------------------------------

const STATUS_ACTION: Record<string, { en: string; es: string }> = {
  OVERDUE: { en: "Start the renewal now.", es: "Empieza la renovación ahora." },
  DUE_SOON: { en: "Prepare the renewal filing.", es: "Prepara la radicación de renovación." },
  UPCOMING: { en: "Review the renewal requirements.", es: "Revisa los requisitos de renovación." },
  NEEDS_ATTENTION: { en: "Review the extracted information.", es: "Revisa la información extraída." },
  MISSING: { en: "Upload current evidence.", es: "Sube la evidencia vigente." },
  UNKNOWN: { en: "Enter the date or upload evidence.", es: "Entra la fecha o sube evidencia." },
  IN_PROGRESS: { en: "Continue the filing.", es: "Continúa con la radicación." },
  COMPLETED: { en: "View the filing record.", es: "Ver el expediente de radicación." },
};

function statusAction(status: string, lang: DigestLang): string {
  const hit = STATUS_ACTION[status];
  if (hit) return hit[lang];
  return lang === "es" ? "Revisa este requisito." : "Review this requirement.";
}

export interface ResolvedItemContent {
  whatToDo: string;
  whyApplies: string;
  risk: string;
}

/**
 * Pure: resolve the three explanatory lines for a digest item.
 * Validated knowledge-graph guidance wins; honest generic fallbacks only
 * when no concept exists. Never invents specifics.
 */
export function resolveItemContent(
  o: Pick<DigestObligationRow, "requirement_id" | "status" | "source_reference" | "due_date">,
  lang: DigestLang,
  overdue: boolean
): ResolvedItemContent {
  const concept = guidanceForRequirement(o.requirement_id);
  const whatToDo = concept?.nextAction[lang] ?? statusAction(o.status, lang);
  const whyApplies =
    concept?.regulatoryReason[lang] ??
    (o.source_reference
      ? lang === "es"
        ? `La revisión regulatoria de SmartPR identificó este requisito para tu negocio (${o.source_reference}).`
        : `SmartPR's regulatory review identified this requirement for your business (${o.source_reference}).`
      : lang === "es"
        ? "La revisión regulatoria de SmartPR identificó este requisito para tu perfil de negocio."
        : "SmartPR's regulatory review identified this requirement for your business profile.");
  const risk =
    concept?.consequenceOrNextStep[lang] ??
    (overdue
      ? lang === "es"
        ? "Operar con un vencimiento pasado puede traer multas, tener que empezar el trámite de nuevo u operar sin autorización. Verifica las reglas de la agencia para tu caso."
        : "Operating past a deadline can mean fines, having to restart the filing, or operating without authorization — check the agency's rules for your case."
      : lang === "es"
        ? "Si se te pasa la fecha, puedes enfrentar multas o tener que empezar el trámite desde cero."
        : "Missing the deadline can mean fines or having to restart the filing process.");
  return { whatToDo, whyApplies, risk };
}

function obligationUrl(businessPublicId: string | null, businessId: string, obligationId: string): string {
  const ref = businessPublicId || businessId;
  return `${getSiteUrl()}/businesses/${ref}#obligation-${obligationId}`;
}

export interface ClassifiedObligation extends DigestObligationRow {
  daysRemaining: number | null;
  daysStalled: number | null;
  overdue: boolean;
  applicability: ApplicabilityLabel;
}

/**
 * Pure: classify one obligation row for the digest. Applies plan coverage +
 * per-business/obligation mutes. Returns null when the obligation is out of
 * scope for this digest.
 */
export function classifyObligation(
  o: DigestObligationRow,
  opts: { now: Date; planId: string; coveredBusinessId: string | null; prefs: PreferenceRow[] }
): ClassifiedObligation | null {
  if (o.status === "COMPLETED") return null;
  if (!businessCoveredByPlan(opts.planId, opts.coveredBusinessId, o.business_id)) return null;
  if (isMuted(opts.prefs, { businessId: o.business_id, obligationId: o.id })) return null;

  const today = startOfTodayUtc(opts.now);
  let daysRemaining: number | null = null;
  let overdue = false;
  if (digestHasStoredDueDate(o) && o.due_date) {
    daysRemaining = daysBetween(today, o.due_date);
    overdue = daysRemaining < 0;
  }
  let daysStalled: number | null = null;
  if (o.status === "IN_PROGRESS" && o.updated_at) {
    const idleMs = opts.now.getTime() - new Date(o.updated_at).getTime();
    if (idleMs >= 14 * 86_400_000) daysStalled = Math.floor(idleMs / 86_400_000);
  }
  return {
    ...o,
    daysRemaining,
    daysStalled,
    overdue,
    applicability: obligationApplicability({ status: o.status, mandatory: o.mandatory, sourceReference: o.source_reference }),
  };
}

function toActionItem(o: ClassifiedObligation, lang: DigestLang): DigestActionItem {
  const content = resolveItemContent(o, lang, o.overdue);
  return {
    obligationId: o.id,
    name: o.name,
    businessName: o.business_name,
    businessRef: o.business_public_id || o.business_id,
    agency: o.agency,
    dueDate: o.due_date,
    daysRemaining: o.daysRemaining,
    daysStalled: o.daysStalled,
    overdue: o.overdue,
    whatToDo: content.whatToDo,
    whyApplies: content.whyApplies,
    risk: content.risk,
    applicability: o.applicability,
    actionUrl: obligationUrl(o.business_public_id, o.business_id, o.id),
  };
}

function toComingItem(o: ClassifiedObligation, lang: DigestLang, window: "60" | "90"): DigestComingItem {
  const content = resolveItemContent(o, lang, false);
  return {
    obligationId: o.id,
    name: o.name,
    businessName: o.business_name,
    businessRef: o.business_public_id || o.business_id,
    agency: o.agency,
    dueDate: o.due_date ?? "",
    daysRemaining: o.daysRemaining ?? 0,
    prepNow: content.whatToDo,
    applicability: o.applicability,
    actionUrl: obligationUrl(o.business_public_id, o.business_id, o.id),
    window,
  };
}

// ---------------------------------------------------------------------------
// Compliance health (spec section 10): explainable score.
// health = current / total applicable, where "current" means the obligation
// is neither overdue, nor due within 30 days, nor missing expected evidence,
// nor flagged needs-verification.
// ---------------------------------------------------------------------------

const EVIDENCE_EXPECTED_STATUSES = new Set(["MISSING", "DUE_SOON", "UPCOMING", "OVERDUE", "NEEDS_ATTENTION"]);

export function computeDigestHealth(rows: ClassifiedObligation[]): DigestHealth {
  const total = rows.length;
  const bad = new Set<string>();
  let overdue = 0;
  let needsVerification = 0;
  for (const o of rows) {
    if (o.overdue) {
      overdue += 1;
      bad.add(o.id);
    }
    if (!o.overdue && o.daysRemaining !== null && o.daysRemaining <= 30) bad.add(o.id);
    if (o.status === "UNKNOWN") {
      needsVerification += 1;
      bad.add(o.id);
    }
    // A stalled filing shows up in ACTION REQUIRED — it is not "current".
    if (o.daysStalled !== null) bad.add(o.id);
    // A renewable obligation with no stored expiry date shows up in
    // SMARTPR NEEDS FROM YOU — SmartPR cannot confirm it is current.
    if (
      o.renewal_frequency_months !== null &&
      o.renewal_frequency_months > 0 &&
      !digestHasStoredDueDate(o)
    )
      bad.add(o.id);
    if (o.evidence_count === 0 && EVIDENCE_EXPECTED_STATUSES.has(o.status)) bad.add(o.id);
  }
  const current = total - bad.size;
  const upcoming = rows.filter(
    (o) => o.overdue || (o.daysRemaining !== null && o.daysRemaining <= 90) || o.daysStalled !== null
  ).length;
  return {
    percent: total === 0 ? 100 : Math.round((100 * current) / total),
    total,
    current,
    upcoming,
    needsVerification,
    overdue,
  };
}

// ---------------------------------------------------------------------------
// SMARTPR NEEDS FROM YOU: missing evidence, unknown expirations, and info
// needed to determine applicability. Never invents a date — it surfaces the
// gap and asks the user to fill it.
// ---------------------------------------------------------------------------

export function buildNeedsFromYou(rows: ClassifiedObligation[], lang: DigestLang): DigestNeedItem[] {
  const items: DigestNeedItem[] = [];
  for (const o of rows) {
    const url = obligationUrl(o.business_public_id, o.business_id, o.id);
    const base = {
      name: o.name,
      businessName: o.business_name,
      businessRef: o.business_public_id || o.business_id,
      agency: o.agency,
      actionUrl: url,
    };
    if (o.status === "UNKNOWN") {
      items.push({
        ...base,
        kind: "info",
        detail:
          lang === "es"
            ? "SmartPR no pudo confirmar si este requisito te aplica. Revisa los datos de tu negocio para determinarlo."
            : "SmartPR couldn't confirm whether this requirement applies to you. Review your business details so we can determine it.",
        cta: lang === "es" ? "Revisar" : "Review",
      });
      continue;
    }
    if (o.renewal_frequency_months !== null && o.renewal_frequency_months > 0 && !digestHasStoredDueDate(o)) {
      items.push({
        ...base,
        kind: "date",
        detail:
          lang === "es"
            ? "Esta renovación no tiene fecha de vencimiento guardada, así que no te podemos avisar cuando se acerque. Agrégala y la incluimos en tus avisos."
            : "This renewal has no expiry date stored, so we can't warn you as it approaches. Add the date and we'll include it in your reminders.",
        cta: lang === "es" ? "Agregar fecha" : "Add date",
      });
      continue;
    }
    if (o.evidence_count === 0 && EVIDENCE_EXPECTED_STATUSES.has(o.status)) {
      items.push({
        ...base,
        kind: "evidence",
        detail:
          lang === "es"
            ? "No hay evidencia vigente en tu expediente para este requisito. Súbela para mantener tu perfil al día."
            : "There's no current evidence on file for this requirement. Upload it to keep your profile current.",
        cta: lang === "es" ? "Subir evidencia" : "Upload evidence",
      });
    }
  }
  return items;
}

// ---------------------------------------------------------------------------
// Regulatory developments: load verified findings, match to each business,
// build WHAT CHANGED items. Developments already shown to this workspace are
// excluded (shown at most once).
// ---------------------------------------------------------------------------

function dbDevelopmentRow(r: Record<string, unknown>): RegulatoryDevelopment {
  const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
  const conf = r.confidence;
  return {
    id: String(r.id),
    title: String(r.title),
    summary: String(r.summary),
    sourceName: String(r.source_name),
    sourceUrl: String(r.source_url),
    publishedDate: typeof r.published_date === "string" ? r.published_date : null,
    effectiveDate: typeof r.effective_date === "string" ? r.effective_date : null,
    affectedRequirementCodes: arr(r.affected_requirement_codes),
    agencyNames: arr(r.agency_names),
    municipalities: arr(r.municipalities),
    businessTypes: arr(r.business_types),
    industries: arr(r.industries),
    requirementNames: arr(r.requirement_names),
    applicabilityNotes: typeof r.applicability_notes === "string" ? r.applicability_notes : null,
    recommendedAction: typeof r.recommended_action === "string" ? r.recommended_action : null,
    confidence: conf === "high" || conf === "low" ? conf : "medium",
  };
}

async function loadVerifiedDevelopments(db: Db, workspaceId: string): Promise<RegulatoryDevelopment[]> {
  try {
    const { rows } = await db.query(
      `SELECT d.id::text AS id, d.title, d.summary, d.source_name, d.source_url,
              d.published_date::text AS published_date, d.effective_date::text AS effective_date,
              d.affected_requirement_codes, d.agency_names, d.municipalities,
              d.business_types, d.industries, d.requirement_names,
              d.applicability_notes, d.recommended_action, d.confidence
         FROM regulatory_developments d
        WHERE d.review_status = 'verified'
          AND (d.published_date IS NULL OR d.published_date >= CURRENT_DATE - INTERVAL '90 days')
          AND NOT EXISTS (
            SELECT 1 FROM regulatory_development_shows s
             WHERE s.development_id = d.id AND s.workspace_id = $1
          )
        ORDER BY d.published_date DESC NULLS LAST, d.recorded_at DESC`,
      [workspaceId]
    );
    return rows.map(dbDevelopmentRow);
  } catch {
    // Table not yet migrated — no developments.
    return [];
  }
}

function businessProfiles(rows: ClassifiedObligation[]): DigestBusinessProfile[] {
  const map = new Map<string, DigestBusinessProfile>();
  for (const o of rows) {
    if (!map.has(o.business_id)) {
      map.set(o.business_id, {
        businessId: o.business_id,
        businessName: o.business_name,
        businessType: o.business_type,
        industry: o.industry,
        municipality: o.municipality,
        businessStructure: o.business_structure,
      });
    }
  }
  return [...map.values()];
}

/**
 * Pure: match developments to businesses and build WHAT CHANGED items.
 * One item per (development, business) match, prioritized by confidence
 * then recency (callers pass developments newest-first).
 */
export function matchChangesForBusinesses(
  developments: RegulatoryDevelopment[],
  businesses: DigestBusinessProfile[],
  obligations: DigestObligationProfile[],
  lang: DigestLang
): DigestChangeItem[] {
  const items: DigestChangeItem[] = [];
  for (const dev of developments) {
    for (const b of businesses) {
      const match = matchDevelopmentToBusiness(dev, b, obligations);
      if (!match.matched) continue;
      const applicability = developmentApplicability(dev, match);
      const whyAffects =
        (lang === "es" ? `${match.basis}.` : `${match.basis}.`) +
        (dev.applicabilityNotes ? ` ${dev.applicabilityNotes}` : "");
      items.push({
        developmentId: dev.id,
        title: dev.title,
        summary: dev.summary,
        businessName: b.businessName,
        effectiveDate: dev.effectiveDate,
        publishedDate: dev.publishedDate,
        whyAffects,
        recommendedAction: dev.recommendedAction,
        sourceName: dev.sourceName,
        sourceUrl: dev.sourceUrl,
        confidence: dev.confidence,
        applicability,
      });
    }
  }
  // Confidence first (high → low), stable otherwise (developments arrive newest-first).
  const rank = { high: 0, medium: 1, low: 2 } as const;
  items.sort((a, b) => rank[a.confidence] - rank[b.confidence]);
  return items;
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
            o.requirement_id, o.next_action, o.source_reference,
            COALESCE(o.mandatory, true) AS mandatory,
            (SELECT COUNT(*) FROM evidence e WHERE e.obligation_id = o.id)::int AS evidence_count,
            o.business_id,
            COALESCE(b.legal_name, b.name) AS business_name,
            b.public_id AS business_public_id,
            b.business_type, b.industry, b.municipality, b.business_structure
       FROM obligations o
       JOIN businesses b ON b.id = o.business_id
      WHERE b.workspace_id = $1 AND b.archived = false
      ORDER BY o.due_date NULLS LAST, o.updated_at`,
    [workspaceId]
  );
  return rows.map((r) => ({ ...r, evidence_count: Number(r.evidence_count ?? 0) }));
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
      const classifyOpts = { now, planId: plan.planId, coveredBusinessId, prefs };
      const rows = (await loadDigestObligations(db, workspaceId))
        .map((o) => classifyObligation(o, classifyOpts))
        .filter((o): o is ClassifiedObligation => o !== null);
      if (rows.length === 0) {
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

      // ACTION REQUIRED: overdue, due within 30 days, or stalled — prioritized.
      const actionRows = rows.filter(
        (o) => o.overdue || (o.daysRemaining !== null && o.daysRemaining <= 30) || o.daysStalled !== null
      );
      const actionSorted = sortByPriority(
        actionRows.map((o) => ({
          o,
          overdue: o.overdue,
          daysRemaining: o.daysRemaining,
          daysStalled: o.daysStalled,
          mandatory: o.mandatory,
        }))
      ).map((x) => x.o);
      const actionRequired = actionSorted.map((o) => toActionItem(o, lang));

      // COMING UP: 31–90 days, grouped in 60/90 windows, soonest first.
      const comingUp = rows
        .filter((o) => o.daysRemaining !== null && !o.overdue)
        .map((o) => ({ o, window: bucketComingItem(o.daysRemaining as number) }))
        .filter((x): x is { o: ClassifiedObligation; window: "60" | "90" } => x.window !== null)
        .sort((a, b) => (a.o.daysRemaining as number) - (b.o.daysRemaining as number))
        .map((x) => toComingItem(x.o, lang, x.window));

      // WHAT CHANGED: verified developments matched to these businesses.
      const businesses = businessProfiles(rows);
      const developments = await loadVerifiedDevelopments(db, workspaceId);
      const obligationProfiles: DigestObligationProfile[] = rows.map((o) => ({
        obligationId: o.id,
        obligationName: o.name,
        requirementId: o.requirement_id,
        agency: o.agency,
        businessId: o.business_id,
      }));
      const changes = matchChangesForBusinesses(developments, businesses, obligationProfiles, lang);

      // SMARTPR NEEDS FROM YOU.
      const needsFromYou = buildNeedsFromYou(rows, lang);

      // COMPLIANCE HEALTH.
      const health = computeDigestHealth(rows);

      // Business label for the header.
      const distinctBusinesses = [...new Set(rows.map((o) => o.business_name))];
      const businessLabel =
        distinctBusinesses.length === 1
          ? distinctBusinesses[0]
          : lang === "es"
            ? `${distinctBusinesses.length} negocios`
            : `${distinctBusinesses.length} businesses`;

      const emailInput: DigestEmailInput = {
        lang,
        businessLabel,
        monthLabel: monthLabel(now, lang),
        userName: name,
        actionCount: actionRequired.length,
        upcomingCount: comingUp.length,
        changeCount: changes.length,
        actionRequired: actionRequired.slice(0, DIGEST_CAPS.action),
        comingUp: comingUp.slice(0, DIGEST_CAPS.coming),
        changes: changes.slice(0, DIGEST_CAPS.changes),
        needsFromYou: needsFromYou.slice(0, DIGEST_CAPS.needs),
        health,
        overflow: {
          action: Math.max(0, actionRequired.length - DIGEST_CAPS.action),
          coming: Math.max(0, comingUp.length - DIGEST_CAPS.coming),
          changes: Math.max(0, changes.length - DIGEST_CAPS.changes),
          needs: Math.max(0, needsFromYou.length - DIGEST_CAPS.needs),
        },
        dashboardUrl: `${site}/dashboard`,
        complianceCenterUrl: `${site}/compliance`,
        manageUrl: `${site}/settings`,
        unsubscribeUrl: `${site}/api/notifications/unsubscribe?token=${signUnsubscribeToken(ownerId)}&lang=${lang}`,
      };
      const built = buildDigestEmail(emailInput);
      const ok = await sendComplianceEmail(email, built.subject, built.text, built.html);
      if (!ok) {
        summary.errors.push(`digest send failed for workspace ${workspaceId}`);
        continue;
      }
      // Mark shown developments (only the ones actually included).
      const shownIds = emailInput.changes.map((c) => c.developmentId);
      for (const devId of new Set(shownIds)) {
        try {
          await db.query(
            `INSERT INTO regulatory_development_shows (development_id, workspace_id, period)
             VALUES ($1, $2, $3) ON CONFLICT (development_id, workspace_id) DO NOTHING`,
            [devId, workspaceId, period]
          );
        } catch {
          // Table not yet migrated — skip.
        }
      }
      // Idempotency: UNIQUE (workspace_id, period) — a concurrent run loses the race.
      const logged = await db.query(
        `INSERT INTO compliance_digest_log (workspace_id, user_id, period, item_count)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (workspace_id, period) DO NOTHING`,
        [workspaceId, ownerId, period, actionRequired.length + comingUp.length + needsFromYou.length]
      );
      if ((logged.rowCount ?? 0) > 0) summary.digests_sent += 1;
      else summary.skipped_already_sent += 1;
    } catch (err) {
      summary.errors.push(`workspace ${workspaceId}: ${(err as Error)?.message || err}`);
    }
  }
  return summary;
}
