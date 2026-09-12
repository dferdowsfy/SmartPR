// Enterprise team management: GET (members + enterprise assignments + invites),
// POST (invite with enterprise role + scope).
//
// Permission: manage_users on the workspace (org_owner / org_admin).
// The invite reuses the existing workspace_invites token flow
// (lib/invites.ts) and carries the enterprise role key + scope on the row so
// the accept flow can create the matching role_assignment.
import { randomUUID } from "crypto";
import { getPool, isEnabled } from "../../../../graph/db";
import {
  requireEnterprisePermission,
  writeAuditEvent,
  getRequestMeta,
} from "../../../../../lib/enterprise-permissions";
import {
  ensureSystemRoles,
  validateScope,
  legacyRoleForEnterpriseKey,
  assertContractSeatAvailable,
  assertRoleKey,
} from "../../../../../lib/enterprise/workspaceRoles";
import { gateJson } from "../../../../../lib/billing/access";
import {
  newInviteToken,
  inviteUrlForToken,
  buildInviteEmailHtml,
  sendInviteEmail,
} from "../../../../../lib/invites";
import type { WorkspaceRole } from "../../../../../lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_LEGACY: WorkspaceRole[] = ["OWNER", "ADMIN", "MEMBER", "VIEWER"];

function workspaceIdFrom(request: Request): string | null {
  const id = new URL(request.url).searchParams.get("workspace_id")?.trim();
  return id || null;
}

/** Members with legacy role, joined enterprise role assignments, pending invites. */
export async function GET(request: Request) {
  const workspaceId = workspaceIdFrom(request);
  if (!workspaceId) return Response.json({ error: "workspace_id required" }, { status: 400 });
  const gate = await requireEnterprisePermission("manage_users", workspaceId);
  if ("response" in gate) return gate.response;
  if (!isEnabled()) return Response.json({ error: "no_database" }, { status: 503 });
  const pool = getPool();
  if (!pool) return Response.json({ error: "no_database" }, { status: 503 });

  const members = await pool.query(
    `SELECT wm.user_id::text AS user_id, wm.role AS legacy_role, wm.created_at AS joined_at,
            lower(u.email) AS email,
            (u.raw_user_meta_data ->> 'full_name') AS full_name
       FROM workspace_members wm
       LEFT JOIN auth.users u ON u.id = wm.user_id
      WHERE wm.workspace_id = $1
      ORDER BY CASE wm.role WHEN 'OWNER' THEN 0 WHEN 'ADMIN' THEN 1 WHEN 'MEMBER' THEN 2 ELSE 3 END,
               lower(u.email) ASC NULLS LAST`,
    [workspaceId]
  );

  let assignments: unknown[] = [];
  try {
    const a = await pool.query(
      `SELECT ra.id::text AS id, ra.user_id::text AS user_id,
              er.key AS role_key, er.label AS role_label,
              ra.scope_type, ra.scope_id::text AS scope_id,
              COALESCE(b.name, f.name, m.title) AS scope_name
         FROM role_assignments ra
         JOIN enterprise_roles er ON er.id = ra.enterprise_role_id
         LEFT JOIN businesses b ON b.id = ra.scope_id AND ra.scope_type = 'business'
         LEFT JOIN facilities f ON f.id = ra.scope_id AND ra.scope_type = 'facility'
         LEFT JOIN matters m ON m.id = ra.scope_id AND ra.scope_type = 'project'
        WHERE ra.workspace_id = $1
        ORDER BY er.key, ra.scope_type`,
      [workspaceId]
    );
    assignments = a.rows;
  } catch {
    assignments = [];
  }

  const invites = await pool.query(
    `SELECT id::text AS id, email, role AS legacy_role, enterprise_role_key,
            enterprise_role_scope_type, enterprise_role_scope_id::text AS enterprise_role_scope_id,
            expires_at, created_at
       FROM workspace_invites
      WHERE workspace_id = $1 AND accepted_at IS NULL AND expires_at > now()
      ORDER BY created_at DESC`,
    [workspaceId]
  );

  return Response.json({
    members: members.rows,
    assignments,
    invites: invites.rows,
  });
}

type InviteBody = {
  email?: string;
  enterprise_role?: string;
  legacy_role?: string;
  scope_type?: string;
  scope_id?: string;
};

/**
 * Invite a user with an enterprise role + scope. Enforces the contract seat
 * limit (or the plan-catalog seat gate when no contract override exists)
 * BEFORE creating the invite row.
 */
export async function POST(request: Request) {
  const workspaceId = workspaceIdFrom(request);
  if (!workspaceId) return Response.json({ error: "workspace_id required" }, { status: 400 });
  const gate = await requireEnterprisePermission("manage_users", workspaceId);
  if ("response" in gate) return gate.response;
  if (!isEnabled()) return Response.json({ error: "no_database" }, { status: 503 });
  const pool = getPool();
  if (!pool) return Response.json({ error: "no_database" }, { status: 503 });
  const { user } = gate;
  const meta = getRequestMeta(request);

  const body = (await request.json().catch(() => ({}))) as InviteBody;
  const email = (body.email || "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return Response.json({ error: "valid email required" }, { status: 400 });
  }
  let enterpriseRoleKey: string;
  try {
    enterpriseRoleKey = assertRoleKey(body.enterprise_role);
  } catch {
    return Response.json({ error: "invalid enterprise_role" }, { status: 400 });
  }
  const legacyRole = (body.legacy_role || "").toUpperCase();
  const role: WorkspaceRole = (VALID_LEGACY as string[]).includes(legacyRole)
    ? (legacyRole as WorkspaceRole)
    : legacyRoleForEnterpriseKey(enterpriseRoleKey);

  let scopeType = (body.scope_type || "organization").toLowerCase();
  if (!["organization", "business", "facility", "project"].includes(scopeType)) {
    return Response.json({ error: "invalid scope_type" }, { status: 400 });
  }
  let scopeId: string | null;
  try {
    scopeId = await validateScope(pool, workspaceId, scopeType, body.scope_id || null);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }

  const ws = await pool.query(`SELECT id, name FROM workspaces WHERE id = $1`, [workspaceId]);
  if (!ws.rows[0]) return Response.json({ error: "not_found" }, { status: 404 });

  // Already a member? Don't double-invite.
  const existing = await pool.query(
    `SELECT wm.role FROM workspace_members wm
       JOIN auth.users u ON u.id = wm.user_id
      WHERE wm.workspace_id = $1 AND lower(u.email) = $2`,
    [workspaceId, email]
  );
  if (existing.rows[0]) {
    return Response.json(
      { error: "already_member", role: existing.rows[0].role },
      { status: 409 }
    );
  }

  // Seat gate: contract override wins, else the plan catalog. 402 when full.
  try {
    await assertContractSeatAvailable(pool, workspaceId, user.email);
  } catch (e) {
    const gated = gateJson(e);
    if (gated) return gated;
    throw e;
  }

  // Make sure the system roles exist (cheap, idempotent).
  await ensureSystemRoles(pool, workspaceId);

  // Refresh any outstanding invite for the same email.
  await pool.query(
    `DELETE FROM workspace_invites WHERE workspace_id = $1 AND lower(email) = $2 AND accepted_at IS NULL`,
    [workspaceId, email]
  );

  const token = newInviteToken();
  const inviteId = randomUUID();
  await pool.query(
    `INSERT INTO workspace_invites
       (id, workspace_id, email, role, invited_by, token,
        enterprise_role_key, enterprise_role_scope_type, enterprise_role_scope_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      inviteId, workspaceId, email, role, user.id, token,
      enterpriseRoleKey, scopeType, scopeId,
    ]
  );

  const inviteUrl = inviteUrlForToken(token);
  const brandRows = await pool.query(
    `SELECT company_name FROM workspace_branding WHERE workspace_id = $1`,
    [workspaceId]
  );
  const brandName = brandRows.rows[0]?.company_name?.trim() || ws.rows[0].name;
  const emailed = await sendInviteEmail(
    email,
    buildInviteEmailHtml({
      workspaceName: brandName,
      role: `${role} (${enterpriseRoleKey})`,
      inviteUrl,
      inviterEmail: user.email || "your administrator",
    })
  );

  await writeAuditEvent(pool, {
    actorUserId: user.id,
    workspaceId,
    action: "team.invite",
    targetType: "invite",
    targetId: inviteId,
    after: { email, legacy_role: role, enterprise_role: enterpriseRoleKey, scope_type: scopeType, emailed },
    ip: meta.ip,
    userAgent: meta.userAgent,
    correlationId: meta.correlationId,
    source: "ui",
  });

  return Response.json({
    invite: { id: inviteId, email, legacy_role: role, enterprise_role: enterpriseRoleKey, scope_type: scopeType, inviteUrl, emailed },
  });
}
