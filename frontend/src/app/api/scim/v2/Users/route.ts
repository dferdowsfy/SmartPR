// Phase 6 — SCIM 2.0 Users collection.
// GET  /api/scim/v2/Users?startIndex=&count=&filter=userName eq "a@b.c"
// POST /api/scim/v2/Users  { userName, name, active, groups, entitlements }
//
// Bearer auth via service_accounts with the 'scim' scope (see _util.ts).

import { getPool, isEnabled } from "../../../../graph/db";
import {
  SCIM_SCHEMAS,
  scimAuth,
  scimError,
  listScimUsers,
  listResponse,
  userResource,
  getGroupMappings,
  provisionScimUser,
  roleFromScimBody,
  parseUserNameFilter,
  validateEmail,
} from "../../_util";
import {
  writeAuditEvent,
  getRequestMeta,
} from "../../../../../lib/enterprise-permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parsePaging(url: string) {
  const sp = new URL(url).searchParams;
  const startIndex = Math.max(1, parseInt(sp.get("startIndex") || "1", 10) || 1);
  const count = Math.min(Math.max(parseInt(sp.get("count") || "100", 10) || 100, 1), 500);
  return { startIndex, count, filter: sp.get("filter") };
}

export async function GET(req: Request) {
  if (!isEnabled()) return scimError(503, "database unavailable");
  const pool = getPool();
  if (!pool) return scimError(503, "database unavailable");
  const auth = await scimAuth(req, pool);
  if ("response" in auth) return auth.response;

  const { startIndex, count, filter } = parsePaging(req.url);
  const nameFilter = parseUserNameFilter(filter);
  if (filter && !nameFilter) {
    return scimError(400, `unsupported filter (only: userName eq "email"): ${filter.slice(0, 120)}`);
  }

  const { mappings, defaultRole } = await getGroupMappings(pool, auth.account.workspace_id);
  let users = await listScimUsers(pool, auth.account.workspace_id);
  if (nameFilter) {
    const q = nameFilter.toLowerCase();
    users = users.filter((u) => u.email.toLowerCase() === q);
  }
  // Attach roles from group mappings is best-effort; list shows membership state.
  const resources = users.map((u) => userResource(u, mappings, defaultRole, req.url));
  return listResponse(resources, { startIndex, count });
}

export async function POST(req: Request) {
  if (!isEnabled()) return scimError(503, "database unavailable");
  const pool = getPool();
  if (!pool) return scimError(503, "database unavailable");
  const auth = await scimAuth(req, pool);
  if ("response" in auth) return auth.response;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const email = validateEmail(body.userName);
  if (!email) return scimError(400, "userName is required and must be an email address");

  const { mappings, defaultRole } = await getGroupMappings(pool, auth.account.workspace_id);
  const role = roleFromScimBody(body, mappings, defaultRole);

  try {
    const user = await provisionScimUser(pool, auth.account.workspace_id, email, role);
    const resource = userResource(user, mappings, defaultRole, req.url);
    const meta = getRequestMeta(req);
    await writeAuditEvent(pool, {
      actorUserId: null,
      workspaceId: auth.account.workspace_id,
      action: "security.scim_user_provisioned",
      targetType: "workspace_member",
      targetId: user.id,
      after: { email: user.email, role, kind: user.kind },
      ip: meta.ip,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
      source: "api",
      reason: `SCIM provision by service account ${auth.account.name}`,
    });
    return Response.json(
      { ...resource, schemas: SCIM_SCHEMAS.user },
      { status: 201, headers: { Location: String(resource.meta ? (resource.meta as Record<string, unknown>).location : "") } }
    );
  } catch (e) {
    return scimError(500, `provisioning failed: ${(e as Error).message.slice(0, 200)}`);
  }
}
