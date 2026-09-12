// Phase 6 — enterprise security center API.
// GET  /api/enterprise/security?workspace=<id>  — security posture (no secrets)
// PATCH /api/enterprise/security?workspace=<id> — update SSO + session/MFA/
//        provisioning policies. Changing sso_provider_id or sso_domain clears
//        sso_verified_at (re-test required). All mutations are audited.

import { getPool, isEnabled } from "../../../graph/db";
import {
  requireEnterprisePermission,
  writeAuditEvent,
  getRequestMeta,
  isRoleKey,
} from "../../../../lib/enterprise-permissions";
import {
  getSecurityPosture,
  redactSecrets,
} from "../../../../lib/enterprise-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MFA_POLICIES = ["optional", "required", "disabled"] as const;

function workspaceFrom(req: Request): string | null {
  const w = new URL(req.url).searchParams.get("workspace");
  return w && /^[0-9a-fA-F-]{36}$/.test(w) ? w : null;
}

export async function GET(req: Request) {
  const workspaceId = workspaceFrom(req);
  if (!workspaceId) return Response.json({ error: "workspace query param required" }, { status: 400 });
  const gate = await requireEnterprisePermission("configure_branding_security", workspaceId);
  if ("response" in gate) return gate.response;
  if (!isEnabled()) return Response.json({ error: "no_database" }, { status: 503 });

  const posture = await getSecurityPosture(workspaceId);
  // Defensive: posture carries status only, but redact anyway before sending.
  return Response.json({ posture: redactSecrets(posture) });
}

type PatchBody = {
  sso_enabled?: boolean;
  sso_domain?: string | null;
  sso_provider_id?: string | null;
  session_minutes?: number;
  mfa_policy?: string;
  auto_provision?: boolean;
  sso_default_role?: string;
  sso_group_mappings?: Array<{ group?: string; role?: string }>;
};

function normalizeDomain(input: string): string | null {
  let d = (input || "").trim().toLowerCase();
  if (!d) return null;
  d = d.replace(/^https?:\/\//, "").split("/")[0].split(":")[0];
  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/.test(d)) {
    return null;
  }
  return d;
}

export async function PATCH(req: Request) {
  const workspaceId = workspaceFrom(req);
  if (!workspaceId) return Response.json({ error: "workspace query param required" }, { status: 400 });
  const gate = await requireEnterprisePermission("configure_branding_security", workspaceId);
  if ("response" in gate) return gate.response;
  if (!isEnabled()) return Response.json({ error: "no_database" }, { status: 503 });
  const pool = getPool();
  if (!pool) return Response.json({ error: "no_database" }, { status: 503 });

  const body = (await req.json().catch(() => ({}))) as PatchBody;
  const updates: string[] = [];
  const params: unknown[] = [];
  const add = (col: string, val: unknown) => {
    params.push(val);
    updates.push(`${col} = $${params.length}`);
  };

  const before = await getSecurityPosture(workspaceId, pool).catch(() => null);

  // --- SSO fields -----------------------------------------------------------
  let providerOrDomainChanged = false;
  if (body.sso_enabled !== undefined) {
    if (typeof body.sso_enabled !== "boolean")
      return Response.json({ error: "sso_enabled must be a boolean" }, { status: 400 });
    add("sso_enabled", body.sso_enabled);
  }
  if (body.sso_domain !== undefined) {
    if (body.sso_domain === null) {
      add("sso_domain", null);
    } else if (typeof body.sso_domain === "string") {
      const d = normalizeDomain(body.sso_domain);
      if (body.sso_domain.trim() && !d)
        return Response.json({ error: "sso_domain is not a valid domain" }, { status: 400 });
      add("sso_domain", d);
    } else {
      return Response.json({ error: "sso_domain must be a string or null" }, { status: 400 });
    }
    if (before && (body.sso_domain ?? null) !== before.sso.domain) providerOrDomainChanged = true;
  }
  if (body.sso_provider_id !== undefined) {
    if (body.sso_provider_id !== null && typeof body.sso_provider_id !== "string")
      return Response.json({ error: "sso_provider_id must be a string or null" }, { status: 400 });
    const pid = (body.sso_provider_id || "").trim() || null;
    if (pid && !/^[0-9a-fA-F-]{36}$/.test(pid))
      return Response.json({ error: "sso_provider_id must be a UUID" }, { status: 400 });
    add("sso_provider_id", pid);
    if (before && pid !== before.sso.provider_id) providerOrDomainChanged = true;
  }

  // --- policies -------------------------------------------------------------
  if (body.session_minutes !== undefined) {
    const m = Number(body.session_minutes);
    if (!Number.isInteger(m) || m < 5 || m > 1440)
      return Response.json({ error: "session_minutes must be an integer 5..1440" }, { status: 400 });
    add("session_minutes", m);
  }
  if (body.mfa_policy !== undefined) {
    if (!(MFA_POLICIES as readonly string[]).includes(body.mfa_policy))
      return Response.json({ error: `mfa_policy must be one of ${MFA_POLICIES.join(", ")}` }, { status: 400 });
    add("mfa_policy", body.mfa_policy);
  }
  if (body.auto_provision !== undefined) {
    if (typeof body.auto_provision !== "boolean")
      return Response.json({ error: "auto_provision must be a boolean" }, { status: 400 });
    add("auto_provision", body.auto_provision);
  }
  if (body.sso_default_role !== undefined) {
    if (!isRoleKey(body.sso_default_role))
      return Response.json({ error: "sso_default_role is not a known enterprise role" }, { status: 400 });
    add("sso_default_role", body.sso_default_role);
  }
  if (body.sso_group_mappings !== undefined) {
    if (!Array.isArray(body.sso_group_mappings))
      return Response.json({ error: "sso_group_mappings must be an array" }, { status: 400 });
    const mappings: Array<{ group: string; role: string }> = [];
    for (const m of body.sso_group_mappings) {
      const group = String(m?.group ?? "").trim();
      const role = String(m?.role ?? "").trim();
      if (!group || !isRoleKey(role))
        return Response.json({ error: "each group mapping needs {group, role} with a known role" }, { status: 400 });
      mappings.push({ group, role });
    }
    add("sso_group_mappings", JSON.stringify(mappings));
  }

  if (updates.length === 0)
    return Response.json({ error: "no updatable fields provided" }, { status: 400 });

  // Changing the IdP connection invalidates prior verification.
  if (providerOrDomainChanged) {
    updates.push("sso_verified_at = NULL");
  }

  await pool.query(
    `INSERT INTO workspace_branding (workspace_id, updated_at) VALUES ($1, now())
     ON CONFLICT (workspace_id) DO UPDATE SET ${updates.join(", ")}, updated_at = now()`,
    [workspaceId, ...params]
  );

  const after = await getSecurityPosture(workspaceId, pool).catch(() => null);
  const meta = getRequestMeta(req);
  await writeAuditEvent(pool, {
    actorUserId: gate.user.id,
    workspaceId,
    action: "security.config_updated",
    targetType: "workspace_branding",
    targetId: workspaceId,
    before: before ? redactSecrets(before) : null,
    after: after ? redactSecrets(after) : null,
    ip: meta.ip,
    userAgent: meta.userAgent,
    correlationId: meta.correlationId,
    source: "api",
    reason: providerOrDomainChanged ? "idp connection changed; verification reset" : null,
  });

  return Response.json({
    ok: true,
    verification_reset: providerOrDomainChanged,
    posture: after ? redactSecrets(after) : null,
  });
}
