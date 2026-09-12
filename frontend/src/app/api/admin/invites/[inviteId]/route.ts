import { getPool, isEnabled } from "../../../../graph/db";
import { requireSuperAdmin, auditLog } from "../../_util";
import {
  newInviteToken,
  inviteUrlForToken,
  buildInviteEmailHtml,
  sendInviteEmail,
} from "../../../../../lib/invites";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Super-admin: resend a pending invite (fresh token + expiry). */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ inviteId: string }> }
) {
  const gate = await requireSuperAdmin();
  if ("response" in gate) return gate.response;
  if (!isEnabled()) return Response.json({ error: "no_database" }, { status: 503 });
  const pool = getPool();
  if (!pool) return Response.json({ error: "no_database" }, { status: 503 });
  const { inviteId } = await params;
  const ctx = gate.ctx;

  const inv = await pool.query(
    `SELECT i.id, i.workspace_id, i.email, i.role, w.name AS workspace_name,
            b.company_name AS brand_name
       FROM workspace_invites i
       JOIN workspaces w ON w.id = i.workspace_id
       LEFT JOIN workspace_branding b ON b.workspace_id = i.workspace_id
      WHERE i.id = $1 AND i.accepted_at IS NULL`,
    [inviteId]
  );
  if (!inv.rows[0]) return Response.json({ error: "not_found" }, { status: 404 });

  const token = newInviteToken();
  await pool.query(
    `UPDATE workspace_invites SET token = $1, expires_at = now() + interval '7 days' WHERE id = $2`,
    [token, inviteId]
  );
  const inviteUrl = inviteUrlForToken(token);
  const emailed = await sendInviteEmail(
    inv.rows[0].email,
    buildInviteEmailHtml({
      workspaceName: inv.rows[0].brand_name || inv.rows[0].workspace_name,
      role: inv.rows[0].role,
      inviteUrl,
      inviterEmail: ctx.email,
    })
  );

  await auditLog({
    actorUserId: ctx.userId,
    actorEmail: ctx.email,
    workspaceId: inv.rows[0].workspace_id,
    action: "team.invite_resend",
    targetEmail: inv.rows[0].email,
    details: { emailed },
  });

  return Response.json({ ok: true, inviteUrl, emailed });
}

/** Super-admin: revoke a pending invite. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ inviteId: string }> }
) {
  const gate = await requireSuperAdmin();
  if ("response" in gate) return gate.response;
  if (!isEnabled()) return Response.json({ error: "no_database" }, { status: 503 });
  const pool = getPool();
  if (!pool) return Response.json({ error: "no_database" }, { status: 503 });
  const { inviteId } = await params;
  const ctx = gate.ctx;

  const inv = await pool.query(
    `DELETE FROM workspace_invites WHERE id = $1 AND accepted_at IS NULL
      RETURNING workspace_id, email`,
    [inviteId]
  );
  if (!inv.rows[0]) return Response.json({ error: "not_found" }, { status: 404 });

  await auditLog({
    actorUserId: ctx.userId,
    actorEmail: ctx.email,
    workspaceId: inv.rows[0].workspace_id,
    action: "team.invite_revoke",
    targetEmail: inv.rows[0].email,
  });

  return Response.json({ ok: true });
}
