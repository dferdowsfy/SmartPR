// Phase 6 — webhook delivery history.
// GET /api/enterprise/integrations/webhooks/[id]/deliveries?workspace=<id>
//     [&status=delivered|failed|pending|skipped|disabled] [&limit=50] [&format=csv]
// Shows status, attempts, next retry, and HTTP response status per delivery.
// Signatures are HMACs of the body (safe to display); payloads are redacted.

import { getPool, isEnabled } from "../../../../../../graph/db";
import { requireEnterprisePermission } from "../../../../../../../lib/enterprise-permissions";
import { redactSecrets } from "../../../../../../../lib/enterprise-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-fA-F-]{36}$/;
const STATUSES = ["pending", "delivered", "failed", "skipped", "disabled"] as const;

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  const workspaceId = url.searchParams.get("workspace");
  if (!workspaceId || !UUID_RE.test(workspaceId))
    return Response.json({ error: "workspace query param required" }, { status: 400 });
  if (!UUID_RE.test(id)) return Response.json({ error: "invalid endpoint id" }, { status: 400 });

  const gate = await requireEnterprisePermission("manage_integrations", workspaceId);
  if ("response" in gate) return gate.response;
  if (!isEnabled()) return Response.json({ error: "no_database" }, { status: 503 });
  const pool = getPool();
  if (!pool) return Response.json({ error: "no_database" }, { status: 503 });

  const ep = await pool.query(
    `SELECT id FROM webhook_endpoints WHERE id = $1 AND workspace_id = $2`,
    [id, workspaceId]
  );
  if (!ep.rows[0]) return Response.json({ error: "not_found" }, { status: 404 });

  const status = url.searchParams.get("status");
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 1), 500);
  const conditions = ["d.endpoint_id = $1"];
  const args: unknown[] = [id];
  if (status) {
    if (!(STATUSES as readonly string[]).includes(status))
      return Response.json({ error: `status must be one of ${STATUSES.join(", ")}` }, { status: 400 });
    conditions.push(`d.status = $${args.length + 1}`);
    args.push(status);
  }

  const { rows } = await pool.query(
    `SELECT d.id::text AS id, d.event_type, d.status, d.attempts,
            d.next_retry_at, d.response_status, d.signature, d.payload, d.created_at
       FROM webhook_deliveries d
      WHERE ${conditions.join(" AND ")}
      ORDER BY d.created_at DESC
      LIMIT $${args.length + 1}`,
    [...args, limit]
  );

  const deliveries = rows.map((r: Record<string, unknown>) => ({
    id: r.id,
    event_type: r.event_type,
    status: r.status,
    attempts: r.attempts,
    next_retry_at: r.next_retry_at,
    response_status: r.response_status,
    signature: r.signature,
    payload: redactSecrets(
      typeof r.payload === "string" ? (() => { try { return JSON.parse(r.payload); } catch { return null; } })() : r.payload
    ),
    created_at: r.created_at,
  }));

  if (url.searchParams.get("format") === "csv") {
    const header = "id,event_type,status,attempts,next_retry_at,response_status,signature,created_at";
    const lines = deliveries.map((d: Record<string, unknown>) =>
      [
        d.id, d.event_type, d.status, d.attempts, d.next_retry_at,
        d.response_status, d.signature, d.created_at,
      ].map(csvEscape).join(",")
    );
    return new Response([header, ...lines].join("\n"), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="webhook-deliveries-${id.slice(0, 8)}.csv"`,
      },
    });
  }

  return Response.json({ deliveries: redactSecrets(deliveries) });
}
