/**
 * Partner-code redemption — design-partner pilots share one workspace + plan.
 */
import { randomUUID } from "crypto";
import type { Pool, PoolClient } from "pg";
import { isPlanId, type PlanId } from "./billing/catalog";

export type Db = Pool | PoolClient;

export type PartnerCodeErrorCode =
  | "invalid"
  | "inactive"
  | "expired"
  | "exhausted";

export class PartnerCodeError extends Error {
  status: number;
  code: PartnerCodeErrorCode;
  constructor(code: PartnerCodeErrorCode, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export type RedeemResult = {
  workspaceId: string;
  workspaceName: string;
  plan: PlanId;
  role: "OWNER" | "MEMBER";
  alreadyRedeemed: boolean;
  currentPeriodEnd: string | null;
};

type PartnerCodeRow = {
  id: string;
  code: string;
  plan: string;
  workspace_id: string | null;
  workspace_name: string;
  max_redemptions: number;
  redemption_count: number;
  pilot_days: number;
  expires_at: Date | null;
  active: boolean;
};

export function normalizePartnerCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const code = raw.trim().toUpperCase();
  return code.length > 0 ? code : null;
}

function periodEndIso(pilotDays: number): string {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() + pilotDays);
  return end.toISOString();
}

function isPool(db: Db): db is Pool {
  return typeof (db as Pool).connect === "function" && !("release" in db);
}

async function ensureSubscription(
  db: Db,
  workspaceId: string,
  plan: PlanId,
  pilotDays: number
): Promise<string> {
  const periodEnd = periodEndIso(pilotDays);
  await db.query(
    `
    INSERT INTO workspace_subscriptions (
      workspace_id, plan, status, current_period_end, updated_at
    ) VALUES ($1, $2::plan_id, 'active', $3::timestamptz, NOW())
    ON CONFLICT (workspace_id) DO UPDATE SET
      plan = EXCLUDED.plan,
      status = 'active',
      current_period_end = COALESCE(
        GREATEST(workspace_subscriptions.current_period_end, EXCLUDED.current_period_end),
        EXCLUDED.current_period_end
      ),
      updated_at = NOW()
    `,
    [workspaceId, plan, periodEnd]
  );
  return periodEnd;
}

async function redeemInDb(
  q: Db,
  opts: { userId: string; code: string }
): Promise<RedeemResult> {
  const code = normalizePartnerCode(opts.code);
  if (!code) {
    throw new PartnerCodeError("invalid", "Enter a partner code.");
  }

  const { rows } = await q.query<PartnerCodeRow>(
    `SELECT id, code, plan::text AS plan, workspace_id, workspace_name,
            max_redemptions, redemption_count, pilot_days, expires_at, active
       FROM partner_codes
      WHERE code = $1
      FOR UPDATE`,
    [code]
  );
  const row = rows[0];
  if (!row) {
    throw new PartnerCodeError("invalid", "That partner code is not valid.");
  }
  if (!row.active) {
    throw new PartnerCodeError("inactive", "That partner code is no longer active.");
  }
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    throw new PartnerCodeError("expired", "That partner code has expired.");
  }
  if (!isPlanId(row.plan)) {
    throw new PartnerCodeError("invalid", "Partner code plan is misconfigured.");
  }
  const plan = row.plan as PlanId;

  const prior = await q.query<{ workspace_id: string; role: string }>(
    `SELECT r.workspace_id, COALESCE(wm.role, 'MEMBER') AS role
       FROM partner_code_redemptions r
       LEFT JOIN workspace_members wm
         ON wm.workspace_id = r.workspace_id AND wm.user_id = r.user_id
      WHERE r.partner_code_id = $1 AND r.user_id = $2`,
    [row.id, opts.userId]
  );
  if (prior.rows[0]) {
    const workspaceId = prior.rows[0].workspace_id;
    const periodEnd = await ensureSubscription(q, workspaceId, plan, row.pilot_days);
    return {
      workspaceId,
      workspaceName: row.workspace_name,
      plan,
      role: prior.rows[0].role === "OWNER" ? "OWNER" : "MEMBER",
      alreadyRedeemed: true,
      currentPeriodEnd: periodEnd,
    };
  }

  if (row.redemption_count >= row.max_redemptions) {
    throw new PartnerCodeError(
      "exhausted",
      "That partner code has reached its redemption limit."
    );
  }

  let workspaceId = row.workspace_id;
  let role: "OWNER" | "MEMBER" = "MEMBER";

  if (!workspaceId) {
    workspaceId = randomUUID();
    const kind = plan === "partner" || plan === "enterprise" ? "PROFESSIONAL" : "INDIVIDUAL";
    await q.query(
      `INSERT INTO workspaces (id, owner_user_id, name, kind)
       VALUES ($1, $2, $3, $4)`,
      [workspaceId, opts.userId, row.workspace_name, kind]
    );
    await q.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role)
       VALUES ($1, $2, 'OWNER')
       ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = 'OWNER'`,
      [workspaceId, opts.userId]
    );
    await q.query(
      `UPDATE partner_codes SET workspace_id = $2, updated_at = NOW() WHERE id = $1`,
      [row.id, workspaceId]
    );
    role = "OWNER";
  } else {
    await q.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role)
       VALUES ($1, $2, 'MEMBER')
       ON CONFLICT (workspace_id, user_id) DO NOTHING`,
      [workspaceId, opts.userId]
    );
  }

  const periodEnd = await ensureSubscription(q, workspaceId, plan, row.pilot_days);

  await q.query(
    `INSERT INTO partner_code_redemptions (partner_code_id, user_id, workspace_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (partner_code_id, user_id) DO NOTHING`,
    [row.id, opts.userId, workspaceId]
  );
  await q.query(
    `UPDATE partner_codes
        SET redemption_count = redemption_count + 1, updated_at = NOW()
      WHERE id = $1`,
    [row.id]
  );

  return {
    workspaceId,
    workspaceName: row.workspace_name,
    plan,
    role,
    alreadyRedeemed: false,
    currentPeriodEnd: periodEnd,
  };
}

/**
 * Redeem a partner code for an authenticated user.
 * First redeemer creates the pilot workspace (OWNER); later redeemers join as MEMBER.
 * Idempotent per (code, user).
 *
 * Pass `inTransaction: true` when `db` is already inside an open transaction
 * (e.g. auth bootstrap) so we do not nest BEGIN/COMMIT.
 */
export async function redeemPartnerCode(
  db: Db,
  opts: { userId: string; code: string; email?: string | null; inTransaction?: boolean }
): Promise<RedeemResult> {
  if (opts.inTransaction || !isPool(db)) {
    return redeemInDb(db, opts);
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await redeemInDb(client, opts);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export function partnerCodeErrorResponse(err: unknown): Response | null {
  if (err instanceof PartnerCodeError) {
    return Response.json(
      { error: err.message, code: err.code },
      { status: err.status }
    );
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (/partner_codes/i.test(msg) && /does not exist|relation/i.test(msg)) {
    return Response.json(
      {
        error: "Partner codes are not available yet. Apply data/partner_codes_schema.sql.",
        code: "schema_missing",
      },
      { status: 503 }
    );
  }
  return null;
}
