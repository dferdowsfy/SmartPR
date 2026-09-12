// Enterprise escalation policies — list + create.
// Permission: GET needs view_records; mutations need assign_requirements
// (same operational rationale as reminder rules).
import { enterpriseGate, transactWithAudit } from "../_shared";
import { validateEscalationPolicyInput } from "../../../../../lib/enterprise-reminders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const g = await enterpriseGate(req, "view_records");
  if ("response" in g) return g.response;
  const { rows } = await g.pool.query(
    `SELECT id::text AS id, workspace_id::text AS workspace_id,
            trigger, steps, active, created_at, updated_at
       FROM escalation_policies
      WHERE workspace_id = $1
      ORDER BY created_at DESC`,
    [g.workspaceId]
  );
  return Response.json({ policies: rows });
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
  const v = validateEscalationPolicyInput(body);
  if (!v.ok || !v.value) return Response.json({ error: "invalid_input", details: v.errors }, { status: 400 });
  const created = await transactWithAudit(
    g.pool,
    g,
    "enterprise.escalation_policy.created",
    "escalation_policy",
    null,
    null,
    { ...v.value },
    async (client) => {
      const { rows } = await client.query(
        `INSERT INTO escalation_policies (workspace_id, trigger, steps, active)
         VALUES ($1,$2,$3,$4)
         RETURNING id::text AS id, workspace_id::text AS workspace_id,
                   trigger, steps, active, created_at, updated_at`,
        [g.workspaceId, v.value!.trigger, JSON.stringify(v.value!.steps), v.value!.active]
      );
      return rows[0];
    }
  );
  return Response.json({ policy: created }, { status: 201 });
}
