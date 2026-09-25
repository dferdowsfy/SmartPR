import { NextResponse } from "next/server";
import { PLAN_CATALOG, type PlanId } from "@/lib/billing/catalog";
import { getWorkspacePlanState } from "@/lib/billing/access";
import { getCurrentUser } from "@/lib/supabase/server";
import { getPool } from "../../../graph/db";

export const runtime = "nodejs";

/** Current workspace's billing state for the signed-in user (settings UI). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const pool = getPool();
  if (!pool) return NextResponse.json({ error: "Database unavailable." }, { status: 503 });

  const { rows } = await pool.query(
    `SELECT w.id
       FROM workspaces w
       JOIN workspace_members wm ON wm.workspace_id = w.id
      WHERE wm.user_id = $1
      ORDER BY CASE WHEN wm.role = 'OWNER' THEN 0 ELSE 1 END, w.created_at ASC
      LIMIT 1`,
    [user.id]
  );
  const workspaceId = rows[0]?.id as string | undefined;
  if (!workspaceId) {
    return NextResponse.json({ plan: "free", planName: PLAN_CATALOG.free.name, status: "free", currentPeriodEnd: null });
  }

  const state = await getWorkspacePlanState(pool, workspaceId);
  const { rows: subRows } = await pool.query<{ current_period_end: string | null }>(
    `SELECT current_period_end::text AS current_period_end FROM workspace_subscriptions WHERE workspace_id = $1 LIMIT 1`,
    [workspaceId]
  );
  const planId: PlanId = state.planId;
  return NextResponse.json({
    plan: planId,
    planName: PLAN_CATALOG[planId]?.name ?? planId,
    status: state.status,
    currentPeriodEnd: subRows[0]?.current_period_end ?? null,
  });
}
