import { getPool } from "../../../graph/db";
import { ensureSchema } from "../../../graph/store";
import { getCurrentUser } from "../../../../lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIONS = {
  read: { status: "READ", stamp: "read_at" },
  dismiss: { status: "DISMISSED", stamp: null },
} as const;

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const pool = getPool();
  if (!pool) return Response.json({ error: "Database unavailable." }, { status: 503 });
  let body: { action?: string };
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON body." }, { status: 400 }); }
  const mapping = body.action === "read" ? ACTIONS.read : body.action === "dismiss" ? ACTIONS.dismiss : null;
  if (!mapping) return Response.json({ error: "Action must be 'read' or 'dismiss'." }, { status: 400 });

  await ensureSchema();
  const result = await pool.query(
    mapping.stamp
      ? `UPDATE notifications SET status=$2, ${mapping.stamp}=now()
          WHERE id=$1 AND user_id=$3 AND status IN ('PENDING','DELIVERED')`
      : `UPDATE notifications SET status=$2
          WHERE id=$1 AND user_id=$3 AND status IN ('PENDING','DELIVERED')`,
    [id, mapping.status, user.id]
  );
  if (result.rowCount === 0) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ updated: true, status: mapping.status });
}
