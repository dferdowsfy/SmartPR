import { getPool, isEnabled } from "../../../graph/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/sso/lookup?domain=company.com — public check whether SSO is
 * enabled for an email domain. Returns only a boolean so no workspace
 * details leak; the actual SAML handshake happens via Supabase Auth.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const domain = (searchParams.get("domain") || "").trim().toLowerCase();
  if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) {
    return Response.json({ sso_enabled: false });
  }
  const pool = getPool();
  if (!pool || !isEnabled()) return Response.json({ sso_enabled: false });
  try {
    const { rows } = await pool.query(
      `SELECT 1 FROM workspace_branding
        WHERE sso_enabled = true AND lower(sso_domain) = $1 LIMIT 1`,
      [domain]
    );
    if (rows.length === 0) return Response.json({ sso_enabled: false });
    // Phase 6: expose enforcement state so the login UI can hide password
    // sign-in for enforced domains. Additive only — existing callers keep
    // working on the sso_enabled boolean.
    const enf = await pool.query(
      `SELECT sso_enforcement FROM workspace_branding
        WHERE sso_enabled = true AND lower(sso_domain) = $1 LIMIT 1`,
      [domain]
    );
    return Response.json({
      sso_enabled: true,
      sso_enforced: enf.rows[0]?.sso_enforcement === "enabled",
    });
  } catch {
    return Response.json({ sso_enabled: false });
  }
}
