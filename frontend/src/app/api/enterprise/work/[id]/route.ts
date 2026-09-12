// PATCH /api/enterprise/work/[id] — update a work-queue row.
//
// [id] is the obligation id. Body (all optional):
//   workspace_id, work_status, notes, priority, internal_due_date,
//   owner_user_id, department, reviewer_user_id, exception_reason
//
// Guards:
//   - work_status transitions run through canTransitionTo(); 'completed'
//     requires approved evidence OR exception_reason + manage_exceptions.
//   - Completion writes obligations.status='COMPLETED'; reopening reverts it.
//   - Before/after are audited in the same transaction as the mutation.
//   - Matter readiness is recomputed when the work status changes.
//
// Permission: assign_requirements (+ manage_exceptions for exception
// completions).

import {
  gateEnterprise,
  badRequest,
  notFound,
  forbidden,
  readJsonBody,
  withEnterpriseTransaction,
  writeEnterpriseAudit,
} from "../../_util";
import { hasPermission } from "../../../../../lib/enterprise-permissions";
import {
  canTransitionTo,
  getObligationContext,
  obligationHasApprovedEvidence,
  recomputeMatterReadiness,
  WORK_STATUSES,
  PRIORITIES,
  isUuid,
  type WorkStatus,
} from "../../../../../lib/enterprise-work";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: obligationId } = await context.params;
  if (!isUuid(obligationId)) return badRequest("Invalid obligation id.");

  const body = await readJsonBody(request);
  if (!body) return badRequest("A JSON body is required.");

  const gate = await gateEnterprise(
    request,
    "assign_requirements",
    typeof body.workspace_id === "string" ? body.workspace_id : null
  );
  if ("response" in gate) return gate.response;
  const { user, workspaceId } = gate;

  // Tenant check: the obligation must resolve into this workspace.
  const ctx = await getObligationContext(obligationId);
  if (!ctx || ctx.workspaceId !== workspaceId) return notFound();

  const nextStatus = body.work_status as WorkStatus | undefined;
  if (nextStatus !== undefined && !WORK_STATUSES.includes(nextStatus)) {
    return badRequest(`Invalid work_status "${nextStatus}".`);
  }
  const priority = body.priority as string | undefined;
  if (priority !== undefined && !PRIORITIES.includes(priority as never)) {
    return badRequest(`Invalid priority "${priority}".`);
  }
  const ownerUserId = body.owner_user_id as string | null | undefined;
  const reviewerUserId = body.reviewer_user_id as string | null | undefined;
  if (ownerUserId !== undefined && ownerUserId !== null && !isUuid(ownerUserId)) {
    return badRequest("owner_user_id must be a UUID or null.");
  }
  if (reviewerUserId !== undefined && reviewerUserId !== null && !isUuid(reviewerUserId)) {
    return badRequest("reviewer_user_id must be a UUID or null.");
  }
  const internalDueDate =
    body.internal_due_date === undefined
      ? undefined
      : body.internal_due_date === null
        ? null
        : String(body.internal_due_date);
  if (internalDueDate && !DATE_RE.test(internalDueDate)) {
    return badRequest("internal_due_date must be YYYY-MM-DD or null.");
  }
  const notes =
    body.notes === undefined
      ? undefined
      : body.notes === null
        ? null
        : String(body.notes).slice(0, 4000) || null;
  const department =
    body.department === undefined
      ? undefined
      : body.department === null
        ? null
        : String(body.department).slice(0, 120) || null;
  const exceptionReason =
    body.exception_reason === undefined || body.exception_reason === null
      ? undefined
      : String(body.exception_reason).slice(0, 2000) || undefined;

  if (
    nextStatus === undefined && notes === undefined && priority === undefined &&
    internalDueDate === undefined && ownerUserId === undefined &&
    reviewerUserId === undefined && department === undefined
  ) {
    return badRequest("Nothing to update.");
  }

  const result = await withEnterpriseTransaction(async (client) => {
    const { rows: workRows } = await client.query(
      `SELECT work_status, owner_user_id::text AS owner_user_id, department,
              reviewer_user_id::text AS reviewer_user_id, priority,
              internal_due_date::text AS internal_due_date, notes,
              completed_via_exception, exception_reason
         FROM obligation_work WHERE obligation_id = $1::uuid`,
      [obligationId]
    );
    const current = (workRows[0]?.work_status as WorkStatus | undefined) ?? "not_started";
    const before = workRows[0] ?? null;

    let completing = false;
    let viaException = false;
    if (nextStatus !== undefined && nextStatus !== current) {
      const approvedEvidence = await obligationHasApprovedEvidence(
        obligationId,
        client as never
      );
      const exception = nextStatus === "completed" && !approvedEvidence && !!exceptionReason;
      if (nextStatus === "completed" && !approvedEvidence && !exceptionReason) {
        throw Object.assign(new Error("completion_guard"), { status: 422 });
      }
      if (exception) {
        const mayExcept = await hasPermission(user.id, workspaceId, "manage_exceptions");
        if (!mayExcept) throw Object.assign(new Error("exception_forbidden"), { status: 403 });
        viaException = true;
      }
      const check = canTransitionTo(current, nextStatus, {
        hasApprovedEvidence: approvedEvidence,
        hasException: exception,
      });
      if (!check.ok) throw Object.assign(new Error(check.reason ?? "transition_denied"), { status: 422 });
      completing = nextStatus === "completed";
    }

    // Verify owner/reviewer membership when being set.
    for (const id of [ownerUserId, reviewerUserId]) {
      if (id) {
        const { rows } = await client.query(
          `SELECT 1 FROM workspace_members WHERE workspace_id = $1::uuid AND user_id = $2::uuid LIMIT 1`,
          [workspaceId, id]
        );
        if (!rows.length) throw Object.assign(new Error("assignee_not_member"), { status: 422 });
      }
    }

    // Exception bookkeeping: only a "completed" transition carries exception
    // fields; any other status change clears them.
    const statusChanged = nextStatus !== undefined;
    const newViaException = nextStatus === "completed" && viaException;
    const newExceptionReason = newViaException ? (exceptionReason ?? null) : null;
    const newExceptionGrantedBy = newViaException ? user.id : null;

    const { rows: afterRows } = await client.query(
      `INSERT INTO obligation_work
         (obligation_id, owner_user_id, department, reviewer_user_id, priority,
          internal_due_date, work_status, notes,
          completed_via_exception, exception_reason, exception_granted_by)
       VALUES ($1::uuid,
               CASE WHEN $9  THEN $2::uuid ELSE NULL END,
               CASE WHEN $10 THEN $3       ELSE NULL END,
               CASE WHEN $11 THEN $4::uuid ELSE NULL END,
               CASE WHEN $12 THEN $5       ELSE 'medium' END,
               CASE WHEN $13 THEN $6::date ELSE NULL END,
               CASE WHEN $14 THEN $7       ELSE 'not_started' END,
               CASE WHEN $15 THEN $8       ELSE NULL END,
               $16, $17, $18::uuid)
       ON CONFLICT (obligation_id) DO UPDATE SET
         owner_user_id    = CASE WHEN $9  THEN $2::uuid ELSE obligation_work.owner_user_id END,
         department       = CASE WHEN $10 THEN $3       ELSE obligation_work.department END,
         reviewer_user_id = CASE WHEN $11 THEN $4::uuid ELSE obligation_work.reviewer_user_id END,
         priority         = CASE WHEN $12 THEN $5       ELSE obligation_work.priority END,
         internal_due_date= CASE WHEN $13 THEN $6::date ELSE obligation_work.internal_due_date END,
         work_status      = CASE WHEN $14 THEN $7       ELSE obligation_work.work_status END,
         notes            = CASE WHEN $15 THEN $8       ELSE obligation_work.notes END,
         completed_via_exception = CASE WHEN $14 THEN $16 ELSE obligation_work.completed_via_exception END,
         exception_reason = CASE WHEN $14 THEN $17 ELSE obligation_work.exception_reason END,
         exception_granted_by = CASE WHEN $14 THEN $18::uuid ELSE obligation_work.exception_granted_by END,
         updated_at = now()
       RETURNING work_status, owner_user_id::text AS owner_user_id, department,
                 reviewer_user_id::text AS reviewer_user_id, priority,
                 internal_due_date::text AS internal_due_date, notes,
                 completed_via_exception, exception_reason`,
      [
        obligationId,
        ownerUserId ?? null,
        department ?? null,
        reviewerUserId ?? null,
        priority ?? null,
        internalDueDate ?? null,
        nextStatus ?? null,
        notes ?? null,
        ownerUserId !== undefined,
        department !== undefined,
        reviewerUserId !== undefined,
        priority !== undefined,
        internalDueDate !== undefined,
        statusChanged,
        notes !== undefined,
        statusChanged ? newViaException : (before?.completed_via_exception ?? false),
        statusChanged ? newExceptionReason : (before?.exception_reason ?? null),
        statusChanged ? newExceptionGrantedBy : (before?.exception_granted_by ?? null),
      ]
    );
    const after = afterRows[0];

    // Keep the legacy obligation status in sync with completion.
    if (nextStatus === "completed") {
      await client.query(
        `UPDATE obligations SET status = 'COMPLETED', completed_at = now(), updated_at = now()
          WHERE id = $1::uuid`,
        [obligationId]
      );
    } else if (nextStatus !== undefined && before?.work_status === "completed") {
      await client.query(
        `UPDATE obligations SET status = 'IN_PROGRESS', completed_at = NULL, updated_at = now()
          WHERE id = $1::uuid AND status = 'COMPLETED'`,
        [obligationId]
      );
    }

    await writeEnterpriseAudit(client, request, {
      actorUserId: user.id,
      workspaceId,
      action: nextStatus === "completed" ? "work.completed" : "work.updated",
      targetType: "obligation",
      targetId: obligationId,
      before,
      after,
      reason: viaException ? `audited exception: ${exceptionReason}` : undefined,
    });

    let readiness: Awaited<ReturnType<typeof recomputeMatterReadiness>> = null;
    if (nextStatus !== undefined && ctx.matterId) {
      readiness = await recomputeMatterReadiness(ctx.matterId, client as never);
    }
    return { work: { obligation_id: obligationId, ...after }, readiness };
  }).catch((e: Error & { status?: number }) => {
    const status = e.status ?? 500;
    if (status === 422) return { errorResponse: badRequest(e.message) };
    if (status === 403) return { errorResponse: forbidden(e.message) };
    throw e;
  });

  if (result && typeof result === "object" && "errorResponse" in result) {
    return (result as { errorResponse: Response }).errorResponse;
  }
  return Response.json({ ok: true, workspace_id: workspaceId, ...(result as object) });
}
