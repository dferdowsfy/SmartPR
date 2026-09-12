// Org audit log: GET /api/enterprise/audit
//
// Query params:
//   workspace_id (required) — ALWAYS scoped to a workspace the caller belongs
//     to; permission view_audit_logs is enforced via requireEnterprisePermission.
//   action, actor (user id or email fragment), target_type,
//   date_from / date_to (ISO), search (matches action/target_id/reason),
//   page (1-based), page_size (max 200), format=csv.
//
// Customer admins only ever see their own org's events: the workspace_id is
// validated by the permission gate (tenant-bound), and there is no cross-org
// mode on this route — superadmins use /api/admin/workspaces/[id]/audit.
import { getPool, isEnabled } from "../../../graph/db";
import {
  requireEnterprisePermission,
} from "../../../../lib/enterprise-permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PAGE_SIZE = 200;

function likeParam(v: string | null): string | null {
  if (!v) return null;
  return `%${v.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const workspaceId = (url.searchParams.get("workspace_id") || "").trim();
  if (!workspaceId) {
    return Response.json({ error: "workspace_id required" }, { status: 400 });
  }

  // Tenant gate + permission: 401/403 here when the caller is not a member
  // with view_audit_logs in this workspace.
  const gate = await requireEnterprisePermission("view_audit_logs", workspaceId);
  if ("response" in gate) return gate.response;

  if (!isEnabled()) return Response.json({ error: "no_database" }, { status: 503 });
  const pool = getPool();
  if (!pool) return Response.json({ error: "no_database" }, { status: 503 });

  const action = url.searchParams.get("action")?.trim() || null;
  const actor = url.searchParams.get("actor")?.trim() || null;
  const targetType = url.searchParams.get("target_type")?.trim() || null;
  const dateFrom = url.searchParams.get("date_from")?.trim() || null;
  const dateTo = url.searchParams.get("date_to")?.trim() || null;
  const search = likeParam(url.searchParams.get("search")?.trim() || null);
  const format = url.searchParams.get("format");
  const page = Math.max(1, Number(url.searchParams.get("page") || 1) || 1);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number(url.searchParams.get("page_size") || 50) || 50)
  );

  const clauses: string[] = [`e.workspace_id = $1`];
  const params: unknown[] = [workspaceId];

  if (action) {
    params.push(action);
    clauses.push(`e.action = $${params.length}`);
  }
  if (targetType) {
    params.push(targetType);
    clauses.push(`e.target_type = $${params.length}`);
  }
  if (dateFrom) {
    params.push(dateFrom);
    clauses.push(`e.created_at >= $${params.length}::timestamptz`);
  }
  if (dateTo) {
    params.push(dateTo);
    clauses.push(`e.created_at <= $${params.length}::timestamptz`);
  }
  if (actor) {
    params.push(actor, `%${actor}%`);
    clauses.push(
      `(e.actor_user_id::text = $${params.length - 1} OR lower(u.email) LIKE lower($${params.length}))`
    );
  }
  if (search) {
    params.push(search);
    clauses.push(
      `(e.action ILIKE $${params.length} OR e.target_id ILIKE $${params.length} ` +
        `OR e.reason ILIKE $${params.length} OR e.target_type ILIKE $${params.length})`
    );
  }

  const whereSql = clauses.join(" AND ");
  const fromSql = `FROM audit_events e LEFT JOIN auth.users u ON u.id = e.actor_user_id`;

  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS total ${fromSql} WHERE ${whereSql}`,
    params
  );
  const total = Number(countRes.rows[0]?.total || 0);

  const offset = (page - 1) * pageSize;
  const limitParam = params.length + 1;
  const offsetParam = params.length + 2;
  const { rows } = await pool.query(
    `SELECT e.id, e.created_at, e.actor_user_id::text AS actor_user_id,
            lower(u.email) AS actor_email,
            (u.raw_user_meta_data ->> 'full_name') AS actor_name,
            e.action, e.target_type, e.target_id, e.source, e.reason,
            e.ip, e.user_agent, e.correlation_id,
            e."before", e."after"
       ${fromSql} WHERE ${whereSql}
       ORDER BY e.created_at DESC, e.id DESC
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
    [...params, pageSize, offset]
  );

  if (format === "csv") {
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
        "content-disposition": `attachment; filename="audit-events-${workspaceId.slice(0, 8)}.csv"`,
      },
    });
  }

  return Response.json({ events: rows, total, page, page_size: pageSize });
}
