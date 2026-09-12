// Phase 6 — service-account credential rotation.
// POST /api/enterprise/integrations/service-accounts/[id]/rotate?workspace=<id>
// Issues a new credential (raw shown ONCE); the old one stops working
// immediately. A revoked account cannot be rotated — create a new one.

import { getPool, isEnabled } from "../../../../../../graph/db";
import {
  requireEnterprisePermission,
  writeAuditEvent,
  getRequestMeta,
} from "../../../../../../../lib/enterprise-permissions";
import {
  hashFingerprint,
  redactSecrets,
} from "../../../../../../../lib/enterprise-security";
import { mintServiceAccountCredential } from "../../../../../../../lib/enterprise-integrations";

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

  const { rows } = await pool.query(
    `SELECT revoked FROM service_accounts WHERE id = $1 AND workspace_id = $2`,
    [id, workspaceId]
  );
  if (!rows[0]) return Response.json({ error: "not_found" }, { status: 404 });
  if (rows[0].revoked === true)
    return Response.json({ error: "account is revoked; create a new service account instead" }, { status: 409 });

  const minted = mintServiceAccountCredential();
  await pool.query(
    `UPDATE service_accounts SET credential_hash = $3, updated_at = now()
      WHERE id = $1 AND workspace_id = $2`,
    [id, workspaceId, minted.hash]
  );

  const meta = getRequestMeta(req);
  await writeAuditEvent(pool, {
    actorUserId: gate.user.id,
    workspaceId,
    action: "integrations.service_account_rotated",
    targetType: "service_account",
    targetId: id,
    after: redactSecrets({ credential_fingerprint: hashFingerprint(minted.hash) }),
    ip: meta.ip,
    userAgent: meta.userAgent,
    correlationId: meta.correlationId,
    source: "api",
  });

  return Response.json({
    ok: true,
    id,
    credential: minted.raw,
    credential_fingerprint: hashFingerprint(minted.hash),
    warning: "Store this credential now. It is shown once and cannot be retrieved again.",
  });
}
