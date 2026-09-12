// POST /api/enterprise/work/assign — bulk assign obligations.
//
// Body: {
//   workspace_id?: string, obligation_ids: string[],
//   owner_user_id?: string|null, department?: string|null,
//   reviewer_user_id?: string|null, priority?: "low"|"medium"|"high"|"critical",
//   internal_due_date?: string|null  (YYYY-MM-DD; labeled "internal target")
// }
// Upserts obligation_work rows (1:1 companion to obligations). Each
// assignment is audited; everything runs in one transaction.
//
// Permission: assign_requirements.

import {
  gateEnterprise,
  badRequest,
  notFound,
  forbidden,
  readJsonBody,
  withEnterpriseTransaction,
  writeEnterpriseAudit,
} from "../../_util";
import { PRIORITIES, isUuid } from "../../../../../lib/enterprise-work";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(request: Request) {
  const body = await readJsonBody(request);
  if (!body) return badRequest("A JSON body is required.");

  const gate = await gateEnterprise(
    request,
    "assign_requirements",
    typeof body.workspace_id === "string" ? body.workspace_id : null
  );
  if ("response" in gate) return gate.response;
  const { user, workspaceId } = gate;

  const obligationIds = Array.isArray(body.obligation_ids)
    ? [...new Set(body.obligation_ids.filter((v): v is string => typeof v === "string"))]
    : [];
  if (obligationIds.length === 0) return badRequest("obligation_ids must be a non-empty array.");
  if (obligationIds.length > 200) return badRequest("At most 200 obligations per assignment.");
  if (!obligationIds.every(isUuid)) return badRequest("Every obligation_ids entry must be a UUID.");

  const ownerUserId = body.owner_user_id as string | null | undefined;
  const reviewerUserId = body.reviewer_user_id as string | null | undefined;
  if (ownerUserId !== undefined && ownerUserId !== null && !isUuid(ownerUserId)) {
    return badRequest("owner_user_id must be a UUID or null.");
  }
  if (reviewerUserId !== undefined && reviewerUserId !== null && !isUuid(reviewerUserId)) {
    return badRequest("reviewer_user_id must be a UUID or null.");
  }
  const department =
    body.department === undefined
      ? undefined
      : body.department === null
        ? null
        : String(body.department).slice(0, 120) || null;
  const priority = body.priority as string | undefined;
  if (priority !== undefined && !PRIORITIES.includes(priority as never)) {
    return badRequest(`Invalid priority "${priority}".`);
  }
  const internalDueDate =
    body.internal_due_date === undefined
      ? undefined
      : body.internal_due_date === null
        ? null
        : String(body.internal_due_date);
  if (internalDueDate !== undefined && internalDueDate !== null && !DATE_RE.test(internalDueDate)) {
    return badRequest("internal_due_date must be YYYY-MM-DD or null.");
  }
  if (
    ownerUserId === undefined && reviewerUserId === undefined &&
    department === undefined && priority === undefined && internalDueDate === undefined
  ) {
    return badRequest("Nothing to assign: provide owner, reviewer, department, priority, or an internal due date.");
  }

  // Owner/reviewer membership is verified inside the transaction.

  const result = await withEnterpriseTransaction(async (client) => {
    for (const id of [ownerUserId, reviewerUserId]) {
      if (id) {
        const { rows } = await client.query(
          `SELECT 1 FROM workspace_members WHERE workspace_id = $1::uuid AND user_id = $2::uuid LIMIT 1`,
          [workspaceId, id]
        );
        if (!rows.length) throw Object.assign(new Error("assignee_not_member"), { status: 422 });
      }
    }
    // All obligations must belong to this workspace (tenant check).
    const { rows: owned } = await client.query<{ id: string }>(
      `SELECT o.id::text AS id FROM obligations o
        JOIN businesses b ON b.id = o.business_id
       WHERE o.id = ANY($1::uuid[]) AND b.workspace_id = $2::uuid`,
      [obligationIds, workspaceId]
    );
    if (owned.length !== obligationIds.length) {
      throw Object.assign(new Error("obligation_not_found"), { status: 404 });
    }

    const beforeRows = await client.query<{ obligation_id: string; row: unknown }>(
      `SELECT obligation_id::text AS obligation_id, to_jsonb(obligation_work.*) AS row
         FROM obligation_work WHERE obligation_id = ANY($1::uuid[])`,
      [obligationIds]
    );
    const beforeById = new Map(beforeRows.rows.map((r) => [r.obligation_id, r.row]));

    const assigned: Array<Record<string, unknown>> = [];
    for (const obligationId of obligationIds) {
      const { rows } = await client.query(
        `INSERT INTO obligation_work
           (obligation_id, owner_user_id, department, reviewer_user_id, priority, internal_due_date)
         VALUES ($1::uuid,
                 CASE WHEN $7 THEN $2::uuid ELSE NULL END,
                 CASE WHEN $8 THEN $3 ELSE NULL END,
                 CASE WHEN $9 THEN $4::uuid ELSE NULL END,
                 CASE WHEN $10 THEN $5 ELSE 'medium' END,
                 CASE WHEN $11 THEN $6::date ELSE NULL END)
         ON CONFLICT (obligation_id) DO UPDATE SET
           owner_user_id    = CASE WHEN $7  THEN $2::uuid ELSE obligation_work.owner_user_id END,
           department       = CASE WHEN $8  THEN $3       ELSE obligation_work.department END,
           reviewer_user_id = CASE WHEN $9  THEN $4::uuid ELSE obligation_work.reviewer_user_id END,
           priority         = CASE WHEN $10 THEN $5       ELSE obligation_work.priority END,
           internal_due_date= CASE WHEN $11 THEN $6::date ELSE obligation_work.internal_due_date END,
           updated_at = now()
         RETURNING work_status, owner_user_id::text AS owner_user_id,
                   department, reviewer_user_id::text AS reviewer_user_id,
                   priority, internal_due_date::text AS internal_due_date`,
        [
          obligationId,
          ownerUserId ?? null,
          department ?? null,
          reviewerUserId ?? null,
          priority ?? null,
          internalDueDate ?? null,
          ownerUserId !== undefined,
          department !== undefined,
          reviewerUserId !== undefined,
          priority !== undefined,
          internalDueDate !== undefined,
        ]
      );
      assigned.push({ obligation_id: obligationId, ...rows[0] });
      await writeEnterpriseAudit(client, request, {
        actorUserId: user.id,
        workspaceId,
        action: "work.assigned",
        targetType: "obligation",
        targetId: obligationId,
        before: beforeById.get(obligationId) ?? null,
        after: rows[0],
        reason: "work queue assignment",
      });
    }
    return assigned;
  }).catch((e: Error & { status?: number }) => {
    if (e.message === "assignee_not_member") {
      return { errorResponse: forbidden("Owner/reviewer must be a workspace member.") };
    }
    if (e.message === "obligation_not_found") return { errorResponse: notFound() };
    throw e;
  });

  if (result && typeof result === "object" && "errorResponse" in result) {
    return (result as { errorResponse: Response }).errorResponse;
  }
  return Response.json({ ok: true, workspace_id: workspaceId, assigned: result });
}
