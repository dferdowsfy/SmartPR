// GET /api/enterprise/portfolio?workspace_id=<uuid>&<portfolio filters>
// Phase 3 portfolio dashboard API. Every metric is computed LIVE from the
// database — no hard-coded totals. Workspace-scoped via ?workspace_id,
// validated against membership, gated on the "view_records" permission.
//
// Definitions:
// - Open requirement: obligations.status <> 'COMPLETED'.
// - Effective due date: COALESCE(obligation_work.internal_due_date,
//   obligations.due_date). Internal targets (unverified) are labeled as such.
// - Critical deficiency: priority='critical' AND work_status NOT IN
//   ('approved','completed') AND obligation not COMPLETED.
// - Evidence awaiting review: evidence.enterprise_state IN
//   ('submitted_for_review','under_review').
// - Verified date: deadline_schedules.is_verified = true, or an obligation
//   due_date whose due_date_source indicates verification. Everything else
//   is an internal target.

import { getPool } from "../../../graph/db";
import {
  requireEnterprisePermission,
  writeAuditEvent,
  getRequestMeta,
} from "../../../../lib/enterprise-permissions";
import {
  parsePortfolioFilters,
  describeFilters,
  obligationFilterClause,
  matterFilterClause,
  businessFilterClause,
  facilityFilterClause,
  evidenceFilterClause,
  filtersToSearchParams,
  type PortfolioFilters,
} from "../../../../lib/enterprise-filters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const ACTIVE_MATTER_STATUSES = ["DRAFT", "IN_PROGRESS", "NEEDS_ATTENTION", "READY"];

interface Metric {
  key: string;
  label: string;
  value: number | null;
  href: string;
  note?: string;
}

/** /enterprise/work deep link preserving the active portfolio filters. */
function workHref(view: string, f: PortfolioFilters, extra?: string): string {
  const params = filtersToSearchParams(f);
  params.set("view", view);
  const qs = params.toString();
  return `/enterprise/work?${qs}${extra ? `&${extra}` : ""}`;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(a).getTime() - new Date(b).getTime()) / 86400000);
}

function isVerifiedDateSource(source: unknown): boolean {
  return typeof source === "string" && /verif/i.test(source);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const workspaceId = (url.searchParams.get("workspace_id") || "").trim();
  if (!UUID_RE.test(workspaceId)) {
    return Response.json({ error: "workspace_id is required (uuid)" }, { status: 400 });
  }
  const { filters, errors } = parsePortfolioFilters(url.searchParams);
  if (errors.length > 0) {
    return Response.json({ error: "invalid_filters", details: errors }, { status: 400 });
  }

  const gate = await requireEnterprisePermission("view_records", workspaceId);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  const pool = getPool();
  if (!pool) return Response.json({ error: "db_unavailable" }, { status: 503 });

  const generatedAt = new Date().toISOString();
  const today = todayStr();
  const oClause = obligationFilterClause(filters);
  const mClause = matterFilterClause(filters);
  const bClause = businessFilterClause(filters);
  const fClause = facilityFilterClause(filters);
  const eClause = evidenceFilterClause(filters);
  const applied = describeFilters(filters);

  try {
    // ---- 1. Filtered obligations (the analytical base) --------------------
    const obl = await pool.query(
      `SELECT o.id::text AS id, o.business_id::text AS business_id,
              o.matter_id::text AS matter_id, o.name, o.agency, o.status,
              o.due_date::text AS due_date, o.due_date_source,
              COALESCE(b.legal_name, b.name) AS business_name,
              b.municipality, b.public_id AS business_public_id,
              m.title AS matter_title,
              ow.owner_user_id::text AS owner_user_id,
              ow.department,
              COALESCE(ow.priority, 'medium') AS priority,
              ow.internal_due_date::text AS internal_due_date,
              COALESCE(ow.work_status, 'not_started') AS work_status,
              u.name AS owner_name, u.email AS owner_email
         FROM obligations o
         JOIN businesses b ON b.id = o.business_id
         LEFT JOIN obligation_work ow ON ow.obligation_id = o.id
         LEFT JOIN matters m ON m.id = o.matter_id
         LEFT JOIN users u ON u.id = ow.owner_user_id
        WHERE b.workspace_id = $1 AND b.archived = false${oClause.sql}`,
      [workspaceId, ...oClause.params]
    );

    // ---- 2. Businesses, facilities, matters, evidence, renewals ------------
    const [bizRows, facRows, matRows, evRows, renRows] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS n FROM businesses b
          WHERE b.workspace_id = $1 AND b.archived = false${bClause.sql}`,
        [workspaceId, ...bClause.params]
      ),
      pool.query(
        `SELECT f.id::text AS id, f.name, f.municipality,
                f.business_id::text AS business_id,
                COALESCE(b.legal_name, b.name) AS business_name
           FROM facilities f
           LEFT JOIN businesses b ON b.id = f.business_id
          WHERE f.workspace_id = $1${fClause.sql}
          ORDER BY f.name`,
        [workspaceId, ...fClause.params]
      ),
      pool.query(
        `SELECT m.id::text AS id, m.business_id::text AS business_id,
                m.title, m.status, m.readiness_score,
                m.due_date::text AS due_date, m.due_date_source,
                COALESCE(b.legal_name, b.name) AS business_name, b.municipality
           FROM matters m
           JOIN businesses b ON b.id = m.business_id
          WHERE m.workspace_id = $1 AND m.status <> 'ARCHIVED'
            AND b.archived = false${mClause.sql}`,
        [workspaceId, ...mClause.params]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS n
           FROM evidence e
           JOIN businesses b ON b.id = e.business_id
          WHERE b.workspace_id = $1 AND b.archived = false
            AND e.enterprise_state IN ('submitted_for_review','under_review')${eClause.sql}`,
        [workspaceId, ...eClause.params]
      ),
      pool.query(
        `SELECT ds.id::text AS id, ds.label, ds.due_date::text AS due_date,
                ds.recurrence_rule, ds.is_verified,
                o.id::text AS obligation_id, o.name AS obligation_name,
                COALESCE(b.legal_name, b.name) AS business_name, b.public_id AS business_public_id
           FROM deadline_schedules ds
           LEFT JOIN obligations o ON o.id = ds.obligation_id
           LEFT JOIN businesses b ON b.id = o.business_id
           LEFT JOIN obligation_work ow ON ow.obligation_id = o.id
           LEFT JOIN matters m ON m.id = o.matter_id
          WHERE ds.workspace_id = $1 AND ds.schedule_type = 'recurring'
            AND ds.due_date >= CURRENT_DATE
            AND (o.id IS NULL OR (b.workspace_id = $1 AND b.archived = false))${oClause.sql}
          ORDER BY ds.due_date`,
        [workspaceId, ...oClause.params]
      ),
    ]);

    // ---- 3. Regulatory events (verified) + impacts -------------------------
    const regEvents = await pool.query(
      `SELECT id::text AS id, title, summary, lifecycle, regulatory_source,
              effective_date::text AS effective_date,
              verification_date, reviewer_notes
         FROM regulatory_events
        WHERE (workspace_id = $1 OR workspace_id IS NULL) AND verification_date IS NOT NULL
        ORDER BY verification_date DESC
        LIMIT 5`,
      [workspaceId]
    );
    const eventIds = regEvents.rows.map((r) => String(r.id));
    const impacts = eventIds.length
      ? await pool.query(
          `SELECT ri.event_id::text AS event_id,
                  f.id::text AS facility_id, f.name AS facility_name,
                  COALESCE(b.legal_name, b.name) AS business_name,
                  ri.required_action, ri.ack_status, ri.implementation_status
             FROM regulatory_impacts ri
             LEFT JOIN facilities f ON f.id = ri.facility_id
             LEFT JOIN businesses b ON b.id = ri.business_id
            WHERE ri.event_id = ANY($1::uuid[]) AND ri.workspace_id = $2`,
          [eventIds, workspaceId]
        )
      : { rows: [] as Array<Record<string, unknown>> };

    // ---- 4. Facets for the filter bar ---------------------------------------
    const [munRows, agRows, depRows, ownRows, stRows, bizListRows, domRows] = await Promise.all([
      pool.query(
        `SELECT DISTINCT b.municipality FROM businesses b
          WHERE b.workspace_id = $1 AND b.archived = false AND b.municipality IS NOT NULL
          ORDER BY 1`,
        [workspaceId]
      ),
      pool.query(
        `SELECT DISTINCT o.agency FROM obligations o
           JOIN businesses b ON b.id = o.business_id
          WHERE b.workspace_id = $1 AND b.archived = false AND o.agency IS NOT NULL
          ORDER BY 1`,
        [workspaceId]
      ),
      pool.query(
        `SELECT DISTINCT ow.department FROM obligation_work ow
           JOIN obligations o ON o.id = ow.obligation_id
           JOIN businesses b ON b.id = o.business_id
          WHERE b.workspace_id = $1 AND b.archived = false AND ow.department IS NOT NULL
          ORDER BY 1`,
        [workspaceId]
      ),
      pool.query(
        `SELECT DISTINCT u.id::text AS id, u.name, u.email
           FROM obligation_work ow
           JOIN obligations o ON o.id = ow.obligation_id
           JOIN businesses b ON b.id = o.business_id
           JOIN users u ON u.id = ow.owner_user_id
          WHERE b.workspace_id = $1 AND b.archived = false
          ORDER BY u.name NULLS LAST, u.email`,
        [workspaceId]
      ),
      pool.query(
        `SELECT DISTINCT o.status FROM obligations o
           JOIN businesses b ON b.id = o.business_id
          WHERE b.workspace_id = $1 AND b.archived = false
          ORDER BY 1`,
        [workspaceId]
      ),
      pool.query(
        `SELECT b.id::text AS id, COALESCE(b.legal_name, b.name) AS name
           FROM businesses b
          WHERE b.workspace_id = $1 AND b.archived = false
          ORDER BY name`,
        [workspaceId]
      ),
      pool.query(
        `SELECT DISTINCT rr.requirement_category AS domain
           FROM requirement_rules rr
          WHERE rr.requirement_category IS NOT NULL
          ORDER BY 1`
      ),
    ]);

    // ---- 5. Aggregations -----------------------------------------------------
    const obligations = obl.rows;
    const isOpen = (r: Record<string, unknown>) => r.status !== "COMPLETED";
    const effectiveDue = (r: Record<string, unknown>): string | null =>
      (r.internal_due_date as string | null) || (r.due_date as string | null) || null;

    const open = obligations.filter(isOpen);
    const withDue = open
      .map((r) => ({ r, due: effectiveDue(r) }))
      .filter((x): x is { r: Record<string, unknown>; due: string } => x.due !== null);

    const overdue = withDue.filter((x) => x.due < today);
    const dueIn = (n: number) =>
      withDue.filter((x) => x.due >= today && daysBetween(x.due, today) <= n);

    const critical = open.filter(
      (r) =>
        r.priority === "critical" &&
        !["approved", "completed"].includes(String(r.work_status))
    );
    const withoutOwner = open.filter((r) => !r.owner_user_id);

    const matters = matRows.rows;
    const scored = matters.filter((m) => m.readiness_score !== null);
    const overallReadiness =
      scored.length > 0
        ? Math.round(
            scored.reduce((s, m) => s + Number(m.readiness_score), 0) / scored.length
          )
        : null;
    const activeProjects = matters.filter((m) =>
      ACTIVE_MATTER_STATUSES.includes(String(m.status))
    );

    // Readiness by facility: matters inherit their business's readiness.
    const readinessByBusiness = new Map<string, number[]>();
    for (const m of matters) {
      if (m.readiness_score === null) continue;
      const arr = readinessByBusiness.get(String(m.business_id)) ?? [];
      arr.push(Number(m.readiness_score));
      readinessByBusiness.set(String(m.business_id), arr);
    }
    const avg = (xs: number[]) =>
      xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
    const byFacility = facRows.rows.map((f) => {
      const bid = f.business_id as string | null;
      const scores = bid ? readinessByBusiness.get(bid) ?? [] : [];
      return {
        id: String(f.id),
        name: String(f.name),
        municipality: (f.municipality as string | null) ?? null,
        business_id: bid,
        business_name: (f.business_name as string | null) ?? null,
        readiness: avg(scores),
        open_requirements: open.filter((o) => String(o.business_id) === bid).length,
        href: workHref("all", { ...filters, facilityIds: [String(f.id)] }),
      };
    });
    const byProject = matters.map((m) => ({
      id: String(m.id),
      title: String(m.title ?? "Untitled project"),
      business_name: String(m.business_name ?? "—"),
      status: String(m.status),
      readiness: m.readiness_score === null ? null : Number(m.readiness_score),
      due_date: (m.due_date as string | null) ?? null,
      date_label: isVerifiedDateSource(m.due_date_source) ? "verified" : "internal target",
      href: workHref("all", { ...filters, projectIds: [String(m.id)] }),
    }));

    // Progress by owner / department.
    const ownerMap = new Map<
      string,
      { id: string; name: string | null; email: string | null; total: number; completed: number; overdue: number; critical: number }
    >();
    for (const r of obligations) {
      const id = r.owner_user_id as string | null;
      if (!id) continue;
      const cur =
        ownerMap.get(id) ??
        {
          id,
          name: (r.owner_name as string | null) ?? null,
          email: (r.owner_email as string | null) ?? null,
          total: 0,
          completed: 0,
          overdue: 0,
          critical: 0,
        };
      cur.total += 1;
      if (r.status === "COMPLETED") cur.completed += 1;
      const due = effectiveDue(r);
      if (isOpen(r) && due && due < today) cur.overdue += 1;
      if (
        isOpen(r) &&
        r.priority === "critical" &&
        !["approved", "completed"].includes(String(r.work_status))
      )
        cur.critical += 1;
      ownerMap.set(id, cur);
    }
    const deptMap = new Map<string, { department: string; total: number; completed: number; overdue: number }>();
    for (const r of obligations) {
      const dep = (r.department as string | null) ?? "Unassigned";
      const cur = deptMap.get(dep) ?? { department: dep, total: 0, completed: 0, overdue: 0 };
      cur.total += 1;
      if (r.status === "COMPLETED") cur.completed += 1;
      const due = effectiveDue(r);
      if (isOpen(r) && due && due < today) cur.overdue += 1;
      deptMap.set(dep, cur);
    }

    // Regulatory events with affected facilities.
    const impactsByEvent = new Map<string, Array<Record<string, unknown>>>();
    for (const row of impacts.rows) {
      const key = String(row.event_id);
      const arr = impactsByEvent.get(key) ?? [];
      arr.push(row);
      impactsByEvent.set(key, arr);
    }
    const recentRegulatory = regEvents.rows.map((ev) => {
      const evImpacts = impactsByEvent.get(String(ev.id)) ?? [];
      const facilities = [
        ...new Set(
          evImpacts
            .map((i) => i.facility_name)
            .filter((n): n is string => typeof n === "string" && n.length > 0)
        ),
      ];
      return {
        id: String(ev.id),
        title: String(ev.title),
        summary: (ev.summary as string | null) ?? null,
        lifecycle: String(ev.lifecycle),
        regulatory_source: (ev.regulatory_source as string | null) ?? null,
        effective_date: (ev.effective_date as string | null) ?? null,
        verification_date:
          ev.verification_date instanceof Date
            ? ev.verification_date.toISOString()
            : String(ev.verification_date ?? ""),
        affected_facilities: facilities,
        affected_facility_count: facilities.length,
        impact_count: evImpacts.length,
        href: `/enterprise/regulatory/${ev.id}`,
      };
    });
    const affectedFacilityCount = new Set(
      impacts.rows.map((i) => i.facility_id).filter(Boolean)
    ).size;

    const metrics: Metric[] = [
      { key: "businesses", label: "Businesses", value: bizRows.rows[0]?.n ?? 0, href: workHref("all", filters) },
      { key: "facilities", label: "Facilities", value: facRows.rows.length, href: workHref("all", filters) },
      { key: "active_projects", label: "Active projects", value: activeProjects.length, href: workHref("active", filters) },
      { key: "overall_readiness", label: "Overall readiness", value: overallReadiness, href: workHref("attention", filters), note: "Avg of project readiness scores" },
      { key: "open_requirements", label: "Open requirements", value: open.length, href: workHref("open", filters) },
      { key: "critical_deficiencies", label: "Critical deficiencies", value: critical.length, href: workHref("critical", filters) },
      { key: "evidence_awaiting_review", label: "Evidence awaiting review", value: evRows.rows[0]?.n ?? 0, href: workHref("reviews", filters) },
      { key: "overdue_actions", label: "Overdue actions", value: overdue.length, href: workHref("overdue", filters), note: "Includes internal-target dates" },
      { key: "due_30_days", label: "Due within 30 days", value: dueIn(30).length, href: workHref("due", filters, "days=30"), note: "Includes internal-target dates" },
      { key: "due_60_days", label: "Due within 60 days", value: dueIn(60).length, href: workHref("due", filters, "days=60"), note: "Includes internal-target dates" },
      { key: "due_90_days", label: "Due within 90 days", value: dueIn(90).length, href: workHref("due", filters, "days=90"), note: "Includes internal-target dates" },
      { key: "upcoming_renewals", label: "Upcoming renewals", value: renRows.rows.length, href: workHref("renewals", filters) },
      { key: "requirements_without_owner", label: "Requirements without owner", value: withoutOwner.length, href: workHref("unassigned", filters) },
      { key: "verified_regulatory_changes", label: "Verified regulatory changes", value: regEvents.rows.length, href: "/enterprise/regulatory", note: "Latest 5 verified" },
    ];

    // Audit the portfolio view (read-only analytics access).
    const meta = getRequestMeta(req);
    await writeAuditEvent(pool, {
      actorUserId: user.id,
      workspaceId,
      action: "portfolio_viewed",
      targetType: "workspace",
      targetId: workspaceId,
      after: { filters_applied: applied, metric_count: metrics.length },
      ip: meta.ip,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
      source: "api",
    });

    return Response.json({
      workspace_id: workspaceId,
      generated_at: generatedAt,
      data_as_of: generatedAt,
      filters_applied: applied,
      metrics,
      readiness: { overall: overallReadiness, by_facility: byFacility, by_project: byProject },
      workload: {
        by_owner: [...ownerMap.values()],
        by_department: [...deptMap.values()],
        unassigned_open: withoutOwner.length,
      },
      upcoming_renewals: renRows.rows.map((r) => ({
        id: String(r.id),
        label: String(r.label ?? r.obligation_name ?? "Renewal"),
        due_date: String(r.due_date),
        recurrence_rule: (r.recurrence_rule as string | null) ?? null,
        verified: Boolean(r.is_verified),
        date_label: r.is_verified ? "verified" : "internal target",
        obligation_id: r.obligation_id ? String(r.obligation_id) : null,
        obligation_name: (r.obligation_name as string | null) ?? null,
        business_name: (r.business_name as string | null) ?? null,
        business_public_id: (r.business_public_id as string | null) ?? null,
        href: r.business_public_id
          ? `/businesses/${r.business_public_id}`
          : workHref("renewals", filters),
      })),
      regulatory: {
        recent: recentRegulatory,
        affected_facility_count: affectedFacilityCount,
      },
      facets: {
        municipalities: munRows.rows.map((r) => String(r.municipality)),
        agencies: agRows.rows.map((r) => String(r.agency)),
        departments: depRows.rows.map((r) => String(r.department)),
        owners: ownRows.rows.map((r) => ({
          id: String(r.id),
          name: (r.name as string | null) ?? null,
          email: (r.email as string | null) ?? null,
        })),
        statuses: stRows.rows.map((r) => String(r.status)),
        priorities: ["low", "medium", "high", "critical"],
        businesses: bizListRows.rows.map((r) => ({
          id: String(r.id),
          name: String(r.name ?? "Untitled business"),
        })),
        facilities: facRows.rows.map((r) => ({
          id: String(r.id),
          name: String(r.name ?? "Untitled facility"),
        })),
        projects: matRows.rows.map((r) => ({
          id: String(r.id),
          name: String(r.title ?? "Untitled project"),
        })),
        domains: domRows.rows.map((r) => String(r.domain)),
      },
    });
  } catch (error) {
    console.error("[enterprise-portfolio]", (error as Error).message);
    return Response.json({ error: "query_failed" }, { status: 500 });
  }
}
