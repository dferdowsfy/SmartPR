import { getPool, isEnabled } from "../../../../graph/db";
import { requireSuperAdmin } from "../../_util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Super-admin: single workspace detail (plan, branding, counts). */
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

  const { rows } = await pool.query(
    `SELECT w.id, w.name, w.kind, w.created_at, w.archived_at,
            ws.plan, ws.status AS subscription_status,
            ws.owner_email,
            (SELECT lower(u.email) FROM auth.users u WHERE u.id = w.owner_user_id) AS owner_user_email,
            (SELECT COUNT(*)::int FROM workspace_members wm WHERE wm.workspace_id = w.id) AS member_count,
            (SELECT COUNT(*)::int FROM businesses b WHERE b.workspace_id = w.id) AS business_count,
            (SELECT COUNT(*)::int FROM workspace_invites i
              WHERE i.workspace_id = w.id AND i.accepted_at IS NULL AND i.expires_at > now()) AS pending_invites,
            (SELECT row_to_json(br) FROM workspace_branding br WHERE br.workspace_id = w.id) AS branding
       FROM workspaces w
       LEFT JOIN workspace_subscriptions ws ON ws.workspace_id = w.id
      WHERE w.id = $1`,
    [id]
  );
  if (!rows[0]) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ workspace: rows[0] });
}
