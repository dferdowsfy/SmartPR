// /api/demo/enterprise-seed — enterprise demo lifecycle (Phase 8).
//
// GET  -> { seeded, workspaceId } — is the demo currently seeded?
// POST -> wipe + restore the entire enterprise demo seed
//         ("Caribe Industrial Manufacturing LLC (Demo)"). This IS the Reset
//         Demo integration point: there is no pre-existing Reset Demo in the
//         codebase, so this endpoint provides wipe+restore for the demo
//         workspace (delete cascades through facilities, businesses,
//         obligations, evidence, roles, webhooks, deadlines, regulatory
//         events; audit_events is append-only and survives by design).
//
// Superadmin-only. Audited via the seed itself.

import { getPool, isEnabled } from "../../../../app/graph/db";
import { requireSuperAdmin } from "../../admin/_util";
import { seedEnterpriseDemo, findDemoWorkspace } from "../../../../lib/demo-enterprise-seed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await requireSuperAdmin();
  if ("response" in gate) return gate.response;
  if (!isEnabled()) return Response.json({ error: "no_database" }, { status: 503 });
  const pool = getPool();
  if (!pool) return Response.json({ error: "no_database" }, { status: 503 });
  const workspaceId = await findDemoWorkspace(pool);
  return Response.json({ seeded: !!workspaceId, workspaceId });
}

export async function POST() {
  const gate = await requireSuperAdmin();
  if ("response" in gate) return gate.response;
  const { ctx } = gate;
  if (!isEnabled()) return Response.json({ error: "no_database" }, { status: 503 });
  const pool = getPool();
  if (!pool) return Response.json({ error: "no_database" }, { status: 503 });

  try {
    const summary = await seedEnterpriseDemo(pool, ctx.userId, ctx.email);
    return Response.json({ ok: true, ...summary });
  } catch (e) {
    console.error("[demo-enterprise-seed]", (e as Error).message);
    return Response.json({ error: "Demo seed failed." }, { status: 500 });
  }
}
