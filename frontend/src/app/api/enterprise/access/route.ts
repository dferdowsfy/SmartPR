// GET /api/enterprise/access
// Lightweight probe for the enterprise nav and enterprise pages: returns the
// workspaces the signed-in user belongs to, each with the enterprise
// permission keys they hold there. No permission is required to call it —
// membership alone is the gate — but permissions are computed server-side.

import { getPool } from "../../../graph/db";
import { getCurrentUser } from "../../../../lib/supabase/server";
import {
  PERMISSIONS,
  hasPermission,
  getUserWorkspaceIds,
  type Permission,
} from "../../../../lib/enterprise-permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const pool = getPool();
  if (!pool) return Response.json({ error: "db_unavailable" }, { status: 503 });

  try {
    const workspaceIds = await getUserWorkspaceIds(user.id, pool);
    const workspaces: Array<{
      id: string;
      name: string;
      permissions: Permission[];
    }> = [];
    if (workspaceIds.length > 0) {
      const { rows } = await pool.query(
        `SELECT id::text AS id, name FROM workspaces WHERE id = ANY($1::uuid[])`,
        [workspaceIds]
      );
      const names = new Map<string, string>(
        rows.map((r) => [String(r.id), String(r.name ?? "Workspace")])
      );
      for (const wsId of workspaceIds) {
        const permissions: Permission[] = [];
        for (const perm of PERMISSIONS) {
          try {
            if (await hasPermission(user.id, wsId, perm, undefined, { pool })) {
              permissions.push(perm);
            }
          } catch {
            // treat lookup failure as no permission
          }
        }
        workspaces.push({
          id: wsId,
          name: names.get(wsId) ?? "Workspace",
          permissions,
        });
      }
    }
    return Response.json({
      user: { id: user.id, email: user.email },
      workspaces,
    });
  } catch (error) {
    console.error("[enterprise-access]", (error as Error).message);
    return Response.json({ error: "query_failed" }, { status: 500 });
  }
}
