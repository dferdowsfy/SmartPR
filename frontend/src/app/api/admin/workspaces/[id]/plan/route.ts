import { getPool, isEnabled } from "../../../../../graph/db";
import { requireSuperAdmin, auditLog } from "../../../_util";
import type { PlanId } from "../../../../../../lib/billing/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_PLANS: PlanId[] = ["free", "core", "operator", "partner", "pilot", "enterprise"];

/** Super-admin: set a workspace's plan directly (no Stripe involved). */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSuperAdmin();
  if ("response" in gate) return gate.response;
  if (!isEnabled()) return Response.json({ error: "no_database" }, { status: 503 });
  const pool = getPool();
  if (!pool) return Response.json({ error: "no_database" }, { status: 503 });
  const { id: workspaceId } = await params;
  const ctx = gate.ctx;

  const body = (await request.json().catch(() => ({}))) as { plan?: string };
  const plan = (body.plan || "").toLowerCase();
  if (!(VALID_PLANS as string[]).includes(plan)) {
    return Response.json({ error: "invalid plan" }, { status: 400 });
  }

  const ws = await pool.query(`SELECT id, name FROM workspaces WHERE id = $1`, [workspaceId]);
  if (!ws.rows[0]) return Response.json({ error: "not_found" }, { status: 404 });

  const before = await pool.query(
    `SELECT plan FROM workspace_subscriptions WHERE workspace_id = $1`,
    [workspaceId]
  );
  await pool.query(
    `INSERT INTO workspace_subscriptions (workspace_id, plan, status, updated_at)
     VALUES ($1, $2::plan_id, 'active', now())
     ON CONFLICT (workspace_id) DO UPDATE SET plan = $2::plan_id, status = 'active', updated_at = now()`,
    [workspaceId, plan]
  );

  await auditLog({
    actorUserId: ctx.userId,
    actorEmail: ctx.email,
    workspaceId,
    action: "plan.change",
    details: { from: before.rows[0]?.plan ?? null, to: plan },
  });

  return Response.json({ ok: true, plan });
}
