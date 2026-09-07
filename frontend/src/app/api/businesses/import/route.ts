import { randomUUID } from "crypto";
import { getPool, isEnabled } from "../../../graph/db";
import { ensureSchema } from "../../../graph/store";
import { getCurrentUser } from "../../../../lib/supabase/server";
import {
  determineObligations,
  ensureUserWorkspace,
  scheduleObligationNotifications,
} from "../../../compliance/server";
import { assertCanAddBusinesses, gateJson } from "../../../../lib/billing/access";
import { daysUntil, deriveObligationStatus, nextActionForStatus, validDateOnly } from "../../../compliance/dates";
import { DUE_DATE_SOURCES, type ImportedEvidence } from "../../../compliance/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ImportBody {
  profile?: Record<string, unknown>;
  answers?: Record<string, unknown>;
  evidence?: ImportedEvidence[];
  unknown_requirement_ids?: string[];
}

const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!isEnabled()) return Response.json({ error: "DATABASE_URL is not configured." }, { status: 503 });
  const pool = getPool();
  if (!pool) return Response.json({ error: "Database unavailable." }, { status: 503 });
  let body: ImportBody;
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON body." }, { status: 400 }); }
  const profile = body.profile ?? {};
  const legalName = text(profile.legal_name) || text(profile.name);
  if (!legalName) return Response.json({ error: "Business legal name is required." }, { status: 400 });
  if (!text(profile.municipality) || !text(profile.business_type)) {
    return Response.json({ error: "Municipality and business type are required." }, { status: 400 });
  }

  await ensureSchema();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const workspaceId = await ensureUserWorkspace(client, user);
    try {
      await assertCanAddBusinesses(client, { workspaceId, email: user.email, adding: 1 });
    } catch (gateErr) {
      const gated = gateJson(gateErr);
      if (gated) {
        await client.query("ROLLBACK");
        return gated;
      }
      throw gateErr;
    }
    const { obligations: blueprints, knowledgeSource } = await determineObligations(
      client,
      { ...profile, name: legalName },
      body.answers ?? {}
    );
    const businessId = randomUUID();
    const matterId = randomUUID();
    const submissionId = randomUUID();
    await client.query(
      `INSERT INTO businesses
         (id, user_id, workspace_id, name, legal_name, entity_number, business_structure,
          business_type, industry, municipality, physical_address, onboarding_mode)
       VALUES ($1,$2,$3,$4,$4,$5,$6,$7,$8,$9,$10,'EXISTING')`,
      [businessId, user.id, workspaceId, legalName, text(profile.entity_number),
        text(profile.business_structure), text(profile.business_type), text(profile.industry),
        text(profile.municipality), text(profile.physical_address)]
    );
    await client.query(
      `INSERT INTO matters
         (id, business_id, workspace_id, user_id, submission_id, matter_type, title, status)
       VALUES ($1,$2,$3,$4,$5,'OTHER','Existing business compliance setup','IN_PROGRESS')`,
      [matterId, businessId, workspaceId, user.id, submissionId]
    );
    await client.query(
      `INSERT INTO submissions
         (id, municipality, industry, business_type, business_structure, location_type,
          business_name, business_id, matter_id, user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [submissionId, text(profile.municipality), text(profile.industry), text(profile.business_type),
        text(profile.business_structure), text(profile.location_type), legalName, businessId, matterId, user.id]
    );

    const obligationByRequirement = new Map<string, { id: string; name: string; renewal: number | null }>();
    for (const blueprint of blueprints) {
      await client.query(
        `INSERT INTO requirements_generated
           (submission_id, document_id, document_name, agency, reason, source_rule, mandatory)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [submissionId, blueprint.requirementId, blueprint.name, blueprint.agency,
          "Existing profile evaluated by the deterministic rules engine", blueprint.sourceReference, blueprint.mandatory]
      );
      const obligationId = randomUUID();
      obligationByRequirement.set(blueprint.requirementId, {
        id: obligationId,
        name: blueprint.name,
        renewal: blueprint.renewalFrequencyMonths,
      });
      await client.query(
        `INSERT INTO obligations
           (id, business_id, matter_id, requirement_id, graph_entity_id, name, agency, status,
            renewal_frequency_months, renewal_reference, mandatory, source, source_reference, next_action)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'MISSING',$8,$9,$10,'REGULATORY_GRAPH',$11,'Upload current evidence')`,
        [obligationId, businessId, matterId, blueprint.requirementId, blueprint.graphEntityId,
          blueprint.name, blueprint.agency, blueprint.renewalFrequencyMonths, blueprint.renewalReference,
          blueprint.mandatory, blueprint.sourceReference]
      );
    }

    for (const item of body.evidence ?? []) {
      if (!text(item.original_filename)) continue;
      const linked = item.requirement_id ? obligationByRequirement.get(item.requirement_id) : undefined;
      const extracted = item.extracted_fields ?? {};
      const issueDate = validDateOnly(item.issue_date ?? extracted.issue_date);
      const expirationDate = validDateOnly(item.expiration_date ?? extracted.expiration_date);
      const requestedSource = item.due_date_source;
      const dateSource = expirationDate && requestedSource && DUE_DATE_SOURCES.includes(requestedSource)
        ? requestedSource
        : expirationDate ? "USER_PROVIDED" : "UNKNOWN";
      const validationResult = item.validation_result ?? "NEEDS_REVIEW";
      const evidenceState = validationResult === "PASS" ? "VERIFIED"
        : validationResult === "NEEDS_REVIEW" ? "NEEDS_REVIEW" : "FAILED";
      const status = deriveObligationStatus({
        evidenceState,
        dueDate: expirationDate,
        expectsRenewal: Boolean(linked?.renewal || expirationDate),
      });
      const confidence = typeof item.extraction_confidence === "number"
        ? Math.max(0, Math.min(1, item.extraction_confidence)) : null;
      const validation = await client.query<{ id: number }>(
        `INSERT INTO document_validations
           (submission_id, business_type, document_type, validation_result, pass_fail, confidence,
            expiration_status, extracted_fields, user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [submissionId, text(profile.business_type), linked?.name || "Unmatched evidence", validationResult,
          validationResult === "PASS", confidence == null ? null : confidence * 100,
          expirationDate ? (daysUntil(expirationDate) <= 0 ? "Expired" : "Valid") : "Unknown",
          JSON.stringify({ ...extracted, issue_date: issueDate, expiration_date: expirationDate }), user.id]
      );
      const sourceReference = text(item.source_reference) ||
        (dateSource === "DOCUMENT_EXTRACTED" ? `Extracted from ${item.original_filename}`
          : dateSource === "USER_PROVIDED" ? "Entered during existing-business onboarding" : null);
      // The evidence bucket's RLS policy only ever lets this user read back
      // objects under their own folder prefix — a path claiming otherwise
      // can't correspond to anything this call could actually have uploaded.
      const storagePath = text(item.storage_path);
      const trustedStoragePath = storagePath && storagePath.startsWith(`${user.id}/`) ? storagePath : null;
      await client.query(
        `INSERT INTO evidence
           (id, user_id, business_id, matter_id, obligation_id, validation_id, original_filename,
            storage_path, mime_type, size_bytes, document_type, review_status, extracted_fields,
            extraction_confidence, issue_date, expiration_date, date_source, source_reference, reviewed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
                 CASE WHEN $12 = 'VERIFIED' THEN now() ELSE NULL END)`,
        [randomUUID(), user.id, businessId, matterId, linked?.id ?? null, validation.rows[0]?.id ?? null,
          item.original_filename, trustedStoragePath, item.mime_type ?? null, item.size_bytes ?? null, linked?.name ?? null,
          evidenceState === "VERIFIED" ? "VERIFIED" : evidenceState === "NEEDS_REVIEW" ? "NEEDS_REVIEW" : "REJECTED",
          JSON.stringify(extracted), confidence, issueDate, expirationDate, dateSource, sourceReference]
      );
      if (linked) {
        await client.query(
          `UPDATE obligations SET status = $2, due_date = $3, due_date_source = $4,
              due_date_confidence = $5, verified_at = CASE WHEN $6 = 'VERIFIED' THEN now() ELSE NULL END,
              source_reference = COALESCE($7, source_reference), next_action = $8, updated_at = now()
            WHERE id = $1`,
          [linked.id, status, expirationDate, dateSource, confidence, evidenceState,
            sourceReference, nextActionForStatus(status)]
        );
        if (expirationDate) {
          await scheduleObligationNotifications(client, {
            userId: user.id,
            workspaceId,
            businessId,
            businessName: legalName,
            obligationId: linked.id,
            obligationName: linked.name,
            dueDate: expirationDate,
          });
        }
      }
    }

    const unknownIds = new Set((body.unknown_requirement_ids ?? []).filter((value) => typeof value === "string"));
    for (const requirementId of unknownIds) {
      const linked = obligationByRequirement.get(requirementId);
      if (!linked) continue;
      await client.query(
        `UPDATE obligations SET status='UNKNOWN', next_action='Enter date or upload evidence', updated_at=now()
          WHERE id=$1 AND status='MISSING'`,
        [linked.id]
      );
    }

    const scores = await client.query<{ mandatory: boolean; status: string }>(
      `SELECT mandatory, status FROM obligations WHERE matter_id = $1`, [matterId]
    );
    const mandatory = scores.rows.filter((row) => row.mandatory);
    const points = mandatory.reduce((sum, row) => {
      if (["CURRENT", "UPCOMING", "DUE_SOON", "COMPLETED"].includes(row.status)) return sum + 1;
      if (["UNKNOWN", "NEEDS_ATTENTION", "IN_PROGRESS"].includes(row.status)) return sum + 0.5;
      return sum;
    }, 0);
    const readiness = mandatory.length ? Math.round((points / mandatory.length) * 100) : 100;
    const hasAttention = scores.rows.some((row) => ["UNKNOWN", "NEEDS_ATTENTION", "MISSING", "OVERDUE"].includes(row.status));
    const matterStatus = readiness >= 90 && !hasAttention ? "READY" : hasAttention ? "NEEDS_ATTENTION" : "IN_PROGRESS";
    await client.query(
      `UPDATE matters SET readiness_score = $2, status = $3, updated_at = now() WHERE id = $1`,
      [matterId, readiness, matterStatus]
    );
    await client.query(
      `INSERT INTO readiness_scores (submission_id, business_type, score, status, user_id)
       VALUES ($1,$2,$3,$4,$5)`,
      [submissionId, text(profile.business_type), readiness,
        readiness >= 90 ? "Ready For Submission" : readiness >= 70 ? "Nearly Ready" : "Needs Attention", user.id]
    );
    await client.query(
      `INSERT INTO workflow_snapshots (submission_id, user_id, business_id, matter_id, state)
       VALUES ($1,$2,$3,$4,$5)`,
      [submissionId, user.id, businessId, matterId,
        JSON.stringify({ profile: { ...profile, name: legalName }, discoveryAnswers: body.answers ?? {}, currentStep: 3, importSource: knowledgeSource })]
    );
    await client.query("COMMIT");
    return Response.json({ business_id: businessId, matter_id: matterId, submission_id: submissionId, readiness_score: readiness });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("[business-import]", (error as Error).message);
    return Response.json({ error: "Could not import this business." }, { status: 500 });
  } finally {
    client.release();
  }
}
