// ============================================================================
// Enterprise permissions core — Phase 1.
//
// Server-side only. Resolves a user's enterprise roles for a workspace,
// checks permissions with hierarchical scope coverage (organization >
// business > facility > project), gates tenant access, and writes audit
// events. Designed to degrade gracefully: if the enterprise tables
// (role_assignments, enterprise_roles, facilities, audit_events) do not exist
// yet, every lookup falls back to the legacy workspace_members roles.
//
// Assumed enterprise schema (to be created by the schema-migration worker):
//   enterprise_roles(id UUID PK, workspace_id UUID, key TEXT, label TEXT,
//                      permissions JSONB, is_system BOOLEAN)
//   role_assignments(user_id UUID, workspace_id UUID, enterprise_role_id UUID,
//                    scope_type TEXT, scope_id UUID, ...)
//   facilities(id UUID PK, business_id UUID, workspace_id UUID, ...)
//   audit_events(id BIGINT GENERATED ALWAYS AS IDENTITY PK,
//                actor_user_id UUID, workspace_id UUID, action TEXT,
//                target_type TEXT, target_id TEXT, "before" JSONB, "after" JSONB,
//                ip TEXT, user_agent TEXT, correlation_id TEXT,
//                source TEXT, reason TEXT, created_at TIMESTAMPTZ)
//   matters(id UUID PK, business_id UUID, workspace_id UUID,
//           facility_id UUID NULLABLE (added by migration), ...)
// ============================================================================

import { randomUUID } from "node:crypto";
import { getPool } from "../app/graph/db";
import type { WorkspaceRole } from "./admin";

/** Minimal query surface so tests can inject fakes; pg.Pool satisfies it. */
export interface Queryable {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
}

// ---------------------------------------------------------------------------
// Roles & permissions
// ---------------------------------------------------------------------------

export const ENTERPRISE_ROLES = [
  { key: "org_owner", label: "Organization owner", description: "Full control over the organization: all permissions, all scopes." },
  { key: "org_admin", label: "Organization administrator", description: "Administers the organization: users, integrations, billing, branding and security." },
  { key: "compliance_executive", label: "Compliance executive", description: "Executive oversight: assign work, review posture, export data and inspect audit logs." },
  { key: "compliance_manager", label: "Compliance manager", description: "Runs the compliance program: facts, requirements, evidence review and approval." },
  { key: "facility_manager", label: "Facility/project manager", description: "Manages assigned facilities or projects: facts, requirements, evidence — no approvals, no user management." },
  { key: "contributor", label: "Contributor", description: "Works on assigned records: edits facts and uploads evidence." },
  { key: "evidence_reviewer", label: "Evidence reviewer", description: "Reviews submitted evidence; cannot approve it or edit records." },
  { key: "auditor", label: "Auditor / read-only", description: "Read-only access to records and audit logs for their organization." },
  { key: "external_counsel", label: "External counsel/consultant", description: "Outside advisor: views assigned records and contributes evidence." },
  { key: "billing_admin", label: "Billing administrator", description: "Manages billing and plans; can view records for context but nothing else." },
] as const;

export type RoleKey = (typeof ENTERPRISE_ROLES)[number]["key"];

export const PERMISSIONS = [
  "view_records",
  "edit_project_facts",
  "assign_requirements",
  "upload_evidence",
  "review_evidence",
  "approve_evidence",
  "manage_exceptions",
  "export_data",
  "manage_users",
  "manage_integrations",
  "view_billing",
  "view_audit_logs",
  "configure_branding_security",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ALL: Permission[] = [...PERMISSIONS];

export const ROLE_PERMISSIONS: Record<RoleKey, Permission[]> = {
  org_owner: [...ALL],
  org_admin: [...ALL],
  compliance_executive: ["view_records", "assign_requirements", "export_data", "view_audit_logs"],
  compliance_manager: [
    "view_records",
    "edit_project_facts",
    "assign_requirements",
    "upload_evidence",
    "review_evidence",
    "approve_evidence",
    "export_data",
    "view_audit_logs",
  ],
  facility_manager: [
    "view_records",
    "edit_project_facts",
    "assign_requirements",
    "upload_evidence",
    "review_evidence",
    "export_data",
  ],
  contributor: ["view_records", "edit_project_facts", "upload_evidence"],
  evidence_reviewer: ["view_records", "review_evidence"],
  auditor: ["view_records", "view_audit_logs"],
  external_counsel: ["view_records", "upload_evidence"],
  billing_admin: ["view_billing", "view_records"],
};

export function isRoleKey(v: unknown): v is RoleKey {
  return typeof v === "string" && (ROLE_PERMISSIONS as Record<string, unknown>)[v] !== undefined;
}

export function isPermission(v: unknown): v is Permission {
  return typeof v === "string" && (PERMISSIONS as readonly string[]).includes(v);
}

/** Permissions granted by a role (defensive copy). */
export function permissionsForRole(role: RoleKey): Permission[] {
  return [...(ROLE_PERMISSIONS[role] ?? [])];
}

// ---------------------------------------------------------------------------
// Scopes
// ---------------------------------------------------------------------------

export type ScopeType = "organization" | "business" | "facility" | "project";
export interface Scope {
  type: ScopeType;
  /** Entity id. For "organization", the workspace id. */
  id?: string;
}

/** Legacy workspace_members role -> enterprise system role. */
export const LEGACY_ROLE_MAP: Record<WorkspaceRole, RoleKey> = {
  OWNER: "org_owner",
  ADMIN: "org_admin",
  MEMBER: "contributor",
  VIEWER: "auditor",
};

export interface RoleAssignment {
  roleKey: RoleKey;
  scope: Scope;
  /** Workspace (organization) the assignment belongs to. */
  workspaceId: string;
  source: "enterprise" | "legacy";
}

function normalizeScopeType(v: unknown): ScopeType {
  return v === "business" || v === "facility" || v === "project" || v === "organization"
    ? v
    : "organization";
}

// ---------------------------------------------------------------------------
// Role resolution
// ---------------------------------------------------------------------------

export interface RoleResolutionOptions {
  /** Override the DB pool (tests inject a fake; defaults to getPool()). */
  pool?: Queryable | null;
  /**
   * Override the legacy workspace_members lookup (tests inject a stub).
   * Default lazy-imports ./admin so this module stays importable without
   * next/headers at module load time.
   */
  legacyRoleResolver?: (userId: string, workspaceId: string) => Promise<WorkspaceRole | null>;
}

async function defaultLegacyRoleResolver(
  userId: string,
  workspaceId: string
): Promise<WorkspaceRole | null> {
  try {
    const { getWorkspaceRole } = await import("./admin");
    return getWorkspaceRole(userId, workspaceId);
  } catch {
    return null;
  }
}

/**
 * All enterprise role assignments for a user in a workspace. Reads
 * role_assignments (joined to enterprise_roles so only defined system roles
 * come back); on any failure — table missing, schema drift — falls back to
 * the legacy workspace_members role mapped to a system role with
 * organization scope. Returns [] when the user has no role at all.
 */
export async function getUserEnterpriseRoles(
  userId: string,
  workspaceId: string,
  opts: RoleResolutionOptions = {}
): Promise<RoleAssignment[]> {
  const assignments: RoleAssignment[] = [];
  const pool = opts.pool === undefined ? getPool() : opts.pool;

  if (pool) {
    try {
      const { rows } = await pool.query(
        `SELECT er.key AS role_key, ra.scope_type AS scope_type, ra.scope_id AS scope_id
           FROM role_assignments ra
           JOIN enterprise_roles er ON er.id = ra.enterprise_role_id
          WHERE ra.user_id = $1 AND ra.workspace_id = $2`,
        [userId, workspaceId]
      );
      for (const r of rows) {
        const roleKey = r.role_key;
        if (!isRoleKey(roleKey)) continue;
        const type = normalizeScopeType(r.scope_type);
        const id = typeof r.scope_id === "string" && r.scope_id ? r.scope_id : undefined;
        assignments.push({
          roleKey,
          scope: { type, id: id ?? (type === "organization" ? workspaceId : undefined) },
          workspaceId,
          source: "enterprise",
        });
      }
    } catch {
      // role_assignments / enterprise_roles missing: fall through to legacy.
    }
  }

  if (assignments.length === 0) {
    const resolver = opts.legacyRoleResolver ?? defaultLegacyRoleResolver;
    try {
      const legacy = await resolver(userId, workspaceId);
      if (legacy && LEGACY_ROLE_MAP[legacy]) {
        assignments.push({
          roleKey: LEGACY_ROLE_MAP[legacy],
          scope: { type: "organization", id: workspaceId },
          workspaceId,
          source: "legacy",
        });
      }
    } catch {
      // Legacy lookup failed: no roles.
    }
  }
  return assignments;
}

// ---------------------------------------------------------------------------
// Scope coverage
// ---------------------------------------------------------------------------

/**
 * Hierarchy links needed to decide scope coverage. Resolved in bulk by
 * resolveScopeLinks(); tests construct these directly.
 */
export interface ScopeLinks {
  /** facilityId -> businessId (from facilities.business_id) */
  facilityBusiness: Map<string, string>;
  /** facilityId -> workspaceId (from facilities.workspace_id) */
  facilityWorkspace: Map<string, string>;
  /** businessId -> workspaceId (from businesses.workspace_id) */
  businessWorkspace: Map<string, string>;
  /** projectId -> linkage (from matters: business_id, workspace_id, facility_id when present) */
  projectLinks: Map<string, { businessId: string; facilityId: string | null; workspaceId: string }>;
}

export function emptyScopeLinks(): ScopeLinks {
  return {
    facilityBusiness: new Map(),
    facilityWorkspace: new Map(),
    businessWorkspace: new Map(),
    projectLinks: new Map(),
  };
}

/** Workspace id that owns the entity referenced by a target scope, if known. */
function targetWorkspaceId(target: Scope, links: ScopeLinks): string | null {
  if (!target.id) return null;
  switch (target.type) {
    case "organization":
      return target.id;
    case "business":
      return links.businessWorkspace.get(target.id) ?? null;
    case "facility":
      return links.facilityWorkspace.get(target.id) ?? null;
    case "project":
      return links.projectLinks.get(target.id)?.workspaceId ?? null;
  }
}

/**
 * True when an assignment scope covers a target scope. Coverage is
 * hierarchical: organization > business > facility > project, and always
 * tenant-bound — a scope in workspace A never covers an entity in
 * workspace B, and unknown linkage resolves to "not covered" (fail closed).
 */
export function scopeCovers(
  assignment: RoleAssignment,
  target: Scope,
  links: ScopeLinks = emptyScopeLinks()
): boolean {
  const aScope = assignment.scope;
  if (!aScope.id || !target.id) return false;

  // Tenant gate: the target entity must live in the assignment's workspace.
  const targetWs = targetWorkspaceId(target, links);
  if (targetWs !== null && targetWs !== assignment.workspaceId) return false;
  // Organization-scoped targets are compared directly (id IS the workspace).
  if (target.type === "organization" && target.id !== assignment.workspaceId) return false;

  switch (aScope.type) {
    case "organization":
      // Covers every entity inside the assignment's workspace (checked above).
      return true;
    case "business": {
      if (target.type === "business") return target.id === aScope.id;
      if (target.type === "facility") return links.facilityBusiness.get(target.id) === aScope.id;
      if (target.type === "project") return links.projectLinks.get(target.id)?.businessId === aScope.id;
      return false;
    }
    case "facility": {
      if (target.type === "facility") return target.id === aScope.id;
      if (target.type === "project") {
        const p = links.projectLinks.get(target.id);
        if (!p) return false;
        if (p.facilityId === aScope.id) return true;
        // A project explicitly linked to another facility is not covered.
        if (p.facilityId !== null) return false;
        // Projects not yet linked to any facility inherit the facility's business.
        const businessId = links.facilityBusiness.get(aScope.id);
        return businessId !== undefined && p.businessId === businessId;
      }
      return false;
    }
    case "project":
      return target.type === "project" && target.id === aScope.id;
  }
}

// Cached check for the optional matters.facility_id column (added by the
// enterprise migration; absent on older schemas).
let mattersFacilityColumn: Promise<boolean> | null = null;
function mattersHasFacilityId(pool: Queryable): Promise<boolean> {
  if (!mattersFacilityColumn) {
    mattersFacilityColumn = pool
      .query(
        `SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'matters' AND column_name = 'facility_id'
          LIMIT 1`
      )
      .then(({ rows }) => rows.length > 0)
      .catch(() => false);
  }
  return mattersFacilityColumn;
}

/** Test hook: reset the cached matters.facility_id column check. */
export function _resetMattersFacilityIdCache(): void {
  mattersFacilityColumn = null;
}

/**
 * Bulk-resolve the hierarchy links needed for scope coverage, limited to the
 * assignment scopes and target scope at hand. Missing tables/columns resolve
 * to empty maps (fail closed for anything below organization scope).
 */
export async function resolveScopeLinks(
  pool: Queryable,
  assignments: RoleAssignment[],
  target: Scope
): Promise<ScopeLinks> {
  const links = emptyScopeLinks();
  const facilityIds = new Set<string>();
  const businessIds = new Set<string>();
  const projectIds = new Set<string>();

  for (const a of assignments) {
    if (a.scope.type === "facility" && a.scope.id) facilityIds.add(a.scope.id);
    if (a.scope.type === "business" && a.scope.id) businessIds.add(a.scope.id);
  }
  if (target.type === "facility" && target.id) facilityIds.add(target.id);
  if (target.type === "business" && target.id) businessIds.add(target.id);
  if (target.type === "project" && target.id) projectIds.add(target.id);

  try {
    if (facilityIds.size > 0) {
      const { rows } = await pool.query(
        `SELECT id::text AS id, business_id::text AS business_id, workspace_id::text AS workspace_id
           FROM facilities WHERE id = ANY($1::uuid[])`,
        [[...facilityIds]]
      );
      for (const r of rows) {
        const id = String(r.id);
        if (r.business_id) links.facilityBusiness.set(id, String(r.business_id));
        if (r.workspace_id) links.facilityWorkspace.set(id, String(r.workspace_id));
      }
    }
  } catch {
    // facilities table missing: facility-level coverage stays denied below.
  }

  try {
    if (businessIds.size > 0) {
      const { rows } = await pool.query(
        `SELECT id::text AS id, workspace_id::text AS workspace_id
           FROM businesses WHERE id = ANY($1::uuid[])`,
        [[...businessIds]]
      );
      for (const r of rows) {
        if (r.workspace_id) links.businessWorkspace.set(String(r.id), String(r.workspace_id));
      }
    }
  } catch {
    // businesses lookup failed: business-level coverage stays denied below.
  }

  try {
    if (projectIds.size > 0) {
      const withFacility = await mattersHasFacilityId(pool);
      const facilitySelect = withFacility ? ", facility_id::text AS facility_id" : "";
      const { rows } = await pool.query(
        `SELECT id::text AS id, business_id::text AS business_id, workspace_id::text AS workspace_id${facilitySelect}
           FROM matters WHERE id = ANY($1::uuid[])`,
        [[...projectIds]]
      );
      for (const r of rows) {
        links.projectLinks.set(String(r.id), {
          businessId: String(r.business_id),
          facilityId: withFacility && r.facility_id ? String(r.facility_id) : null,
          workspaceId: String(r.workspace_id ?? ""),
        });
      }
    }
  } catch {
    // matters lookup failed: project coverage stays denied below.
  }

  return links;
}

// ---------------------------------------------------------------------------
// Permission checks & tenant gates
// ---------------------------------------------------------------------------

export interface PermissionCheckOptions extends RoleResolutionOptions {
  /** Pre-resolved scope links (skips DB resolution; used by tests). */
  links?: ScopeLinks;
}

/**
 * True when the user holds `permission` in the workspace for the target
 * scope. Union semantics: any covering assignment granting the permission
 * is enough. No target scope defaults to the whole organization.
 */
export async function hasPermission(
  userId: string,
  workspaceId: string,
  permission: Permission,
  scope?: Scope,
  opts: PermissionCheckOptions = {}
): Promise<boolean> {
  const target: Scope = scope ?? { type: "organization", id: workspaceId };
  const roles = await getUserEnterpriseRoles(userId, workspaceId, opts);
  if (roles.length === 0) return false;

  let links = opts.links;
  if (!links) {
    const pool = opts.pool === undefined ? getPool() : opts.pool;
    links = pool ? await resolveScopeLinks(pool, roles, target) : emptyScopeLinks();
  }

  for (const assignment of roles) {
    if (!scopeCovers(assignment, target, links)) continue;
    if (permissionsForRole(assignment.roleKey).includes(permission)) return true;
  }
  return false;
}

/**
 * Tenant gate: verifies the user is a member of the workspace. Used by every
 * enterprise route before any permission check. Fail closed on DB errors.
 */
export async function assertWorkspaceAccess(
  userId: string,
  workspaceId: string,
  pool?: Queryable | null
): Promise<boolean> {
  const p = pool === undefined ? getPool() : pool;
  if (!p) return false;
  try {
    const { rows } = await p.query(
      `SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 LIMIT 1`,
      [workspaceId, userId]
    );
    return rows.length > 0;
  } catch {
    return false;
  }
}

/** All workspace ids the user belongs to. */
export async function getUserWorkspaceIds(
  userId: string,
  pool?: Queryable | null
): Promise<string[]> {
  const p = pool === undefined ? getPool() : pool;
  if (!p) return [];
  try {
    const { rows } = await p.query(
      `SELECT workspace_id::text AS workspace_id FROM workspace_members WHERE user_id = $1`,
      [userId]
    );
    return rows.map((r) => String(r.workspace_id)).filter(Boolean);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Route-handler gate
// ---------------------------------------------------------------------------

/**
 * Enterprise permission gate for Next.js route handlers. Returns
 * `{ user, workspaceId }` on success or `{ response }` (401/403 Response)
 * on failure — the same shape as requireSuperAdmin in api/admin/_util.ts.
 *
 * Usage:
 *   const gate = await requireEnterprisePermission("upload_evidence", workspaceId,
 *     { type: "project", id: matterId });
 *   if ("response" in gate) return gate.response;
 *   const { user } = gate;
 */
export async function requireEnterprisePermission(
  permission: Permission,
  workspaceId: string,
  scope?: Scope,
  opts: PermissionCheckOptions = {}
): Promise<
  { user: { id: string; email?: string | null }; workspaceId: string } | { response: Response }
> {
  let user: { id: string; email?: string | null } | null = null;
  try {
    const { getCurrentUser } = await import("./supabase/server");
    user = await getCurrentUser();
  } catch {
    user = null;
  }
  if (!user) {
    return { response: Response.json({ error: "unauthorized" }, { status: 401 }) };
  }
  let allowed = false;
  try {
    allowed =
      (await assertWorkspaceAccess(user.id, workspaceId, opts.pool)) &&
      (await hasPermission(user.id, workspaceId, permission, scope, opts));
  } catch {
    allowed = false;
  }
  if (!allowed) {
    return {
      response: Response.json({ error: "forbidden", permission }, { status: 403 }),
    };
  }
  return { user, workspaceId };
}

// ---------------------------------------------------------------------------
// Audit events
// ---------------------------------------------------------------------------

export interface AuditEventInput {
  actorUserId?: string | null;
  workspaceId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  /** Sanitized before insert (secrets stripped). */
  before?: unknown;
  /** Sanitized before insert (secrets stripped). */
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
  correlationId?: string | null;
  source?: string | null;
  reason?: string | null;
}

const SECRET_KEY_PATTERN = /password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|private[_-]?key|client[_-]?secret|ssn|social[_-]?security/i;

/** Deep-strip secret-looking keys from audit payloads. Never log secrets. */
export function sanitizeForAudit(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeForAudit);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY_PATTERN.test(k) ? "[redacted]" : sanitizeForAudit(v);
    }
    return out;
  }
  return value;
}

/**
 * Insert a full-envelope audit event. Best-effort: never throws — a failed
 * audit write must not break the request it describes.
 */
export async function writeAuditEvent(
  pool: Queryable | null,
  event: AuditEventInput
): Promise<void> {
  if (!pool) return;
  try {
    await pool.query(
      `INSERT INTO audit_events
         (actor_user_id, workspace_id, action, target_type, target_id,
          "before", "after", ip, user_agent, correlation_id, source, reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        event.actorUserId ?? null,
        event.workspaceId ?? null,
        event.action,
        event.targetType ?? null,
        event.targetId ?? null,
        JSON.stringify(sanitizeForAudit(event.before ?? null)),
        JSON.stringify(sanitizeForAudit(event.after ?? null)),
        event.ip ?? null,
        event.userAgent ?? null,
        event.correlationId ?? null,
        event.source ?? null,
        event.reason ?? null,
      ]
    );
  } catch (e) {
    console.error("[enterprise-audit] failed:", (e as Error).message);
  }
}

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
  correlationId: string;
}

/**
 * Extract request metadata for audit events. Accepts anything with a
 * Headers-like `.headers.get()`.
 */
export function getRequestMeta(req: {
  headers: { get: (name: string) => string | null };
}): RequestMeta {
  const forwarded = req.headers.get("x-forwarded-for");
  const ip = forwarded ? forwarded.split(",")[0].trim() : req.headers.get("x-real-ip");
  return {
    ip: ip || null,
    userAgent: req.headers.get("user-agent"),
    correlationId: req.headers.get("x-correlation-id") || randomUUID(),
  };
}
