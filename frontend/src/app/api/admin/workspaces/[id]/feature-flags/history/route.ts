// Superadmin feature-flag history: GET (?key= optional).
// Gate: requireSuperAdmin. Read-only.
import { getPool, isEnabled } from "../../../../../../graph/db";
import { requireSuperAdmin } from "../../../../_util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const gate = await requireSuperAdmin();
  if ("response" in gate) return gate.response;
  const m = request.url.match(/\/workspaces\/([^/]+)\/feature-flags/);
  const workspaceId = m ? decodeURIComponent(m[1]) : null;
  if (!workspaceId) return Response.json({ error: "workspace_id required" }, { status: 400 });
  if (!isEnabled()) return Response.json({ error: "no_database" }, { status: 503 });
  const pool = getPool();
  if (!pool) return Response.json({ error: "no_database" }, { status: 503 });

  const key = new URL(request.url).searchParams.get("key")?.trim() || null;
  const params: unknown[] = [workspaceId];
  let keyClause = "";
  if (key) {
    params.push(key);
    keyClause = `AND h.key = $2`;
  }
  const { rows } = await pool.query(
    `SELECT h.id::text AS id, h.key, h.old_value, h.new_value,
            h.changed_by::text AS changed_by, lower(u.email) AS changed_by_email,
            h.created_at
       FROM feature_flag_history h
       LEFT JOIN auth.users u ON u.id = h.changed_by
      WHERE h.workspace_id = $1 ${keyClause}
      ORDER BY h.created_at DESC
      LIMIT 100`,
    params
  );
  return Response.json({ history: rows });
}
