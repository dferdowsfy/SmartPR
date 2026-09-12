// Enterprise reminder rules — update + delete.
import { enterpriseGate, obligationInWorkspace, transactWithAudit } from "../../_shared";
import { validateReminderRuleInput } from "../../../../../../lib/enterprise-reminders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function load(pool: { query: (t: string, p?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> }, id: string, workspaceId: string) {
  const { rows } = await pool.query(
    `SELECT id::text AS id, workspace_id::text AS workspace_id,
            obligation_id::text AS obligation_id,
            offsets_days, channels, active
       FROM reminder_rules WHERE id = $1 AND workspace_id = $2 LIMIT 1`,
    [id, workspaceId]
  );
  return rows[0] ?? null;
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
  // PATCH merges: validate the full merged shape.
  const merged = {
    obligation_id: before.obligation_id,
    offsets_days: before.offsets_days,
    channels: before.channels,
    active: before.active,
    ...(body as Record<string, unknown>),
  };
  const v = validateReminderRuleInput(merged);
  if (!v.ok || !v.value) return Response.json({ error: "invalid_input", details: v.errors }, { status: 400 });
  if (v.value.obligation_id && !(await obligationInWorkspace(g.pool, v.value.obligation_id, g.workspaceId))) {
    return Response.json({ error: "obligation_id does not belong to this workspace" }, { status: 400 });
  }
  const after = await transactWithAudit(
    g.pool,
    g,
    "enterprise.reminder_rule.updated",
    "reminder_rule",
    id,
    before,
    v.value,
    async (client) => {
      const { rows } = await client.query(
        `UPDATE reminder_rules
            SET obligation_id=$2, offsets_days=$3, channels=$4, active=$5
          WHERE id=$1 AND workspace_id=$6
          RETURNING id::text AS id, workspace_id::text AS workspace_id,
                    obligation_id::text AS obligation_id, offsets_days, channels, active,
                    created_at, updated_at`,
        [id, v.value!.obligation_id, v.value!.offsets_days, v.value!.channels, v.value!.active, g.workspaceId]
      );
      return rows[0];
    }
  );
  return Response.json({ rule: after });
}

export async function DELETE(req: Request, context: { params: Promise<{ id: string }> }) {
  const g = await enterpriseGate(req, "assign_requirements");
  if ("response" in g) return g.response;
  const { id } = await context.params;
  const before = await load(g.pool, id, g.workspaceId);
  if (!before) return Response.json({ error: "not_found" }, { status: 404 });
  await transactWithAudit(g.pool, g, "enterprise.reminder_rule.deleted", "reminder_rule", id, before, null,
    async (client) => {
      await client.query(`DELETE FROM reminder_rules WHERE id=$1 AND workspace_id=$2`, [id, g.workspaceId]);
      return null;
    });
  return Response.json({ deleted: true });
}
