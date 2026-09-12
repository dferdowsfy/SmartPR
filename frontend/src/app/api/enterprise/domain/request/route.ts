// POST /api/enterprise/domain/request — start custom-domain verification.
//
// Body: { workspace_id, domain }
// Validates the hostname, lowercases it, and upserts domain_verifications
// with status=pending and a fresh 32-byte-hex dns_token. The caller must then
// publish a TXT record at `_smartpr-challenge.<domain>` with the token value
// and call POST /api/enterprise/domain/verify.
//
// Gate: platform super admin OR `configure_branding_security` permission.
// Audited.

import { randomBytes } from "node:crypto";
import { getPool, isEnabled } from "../../../../../app/graph/db";
import { requireBrandingSecurity } from "../../../../../lib/enterprise-gate";
import { normalizeDomain, challengeHostname } from "../../../../../lib/enterprise-domain";
import { writeAuditEvent, getRequestMeta } from "../../../../../lib/enterprise-permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    workspace_id?: string;
    domain?: string;
  };
  const workspaceId = typeof body.workspace_id === "string" ? body.workspace_id : "";
  const gate = await requireBrandingSecurity(workspaceId);
  if ("response" in gate) return gate.response;
  const { user } = gate;
  if (!isEnabled()) return Response.json({ error: "no_database" }, { status: 503 });
  const pool = getPool();
  if (!pool) return Response.json({ error: "no_database" }, { status: 503 });

  const ws = await pool.query(`SELECT id FROM workspaces WHERE id = $1`, [workspaceId]);
  if (!ws.rows[0]) return Response.json({ error: "workspace not_found" }, { status: 404 });

  const domain = normalizeDomain(body.domain);
  if (!domain) {
    return Response.json({ error: "domain is not a valid hostname" }, { status: 400 });
  }

  // One workspace owns one verification row; a domain may not be claimed by
  // two workspaces at once.
  const clash = await pool.query(
    `SELECT workspace_id::text AS workspace_id, status FROM domain_verifications
      WHERE lower(domain) = $1 AND workspace_id <> $2 LIMIT 1`,
    [domain, workspaceId]
  );
  if (clash.rows[0]) {
    return Response.json(
      { error: "domain is already claimed by another workspace", status: clash.rows[0].status },
      { status: 409 }
    );
  }

  const token = randomBytes(32).toString("hex");
  const before = await pool.query(
    `SELECT domain, status, tls_status FROM domain_verifications WHERE workspace_id = $1`,
    [workspaceId]
  );
  await pool.query(
    `INSERT INTO domain_verifications (workspace_id, domain, dns_token, status, last_attempt_at, last_error, tls_status, updated_at)
     VALUES ($1, $2, $3, 'pending', NULL, NULL, 'unknown', now())
     ON CONFLICT (workspace_id) DO UPDATE SET
       domain = EXCLUDED.domain,
       dns_token = EXCLUDED.dns_token,
       status = 'pending',
       last_attempt_at = NULL,
       last_error = NULL,
       tls_status = 'unknown',
       updated_at = now()`,
    [workspaceId, domain, token]
  );

  const meta = getRequestMeta(request);
  await writeAuditEvent(pool, {
    actorUserId: user.id,
    workspaceId,
    action: "enterprise.domain.request",
    targetType: "domain_verification",
    targetId: workspaceId,
    before: (before.rows[0] as Record<string, unknown> | undefined) ?? null,
    after: { domain, status: "pending" },
    ip: meta.ip,
    userAgent: meta.userAgent,
    correlationId: meta.correlationId,
    source: "api",
  });

  // The token is returned so the UI can display it; it is also stored for the
  // server-side DNS check. Never log it.
  return Response.json({
    ok: true,
    domain,
    status: "pending",
    txt_host: challengeHostname(domain),
    txt_value: token,
  });
}
