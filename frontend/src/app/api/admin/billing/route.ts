import { randomBytes } from "crypto";
import { getPool, isEnabled } from "../../../graph/db";
import { isCurrentUserAdmin } from "../../../../lib/admin";
import { isPlanId, type PlanId } from "../../../../lib/billing/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GrantBody = {
  email?: string;
  plan?: string;
  status?: string;
  createIfMissing?: boolean;
};

function tempPassword(): string {
  // Readable one-time password (no ambiguous chars).
  return randomBytes(9).toString("base64url").slice(0, 12);
}

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
  const createIfMissing = body.createIfMissing !== false;
  if (!email || !plan || !isPlanId(plan)) {
    return Response.json(
      {
        error: "invalid_input",
        message: "Email and plan (free|core|operator|partner|pilot|enterprise) are required.",
      },
      { status: 400 }
    );
  }

  const planId = plan as PlanId;
  const kind = planId === "partner" || planId === "enterprise" ? "PROFESSIONAL" : "INDIVIDUAL";

  let userId: string | null = null;
  let createdUser = false;
  let password: string | null = null;

  const existing = await pool.query(
    `SELECT id, email FROM auth.users WHERE lower(email) = $1 LIMIT 1`,
    [email]
  );
  if (existing.rows[0]) {
    userId = existing.rows[0].id as string;
  } else if (!createIfMissing) {
    return Response.json(
      { error: "user_not_found", message: "That email has not signed up yet." },
      { status: 404 }
    );
  } else {
    password = tempPassword();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query(
        `
        INSERT INTO auth.users (
          instance_id, id, aud, role, email, encrypted_password,
          email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
          created_at, updated_at,
          confirmation_token, recovery_token,
          email_change_token_new, email_change,
          email_change_token_current, phone_change, phone_change_token,
          reauthentication_token, is_sso_user, is_anonymous
        ) VALUES (
          '00000000-0000-0000-0000-000000000000',
          gen_random_uuid(),
          'authenticated',
          'authenticated',
          $1,
          crypt($2, gen_salt('bf')),
          NOW(),
          '{"provider":"email","providers":["email"]}'::jsonb,
          '{}'::jsonb,
          NOW(), NOW(),
          '', '',
          '', '',
          '', '', '',
          '', false, false
        )
        RETURNING id
        `,
        [email, password]
      );
      userId = inserted.rows[0].id as string;
      await client.query(
        `
        INSERT INTO auth.identities (
          id, user_id, identity_data, provider, provider_id,
          last_sign_in_at, created_at, updated_at
        ) VALUES (
          gen_random_uuid(), $1,
          jsonb_build_object('sub', $1::text, 'email', $2),
          'email', $1::text,
          NOW(), NOW(), NOW()
        )
        `,
        [userId, email]
      );
      await client.query("COMMIT");
      createdUser = true;
    } catch (err) {
      await client.query("ROLLBACK");
      const message = err instanceof Error ? err.message : String(err);
      return Response.json(
        { error: "create_user_failed", message },
        { status: 500 }
      );
    } finally {
      client.release();
    }
  }

  if (!userId) {
    return Response.json({ error: "user_missing" }, { status: 500 });
  }

  let workspaceId: string | null = null;
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
  if (wsRes.rows[0]) {
    workspaceId = wsRes.rows[0].id as string;
  } else {
    const local = email.split("@")[0] || "user";
    const created = await pool.query(
      `
      INSERT INTO workspaces (id, owner_user_id, name, kind)
      VALUES (gen_random_uuid(), $1, $2, $3)
      RETURNING id
      `,
      [userId, `${local}'s workspace`, kind]
    );
    workspaceId = created.rows[0].id as string;
    await pool.query(
      `
      INSERT INTO workspace_members (workspace_id, user_id, role)
      VALUES ($1, $2, 'OWNER')
      ON CONFLICT DO NOTHING
      `,
      [workspaceId, userId]
    );
  }

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
    createdUser,
    temporaryPassword: password,
    message: createdUser
      ? `Created account + granted ${planId}. Copy the temporary password now — it won’t be shown again.`
      : `Granted ${planId} to ${email}.`,
  });
}
