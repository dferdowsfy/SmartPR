import { getPool, isEnabled } from "../../../../../../graph/db";
import { requireSuperAdmin, auditLog } from "../../../../_util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Super-admin: remove a member from a workspace (last-owner protected). */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSuperAdmin();
  if ("response" in gate) return gate.response;
  if (!isEnabled()) return Response.json({ error: "no_database" }, { status: 503 });
  const pool = getPool();
  if (!pool) return Response.json({ error: "no_database" }, { status: 503 });
  const { id: workspaceId } = await params;
  const ctx = gate.ctx;

  const body = (await request.json().catch(() => ({}))) as { userId?: string };
  if (!body.userId) return Response.json({ error: "userId required" }, { status: 400 });

  const cur = await pool.query<{ role: string }>(
    `SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`,
    [workspaceId, body.userId]
  );
  if (!cur.rows[0]) return Response.json({ error: "not a member" }, { status: 404 });

  if (cur.rows[0].role === "OWNER") {
    const owners = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM workspace_members WHERE workspace_id = $1 AND role = 'OWNER'`,
      [workspaceId]
    );
    if (Number(owners.rows[0]?.n || 0) <= 1) {
      return Response.json({ error: "cannot remove the last owner" }, { status: 400 });
    }
  }

  const target = await pool.query<{ email: string }>(
    `SELECT lower(email) AS email FROM auth.users WHERE id = $1`,
    [body.userId]
  );
  await pool.query(
    `DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`,
    [workspaceId, body.userId]
  );

  await auditLog({
    actorUserId: ctx.userId,
    actorEmail: ctx.email,
    workspaceId,
    action: "team.remove",
    targetEmail: target.rows[0]?.email ?? null,
    targetUserId: body.userId,
    details: { previousRole: cur.rows[0].role },
  });

  return Response.json({ ok: true });
}
