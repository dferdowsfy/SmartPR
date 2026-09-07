import { getPool, isEnabled } from "../../../graph/db";
import { isCurrentUserAdmin } from "../../../../lib/admin";
import { isPlanId, type PlanId } from "../../../../lib/billing/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GrantBody = {
  email?: string;
  plan?: string;
  status?: string;
};

export async function GET() {
  if (!(await isCurrentUserAdmin())) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  if (!isEnabled()) {
    return Response.json({ error: "no_database" }, { status: 503 });
  }
  const pool = getPool();
  if (!pool) return Response.json({ error: "no_database" }, { status: 503 });

  const { rows } = await pool.query(
    `
    SELECT
      u.id AS user_id,
      u.email,
      w.id AS workspace_id,
      w.name AS workspace_name,
      w.kind AS workspace_kind,
      wm.role AS member_role,
      ws.plan,
      ws.status AS subscription_status,
      ws.current_period_end,
      ws.updated_at AS subscription_updated_at
    FROM auth.users u
    LEFT JOIN workspace_members wm ON wm.user_id = u.id
    LEFT JOIN workspaces w ON w.id = wm.workspace_id
    LEFT JOIN workspace_subscriptions ws ON ws.workspace_id = w.id
    ORDER BY u.email ASC NULLS LAST, w.created_at ASC NULLS LAST
    LIMIT 500
    `
  );
  return Response.json({ users: rows });
}

export async function POST(request: Request) {
  if (!(await isCurrentUserAdmin())) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  if (!isEnabled()) {
    return Response.json({ error: "no_database" }, { status: 503 });
  }
  const pool = getPool();
  if (!pool) return Response.json({ error: "no_database" }, { status: 503 });

  let body: GrantBody;
  try {
    body = (await request.json()) as GrantBody;
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase();
  const plan = body.plan?.trim();
  const status = (body.status?.trim() || "active").toLowerCase();
  if (!email || !plan || !isPlanId(plan)) {
    return Response.json(
      { error: "email and valid plan (free|core|operator|partner|pilot|enterprise) required" },
      { status: 400 }
    );
  }

  const userRes = await pool.query(
    `SELECT id, email FROM auth.users WHERE lower(email) = $1 LIMIT 1`,
    [email]
  );
  if (!userRes.rows[0]) {
    return Response.json(
      { error: "user_not_found", message: "That email has not signed up yet." },
      { status: 404 }
    );
  }
  const userId = userRes.rows[0].id as string;

  const wsRes = await pool.query(
    `
    SELECT w.id
    FROM workspaces w
    JOIN workspace_members wm ON wm.workspace_id = w.id
    WHERE wm.user_id = $1
    ORDER BY CASE WHEN wm.role = 'OWNER' THEN 0 ELSE 1 END, w.created_at ASC
    LIMIT 1
    `,
    [userId]
  );
  if (!wsRes.rows[0]) {
    return Response.json(
      { error: "no_workspace", message: "User exists but has no workspace yet." },
      { status: 404 }
    );
  }
  const workspaceId = wsRes.rows[0].id as string;
  const planId = plan as PlanId;
  const kind = planId === "partner" || planId === "enterprise" ? "PROFESSIONAL" : "INDIVIDUAL";

  await pool.query(`UPDATE workspaces SET kind = $2 WHERE id = $1`, [workspaceId, kind]);
  await pool.query(
    `
    INSERT INTO workspace_subscriptions (
      workspace_id, plan, status,
      stripe_customer_id, stripe_subscription_id, stripe_price_id,
      current_period_end, updated_at
    ) VALUES ($1, $2, $3, NULL, NULL, NULL, NULL, NOW())
    ON CONFLICT (workspace_id) DO UPDATE SET
      plan = EXCLUDED.plan,
      status = EXCLUDED.status,
      updated_at = NOW()
    `,
    [workspaceId, planId, status]
  );

  return Response.json({
    ok: true,
    email,
    workspaceId,
    plan: planId,
    status,
    kind,
  });
}
