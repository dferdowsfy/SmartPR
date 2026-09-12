// Enterprise team member management: DELETE (remove), PATCH (change legacy
// role and/or enterprise role assignments).
//
// Permission: manage_users on the workspace.
// Last-org_owner protection: an org_owner (legacy OWNER counts via mapping)
// cannot be removed or demoted while they are the last one.
import { getPool, isEnabled } from "../../../../../graph/db";
import {
  requireEnterprisePermission,
  writeAuditEvent,
  getRequestMeta,
  LEGACY_ROLE_MAP,
} from "../../../../../../lib/enterprise-permissions";
import {
  ensureSystemRoles,
  validateScope,
  assertRoleKey,
} from "../../../../../../lib/enterprise/workspaceRoles";
import type { WorkspaceRole } from "../../../../../../lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_LEGACY: WorkspaceRole[] = ["OWNER", "ADMIN", "MEMBER", "VIEWER"];

function workspaceIdFrom(request: Request): string | null {
  const id = new URL(request.url).searchParams.get("workspace_id")?.trim();
  return id || null;
}

/** True when the user is the ONLY remaining org_owner (legacy OWNER or enterprise org_owner). */
async function isLastOrgOwner(
  pool: NonNullable<ReturnType<typeof getPool>>,
  workspaceId: string,
  targetUserId: string
): Promise<boolean> {
  const legacy = await pool.query(
    `SELECT COUNT(*)::int AS n FROM workspace_members
      WHERE workspace_id = $1 AND role = 'OWNER' AND user_id <> $2`,
    [workspaceId, targetUserId]
  );
  if (Number(legacy.rows[0]?.n || 0) > 0) return false;
  try {
    const ent = await pool.query(
      `SELECT COUNT(DISTINCT ra.user_id)::int AS n
         FROM role_assignments ra
         JOIN enterprise_roles er ON er.id = ra.enterprise_role_id
        WHERE ra.workspace_id = $1 AND er.key = 'org_owner' AND ra.user_id <> $2`,
      [workspaceId, targetUserId]
    );
    if (Number(ent.rows[0]?.n || 0) > 0) return false;
  } catch {
    // enterprise tables missing: legacy count decides.
  }
  return true;
}

/** True when the user holds the given enterprise role key (any scope). */
async function userHasEnterpriseRole(
  pool: NonNullable<ReturnType<typeof getPool>>,
  workspaceId: string,
  targetUserId: string,
  roleKey: string
): Promise<boolean> {
  try {
    const { rows } = await pool.query(
      `SELECT 1 FROM role_assignments ra
         JOIN enterprise_roles er ON er.id = ra.enterprise_role_id
        WHERE ra.workspace_id = $1 AND ra.user_id = $2 AND er.key = $3
        LIMIT 1`,
      [workspaceId, targetUserId, roleKey]
    );
    return rows.length > 0;
  } catch {
    return false;
  }
}

/** Remove a member (and their enterprise role assignments). */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const workspaceId = workspaceIdFrom(request);
  if (!workspaceId) return Response.json({ error: "workspace_id required" }, { status: 400 });
  const gate = await requireEnterprisePermission("manage_users", workspaceId);
  if ("response" in gate) return gate.response;
  if (!isEnabled()) return Response.json({ error: "no_database" }, { status: 503 });
  const pool = getPool();
  if (!pool) return Response.json({ error: "no_database" }, { status: 503 });
  const { user } = gate;
  const { userId } = await params;
  const meta = getRequestMeta(request);

  const cur = await pool.query(
    `SELECT wm.role AS legacy_role, lower(u.email) AS email
       FROM workspace_members wm
       LEFT JOIN auth.users u ON u.id = wm.user_id
      WHERE wm.workspace_id = $1 AND wm.user_id = $2`,
    [workspaceId, userId]
  );
  if (!cur.rows[0]) return Response.json({ error: "not a member" }, { status: 404 });
  const isOwnerish =
    cur.rows[0].legacy_role === "OWNER" ||
    LEGACY_ROLE_MAP[cur.rows[0].legacy_role as WorkspaceRole] === "org_owner";
  if (isOwnerish && (await isLastOrgOwner(pool, workspaceId, userId))) {
    return Response.json(
      { error: "cannot remove the last organization owner" },
      { status: 409 }
    );
  }
  if (userId === user.id) {
    return Response.json({ error: "you cannot remove yourself" }, { status: 409 });
  }

  await pool.query(`DELETE FROM role_assignments WHERE workspace_id = $1 AND user_id = $2`, [
    workspaceId, userId,
  ]).catch(() => {});
  await pool.query(
    `DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`,
    [workspaceId, userId]
  );

  await writeAuditEvent(pool, {
    actorUserId: user.id,
    workspaceId,
    action: "team.member_removed",
    targetType: "user",
    targetId: userId,
    before: { email: cur.rows[0].email, legacy_role: cur.rows[0].legacy_role },
    ip: meta.ip,
    userAgent: meta.userAgent,
    correlationId: meta.correlationId,
    source: "ui",
  });

  return Response.json({ ok: true });
}

type PatchBody = {
  legacy_role?: string;
  /** Full replacement set of enterprise role assignments for this user. */
  assignments?: Array<{ role_key?: string; scope_type?: string; scope_id?: string | null }>;
};

/** Change legacy role and/or replace the user's enterprise role assignments. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const workspaceId = workspaceIdFrom(request);
  if (!workspaceId) return Response.json({ error: "workspace_id required" }, { status: 400 });
  const gate = await requireEnterprisePermission("manage_users", workspaceId);
  if ("response" in gate) return gate.response;
  if (!isEnabled()) return Response.json({ error: "no_database" }, { status: 503 });
  const pool = getPool();
  if (!pool) return Response.json({ error: "no_database" }, { status: 503 });
  const { user } = gate;
  const { userId } = await params;
  const meta = getRequestMeta(request);

  const body = (await request.json().catch(() => ({}))) as PatchBody;

  const cur = await pool.query(
    `SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`,
    [workspaceId, userId]
  );
  if (!cur.rows[0]) return Response.json({ error: "not a member" }, { status: 404 });
  const beforeRole: WorkspaceRole = cur.rows[0].role;

  let newLegacy: WorkspaceRole | null = null;
  if (body.legacy_role !== undefined) {
    const r = String(body.legacy_role).toUpperCase();
    if (!(VALID_LEGACY as string[]).includes(r)) {
      return Response.json({ error: "invalid legacy_role" }, { status: 400 });
    }
    newLegacy = r as WorkspaceRole;
    if (newLegacy !== beforeRole && beforeRole === "OWNER" && (await isLastOrgOwner(pool, workspaceId, userId))) {
      return Response.json(
        { error: "cannot demote the last organization owner" },
        { status: 409 }
      );
    }
  }

  let newAssignments: Array<{ role_key: string; scope_type: string; scope_id: string | null }> | null = null;
  if (body.assignments !== undefined) {
    if (!Array.isArray(body.assignments)) {
      return Response.json({ error: "assignments must be an array" }, { status: 400 });
    }
    newAssignments = [];
    for (const a of body.assignments) {
      let roleKey: string;
      try {
        roleKey = assertRoleKey(a.role_key);
      } catch {
        return Response.json({ error: "invalid role_key in assignments" }, { status: 400 });
      }
      const scopeType = (a.scope_type || "organization").toLowerCase();
      if (!["organization", "business", "facility", "project"].includes(scopeType)) {
        return Response.json({ error: "invalid scope_type in assignments" }, { status: 400 });
      }
      let scopeId: string | null;
      try {
        scopeId = await validateScope(pool, workspaceId, scopeType, a.scope_id ?? null);
      } catch (e) {
        return Response.json({ error: (e as Error).message }, { status: 400 });
      }
      newAssignments.push({ role_key: roleKey, scope_type: scopeType, scope_id: scopeId });
    }
    // Last-owner protection for full assignment replacement: if this user is
    // the last org_owner and the replacement drops org_owner, block it.
    const droppingOwner =
      (beforeRole === "OWNER" || (await userHasEnterpriseRole(pool, workspaceId, userId, "org_owner"))) &&
      !newAssignments.some((a) => a.role_key === "org_owner") &&
      !(newLegacy === "OWNER");
    if (droppingOwner && (await isLastOrgOwner(pool, workspaceId, userId))) {
      return Response.json(
        { error: "cannot remove the last organization owner" },
        { status: 409 }
      );
    }
  }

  if (newLegacy && newLegacy !== beforeRole) {
    await pool.query(
      `UPDATE workspace_members SET role = $3 WHERE workspace_id = $1 AND user_id = $2`,
      [workspaceId, userId, newLegacy]
    );
  }

  if (newAssignments) {
    const roleIds = await ensureSystemRoles(pool, workspaceId);
    await pool.query(
      `DELETE FROM role_assignments WHERE workspace_id = $1 AND user_id = $2`,
      [workspaceId, userId]
    );
    for (const a of newAssignments) {
      const roleId = roleIds.get(a.role_key);
      if (!roleId) continue;
      await pool.query(
        `INSERT INTO role_assignments (user_id, workspace_id, enterprise_role_id, scope_type, scope_id)
         VALUES ($1,$2,$3,$4,$5)`,
        [userId, workspaceId, roleId, a.scope_type, a.scope_id]
      );
    }
  }

  await writeAuditEvent(pool, {
    actorUserId: user.id,
    workspaceId,
    action: "team.member_updated",
    targetType: "user",
    targetId: userId,
    before: { legacy_role: beforeRole },
    after: {
      legacy_role: newLegacy ?? beforeRole,
      assignments: newAssignments ?? undefined,
    },
    ip: meta.ip,
    userAgent: meta.userAgent,
    correlationId: meta.correlationId,
    source: "ui",
  });

  return Response.json({ ok: true, legacy_role: newLegacy ?? beforeRole });
}
