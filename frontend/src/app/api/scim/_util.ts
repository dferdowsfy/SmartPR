// Phase 6 — SCIM 2.0 shared helpers (server-only).
//
// Pragmatic provisioning model:
//   - SCIM user with an email that matches an existing Supabase auth user
//     -> workspace_members row (upsert) + enterprise role_assignment rows.
//   - Email with no auth user yet -> workspace_invites row (token, 7-day
//     expiry, mapped role); the invite is accepted on first sign-in.
//   - DELETE deactivates: removes memberships + role assignments, cancels
//     pending invites. The auth user is NEVER deleted.
//   - SCIM groups are the workspace's sso_group_mappings entries; group
//     membership is derived from each member's mapped enterprise role.

import { randomBytes } from "node:crypto";
import {
  authenticateScimRequest,
  enterpriseRoleToLegacy,
  roleForScimGroup,
  type Queryable,
  type ScimAccount,
} from "../../../lib/enterprise-security";
import { isRoleKey, type RoleKey } from "../../../lib/enterprise-permissions";

export const SCIM_SCHEMAS = {
  list: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
  user: ["urn:ietf:params:scim:schemas:core:2.0:User"],
  group: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
  error: ["urn:ietf:params:scim:api:messages:2.0:Error"],
};

export function scimError(status: number, detail: string): Response {
  return Response.json(
    { schemas: SCIM_SCHEMAS.error, status: String(status), detail },
    { status }
  );
}

/** SCIM bearer auth; returns the account or a 401/403 Response. */
export async function scimAuth(
  req: Request,
  pool: Queryable | null
): Promise<{ account: ScimAccount } | { response: Response }> {
  const result = await authenticateScimRequest(req, pool);
  if (!result.ok) {
    const status = result.status === 503 ? 503 : result.status;
    return {
      response: scimError(
        status,
        status === 401
          ? `Unauthorized: ${result.reason}. Provide a valid service-account bearer token with the 'scim' scope.`
          : `Forbidden: ${result.reason}.`
      ),
    };
  }
  return { account: result.account };
}

export interface GroupMappingRow {
  group: string;
  role: string;
}

export async function getGroupMappings(
  pool: Queryable,
  workspaceId: string
): Promise<{ mappings: GroupMappingRow[]; defaultRole: RoleKey }> {
  try {
    const { rows } = await pool.query(
      `SELECT sso_group_mappings, sso_default_role FROM workspace_branding WHERE workspace_id = $1`,
      [workspaceId]
    );
    const r = rows[0] as
      | { sso_group_mappings: unknown; sso_default_role: string | null }
      | undefined;
    const raw = r?.sso_group_mappings;
    const mappings: GroupMappingRow[] = Array.isArray(raw)
      ? raw
          .filter((m) => m && typeof m === "object")
          .map((m) => ({
            group: String((m as Record<string, unknown>).group ?? ""),
            role: String((m as Record<string, unknown>).role ?? ""),
          }))
          .filter((m) => m.group)
      : [];
    const defaultRole: RoleKey =
      r?.sso_default_role && isRoleKey(r.sso_default_role) ? r.sso_default_role : "contributor";
    return { mappings, defaultRole };
  } catch {
    return { mappings: [], defaultRole: "contributor" };
  }
}

export interface ScimUserRow {
  /** "user" for a real member, "invite" for a pending invite. */
  kind: "user" | "invite";
  id: string;
  email: string;
  active: boolean;
  role: RoleKey | null;
  legacyRole: string | null;
}

/** All provisioned users: members + pending invites, for one workspace. */
export async function listScimUsers(
  pool: Queryable,
  workspaceId: string
): Promise<ScimUserRow[]> {
  const out: ScimUserRow[] = [];
  try {
    const { rows } = await pool.query(
      `SELECT wm.user_id::text AS user_id, wm.role AS legacy_role, au.email AS email
         FROM workspace_members wm
         LEFT JOIN auth.users au ON au.id = wm.user_id
        WHERE wm.workspace_id = $1
        ORDER BY au.email NULLS LAST`,
      [workspaceId]
    );
    for (const r of rows) {
      out.push({
        kind: "user",
        id: String(r.user_id),
        email: typeof r.email === "string" && r.email ? r.email : `(user ${String(r.user_id).slice(0, 8)})`,
        active: true,
        role: null,
        legacyRole: typeof r.legacy_role === "string" ? r.legacy_role : null,
      });
    }
  } catch {
    /* workspace_members missing */
  }
  try {
    const { rows } = await pool.query(
      `SELECT id::text AS id, email, role AS legacy_role
         FROM workspace_invites
        WHERE workspace_id = $1 AND accepted_at IS NULL AND expires_at > now()
        ORDER BY email`,
      [workspaceId]
    );
    for (const r of rows) {
      out.push({
        kind: "invite",
        id: `invite:${String(r.id)}`,
        email: String(r.email ?? ""),
        active: false,
        role: null,
        legacyRole: typeof r.legacy_role === "string" ? r.legacy_role : null,
      });
    }
  } catch {
    /* invites missing */
  }
  return out;
}

/** Look up an auth user id by email (privileged connection can read auth.users). */
export async function findAuthUserByEmail(
  pool: Queryable,
  email: string
): Promise<{ id: string; email: string } | null> {
  try {
    const { rows } = await pool.query(
      `SELECT id::text AS id, email FROM auth.users WHERE lower(email) = lower($1) LIMIT 1`,
      [email]
    );
    if (!rows[0]) return null;
    return { id: String(rows[0].id), email: String(rows[0].email) };
  } catch {
    return null;
  }
}

const ENTERPRISE_ROLE_IDS: Record<string, string> = {};

/** Best-effort: create enterprise role_assignment rows for a member. */
export async function assignEnterpriseRole(
  pool: Queryable,
  userId: string,
  workspaceId: string,
  roleKey: RoleKey
): Promise<void> {
  try {
    // Cache the system-role row ids per (workspace, key) within the process.
    const cacheKey = `${workspaceId}:${roleKey}`;
    let roleId = ENTERPRISE_ROLE_IDS[cacheKey];
    if (!roleId) {
      const { rows } = await pool.query(
        `SELECT id::text AS id FROM enterprise_roles
          WHERE workspace_id = $1 AND key = $2 AND is_system = true LIMIT 1`,
        [workspaceId, roleKey]
      );
      roleId = rows[0] ? String(rows[0].id) : "";
      ENTERPRISE_ROLE_IDS[cacheKey] = roleId;
    }
    if (!roleId) return; // enterprise roles not seeded for this workspace: legacy row is enough
    await pool.query(
      `INSERT INTO role_assignments (user_id, workspace_id, enterprise_role_id, scope_type, scope_id)
       VALUES ($1, $2, $3, 'organization', $2)
       ON CONFLICT (user_id, workspace_id, enterprise_role_id, scope_type, scope_id) DO NOTHING`,
      [userId, workspaceId, roleId]
    );
  } catch {
    /* best-effort only */
  }
}

/**
 * Replace a user's organization-scope enterprise role assignment.
 * Deletes existing org-scope rows for the user, then creates the new one.
 */
export async function setEnterpriseRole(
  pool: Queryable,
  userId: string,
  workspaceId: string,
  roleKey: RoleKey
): Promise<void> {
  try {
    await pool.query(
      `DELETE FROM role_assignments WHERE user_id = $1 AND workspace_id = $2 AND scope_type = 'organization'`,
      [userId, workspaceId]
    );
  } catch {
    /* best-effort */
  }
  await assignEnterpriseRole(pool, userId, workspaceId, roleKey);
}

/**
 * Provision a user: existing auth user -> membership (upsert) + enterprise
 * role; unknown email -> invite row. Returns the SCIM user row.
 */
export async function provisionScimUser(
  pool: Queryable,
  workspaceId: string,
  email: string,
  roleKey: RoleKey,
  invitedByLabel = "scim"
): Promise<ScimUserRow> {
  const legacy = enterpriseRoleToLegacy(roleKey);
  const authUser = await findAuthUserByEmail(pool, email);
  if (authUser) {
    await pool.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
      [workspaceId, authUser.id, legacy]
    );
    await assignEnterpriseRole(pool, authUser.id, workspaceId, roleKey);
    return {
      kind: "user",
      id: authUser.id,
      email: authUser.email,
      active: true,
      role: roleKey,
      legacyRole: legacy,
    };
  }
  const token = randomBytes(24).toString("hex");
  const { rows } = await pool.query(
    `INSERT INTO workspace_invites (workspace_id, email, role, token, expires_at)
     VALUES ($1, $2, $3, $4, now() + interval '7 days')
     ON CONFLICT (token) DO NOTHING
     RETURNING id::text AS id`,
    [workspaceId, email.toLowerCase(), legacy, token]
  );
  const inviteId = rows[0]?.id ?? token;
  void invitedByLabel;
  return {
    kind: "invite",
    id: `invite:${inviteId}`,
    email: email.toLowerCase(),
    active: false,
    role: roleKey,
    legacyRole: legacy,
  };
}

/** Deactivate: remove memberships + role assignments, cancel pending invites. */
export async function deactivateScimUser(
  pool: Queryable,
  workspaceId: string,
  user: ScimUserRow
): Promise<void> {
  if (user.kind === "invite") {
    const inviteId = user.id.replace(/^invite:/, "");
    await pool.query(`DELETE FROM workspace_invites WHERE id = $1 AND workspace_id = $2`, [
      inviteId,
      workspaceId,
    ]);
    return;
  }
  await pool.query(
    `DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`,
    [workspaceId, user.id]
  );
  try {
    await pool.query(
      `DELETE FROM role_assignments WHERE workspace_id = $1 AND user_id = $2`,
      [workspaceId, user.id]
    );
  } catch {
    /* best-effort */
  }
  await pool.query(
    `DELETE FROM workspace_invites
      WHERE workspace_id = $1 AND lower(email) = lower($2) AND accepted_at IS NULL`,
    [workspaceId, user.email]
  );
}

export function findScimUser(users: ScimUserRow[], id: string): ScimUserRow | undefined {
  return users.find((u) => u.id === id);
}

/** Parse the simple SCIM filter we support: userName eq "email". */
export function parseUserNameFilter(filter: string | null): string | null {
  if (!filter) return null;
  const m = /^\s*userName\s+eq\s+"([^"]+)"\s*$/i.exec(filter);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// SCIM resource builders
// ---------------------------------------------------------------------------

export function userResource(
  u: ScimUserRow,
  mappings: GroupMappingRow[],
  defaultRole: RoleKey,
  reqUrl: string
): Record<string, unknown> {
  const groups: Array<{ value: string; display: string }> = [];
  if (u.role && isRoleKey(u.role)) {
    for (const m of mappings) {
      if (m.role === u.role) groups.push({ value: slug(m.group), display: m.group });
    }
  }
  const [name] = u.email.split("@");
  return {
    schemas: SCIM_SCHEMAS.user,
    id: u.id,
    userName: u.email,
    name: { formatted: name || u.email },
    emails: [{ value: u.email, type: "work", primary: true }],
    active: u.active,
    groups,
    meta: {
      resourceType: "User",
      location: `${reqUrl.replace(/\/$/, "")}/${encodeURIComponent(u.id)}`,
    },
    "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User": {
      employeeNumber: u.kind === "invite" ? "pending-invite" : undefined,
    },
  };
}

export function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function listResponse(
  resources: Array<Record<string, unknown>>,
  opts: { startIndex?: number; count?: number; totalOverride?: number } = {}
): Response {
  const startIndex = Math.max(1, opts.startIndex ?? 1);
  const count = Math.min(Math.max(opts.count ?? 100, 1), 500);
  const total = opts.totalOverride ?? resources.length;
  const page = resources.slice(startIndex - 1, startIndex - 1 + count);
  return Response.json({
    schemas: SCIM_SCHEMAS.list,
    totalResults: total,
    startIndex,
    itemsPerPage: page.length,
    Resources: page,
  });
}

/** Resolve an enterprise role from SCIM create/update body groups/entitlements. */
export function roleFromScimBody(
  body: Record<string, unknown>,
  mappings: GroupMappingRow[],
  defaultRole: RoleKey
): RoleKey {
  const groups = body.groups;
  if (Array.isArray(groups)) {
    for (const g of groups) {
      const name =
        typeof g === "string"
          ? g
          : typeof (g as Record<string, unknown>).display === "string"
            ? String((g as Record<string, unknown>).display)
            : typeof (g as Record<string, unknown>).value === "string"
              ? String((g as Record<string, unknown>).value)
              : "";
      if (name) {
        const direct = mappings.find(
          (m) => m.group.toLowerCase() === name.toLowerCase() || slug(m.group) === name.toLowerCase()
        );
        if (direct && isRoleKey(direct.role)) return direct.role;
        const mapped = roleForScimGroup(name, mappings, "");
        if (isRoleKey(mapped)) return mapped;
      }
    }
  }
  const entitlements = body.entitlements;
  if (Array.isArray(entitlements)) {
    for (const e of entitlements) {
      const v = typeof e === "string" ? e : String((e as Record<string, unknown>).value ?? "");
      if (isRoleKey(v)) return v;
    }
  }
  return defaultRole;
}

export function validateEmail(email: unknown): string | null {
  if (typeof email !== "string") return null;
  const e = email.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) ? e : null;
}
