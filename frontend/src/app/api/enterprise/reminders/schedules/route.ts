// Enterprise deadline schedules — list + create.
//
// INTEGRITY RULE: only rows with is_verified=true are presented as
// "verified deadline"; everything else is an "internal target" (see the
// `badge` field). A schedule can be marked verified only with a source_note
// naming the authoritative source AND the approve_evidence permission
// (compliance managers / org admins) — validating a deadline is a
// verification act, not a routine assignment.
//
// Permission: GET needs view_records; mutations need assign_requirements,
// upgraded to approve_evidence when is_verified=true is requested.
import { enterpriseGate, obligationInWorkspace, transactWithAudit } from "../_shared";
import {
  validateDeadlineScheduleInput,
  computeEffectiveDueDate,
} from "../../../../../lib/enterprise-reminders";
import { hasPermission } from "../../../../../lib/enterprise-permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function serialize(row: Record<string, unknown>) {
  const isVerified = Boolean(row.is_verified);
  const due = (row.due_date as string) ?? "";
  return {
    id: row.id as string,
    workspace_id: row.workspace_id as string,
    obligation_id: (row.obligation_id as string | null) ?? null,
    obligation_name: (row.obligation_name as string | null) ?? null,
    business_name: (row.business_name as string | null) ?? null,
    schedule_type: row.schedule_type as string,
    due_date: due,
    recurrence_rule: (row.recurrence_rule as string | null) ?? null,
    grace_days: Number(row.grace_days) || 0,
    effective_due_date: due ? computeEffectiveDueDate(due, Number(row.grace_days) || 0) : null,
    is_verified: isVerified,
    /** NEVER present an unverified date as regulatory. */
    badge: (isVerified ? "verified deadline" : "internal target") as string,
    label: (row.label as string | null) ?? null,
    source_note: (row.source_note as string | null) ?? null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

export async function GET(req: Request) {
  const g = await enterpriseGate(req, "view_records");
  if ("response" in g) return g.response;
  const { rows } = await g.pool.query(
    `SELECT ds.id::text AS id, ds.workspace_id::text AS workspace_id,
            ds.obligation_id::text AS obligation_id, o.name AS obligation_name,
            b.name AS business_name, ds.schedule_type, ds.due_date::text AS due_date,
            ds.recurrence_rule, ds.grace_days, ds.is_verified, ds.label,
            ds.source_note, ds.created_at, ds.updated_at
       FROM deadline_schedules ds
       LEFT JOIN obligations o ON o.id = ds.obligation_id
       LEFT JOIN businesses b ON b.id = o.business_id
      WHERE ds.workspace_id = $1
      ORDER BY ds.due_date ASC NULLS LAST, ds.created_at DESC`,
    [g.workspaceId]
  );
  return Response.json({ schedules: rows.map(serialize) });
}

export async function POST(req: Request) {
  const g = await enterpriseGate(req, "assign_requirements");
  if ("response" in g) return g.response;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const v = validateDeadlineScheduleInput(body);
  if (!v.ok || !v.value) return Response.json({ error: "invalid_input", details: v.errors }, { status: 400 });

  // Marking a deadline verified is a verification act: require the
  // approve_evidence permission on top of assign_requirements.
  if (v.value.is_verified) {
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

  const created = await transactWithAudit(
    g.pool,
    g,
    "enterprise.deadline_schedule.created",
    "deadline_schedule",
    null,
    null,
    { ...v.value },
    async (client) => {
      const { rows } = await client.query(
        `INSERT INTO deadline_schedules
           (workspace_id, obligation_id, schedule_type, due_date, recurrence_rule,
            grace_days, is_verified, label, source_note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id::text AS id, workspace_id::text AS workspace_id,
                   obligation_id::text AS obligation_id, schedule_type,
                   due_date::text AS due_date, recurrence_rule, grace_days,
                   is_verified, label, source_note, created_at, updated_at`,
        [
          g.workspaceId,
          v.value!.obligation_id,
          v.value!.schedule_type,
          v.value!.due_date,
          v.value!.recurrence_rule,
          v.value!.grace_days,
          v.value!.is_verified,
          v.value!.label,
          v.value!.source_note,
        ]
      );
      return rows[0];
    }
  );
  return Response.json(
    { schedule: serialize({ ...created, obligation_name: null, business_name: null }) },
    { status: 201 }
  );
}
