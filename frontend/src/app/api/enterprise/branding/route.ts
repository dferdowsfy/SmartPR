// /api/enterprise/branding — Phase 8 white-label branding (hardened).
//
// GET  ?workspace_id=  -> current branding + signed preview URLs for the
//                        stored logo paths (private `brand-assets` bucket).
// PUT  {workspace_id, company_name, primary_color, logo_primary_path,
//       logo_compact_path, favicon_path, email_header_html, login_branding,
//       terminology}
//      -> publishes branding. Logo paths must come from the upload step
//         (POST /api/enterprise/branding/logo) for the same workspace;
//         primary_color must be #rrggbb; email_header_html is sanitized.
//
// Gate: platform super admin OR `configure_branding_security` permission.
// Both endpoints audit to audit_events (before/after).

import { getPool, isEnabled } from "../../../../app/graph/db";
import { createSupabaseServer, isAuthConfigured } from "../../../../lib/supabase/server";
import { requireBrandingSecurity } from "../../../../lib/enterprise-gate";
import {
  isHexColor,
  isLogoKind,
  isPublishableLogoPath,
  sanitizeEmailHeaderHtml,
  validateLoginBranding,
  validateTerminology,
} from "../../../../lib/enterprise-branding";
import { writeAuditEvent, getRequestMeta } from "../../../../lib/enterprise-permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIGNED_URL_TTL_SECONDS = 3600;

const SELECT_COLS = `company_name, logo_url, primary_color, tagline, support_email,
  custom_domain, logo_primary_path, logo_compact_path, favicon_path,
  email_header_html, login_branding, terminology, updated_at`;

type BrandingRow = {
  company_name: string | null;
  logo_url: string | null;
  primary_color: string | null;
  tagline: string | null;
  support_email: string | null;
  custom_domain: string | null;
  logo_primary_path: string | null;
  logo_compact_path: string | null;
  favicon_path: string | null;
  email_header_html: string | null;
  login_branding: Record<string, unknown> | null;
  terminology: Record<string, string> | null;
  updated_at: string | null;
};

async function signedPreviewUrls(
  row: BrandingRow | null
): Promise<{ primary: string | null; compact: string | null; favicon: string | null }> {
  const out = { primary: null as string | null, compact: null as string | null, favicon: null as string | null };
  if (!row || !isAuthConfigured()) return out;
  const paths = { primary: row.logo_primary_path, compact: row.logo_compact_path, favicon: row.favicon_path };
  const supabase = await createSupabaseServer();
  if (!supabase) return out;
  for (const [key, path] of Object.entries(paths) as Array<[keyof typeof out, string | null]>) {
    if (!path) continue;
    try {
      const { data, error } = await supabase.storage
        .from("brand-assets")
        .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
      if (!error && data?.signedUrl) out[key] = data.signedUrl;
    } catch {
      // Leave the preview null; the path is still returned.
    }
  }
  return out;
}

/** GET /api/enterprise/branding?workspace_id=… */
export async function GET(request: Request) {
  const workspaceId = new URL(request.url).searchParams.get("workspace_id") || "";
  const gate = await requireBrandingSecurity(workspaceId);
  if ("response" in gate) return gate.response;
  if (!isEnabled()) return Response.json({ error: "no_database" }, { status: 503 });
  const pool = getPool();
  if (!pool) return Response.json({ error: "no_database" }, { status: 503 });

  const { rows } = await pool.query(
    `SELECT ${SELECT_COLS} FROM workspace_branding WHERE workspace_id = $1`,
    [workspaceId]
  );
  const branding = (rows[0] as BrandingRow | undefined) ?? null;
  const preview_urls = await signedPreviewUrls(branding);
  return Response.json({ branding, preview_urls, preview_expires_in: SIGNED_URL_TTL_SECONDS });
}

type BrandingBody = {
  workspace_id?: string;
  company_name?: string | null;
  primary_color?: string | null;
  logo_primary_path?: string | null;
  logo_compact_path?: string | null;
  favicon_path?: string | null;
  email_header_html?: string | null;
  login_branding?: unknown;
  terminology?: unknown;
};

/** PUT /api/enterprise/branding — publish branding (two-step: paths come from the upload step). */
export async function PUT(request: Request) {
  const body = (await request.json().catch(() => ({}))) as BrandingBody;
  const workspaceId = typeof body.workspace_id === "string" ? body.workspace_id : "";
  const gate = await requireBrandingSecurity(workspaceId);
  if ("response" in gate) return gate.response;
  const { user } = gate;
  if (!isEnabled()) return Response.json({ error: "no_database" }, { status: 503 });
  const pool = getPool();
  if (!pool) return Response.json({ error: "no_database" }, { status: 503 });

  const ws = await pool.query(`SELECT id FROM workspaces WHERE id = $1`, [workspaceId]);
  if (!ws.rows[0]) return Response.json({ error: "workspace not_found" }, { status: 404 });

  const companyName =
    body.company_name === null || body.company_name === undefined
      ? null
      : String(body.company_name).trim().slice(0, 120) || null;

  let primaryColor: string | null = null;
  if (body.primary_color !== null && body.primary_color !== undefined && String(body.primary_color).trim() !== "") {
    if (!isHexColor(String(body.primary_color).trim())) {
      return Response.json({ error: "primary_color must be a hex color like #245c5c" }, { status: 400 });
    }
    primaryColor = String(body.primary_color).trim();
  }

  // Logo paths must be exactly what the upload step produced for this
  // workspace — a client cannot publish arbitrary storage paths.
  const logoPaths: Record<string, string | null> = {};
  const pathFields = [
    ["logo_primary_path", "primary"],
    ["logo_compact_path", "compact"],
    ["favicon_path", "favicon"],
  ] as const;
  for (const [field, kind] of pathFields) {
    const raw = body[field];
    if (raw === null || raw === undefined || raw === "") {
      logoPaths[field] = null;
      continue;
    }
    if (!isLogoKind(kind) || !isPublishableLogoPath(raw, workspaceId, kind)) {
      return Response.json(
        { error: `${field} is not a valid uploaded logo path for this workspace` },
        { status: 400 }
      );
    }
    logoPaths[field] = raw as string;
  }

  const emailHeaderHtml = sanitizeEmailHeaderHtml(body.email_header_html ?? null);

  const loginBranding = validateLoginBranding(body.login_branding ?? null);
  if (body.login_branding !== undefined && body.login_branding !== null && loginBranding === null) {
    return Response.json({ error: "login_branding must be a JSON object" }, { status: 400 });
  }
  const terminology = validateTerminology(body.terminology ?? null);
  if (terminology === null) {
    return Response.json({ error: "terminology must be an object of string labels" }, { status: 400 });
  }

  const before = await pool.query(
    `SELECT ${SELECT_COLS} FROM workspace_branding WHERE workspace_id = $1`,
    [workspaceId]
  );

  await pool.query(
    `INSERT INTO workspace_branding
       (workspace_id, company_name, primary_color, logo_primary_path, logo_compact_path,
        favicon_path, email_header_html, login_branding, terminology, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb, now())
     ON CONFLICT (workspace_id) DO UPDATE SET
       company_name = EXCLUDED.company_name,
       primary_color = EXCLUDED.primary_color,
       logo_primary_path = EXCLUDED.logo_primary_path,
       logo_compact_path = EXCLUDED.logo_compact_path,
       favicon_path = EXCLUDED.favicon_path,
       email_header_html = EXCLUDED.email_header_html,
       login_branding = EXCLUDED.login_branding,
       terminology = EXCLUDED.terminology,
       updated_at = now()`,
    [
      workspaceId,
      companyName,
      primaryColor,
      logoPaths.logo_primary_path,
      logoPaths.logo_compact_path,
      logoPaths.favicon_path,
      emailHeaderHtml,
      JSON.stringify(loginBranding ?? {}),
      JSON.stringify(terminology ?? {}),
    ]
  );

  const after = { company_name: companyName, primary_color: primaryColor, ...logoPaths, email_header_html: emailHeaderHtml, login_branding: loginBranding, terminology };
  const meta = getRequestMeta(request);
  await writeAuditEvent(pool, {
    actorUserId: user.id,
    workspaceId,
    action: "enterprise.branding.update",
    targetType: "workspace_branding",
    targetId: workspaceId,
    before: (before.rows[0] as BrandingRow | undefined) ?? null,
    after,
    ip: meta.ip,
    userAgent: meta.userAgent,
    correlationId: meta.correlationId,
    source: "api",
  });

  return Response.json({ ok: true, branding: after });
}
