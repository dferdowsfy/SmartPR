// Tenant-isolation tests for the enterprise permissions core: a role scoped
// to one facility / business / workspace must not leak into another.
// Run with:
//   npx tsx --test src/lib/__tests__/tenant-isolation.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  hasPermission,
  assertWorkspaceAccess,
  getUserWorkspaceIds,
  scopeCovers,
  emptyScopeLinks,
  type Queryable,
  type RoleAssignment,
} from "../enterprise-permissions";

// ---------------------------------------------------------------------------
// Fake DB
// ---------------------------------------------------------------------------

interface EntRow {
  role_key: string;
  scope_type: string;
  scope_id: string | null;
}

interface Scenario {
  /** workspaceId -> userIds */
  members: Record<string, string[]>;
  /** userId -> workspaceId -> enterprise rows */
  assignments: Record<string, Record<string, EntRow[]>>;
  /** facilityId -> { businessId, workspaceId } */
  facilities: Record<string, { businessId: string; workspaceId: string }>;
  /** businessId -> workspaceId */
  businesses: Record<string, string>;
  /** projectId -> { businessId, facilityId, workspaceId } */
  projects: Record<string, { businessId: string; facilityId: string | null; workspaceId: string }>;
}

function fakePool(s: Scenario): Queryable {
  return {
    query: async (text: string, params: unknown[] = []) => {
      if (text.includes("FROM role_assignments")) {
        const [userId, workspaceId] = params as string[];
        const rows = s.assignments[userId]?.[workspaceId] ?? [];
        return { rows: rows as unknown as Record<string, unknown>[] };
      }
      if (text.includes("information_schema")) {
        return { rows: [{ "?column?": 1 }] as unknown as Record<string, unknown>[] };
      }
      if (text.includes("FROM facilities")) {
        const ids = (params[0] as string[]) ?? [];
        return {
          rows: ids
            .filter((id) => s.facilities[id])
            .map((id) => ({
              id,
              business_id: s.facilities[id].businessId,
              workspace_id: s.facilities[id].workspaceId,
            })) as unknown as Record<string, unknown>[],
        };
      }
      if (text.includes("FROM businesses")) {
        const ids = (params[0] as string[]) ?? [];
        return {
          rows: ids
            .filter((id) => s.businesses[id])
            .map((id) => ({ id, workspace_id: s.businesses[id] })) as unknown as Record<
              string,
              unknown
            >[],
        };
      }
      if (text.includes("FROM matters")) {
        const ids = (params[0] as string[]) ?? [];
        return {
          rows: ids
            .filter((id) => s.projects[id])
            .map((id) => ({
              id,
              business_id: s.projects[id].businessId,
              workspace_id: s.projects[id].workspaceId,
              facility_id: s.projects[id].facilityId,
            })) as unknown as Record<string, unknown>[],
        };
      }
      if (text.includes("FROM workspace_members")) {
        if (text.includes("workspace_id = $1 AND user_id = $2")) {
          const [workspaceId, userId] = params as string[];
          const member = (s.members[workspaceId] ?? []).includes(userId);
          return { rows: (member ? [{ "1": 1 }] : []) as unknown as Record<string, unknown>[] };
        }
        if (text.includes("user_id = $1")) {
          const [userId] = params as string[];
          const rows = Object.entries(s.members)
            .filter(([, users]) => users.includes(userId))
            .map(([workspace_id]) => ({ workspace_id }));
          return { rows: rows as unknown as Record<string, unknown>[] };
        }
      }
      throw new Error(`unexpected query in test double: ${text.slice(0, 80)}`);
    },
  };
}

// ---------------------------------------------------------------------------
// Scenario: two workspaces, two facilities, two projects
// ---------------------------------------------------------------------------

const WS_A = "ws-org-a";
const WS_B = "ws-org-b";
const U_FACILITY_MGR = "u-facility-mgr"; // org A member, facility_manager scoped to facility FA
const U_ORG_ADMIN_A = "u-org-admin-a"; // org A member, legacy ADMIN -> org_admin
const U_STRANGER = "u-stranger"; // member of neither workspace

const FA = "fac-a";
const FB = "fac-b";
const BA = "biz-a";
const BB = "biz-b";
const PA = "proj-a"; // matter in facility FA (business BA)
const PB = "proj-b"; // matter in facility FB (business BB)

const scenario: Scenario = {
  members: {
    [WS_A]: [U_FACILITY_MGR, U_ORG_ADMIN_A],
    [WS_B]: [],
  },
  assignments: {
    [U_FACILITY_MGR]: {
      [WS_A]: [{ role_key: "facility_manager", scope_type: "facility", scope_id: FA }],
    },
  },
  facilities: {
    [FA]: { businessId: BA, workspaceId: WS_A },
    [FB]: { businessId: BB, workspaceId: WS_A },
  },
  businesses: {
    [BA]: WS_A,
    [BB]: WS_A,
  },
  projects: {
    [PA]: { businessId: BA, facilityId: FA, workspaceId: WS_A },
    [PB]: { businessId: BB, facilityId: FB, workspaceId: WS_A },
  },
};

const legacyAdmin = async (userId: string, workspaceId: string) =>
  userId === U_ORG_ADMIN_A && workspaceId === WS_A ? ("ADMIN" as const) : null;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("facility_manager scoped to facility A acts on facility A only", async () => {
  const pool = fakePool(scenario);
  const opts = { pool, legacyRoleResolver: legacyAdmin };

  assert.equal(
    await hasPermission(U_FACILITY_MGR, WS_A, "upload_evidence", { type: "project", id: PA }, opts),
    true
  );
  assert.equal(
    await hasPermission(U_FACILITY_MGR, WS_A, "upload_evidence", { type: "project", id: PB }, opts),
    false
  );
  assert.equal(
    await hasPermission(U_FACILITY_MGR, WS_A, "view_records", { type: "facility", id: FA }, opts),
    true
  );
  assert.equal(
    await hasPermission(U_FACILITY_MGR, WS_A, "view_records", { type: "facility", id: FB }, opts),
    false
  );
});

test("facility_manager cannot approve evidence even inside their own facility", async () => {
  const pool = fakePool(scenario);
  const opts = { pool, legacyRoleResolver: legacyAdmin };
  assert.equal(
    await hasPermission(U_FACILITY_MGR, WS_A, "approve_evidence", { type: "project", id: PA }, opts),
    false
  );
});

test("org A's user has no access to org B's workspace", async () => {
  const pool = fakePool(scenario);
  const opts = { pool, legacyRoleResolver: legacyAdmin };

  // Permission check in the foreign workspace fails.
  assert.equal(await hasPermission(U_FACILITY_MGR, WS_B, "view_records", undefined, opts), false);
  assert.equal(await hasPermission(U_ORG_ADMIN_A, WS_B, "view_records", undefined, opts), false);

  // Tenant gate fails for non-members.
  assert.equal(await assertWorkspaceAccess(U_FACILITY_MGR, WS_B, pool), false);
  assert.equal(await assertWorkspaceAccess(U_STRANGER, WS_A, pool), false);

  // And passes for members.
  assert.equal(await assertWorkspaceAccess(U_FACILITY_MGR, WS_A, pool), true);
});

test("legacy org_admin in org A keeps full access inside org A", async () => {
  const pool = fakePool(scenario);
  const opts = { pool, legacyRoleResolver: legacyAdmin };
  assert.equal(
    await hasPermission(U_ORG_ADMIN_A, WS_A, "manage_users", { type: "organization", id: WS_A }, opts),
    true
  );
  assert.equal(
    await hasPermission(U_ORG_ADMIN_A, WS_A, "approve_evidence", { type: "project", id: PB }, opts),
    true
  );
});

test("stranger with no roles is denied everywhere", async () => {
  const pool = fakePool(scenario);
  const opts = { pool, legacyRoleResolver: legacyAdmin };
  for (const scope of [
    undefined,
    { type: "project", id: PA },
    { type: "facility", id: FA },
    { type: "business", id: BA },
  ] as const) {
    assert.equal(await hasPermission(U_STRANGER, WS_A, "view_records", scope, opts), false);
  }
});

test("getUserWorkspaceIds returns exactly the user's workspaces", async () => {
  const pool = fakePool(scenario);
  assert.deepEqual(await getUserWorkspaceIds(U_FACILITY_MGR, pool), [WS_A]);
  assert.deepEqual(await getUserWorkspaceIds(U_STRANGER, pool), []);
});

test("cross-facility scope coverage denied at the helper level", () => {
  const assignment: RoleAssignment = {
    roleKey: "facility_manager",
    scope: { type: "facility", id: FA },
    workspaceId: WS_A,
    source: "enterprise",
  };
  const links = emptyScopeLinks();
  links.facilityBusiness.set(FA, BA);
  links.facilityBusiness.set(FB, BB);
  links.facilityWorkspace.set(FA, WS_A);
  links.facilityWorkspace.set(FB, WS_A);
  links.projectLinks.set(PA, { businessId: BA, facilityId: FA, workspaceId: WS_A });
  links.projectLinks.set(PB, { businessId: BB, facilityId: FB, workspaceId: WS_A });

  assert.equal(scopeCovers(assignment, { type: "project", id: PA }, links), true);
  assert.equal(scopeCovers(assignment, { type: "project", id: PB }, links), false);
  assert.equal(scopeCovers(assignment, { type: "facility", id: FB }, links), false);
});

test("same facility id in another workspace is not covered", () => {
  const assignment: RoleAssignment = {
    roleKey: "facility_manager",
    scope: { type: "facility", id: FA },
    workspaceId: WS_A,
    source: "enterprise",
  };
  const links = emptyScopeLinks();
  links.facilityBusiness.set(FA, BA);
  // The entity the id points to lives in workspace B (id collision / moved entity).
  links.facilityWorkspace.set(FA, WS_B);
  assert.equal(scopeCovers(assignment, { type: "facility", id: FA }, links), false);
});

test("DB failure fails closed: no pool, no access", async () => {
  assert.equal(await assertWorkspaceAccess("u", "w", null), false);
  assert.deepEqual(await getUserWorkspaceIds("u", null), []);
});
