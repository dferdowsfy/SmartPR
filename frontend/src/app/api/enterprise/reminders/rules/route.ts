// Enterprise reminder rules — list + create.
// Permission: GET needs view_records; mutations need assign_requirements.
// (assign_requirements chosen over manage_users because rules are an
// operational compliance setting, not user administration.)
import { enterpriseGate, obligationInWorkspace, transactWithAudit } from "../_shared";
import { validateReminderRuleInput } from "../../../../../lib/enterprise-reminders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function serialize(row: Record<string, unknown>) {
  return {
    id: row.id as string,
    workspace_id: row.workspace_id as string,
    obligation_id: (row.obligation_id as string | null) ?? null,
    obligation_name: (row.obligation_name as string | null) ?? null,
    offsets_days: (row.offsets_days as number[] | null) ?? [],
    channels: (row.channels as string[] | null) ?? ["in_app"],
    active: Boolean(row.active),
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

export async function GET(req: Request) {
  const g = await enterpriseGate(req, "view_records");
  if ("response" in g) return g.response;
  const { rows } = await g.pool.query(
    `SELECT rr.id::text AS id, rr.workspace_id::text AS workspace_id,
            rr.obligation_id::text AS obligation_id, o.name AS obligation_name,
            rr.offsets_days, rr.channels, rr.active,
            rr.created_at, rr.updated_at
       FROM reminder_rules rr
       LEFT JOIN obligations o ON o.id = rr.obligation_id
      WHERE rr.workspace_id = $1
      ORDER BY rr.created_at DESC`,
    [g.workspaceId]
  );
  return Response.json({ rules: rows.map(serialize) });
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
  const v = validateReminderRuleInput(body);
  if (!v.ok || !v.value) return Response.json({ error: "invalid_input", details: v.errors }, { status: 400 });
  if (v.value.obligation_id && !(await obligationInWorkspace(g.pool, v.value.obligation_id, g.workspaceId))) {
    return Response.json({ error: "obligation_id does not belong to this workspace" }, { status: 400 });
  }
  const created = await transactWithAudit(
    g.pool,
    g,
    "enterprise.reminder_rule.created",
    "reminder_rule",
    null, // id unknown until insert; the after-payload carries it
    null,
    { ...v.value },
    async (client) => {
      const { rows } = await client.query(
        `INSERT INTO reminder_rules (workspace_id, obligation_id, offsets_days, channels, active)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING id::text AS id, workspace_id::text AS workspace_id,
                   obligation_id::text AS obligation_id, offsets_days, channels, active,
                   created_at, updated_at`,
        [g.workspaceId, v.value!.obligation_id, v.value!.offsets_days, v.value!.channels, v.value!.active]
      );
      return rows[0];
    }
  );
  return Response.json({ rule: serialize({ ...created, obligation_name: null }) }, { status: 201 });
}
