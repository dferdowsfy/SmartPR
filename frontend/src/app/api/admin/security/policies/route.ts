import { requireSecurityAdmin, auditSecurityMutation, jsonOk } from "../_util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES = new Set(["draft", "active", "retired"]);

export async function GET() {
  const gate = await requireSecurityAdmin();
  if ("response" in gate) return gate.response;
  try {
    const { rows } = await gate.pool.query(
      `SELECT id::text, key, title, version, status, doc_uri, summary,
              approved_at, approved_by::text, approval_notes, metadata, created_at, updated_at
         FROM security_policies
        ORDER BY key ASC`
    );
    return jsonOk({
      policies: rows,
      note: "Approval fields are null until a real approval is recorded. No fabricated approvals.",
    });
  } catch (e) {
    return Response.json({ error: "schema_missing", detail: (e as Error).message }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const gate = await requireSecurityAdmin();
  if ("response" in gate) return gate.response;
  const body = (await request.json().catch(() => ({}))) as {
    key?: string;
    title?: string;
    version?: string;
    status?: string;
    doc_uri?: string;
    summary?: string;
    /** Only set when a real approval occurred — never invent */
    mark_approved?: boolean;
    approval_notes?: string;
  };
  const key = (body.key || "").trim().toLowerCase().replace(/\s+/g, "_");
  const title = (body.title || "").trim();
  if (!key || !title) return Response.json({ error: "key and title required" }, { status: 400 });
  const status = (body.status || "draft").toLowerCase();
  if (!STATUSES.has(status)) return Response.json({ error: "invalid status" }, { status: 400 });

  const approved = body.mark_approved === true;
  try {
    const { rows } = await gate.pool.query(
      `INSERT INTO security_policies
         (key, title, version, status, doc_uri, summary, approved_at, approved_by, approval_notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (key) DO UPDATE SET
         title = EXCLUDED.title,
         version = EXCLUDED.version,
         status = EXCLUDED.status,
         doc_uri = COALESCE(EXCLUDED.doc_uri, security_policies.doc_uri),
         summary = COALESCE(EXCLUDED.summary, security_policies.summary),
         approved_at = CASE WHEN $10 THEN EXCLUDED.approved_at ELSE security_policies.approved_at END,
         approved_by = CASE WHEN $10 THEN EXCLUDED.approved_by ELSE security_policies.approved_by END,
         approval_notes = CASE WHEN $10 THEN EXCLUDED.approval_notes ELSE security_policies.approval_notes END,
         updated_at = now()
       RETURNING id::text, key, title, version, status, approved_at`,
      [
        key,
        title,
        body.version || "0.1.0",
        status,
        body.doc_uri ?? null,
        body.summary ?? null,
        approved ? new Date().toISOString() : null,
        approved ? gate.ctx.userId : null,
        approved ? (body.approval_notes ?? null) : null,
        approved,
      ]
    );
    await auditSecurityMutation(
      gate.pool,
      request,
      gate.ctx,
      "security.policy_recorded",
      "security_policy",
      rows[0].id,
      { key, title, status, approved }
    );
    return jsonOk({ policy: rows[0] }, 201);
  } catch (e) {
    return Response.json({ error: "schema_missing_or_failed", detail: (e as Error).message }, { status: 503 });
  }
}
