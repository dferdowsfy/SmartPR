// POST /api/enterprise/evidence/[id]/review — review submitted evidence.
//
// Body: {
//   workspace_id?: string,
//   decision: "approve" | "request_changes" | "reject",
//   reason?: string,            // required for request_changes / reject
//   version_number?: number     // defaults to the latest version
// }
//
// Permissions: review_evidence (request_changes, reject); approve_evidence
// (approve). Separation of duties: the uploader cannot approve their own
// evidence when the workspace has it enabled (default true). Every decision
// is recorded in evidence_reviews with previous/resulting state; on approval
// the linked obligation_work moves to 'approved' and matter readiness is
// recomputed. All writes + audit share one transaction.

import {
  gateEnterprise,
  badRequest,
  notFound,
  forbidden,
  readJsonBody,
  withEnterpriseTransaction,
  writeEnterpriseAudit,
} from "../../../_util";
import {
  canEvidenceTransitionTo,
  enforceSeparationOfDuties,
  SeparationOfDutiesError,
  recomputeMatterReadiness,
  isUuid,
  type EvidenceEnterpriseState,
} from "../../../../../../lib/enterprise-work";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DECISIONS = {
  approve: "approved",
  request_changes: "changes_requested",
  reject: "rejected",
} as const;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: evidenceId } = await context.params;
  if (!isUuid(evidenceId)) return badRequest("Invalid evidence id.");

  const body = await readJsonBody(request);
  if (!body) return badRequest("A JSON body is required.");
  const decision = body.decision as string | undefined;
  if (decision !== "approve" && decision !== "request_changes" && decision !== "reject") {
    return badRequest('decision must be "approve", "request_changes", or "reject".');
  }
  const reason =
    body.reason === undefined || body.reason === null
      ? undefined
      : String(body.reason).slice(0, 2000).trim() || undefined;
  if (decision !== "approve" && !reason) {
    return badRequest("A reason is required for request_changes and reject.");
  }
  const versionNumber =
    body.version_number === undefined || body.version_number === null
      ? undefined
      : Number(body.version_number);
  if (versionNumber !== undefined && (!Number.isInteger(versionNumber) || versionNumber < 1)) {
    return badRequest("version_number must be a positive integer.");
  }

  const gate = await gateEnterprise(
    request,
    decision === "approve" ? "approve_evidence" : "review_evidence",
    typeof body.workspace_id === "string" ? body.workspace_id : null
  );
  if ("response" in gate) return gate.response;
  const { user, workspaceId } = gate;
  const resultingState: EvidenceEnterpriseState = DECISIONS[decision];

  const result = await withEnterpriseTransaction(async (client) => {
    const { rows } = await client.query<{
      enterprise_state: EvidenceEnterpriseState;
      obligation_id: string | null;
      matter_id: string | null;
      uploader_user_id: string | null;
    }>(
      `SELECT e.enterprise_state AS enterprise_state,
              e.obligation_id::text AS obligation_id,
              e.matter_id::text AS matter_id,
              e.user_id::text AS uploader_user_id
         FROM evidence e
         JOIN businesses b ON b.id = e.business_id
        WHERE e.id = $1::uuid AND b.workspace_id = $2::uuid
        LIMIT 1`,
      [evidenceId, workspaceId]
    );
    const ev = rows[0];
    if (!ev) throw Object.assign(new Error("not_found"), { status: 404 });

    const check = canEvidenceTransitionTo(ev.enterprise_state, resultingState);
    if (!check.ok) throw Object.assign(new Error(check.reason ?? "invalid_transition"), { status: 422 });

    // Separation of duties: the uploader cannot review their own evidence.
    try {
      await enforceSeparationOfDuties(client as never, workspaceId, ev.uploader_user_id, user.id);
    } catch (e) {
      if (e instanceof SeparationOfDutiesError) {
        throw Object.assign(new Error(e.message), { status: 403 });
      }
      throw e;
    }

    // Resolve the reviewed version (latest when not specified).
    let versionId: string | null = null;
    let resolvedVersion = versionNumber;
    if (versionNumber !== undefined) {
      const { rows: vrows } = await client.query<{ id: string; version_number: number }>(
        `SELECT id::text AS id, version_number FROM evidence_versions
          WHERE evidence_id = $1::uuid AND version_number = $2 LIMIT 1`,
        [evidenceId, versionNumber]
      );
      if (!vrows.length) throw Object.assign(new Error("version_not_found"), { status: 404 });
      versionId = vrows[0].id;
    } else {
      const { rows: vrows } = await client.query<{ id: string; version_number: number }>(
        `SELECT id::text AS id, version_number FROM evidence_versions
          WHERE evidence_id = $1::uuid ORDER BY version_number DESC LIMIT 1`,
        [evidenceId]
      );
      versionId = vrows[0]?.id ?? null;
      resolvedVersion = vrows[0]?.version_number ?? undefined;
    }

    await client.query(
      `INSERT INTO evidence_reviews
         (evidence_id, evidence_version_id, reviewer_user_id, decision, reason,
          previous_state, resulting_state)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7)`,
      [evidenceId, versionId, user.id, decision, reason ?? null, ev.enterprise_state, resultingState]
    );
    await client.query(
      `UPDATE evidence SET enterprise_state = $2, reviewed_at = now() WHERE id = $1::uuid`,
      [evidenceId, resultingState]
    );

    // Keep the work queue in sync with review outcomes.
    let workStatus: string | null = null;
    if (ev.obligation_id) {
      workStatus =
        resultingState === "approved"
          ? "approved"
          : resultingState === "rejected"
            ? "blocked"
            : "changes_requested";
      await client.query(
        `INSERT INTO obligation_work (obligation_id, work_status)
         VALUES ($1::uuid, $2)
         ON CONFLICT (obligation_id) DO UPDATE SET work_status = $2, updated_at = now()`,
        [ev.obligation_id, workStatus]
      );
    }

    await writeEnterpriseAudit(client, request, {
      actorUserId: user.id,
      workspaceId,
      action: `evidence.${decision}`,
      targetType: "evidence",
      targetId: evidenceId,
      before: { enterprise_state: ev.enterprise_state },
      after: { enterprise_state: resultingState, version_number: resolvedVersion ?? null },
      reason: reason ?? undefined,
    });

    let readiness: Awaited<ReturnType<typeof recomputeMatterReadiness>> = null;
    if (resultingState === "approved" && ev.matter_id) {
      readiness = await recomputeMatterReadiness(ev.matter_id, client as never);
    }
    return {
      evidence_id: evidenceId,
      decision,
      enterprise_state: resultingState,
      version_number: resolvedVersion ?? null,
      work_status: workStatus,
      readiness,
    };
  }).catch((e: Error & { status?: number }) => {
    if (e.status === 404) return { errorResponse: notFound(e.message) };
    if (e.status === 422) return { errorResponse: badRequest(e.message) };
    if (e.status === 403) return { errorResponse: forbidden(e.message) };
    throw e;
  });

  if (result && typeof result === "object" && "errorResponse" in result) {
    return (result as { errorResponse: Response }).errorResponse;
  }
  return Response.json({ ok: true, ...(result as object) });
}
