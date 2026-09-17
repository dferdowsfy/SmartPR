import { requireSecurityAdmin, auditSecurityMutation, jsonOk } from "../_util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LEVELS = new Set(["low", "medium", "high"]);
const STATUSES = new Set(["open", "accepted", "mitigating", "closed"]);

export async function GET() {
  const gate = await requireSecurityAdmin();
  if ("response" in gate) return gate.response;
  try {
    const { rows } = await gate.pool.query(
      `SELECT id::text, title, description, likelihood, impact, status, treatment,
              owner_user_id::text, related_control_ids, metadata, created_at, updated_at
         FROM security_risks
        ORDER BY created_at DESC
        LIMIT 200`
    );
    return jsonOk({ risks: rows });
  } catch (e) {
    return Response.json({ error: "schema_missing", detail: (e as Error).message }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const gate = await requireSecurityAdmin();
  if ("response" in gate) return gate.response;
  const body = (await request.json().catch(() => ({}))) as {
    title?: string;
    description?: string;
    likelihood?: string;
    impact?: string;
    status?: string;
    treatment?: string;
    related_control_ids?: string[];
  };
  const title = (body.title || "").trim();
  if (!title) return Response.json({ error: "title required" }, { status: 400 });
  const likelihood = (body.likelihood || "medium").toLowerCase();
  const impact = (body.impact || "medium").toLowerCase();
  const status = (body.status || "open").toLowerCase();
  if (!LEVELS.has(likelihood) || !LEVELS.has(impact)) {
    return Response.json({ error: "likelihood/impact must be low|medium|high" }, { status: 400 });
  }
  if (!STATUSES.has(status)) return Response.json({ error: "invalid status" }, { status: 400 });

  try {
    const { rows } = await gate.pool.query(
      `INSERT INTO security_risks
         (title, description, likelihood, impact, status, treatment, owner_user_id, related_control_ids)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::text[])
       RETURNING id::text, title, likelihood, impact, status, created_at`,
      [
        title,
        body.description ?? null,
        likelihood,
        impact,
        status,
        body.treatment ?? null,
        gate.ctx.userId,
        body.related_control_ids ?? [],
      ]
    );
    await auditSecurityMutation(
      gate.pool,
      request,
      gate.ctx,
      "security.risk_created",
      "security_risk",
      rows[0].id,
      { title, likelihood, impact, status }
    );
    return jsonOk({ risk: rows[0] }, 201);
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
    treatment?: string;
    likelihood?: string;
    impact?: string;
    description?: string;
  };
  if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
  try {
    const { rows } = await gate.pool.query(
      `UPDATE security_risks SET
          status = COALESCE($2, status),
          treatment = COALESCE($3, treatment),
          likelihood = COALESCE($4, likelihood),
          impact = COALESCE($5, impact),
          description = COALESCE($6, description),
          updated_at = now()
        WHERE id = $1
        RETURNING id::text, title, status, likelihood, impact, updated_at`,
      [
        body.id,
        body.status ?? null,
        body.treatment ?? null,
        body.likelihood ?? null,
        body.impact ?? null,
        body.description ?? null,
      ]
    );
    if (!rows[0]) return Response.json({ error: "not_found" }, { status: 404 });
    await auditSecurityMutation(
      gate.pool,
      request,
      gate.ctx,
      "security.risk_updated",
      "security_risk",
      body.id,
      { status: rows[0].status }
    );
    return jsonOk({ risk: rows[0] });
  } catch (e) {
    return Response.json({ error: "schema_missing_or_failed", detail: (e as Error).message }, { status: 503 });
  }
}
