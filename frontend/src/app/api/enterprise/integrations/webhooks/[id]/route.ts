// Phase 6 — single webhook endpoint.
// PATCH  /api/enterprise/integrations/webhooks/[id]?workspace=<id>  { url?, events?, active? }
// DELETE /api/enterprise/integrations/webhooks/[id]?workspace=<id>  (disable; audited)
// Secret rotation lives at POST .../webhooks/[id]/rotate (sibling route).
// Permission: manage_integrations. All mutations audited.

import { getPool, isEnabled } from "../../../../../graph/db";
import {
  requireEnterprisePermission,
  writeAuditEvent,
  getRequestMeta,
} from "../../../../../../lib/enterprise-permissions";
import {
  hashFingerprint,
  redactSecrets,
} from "../../../../../../lib/enterprise-security";
import { isWebhookEvent, mintWebhookSecret, WEBHOOK_EVENTS } from "../../../../../../lib/enterprise-integrations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-fA-F-]{36}$/;

async function loadEndpoint(pool: { query: (t: string, p?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> }, workspaceId: string, id: string) {
  const { rows } = await pool.query(
    `SELECT id::text AS id, url, events, active, secret_hash,
            secret_enc IS NOT NULL AS secret_configured
       FROM webhook_endpoints WHERE id = $1 AND workspace_id = $2`,
    [id, workspaceId]
  );
  return rows[0] ?? null;
}

function gateParams(req: Request, id: string) {
  const workspaceId = new URL(req.url).searchParams.get("workspace");
  if (!workspaceId || !UUID_RE.test(workspaceId)) return { error: "workspace query param required" };
  if (!UUID_RE.test(id)) return { error: "invalid endpoint id" };
  return { workspaceId };
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gp = gateParams(req, id);
  if ("error" in gp) return Response.json({ error: gp.error }, { status: 400 });
  const gate = await requireEnterprisePermission("manage_integrations", gp.workspaceId);
  if ("response" in gate) return gate.response;
  if (!isEnabled()) return Response.json({ error: "no_database" }, { status: 503 });
  const pool = getPool();
  if (!pool) return Response.json({ error: "no_database" }, { status: 503 });

  const before = await loadEndpoint(pool, gp.workspaceId, id);
  if (!before) return Response.json({ error: "not_found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as {
    url?: unknown;
    events?: unknown;
    active?: unknown;
  };
  const updates: string[] = [];
  const args: unknown[] = [];
  const add = (frag: string, v: unknown) => {
    args.push(v);
    updates.push(frag.replace("?", `$${args.length + 2}`));
  };

  if (body.url !== undefined) {
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
    add("url = ?", parsed.toString());
  }
  if (body.events !== undefined) {
    if (!Array.isArray(body.events) || body.events.length === 0)
      return Response.json({ error: "events must be a non-empty array" }, { status: 400 });
    const cleaned = [...new Set(body.events.map((e) => String(e)))];
    for (const e of cleaned) {
      if (e !== "*" && !isWebhookEvent(e))
        return Response.json({ error: `unknown event "${e}"` }, { status: 400 });
    }
    add("events = ?::text[]", cleaned);
  }
  if (body.active !== undefined) {
    if (typeof body.active !== "boolean")
      return Response.json({ error: "active must be a boolean" }, { status: 400 });
    add("active = ?", body.active);
  }
  if (updates.length === 0)
    return Response.json({ error: "no updatable fields provided" }, { status: 400 });

  const { rows } = await pool.query(
    `UPDATE webhook_endpoints SET ${updates.join(", ")}, updated_at = now()
      WHERE id = $1 AND workspace_id = $2
     RETURNING id::text AS id, url, events, active, secret_hash, secret_enc IS NOT NULL AS secret_configured`,
    [id, gp.workspaceId, ...args]
  );
  const after = rows[0];

  const meta = getRequestMeta(req);
  await writeAuditEvent(pool, {
    actorUserId: gate.user.id,
    workspaceId: gp.workspaceId,
    action: "integrations.webhook_updated",
    targetType: "webhook_endpoint",
    targetId: id,
    before: redactSecrets(before),
    after: redactSecrets(after),
    ip: meta.ip,
    userAgent: meta.userAgent,
    correlationId: meta.correlationId,
    source: "api",
  });

  return Response.json({
    endpoint: {
      id: after.id,
      url: after.url,
      events: after.events,
      active: after.active,
      secret_configured: after.secret_configured === true,
      secret_fingerprint: hashFingerprint(typeof after.secret_hash === "string" ? after.secret_hash : null),
    },
  });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gp = gateParams(req, id);
  if ("error" in gp) return Response.json({ error: gp.error }, { status: 400 });
  const gate = await requireEnterprisePermission("manage_integrations", gp.workspaceId);
  if ("response" in gate) return gate.response;
  if (!isEnabled()) return Response.json({ error: "no_database" }, { status: 503 });
  const pool = getPool();
  if (!pool) return Response.json({ error: "no_database" }, { status: 503 });

  const before = await loadEndpoint(pool, gp.workspaceId, id);
  if (!before) return Response.json({ error: "not_found" }, { status: 404 });

  await pool.query(
    `UPDATE webhook_endpoints SET active = false, updated_at = now() WHERE id = $1 AND workspace_id = $2`,
    [id, gp.workspaceId]
  );

  const meta = getRequestMeta(req);
  await writeAuditEvent(pool, {
    actorUserId: gate.user.id,
    workspaceId: gp.workspaceId,
    action: "integrations.webhook_disabled",
    targetType: "webhook_endpoint",
    targetId: id,
    before: redactSecrets(before),
    after: { active: false },
    ip: meta.ip,
    userAgent: meta.userAgent,
    correlationId: meta.correlationId,
    source: "api",
  });
  return Response.json({ ok: true, id, active: false });
}
