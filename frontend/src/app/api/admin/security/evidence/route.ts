import { requireSecurityAdmin, auditSecurityMutation, jsonOk } from "../_util";
import { getSecurityControl } from "../../../../../lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await requireSecurityAdmin();
  if ("response" in gate) return gate.response;
  try {
    const { rows } = await gate.pool.query(
      `SELECT id::text, control_id, evidence_kind, title, description, artifact_uri,
              recorded_by::text, recorded_at, verified_at, verified_by::text, metadata, created_at
         FROM security_control_evidence
        ORDER BY recorded_at DESC
        LIMIT 500`
    );
    return jsonOk({ evidence: rows });
  } catch (e) {
    return Response.json(
      { error: "schema_missing", detail: (e as Error).message, hint: "Apply data/security_soc2_readiness.sql" },
      { status: 503 }
    );
  }
}

export async function POST(request: Request) {
  const gate = await requireSecurityAdmin();
  if ("response" in gate) return gate.response;
  const body = (await request.json().catch(() => ({}))) as {
    control_id?: string;
    evidence_kind?: string;
    title?: string;
    description?: string;
    artifact_uri?: string;
    verified_at?: string | null;
    metadata?: Record<string, unknown>;
  };
  const controlId = (body.control_id || "").trim();
  const title = (body.title || "").trim();
  const kind = (body.evidence_kind || "").trim();
  if (!controlId || !title || !kind) {
    return Response.json({ error: "control_id, evidence_kind, and title are required" }, { status: 400 });
  }
  if (!getSecurityControl(controlId)) {
    return Response.json({ error: "unknown control_id", control_id: controlId }, { status: 400 });
  }
  // Do not invent verification dates — only accept verified_at if explicitly provided and parseable
  let verifiedAt: string | null = null;
  if (body.verified_at) {
    const t = Date.parse(body.verified_at);
    if (Number.isNaN(t)) return Response.json({ error: "verified_at must be ISO date" }, { status: 400 });
    verifiedAt = new Date(t).toISOString();
  }
  try {
    const { rows } = await gate.pool.query(
      `INSERT INTO security_control_evidence
         (control_id, evidence_kind, title, description, artifact_uri, recorded_by, verified_at, verified_by, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
       RETURNING id::text, control_id, evidence_kind, title, recorded_at, verified_at`,
      [
        controlId,
        kind,
        title,
        body.description ?? null,
        body.artifact_uri ?? null,
        gate.ctx.userId,
        verifiedAt,
        verifiedAt ? gate.ctx.userId : null,
        JSON.stringify(body.metadata ?? {}),
      ]
    );
    await auditSecurityMutation(
      gate.pool,
      request,
      gate.ctx,
      "security.evidence_recorded",
      "security_control_evidence",
      rows[0].id,
      { control_id: controlId, evidence_kind: kind, title }
    );
    return jsonOk({ evidence: rows[0] }, 201);
  } catch (e) {
    return Response.json(
      { error: "schema_missing_or_failed", detail: (e as Error).message },
      { status: 503 }
    );
  }
}
