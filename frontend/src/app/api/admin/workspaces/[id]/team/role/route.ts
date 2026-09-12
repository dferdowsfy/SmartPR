import { getPool, isEnabled } from "../../../../../../graph/db";
import { requireSuperAdmin, auditLog } from "../../../../_util";
import { checkRoleChange } from "../route";
import type { WorkspaceRole } from "../../../../../../../lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_ROLES = ["OWNER", "ADMIN", "MEMBER", "VIEWER"] as const;

/** Super-admin: change a member's role (hierarchy rules enforced). */
export async function PATCH(
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

  const body = (await request.json().catch(() => ({}))) as { userId?: string; role?: string };
  const role = (body.role || "").toUpperCase();
  if (!body.userId || !(VALID_ROLES as readonly string[]).includes(role)) {
    return Response.json({ error: "userId and valid role required" }, { status: 400 });
  }

  const problem = await checkRoleChange(pool, workspaceId, body.userId, role as WorkspaceRole);
  if (problem) return Response.json({ error: problem }, { status: 400 });

  const before = await pool.query<{ role: WorkspaceRole }>(
    `SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`,
    [workspaceId, body.userId]
  );
  await pool.query(
    `UPDATE workspace_members SET role = $1 WHERE workspace_id = $2 AND user_id = $3`,
    [role, workspaceId, body.userId]
  );
  const target = await pool.query<{ email: string }>(
    `SELECT lower(email) AS email FROM auth.users WHERE id = $1`,
    [body.userId]
  );

  await auditLog({
    actorUserId: ctx.userId,
    actorEmail: ctx.email,
    workspaceId,
    action: "team.role_change",
    targetEmail: target.rows[0]?.email ?? null,
    targetUserId: body.userId,
    details: { from: before.rows[0]?.role, to: role },
  });

  return Response.json({ ok: true, role });
}
