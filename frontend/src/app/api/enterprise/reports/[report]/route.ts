// GET /api/enterprise/reports/[report]?workspace_id=<uuid>&format=json|csv|pdf
//   &from=YYYY-MM-DD&to=YYYY-MM-DD&<portfolio filters>
//
// Eight executive reports, all computed LIVE from the database:
//   readiness | deficiencies | deadlines | evidence-queue |
//   regulatory-impact | facility-comparison | workload | audit-activity
//
// Permissions: view_records by default; audit-activity requires
// view_audit_logs; workload requires assign_requirements OR view_records.
// Confidential fields (billing contact) are included only for view_billing
// holders and omitted entirely otherwise.
//
// Every generation AND export is written to audit_events
// (report_generated / report_exported). No invented agencies, deadlines, or
// sources: dates without a verified source are labeled "internal target".

import { getPool } from "../../../../graph/db";
import {
  requireEnterprisePermission,
  hasPermission,
  writeAuditEvent,
  getRequestMeta,
  type Permission,
} from "../../../../../lib/enterprise-permissions";
import {
  parsePortfolioFilters,
  describeFilters,
  obligationFilterClause,
  matterFilterClause,
  evidenceFilterClause,
  facilityFilterClause,
  regulatoryImpactFilterClause,
  type PortfolioFilters,
} from "../../../../../lib/enterprise-filters";
import { generateReportPdf, type PdfColumn } from "../../../../../lib/enterprise-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RECORDS = 5000;

export const REPORTS = [
  "readiness",
  "deficiencies",
  "deadlines",
  "evidence-queue",
  "regulatory-impact",
  "facility-comparison",
  "workload",
  "audit-activity",
] as const;
export type ReportKey = (typeof REPORTS)[number];

function isReportKey(v: string): v is ReportKey {
  return (REPORTS as readonly string[]).includes(v);
}

interface ReportColumn extends PdfColumn {}

interface BuiltReport {
  title: string;
  methodology: string[];
  summary: Array<{ label: string; value: string }>;
  columns: ReportColumn[];
  records: Array<Record<string, unknown>>;
  recordUrl: (r: Record<string, unknown>) => string | null;
  gatedFields: string[];
}

interface BuildCtx {
  pool: NonNullable<ReturnType<typeof getPool>>;
  workspaceId: string;
  filters: PortfolioFilters;
  from: string | null;
  to: string | null;
  canViewBilling: boolean;
  billingContact: string | null;
}

const bizUrl = (r: Record<string, unknown>): string | null =>
  r.business_public_id ? `/businesses/${r.business_public_id}` : null;

function pct(n: number): string {
  return `${n}%`;
}

/**
 * Parameterized from/to date-range clause (inclusive). Values are
 * pre-validated as YYYY-MM-DD by the handler, but we still bind them as
 * params rather than interpolating — never trust string concatenation into
 * SQL. `base` is the number of params already bound before this clause
 * ($1 is the workspace_id, then the filter-clause params).
 */
function dateRangeClause(
  colExpr: string,
  from: string | null,
  to: string | null,
  base: number,
  out: unknown[]
): string {
  const parts: string[] = [];
  if (from) {
    out.push(from);
    parts.push(`${colExpr} >= $${base + out.length}::date`);
  }
  if (to) {
    out.push(to);
    parts.push(`${colExpr} <= $${base + out.length}::date`);
  }
  return parts.length ? " AND " + parts.join(" AND ") : "";
}

// ---------------------------------------------------------------------------
// Report builders
// ---------------------------------------------------------------------------

async function buildReadiness(ctx: BuildCtx): Promise<BuiltReport> {
  const mc = matterFilterClause(ctx.filters);
  const { rows } = await ctx.pool.query(
    `SELECT m.id::text AS id, m.title AS project, m.status,
            m.readiness_score AS readiness,
            m.due_date::text AS due_date, m.due_date_source,
            COALESCE(b.legal_name, b.name) AS business,
            b.municipality, b.public_id AS business_public_id,
            (SELECT COUNT(*)::int FROM obligations o WHERE o.matter_id = m.id AND o.status <> 'COMPLETED') AS open_requirements,
            (SELECT COUNT(*)::int FROM obligations o WHERE o.matter_id = m.id AND o.status = 'COMPLETED') AS completed_requirements
       FROM matters m
       JOIN businesses b ON b.id = m.business_id
      WHERE m.workspace_id = $1 AND m.status <> 'ARCHIVED' AND b.archived = false${mc.sql}
      ORDER BY m.readiness_score NULLS LAST, m.title`,
    [ctx.workspaceId, ...mc.params]
  );
  const records = rows.slice(0, MAX_RECORDS).map((r) => ({
    ...r,
    due_date_label:
      typeof r.due_date_source === "string" && /verif/i.test(r.due_date_source)
        ? "verified"
        : "internal target",
  }));
  const scored = records.filter((r) => r.readiness !== null);
  const avg = scored.length
    ? Math.round(scored.reduce((s, r) => s + Number(r.readiness), 0) / scored.length)
    : null;
  return {
    title: "Portfolio Readiness Report",
    methodology: [
      "One record per active project (matter). Readiness is the stored matter readiness_score (0–100); the portfolio average excludes projects without a score.",
      "Open/completed requirement counts come from live obligation records.",
      "Project due dates without a verified source are labeled “internal target” and must not be treated as filing deadlines.",
      "Applies the portfolio filters passed with the request; unfiltered runs cover the whole workspace.",
    ],
    summary: [
      { label: "Projects", value: String(records.length) },
      { label: "Average readiness", value: avg === null ? "—" : pct(avg) },
      {
        label: "Ready (≥90)",
        value: String(records.filter((r) => Number(r.readiness) >= 90).length),
      },
      {
        label: "Needs work (<70)",
        value: String(records.filter((r) => r.readiness === null || Number(r.readiness) < 70).length),
      },
    ],
    columns: [
      { key: "project", label: "Project", w: 3 },
      { key: "business", label: "Business", w: 3 },
      { key: "municipality", label: "Municipality", w: 2 },
      { key: "status", label: "Status", w: 2 },
      { key: "readiness", label: "Readiness", w: 1 },
      { key: "open_requirements", label: "Open reqs", w: 1 },
      { key: "due_date", label: "Due date", w: 2 },
      { key: "due_date_label", label: "Date basis", w: 2 },
    ],
    records,
    recordUrl: (r) => bizUrl(r) ?? `/enterprise/work?project=${r.id}`,
    gatedFields: [],
  };
}

async function buildDeficiencies(ctx: BuildCtx): Promise<BuiltReport> {
  const oc = obligationFilterClause(ctx.filters);
  const { rows } = await ctx.pool.query(
    `SELECT o.id::text AS id, o.name AS requirement, o.agency, o.status,
            COALESCE(b.legal_name, b.name) AS business,
            b.municipality, b.public_id AS business_public_id,
            m.title AS project,
            COALESCE(ow.priority, 'medium') AS priority,
            COALESCE(ow.work_status, 'not_started') AS work_status,
            ow.department, u.name AS owner,
            COALESCE(ow.internal_due_date, o.due_date)::text AS due_date,
            o.due_date_source
       FROM obligations o
       JOIN businesses b ON b.id = o.business_id
       LEFT JOIN obligation_work ow ON ow.obligation_id = o.id
       LEFT JOIN matters m ON m.id = o.matter_id
       LEFT JOIN users u ON u.id = ow.owner_user_id
      WHERE b.workspace_id = $1 AND b.archived = false
        AND o.status <> 'COMPLETED'
        AND COALESCE(ow.priority, 'medium') IN ('critical', 'high')${oc.sql}
      ORDER BY CASE COALESCE(ow.priority, 'medium')
                 WHEN 'critical' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,
               COALESCE(ow.internal_due_date, o.due_date) NULLS LAST`,
    [ctx.workspaceId, ...oc.params]
  );
  const records = rows.slice(0, MAX_RECORDS).map((r) => ({
    ...r,
    due_date_label:
      typeof r.due_date_source === "string" && /verif/i.test(r.due_date_source)
        ? "verified"
        : "internal target",
  }));
  return {
    title: "Critical & High-Priority Deficiencies",
    methodology: [
      "Deficiency = an open requirement (status ≠ COMPLETED) with workflow priority critical or high.",
      "Priority lives on the internal workflow record (obligation_work); it reflects the organization's own triage, not a government severity rating.",
      "Due dates without a verified source are labeled “internal target”.",
    ],
    summary: [
      { label: "Deficiencies", value: String(records.length) },
      {
        label: "Critical",
        value: String(records.filter((r) => r.priority === "critical").length),
      },
      {
        label: "High",
        value: String(records.filter((r) => r.priority === "high").length),
      },
      {
        label: "Without owner",
        value: String(records.filter((r) => !r.owner).length),
      },
    ],
    columns: [
      { key: "requirement", label: "Requirement", w: 3 },
      { key: "business", label: "Business", w: 2 },
      { key: "agency", label: "Agency", w: 2 },
      { key: "priority", label: "Priority", w: 1 },
      { key: "owner", label: "Owner", w: 2 },
      { key: "work_status", label: "Work status", w: 2 },
      { key: "due_date", label: "Due date", w: 2 },
      { key: "due_date_label", label: "Date basis", w: 2 },
    ],
    records,
    recordUrl: (r) => bizUrl(r) ?? `/enterprise/work?view=critical`,
    gatedFields: [],
  };
}

async function buildDeadlines(ctx: BuildCtx): Promise<BuiltReport> {
  const oc = obligationFilterClause(ctx.filters);
  const base = 1 + oc.params.length; // $1 = workspace_id
  const oblExtra: unknown[] = [];
  const range = dateRangeClause(
    "COALESCE(ow.internal_due_date, o.due_date)",
    ctx.from,
    ctx.to,
    base,
    oblExtra
  );
  const obl = await ctx.pool.query(
    `SELECT o.id::text AS id, o.name AS item, o.status,
            COALESCE(b.legal_name, b.name) AS business,
            b.public_id AS business_public_id,
            COALESCE(ow.internal_due_date, o.due_date)::text AS due_date,
            CASE WHEN ow.internal_due_date IS NOT NULL THEN 'internal target'
                 WHEN o.due_date_source ILIKE '%verif%' THEN 'verified'
                 ELSE 'internal target' END AS date_label,
            COALESCE(ow.priority, 'medium') AS priority,
            u.name AS owner, 'obligation' AS kind
       FROM obligations o
       JOIN businesses b ON b.id = o.business_id
       LEFT JOIN obligation_work ow ON ow.obligation_id = o.id
       LEFT JOIN matters m ON m.id = o.matter_id
       LEFT JOIN users u ON u.id = ow.owner_user_id
      WHERE b.workspace_id = $1 AND b.archived = false
        AND o.status <> 'COMPLETED'
        AND COALESCE(ow.internal_due_date, o.due_date) IS NOT NULL${range}${oc.sql}`,
    [ctx.workspaceId, ...oc.params, ...oblExtra]
  );
  // Verified renewal schedules (Phase 4 deadline engine data).
  const schExtra: unknown[] = [];
  const sRange = dateRangeClause("ds.due_date", ctx.from, ctx.to, base, schExtra);
  const sch = await ctx.pool.query(
    `SELECT ds.id::text AS id,
            COALESCE(ds.label, o.name, 'Renewal') AS item,
            'SCHEDULED' AS status,
            COALESCE(b.legal_name, b.name) AS business,
            b.public_id AS business_public_id,
            ds.due_date::text AS due_date,
            CASE WHEN ds.is_verified THEN 'verified' ELSE 'internal target' END AS date_label,
            COALESCE(ow.priority, 'medium') AS priority,
            u.name AS owner, 'renewal schedule' AS kind
       FROM deadline_schedules ds
       LEFT JOIN obligations o ON o.id = ds.obligation_id
       LEFT JOIN businesses b ON b.id = o.business_id
       LEFT JOIN obligation_work ow ON ow.obligation_id = o.id
       LEFT JOIN matters m ON m.id = o.matter_id
       LEFT JOIN users u ON u.id = ow.owner_user_id
      WHERE ds.workspace_id = $1
        AND (o.id IS NULL OR (b.workspace_id = $1 AND b.archived = false))${sRange}${oc.sql}`,
    [ctx.workspaceId, ...oc.params, ...schExtra]
  );
  const today = new Date().toISOString().slice(0, 10);
  const records = [...obl.rows, ...sch.rows]
    .slice(0, MAX_RECORDS)
    .map((r) => ({
      ...r,
      days_until: r.due_date
        ? Math.round((new Date(String(r.due_date)).getTime() - new Date(today).getTime()) / 86400000)
        : null,
    }))
    .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));
  return {
    title: "Upcoming Deadlines & Overdue Actions",
    methodology: [
      "Combines open obligation due dates with verified renewal schedules (deadline_schedules).",
      "Effective obligation date = internal workflow due date, falling back to the obligation due date.",
      "A date is labeled “verified” only when it comes from a verified schedule or a verified obligation source; all other dates are internal targets, not government deadlines.",
      "“Days until” is computed against the report generation date.",
    ],
    summary: [
      { label: "Tracked dates", value: String(records.length) },
      {
        label: "Overdue",
        value: String(records.filter((r) => Number(r.days_until) < 0).length),
      },
      {
        label: "Due within 30 days",
        value: String(
          records.filter((r) => Number(r.days_until) >= 0 && Number(r.days_until) <= 30).length
        ),
      },
      {
        label: "Verified dates",
        value: String(records.filter((r) => r.date_label === "verified").length),
      },
    ],
    columns: [
      { key: "item", label: "Item", w: 3 },
      { key: "business", label: "Business", w: 2 },
      { key: "due_date", label: "Due date", w: 2 },
      { key: "date_label", label: "Date basis", w: 2 },
      { key: "days_until", label: "Days until", w: 1 },
      { key: "priority", label: "Priority", w: 1 },
      { key: "owner", label: "Owner", w: 2 },
      { key: "kind", label: "Kind", w: 2 },
    ],
    records,
    recordUrl: (r) => bizUrl(r) ?? `/enterprise/work?view=due`,
    gatedFields: [],
  };
}

async function buildEvidenceQueue(ctx: BuildCtx): Promise<BuiltReport> {
  const ec = evidenceFilterClause(ctx.filters);
  const base = 1 + ec.params.length; // $1 = workspace_id
  const extra: unknown[] = [];
  const rangeParts: string[] = [];
  if (ctx.from) {
    extra.push(ctx.from);
    rangeParts.push(`e.created_at >= $${base + extra.length}::date`);
  }
  if (ctx.to) {
    extra.push(ctx.to);
    rangeParts.push(`e.created_at < ($${base + extra.length}::date + INTERVAL '1 day')`);
  }
  const range = rangeParts.length ? " AND " + rangeParts.join(" AND ") : "";
  const { rows } = await ctx.pool.query(
    `SELECT e.id::text AS id, e.original_filename AS document,
            e.enterprise_state AS state, e.review_status,
            e.created_at::text AS submitted_at,
            COALESCE(b.legal_name, b.name) AS business,
            b.public_id AS business_public_id,
            o.name AS requirement, u.name AS uploaded_by
       FROM evidence e
       JOIN businesses b ON b.id = e.business_id
       LEFT JOIN obligations o ON o.id = e.obligation_id
       LEFT JOIN users u ON u.id = e.user_id
      WHERE b.workspace_id = $1 AND b.archived = false
        AND e.enterprise_state IN ('submitted_for_review', 'under_review', 'changes_requested', 'draft')${range}${ec.sql}
      ORDER BY e.created_at`,
    [ctx.workspaceId, ...ec.params, ...extra]
  );
  const records = rows.slice(0, MAX_RECORDS);
  const byState = (s: string) => records.filter((r) => r.state === s).length;
  return {
    title: "Evidence Review Queue",
    methodology: [
      "Evidence in an actionable workflow state: submitted_for_review, under_review, changes_requested, or draft.",
      "Approved, rejected, superseded, and expired items are excluded — they are terminal states, not queue items.",
      "“Submitted” is the upload timestamp (created_at), not a reviewer action timestamp.",
    ],
    summary: [
      { label: "Queued items", value: String(records.length) },
      { label: "Awaiting review", value: String(byState("submitted_for_review") + byState("under_review")) },
      { label: "Changes requested", value: String(byState("changes_requested")) },
      { label: "Drafts", value: String(byState("draft")) },
    ],
    columns: [
      { key: "document", label: "Document", w: 3 },
      { key: "business", label: "Business", w: 2 },
      { key: "requirement", label: "Requirement", w: 2 },
      { key: "state", label: "State", w: 2 },
      { key: "submitted_at", label: "Submitted", w: 2 },
      { key: "uploaded_by", label: "Uploaded by", w: 2 },
    ],
    records,
    recordUrl: (r) => bizUrl(r) ?? `/enterprise/work?view=reviews`,
    gatedFields: [],
  };
}

async function buildRegulatoryImpact(ctx: BuildCtx): Promise<BuiltReport> {
  const extra: unknown[] = [];
  const range = dateRangeClause(
    "COALESCE(re.verification_date::date, re.effective_date)",
    ctx.from,
    ctx.to,
    1, // $1 = workspace_id, no filter-clause params in this report
    extra
  );
  const riClause = regulatoryImpactFilterClause(ctx.filters);
  // riClause placeholders start at $2 ($1 = workspace_id); shift them past the
  // date-range params already accumulated in extra.
  const shift = extra.length;
  const riSql = riClause.sql.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + shift}`);
  const { rows } = await ctx.pool.query(
    `SELECT re.id::text AS event_id, re.title AS change, re.lifecycle,
            re.regulatory_source AS source,
            re.effective_date::text AS effective_date,
            re.verification_date::text AS verification_date,
            f.name AS facility,
            COALESCE(b.legal_name, b.name) AS business,
            o.name AS requirement,
            ri.required_action, ri.ack_status, ri.implementation_status
       FROM regulatory_events re
       LEFT JOIN regulatory_impacts ri ON ri.event_id = re.id AND ri.workspace_id = $1
       LEFT JOIN facilities f ON f.id = ri.facility_id
       LEFT JOIN businesses b ON b.id = ri.business_id
       LEFT JOIN obligations o ON o.id = ri.obligation_id
      WHERE (re.workspace_id = $1 OR re.workspace_id IS NULL)
        AND re.verification_date IS NOT NULL${range}${riSql}
      ORDER BY re.verification_date DESC NULLS LAST, re.created_at DESC`,
    [ctx.workspaceId, ...extra, ...riClause.params]
  );
  const records = rows.slice(0, MAX_RECORDS).map((r) => ({
    ...r,
    verified: r.verification_date ? "yes" : "no",
  }));
  const events = new Set(records.map((r) => String(r.event_id))).size;
  return {
    title: "Regulatory Change Impact Report",
    methodology: [
      "Sources are the organization's own reviewed regulatory events — never invented. Unverified detections are excluded.",
      "One record per event × impacted entity (facility, business, or requirement). Events with no mapped impact yet appear with empty impact columns.",
      "Acknowledgment and implementation status reflect the internal remediation workflow, not government confirmation.",
      "Portfolio filters for business, facility, municipality, and agency narrow the impacted entities shown. Workflow filters (status, priority, owner, department, dates, project, domain) do not apply to this report's event × entity grain.",
    ],
    summary: [
      { label: "Regulatory events", value: String(events) },
      { label: "Impact mappings", value: String(records.filter((r) => r.required_action).length) },
      {
        label: "Pending acknowledgment",
        value: String(records.filter((r) => r.ack_status === "pending").length),
      },
      {
        label: "Implemented",
        value: String(records.filter((r) => r.implementation_status === "implemented").length),
      },
    ],
    columns: [
      { key: "change", label: "Change", w: 3 },
      { key: "lifecycle", label: "Lifecycle", w: 2 },
      { key: "effective_date", label: "Effective", w: 2 },
      { key: "facility", label: "Facility", w: 2 },
      { key: "requirement", label: "Requirement", w: 2 },
      { key: "ack_status", label: "Ack", w: 1 },
      { key: "implementation_status", label: "Implementation", w: 2 },
    ],
    records,
    recordUrl: (r) => `/enterprise/regulatory/${r.event_id}`,
    gatedFields: [],
  };
}

async function buildFacilityComparison(ctx: BuildCtx): Promise<BuiltReport> {
  const fc = facilityFilterClause(ctx.filters);
  const { rows } = await ctx.pool.query(
    `SELECT f.id::text AS id, f.name AS facility, f.municipality,
            f.business_id::text AS business_id,
            COALESCE(b.legal_name, b.name) AS business,
            b.public_id AS business_public_id,
            (SELECT COUNT(*)::int FROM obligations o WHERE o.business_id = f.business_id AND o.status <> 'COMPLETED') AS open_requirements,
            (SELECT COUNT(*)::int FROM obligations o WHERE o.business_id = f.business_id AND o.status = 'COMPLETED') AS completed_requirements,
            (SELECT COUNT(*)::int FROM obligations o LEFT JOIN obligation_work ow ON ow.obligation_id = o.id
              WHERE o.business_id = f.business_id AND o.status <> 'COMPLETED'
                AND COALESCE(ow.priority, 'medium') = 'critical'
                AND COALESCE(ow.work_status, 'not_started') NOT IN ('approved', 'completed')) AS critical_deficiencies,
            (SELECT COUNT(*)::int FROM obligations o LEFT JOIN obligation_work ow ON ow.obligation_id = o.id
              WHERE o.business_id = f.business_id AND o.status <> 'COMPLETED'
                AND COALESCE(ow.internal_due_date, o.due_date) < CURRENT_DATE) AS overdue,
            (SELECT ROUND(AVG(m.readiness_score))::int FROM matters m
              WHERE m.business_id = f.business_id AND m.status <> 'ARCHIVED' AND m.readiness_score IS NOT NULL) AS readiness
       FROM facilities f
       LEFT JOIN businesses b ON b.id = f.business_id
      WHERE f.workspace_id = $1${fc.sql}
      ORDER BY f.name`,
    [ctx.workspaceId, ...fc.params]
  );
  const records = rows.slice(0, MAX_RECORDS);
  const withReadiness = records.filter((r) => r.readiness !== null);
  return {
    title: "Facility Comparison",
    methodology: [
      "Facilities roll up the obligations and project readiness of their linked business. Facilities without a business link show requirement counts of zero and no readiness score.",
      "Readiness is the average of linked projects' stored readiness scores; projects without a score are excluded.",
      "Overdue counts use the effective due date (internal workflow date, else obligation date) and include internal targets.",
      "Portfolio filters for business, facility, and municipality narrow the facilities compared.",
    ],
    summary: [
      { label: "Facilities", value: String(records.length) },
      {
        label: "Avg readiness",
        value: withReadiness.length
          ? pct(Math.round(withReadiness.reduce((s, r) => s + Number(r.readiness), 0) / withReadiness.length))
          : "—",
      },
      {
        label: "Total open requirements",
        value: String(records.reduce((s, r) => s + Number(r.open_requirements || 0), 0)),
      },
      {
        label: "Total critical deficiencies",
        value: String(records.reduce((s, r) => s + Number(r.critical_deficiencies || 0), 0)),
      },
    ],
    columns: [
      { key: "facility", label: "Facility", w: 3 },
      { key: "municipality", label: "Municipality", w: 2 },
      { key: "business", label: "Business", w: 2 },
      { key: "readiness", label: "Readiness", w: 1 },
      { key: "open_requirements", label: "Open", w: 1 },
      { key: "overdue", label: "Overdue", w: 1 },
      { key: "critical_deficiencies", label: "Critical", w: 1 },
    ],
    records,
    recordUrl: (r) => `/enterprise/work?facility=${r.id}`,
    gatedFields: [],
  };
}

async function buildWorkload(ctx: BuildCtx): Promise<BuiltReport> {
  const oc = obligationFilterClause(ctx.filters);
  const { rows } = await ctx.pool.query(
    `SELECT u.id::text AS id, u.name AS owner, u.email,
            ow.department,
            COUNT(*)::int AS assigned,
            SUM(CASE WHEN o.status = 'COMPLETED' THEN 1 ELSE 0 END)::int AS completed,
            SUM(CASE WHEN o.status <> 'COMPLETED'
                      AND COALESCE(ow.internal_due_date, o.due_date) < CURRENT_DATE
                    THEN 1 ELSE 0 END)::int AS overdue,
            SUM(CASE WHEN o.status <> 'COMPLETED'
                      AND COALESCE(ow.priority, 'medium') = 'critical'
                      AND COALESCE(ow.work_status, 'not_started') NOT IN ('approved', 'completed')
                    THEN 1 ELSE 0 END)::int AS critical
       FROM obligation_work ow
       JOIN obligations o ON o.id = ow.obligation_id
       JOIN businesses b ON b.id = o.business_id
       LEFT JOIN matters m ON m.id = o.matter_id
       JOIN users u ON u.id = ow.owner_user_id
      WHERE b.workspace_id = $1 AND b.archived = false
        AND ow.owner_user_id IS NOT NULL${oc.sql}
      GROUP BY u.id, u.name, u.email, ow.department
      ORDER BY overdue DESC, critical DESC, assigned DESC`,
    [ctx.workspaceId, ...oc.params]
  );
  const records = rows.slice(0, MAX_RECORDS).map((r) => ({
    ...r,
    completion_pct:
      Number(r.assigned) > 0 ? Math.round((Number(r.completed) / Number(r.assigned)) * 100) : null,
  }));
  const gatedFields: string[] = [];
  const summary: Array<{ label: string; value: string }> = [
    { label: "Owners with assignments", value: String(records.length) },
    {
      label: "Total assigned",
      value: String(records.reduce((s, r) => s + Number(r.assigned || 0), 0)),
    },
    {
      label: "Total overdue",
      value: String(records.reduce((s, r) => s + Number(r.overdue || 0), 0)),
    },
  ];
  // Confidential: billing contact is visible only to view_billing holders.
  if (ctx.canViewBilling && ctx.billingContact) {
    summary.push({ label: "Billing contact", value: ctx.billingContact });
  } else {
    gatedFields.push(
      "billing_contact (requires the view_billing permission — omitted from this report)"
    );
  }
  return {
    title: "Workload by Owner & Department",
    methodology: [
      "One record per person with at least one owned requirement in scope. Ownership comes from the internal workflow record (obligation_work.owner_user_id).",
      "Completion % = completed ÷ assigned across all in-scope requirements for that owner.",
      "The billing contact line is confidential: it is included only when the requester holds the view_billing permission.",
    ],
    summary,
    columns: [
      { key: "owner", label: "Owner", w: 2 },
      { key: "email", label: "Email", w: 3 },
      { key: "department", label: "Department", w: 2 },
      { key: "assigned", label: "Assigned", w: 1 },
      { key: "completed", label: "Done", w: 1 },
      { key: "completion_pct", label: "Done %", w: 1 },
      { key: "overdue", label: "Overdue", w: 1 },
      { key: "critical", label: "Critical", w: 1 },
    ],
    records,
    recordUrl: (r) => `/enterprise/work?owner=${r.id}`,
    gatedFields,
  };
}

async function buildAuditActivity(ctx: BuildCtx): Promise<BuiltReport> {
  const extra: unknown[] = [];
  const rangeParts: string[] = [];
  if (ctx.from) {
    extra.push(ctx.from);
    rangeParts.push(`ae.created_at >= $${1 + extra.length}::date`);
  }
  if (ctx.to) {
    extra.push(ctx.to);
    rangeParts.push(`ae.created_at < ($${1 + extra.length}::date + INTERVAL '1 day')`);
  }
  const range = rangeParts.length ? " AND " + rangeParts.join(" AND ") : "";
  const { rows } = await ctx.pool.query(
    `SELECT ae.id::text AS id, ae.created_at::text AS timestamp,
            u.email AS actor_email, u.name AS actor_name,
            ae.action, ae.target_type, ae.target_id,
            ae.ip, ae.user_agent, ae.source, ae.reason
       FROM audit_events ae
       LEFT JOIN users u ON u.id = ae.actor_user_id
      WHERE ae.workspace_id = $1${range}
      ORDER BY ae.created_at DESC
      LIMIT 1000`,
    [ctx.workspaceId, ...extra]
  );
  const records = rows.slice(0, MAX_RECORDS);
  const actions = new Set(records.map((r) => String(r.action))).size;
  return {
    title: "Audit Activity",
    methodology: [
      "Append-only audit trail (audit_events). UPDATE/DELETE on this table is blocked by a database trigger, so records shown here cannot have been altered.",
      "Actor IPs and user agents are shown because this report requires the view_audit_logs permission.",
      "Limited to the 1,000 most recent events in range.",
    ],
    summary: [
      { label: "Events", value: String(records.length) },
      { label: "Distinct actions", value: String(actions) },
      {
        label: "Report exports",
        value: String(records.filter((r) => String(r.action).startsWith("report_")).length),
      },
    ],
    columns: [
      { key: "timestamp", label: "Timestamp", w: 2 },
      { key: "actor_email", label: "Actor", w: 2 },
      { key: "action", label: "Action", w: 2 },
      { key: "target_type", label: "Target", w: 1 },
      { key: "target_id", label: "Target ID", w: 2 },
      { key: "ip", label: "IP", w: 2 },
      { key: "source", label: "Source", w: 1 },
    ],
    records,
    recordUrl: () => `/enterprise/admin`,
    gatedFields: [],
  };
}

const BUILDERS: Record<ReportKey, (ctx: BuildCtx) => Promise<BuiltReport>> = {
  readiness: buildReadiness,
  deficiencies: buildDeficiencies,
  deadlines: buildDeadlines,
  "evidence-queue": buildEvidenceQueue,
  "regulatory-impact": buildRegulatoryImpact,
  "facility-comparison": buildFacilityComparison,
  workload: buildWorkload,
  "audit-activity": buildAuditActivity,
};

/** Permission needed per report (workload accepts assign_requirements OR view_records). */
function requiredPermission(report: ReportKey): Permission | "assign_or_view" {
  if (report === "audit-activity") return "view_audit_logs";
  if (report === "workload") return "assign_or_view";
  return "view_records";
}

function toCsv(columns: ReportColumn[], records: Array<Record<string, unknown>>): string {
  const esc = (v: unknown): string => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map((c) => esc(c.label)).join(",")];
  for (const r of records) lines.push(columns.map((c) => esc(r[c.key])).join(","));
  return lines.join("\r\n");
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function GET(
  req: Request,
  { params }: { params: Promise<{ report: string }> }
) {
  const { report: rawReport } = await params;
  if (!isReportKey(rawReport)) {
    return Response.json(
      { error: "unknown_report", valid: [...REPORTS] },
      { status: 404 }
    );
  }
  const report = rawReport;

  const url = new URL(req.url);
  const workspaceId = (url.searchParams.get("workspace_id") || "").trim();
  if (!UUID_RE.test(workspaceId)) {
    return Response.json({ error: "workspace_id is required (uuid)" }, { status: 400 });
  }
  const format = (url.searchParams.get("format") || "json").toLowerCase();
  if (!["json", "csv", "pdf"].includes(format)) {
    return Response.json({ error: "invalid_format", valid: ["json", "csv", "pdf"] }, { status: 400 });
  }
  const from = (url.searchParams.get("from") || "").trim() || null;
  const to = (url.searchParams.get("to") || "").trim() || null;
  if ((from && !DATE_RE.test(from)) || (to && !DATE_RE.test(to))) {
    return Response.json({ error: "invalid_date", detail: "from/to must be YYYY-MM-DD" }, { status: 400 });
  }
  if (from && to && from > to) {
    return Response.json({ error: "invalid_range", detail: "from is after to" }, { status: 400 });
  }
  const { filters, errors } = parsePortfolioFilters(url.searchParams);
  if (errors.length > 0) {
    return Response.json({ error: "invalid_filters", details: errors }, { status: 400 });
  }

  // Permission gate per report.
  const needed = requiredPermission(report);
  let gate;
  if (needed === "assign_or_view") {
    gate = await requireEnterprisePermission("view_records", workspaceId);
    if ("response" in gate) {
      const fallback = await requireEnterprisePermission("assign_requirements", workspaceId);
      if ("response" in fallback) return fallback.response;
      gate = fallback;
    }
  } else {
    gate = await requireEnterprisePermission(needed, workspaceId);
    if ("response" in gate) return gate.response;
  }
  const { user } = gate;

  const pool = getPool();
  if (!pool) return Response.json({ error: "db_unavailable" }, { status: 503 });

  const generatedAt = new Date();
  const applied = describeFilters(filters);

  try {
    // Branding for PDFs.
    let orgName = "SmartPR";
    let primaryColor = "#245c5c";
    try {
      const b = await pool.query(
        `SELECT wb.company_name, wb.primary_color, w.name AS workspace_name
           FROM workspaces w LEFT JOIN workspace_branding wb ON wb.workspace_id = w.id
          WHERE w.id = $1`,
        [workspaceId]
      );
      const row = b.rows[0];
      if (row) {
        orgName =
          (row.company_name as string | null) ||
          (row.workspace_name as string | null) ||
          "SmartPR";
        if (typeof row.primary_color === "string" && /^#?[0-9a-fA-F]{6}$/.test(row.primary_color)) {
          primaryColor = row.primary_color.startsWith("#") ? row.primary_color : `#${row.primary_color}`;
        }
      }
    } catch {
      // branding lookup is best-effort
    }

    // Billing contact (confidential — view_billing only).
    const canViewBilling = await hasPermission(user.id, workspaceId, "view_billing", undefined, { pool }).catch(
      () => false
    );
    let billingContact: string | null = null;
    if (canViewBilling) {
      try {
        const s = await pool.query(
          `SELECT owner_email FROM workspace_subscriptions WHERE workspace_id = $1 LIMIT 1`,
          [workspaceId]
        );
        billingContact = (s.rows[0]?.owner_email as string | null) ?? null;
      } catch {
        billingContact = null;
      }
    }

    const built = await BUILDERS[report]({
      pool,
      workspaceId,
      filters,
      from,
      to,
      canViewBilling,
      billingContact,
    });

    // Audit only AFTER the report/export payload is successfully built —
    // a failed generation must not leave a "report_exported" audit trail.
    const meta = getRequestMeta(req);
    const auditReport = (action: string) =>
      writeAuditEvent(pool, {
        actorUserId: user.id,
        workspaceId,
        action,
        targetType: "report",
        targetId: report,
        after: {
          report,
          format,
          record_count: built.records.length,
          filters_applied: applied,
          date_range: from || to ? { from, to } : null,
          gated_fields: built.gatedFields,
        },
        ip: meta.ip,
        userAgent: meta.userAgent,
        correlationId: meta.correlationId,
        source: "api",
      });

    const stamp = generatedAt.toISOString().slice(0, 10);
    const baseName = `smartpr-${report}-${stamp}`;

    if (format === "csv") {
      const csv = toCsv(built.columns, built.records);
      await auditReport("report_exported");
      return new Response(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${baseName}.csv"`,
        },
      });
    }

    if (format === "pdf") {
      const bytes = await generateReportPdf({
        orgName,
        primaryColor,
        reportTitle: built.title,
        generatedAt,
        dataAsOf: generatedAt,
        filtersApplied: applied,
        methodology: built.methodology,
        summary: built.summary,
        columns: built.columns,
        records: built.records,
        recordUrl: built.recordUrl,
        confidentialityNote:
          "Confidential — prepared for internal compliance use. Dates labeled “internal target” are organizational targets, not verified government deadlines. Verify requirements against official sources before filing.",
      });
      await auditReport("report_exported");
      return new Response(Buffer.from(bytes), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${baseName}.pdf"`,
        },
      });
    }

    await auditReport("report_generated");
    return Response.json({
      report,
      title: built.title,
      workspace_id: workspaceId,
      generated_at: generatedAt.toISOString(),
      data_as_of: generatedAt.toISOString(),
      filters_applied: applied,
      date_range: { from, to },
      methodology: built.methodology,
      summary: built.summary,
      columns: built.columns.map((c) => ({ key: c.key, label: c.label })),
      records: built.records.map((r) => ({ ...r, record_url: built.recordUrl(r) })),
      record_count: built.records.length,
      gated_fields: built.gatedFields,
    });
  } catch (error) {
    console.error(`[enterprise-reports/${report}]`, (error as Error).message);
    return Response.json({ error: "query_failed" }, { status: 500 });
  }
}
