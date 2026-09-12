// Phase 6 — SSO enforcement toggle.
// POST /api/enterprise/security/enforcement?workspace=<id>  { enforce: boolean }
//
// SECURITY GATE: enforce=true is REJECTED unless sso_verified_at exists and
// is within the last 30 days. This is the hard boundary — enforcement can
// never be switched on behind an untested or stale IdP connection.
//
// Emergency recovery: a superadmin can always disable enforcement via the
// existing superadmin branding API (PUT /api/admin/workspaces/[id]/branding
// with sso_enforcement). That path is requireSuperAdmin-gated and audited —
// a documented recovery hatch, not a backdoor.

import { getPool, isEnabled } from "../../../../graph/db";
import {
  requireEnterprisePermission,
  writeAuditEvent,
  getRequestMeta,
} from "../../../../../lib/enterprise-permissions";
import {
  canEnableEnforcement,
  getSecurityPosture,
  redactSecrets,
} from "../../../../../lib/enterprise-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const workspaceId = new URL(req.url).searchParams.get("workspace");
  if (!workspaceId || !/^[0-9a-fA-F-]{36}$/.test(workspaceId))
    return Response.json({ error: "workspace query param required" }, { status: 400 });
  const gate = await requireEnterprisePermission("configure_branding_security", workspaceId);
  if ("response" in gate) return gate.response;
  if (!isEnabled()) return Response.json({ error: "no_database" }, { status: 503 });
  const pool = getPool();
  if (!pool) return Response.json({ error: "no_database" }, { status: 503 });

  const body = (await req.json().catch(() => ({}))) as { enforce?: unknown };
  if (typeof body.enforce !== "boolean")
    return Response.json({ error: "body.enforce must be a boolean" }, { status: 400 });

  const before = await getSecurityPosture(workspaceId, pool).catch(() => null);

  if (body.enforce === true) {
    // THE GATE: a fresh successful test is required.
    const { rows } = await pool.query(
      `SELECT sso_verified_at FROM workspace_branding WHERE workspace_id = $1`,
      [workspaceId]
    );
    const verifiedAt =
      rows[0]?.sso_verified_at instanceof Date
        ? (rows[0].sso_verified_at as Date).toISOString()
        : typeof rows[0]?.sso_verified_at === "string"
          ? (rows[0].sso_verified_at as string)
          : null;
    if (!canEnableEnforcement(verifiedAt)) {
      return Response.json(
        {
          error: "sso_verification_required",
          detail:
            "SSO enforcement requires a successful connection test within the last 30 days. " +
            "Run POST /api/enterprise/security/test-sso first.",
          verified_at: verifiedAt,
        },
        { status: 409 }
      );
    }
  }

  await pool.query(
    `INSERT INTO workspace_branding (workspace_id, sso_enforcement, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (workspace_id) DO UPDATE SET sso_enforcement = $2, updated_at = now()`,
    [workspaceId, body.enforce ? "enabled" : "disabled"]
  );

  const after = await getSecurityPosture(workspaceId, pool).catch(() => null);
  const meta = getRequestMeta(req);
  await writeAuditEvent(pool, {
    actorUserId: gate.user.id,
    workspaceId,
    action: body.enforce ? "security.sso_enforcement_enabled" : "security.sso_enforcement_disabled",
    targetType: "workspace_branding",
    targetId: workspaceId,
    before: before ? redactSecrets(before.sso) : null,
    after: after ? redactSecrets(after.sso) : null,
    ip: meta.ip,
    userAgent: meta.userAgent,
    correlationId: meta.correlationId,
    source: "api",
  });

  return Response.json({
    ok: true,
    enforcement: body.enforce ? "enabled" : "disabled",
    posture: after ? redactSecrets(after) : null,
  });
}
