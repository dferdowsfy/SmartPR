// Phase 6 — SSO connection test.
// POST /api/enterprise/security/test-sso?workspace=<id>
//
// Runs REAL verification and records it; never claims "verified" unless every
// check passes. Checks:
//   1. SSO is enabled and a provider id is configured.
//   2. The provider row exists in Supabase Auth (auth.sso_providers) via the
//      app's privileged database connection. There is NO service-role-key
//      precedent in this codebase (server-side auth uses the pg pool), so the
//      Admin REST API check is reported as skipped unless
//      SUPABASE_SERVICE_ROLE_KEY is explicitly set.
//   3. DNS: the sso_domain resolves (MX or A record).
//
// On success sets workspace_branding.sso_verified_at. On failure clears it
// and, if enforcement was enabled, disables enforcement (audited) — an
// unverified IdP must not silently lock users out.

import { resolveMx, resolve4 } from "node:dns/promises";
import { getPool, isEnabled } from "../../../../graph/db";
import {
  requireEnterprisePermission,
  writeAuditEvent,
  getRequestMeta,
} from "../../../../../lib/enterprise-permissions";
import { redactSecrets } from "../../../../../lib/enterprise-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DNS_TIMEOUT_MS = 8000;

interface CheckResult {
  check: string;
  passed: boolean;
  detail: string;
}

async function dnsResolves(domain: string): Promise<{ ok: boolean; detail: string }> {
  const attempt = async () => {
    try {
      const mx = await resolveMx(domain);
      if (mx.length > 0) return { ok: true, detail: `MX records resolve (${mx.length} found)` };
    } catch {
      /* try A records */
    }
    try {
      const a = await resolve4(domain);
      if (a.length > 0) return { ok: true, detail: `A records resolve (${a.length} found)` };
    } catch {
      /* no luck */
    }
    return { ok: false, detail: "no MX or A records found" };
  };
  try {
    return await Promise.race([
      attempt(),
      new Promise<{ ok: boolean; detail: string }>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), DNS_TIMEOUT_MS)
      ),
    ]);
  } catch {
    return { ok: false, detail: "DNS lookup timed out or failed" };
  }
}

export async function POST(req: Request) {
  const workspaceId = new URL(req.url).searchParams.get("workspace");
  if (!workspaceId || !/^[0-9a-fA-F-]{36}$/.test(workspaceId))
    return Response.json({ error: "workspace query param required" }, { status: 400 });
  const gate = await requireEnterprisePermission("configure_branding_security", workspaceId);
  if ("response" in gate) return gate.response;
  if (!isEnabled()) return Response.json({ error: "no_database" }, { status: 503 });
  const pool = getPool();
  if (!pool) return Response.json({ error: "no_database" }, { status: 503 });

  const { rows } = await pool.query(
    `SELECT sso_enabled, sso_domain, sso_provider_id, sso_enforcement
       FROM workspace_branding WHERE workspace_id = $1`,
    [workspaceId]
  );
  const branding = rows[0] as
    | { sso_enabled: boolean; sso_domain: string | null; sso_provider_id: string | null; sso_enforcement: string }
    | undefined;

  const checks: CheckResult[] = [];
  const nowIso = new Date().toISOString();

  // --- Check 1: config present ------------------------------------------------
  const enabled = branding?.sso_enabled === true;
  const domain = branding?.sso_domain ?? null;
  const providerId = branding?.sso_provider_id ?? null;
  checks.push({
    check: "config_present",
    passed: enabled && !!providerId && !!domain,
    detail: !enabled
      ? "SSO is not enabled for this workspace"
      : !domain
        ? "sso_domain is not set"
        : !providerId
          ? "sso_provider_id is not set"
          : `SSO enabled for ${domain}`,
  });

  // --- Check 2: provider exists in Supabase Auth ------------------------------
  let providerFound = false;
  if (providerId && /^[0-9a-fA-F-]{36}$/.test(providerId)) {
    try {
      const prov = await pool.query(
        `SELECT id FROM auth.sso_providers WHERE id = $1::uuid LIMIT 1`,
        [providerId]
      );
      providerFound = prov.rows.length > 0;
      checks.push({
        check: "provider_in_auth",
        passed: providerFound,
        detail: providerFound
          ? "SSO provider found in Supabase Auth (verified via the app's privileged database connection)"
          : "no SSO provider with this id exists in Supabase Auth — create it in the Supabase dashboard (Authentication > Sign In / SSO) and paste its provider id",
      });
    } catch (e) {
      checks.push({
        check: "provider_in_auth",
        passed: false,
        detail: `could not read auth.sso_providers: ${(e as Error).message.slice(0, 160)}`,
      });
    }
  } else if (providerId) {
    checks.push({
      check: "provider_in_auth",
      passed: false,
      detail: "sso_provider_id is not a UUID; Supabase SSO provider ids are UUIDs",
    });
  } else {
    checks.push({ check: "provider_in_auth", passed: false, detail: "no provider id configured" });
  }

  // --- Check 2b: Admin API — honest skip (no key precedent in this repo) -------
  const hasServiceRoleKey = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
  checks.push({
    check: "provider_admin_api",
    passed: providerFound, // only informational; does not gate success
    detail: hasServiceRoleKey
      ? "SUPABASE_SERVICE_ROLE_KEY is set, but this codebase has no Admin-API client precedent; provider existence was verified via auth.sso_providers instead"
      : "skipped: no SUPABASE_SERVICE_ROLE_KEY in this codebase (server-side auth uses the pg pool); provider existence was verified via auth.sso_providers instead",
  });

  // --- Check 3: DNS -----------------------------------------------------------
  if (domain) {
    const dns = await dnsResolves(domain);
    checks.push({ check: "domain_dns", passed: dns.ok, detail: dns.detail });
  } else {
    checks.push({ check: "domain_dns", passed: false, detail: "no domain configured" });
  }

  const gateChecks = checks.filter((c) => c.check !== "provider_admin_api");
  const success = gateChecks.every((c) => c.passed);

  const testRecord = {
    success,
    checked_at: nowIso,
    details: {
      checks: redactSecrets(checks),
      note: success
        ? "All checks passed. This confirms the provider exists and the domain resolves; it does NOT complete a live SAML round-trip, which requires the customer's IdP."
        : "Verification failed. sso_verified_at was cleared; fix the failing checks and re-run.",
    },
  };

  if (success) {
    await pool.query(
      `UPDATE workspace_branding
          SET sso_verified_at = now(),
              login_branding = jsonb_set(COALESCE(login_branding, '{}'::jsonb), '{sso_test}', $2::jsonb, true),
              updated_at = now()
        WHERE workspace_id = $1`,
      [workspaceId, JSON.stringify(testRecord)]
    );
  } else {
    // Clear stale verification; if enforcement was on, turn it OFF (audited)
    // rather than locking users out behind a broken IdP connection.
    const enforcementWasOn = branding?.sso_enforcement === "enabled";
    await pool.query(
      `UPDATE workspace_branding
          SET sso_verified_at = NULL,
              sso_enforcement = CASE WHEN sso_enforcement = 'enabled' THEN 'disabled' ELSE sso_enforcement END,
              login_branding = jsonb_set(COALESCE(login_branding, '{}'::jsonb), '{sso_test}', $2::jsonb, true),
              updated_at = now()
        WHERE workspace_id = $1`,
      [workspaceId, JSON.stringify(testRecord)]
    );
    if (enforcementWasOn) {
      const meta = getRequestMeta(req);
      await writeAuditEvent(pool, {
        actorUserId: gate.user.id,
        workspaceId,
        action: "security.sso_enforcement_auto_disabled",
        targetType: "workspace_branding",
        targetId: workspaceId,
        after: { enforcement: "disabled" },
        ip: meta.ip,
        userAgent: meta.userAgent,
        correlationId: meta.correlationId,
        source: "api",
        reason: "SSO connection test failed; enforcement disabled to avoid lockout",
      });
    }
  }

  const meta = getRequestMeta(req);
  await writeAuditEvent(pool, {
    actorUserId: gate.user.id,
    workspaceId,
    action: success ? "security.sso_test_passed" : "security.sso_test_failed",
    targetType: "workspace_branding",
    targetId: workspaceId,
    after: redactSecrets(testRecord),
    ip: meta.ip,
    userAgent: meta.userAgent,
    correlationId: meta.correlationId,
    source: "api",
  });

  return Response.json({ success, checked_at: nowIso, checks: redactSecrets(checks) });
}
