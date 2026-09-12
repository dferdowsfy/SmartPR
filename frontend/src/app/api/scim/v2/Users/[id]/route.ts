// Phase 6 — SCIM 2.0 single User.
// GET    /api/scim/v2/Users/[id]
// PATCH  /api/scim/v2/Users/[id]  (SCIM patch ops: replace active / groups)
// PUT    /api/scim/v2/Users/[id]  (full replace of active/groups/entitlements)
// DELETE /api/scim/v2/Users/[id]  (deactivate: remove memberships + invites;
//                                  NEVER deletes the auth user)

import { getPool, isEnabled } from "../../../../../graph/db";
import {
  scimAuth,
  scimError,
  listScimUsers,
  findScimUser,
  userResource,
  getGroupMappings,
  deactivateScimUser,
  setEnterpriseRole,
  roleFromScimBody,
  validateEmail,
  type ScimUserRow,
} from "../../../_util";
import { enterpriseRoleToLegacy, type Queryable } from "../../../../../../lib/enterprise-security";
import {
  writeAuditEvent,
  getRequestMeta,
} from "../../../../../../lib/enterprise-permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function load(
  pool: Queryable,
  workspaceId: string,
  id: string
): Promise<ScimUserRow | null> {
  const decoded = decodeURIComponent(id);
  const users = await listScimUsers(pool, workspaceId);
  return findScimUser(users, decoded) ?? null;
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isEnabled()) return scimError(503, "database unavailable");
  const pool = getPool();
  if (!pool) return scimError(503, "database unavailable");
  const auth = await scimAuth(req, pool);
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const user = await load(pool, auth.account.workspace_id, id);
  if (!user) return scimError(404, "user not found");
  const { mappings, defaultRole } = await getGroupMappings(pool, auth.account.workspace_id);
  return Response.json(userResource(user, mappings, defaultRole, req.url.replace(/\/[^/]+$/, "")));
}

interface PatchOp {
  op: string;
  path?: string;
  value?: unknown;
}

/** Apply SCIM patch ops; returns { active?, role? } changes to apply. */
function parsePatchOps(body: Record<string, unknown>) {
  const ops = Array.isArray(body.Operations) ? (body.Operations as PatchOp[]) : [];
  let active: boolean | undefined;
  let groupsValue: unknown;
  let entitlementsValue: unknown;
  for (const op of ops) {
    if (typeof op !== "object" || !op) continue;
    const opName = String(op.op || "").toLowerCase();
    if (opName !== "replace" && opName !== "add") continue;
    const path = String(op.path || "").toLowerCase();
    if (path === "active") {
      if (typeof op.value === "boolean") active = op.value;
    } else if (path === "groups" || path === "entitlements" || path === "") {
      const v = op.value as Record<string, unknown> | undefined;
      if (v && Array.isArray(v.groups)) groupsValue = v.groups;
      else if (path === "groups") groupsValue = op.value;
      if (v && Array.isArray(v.entitlements)) entitlementsValue = v.entitlements;
      else if (path === "entitlements") entitlementsValue = op.value;
    }
  }
  return { active, groupsValue, entitlementsValue };
}

async function applyChanges(
  req: Request,
  pool: Queryable,
  workspaceId: string,
  user: ScimUserRow,
  changes: { active?: boolean; groupsValue?: unknown; entitlementsValue?: unknown },
  authName: string
): Promise<Response> {
  const { mappings, defaultRole } = await getGroupMappings(pool, workspaceId);

  // Deactivation (active=false) — but never for the last org owner guard? Keep
  // it simple and honest: SCIM-driven deprovisioning removes access.
  if (changes.active === false) {
    await deactivateScimUser(pool, workspaceId, user);
    const meta = getRequestMeta(req);
    await writeAuditEvent(pool, {
      actorUserId: null,
      workspaceId,
      action: "security.scim_user_deactivated",
      targetType: "workspace_member",
      targetId: user.id,
      after: { email: user.email, active: false },
      ip: meta.ip,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
      source: "api",
      reason: `SCIM deprovision by service account ${authName}`,
    });
    return Response.json({ schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"], id: user.id, active: false });
  }

  const role =
    changes.groupsValue !== undefined || changes.entitlementsValue !== undefined
      ? roleFromScimBody(
          { groups: changes.groupsValue, entitlements: changes.entitlementsValue },
          mappings,
          defaultRole
        )
      : null;

  if (role && role !== user.role) {
    if (user.kind === "user") {
      await pool.query(
        `UPDATE workspace_members SET role = $3 WHERE workspace_id = $1 AND user_id = $2`,
        [workspaceId, user.id, enterpriseRoleToLegacy(role)]
      );
      // Replace the enterprise role assignment so SCIM role changes take
      // effect in the permission layer, not just the legacy role column.
      await setEnterpriseRole(pool, user.id, workspaceId, role);
    } else if (user.kind === "invite") {
      const inviteId = user.id.replace(/^invite:/, "");
      await pool.query(
        `UPDATE workspace_invites SET role = $3 WHERE id = $1 AND workspace_id = $2`,
        [inviteId, workspaceId, enterpriseRoleToLegacy(role)]
      );
    }
    const meta = getRequestMeta(req);
    await writeAuditEvent(pool, {
      actorUserId: null,
      workspaceId,
      action: "security.scim_user_role_changed",
      targetType: "workspace_member",
      targetId: user.id,
      before: { email: user.email, role: user.role ?? null },
      after: { email: user.email, role },
      ip: meta.ip,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
      source: "api",
      reason: `SCIM role change by service account ${authName}`,
    });
  } else if (role && user.kind === "user") {
    await pool.query(
      `UPDATE workspace_members SET role = $3 WHERE workspace_id = $1 AND user_id = $2`,
      [workspaceId, user.id, enterpriseRoleToLegacy(role)]
    );
  } else if (role && user.kind === "invite") {
    const inviteId = user.id.replace(/^invite:/, "");
    await pool.query(
      `UPDATE workspace_invites SET role = $3 WHERE id = $1 AND workspace_id = $2`,
      [inviteId, workspaceId, enterpriseRoleToLegacy(role)]
    );
  }

  const updated: ScimUserRow = {
    ...user,
    active: changes.active === true ? true : user.active,
    role: role ?? user.role,
  };
  const base = req.url.replace(/\/[^/]+$/, "");
  return Response.json(userResource(updated, mappings, defaultRole, base));
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isEnabled()) return scimError(503, "database unavailable");
  const pool = getPool();
  if (!pool) return scimError(503, "database unavailable");
  const auth = await scimAuth(req, pool);
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const user = await load(pool, auth.account.workspace_id, id);
  if (!user) return scimError(404, "user not found");
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const changes = parsePatchOps(body);
  if (
    changes.active === undefined &&
    changes.groupsValue === undefined &&
    changes.entitlementsValue === undefined
  ) {
    return scimError(400, "no supported patch operations (supports replace/add on active, groups, entitlements)");
  }
  return applyChanges(req, pool, auth.account.workspace_id, user, changes, auth.account.name);
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isEnabled()) return scimError(503, "database unavailable");
  const pool = getPool();
  if (!pool) return scimError(503, "database unavailable");
  const auth = await scimAuth(req, pool);
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const user = await load(pool, auth.account.workspace_id, id);
  if (!user) return scimError(404, "user not found");
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const email = validateEmail(body.userName ?? user.email);
  const active = typeof body.active === "boolean" ? body.active : user.active;
  const changes = {
    active,
    groupsValue: body.groups,
    entitlementsValue: body.entitlements,
  };
  if (email && email !== user.email && user.kind === "user") {
    // SCIM renames of the login email are not supported (auth identity is
    // owned by Supabase Auth); the resource keeps its existing userName.
    return scimError(400, "renaming userName is not supported; deactivate and re-provision instead");
  }
  return applyChanges(req, pool, auth.account.workspace_id, user, changes, auth.account.name);
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isEnabled()) return scimError(503, "database unavailable");
  const pool = getPool();
  if (!pool) return scimError(503, "database unavailable");
  const auth = await scimAuth(req, pool);
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const user = await load(pool, auth.account.workspace_id, id);
  if (!user) return scimError(404, "user not found");
  await deactivateScimUser(pool, auth.account.workspace_id, user);
  const delMeta = getRequestMeta(req);
  await writeAuditEvent(pool, {
    actorUserId: null,
    workspaceId: auth.account.workspace_id,
    action: "security.scim_user_deactivated",
    targetType: "workspace_member",
    targetId: user.id,
    after: { email: user.email, active: false },
    ip: delMeta.ip,
    userAgent: delMeta.userAgent,
    correlationId: delMeta.correlationId,
    source: "api",
    reason: `SCIM deprovision by service account ${auth.account.name}`,
  });
  return new Response(null, { status: 204 });
}
