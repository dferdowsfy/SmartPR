// Phase 6 — service-account revocation.
// POST /api/enterprise/integrations/service-accounts/[id]/revoke?workspace=<id>
//      { reason? }
// Revocation is immediate and irreversible (create + rotate a new account
// instead). The credential hash is kept so a presented revoked token still
// resolves to a clear "revoked" rejection in audit trails.

import { getPool, isEnabled } from "../../../../../../graph/db";
import {
  requireEnterprisePermission,
  writeAuditEvent,
  getRequestMeta,
} from "../../../../../../../lib/enterprise-permissions";
import { redactSecrets } from "../../../../../../../lib/enterprise-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-fA-F-]{36}$/;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const workspaceId = new URL(req.url).searchParams.get("workspace");
  if (!workspaceId || !UUID_RE.test(workspaceId))
    return Response.json({ error: "workspace query param required" }, { status: 400 });
  if (!UUID_RE.test(id)) return Response.json({ error: "invalid account id" }, { status: 400 });

  const gate = await requireEnterprisePermission("manage_integrations", workspaceId);
  if ("response" in gate) return gate.response;
  if (!isEnabled()) return Response.json({ error: "no_database" }, { status: 503 });
  const pool = getPool();
  if (!pool) return Response.json({ error: "no_database" }, { status: 503 });

  const body = (await req.json().catch(() => ({}))) as { reason?: unknown };
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : null;

  const { rows } = await pool.query(
    `UPDATE service_accounts SET revoked = true, updated_at = now()
      WHERE id = $1 AND workspace_id = $2
     RETURNING id::text AS id, name, revoked`,
    [id, workspaceId]
  );
  if (!rows[0]) return Response.json({ error: "not_found" }, { status: 404 });

  const meta = getRequestMeta(req);
  await writeAuditEvent(pool, {
    actorUserId: gate.user.id,
    workspaceId,
    action: "integrations.service_account_revoked",
    targetType: "service_account",
    targetId: id,
    after: redactSecrets({ name: rows[0].name, revoked: true }),
    ip: meta.ip,
    userAgent: meta.userAgent,
    correlationId: meta.correlationId,
    source: "api",
    reason,
  });

  return Response.json({ ok: true, id, revoked: true });
}
