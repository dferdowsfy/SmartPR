// Workspaces the signed-in user belongs to (for the enterprise admin UI).
import { getPool, isEnabled } from "../../../graph/db";
import { getCurrentUser } from "../../../../lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!isEnabled()) return Response.json({ error: "no_database" }, { status: 503 });
  const pool = getPool();
  if (!pool) return Response.json({ error: "no_database" }, { status: 503 });

  const { rows } = await pool.query(
    `SELECT w.id::text AS id, w.name, wm.role
       FROM workspace_members wm
       JOIN workspaces w ON w.id = wm.workspace_id
      WHERE wm.user_id = $1
      ORDER BY w.name ASC`,
    [user.id]
  );
  return Response.json({ workspaces: rows });
}
