// Superadmin contract entitlements for a workspace: GET (current merged view),
// PUT (merge a patch into workspace_subscriptions.entitlements jsonb).
//
// The plan itself stays on the plan_id enum (edited in the existing Plan tab);
// this endpoint only manages the per-company contract overrides. Every change
// is audited (source='superadmin').
import { getPool, isEnabled } from "../../../../../graph/db";
import { requireSuperAdmin, auditLog } from "../../../_util";
import {
  writeAuditEvent,
  getRequestMeta,
} from "../../../../../../lib/enterprise-permissions";
import {
  getContractEntitlements,
  setContractEntitlements,
} from "../../../../../../lib/enterprise/workspaceRoles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSuperAdmin();
  if ("response" in gate) return gate.response;
  if (!isEnabled()) return Response.json({ error: "no_database" }, { status: 503 });
  const pool = getPool();
  if (!pool) return Response.json({ error: "no_database" }, { status: 503 });
  const { id: workspaceId } = await params;

  const entitlements = await getContractEntitlements(pool, workspaceId);
  const sub = await pool.query(
    `SELECT plan::text AS plan, status FROM workspace_subscriptions WHERE workspace_id = $1`,
    [workspaceId]
  );
  return Response.json({
    plan: sub.rows[0]?.plan ?? "free",
    plan_status: sub.rows[0]?.status ?? null,
    entitlements,
  });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSuperAdmin();
  if ("response" in gate) return gate.response;
  if (!isEnabled()) return Response.json({ error: "no_database" }, { status: 503 });
  const pool = getPool();
  if (!pool) return Response.json({ error: "no_database" }, { status: 503 });
  const ctx = gate.ctx;
  const meta = getRequestMeta(request);
  const { id: workspaceId } = await params;

  const ws = await pool.query(`SELECT 1 FROM workspaces WHERE id = $1`, [workspaceId]);
  if (!ws.rows[0]) return Response.json({ error: "not_found" }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const before = await getContractEntitlements(pool, workspaceId);
  const after = await setContractEntitlements(workspaceId, body);

  await writeAuditEvent(pool, {
    actorUserId: ctx.userId,
    workspaceId,
    action: "contract_entitlements.updated",
    targetType: "workspace",
    targetId: workspaceId,
    before,
    after,
    ip: meta.ip,
    userAgent: meta.userAgent,
    correlationId: meta.correlationId,
    source: "superadmin",
  });
  await auditLog({
    actorUserId: ctx.userId,
    actorEmail: ctx.email,
    workspaceId,
    action: "contract_entitlements.updated",
    details: { patch: body },
  });

  return Response.json({ ok: true, entitlements: after });
}
