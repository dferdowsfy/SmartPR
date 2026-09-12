// The grant behind the sp_support_ws cookie, for the admin banner.
// Gate: requireSuperAdmin. Returns { grant } (active) or { grant: null }.
import { getPool, isEnabled } from "../../../../graph/db";
import { requireSuperAdmin } from "../../_util";
import { getActiveSupportGrant } from "../../../../../lib/enterprise-permissions";
import { SUPPORT_COOKIE } from "../../workspaces/[id]/support-access/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const gate = await requireSuperAdmin();
  if ("response" in gate) return gate.response;
  if (!isEnabled()) return Response.json({ grant: null });
  const pool = getPool();
  if (!pool) return Response.json({ grant: null });
  const ctx = gate.ctx;

  const cookieHeader = request.headers.get("cookie") || "";
  const match = cookieHeader.match(new RegExp(`${SUPPORT_COOKIE}=([^;]+)`));
  if (!match) return Response.json({ grant: null });
  let parsed: { grant_id?: string; workspace_id?: string } | null = null;
  try {
    parsed = JSON.parse(decodeURIComponent(match[1]));
  } catch {
    return Response.json({ grant: null });
  }
  if (!parsed?.workspace_id) return Response.json({ grant: null });

  const grant = await getActiveSupportGrant(pool, parsed.workspace_id, ctx.email);
  if (!grant || (parsed.grant_id && grant.id !== parsed.grant_id)) {
    return Response.json({ grant: null });
  }
  const ws = await pool.query(`SELECT name FROM workspaces WHERE id = $1`, [grant.workspaceId]);
  return Response.json({
    grant: { ...grant, workspace_name: ws.rows[0]?.name ?? grant.workspaceId },
  });
}
