import { getPool, isEnabled } from "../../../graph/db";
import { getCurrentUser } from "../../../../lib/supabase/server";
import { ensureUserWorkspace } from "../../../compliance/server";
import { entitlementsFor } from "../../../../lib/billing/entitlements";
import {
  countWorkspaceBusinesses,
  countWorkspaceSeats,
  getWorkspacePlanState,
} from "../../../../lib/billing/access";
import { isUserAdmin } from "../../../../lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!isEnabled()) {
    return Response.json({
      planId: "free",
      status: "free",
      entitlements: entitlementsFor("free"),
      usage: { businesses: 0, seats: 0 },
      admin: false,
    });
  }
  const pool = getPool();
  if (!pool) return Response.json({ error: "no_database" }, { status: 503 });
  const workspaceId = await ensureUserWorkspace(pool, user);
  const admin = await isUserAdmin(user.email);
  const state = admin
    ? { planId: "enterprise" as const, status: "active" }
    : await getWorkspacePlanState(pool, workspaceId);
  const [businesses, seats] = await Promise.all([
    countWorkspaceBusinesses(pool, workspaceId),
    countWorkspaceSeats(pool, workspaceId),
  ]);
  return Response.json({
    workspaceId,
    planId: state.planId,
    status: state.status,
    entitlements: entitlementsFor(state.planId),
    usage: { businesses, seats },
    admin,
    upgradeUrl: "/pricing",
  });
}
