// Superadmin company overview: status, plan + contract entitlements, contacts,
// counts, storage, readiness, overdue obligations, SSO/domain posture,
// recent activity, last login, support-access status.
//
// Gate: requireSuperAdmin. Read-only (no audit write on read).
import { getPool, isEnabled } from "../../../../../graph/db";
import { requireSuperAdmin } from "../../../_util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fmtBytes(n: number): string {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSuperAdmin();
  if ("response" in gate) return gate.response;
  if (!isEnabled()) return Response.json({ error: "no_database" }, { status: 503 });
  const pool = getPool();
  if (!pool) return Response.json({ error: "no_database" }, { status: 503 });
  const { id: workspaceId } = await params;

  const ws = await pool.query(
    `SELECT id::text AS id, name, created_at FROM workspaces WHERE id = $1`,
    [workspaceId]
  );
  if (!ws.rows[0]) return Response.json({ error: "not_found" }, { status: 404 });

  const sub = await pool.query(
    `SELECT plan::text AS plan, status, current_period_end, owner_email, entitlements
       FROM workspace_subscriptions WHERE workspace_id = $1`,
    [workspaceId]
  );
  const subscription = sub.rows[0] ?? null;
  const entitlements =
    subscription?.entitlements && typeof subscription.entitlements === "object"
      ? subscription.entitlements
      : {};

  const counts = await pool.query(
    `SELECT
       (SELECT COUNT(*)::int FROM workspace_members WHERE workspace_id = $1) AS users,
       (SELECT COUNT(*)::int FROM businesses WHERE workspace_id = $1 AND archived = false) AS businesses,
       (SELECT COUNT(*)::int FROM facilities WHERE workspace_id = $1) AS facilities,
       (SELECT COUNT(*)::int FROM matters WHERE workspace_id = $1 AND status NOT IN ('COMPLETED','ARCHIVED')) AS active_projects,
       (SELECT COUNT(*)::int FROM matters WHERE workspace_id = $1) AS projects_total`,
    [workspaceId]
  );

  const storage = await pool.query(
    `SELECT COALESCE(SUM(e.size_bytes),0)::bigint AS bytes,
            COUNT(*)::int AS files
       FROM evidence e
       JOIN businesses b ON b.id = e.business_id
      WHERE b.workspace_id = $1`,
    [workspaceId]
  );

  const readiness = await pool.query(
    `SELECT AVG(readiness_score)::numeric AS avg_score, COUNT(*)::int AS n
       FROM matters
      WHERE workspace_id = $1 AND status NOT IN ('COMPLETED','ARCHIVED')
        AND readiness_score IS NOT NULL`,
    [workspaceId]
  );

  const overdue = await pool.query(
    `SELECT COUNT(*)::int AS n
       FROM obligations o
       JOIN businesses b ON b.id = o.business_id
      WHERE b.workspace_id = $1 AND o.status = 'OVERDUE'`,
    [workspaceId]
  );

  const branding = await pool.query(
    `SELECT company_name, sso_enabled, sso_domain, sso_provider_id,
            sso_verified_at, sso_last_successful_login, sso_enforcement,
            custom_domain
       FROM workspace_branding WHERE workspace_id = $1`,
    [workspaceId]
  );

  const domain = await pool.query(
    `SELECT domain, status, tls_status, last_attempt_at, last_error
       FROM domain_verifications WHERE workspace_id = $1
       ORDER BY updated_at DESC LIMIT 1`,
    [workspaceId]
  );

  const grants = await pool.query(
    `SELECT id::text AS id, granted_to_email, reason, scope,
            expires_at, revoked_at, created_at
       FROM support_access_grants
      WHERE workspace_id = $1
      ORDER BY created_at DESC LIMIT 5`,
    [workspaceId]
  );
  const now = new Date();
  const activeGrants = grants.rows.filter(
    (g) => !g.revoked_at && new Date(g.expires_at) > now
  );

  let lastLogin: string | null = null;
  try {
    const ll = await pool.query(
      `SELECT MAX(u.last_sign_in_at)::text AS last_login
         FROM auth.users u
         JOIN workspace_members wm ON wm.user_id = u.id
        WHERE wm.workspace_id = $1`,
      [workspaceId]
    );
    lastLogin = ll.rows[0]?.last_login ?? null;
  } catch {
    lastLogin = null;
  }

  let recentActivity: unknown[] = [];
  try {
    const ra = await pool.query(
      `SELECT e.id, e.created_at, e.action, e.target_type, e.target_id,
              e.source, e.reason, lower(u.email) AS actor_email
         FROM audit_events e
         LEFT JOIN auth.users u ON u.id = e.actor_user_id
        WHERE e.workspace_id = $1
        ORDER BY e.created_at DESC, e.id DESC
        LIMIT 10`,
      [workspaceId]
    );
    recentActivity = ra.rows;
  } catch {
    recentActivity = [];
  }

  const c = counts.rows[0];
  return Response.json({
    workspace: ws.rows[0],
    subscription: subscription
      ? {
          plan: subscription.plan,
          status: subscription.status,
          current_period_end: subscription.current_period_end,
          owner_email: subscription.owner_email,
        }
      : null,
    entitlements,
    contract: {
      start: (entitlements as Record<string, unknown>).contract_start ?? null,
      renewal: (entitlements as Record<string, unknown>).contract_renewal ?? null,
      billing_contact: (entitlements as Record<string, unknown>).billing_contact ?? null,
      smartpr_owner: (entitlements as Record<string, unknown>).smartpr_owner ?? null,
    },
    counts: {
      users: c.users,
      businesses: c.businesses,
      facilities: c.facilities,
      active_projects: c.active_projects,
      projects_total: c.projects_total,
    },
    storage: {
      bytes: Number(storage.rows[0]?.bytes || 0),
      display: fmtBytes(Number(storage.rows[0]?.bytes || 0)),
      files: storage.rows[0]?.files || 0,
    },
    readiness: {
      avg_score:
        readiness.rows[0]?.avg_score != null
          ? Number(readiness.rows[0].avg_score)
          : null,
      scored_projects: readiness.rows[0]?.n || 0,
    },
    overdue_obligations: overdue.rows[0]?.n || 0,
    sso: branding.rows[0]
      ? {
          enabled: branding.rows[0].sso_enabled,
          domain: branding.rows[0].sso_domain,
          provider_id: branding.rows[0].sso_provider_id,
          verified_at: branding.rows[0].sso_verified_at,
          last_successful_login: branding.rows[0].sso_last_successful_login,
          enforcement: branding.rows[0].sso_enforcement,
        }
      : null,
    domain: {
      custom_domain: branding.rows[0]?.custom_domain ?? null,
      verification: domain.rows[0] ?? null,
    },
    support_access: {
      active: activeGrants.map((g) => ({
        id: g.id,
        granted_to_email: g.granted_to_email,
        reason: g.reason,
        scope: g.scope,
        expires_at: g.expires_at,
      })),
      recent: grants.rows.slice(0, 5),
    },
    last_login: lastLogin,
    recent_activity: recentActivity,
  });
}
