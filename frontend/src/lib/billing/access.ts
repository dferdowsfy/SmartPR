/**
 * Server-side plan access checks against workspace_subscriptions.
 */
import type { Pool, PoolClient } from "pg";
import {
  canAddBusiness,
  canExportDeliverables,
  canInviteSeat,
  canUseRadar,
  entitlementsFor,
  type WorkspacePlanState,
} from "./entitlements";
import type { PlanId } from "./catalog";
import { isPlanId } from "./catalog";
import { isUserAdmin } from "../admin";

type Db = Pool | PoolClient;

export class PlanGateError extends Error {
  status = 402;
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export async function getWorkspacePlanState(
  db: Db,
  workspaceId: string
): Promise<WorkspacePlanState> {
  try {
    const { rows } = await db.query<{ plan: string; status: string }>(
      `SELECT plan, status FROM workspace_subscriptions WHERE workspace_id = $1 LIMIT 1`,
      [workspaceId]
    );
    const row = rows[0];
    if (row && isPlanId(row.plan)) {
      return { planId: row.plan as PlanId, status: row.status || "active" };
    }
  } catch {
    // Table may not exist in older envs — treat as free.
  }
  return { planId: "free", status: "free" };
}

export async function countWorkspaceBusinesses(
  db: Db,
  workspaceId: string
): Promise<number> {
  const { rows } = await db.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM businesses
      WHERE workspace_id = $1 AND archived = false`,
    [workspaceId]
  );
  return Number(rows[0]?.n || 0);
}

export async function countWorkspaceSeats(
  db: Db,
  workspaceId: string
): Promise<number> {
  const { rows } = await db.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM workspace_members WHERE workspace_id = $1`,
    [workspaceId]
  );
  return Number(rows[0]?.n || 0);
}

async function adminBypass(email: string | null | undefined): Promise<boolean> {
  return isUserAdmin(email);
}

export async function assertCanAddBusinesses(
  db: Db,
  opts: {
    workspaceId: string;
    email?: string | null;
    adding?: number;
  }
): Promise<WorkspacePlanState> {
  if (await adminBypass(opts.email)) {
    return { planId: "enterprise", status: "active" };
  }
  const state = await getWorkspacePlanState(db, opts.workspaceId);
  const current = await countWorkspaceBusinesses(db, opts.workspaceId);
  const adding = opts.adding ?? 1;
  // Check each incremental add against limit.
  for (let i = 0; i < adding; i++) {
    if (!canAddBusiness(state, current + i)) {
      const ent = entitlementsFor(state.planId);
      throw new PlanGateError(
        "plan_business_limit",
        `Your ${state.planId} plan allows ${ent.maxBusinesses} business(es). Upgrade at /pricing.`
      );
    }
  }
  return state;
}

export async function assertCanInviteSeat(
  db: Db,
  opts: { workspaceId: string; email?: string | null }
): Promise<WorkspacePlanState> {
  if (await adminBypass(opts.email)) {
    return { planId: "enterprise", status: "active" };
  }
  const state = await getWorkspacePlanState(db, opts.workspaceId);
  const current = await countWorkspaceSeats(db, opts.workspaceId);
  if (!canInviteSeat(state, current)) {
    const ent = entitlementsFor(state.planId);
    throw new PlanGateError(
      "plan_seat_limit",
      `Your ${state.planId} plan allows ${ent.maxSeats} seat(s). Upgrade at /pricing.`
    );
  }
  return state;
}

export async function assertCanUseDeliverables(
  db: Db,
  opts: { workspaceId: string; email?: string | null }
): Promise<WorkspacePlanState> {
  if (await adminBypass(opts.email)) {
    return { planId: "enterprise", status: "active" };
  }
  const state = await getWorkspacePlanState(db, opts.workspaceId);
  if (!canExportDeliverables(state)) {
    throw new PlanGateError(
      "plan_deliverables_locked",
      `Deliverables are not included on the ${state.planId} plan. Upgrade at /pricing.`
    );
  }
  return state;
}

export async function assertCanUseRadar(
  db: Db,
  opts: { workspaceId: string; email?: string | null }
): Promise<WorkspacePlanState> {
  if (await adminBypass(opts.email)) {
    return { planId: "enterprise", status: "active" };
  }
  const state = await getWorkspacePlanState(db, opts.workspaceId);
  if (!canUseRadar(state)) {
    throw new PlanGateError(
      "plan_radar_locked",
      `Entry Radar is not included on the ${state.planId} plan. Upgrade at /pricing.`
    );
  }
  return state;
}

export function gateJson(err: unknown): Response | null {
  if (err instanceof PlanGateError) {
    return Response.json(
      { error: err.message, code: err.code, upgradeUrl: "/pricing" },
      { status: err.status }
    );
  }
  return null;
}
