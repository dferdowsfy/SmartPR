// Single business: detail (with submissions + readiness timeline) and delete.

import { getPool, isEnabled } from "../../../graph/db";
import { ensureSchema, resolveBusinessUuid } from "../../../graph/store";
import { getCurrentUser } from "../../../../lib/supabase/server";
import { deriveObligationStatus, nextActionForStatus, validDateOnly } from "../../../compliance/dates";
import { buildCanonicalFromIntake } from "../../../forms/engine/intake";
import { selectEntriesForRequirement } from "../../../forms/engine/routing";
import { getTemplate, isOfficialArtifact } from "../../../forms/artifacts/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!isEnabled()) return Response.json({ error: "no_database" }, { status: 503 });
  const pool = getPool();
  if (!pool) return Response.json({ error: "no_database" }, { status: 503 });
  await ensureSchema();

  try {
    // The path id may be the short public id or the full UUID.
    const businessUuid = await resolveBusinessUuid(pool, id);
    if (!businessUuid) return Response.json({ error: "not_found" }, { status: 404 });
    const { rows: bizRows } = await pool.query(
      `SELECT b.id, b.public_id, b.name, b.legal_name, b.entity_number, b.business_structure,
              b.business_type, b.industry, b.municipality, b.physical_address,
              b.onboarding_mode, b.notes, b.created_at, b.updated_at
         FROM businesses b
         LEFT JOIN workspace_members wm ON wm.workspace_id=b.workspace_id AND wm.user_id=$2
        WHERE b.id=$1 AND b.archived=false AND (b.user_id=$2 OR wm.user_id IS NOT NULL)`,
      [businessUuid, user.id]
    );
    const business = bizRows[0];
    if (!business) return Response.json({ error: "not_found" }, { status: 404 });

    const [submissionResult, deliverableResult, matterResult, obligationResult, evidenceResult, notificationResult] = await Promise.all([
      pool.query(
      `SELECT s.id, s.created_at, s.municipality, s.business_type, s.business_structure,
              s.location_type, s.matter_id, rs.score AS readiness_score, rs.status AS readiness_status
         FROM submissions s
         LEFT JOIN LATERAL (SELECT score, status FROM readiness_scores r WHERE r.submission_id = s.id
                            ORDER BY created_at DESC LIMIT 1) rs ON true
        WHERE s.business_id = $1 AND s.user_id = $2 ORDER BY s.created_at DESC`,
      [businessUuid, user.id]),
      pool.query(
      `SELECT id, kind, filename, generated_at, size_bytes, submission_id
         FROM deliverables WHERE business_id = $1 AND user_id = $2 ORDER BY generated_at DESC`,
      [businessUuid, user.id]),
      pool.query(
        `SELECT id, matter_type, title, status, readiness_score, opened_at, due_date::text,
                due_date_source, source_reference, completed_at, submission_id, created_at
           FROM matters WHERE business_id=$1 ORDER BY created_at DESC`, [businessUuid]),
      pool.query(
        `SELECT o.*, o.due_date::text AS due_date,
                CASE
                  WHEN o.verified_at IS NOT NULL AND o.status IN ('CURRENT','UPCOMING','DUE_SOON','OVERDUE') THEN 'VERIFIED'
                  WHEN EXISTS (SELECT 1 FROM evidence e WHERE e.obligation_id=o.id AND e.review_status='VERIFIED') THEN 'VERIFIED'
                  WHEN EXISTS (SELECT 1 FROM evidence e WHERE e.obligation_id=o.id AND e.review_status='NEEDS_REVIEW') THEN 'NEEDS_REVIEW'
                  WHEN EXISTS (SELECT 1 FROM evidence e WHERE e.obligation_id=o.id) THEN 'FAILED'
                  ELSE 'NONE' END AS evidence_state,
                m.title AS matter_title, m.matter_type, m.readiness_score
           FROM obligations o LEFT JOIN matters m ON m.id=o.matter_id
          WHERE o.business_id=$1 ORDER BY o.due_date NULLS LAST, o.created_at DESC`, [businessUuid]),
      pool.query(
        `SELECT e.id, e.obligation_id, e.matter_id, e.original_filename, e.mime_type,
                e.size_bytes, e.document_type, e.review_status, e.extracted_fields,
                e.extraction_confidence, e.issue_date::text, e.expiration_date::text,
                e.date_source, e.source_reference, e.created_at, o.name AS obligation_name
           FROM evidence e LEFT JOIN obligations o ON o.id=e.obligation_id
          WHERE e.business_id=$1 ORDER BY e.created_at DESC`, [businessUuid]),
      pool.query(
        `SELECT id, obligation_id, type, scheduled_for, status, message
           FROM notifications WHERE business_id=$1 AND user_id=$2
          ORDER BY scheduled_for DESC LIMIT 50`, [businessUuid, user.id]),
    ]);
    // Resolve which obligations carry a real, fillable government form so the
    // client can offer "Complete document". Same five-condition gate the
    // intake requirement cards use: requirement present, registry entry,
    // applicability matches the business's entity type, official artifact.
    const canonical = buildCanonicalFromIntake({
      legalName: business.legal_name || business.name,
      business_structure: business.business_structure ?? undefined,
      municipality: business.municipality ?? undefined,
      formationStatus: business.onboarding_mode === "EXISTING" ? "formed_in_puerto_rico" : undefined,
    });
    const presentRequirementIds = new Set(
      obligationResult.rows.map((row) => row.requirement_id).filter((value): value is string => Boolean(value))
    );
    const formIdForRequirement = (requirementId: string | null): string | null => {
      if (!requirementId) return null;
      for (const entry of selectEntriesForRequirement(requirementId, canonical, presentRequirementIds)) {
        const template = getTemplate(entry.officialFormNumber);
        if (template && isOfficialArtifact(template)) return entry.id;
      }
      return null;
    };
    const obligations = obligationResult.rows.map((row) => {
      const dueDate = validDateOnly(row.due_date);
      const status = deriveObligationStatus({
        currentStatus: row.status,
        dueDate,
        evidenceState: row.evidence_state,
        expectsRenewal: Boolean(row.renewal_frequency_months || dueDate),
      });
      return {
        ...row,
        status,
        next_action: row.next_action || nextActionForStatus(status),
        form_id: formIdForRequirement(row.requirement_id ?? null),
      };
    });
    const activeScores = matterResult.rows
      .filter((row) => row.status !== "ARCHIVED" && row.readiness_score != null)
      .map((row) => Number(row.readiness_score));
    const overallReadiness = activeScores.length
      ? Math.round(activeScores.reduce((sum, score) => sum + score, 0) / activeScores.length)
      : null;
    return Response.json({
      business,
      overall_readiness: overallReadiness,
      submissions: submissionResult.rows,
      deliverables: deliverableResult.rows,
      matters: matterResult.rows,
      obligations,
      evidence: evidenceResult.rows,
      notifications: notificationResult.rows,
    });
  } catch (err) {
    console.error("[businesses] detail failed:", (err as Error).message);
    return Response.json({ error: "query_failed" }, { status: 500 });
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const pool = getPool();
  if (!pool) return Response.json({ error: "no_database" }, { status: 503 });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return Response.json({ error: "bad_json" }, { status: 400 }); }
  const allowed = ["legal_name", "entity_number", "business_structure", "business_type", "industry", "municipality", "physical_address", "notes"];
  const values = allowed.map((key) => typeof body[key] === "string" ? String(body[key]).trim() || null : null);
  if (!values.some((value) => value !== null)) return Response.json({ error: "No supported fields supplied." }, { status: 400 });
  await ensureSchema();
  const businessUuid = await resolveBusinessUuid(pool, id);
  if (!businessUuid) return Response.json({ error: "not_found" }, { status: 404 });
  const result = await pool.query(
    `UPDATE businesses SET
       legal_name=COALESCE($3,legal_name), name=COALESCE($3,name), entity_number=COALESCE($4,entity_number),
       business_structure=COALESCE($5,business_structure), business_type=COALESCE($6,business_type),
       industry=COALESCE($7,industry), municipality=COALESCE($8,municipality),
       physical_address=COALESCE($9,physical_address), notes=COALESCE($10,notes), updated_at=now()
     WHERE id=$1 AND user_id=$2 RETURNING *`,
    [id, user.id, ...values]
  );
  if (!result.rows[0]) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ business: result.rows[0] });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const pool = getPool();
  if (!pool) return Response.json({ error: "no_database" }, { status: 503 });
  try {
    await ensureSchema();
    const businessUuid = await resolveBusinessUuid(pool, id);
    if (!businessUuid) return Response.json({ error: "not_found" }, { status: 404 });
    // Soft delete keeps the user's compliance record intact.
    const { rowCount } = await pool.query(
      `UPDATE businesses SET archived = true, archived_at = now(), updated_at = now() WHERE id = $1 AND user_id = $2`,
      [businessUuid, user.id]
    );
    if (!rowCount) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json({ archived: true });
  } catch (err) {
    console.error("[businesses] archive failed:", (err as Error).message);
    return Response.json({ error: "delete_failed" }, { status: 500 });
  }
}
