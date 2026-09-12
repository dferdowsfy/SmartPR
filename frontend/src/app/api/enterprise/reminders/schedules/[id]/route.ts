// Enterprise deadline schedules — update + delete.
import { enterpriseGate, obligationInWorkspace, transactWithAudit } from "../../_shared";
import {
  validateDeadlineScheduleInput,
  computeEffectiveDueDate,
} from "../../../../../../lib/enterprise-reminders";
import { hasPermission } from "../../../../../../lib/enterprise-permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function load(
  pool: { query: (t: string, p?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> },
  id: string,
  workspaceId: string
) {
  const { rows } = await pool.query(
    `SELECT id::text AS id, workspace_id::text AS workspace_id,
            obligation_id::text AS obligation_id, schedule_type,
            due_date::text AS due_date, recurrence_rule, grace_days,
            is_verified, label, source_note
       FROM deadline_schedules WHERE id = $1 AND workspace_id = $2 LIMIT 1`,
    [id, workspaceId]
  );
  return rows[0] ?? null;
}

function serialize(row: Record<string, unknown>) {
  const isVerified = Boolean(row.is_verified);
  const due = (row.due_date as string) ?? "";
  return {
    ...row,
    effective_due_date: due ? computeEffectiveDueDate(due, Number(row.grace_days) || 0) : null,
    badge: isVerified ? "verified deadline" : "internal target",
  };
}

export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
  const g = await enterpriseGate(req, "assign_requirements");
  if ("response" in g) return g.response;
  const { id } = await context.params;
  const before = await load(g.pool, id, g.workspaceId);
  if (!before) return Response.json({ error: "not_found" }, { status: 404 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const merged = {
    obligation_id: before.obligation_id,
    schedule_type: before.schedule_type,
    due_date: before.due_date,
    recurrence_rule: before.recurrence_rule,
    grace_days: before.grace_days,
    is_verified: before.is_verified,
    label: before.label,
    source_note: before.source_note,
    ...(body as Record<string, unknown>),
  };
  const v = validateDeadlineScheduleInput(merged);
  if (!v.ok || !v.value) return Response.json({ error: "invalid_input", details: v.errors }, { status: 400 });

  // Setting is_verified=true (including keeping it while changing the date)
  // is a verification act: require approve_evidence.
  const requestingVerified = v.value.is_verified && (!before.is_verified || v.value.due_date !== before.due_date);
  if (requestingVerified) {
    const canVerify = await hasPermission(g.user.id, g.workspaceId, "approve_evidence");
    if (!canVerify) {
      return Response.json(
        { error: "forbidden", detail: "is_verified=true requires the approve_evidence permission (compliance manager or org admin)." },
        { status: 403 }
      );
    }
  }

  if (v.value.obligation_id && !(await obligationInWorkspace(g.pool, v.value.obligation_id, g.workspaceId))) {
    return Response.json({ error: "obligation_id does not belong to this workspace" }, { status: 400 });
  }

  const after = await transactWithAudit(
    g.pool,
    g,
    "enterprise.deadline_schedule.updated",
    "deadline_schedule",
    id,
    before,
    v.value,
    async (client) => {
      const { rows } = await client.query(
        `UPDATE deadline_schedules
            SET obligation_id=$2, schedule_type=$3, due_date=$4, recurrence_rule=$5,
                grace_days=$6, is_verified=$7, label=$8, source_note=$9
          WHERE id=$1 AND workspace_id=$10
          RETURNING id::text AS id, workspace_id::text AS workspace_id,
                    obligation_id::text AS obligation_id, schedule_type,
                    due_date::text AS due_date, recurrence_rule, grace_days,
                    is_verified, label, source_note, created_at, updated_at`,
        [
          id,
          v.value!.obligation_id,
          v.value!.schedule_type,
          v.value!.due_date,
          v.value!.recurrence_rule,
          v.value!.grace_days,
          v.value!.is_verified,
          v.value!.label,
          v.value!.source_note,
          g.workspaceId,
        ]
      );
      return rows[0];
    }
  );
  return Response.json({ schedule: serialize(after) });
}

export async function DELETE(req: Request, context: { params: Promise<{ id: string }> }) {
  const g = await enterpriseGate(req, "assign_requirements");
  if ("response" in g) return g.response;
  const { id } = await context.params;
  const before = await load(g.pool, id, g.workspaceId);
  if (!before) return Response.json({ error: "not_found" }, { status: 404 });
  await transactWithAudit(g.pool, g, "enterprise.deadline_schedule.deleted", "deadline_schedule", id, before, null,
    async (client) => {
      await client.query(`DELETE FROM deadline_schedules WHERE id=$1 AND workspace_id=$2`, [id, g.workspaceId]);
      return null;
    });
  return Response.json({ deleted: true });
}
