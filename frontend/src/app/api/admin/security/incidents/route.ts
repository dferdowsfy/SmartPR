import { requireSecurityAdmin, auditSecurityMutation, jsonOk } from "../_util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SEVERITIES = new Set(["low", "medium", "high", "critical"]);
const STATUSES = new Set(["open", "investigating", "contained", "resolved", "closed"]);

export async function GET() {
  const gate = await requireSecurityAdmin();
  if ("response" in gate) return gate.response;
  try {
    const { rows } = await gate.pool.query(
      `SELECT id::text, title, summary, severity, status, detected_at, contained_at, resolved_at,
              reported_by::text, owner_user_id::text, workspace_id::text, timeline, metadata, created_at, updated_at
         FROM security_incidents
        ORDER BY detected_at DESC
        LIMIT 200`
    );
    return jsonOk({ incidents: rows });
  } catch (e) {
    return Response.json({ error: "schema_missing", detail: (e as Error).message }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const gate = await requireSecurityAdmin();
  if ("response" in gate) return gate.response;
  const body = (await request.json().catch(() => ({}))) as {
    title?: string;
    summary?: string;
    severity?: string;
    status?: string;
    workspace_id?: string | null;
    timeline?: unknown[];
    metadata?: Record<string, unknown>;
  };
  const title = (body.title || "").trim();
  if (!title) return Response.json({ error: "title required" }, { status: 400 });
  const severity = (body.severity || "medium").toLowerCase();
  const status = (body.status || "open").toLowerCase();
  if (!SEVERITIES.has(severity)) return Response.json({ error: "invalid severity" }, { status: 400 });
  if (!STATUSES.has(status)) return Response.json({ error: "invalid status" }, { status: 400 });

  try {
    const { rows } = await gate.pool.query(
      `INSERT INTO security_incidents
         (title, summary, severity, status, reported_by, workspace_id, timeline, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb)
       RETURNING id::text, title, severity, status, detected_at`,
      [
        title,
        body.summary ?? null,
        severity,
        status,
        gate.ctx.userId,
        body.workspace_id || null,
        JSON.stringify(body.timeline ?? []),
        JSON.stringify(body.metadata ?? {}),
      ]
    );
    await auditSecurityMutation(
      gate.pool,
      request,
      gate.ctx,
      "security.incident_created",
      "security_incident",
      rows[0].id,
      { title, severity, status }
    );
    return jsonOk({ incident: rows[0] }, 201);
  } catch (e) {
    return Response.json({ error: "schema_missing_or_failed", detail: (e as Error).message }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  const gate = await requireSecurityAdmin();
  if ("response" in gate) return gate.response;
  const body = (await request.json().catch(() => ({}))) as {
    id?: string;
    status?: string;
    summary?: string;
    severity?: string;
    contained_at?: string | null;
    resolved_at?: string | null;
    timeline?: unknown[];
  };
  if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
  if (body.status && !STATUSES.has(body.status)) {
    return Response.json({ error: "invalid status" }, { status: 400 });
  }
  if (body.severity && !SEVERITIES.has(body.severity)) {
    return Response.json({ error: "invalid severity" }, { status: 400 });
  }
  try {
    const { rows } = await gate.pool.query(
      `UPDATE security_incidents SET
          status = COALESCE($2, status),
          summary = COALESCE($3, summary),
          severity = COALESCE($4, severity),
          contained_at = COALESCE($5::timestamptz, contained_at),
          resolved_at = COALESCE($6::timestamptz, resolved_at),
          timeline = COALESCE($7::jsonb, timeline),
          updated_at = now()
        WHERE id = $1
        RETURNING id::text, title, status, severity, updated_at`,
      [
        body.id,
        body.status ?? null,
        body.summary ?? null,
        body.severity ?? null,
        body.contained_at ?? null,
        body.resolved_at ?? null,
        body.timeline ? JSON.stringify(body.timeline) : null,
      ]
    );
    if (!rows[0]) return Response.json({ error: "not_found" }, { status: 404 });
    await auditSecurityMutation(
      gate.pool,
      request,
      gate.ctx,
      "security.incident_updated",
      "security_incident",
      body.id,
      { status: rows[0].status, severity: rows[0].severity }
    );
    return jsonOk({ incident: rows[0] });
  } catch (e) {
    return Response.json({ error: "schema_missing_or_failed", detail: (e as Error).message }, { status: 503 });
  }
}
