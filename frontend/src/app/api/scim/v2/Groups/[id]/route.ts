// Phase 6 — SCIM 2.0 single Group.
// GET    /api/scim/v2/Groups/[id]   — one sso_group_mappings entry
// PUT    /api/scim/v2/Groups/[id]   — replace { displayName?, role }
// PATCH  /api/scim/v2/Groups/[id]   — replace ops on displayName / role
// DELETE /api/scim/v2/Groups/[id]   — remove the mapping (204)
//
// The group id is the slug of the mapping's displayName. All mutations are
// audited. Bearer auth via service_accounts with the 'scim' scope.

import { getPool, isEnabled } from "../../../../../graph/db";
import {
  scimAuth,
  scimError,
  getGroupMappings,
  slug,
  SCIM_SCHEMAS,
  type GroupMappingRow,
} from "../../../_util";
import { isRoleKey, writeAuditEvent, getRequestMeta } from "../../../../../../lib/enterprise-permissions";
import { redactSecrets, type Queryable } from "../../../../../../lib/enterprise-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function loadMapping(
  pool: Queryable,
  workspaceId: string,
  id: string
): Promise<{ mappings: GroupMappingRow[]; mapping: GroupMappingRow | null }> {
  const { mappings } = await getGroupMappings(pool, workspaceId);
  const decoded = decodeURIComponent(id);
  const mapping = mappings.find((m) => slug(m.group) === decoded) ?? null;
  return { mappings, mapping };
}

function groupResource(
  reqUrl: string,
  m: GroupMappingRow
): Record<string, unknown> {
  return {
    schemas: SCIM_SCHEMAS.group,
    id: slug(m.group),
    displayName: m.group,
    meta: {
      resourceType: "Group",
      location: `${reqUrl.replace(/\/$/, "")}/${encodeURIComponent(slug(m.group))}`,
    },
    "urn:ietf:params:scim:schemas:extension:enterprise:2.0:Group": {
      smartprRole: m.role,
    },
  };
}

async function saveMappings(
  pool: Queryable,
  workspaceId: string,
  mappings: GroupMappingRow[]
): Promise<void> {
  await pool.query(
    `INSERT INTO workspace_branding (workspace_id, sso_group_mappings, updated_at)
     VALUES ($1, $2::jsonb, now())
     ON CONFLICT (workspace_id) DO UPDATE SET sso_group_mappings = $2::jsonb, updated_at = now()`,
    [workspaceId, JSON.stringify(mappings)]
  );
}

async function auditGroup(
  req: Request,
  pool: Queryable,
  workspaceId: string,
  action: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  accountName: string
): Promise<void> {
  const meta = getRequestMeta(req);
  await writeAuditEvent(pool, {
    actorUserId: null,
    workspaceId,
    action,
    targetType: "sso_group_mapping",
    targetId: String((after ?? before)?.group ?? ""),
    before: before ? redactSecrets(before) : undefined,
    after: after ? redactSecrets(after) : undefined,
    ip: meta.ip,
    userAgent: meta.userAgent,
    correlationId: meta.correlationId,
    source: "api",
    reason: `SCIM group ${action === "security.scim_group_deleted" ? "deletion" : "update"} by service account ${accountName}`,
  });
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isEnabled()) return scimError(503, "database unavailable");
  const pool = getPool();
  if (!pool) return scimError(503, "database unavailable");
  const auth = await scimAuth(req, pool);
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const { mapping } = await loadMapping(pool, auth.account.workspace_id, id);
  if (!mapping) return scimError(404, "group not found");
  const base = req.url.replace(/\/[^/]+$/, "");
  return Response.json(groupResource(base, mapping));
}

/** Resolve the desired displayName/role for PUT or PATCH bodies. Exported for tests. */
export function parseGroupUpdate(
  body: Record<string, unknown>,
  current: GroupMappingRow
): { displayName: string; role: string } | Response {
  let displayName = current.group;
  let role = current.role;
  const ops = Array.isArray(body.Operations) ? (body.Operations as Array<Record<string, unknown>>) : null;
  if (ops) {
    for (const op of ops) {
      if (typeof op !== "object" || !op) continue;
      const opName = String(op.op || "").toLowerCase();
      if (opName !== "replace" && opName !== "add") continue;
      const path = String(op.path || "").toLowerCase();
      if ((path === "displayname" || path === "") && typeof op.value === "string") {
        displayName = op.value.trim() || displayName;
      } else if (path === "role" && typeof op.value === "string") {
        role = op.value.trim();
      } else if (typeof op.value === "object" && op.value) {
        const v = op.value as Record<string, unknown>;
        if (typeof v.displayName === "string" && v.displayName.trim()) displayName = v.displayName.trim();
        if (typeof v.role === "string" && v.role.trim()) role = v.role.trim();
      }
    }
  } else {
    if (typeof body.displayName === "string" && body.displayName.trim()) {
      displayName = body.displayName.trim();
    }
    const r = String(body.role ?? body.smartprRole ?? "").trim();
    if (r) role = r;
  }
  if (!displayName) return scimError(400, "displayName is required");
  if (!isRoleKey(role)) return scimError(400, "role must be a known enterprise role key");
  return { displayName, role };
}

async function applyUpdate(
  req: Request,
  pool: Queryable,
  workspaceId: string,
  accountName: string,
  id: string,
  body: Record<string, unknown>
): Promise<Response> {
  const { mappings, mapping } = await loadMapping(pool, workspaceId, id);
  if (!mapping) return scimError(404, "group not found");
  const parsed = parseGroupUpdate(body, mapping);
  if (parsed instanceof Response) return parsed;

  const renamed = parsed.displayName.toLowerCase() !== mapping.group.toLowerCase();
  if (
    renamed &&
    mappings.some(
      (m) => m !== mapping && m.group.toLowerCase() === parsed.displayName.toLowerCase()
    )
  ) {
    return scimError(409, "a group with this displayName already exists");
  }
  const next = mappings.map((m) =>
    m === mapping ? { group: parsed.displayName, role: parsed.role } : m
  );
  await saveMappings(pool, workspaceId, next);
  await auditGroup(
    req,
    pool,
    workspaceId,
    "security.scim_group_updated",
    { group: mapping.group, role: mapping.role },
    { group: parsed.displayName, role: parsed.role },
    accountName
  );

  const base = req.url.replace(/\/[^/]+$/, "");
  return Response.json(groupResource(base, { group: parsed.displayName, role: parsed.role }));
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isEnabled()) return scimError(503, "database unavailable");
  const pool = getPool();
  if (!pool) return scimError(503, "database unavailable");
  const auth = await scimAuth(req, pool);
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  return applyUpdate(req, pool, auth.account.workspace_id, auth.account.name, id, body);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isEnabled()) return scimError(503, "database unavailable");
  const pool = getPool();
  if (!pool) return scimError(503, "database unavailable");
  const auth = await scimAuth(req, pool);
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  return applyUpdate(req, pool, auth.account.workspace_id, auth.account.name, id, body);
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isEnabled()) return scimError(503, "database unavailable");
  const pool = getPool();
  if (!pool) return scimError(503, "database unavailable");
  const auth = await scimAuth(req, pool);
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const { mappings, mapping } = await loadMapping(pool, auth.account.workspace_id, id);
  if (!mapping) return scimError(404, "group not found");
  const next = mappings.filter((m) => m !== mapping);
  await saveMappings(pool, auth.account.workspace_id, next);
  await auditGroup(
    req,
    pool,
    auth.account.workspace_id,
    "security.scim_group_deleted",
    { group: mapping.group, role: mapping.role },
    null,
    auth.account.name
  );
  // Users keep their roles; group mappings only drive SSO/JIT role
  // assignment and SCIM group membership views.
  return new Response(null, { status: 204 });
}
