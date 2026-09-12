// Phase 6 — SCIM 2.0 Groups.
// GET  /api/scim/v2/Groups        — groups from the workspace's
//        sso_group_mappings, with membership derived from members' roles.
// POST /api/scim/v2/Groups        — { displayName, role } adds a group->role
//        mapping (audited in the enterprise audit log).
//
// Bearer auth via service_accounts with the 'scim' scope.

import { getPool, isEnabled } from "../../../../graph/db";
import {
  scimAuth,
  scimError,
  getGroupMappings,
  listResponse,
  slug,
  SCIM_SCHEMAS,
  type GroupMappingRow,
} from "../../_util";
import { isRoleKey, writeAuditEvent, getRequestMeta } from "../../../../../lib/enterprise-permissions";
import { redactSecrets, type Queryable } from "../../../../../lib/enterprise-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Members of a mapped group: users whose enterprise role matches the mapping. */
async function groupMembers(
  pool: Queryable,
  workspaceId: string,
  roleKey: string
): Promise<Array<{ value: string; display: string }>> {
  const members: Array<{ value: string; display: string }> = [];
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT wm.user_id::text AS user_id, au.email AS email
         FROM workspace_members wm
         LEFT JOIN auth.users au ON au.id = wm.user_id
        WHERE wm.workspace_id = $1
          AND (
            EXISTS (
              SELECT 1 FROM role_assignments ra
              JOIN enterprise_roles er ON er.id = ra.enterprise_role_id
             WHERE ra.workspace_id = $1 AND ra.user_id = wm.user_id
               AND er.key = $2 AND ra.scope_type = 'organization'
            )
            OR ($2 = 'auditor' AND wm.role = 'VIEWER')
            OR ($2 = 'contributor' AND wm.role = 'MEMBER')
            OR ($2 = 'org_admin' AND wm.role = 'ADMIN')
            OR ($2 = 'org_owner' AND wm.role = 'OWNER')
          )`,
      [workspaceId, roleKey]
    );
    for (const r of rows) {
      members.push({
        value: String(r.user_id),
        display: typeof r.email === "string" && r.email ? r.email : String(r.user_id),
      });
    }
  } catch {
    /* best-effort */
  }
  return members;
}

export async function GET(req: Request) {
  if (!isEnabled()) return scimError(503, "database unavailable");
  const pool = getPool();
  if (!pool) return scimError(503, "database unavailable");
  const auth = await scimAuth(req, pool);
  if ("response" in auth) return auth.response;

  const sp = new URL(req.url).searchParams;
  const startIndex = Math.max(1, parseInt(sp.get("startIndex") || "1", 10) || 1);
  const count = Math.min(Math.max(parseInt(sp.get("count") || "100", 10) || 100, 1), 500);

  const { mappings } = await getGroupMappings(pool, auth.account.workspace_id);
  const resources = [];
  for (const m of mappings) {
    const members = await groupMembers(pool, auth.account.workspace_id, m.role);
    resources.push({
      schemas: SCIM_SCHEMAS.group,
      id: slug(m.group),
      displayName: m.group,
      members,
      meta: { resourceType: "Group" },
      "urn:ietf:params:scim:schemas:extension:enterprise:2.0:Group": {
        smartprRole: m.role,
      },
    });
  }
  return listResponse(resources, { startIndex, count });
}

export async function POST(req: Request) {
  if (!isEnabled()) return scimError(503, "database unavailable");
  const pool = getPool();
  if (!pool) return scimError(503, "database unavailable");
  const auth = await scimAuth(req, pool);
  if ("response" in auth) return auth.response;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const displayName = String(body.displayName ?? "").trim();
  const role = String(
    body.role ?? (body as Record<string, unknown>)["smartprRole"] ?? ""
  ).trim();
  if (!displayName) return scimError(400, "displayName is required");
  if (!isRoleKey(role)) return scimError(400, "role must be a known enterprise role key");

  const { rows } = await pool.query(
    `SELECT sso_group_mappings FROM workspace_branding WHERE workspace_id = $1`,
    [auth.account.workspace_id]
  );
  const current: GroupMappingRow[] = Array.isArray(rows[0]?.sso_group_mappings)
    ? (rows[0].sso_group_mappings as GroupMappingRow[])
    : [];
  if (current.some((m) => m.group.toLowerCase() === displayName.toLowerCase())) {
    return scimError(409, "a group with this displayName already exists");
  }
  const next = [...current, { group: displayName, role }];
  await pool.query(
    `INSERT INTO workspace_branding (workspace_id, sso_group_mappings, updated_at)
     VALUES ($1, $2::jsonb, now())
     ON CONFLICT (workspace_id) DO UPDATE SET sso_group_mappings = $2::jsonb, updated_at = now()`,
    [auth.account.workspace_id, JSON.stringify(next)]
  );

  const meta = getRequestMeta(req);
  await writeAuditEvent(pool, {
    actorUserId: null,
    workspaceId: auth.account.workspace_id,
    action: "security.scim_group_created",
    targetType: "sso_group_mapping",
    targetId: displayName,
    after: redactSecrets({ group: displayName, role }),
    ip: meta.ip,
    userAgent: meta.userAgent,
    correlationId: meta.correlationId,
    source: "api",
    reason: `SCIM group created by service account ${auth.account.name}`,
  });

  const members = await groupMembers(pool, auth.account.workspace_id, role);
  return Response.json(
    {
      schemas: SCIM_SCHEMAS.group,
      id: slug(displayName),
      displayName,
      members,
      meta: { resourceType: "Group" },
    },
    { status: 201 }
  );
}
