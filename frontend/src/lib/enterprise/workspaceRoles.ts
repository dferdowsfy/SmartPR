// ============================================================================
// Enterprise workspace helpers — Phase 7.
//
// Server-side only. System-role seeding for workspaces, scope-existence
// validation for role assignments, legacy-role mapping for invites, and the
// superadmin contract-entitlements layer (workspace_subscriptions.entitlements
// jsonb) with the server-side enforcement gates used by the enterprise admin
// routes.
//
// Contract entitlements are per-company overrides set by superadmins. A null
// (or missing) key means "fall back to the plan catalog" — null is never a
// zero or false, so an unset limit can never accidentally lock a company out.
// ============================================================================

import { getPool } from "../../app/graph/db";
import {
  ENTERPRISE_ROLES,
  ROLE_PERMISSIONS,
  isRoleKey,
  type RoleKey,
  type ScopeType,
  type Queryable,
} from "../enterprise-permissions";
import type { WorkspaceRole } from "../admin";
import type { Db } from "../billing/access";

export interface ContractEntitlements {
  contract_start?: string | null;
  contract_renewal?: string | null;
  billing_contact?: string | null;
  smartpr_owner?: string | null;
  max_seats?: number | null;
  max_businesses?: number | null;
  max_facilities?: number | null;
  max_projects?: number | null;
  storage_limit_bytes?: number | null;
  api_access?: boolean | null;
  sso?: boolean | null;
  scim?: boolean | null;
  white_labeling?: boolean | null;
  custom_domain?: boolean | null;
  advanced_reporting?: boolean | null;
  regulatory_alerts?: boolean | null;
  data_retention_days?: number | null;
  support_tier?: string | null;
}

export const CONTRACT_LIMIT_KEYS = [
  "max_seats",
  "max_businesses",
  "max_facilities",
  "max_projects",
  "storage_limit_bytes",
  "data_retention_days",
] as const;

export const CONTRACT_TOGGLE_KEYS = [
  "api_access",
  "sso",
  "scim",
  "white_labeling",
  "custom_domain",
  "advanced_reporting",
  "regulatory_alerts",
] as const;

/** Enterprise role key -> legacy workspace_members role (used on the invite row). */
export function legacyRoleForEnterpriseKey(key: string): WorkspaceRole {
  switch (key) {
    case "org_owner":
      return "OWNER";
    case "org_admin":
      return "ADMIN";
    case "auditor":
      return "VIEWER";
    default:
      return "MEMBER";
  }
}

/**
 * Idempotently seed the 10 system enterprise_roles for a workspace
 * (is_system=true). Returns a map of role key -> role id. Safe to call on
 * every role/invite write path; concurrent callers are protected by the
 * unique(workspace_id, key) constraint (ON CONFLICT DO NOTHING).
 */
export async function ensureSystemRoles(
  pool: Queryable,
  workspaceId: string
): Promise<Map<string, string>> {
  const existing = await pool.query(
    `SELECT key, id::text AS id FROM enterprise_roles WHERE workspace_id = $1`,
    [workspaceId]
  );
  const map = new Map<string, string>(
    existing.rows.map((r) => [String(r.key), String(r.id)])
  );
  const missing = ENTERPRISE_ROLES.filter((r) => !map.has(r.key));
  if (missing.length > 0) {
    for (const r of missing) {
      const perms = ROLE_PERMISSIONS[r.key as RoleKey] ?? [];
      const inserted = await pool.query(
        `INSERT INTO enterprise_roles (workspace_id, key, label, permissions, is_system)
         VALUES ($1,$2,$3,$4,true)
         ON CONFLICT (workspace_id, key) DO UPDATE SET label = EXCLUDED.label
         RETURNING id::text AS id`,
        [workspaceId, r.key, r.label, JSON.stringify(perms)]
      );
      if (inserted.rows[0]) map.set(r.key, String(inserted.rows[0].id));
    }
  }
  return map;
}

/**
 * Validate that a scope target exists and belongs to the workspace.
 * Organization scope requires no scope_id (defaults to the workspace).
 * Returns the normalized scope_id (uuid string) or throws.
 */
export async function validateScope(
  pool: Queryable,
  workspaceId: string,
  scopeType: string,
  scopeId?: string | null
): Promise<string | null> {
  const type: ScopeType =
    scopeType === "business" || scopeType === "facility" || scopeType === "project"
      ? scopeType
      : "organization";
  if (type === "organization") {
    if (scopeId && scopeId !== workspaceId) {
      throw new Error("organization scope_id must be the workspace id");
    }
    return workspaceId;
  }
  if (!scopeId) throw new Error(`${type} scope requires a scope_id`);
  const table = type === "business" ? "businesses" : type === "facility" ? "facilities" : "matters";
  const { rows } = await pool.query(
    `SELECT 1 FROM ${table} WHERE id = $1 AND workspace_id = $2 LIMIT 1`,
    [scopeId, workspaceId]
  );
  if (!rows[0]) throw new Error(`${type} ${scopeId} not found in this workspace`);
  return scopeId;
}

/** Read the raw contract-entitlements jsonb for a workspace ({} when unset). */
export async function getContractEntitlements(
  pool: Queryable,
  workspaceId: string
): Promise<ContractEntitlements> {
  try {
    const { rows } = await pool.query(
      `SELECT entitlements FROM workspace_subscriptions WHERE workspace_id = $1 LIMIT 1`,
      [workspaceId]
    );
    const raw = (rows[0] as { entitlements: unknown } | undefined)?.entitlements;
    if (raw && typeof raw === "object") return raw as ContractEntitlements;
  } catch {
    // Column missing on older schemas: no contract overrides.
  }
  return {};
}

function isNonNegInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

/**
 * Validate + sanitize a contract-entitlements payload for storage.
 * Unknown keys are dropped; mistyped keys are dropped (fail closed — a
 * mistyped limit must never become an accidental zero/false override).
 */
export function sanitizeContractEntitlements(input: unknown): ContractEntitlements {
  const out: ContractEntitlements = {};
  if (!input || typeof input !== "object") return out;
  const rec = input as Record<string, unknown>;
  for (const k of ["contract_start", "contract_renewal", "billing_contact", "smartpr_owner", "support_tier"] as const) {
    if (typeof rec[k] === "string" && rec[k].trim()) out[k] = rec[k].trim().slice(0, 200);
  }
  for (const k of CONTRACT_LIMIT_KEYS) {
    if (rec[k] === null || rec[k] === undefined || rec[k] === "") continue;
    const n = Number(rec[k]);
    if (isNonNegInt(n)) (out as Record<string, number>)[k] = n;
  }
  for (const k of CONTRACT_TOGGLE_KEYS) {
    if (typeof rec[k] === "boolean") (out as Record<string, boolean>)[k] = rec[k];
  }
  return out;
}

/** Persist contract entitlements (merge over existing keys). Returns the merged object. */
export async function setContractEntitlements(
  workspaceId: string,
  patch: ContractEntitlements
): Promise<ContractEntitlements> {
  const pool = getPool();
  if (!pool) throw new Error("no_database");
  const current = await getContractEntitlements(pool, workspaceId);
  const merged = { ...current, ...sanitizeContractEntitlements(patch) };
  await pool.query(
    `INSERT INTO workspace_subscriptions (workspace_id, plan, entitlements)
     VALUES ($1, 'enterprise', $2)
     ON CONFLICT (workspace_id) DO UPDATE SET entitlements = $2, updated_at = now()`,
    [workspaceId, JSON.stringify(merged)]
  );
  return merged;
}

/** Seat usage = members + outstanding (unaccepted, unexpired) invites. */
export async function countSeatUsage(pool: Queryable, workspaceId: string): Promise<number> {
  const { rows } = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM workspace_members WHERE workspace_id = $1)::int AS members,
       (SELECT COUNT(*) FROM workspace_invites
         WHERE workspace_id = $1 AND accepted_at IS NULL AND expires_at > now())::int AS invites`,
    [workspaceId]
  );
  return Number(rows[0]?.members || 0) + Number(rows[0]?.invites || 0);
}

/**
 * Contract seat-limit gate for invites. When the superadmin-set
 * entitlements.max_seats is present, it wins; otherwise falls back to the
 * plan-catalog seat gate in lib/billing/access. Throws PlanGateError (402)
 * when the limit is reached — route handlers convert with gateJson().
 */
export async function assertContractSeatAvailable(
  pool: Queryable,
  workspaceId: string,
  email?: string | null
): Promise<void> {
  const contract = await getContractEntitlements(pool, workspaceId);
  if (contract.max_seats != null) {
    const used = await countSeatUsage(pool, workspaceId);
    if (used >= contract.max_seats) {
      const { PlanGateError } = await import("../billing/access");
      throw new PlanGateError(
        "contract_seat_limit",
        `This company's contract allows ${contract.max_seats} seat(s); ${used} are in use.`
      );
    }
    return;
  }
  const { assertCanInviteSeat } = await import("../billing/access");
  await assertCanInviteSeat(pool as Db, { workspaceId, email });
}

/**
 * Contract business-limit gate. Same precedence: contract override wins,
 * otherwise the plan-catalog gate. Throws PlanGateError (402) when reached.
 */
export async function assertContractBusinessAvailable(
  pool: Queryable,
  workspaceId: string,
  email?: string | null,
  adding = 1
): Promise<void> {
  const contract = await getContractEntitlements(pool, workspaceId);
  if (contract.max_businesses != null) {
    const { countWorkspaceBusinesses } = await import("../billing/access");
    const current = await countWorkspaceBusinesses(pool as Db, workspaceId);
    if (current + adding > contract.max_businesses) {
      const { PlanGateError } = await import("../billing/access");
      throw new PlanGateError(
        "contract_business_limit",
        `This company's contract allows ${contract.max_businesses} business(es); ${current} exist.`
      );
    }
    return;
  }
  const { assertCanAddBusinesses } = await import("../billing/access");
  await assertCanAddBusinesses(pool as Db, { workspaceId, email, adding });
}

/** Validate an enterprise role key against the 10 system keys. */
export function assertRoleKey(key: unknown): RoleKey {
  if (!isRoleKey(key)) throw new Error("invalid enterprise role key");
  return key;
}
