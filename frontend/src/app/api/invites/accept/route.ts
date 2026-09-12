import { getPool, isEnabled } from "../../../graph/db";
import { getCurrentUser } from "../../../../lib/supabase/server";
import { auditLog } from "../../admin/_util";
import {
  ensureSystemRoles,
  validateScope,
} from "../../../../lib/enterprise/workspaceRoles";
import { isRoleKey } from "../../../../lib/enterprise-permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Accept a workspace invitation. The signed-in user's email must match the
 * invite email (case-insensitive), and the invite must be unexpired.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user?.email) return Response.json({ error: "signin_required" }, { status: 401 });
  if (!isEnabled()) return Response.json({ error: "no_database" }, { status: 503 });
  const pool = getPool();
  if (!pool) return Response.json({ error: "no_database" }, { status: 503 });

  const body = (await request.json().catch(() => ({}))) as { token?: string };
  const token = (body.token || "").trim();
  if (!token) return Response.json({ error: "token required" }, { status: 400 });

  const inv = await pool.query(
    `SELECT id, workspace_id, email, role, w.name AS workspace_name,
            enterprise_role_key, enterprise_role_scope_type, enterprise_role_scope_id
       FROM workspace_invites i JOIN workspaces w ON w.id = i.workspace_id
      WHERE i.token = $1 AND i.accepted_at IS NULL AND i.expires_at > now()`,
    [token]
  );
  const invite = inv.rows[0];
  if (!invite) return Response.json({ error: "invalid or expired invitation" }, { status: 400 });
  if (invite.email.toLowerCase() !== user.email.toLowerCase()) {
    return Response.json({ error: "this invitation was sent to a different email address" }, { status: 403 });
  }

  await pool.query(
    `INSERT INTO workspace_members (workspace_id, user_id, role)
     VALUES ($1,$2,$3)
     ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
    [invite.workspace_id, user.id, invite.role]
  );
  await pool.query(`UPDATE workspace_invites SET accepted_at = now() WHERE id = $1`, [invite.id]);

  // Enterprise invites carry a role key + scope: materialize the matching
  // role_assignment so the new member lands with the intended enterprise role.
  if (isRoleKey(invite.enterprise_role_key)) {
    try {
      const roleIds = await ensureSystemRoles(pool, invite.workspace_id);
      const roleId = roleIds.get(invite.enterprise_role_key);
      const scopeId = await validateScope(
        pool,
        invite.workspace_id,
        invite.enterprise_role_scope_type || "organization",
        invite.enterprise_role_scope_id
      );
      if (roleId) {
        await pool.query(
          `INSERT INTO role_assignments (user_id, workspace_id, enterprise_role_id, scope_type, scope_id)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT DO NOTHING`,
          [
            user.id,
            invite.workspace_id,
            roleId,
            invite.enterprise_role_scope_type || "organization",
            scopeId,
          ]
        );
      }
    } catch (e) {
      console.error("[invite-accept] enterprise role assignment failed:", (e as Error).message);
    }
  }

  await auditLog({
    actorUserId: user.id,
    actorEmail: user.email,
    workspaceId: invite.workspace_id,
    action: "team.invite_accepted",
    targetEmail: user.email,
    targetUserId: user.id,
    details: { role: invite.role, enterprise_role: invite.enterprise_role_key ?? null },
  });

  return Response.json({
    ok: true,
    workspaceId: invite.workspace_id,
    workspaceName: invite.workspace_name,
    role: invite.role,
  });
}
