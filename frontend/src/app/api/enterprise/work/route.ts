// GET /api/enterprise/work — work queue: obligations joined to
// obligation_work + business/facility/matter context.
//
// Filters: business, facility, municipality, project, work_status, agency,
// owner, department, priority, due_from, due_to, domain, search.
// Saved views (?view=): my_work, my_reviews, overdue, unassigned, critical.
// Sorting + pagination. format=csv exports the full filtered set.
//
// Permission: view_records (organization scope; requireEnterprisePermission
// fails closed on cross-workspace tampering).

import { gateEnterprise, badRequest, getPool } from "../_util";
import { requireEnterprisePermission } from "../../../../lib/enterprise-permissions";
import { WORK_STATUSES, PRIORITIES, isUuid } from "../../../../lib/enterprise-work";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_VIEWS = new Set(["my_work", "my_reviews", "overdue", "unassigned", "critical"]);

const SORT_COLUMNS: Record<string, string> = {
  due_date: "COALESCE(w.internal_due_date, o.due_date)",
  priority:
    "CASE COALESCE(w.priority,'medium') WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END",
  name: "o.name",
  business_name: "b.name",
  work_status: "COALESCE(w.work_status,'not_started')",
  agency: "o.agency",
  updated: "o.updated_at",
};

function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = (name: string) => url.searchParams.get(name)?.trim() || null;

  const workspaceParam = q("workspace_id");
  const view = q("view");
  if (view && !VALID_VIEWS.has(view)) {
    return badRequest(`Invalid view "${view}".`);
  }

  const gate = await gateEnterprise(request, "view_records", workspaceParam);
  if ("response" in gate) return gate.response;
  const { user, workspaceId } = gate;

  const pool = getPool();
  if (!pool) return Response.json({ error: "no_database" }, { status: 503 });

  const workStatus = q("work_status");
  if (workStatus && !WORK_STATUSES.includes(workStatus as never)) {
    return badRequest(`Invalid work_status "${workStatus}".`);
  }
  const priority = q("priority");
  if (priority && !PRIORITIES.includes(priority as never)) {
    return badRequest(`Invalid priority "${priority}".`);
  }
  for (const [param, value] of [
    ["business", q("business")],
    ["facility", q("facility")],
    ["project", q("project")],
    ["owner", q("owner")],
  ] as const) {
    if (value && !isUuid(value)) return badRequest(`Invalid ${param} id.`);
  }
  const dueFrom = q("due_from");
  const dueTo = q("due_to");
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if ((dueFrom && !dateRe.test(dueFrom)) || (dueTo && !dateRe.test(dueTo))) {
    return badRequest("due_from/due_to must be YYYY-MM-DD.");
  }

  const where: string[] = ["b.workspace_id = $1::uuid"];
  const params: unknown[] = [workspaceId];
  const add = (clause: string, value?: unknown) => {
    params.push(value);
    where.push(clause.replace("?", `$${params.length}`));
  };

  const business = q("business");
  if (business) add("o.business_id = ?::uuid", business);
  const facility = q("facility");
  if (facility) {
    add(
      `o.business_id IN (SELECT business_id FROM facilities WHERE id = ?::uuid AND workspace_id = $1::uuid AND business_id IS NOT NULL)`,
      facility
    );
  }
  const municipality = q("municipality");
  if (municipality) add("b.municipality ILIKE ?", `%${municipality}%`);
  const project = q("project");
  if (project) {
    add(
      `o.matter_id IN (SELECT id FROM matters WHERE id = ?::uuid AND workspace_id = $1::uuid)`,
      project
    );
  }
  if (workStatus) add("COALESCE(w.work_status,'not_started') = ?", workStatus);
  const agency = q("agency");
  if (agency) add("o.agency ILIKE ?", `%${agency}%`);
  const owner = q("owner");
  if (owner) add("w.owner_user_id = ?::uuid", owner);
  const department = q("department");
  if (department) add("w.department ILIKE ?", `%${department}%`);
  if (priority) add("COALESCE(w.priority,'medium') = ?", priority);
  if (dueFrom) add("COALESCE(w.internal_due_date, o.due_date) >= ?::date", dueFrom);
  if (dueTo) add("COALESCE(w.internal_due_date, o.due_date) <= ?::date", dueTo);
  const domain = q("domain");
  if (domain) add("rr.requirement_category ILIKE ?", `%${domain}%`);
  const search = q("search");
  if (search) {
    params.push(`%${search}%`);
    where.push(`(o.name ILIKE $${params.length} OR b.name ILIKE $${params.length})`);
  }

  // Saved views
  if (view === "my_work") add("w.owner_user_id = ?::uuid", user.id);
  if (view === "my_reviews") add("w.reviewer_user_id = ?::uuid", user.id);
  if (view === "unassigned") where.push("w.owner_user_id IS NULL");
  if (view === "critical") add("COALESCE(w.priority,'medium') = 'critical'");
  if (view === "overdue") {
    where.push("COALESCE(w.internal_due_date, o.due_date) < CURRENT_DATE");
    where.push("COALESCE(w.work_status,'not_started') NOT IN ('completed','approved')");
  }

  const whereSql = where.join(" AND ");
  const select = `
    SELECT o.id::text AS obligation_id,
           o.name AS obligation_name,
           o.agency AS agency,
           o.status AS obligation_status,
           o.due_date::text AS obligation_due_date,
           COALESCE(o.mandatory, false) AS mandatory,
           o.matter_id::text AS matter_id,
           m.title AS matter_title,
           b.id::text AS business_id,
           b.name AS business_name,
           b.municipality AS municipality,
           COALESCE(w.work_status,'not_started') AS work_status,
           w.owner_user_id::text AS owner_user_id,
           COALESCE(owner_u.name, owner_u.email) AS owner_name,
           owner_u.email AS owner_email,
           w.department AS department,
           w.reviewer_user_id::text AS reviewer_user_id,
           COALESCE(rev_u.name, rev_u.email) AS reviewer_name,
           COALESCE(w.priority,'medium') AS priority,
           w.internal_due_date::text AS internal_due_date,
           COALESCE(w.internal_due_date, o.due_date)::text AS effective_due_date,
           w.escalation_state AS escalation_state,
           w.notes AS notes,
           w.completed_via_exception AS completed_via_exception,
           rr.requirement_category AS domain,
           m.readiness_score AS matter_readiness_score,
           (SELECT jsonb_agg(
                jsonb_build_object('document_title', rd.document_title, 'document_type', rd.document_type)
                ORDER BY rd.document_title)
              FROM requirement_documents rd
              WHERE rd.requirement_rule_id = o.requirement_id) AS required_documents,
           (SELECT f2.name FROM facilities f2
             WHERE f2.business_id = b.id AND f2.workspace_id = b.workspace_id
             ORDER BY f2.created_at ASC LIMIT 1) AS facility_name,
           COALESCE(
             (SELECT jsonb_agg(
                jsonb_build_object(
                  'evidence_id', e.id::text,
                  'filename', e.original_filename,
                  'enterprise_state', e.enterprise_state,
                  'version_count', (SELECT COUNT(*) FROM evidence_versions v WHERE v.evidence_id = e.id),
                  'review_count', (SELECT COUNT(*) FROM evidence_reviews r WHERE r.evidence_id = e.id),
                  'uploaded_by', e.user_id::text,
                  'created_at', e.created_at
                ) ORDER BY e.created_at DESC)
              FROM evidence e WHERE e.obligation_id = o.id),
             '[]'::jsonb) AS evidence,
           CASE WHEN COALESCE(w.internal_due_date, o.due_date) < CURRENT_DATE
                 AND COALESCE(w.work_status,'not_started') NOT IN ('completed','approved')
                THEN (CURRENT_DATE - COALESCE(w.internal_due_date, o.due_date))::int
                ELSE 0 END AS days_overdue,
           o.updated_at AS updated_at
      FROM obligations o
      JOIN businesses b ON b.id = o.business_id
      LEFT JOIN matters m ON m.id = o.matter_id
      LEFT JOIN obligation_work w ON w.obligation_id = o.id
      LEFT JOIN users owner_u ON owner_u.id = w.owner_user_id
      LEFT JOIN users rev_u ON rev_u.id = w.reviewer_user_id
      LEFT JOIN requirement_rules rr ON rr.id = o.requirement_id`;

  const format = q("format");
  const sortKey = q("sort") && SORT_COLUMNS[q("sort")!] ? q("sort")! : "due_date";
  const order = (q("order") || "asc").toLowerCase() === "desc" ? "DESC" : "ASC";
  const orderBy = `${SORT_COLUMNS[sortKey]} ${order} NULLS LAST, o.name ASC`;

  if (format === "csv") {
    // CSV export requires export_data.
    const exportGate = await requireEnterprisePermission("export_data", workspaceId);
    if ("response" in exportGate) return exportGate.response;
    const { rows } = await pool.query(
      `${select} WHERE ${whereSql} ORDER BY ${orderBy} LIMIT 5000`,
      params
    );
    const header = [
      "obligation_id", "obligation_name", "agency", "domain", "business_name", "municipality",
      "facility_name", "matter_title", "obligation_status", "work_status", "owner_name",
      "owner_email", "department", "reviewer_name", "priority", "effective_due_date",
      "internal_due_date", "days_overdue", "mandatory", "completed_via_exception", "notes",
    ];
    const lines = [header.join(",")];
    for (const r of rows) {
      const row = r as Record<string, unknown>;
      lines.push(header.map((h) => csvCell(row[h])).join(","));
    }
    return new Response(lines.join("\n"), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="work-queue-${workspaceId.slice(0, 8)}.csv"`,
      },
    });
  }

  const page = Math.max(1, parseInt(q("page") || "1", 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(q("limit") || "25", 10) || 25));
  const offset = (page - 1) * limit;

  const countRes = await pool.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM obligations o
      JOIN businesses b ON b.id = o.business_id
      LEFT JOIN obligation_work w ON w.obligation_id = o.id
      LEFT JOIN requirement_rules rr ON rr.id = o.requirement_id
     WHERE ${whereSql}`,
    params
  );
  const total = Number(countRes.rows[0]?.total ?? 0);
  const { rows } = await pool.query(
    `${select} WHERE ${whereSql} ORDER BY ${orderBy} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  );
  return Response.json({
    workspace_id: workspaceId,
    view: view ?? null,
    page,
    limit,
    total,
    items: rows,
  });
}
