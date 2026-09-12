import { getCurrentUser } from "../../../lib/supabase/server";
import { getPool, isEnabled } from "../../graph/db";
import { ensureUserWorkspace } from "../../compliance/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/branding — returns the white-label branding for the signed-in
 * user's workspace. Any authenticated member may read their own workspace's
 * branding; only super admins can change it (via /api/admin/...).
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const pool = getPool();
  if (!pool || !isEnabled())
    return Response.json({ branding: null });
  try {
    const workspaceId = await ensureUserWorkspace(pool, user);
    const { rows } = await pool.query(
      `SELECT company_name, logo_url, primary_color, tagline, support_email, updated_at
         FROM workspace_branding WHERE workspace_id = $1`,
      [workspaceId]
    );
    return Response.json({ branding: rows[0] || null });
  } catch (err) {
    console.error("[branding] read failed:", (err as Error).message);
    return Response.json({ branding: null });
  }
}
