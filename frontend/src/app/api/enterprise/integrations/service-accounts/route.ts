// Phase 6 — service accounts (scoped API identities).
// GET  /api/enterprise/integrations/service-accounts?workspace=<id>
// POST /api/enterprise/integrations/service-accounts?workspace=<id>
//      { name, scopes[], expires_at? } -> returns the raw credential ONCE.
// Only sha256 hashes are stored. Permission: manage_integrations. Audited.

import { getPool, isEnabled } from "../../../../graph/db";
import {
  requireEnterprisePermission,
  writeAuditEvent,
  getRequestMeta,
} from "../../../../../lib/enterprise-permissions";
import {
  hashFingerprint,
  redactSecrets,
} from "../../../../../lib/enterprise-security";
import {
  mintServiceAccountCredential,
  validateServiceAccountScopes,
  SERVICE_ACCOUNT_SCOPES,
} from "../../../../../lib/enterprise-integrations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function workspaceFrom(req: Request): string | null {
  const w = new URL(req.url).searchParams.get("workspace");
  return w && /^[0-9a-fA-F-]{36}$/.test(w) ? w : null;
}

export async function GET(req: Request) {
  const workspaceId = workspaceFrom(req);
  if (!workspaceId) return Response.json({ error: "workspace query param required" }, { status: 400 });
  const gate = await requireEnterprisePermission("manage_integrations", workspaceId);
  if ("response" in gate) return gate.response;
  if (!isEnabled()) return Response.json({ error: "no_database" }, { status: 503 });
  const pool = getPool();
  if (!pool) return Response.json({ error: "no_database" }, { status: 503 });

  const { rows } = await pool.query(
    `SELECT id::text AS id, name, scopes, expires_at, last_used_at, revoked,
            credential_hash, created_at, updated_at
       FROM service_accounts
      WHERE workspace_id = $1
      ORDER BY created_at DESC`,
    [workspaceId]
  );
  const accounts = rows.map((r: Record<string, unknown>) => ({
    id: r.id,
    name: r.name,
    scopes: r.scopes,
    expires_at: r.expires_at,
    expired: r.expires_at ? new Date(String(r.expires_at)).getTime() <= Date.now() : false,
    last_used_at: r.last_used_at,
    revoked: r.revoked === true,
    credential_configured: !!r.credential_hash,
    credential_fingerprint: hashFingerprint(typeof r.credential_hash === "string" ? r.credential_hash : null),
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));
  return Response.json({ accounts: redactSecrets(accounts), scopes: SERVICE_ACCOUNT_SCOPES });
}

export async function POST(req: Request) {
  const workspaceId = workspaceFrom(req);
  if (!workspaceId) return Response.json({ error: "workspace query param required" }, { status: 400 });
  const gate = await requireEnterprisePermission("manage_integrations", workspaceId);
  if ("response" in gate) return gate.response;
  if (!isEnabled()) return Response.json({ error: "no_database" }, { status: 503 });
  const pool = getPool();
  if (!pool) return Response.json({ error: "no_database" }, { status: 503 });

  const body = (await req.json().catch(() => ({}))) as {
    name?: unknown;
    scopes?: unknown;
    expires_at?: unknown;
  };
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 120)
    return Response.json({ error: "name is required (max 120 chars)" }, { status: 400 });

  const sv = validateServiceAccountScopes(body.scopes);
  if (!sv.ok) {
    return Response.json(
      {
        error: sv.invalid.length > 0
          ? `unknown scopes: ${sv.invalid.join(", ")}`
          : "at least one scope is required",
        allowed_scopes: SERVICE_ACCOUNT_SCOPES,
      },
      { status: 400 }
    );
  }

  let expiresAt: string | null = null;
  if (body.expires_at !== undefined && body.expires_at !== null) {
    const t = Date.parse(String(body.expires_at));
    if (Number.isNaN(t)) return Response.json({ error: "expires_at must be an ISO date" }, { status: 400 });
    if (t <= Date.now()) return Response.json({ error: "expires_at must be in the future" }, { status: 400 });
    expiresAt = new Date(t).toISOString();
  }

  const minted = mintServiceAccountCredential();
  const { rows } = await pool.query(
    `INSERT INTO service_accounts (workspace_id, name, scopes, credential_hash, expires_at, revoked)
     VALUES ($1, $2, $3::text[], $4, $5, false)
     RETURNING id::text AS id, name, scopes, expires_at, created_at`,
    [workspaceId, name, sv.scopes, minted.hash, expiresAt]
  );
  const account = rows[0];

  const meta = getRequestMeta(req);
  await writeAuditEvent(pool, {
    actorUserId: gate.user.id,
    workspaceId,
    action: "integrations.service_account_created",
    targetType: "service_account",
    targetId: String(account.id),
    after: redactSecrets({ name: account.name, scopes: account.scopes, expires_at: account.expires_at }),
    ip: meta.ip,
    userAgent: meta.userAgent,
    correlationId: meta.correlationId,
    source: "api",
  });

  return Response.json(
    {
      account: { ...account, revoked: false, credential_configured: true, credential_fingerprint: hashFingerprint(minted.hash) },
      // Shown ONCE. The server stores only the sha256 hash.
      credential: minted.raw,
      warning: "Store this credential now. It is shown once and cannot be retrieved again; rotate to replace it.",
    },
    { status: 201 }
  );
}
