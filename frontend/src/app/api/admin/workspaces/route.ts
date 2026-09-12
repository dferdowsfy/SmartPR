import { getPool, isEnabled } from "../../../graph/db";
import { requireSuperAdmin } from "../_util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Super-admin: list all companies/workspaces with plan, member + business counts. */
export async function GET() {
  const gate = await requireSuperAdmin();
  if ("response" in gate) return gate.response;
  if (!isEnabled()) return Response.json({ error: "no_database" }, { status: 503 });
  const pool = getPool();
  if (!pool) return Response.json({ error: "no_database" }, { status: 503 });

  const { rows } = await pool.query(
    `SELECT w.id, w.name, w.kind, w.created_at, w.archived_at,
            ws.plan, ws.status AS subscription_status,
            (SELECT lower(u.email) FROM auth.users u WHERE u.id = w.owner_user_id) AS owner_email,
            (SELECT COUNT(*)::int FROM workspace_members wm WHERE wm.workspace_id = w.id) AS member_count,
            (SELECT COUNT(*)::int FROM businesses b WHERE b.workspace_id = w.id) AS business_count,
            (SELECT jsonb_build_object(company_name, company_name, logo_url, logo_url, primary_color, primary_color)
               FROM workspace_branding br WHERE br.workspace_id = w.id) AS branding
       FROM workspaces w
       LEFT JOIN workspace_subscriptions ws ON ws.workspace_id = w.id
      ORDER BY w.created_at DESC
      LIMIT 200`
  );
  return Response.json({ workspaces: rows });
}
