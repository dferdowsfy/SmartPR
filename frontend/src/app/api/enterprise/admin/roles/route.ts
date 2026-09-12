// Enterprise role assignments CRUD: GET (workspace-wide list), POST (grant),
// DELETE (revoke by assignment id).
//
// Permission: manage_users on the workspace. System roles are seeded per
// workspace on first use via ensureSystemRoles().
import { getPool, isEnabled } from "../../../../graph/db";
import {
  requireEnterprisePermission,
  writeAuditEvent,
  getRequestMeta,
} from "../../../../../lib/enterprise-permissions";
import {
  ensureSystemRoles,
  validateScope,
  assertRoleKey,
} from "../../../../../lib/enterprise/workspaceRoles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function workspaceIdFrom(request: Request): string | null {
  const id = new URL(request.url).searchParams.get("workspace_id")?.trim();
  return id || null;
}

async function gate(request: Request) {
  const workspaceId = workspaceIdFrom(request);
  if (!workspaceId) return { response: Response.json({ error: "workspace_id required" }, { status: 400 }) } as const;
  const g = await requireEnterprisePermission("manage_users", workspaceId);
  if ("response" in g) return { response: g.response } as const;
  if (!isEnabled()) return { response: Response.json({ error: "no_database" }, { status: 503 }) } as const;
  const pool = getPool();
  if (!pool) return { response: Response.json({ error: "no_database" }, { status: 503 }) } as const;
  return { workspaceId, user: g.user, pool } as const;
}

/** All role assignments in the workspace (with member email + scope names). */
export async function GET(request: Request) {
  const g = await gate(request);
  if ("response" in g) return g.response;
  const { workspaceId, pool } = g;

  try {
    const { rows } = await pool.query(
      `SELECT ra.id::text AS id, ra.user_id::text AS user_id,
              lower(u.email) AS email,
              er.key AS role_key, er.label AS role_label,
              ra.scope_type, ra.scope_id::text AS scope_id,
              COALESCE(b.name, f.name, m.title) AS scope_name,
              ra.created_at
         FROM role_assignments ra
         JOIN enterprise_roles er ON er.id = ra.enterprise_role_id
         LEFT JOIN auth.users u ON u.id = ra.user_id
         LEFT JOIN businesses b ON b.id = ra.scope_id AND ra.scope_type = 'business'
         LEFT JOIN facilities f ON f.id = ra.scope_id AND ra.scope_type = 'facility'
         LEFT JOIN matters m ON m.id = ra.scope_id AND ra.scope_type = 'project'
        WHERE ra.workspace_id = $1
        ORDER BY lower(u.email) ASC NULLS LAST, er.key`,
      [workspaceId]
    );
    return Response.json({ assignments: rows });
  } catch {
    return Response.json({ assignments: [] });
  }
}

type GrantBody = {
  user_id?: string;
  role_key?: string;
  scope_type?: string;
  scope_id?: string | null;
};

/** Grant an enterprise role to a member at a scope. Idempotent (no duplicates). */
export async function POST(request: Request) {
  const g = await gate(request);
  if ("response" in g) return g.response;
  const { workspaceId, user, pool } = g;
  const meta = getRequestMeta(request);

  const body = (await request.json().catch(() => ({}))) as GrantBody;
  const targetUserId = (body.user_id || "").trim();
  if (!targetUserId) return Response.json({ error: "user_id required" }, { status: 400 });
  let roleKey: string;
  try {
    roleKey = assertRoleKey(body.role_key);
  } catch {
    return Response.json({ error: "invalid role_key" }, { status: 400 });
  }
  const scopeType = (body.scope_type || "organization").toLowerCase();
  if (!["organization", "business", "facility", "project"].includes(scopeType)) {
    return Response.json({ error: "invalid scope_type" }, { status: 400 });
  }
  let scopeId: string | null;
  try {
    scopeId = await validateScope(pool, workspaceId, scopeType, body.scope_id ?? null);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }

  const member = await pool.query(
    `SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`,
    [workspaceId, targetUserId]
  );
  if (!member.rows[0]) {
    return Response.json({ error: "user is not a member of this workspace" }, { status: 404 });
  }

  const roleIds = await ensureSystemRoles(pool, workspaceId);
  const roleId = roleIds.get(roleKey);
  if (!roleId) return Response.json({ error: "role not found" }, { status: 500 });

  const ins = await pool.query(
    `INSERT INTO role_assignments (user_id, workspace_id, enterprise_role_id, scope_type, scope_id)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT DO NOTHING
     RETURNING id::text AS id`,
    [targetUserId, workspaceId, roleId, scopeType, scopeId]
  );

  await writeAuditEvent(pool, {
    actorUserId: user.id,
    workspaceId,
    action: "roles.granted",
    targetType: "role_assignment",
    targetId: ins.rows[0]?.id ?? null,
    after: { user_id: targetUserId, role_key: roleKey, scope_type: scopeType, scope_id: scopeId },
    ip: meta.ip,
    userAgent: meta.userAgent,
    correlationId: meta.correlationId,
    source: "ui",
  });

  return Response.json({ ok: true, id: ins.rows[0]?.id ?? null, duplicate: !ins.rows[0] });
}

/** Revoke a role assignment by id (?id= or JSON body). */
export async function DELETE(request: Request) {
  const g = await gate(request);
  if ("response" in g) return g.response;
  const { workspaceId, user, pool } = g;
  const meta = getRequestMeta(request);

  const url = new URL(request.url);
  const body = (await request.json().catch(() => ({}))) as { id?: string };
  const id = url.searchParams.get("id")?.trim() || (body.id || "").trim();
  if (!id) return Response.json({ error: "id required" }, { status: 400 });

  const cur = await pool.query(
    `SELECT ra.id::text AS id, ra.user_id::text AS user_id, er.key AS role_key,
            ra.scope_type, ra.scope_id::text AS scope_id
       FROM role_assignments ra
       JOIN enterprise_roles er ON er.id = ra.enterprise_role_id
      WHERE ra.id = $1 AND ra.workspace_id = $2`,
    [id, workspaceId]
  );
  if (!cur.rows[0]) return Response.json({ error: "not found" }, { status: 404 });

  // Last-owner protection: never revoke the final org_owner grant.
  if (cur.rows[0].role_key === "org_owner") {
    const others = await pool.query(
      `SELECT COUNT(*)::int AS n
         FROM role_assignments ra
         JOIN enterprise_roles er ON er.id = ra.enterprise_role_id
        WHERE ra.workspace_id = $1 AND er.key = 'org_owner' AND ra.id <> $2`,
      [workspaceId, id]
    );
    const legacyOwners = await pool.query(
      `SELECT COUNT(*)::int AS n FROM workspace_members
        WHERE workspace_id = $1 AND role = 'OWNER'`,
      [workspaceId]
    );
    if (Number(others.rows[0]?.n || 0) === 0 && Number(legacyOwners.rows[0]?.n || 0) === 0) {
      return Response.json(
        { error: "cannot revoke the last organization owner" },
        { status: 409 }
      );
    }
  }

  await pool.query(`DELETE FROM role_assignments WHERE id = $1`, [id]);

  await writeAuditEvent(pool, {
    actorUserId: user.id,
    workspaceId,
    action: "roles.revoked",
    targetType: "role_assignment",
    targetId: id,
    before: cur.rows[0],
    ip: meta.ip,
    userAgent: meta.userAgent,
    correlationId: meta.correlationId,
    source: "ui",
  });

  return Response.json({ ok: true });
}
