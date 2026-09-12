// Superadmin cross-org audit view for one workspace: GET
// /api/admin/workspaces/[id]/audit
//
// Filters: action, actor, target_type, source, date_from, date_to, search;
// page/page_size; ?format=csv. Gate: requireSuperAdmin. Read-only.
import { getPool, isEnabled } from "../../../../../graph/db";
import { requireSuperAdmin } from "../../../_util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PAGE_SIZE = 200;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSuperAdmin();
  if ("response" in gate) return gate.response;
  if (!isEnabled()) return Response.json({ error: "no_database" }, { status: 503 });
  const pool = getPool();
  if (!pool) return Response.json({ error: "no_database" }, { status: 503 });
  const { id: workspaceId } = await params;
  const url = new URL(request.url);

  const action = url.searchParams.get("action")?.trim() || null;
  const actor = url.searchParams.get("actor")?.trim() || null;
  const targetType = url.searchParams.get("target_type")?.trim() || null;
  const source = url.searchParams.get("source")?.trim() || null;
  const dateFrom = url.searchParams.get("date_from")?.trim() || null;
  const dateTo = url.searchParams.get("date_to")?.trim() || null;
  const searchRaw = url.searchParams.get("search")?.trim() || null;
  const search = searchRaw
    ? `%${searchRaw.replace(/[%_\\]/g, (c) => `\\${c}`)}%`
    : null;
  const page = Math.max(1, Number(url.searchParams.get("page") || 1) || 1);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number(url.searchParams.get("page_size") || 50) || 50)
  );

  const clauses = [`e.workspace_id = $1`];
  const queryParams: unknown[] = [workspaceId];
  if (action) {
    queryParams.push(action);
    clauses.push(`e.action = $${queryParams.length}`);
  }
  if (targetType) {
    queryParams.push(targetType);
    clauses.push(`e.target_type = $${queryParams.length}`);
  }
  if (source) {
    queryParams.push(source);
    clauses.push(`e.source = $${queryParams.length}`);
  }
  if (dateFrom) {
    queryParams.push(dateFrom);
    clauses.push(`e.created_at >= $${queryParams.length}::timestamptz`);
  }
  if (dateTo) {
    queryParams.push(dateTo);
    clauses.push(`e.created_at <= $${queryParams.length}::timestamptz`);
  }
  if (actor) {
    queryParams.push(actor, `%${actor}%`);
    clauses.push(
      `(e.actor_user_id::text = $${queryParams.length - 1} OR lower(u.email) LIKE lower($${queryParams.length}))`
    );
  }
  if (search) {
    queryParams.push(search);
    clauses.push(
      `(e.action ILIKE $${queryParams.length} OR e.target_id ILIKE $${queryParams.length} ` +
        `OR e.reason ILIKE $${queryParams.length} OR e.target_type ILIKE $${queryParams.length})`
    );
  }

  const whereSql = clauses.join(" AND ");
  const fromSql = `FROM audit_events e LEFT JOIN auth.users u ON u.id = e.actor_user_id`;

  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS total ${fromSql} WHERE ${whereSql}`,
    queryParams
  );
  const total = Number(countRes.rows[0]?.total || 0);

  const offset = (page - 1) * pageSize;
  const { rows } = await pool.query(
    `SELECT e.id, e.created_at, e.actor_user_id::text AS actor_user_id,
            lower(u.email) AS actor_email, e.action, e.target_type, e.target_id,
            e.source, e.reason, e.ip, e.user_agent, e.correlation_id,
            e."before", e."after"
       ${fromSql} WHERE ${whereSql}
       ORDER BY e.created_at DESC, e.id DESC
       LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}`,
    [...queryParams, pageSize, offset]
  );

  if (url.searchParams.get("format") === "csv") {
    const header = [
      "id", "created_at", "actor_email", "action", "target_type",
      "target_id", "source", "reason", "ip", "correlation_id",
    ];
    const esc = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [header.join(",")];
    for (const r of rows) {
      lines.push(
        [r.id, r.created_at, r.actor_email, r.action, r.target_type, r.target_id,
         r.source, r.reason, r.ip, r.correlation_id].map(esc).join(",")
      );
    }
    return new Response(lines.join("\n"), {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="company-audit-${workspaceId.slice(0, 8)}.csv"`,
      },
    });
  }

  return Response.json({ events: rows, total, page, page_size: pageSize });
}
