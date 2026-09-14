// Regulatory developments recorded by the monthly scan.
//
// GET  /api/compliance/regulatory-developments
//   Lists verified (non-superseded) developments, newest first. Used by the
//   digest cron internally and by future UI.
//
// POST /api/compliance/regulatory-developments
//   Records one finding from the scan pass. Guarded by x-cron-secret (the
//   same secret as the cron endpoints) — findings are entered by the
//   scheduled research pass, never invented by the app.
//
// A finding reaches the digest only after a human reviewer promotes it to
// review_status='verified'. POST creates findings as 'unreviewed' unless the
// caller explicitly passes review_status='verified' (the scan pass may do so
// when the finding was verified against a primary source during research).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { getPool } from "../../../graph/db";

function cronAuthorized(req: Request): boolean {
  const secret = process.env.COMPLIANCE_CRON_SECRET;
  if (!secret) return false;
  const given = req.headers.get("x-cron-secret");
  if (!given || given.length !== secret.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ secret.charCodeAt(i);
  return diff === 0;
}

const CONFIDENCES = new Set(["high", "medium", "low"]);
const REVIEW_STATUSES = new Set(["unreviewed", "verified", "superseded"]);

function strArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean);
}

export async function GET(req: Request) {
  if (!cronAuthorized(req)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const pool = getPool();
  if (!pool) return Response.json({ error: "Database unavailable." }, { status: 503 });
  const { rows } = await pool.query(
    `SELECT id::text AS id, title, summary, source_name, source_url,
            published_date::text AS published_date, effective_date::text AS effective_date,
            affected_requirement_codes, agency_names, municipalities,
            business_types, industries, requirement_names,
            applicability_notes, recommended_action, confidence, review_status,
            recorded_at::text AS recorded_at
       FROM regulatory_developments
      WHERE review_status IN ('verified', 'unreviewed')
      ORDER BY published_date DESC NULLS LAST, recorded_at DESC
      LIMIT 200`
  );
  return Response.json({ ok: true, developments: rows });
}

export async function POST(req: Request) {
  if (!cronAuthorized(req)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const pool = getPool();
  if (!pool) return Response.json({ error: "Database unavailable." }, { status: 503 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const summary = typeof body.summary === "string" ? body.summary.trim() : "";
  const sourceName = typeof body.source_name === "string" ? body.source_name.trim() : "";
  const sourceUrl = typeof body.source_url === "string" ? body.source_url.trim() : "";
  if (!title || !summary || !sourceName || !sourceUrl) {
    return Response.json(
      { error: "title, summary, source_name, and source_url are required." },
      { status: 400 }
    );
  }
  // A source URL must be real and authoritative-leaning: https required.
  try {
    const u = new URL(sourceUrl);
    if (u.protocol !== "https:") throw new Error("not https");
  } catch {
    return Response.json({ error: "source_url must be a valid https URL." }, { status: 400 });
  }

  const confidence = typeof body.confidence === "string" && CONFIDENCES.has(body.confidence)
    ? body.confidence
    : "medium";
  const reviewStatus =
    typeof body.review_status === "string" && REVIEW_STATUSES.has(body.review_status)
      ? body.review_status
      : "unreviewed";
  const dateOrNull = (v: unknown): string | null =>
    typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;

  const { rows } = await pool.query(
    `INSERT INTO regulatory_developments
       (title, summary, source_name, source_url, published_date, effective_date,
        affected_requirement_codes, agency_names, municipalities, business_types,
        industries, requirement_names, applicability_notes, recommended_action,
        confidence, review_status, recorded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'scan')
     RETURNING id::text AS id`,
    [
      title,
      summary,
      sourceName,
      sourceUrl,
      dateOrNull(body.published_date),
      dateOrNull(body.effective_date),
      strArray(body.affected_requirement_codes),
      strArray(body.agency_names),
      strArray(body.municipalities),
      strArray(body.business_types),
      strArray(body.industries),
      strArray(body.requirement_names),
      typeof body.applicability_notes === "string" ? body.applicability_notes.trim() || null : null,
      typeof body.recommended_action === "string" ? body.recommended_action.trim() || null : null,
      confidence,
      reviewStatus,
    ]
  );
  return Response.json({ ok: true, id: rows[0]?.id, review_status: reviewStatus });
}
