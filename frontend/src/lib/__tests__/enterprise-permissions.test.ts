// Unit tests for the enterprise permissions core (role matrix, legacy
// mapping, scope coverage). Run with:
//   npx tsx --test src/lib/__tests__/enterprise-permissions.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  ENTERPRISE_ROLES,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  LEGACY_ROLE_MAP,
  isRoleKey,
  isPermission,
  permissionsForRole,
  scopeCovers,
  emptyScopeLinks,
  sanitizeForAudit,
  getRequestMeta,
  getUserEnterpriseRoles,
  hasPermission,
  type RoleAssignment,
  type ScopeLinks,
} from "../enterprise-permissions";

// ---------------------------------------------------------------------------
// Role matrix
// ---------------------------------------------------------------------------

test("exactly 10 system roles and 13 permissions are defined", () => {
  assert.equal(ENTERPRISE_ROLES.length, 10);
  assert.equal(PERMISSIONS.length, 13);
  const keys = ENTERPRISE_ROLES.map((r) => r.key);
  assert.deepEqual(
    [...keys].sort(),
    [
      "auditor",
      "billing_admin",
      "compliance_executive",
      "compliance_manager",
      "contributor",
      "evidence_reviewer",
      "external_counsel",
      "facility_manager",
      "org_admin",
      "org_owner",
    ].sort()
  );
});

test("org_owner and org_admin hold every permission", () => {
  for (const role of ["org_owner", "org_admin"] as const) {
    assert.deepEqual([...permissionsForRole(role)].sort(), [...PERMISSIONS].sort(), role);
  }
});

test("contributor cannot approve evidence or manage users", () => {
  const perms = permissionsForRole("contributor");
  assert.ok(perms.includes("view_records"));
  assert.ok(perms.includes("edit_project_facts"));
  assert.ok(perms.includes("upload_evidence"));
  assert.ok(!perms.includes("approve_evidence"));
  assert.ok(!perms.includes("manage_users"));
  assert.ok(!perms.includes("review_evidence"));
});

test("auditor is read-only: records + audit logs only", () => {
  assert.deepEqual(permissionsForRole("auditor").sort(), ["view_audit_logs", "view_records"]);
  assert.ok(!permissionsForRole("auditor").includes("export_data"));
  assert.ok(!permissionsForRole("auditor").includes("edit_project_facts"));
});

test("external_counsel cannot manage users, review, or approve", () => {
  const perms = permissionsForRole("external_counsel");
  assert.ok(perms.includes("view_records"));
  assert.ok(perms.includes("upload_evidence"));
  assert.ok(!perms.includes("manage_users"));
  assert.ok(!perms.includes("review_evidence"));
  assert.ok(!perms.includes("approve_evidence"));
  assert.ok(!perms.includes("assign_requirements"));
});

test("evidence_reviewer can review but not approve or edit", () => {
  const perms = permissionsForRole("evidence_reviewer");
  assert.ok(perms.includes("review_evidence"));
  assert.ok(!perms.includes("approve_evidence"));
  assert.ok(!perms.includes("edit_project_facts"));
  assert.ok(!perms.includes("upload_evidence"));
});

test("facility_manager gets review but not approve or user management", () => {
  const perms = permissionsForRole("facility_manager");
  assert.ok(perms.includes("review_evidence"));
  assert.ok(perms.includes("assign_requirements"));
  assert.ok(!perms.includes("approve_evidence"));
  assert.ok(!perms.includes("manage_users"));
  assert.ok(!perms.includes("manage_integrations"));
});

test("compliance_executive oversees without approving evidence", () => {
  const perms = permissionsForRole("compliance_executive");
  assert.ok(perms.includes("assign_requirements"));
  assert.ok(perms.includes("export_data"));
  assert.ok(perms.includes("view_audit_logs"));
  assert.ok(!perms.includes("approve_evidence"));
  assert.ok(!perms.includes("upload_evidence"));
});

test("compliance_manager has the full operational set", () => {
  const perms = permissionsForRole("compliance_manager");
  for (const p of [
    "view_records",
    "edit_project_facts",
    "assign_requirements",
    "upload_evidence",
    "review_evidence",
    "approve_evidence",
    "export_data",
    "view_audit_logs",
  ] as const) {
    assert.ok(perms.includes(p), p);
  }
  assert.ok(!perms.includes("manage_users"));
});

test("billing_admin sees billing and records, nothing operational", () => {
  const perms = permissionsForRole("billing_admin");
  assert.ok(perms.includes("view_billing"));
  assert.ok(perms.includes("view_records"));
  assert.ok(!perms.includes("upload_evidence"));
  assert.ok(!perms.includes("manage_users"));
  assert.ok(!perms.includes("export_data"));
});

test("every role key in the matrix is a known role and grants at least view_records", () => {
  for (const role of ENTERPRISE_ROLES) {
    assert.ok(isRoleKey(role.key), role.key);
    assert.ok(ROLE_PERMISSIONS[role.key].length > 0, role.key);
    assert.ok(ROLE_PERMISSIONS[role.key].includes("view_records"), role.key);
  }
});

test("isPermission rejects unknown permissions", () => {
  assert.ok(isPermission("view_records"));
  assert.ok(!isPermission("delete_everything"));
  assert.ok(!isPermission(undefined));
});

// ---------------------------------------------------------------------------
// Legacy mapping
// ---------------------------------------------------------------------------

test("legacy workspace roles map to enterprise roles", () => {
  assert.equal(LEGACY_ROLE_MAP.OWNER, "org_owner");
  assert.equal(LEGACY_ROLE_MAP.ADMIN, "org_admin");
  assert.equal(LEGACY_ROLE_MAP.MEMBER, "contributor");
  assert.equal(LEGACY_ROLE_MAP.VIEWER, "auditor");
});

test("getUserEnterpriseRoles falls back to legacy mapping when enterprise tables are missing", async () => {
  const throwingPool = {
    query: async () => {
      throw new Error('relation "role_assignments" does not exist');
    },
  };
  const roles = await getUserEnterpriseRoles("u1", "ws1", {
    pool: throwingPool,
    legacyRoleResolver: async () => "MEMBER",
  });
  assert.equal(roles.length, 1);
  assert.equal(roles[0].roleKey, "contributor");
  assert.deepEqual(roles[0].scope, { type: "organization", id: "ws1" });
  assert.equal(roles[0].workspaceId, "ws1");
  assert.equal(roles[0].source, "legacy");
});

test("getUserEnterpriseRoles returns no roles for non-members", async () => {
  const throwingPool = {
    query: async () => {
      throw new Error('relation "role_assignments" does not exist');
    },
  };
  const roles = await getUserEnterpriseRoles("stranger", "ws1", {
    pool: throwingPool,
    legacyRoleResolver: async () => null,
  });
  assert.deepEqual(roles, []);
});

test("legacy VIEWER falls back to read-only auditor", async () => {
  const throwingPool = {
    query: async () => {
      throw new Error('relation "role_assignments" does not exist');
    },
  };
  const ok = await hasPermission("u2", "ws1", "view_records", undefined, {
    pool: throwingPool,
    legacyRoleResolver: async () => "VIEWER",
  });
  assert.equal(ok, true);
  const denied = await hasPermission("u2", "ws1", "upload_evidence", undefined, {
    pool: throwingPool,
    legacyRoleResolver: async () => "VIEWER",
  });
  assert.equal(denied, false);
});

// ---------------------------------------------------------------------------
// Scope coverage (pure helper)
// ---------------------------------------------------------------------------

function orgAssignment(ws: string, roleKey: RoleAssignment["roleKey"] = "contributor"): RoleAssignment {
  return { roleKey, scope: { type: "organization", id: ws }, workspaceId: ws, source: "legacy" };
}

function linksFor(overrides: Partial<ScopeLinks> = {}): ScopeLinks {
  return { ...emptyScopeLinks(), ...overrides };
}

test("organization scope covers every entity in its workspace", () => {
  const a = orgAssignment("ws1");
  const links = linksFor({
    facilityBusiness: new Map([["f1", "b1"]]),
    facilityWorkspace: new Map([["f1", "ws1"]]),
    businessWorkspace: new Map([["b1", "ws1"]]),
    projectLinks: new Map([["p1", { businessId: "b1", facilityId: "f1", workspaceId: "ws1" }]]),
  });
  assert.equal(scopeCovers(a, { type: "business", id: "b1" }, links), true);
  assert.equal(scopeCovers(a, { type: "facility", id: "f1" }, links), true);
  assert.equal(scopeCovers(a, { type: "project", id: "p1" }, links), true);
  assert.equal(scopeCovers(a, { type: "organization", id: "ws1" }, links), true);
});

test("organization scope never covers another workspace", () => {
  const a = orgAssignment("ws1");
  const links = linksFor({
    businessWorkspace: new Map([["b9", "ws2"]]),
    facilityWorkspace: new Map([["f9", "ws2"]]),
    projectLinks: new Map([["p9", { businessId: "b9", facilityId: null, workspaceId: "ws2" }]]),
  });
  assert.equal(scopeCovers(a, { type: "organization", id: "ws2" }, links), false);
  assert.equal(scopeCovers(a, { type: "business", id: "b9" }, links), false);
  assert.equal(scopeCovers(a, { type: "facility", id: "f9" }, links), false);
  assert.equal(scopeCovers(a, { type: "project", id: "p9" }, links), false);
});

test("business scope covers its facilities and projects only", () => {
  const a: RoleAssignment = {
    roleKey: "facility_manager",
    scope: { type: "business", id: "b1" },
    workspaceId: "ws1",
    source: "enterprise",
  };
  const links = linksFor({
    facilityBusiness: new Map([["f1", "b1"], ["f2", "b2"]]),
    facilityWorkspace: new Map([["f1", "ws1"], ["f2", "ws1"]]),
    businessWorkspace: new Map([["b1", "ws1"], ["b2", "ws1"]]),
    projectLinks: new Map([
      ["p1", { businessId: "b1", facilityId: "f1", workspaceId: "ws1" }],
      ["p2", { businessId: "b2", facilityId: "f2", workspaceId: "ws1" }],
    ]),
  });
  assert.equal(scopeCovers(a, { type: "business", id: "b1" }, links), true);
  assert.equal(scopeCovers(a, { type: "business", id: "b2" }, links), false);
  assert.equal(scopeCovers(a, { type: "facility", id: "f1" }, links), true);
  assert.equal(scopeCovers(a, { type: "facility", id: "f2" }, links), false);
  assert.equal(scopeCovers(a, { type: "project", id: "p1" }, links), true);
  assert.equal(scopeCovers(a, { type: "project", id: "p2" }, links), false);
});

test("facility scope covers its projects via direct link and via business fallback", () => {
  const a: RoleAssignment = {
    roleKey: "facility_manager",
    scope: { type: "facility", id: "f1" },
    workspaceId: "ws1",
    source: "enterprise",
  };
  const links = linksFor({
    facilityBusiness: new Map([["f1", "b1"]]),
    facilityWorkspace: new Map([["f1", "ws1"], ["f2", "ws1"]]),
    projectLinks: new Map([
      ["pDirect", { businessId: "b1", facilityId: "f1", workspaceId: "ws1" }],
      ["pViaBusiness", { businessId: "b1", facilityId: null, workspaceId: "ws1" }],
      ["pOther", { businessId: "b1", facilityId: "f2", workspaceId: "ws1" }],
    ]),
  });
  assert.equal(scopeCovers(a, { type: "facility", id: "f1" }, links), true);
  assert.equal(scopeCovers(a, { type: "facility", id: "f2" }, links), false);
  assert.equal(scopeCovers(a, { type: "project", id: "pDirect" }, links), true);
  assert.equal(scopeCovers(a, { type: "project", id: "pViaBusiness" }, links), true);
  assert.equal(scopeCovers(a, { type: "project", id: "pOther" }, links), false);
});

test("project scope covers only itself", () => {
  const a: RoleAssignment = {
    roleKey: "contributor",
    scope: { type: "project", id: "p1" },
    workspaceId: "ws1",
    source: "enterprise",
  };
  const links = linksFor({
    projectLinks: new Map([
      ["p1", { businessId: "b1", facilityId: "f1", workspaceId: "ws1" }],
      ["p2", { businessId: "b1", facilityId: "f1", workspaceId: "ws1" }],
    ]),
  });
  assert.equal(scopeCovers(a, { type: "project", id: "p1" }, links), true);
  assert.equal(scopeCovers(a, { type: "project", id: "p2" }, links), false);
  assert.equal(scopeCovers(a, { type: "business", id: "b1" }, links), false);
});

test("missing ids fail closed", () => {
  const a = orgAssignment("ws1");
  assert.equal(scopeCovers({ ...a, scope: { type: "organization" } }, { type: "business", id: "b1" }), false);
  assert.equal(scopeCovers(a, { type: "business" }), false);
});

// ---------------------------------------------------------------------------
// Audit helpers
// ---------------------------------------------------------------------------

test("sanitizeForAudit redacts secret-looking keys at any depth", () => {
  const out = sanitizeForAudit({
    action: "user.invited",
    password: "hunter2",
    nested: { api_key: "abc", ok: 1 },
    list: [{ client_secret: "x" }],
  }) as Record<string, unknown>;
  assert.equal(out.password, "[redacted]");
  assert.equal((out.nested as Record<string, unknown>).api_key, "[redacted]");
  assert.equal((out.nested as Record<string, unknown>).ok, 1);
  assert.equal(((out.list as unknown[])[0] as Record<string, unknown>).client_secret, "[redacted]");
  assert.equal(out.action, "user.invited");
});

test("getRequestMeta extracts ip, user-agent and correlation id", () => {
  const headers = new Map([
    ["x-forwarded-for", "203.0.113.7, 70.41.3.18"],
    ["user-agent", "test-agent/1.0"],
    ["x-correlation-id", "corr-123"],
  ]);
  const meta = getRequestMeta({ headers: { get: (n: string) => headers.get(n) ?? null } });
  assert.equal(meta.ip, "203.0.113.7");
  assert.equal(meta.userAgent, "test-agent/1.0");
  assert.equal(meta.correlationId, "corr-123");
});

test("getRequestMeta generates a correlation id when absent", () => {
  const meta = getRequestMeta({ headers: { get: () => null } });
  assert.equal(meta.ip, null);
  assert.ok(typeof meta.correlationId === "string" && meta.correlationId.length > 0);
});
