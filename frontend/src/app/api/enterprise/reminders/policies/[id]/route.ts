// Enterprise escalation policies — update + delete.
import { enterpriseGate, transactWithAudit } from "../../_shared";
import { validateEscalationPolicyInput } from "../../../../../../lib/enterprise-reminders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function load(pool: { query: (t: string, p?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> }, id: string, workspaceId: string) {
  const { rows } = await pool.query(
    `SELECT id::text AS id, workspace_id::text AS workspace_id, trigger, steps, active
       FROM escalation_policies WHERE id = $1 AND workspace_id = $2 LIMIT 1`,
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
  const merged = { trigger: before.trigger, steps: before.steps, active: before.active, ...(body as Record<string, unknown>) };
  const v = validateEscalationPolicyInput(merged);
  if (!v.ok || !v.value) return Response.json({ error: "invalid_input", details: v.errors }, { status: 400 });
  const after = await transactWithAudit(
    g.pool,
    g,
    "enterprise.escalation_policy.updated",
    "escalation_policy",
    id,
    before,
    v.value,
    async (client) => {
      const { rows } = await client.query(
        `UPDATE escalation_policies SET trigger=$2, steps=$3, active=$4
          WHERE id=$1 AND workspace_id=$5
          RETURNING id::text AS id, workspace_id::text AS workspace_id,
                    trigger, steps, active, created_at, updated_at`,
        [id, v.value!.trigger, JSON.stringify(v.value!.steps), v.value!.active, g.workspaceId]
      );
      return rows[0];
    }
  );
  return Response.json({ policy: after });
}

export async function DELETE(req: Request, context: { params: Promise<{ id: string }> }) {
  const g = await enterpriseGate(req, "assign_requirements");
  if ("response" in g) return g.response;
  const { id } = await context.params;
  const before = await load(g.pool, id, g.workspaceId);
  if (!before) return Response.json({ error: "not_found" }, { status: 404 });
  await transactWithAudit(g.pool, g, "enterprise.escalation_policy.deleted", "escalation_policy", id, before, null,
    async (client) => {
      await client.query(`DELETE FROM escalation_policies WHERE id=$1 AND workspace_id=$2`, [id, g.workspaceId]);
      return null;
    });
  return Response.json({ deleted: true });
}
