import { headers } from "next/headers";
import { getCurrentUser } from "../../../lib/supabase/server";
import { getPool, isEnabled } from "../../graph/db";
import { ensureUserWorkspace } from "../../compliance/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLS = `company_name, logo_url, primary_color, tagline, support_email, updated_at`;

/**
 * GET /api/branding — white-label branding for the current context.
 * - Signed in: the user's workspace branding.
 * - Anonymous on a custom domain: the branding mapped to that domain
 *   (so the login page already shows the client's brand).
 * Only super admins can change branding (via /api/admin/...).
 */
export async function GET() {
  const pool = getPool();
  if (!pool || !isEnabled()) return Response.json({ branding: null });
  try {
    const user = await getCurrentUser();
    if (user) {
      const workspaceId = await ensureUserWorkspace(pool, user);
      const { rows } = await pool.query(
        `SELECT ${COLS} FROM workspace_branding WHERE workspace_id = $1`,
        [workspaceId]
      );
      return Response.json({ branding: rows[0] || null });
    }
    const host = (await headers()).get("host")?.toLowerCase().split(":")[0] || "";
    if (!host) return Response.json({ branding: null });
    const { rows } = await pool.query(
      `SELECT ${COLS} FROM workspace_branding WHERE lower(custom_domain) = $1 LIMIT 1`,
      [host]
    );
    return Response.json({ branding: rows[0] || null });
  } catch (err) {
    console.error("[branding] read failed:", (err as Error).message);
    return Response.json({ branding: null });
  }
}
