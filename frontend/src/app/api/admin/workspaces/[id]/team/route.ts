import { randomUUID } from "crypto";
import { getPool, isEnabled } from "../../../../../graph/db";
import { requireSuperAdmin, auditLog } from "../../../_util";
import { roleRank, type WorkspaceRole } from "../../../../../../lib/admin";
import {
  newInviteToken,
  inviteUrlForToken,
  buildInviteEmailHtml,
  sendInviteEmail,
} from "../../../../../../lib/invites";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_ROLES = ["OWNER", "ADMIN", "MEMBER", "VIEWER"] as const;

/** Super-admin: team members (with emails) + pending invites for a workspace. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSuperAdmin();
  if ("response" in gate) return gate.response;
  if (!isEnabled()) return Response.json({ error: "no_database" }, { status: 503 });
  const pool = getPool();
  if (!pool) return Response.json({ error: "no_database" }, { status: 503 });
  const { id } = await params;

  const members = await pool.query(
    `SELECT wm.user_id, wm.role, wm.created_at AS joined_at,
            lower(u.email) AS email,
            (u.raw_user_meta_data ->> 'full_name') AS full_name
       FROM workspace_members wm
       LEFT JOIN auth.users u ON u.id = wm.user_id
      WHERE wm.workspace_id = $1
      ORDER BY
        CASE wm.role WHEN 'OWNER' THEN 0 WHEN 'ADMIN' THEN 1 WHEN 'MEMBER' THEN 2 ELSE 3 END,
        lower(u.email) ASC NULLS LAST`,
    [id]
  );
  const invites = await pool.query(
    `SELECT id, email, role, expires_at, accepted_at, created_at
       FROM workspace_invites
      WHERE workspace_id = $1 AND accepted_at IS NULL AND expires_at > now()
      ORDER BY created_at DESC`,
    [id]
  );
  return Response.json({ members: members.rows, invites: invites.rows });
}

type InviteBody = { email?: string; role?: string };

/** Super-admin: invite someone to the workspace. Returns the invite link (also emailed, best-effort). */
export async function POST(
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

  const body = (await request.json().catch(() => ({}))) as InviteBody;
  const email = (body.email || "").trim().toLowerCase();
  const role = (body.role || "MEMBER").toUpperCase();
  if (!email || !email.includes("@")) {
    return Response.json({ error: "valid email required" }, { status: 400 });
  }
  if (!(VALID_ROLES as readonly string[]).includes(role)) {
    return Response.json({ error: "invalid role" }, { status: 400 });
  }

  const ws = await pool.query(`SELECT id, name FROM workspaces WHERE id = $1`, [workspaceId]);
  if (!ws.rows[0]) return Response.json({ error: "not_found" }, { status: 404 });

  // Already a member? Don't double-invite.
  const existing = await pool.query(
    `SELECT wm.role FROM workspace_members wm
       JOIN auth.users u ON u.id = wm.user_id
      WHERE wm.workspace_id = $1 AND lower(u.email) = $2`,
    [workspaceId, email]
  );
  if (existing.rows[0]) {
    return Response.json(
      { error: "already_member", role: existing.rows[0].role },
      { status: 409 }
    );
  }

  // Refresh any outstanding invite for the same email.
  await pool.query(
    `DELETE FROM workspace_invites WHERE workspace_id = $1 AND lower(email) = $2 AND accepted_at IS NULL`,
    [workspaceId, email]
  );

  const token = newInviteToken();
  const inviteId = randomUUID();
  await pool.query(
    `INSERT INTO workspace_invites (id, workspace_id, email, role, invited_by, token)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [inviteId, workspaceId, email, role, ctx.userId, token]
  );

  const inviteUrl = inviteUrlForToken(token);
  const emailed = await sendInviteEmail(
    email,
    buildInviteEmailHtml({
      workspaceName: ws.rows[0].name,
      role,
      inviteUrl,
      inviterEmail: ctx.email,
    })
  );

  await auditLog({
    actorUserId: ctx.userId,
    actorEmail: ctx.email,
    workspaceId,
    action: "team.invite",
    targetEmail: email,
    details: { role, emailed },
  });

  return Response.json({ invite: { id: inviteId, email, role, inviteUrl, emailed } });
}

/** Guard: hierarchy rules for changing someone's role. Returns an error string or null. */
export async function checkRoleChange(
  pool: NonNullable<ReturnType<typeof getPool>>,
  workspaceId: string,
  targetUserId: string,
  newRole: WorkspaceRole
): Promise<string | null> {
  const cur = await pool.query<{ role: WorkspaceRole }>(
    `SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`,
    [workspaceId, targetUserId]
  );
  const currentRole = cur.rows[0]?.role;
  if (!currentRole) return "not a member of this workspace";
  if (currentRole === newRole) return "role unchanged";
  // Never leave a workspace without an owner.
  if (currentRole === "OWNER" && newRole !== "OWNER") {
    const owners = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM workspace_members WHERE workspace_id = $1 AND role = 'OWNER'`,
      [workspaceId]
    );
    if (Number(owners.rows[0]?.n || 0) <= 1) return "cannot demote the last owner";
  }
  void roleRank;
  return null;
}
