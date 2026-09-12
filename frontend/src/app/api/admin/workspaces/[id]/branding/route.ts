import { getPool, isEnabled } from "../../../../../graph/db";
import { requireSuperAdmin, auditLog } from "../../../_util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Super-admin: read a workspace's white-label branding. */
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
    `SELECT company_name, logo_url, primary_color, custom_domain,
            sso_enabled, sso_domain, sso_provider_id, updated_at
       FROM workspace_branding WHERE workspace_id = $1`,
    [id]
  );
  return Response.json({ branding: rows[0] ?? null });
}

function normalizeDomain(input: string): string | null {
  let d = (input || "").trim().toLowerCase();
  if (!d) return null;
  d = d.replace(/^https?:\/\//, "").split("/")[0].split(":")[0];
  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/.test(d)) {
    return null;
  }
  return d;
}

type BrandingBody = {
  company_name?: string;
  logo_url?: string;
  primary_color?: string;
  custom_domain?: string;
  sso_enabled?: boolean;
  sso_domain?: string;
  sso_provider_id?: string;
};

/** Super-admin: save white-label branding for a workspace. */
export async function PUT(
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

  const ws = await pool.query(`SELECT id FROM workspaces WHERE id = $1`, [workspaceId]);
  if (!ws.rows[0]) return Response.json({ error: "not_found" }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as BrandingBody;
  const companyName = (body.company_name || "").trim() || null;
  const logoUrl = (body.logo_url || "").trim() || null;
  let primaryColor = (body.primary_color || "").trim() || null;
  if (primaryColor && !/^#[0-9a-fA-F]{6}$/.test(primaryColor)) {
    return Response.json({ error: "primary_color must be a hex color like #245c5c" }, { status: 400 });
  }
  const customDomain = normalizeDomain(body.custom_domain || "");
  if (body.custom_domain && body.custom_domain.trim() && !customDomain) {
    return Response.json({ error: "custom_domain is not a valid domain" }, { status: 400 });
  }
  const ssoEnabled = body.sso_enabled === true;
  const ssoDomain = normalizeDomain(body.sso_domain || "");
  if (ssoEnabled && !ssoDomain) {
    return Response.json({ error: "sso_domain is required when SSO is enabled" }, { status: 400 });
  }
  const ssoProviderId = (body.sso_provider_id || "").trim() || null;

  await pool.query(
    `INSERT INTO workspace_branding
       (workspace_id, company_name, logo_url, primary_color, custom_domain,
        sso_enabled, sso_domain, sso_provider_id, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())
     ON CONFLICT (workspace_id) DO UPDATE SET
       company_name = EXCLUDED.company_name,
       logo_url = EXCLUDED.logo_url,
       primary_color = EXCLUDED.primary_color,
       custom_domain = EXCLUDED.custom_domain,
       sso_enabled = EXCLUDED.sso_enabled,
       sso_domain = EXCLUDED.sso_domain,
       sso_provider_id = EXCLUDED.sso_provider_id,
       updated_at = now()`,
    [workspaceId, companyName, logoUrl, primaryColor, customDomain, ssoEnabled, ssoDomain, ssoProviderId]
  );

  await auditLog({
    actorUserId: ctx.userId,
    actorEmail: ctx.email,
    workspaceId,
    action: "branding.update",
    details: {
      company_name: companyName, logo_url: logoUrl, primary_color: primaryColor,
      custom_domain: customDomain, sso_enabled: ssoEnabled, sso_domain: ssoDomain,
    },
  });

  return Response.json({ ok: true });
}
