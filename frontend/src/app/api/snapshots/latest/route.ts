// Latest workflow snapshot for a business/matter — lets a page that remounts
// (e.g. returning from Clara via back-navigation) restore the exact intake
// state without a ?resume= id. Read-only; the workflow_snapshots table
// already exists, so no migration is involved.

import { getPool, isEnabled } from "../../../graph/db";
import { ensureSchema } from "../../../graph/store";
import { getCurrentUser } from "../../../../lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!isEnabled()) return Response.json({ error: "no_database" }, { status: 503 });
  const pool = getPool();
  if (!pool) return Response.json({ error: "no_database" }, { status: 503 });
  await ensureSchema();
  const { searchParams } = new URL(req.url);
  const matterId = searchParams.get("matter_id");
  const businessId = searchParams.get("business_id");
  if (!matterId && !businessId) {
    return Response.json({ error: "matter_id or business_id required" }, { status: 400 });
  }
  // Never resolve local-only draft ids: they are not persisted businesses.
  if ((matterId && matterId.startsWith("local-")) || (businessId && businessId.startsWith("local-"))) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  try {
    const { rows } = await pool.query(
      `SELECT submission_id, state, updated_at, business_id, matter_id
         FROM workflow_snapshots
        WHERE user_id = $1
          AND ($2::text IS NULL OR matter_id = $2)
          AND ($3::text IS NULL OR business_id = $3)
        ORDER BY updated_at DESC
        LIMIT 1`,
      [user.id, matterId, businessId]
    );
    if (!rows[0]) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json(rows[0]);
  } catch (err) {
    console.error("[snapshots/latest] load failed:", (err as Error).message);
    return Response.json({ error: "query_failed" }, { status: 500 });
  }
}
