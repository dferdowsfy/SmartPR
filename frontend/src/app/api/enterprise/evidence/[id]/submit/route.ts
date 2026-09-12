// POST /api/enterprise/evidence/[id]/submit — submit draft evidence for
// review. draft -> submitted_for_review (also changes_requested ->
// submitted_for_review on re-submit). Permission: upload_evidence.
// Audited in the same transaction.

import {
  gateEnterprise,
  badRequest,
  notFound,
  readJsonBody,
  withEnterpriseTransaction,
  writeEnterpriseAudit,
} from "../../../_util";
import {
  canEvidenceTransitionTo,
  isUuid,
  type EvidenceEnterpriseState,
} from "../../../../../../lib/enterprise-work";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: evidenceId } = await context.params;
  if (!isUuid(evidenceId)) return badRequest("Invalid evidence id.");

  const body = await readJsonBody(request);
  const gate = await gateEnterprise(
    request,
    "upload_evidence",
    body && typeof body.workspace_id === "string" ? body.workspace_id : null
  );
  if ("response" in gate) return gate.response;
  const { user, workspaceId } = gate;

  const result = await withEnterpriseTransaction(async (client) => {
    // Tenant check: the evidence must resolve into this workspace.
    const { rows } = await client.query<{
      enterprise_state: EvidenceEnterpriseState;
      obligation_id: string | null;
    }>(
      `SELECT e.enterprise_state AS enterprise_state, e.obligation_id::text AS obligation_id
         FROM evidence e
         JOIN businesses b ON b.id = e.business_id
        WHERE e.id = $1::uuid AND b.workspace_id = $2::uuid
        LIMIT 1`,
      [evidenceId, workspaceId]
    );
    const ev = rows[0];
    if (!ev) throw Object.assign(new Error("not_found"), { status: 404 });

    const check = canEvidenceTransitionTo(ev.enterprise_state, "submitted_for_review");
    if (!check.ok) throw Object.assign(new Error(check.reason ?? "invalid_transition"), { status: 422 });

    await client.query(
      `UPDATE evidence SET enterprise_state = 'submitted_for_review', reviewed_at = NULL
        WHERE id = $1::uuid`,
      [evidenceId]
    );
    if (ev.obligation_id) {
      await client.query(
        `INSERT INTO obligation_work (obligation_id, work_status)
         VALUES ($1::uuid, 'evidence_submitted')
         ON CONFLICT (obligation_id) DO UPDATE SET
           work_status = CASE WHEN obligation_work.work_status IN ('not_started','in_progress','blocked','changes_requested')
                              THEN 'evidence_submitted' ELSE obligation_work.work_status END,
           updated_at = now()`,
        [ev.obligation_id]
      );
    }
    await writeEnterpriseAudit(client, request, {
      actorUserId: user.id,
      workspaceId,
      action: "evidence.submitted",
      targetType: "evidence",
      targetId: evidenceId,
      before: { enterprise_state: ev.enterprise_state },
      after: { enterprise_state: "submitted_for_review" },
    });
    return { evidence_id: evidenceId, enterprise_state: "submitted_for_review" };
  }).catch((e: Error & { status?: number }) => {
    if (e.status === 404) return { errorResponse: notFound() };
    if (e.status === 422) return { errorResponse: badRequest(e.message) };
    throw e;
  });

  if (result && typeof result === "object" && "errorResponse" in result) {
    return (result as { errorResponse: Response }).errorResponse;
  }
  return Response.json({ ok: true, ...(result as object) });
}
