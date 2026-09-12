import { getPool, isEnabled } from "../../../graph/db";
import { requireSuperAdmin } from "../_util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Super-admin: audit trail, optionally filtered by workspace. */
export async function GET(request: Request) {
  const gate = await requireSuperAdmin();
  if ("response" in gate) return gate.response;
  if (!isEnabled()) return Response.json({ error: "no_database" }, { status: 503 });
  const pool = getPool();
  if (!pool) return Response.json({ error: "no_database" }, { status: 503 });

  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId");
  const limit = Math.min(Number(url.searchParams.get("limit") || 100), 500);

  const { rows } = workspaceId
    ? await pool.query(
        `SELECT a.id, a.actor_email, a.action, a.target_email, a.details, a.created_at,
                w.name AS workspace_name
           FROM admin_audit_log a LEFT JOIN workspaces w ON w.id = a.workspace_id
          WHERE a.workspace_id = $1
          ORDER BY a.created_at DESC LIMIT $2`,
        [workspaceId, limit]
      )
    : await pool.query(
        `SELECT a.id, a.actor_email, a.workspace_id, a.action, a.target_email, a.details, a.created_at,
                w.name AS workspace_name
           FROM admin_audit_log a LEFT JOIN workspaces w ON w.id = a.workspace_id
          ORDER BY a.created_at DESC LIMIT $1`,
        [limit]
      );
  return Response.json({ entries: rows });
}
