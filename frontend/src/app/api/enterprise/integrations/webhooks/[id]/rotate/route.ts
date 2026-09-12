// Phase 6 — webhook signing-secret rotation.
// POST /api/enterprise/integrations/webhooks/[id]/rotate?workspace=<id>
// Issues a new secret; the raw value is returned ONCE and cannot be
// retrieved again. The previous secret stops working immediately.

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
import { mintWebhookSecret } from "../../../../../../../lib/enterprise-integrations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-fA-F-]{36}$/;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const workspaceId = new URL(req.url).searchParams.get("workspace");
  if (!workspaceId || !UUID_RE.test(workspaceId))
    return Response.json({ error: "workspace query param required" }, { status: 400 });
  if (!UUID_RE.test(id)) return Response.json({ error: "invalid endpoint id" }, { status: 400 });

  const gate = await requireEnterprisePermission("manage_integrations", workspaceId);
  if ("response" in gate) return gate.response;
  if (!isEnabled()) return Response.json({ error: "no_database" }, { status: 503 });
  const pool = getPool();
  if (!pool) return Response.json({ error: "no_database" }, { status: 503 });

  const { rows } = await pool.query(
    `SELECT id FROM webhook_endpoints WHERE id = $1 AND workspace_id = $2`,
    [id, workspaceId]
  );
  if (!rows[0]) return Response.json({ error: "not_found" }, { status: 404 });

  let minted: { raw: string; encrypted: string; hash: string };
  try {
    minted = mintWebhookSecret();
  } catch (e) {
    return Response.json(
      { error: "webhook_encryption_unconfigured", detail: (e as Error).message },
      { status: 503 }
    );
  }

  await pool.query(
    `UPDATE webhook_endpoints SET secret_enc = $3, secret_hash = $4, updated_at = now()
      WHERE id = $1 AND workspace_id = $2`,
    [id, workspaceId, minted.encrypted, minted.hash]
  );

  const meta = getRequestMeta(req);
  await writeAuditEvent(pool, {
    actorUserId: gate.user.id,
    workspaceId,
    action: "integrations.webhook_secret_rotated",
    targetType: "webhook_endpoint",
    targetId: id,
    after: redactSecrets({ secret_fingerprint: hashFingerprint(minted.hash) }),
    ip: meta.ip,
    userAgent: meta.userAgent,
    correlationId: meta.correlationId,
    source: "api",
  });

  return Response.json({
    ok: true,
    id,
    secret: minted.raw,
    secret_fingerprint: hashFingerprint(minted.hash),
    warning: "Store this signing secret now. It is shown once and cannot be retrieved again.",
  });
}
