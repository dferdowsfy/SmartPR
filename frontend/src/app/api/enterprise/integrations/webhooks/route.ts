// Phase 6 — webhook endpoint management.
// GET  /api/enterprise/integrations/webhooks?workspace=<id>
// POST /api/enterprise/integrations/webhooks?workspace=<id>
//      { url, events[] } -> creates endpoint; returns the raw signing secret
//      ONCE. Requires ENTERPRISE_WEBHOOK_ENC_KEY or creation is refused.
// GETs never return secrets: only `secret_configured: boolean`.
// Permission: manage_integrations. All mutations audited.

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
import { isWebhookEvent, mintWebhookSecret, WEBHOOK_EVENTS } from "../../../../../lib/enterprise-integrations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function workspaceFrom(req: Request): string | null {
  const w = new URL(req.url).searchParams.get("workspace");
  return w && /^[0-9a-fA-F-]{36}$/.test(w) ? w : null;
}

function validateEvents(events: unknown): { ok: true; events: string[] } | { ok: false; error: string } {
  if (!Array.isArray(events) || events.length === 0)
    return { ok: false, error: `events must be a non-empty array (choose from: ${WEBHOOK_EVENTS.join(", ")})` };
  const cleaned = [...new Set(events.map((e) => String(e)))];
  for (const e of cleaned) {
    if (e !== "*" && !isWebhookEvent(e))
      return { ok: false, error: `unknown event "${e}" (choose from: ${WEBHOOK_EVENTS.join(", ")})` };
  }
  return { ok: true, events: cleaned };
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
    `SELECT we.id::text AS id, we.url, we.events, we.active,
            we.secret_enc IS NOT NULL AS secret_configured,
            we.secret_hash,
            we.created_at, we.updated_at,
            (SELECT count(*) FROM webhook_deliveries d
              WHERE d.endpoint_id = we.id AND d.created_at > now() - interval '7 days') AS deliveries_7d,
            (SELECT count(*) FROM webhook_deliveries d
              WHERE d.endpoint_id = we.id AND d.status = 'failed' AND d.created_at > now() - interval '7 days') AS failed_7d
       FROM webhook_endpoints we
      WHERE we.workspace_id = $1
      ORDER BY we.created_at DESC`,
    [workspaceId]
  );
  const endpoints = rows.map((r: Record<string, unknown>) => ({
    id: r.id,
    url: r.url,
    events: r.events,
    active: r.active,
    secret_configured: r.secret_configured === true,
    secret_fingerprint: hashFingerprint(typeof r.secret_hash === "string" ? r.secret_hash : null),
    deliveries_7d: Number(r.deliveries_7d) || 0,
    failed_7d: Number(r.failed_7d) || 0,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));
  return Response.json({ endpoints: redactSecrets(endpoints), events: WEBHOOK_EVENTS });
}

export async function POST(req: Request) {
  const workspaceId = workspaceFrom(req);
  if (!workspaceId) return Response.json({ error: "workspace query param required" }, { status: 400 });
  const gate = await requireEnterprisePermission("manage_integrations", workspaceId);
  if ("response" in gate) return gate.response;
  if (!isEnabled()) return Response.json({ error: "no_database" }, { status: 503 });
  const pool = getPool();
  if (!pool) return Response.json({ error: "no_database" }, { status: 503 });

  const body = (await req.json().catch(() => ({}))) as { url?: unknown; events?: unknown };
  const url = typeof body.url === "string" ? body.url.trim() : "";
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return Response.json({ error: "url must be an absolute URL" }, { status: 400 });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return Response.json({ error: "url must use http(s)" }, { status: 400 });
  }
  const ev = validateEvents(body.events);
  if (!ev.ok) return Response.json({ error: ev.error }, { status: 400 });

  // Honest boundary: without an encryption key we refuse to store secrets.
  let minted: { raw: string; encrypted: string; hash: string };
  try {
    minted = mintWebhookSecret();
  } catch (e) {
    return Response.json(
      {
        error: "webhook_encryption_unconfigured",
        detail: (e as Error).message,
      },
      { status: 503 }
    );
  }

  const { rows } = await pool.query(
    `INSERT INTO webhook_endpoints (workspace_id, url, secret_enc, secret_hash, events, active)
     VALUES ($1, $2, $3, $4, $5::text[], true)
     RETURNING id::text AS id, url, events, active, created_at`,
    [workspaceId, parsed.toString(), minted.encrypted, minted.hash, ev.events]
  );
  const endpoint = rows[0];

  const meta = getRequestMeta(req);
  await writeAuditEvent(pool, {
    actorUserId: gate.user.id,
    workspaceId,
    action: "integrations.webhook_created",
    targetType: "webhook_endpoint",
    targetId: String(endpoint.id),
    after: redactSecrets({ url: endpoint.url, events: endpoint.events }),
    ip: meta.ip,
    userAgent: meta.userAgent,
    correlationId: meta.correlationId,
    source: "api",
  });

  return Response.json(
    {
      endpoint: {
        ...endpoint,
        secret_configured: true,
        secret_fingerprint: hashFingerprint(minted.hash),
      },
      // Shown ONCE. Store it now — it cannot be retrieved again.
      secret: minted.raw,
      warning: "Store this signing secret now. It is shown once and cannot be retrieved again; rotate to replace it.",
    },
    { status: 201 }
  );
}
