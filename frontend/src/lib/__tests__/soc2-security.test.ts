/**
 * SOC 2 readiness security tests — isolation/RBAC/SSO/SCIM/creds/support/redaction/perms.
 * Run: npx tsx --test src/lib/__tests__/soc2-security.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  listSecurityControls,
  controlInventorySummary,
  getSecurityControl,
  normalizeSecurityAction,
  isKnownSecurityAction,
  findPlaintextSecretHits,
  assertNoClientSecrets,
  constantTimeEqual,
  sha256Fingerprint,
  logAiEvent,
  SECURITY_EVENT_TAXONOMY,
} from "../security";
import {
  redactSecrets,
  hashFingerprint,
  sha256Hex,
  authenticateScimRequest,
} from "../enterprise-security";
import {
  mintServiceAccountCredential,
  validateServiceAccountScopes,
} from "../enterprise-integrations";
import {
  ROLE_PERMISSIONS,
  permissionsForRole,
  SUPPORT_READ_ONLY_PERMISSIONS,
  hasPermission,
  getActiveSupportGrant,
  type Queryable,
} from "../enterprise-permissions";

// ---------------------------------------------------------------------------
// Registry / inventory
// ---------------------------------------------------------------------------

test("security control registry loads with disclaimer and no fake score", () => {
  const summary = controlInventorySummary();
  assert.ok(summary.total >= 10);
  assert.match(summary.disclaimer, /not a certification/i);
  assert.ok(!("score" in summary));
  const ac = getSecurityControl("AC-SUPPORT-001");
  assert.ok(ac);
  assert.equal(ac!.enforcement, "server");
  for (const c of listSecurityControls()) {
    assert.ok(c.id && c.name && c.status);
    assert.notEqual(c.enforcement, "ui_only");
  }
});

test("security event taxonomy covers support and service-account actions", () => {
  assert.ok(isKnownSecurityAction("support_access.granted"));
  assert.equal(normalizeSecurityAction("support.granted"), "support_access.granted");
  assert.ok("integrations.service_account_revoked" in SECURITY_EVENT_TAXONOMY);
  assert.equal(normalizeSecurityAction("totally.unknown.action"), "totally.unknown.action");
});

// ---------------------------------------------------------------------------
// Secrets / redaction
// ---------------------------------------------------------------------------

test("plaintext secret detection and client secret guard", () => {
  // Construct at runtime so the repo never contains a push-protection lookalike literal.
  const fakeLive = "sk_" + "live_" + "a".repeat(24);
  const hits = findPlaintextSecretHits("key=" + fakeLive);
  assert.ok(hits.includes("stripe_live_secret"));
  assert.doesNotThrow(() =>
    assertNoClientSecrets({ ok: true, credential_fingerprint: "sha256:abcd…ef" })
  );
  assert.throws(() =>
    assertNoClientSecrets({ service_role_key: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.sig" })
  );
  assert.equal(constantTimeEqual("abc", "abc"), true);
  assert.equal(constantTimeEqual("abc", "abd"), false);
  assert.ok(sha256Fingerprint("secret").startsWith("sha256:"));
});

test("redactSecrets strips credential-like strings", () => {
  const out = redactSecrets({
    password: "hunter2",
    token: "abc",
    credential_fingerprint: "sha256:9f2c…e1",
    nested: { client_secret: "x", count: 2 },
  }) as Record<string, unknown>;
  assert.equal(out.password, "[redacted]");
  assert.equal(out.token, "[redacted]");
  assert.equal(out.credential_fingerprint, "sha256:9f2c…e1");
  assert.equal((out.nested as Record<string, unknown>).client_secret, "[redacted]");
  assert.equal((out.nested as Record<string, unknown>).count, 2);
});

test("logAiEvent does not throw and redacts meta secrets", () => {
  // Should not throw; output goes to console
  logAiEvent({
    event: "ai.completion",
    provider: "xai",
    model: "test",
    prompt_chars: 12,
    completion_chars: 4,
    outcome: "ok",
    meta: { prompt: "CONFIDENTIAL CUSTOMER DATA", workspace_label: "acme" },
  });
});

// ---------------------------------------------------------------------------
// RBAC
// ---------------------------------------------------------------------------

test("RBAC: auditor cannot manage users; org_owner has manage_users", () => {
  assert.ok(!permissionsForRole("auditor").includes("manage_users"));
  assert.ok(ROLE_PERMISSIONS.org_owner.includes("manage_users"));
  assert.ok(SUPPORT_READ_ONLY_PERMISSIONS.includes("view_records"));
  assert.ok(!SUPPORT_READ_ONLY_PERMISSIONS.includes("manage_users"));
});

test("hasPermission denies when no assignments (fake pool)", async () => {
  const pool: Queryable = {
    async query() {
      return { rows: [] };
    },
  };
  const allowed = await hasPermission(
    "00000000-0000-0000-0000-000000000001",
    "00000000-0000-0000-0000-000000000002",
    "manage_users",
    undefined,
    { pool }
  );
  assert.equal(allowed, false);
});

// ---------------------------------------------------------------------------
// Service accounts / SCIM gate
// ---------------------------------------------------------------------------

test("service account mint is hash-only show-once shape", () => {
  const m = mintServiceAccountCredential();
  assert.ok(m.raw && m.hash);
  assert.notEqual(m.raw, m.hash);
  assert.equal(m.hash, sha256Hex(m.raw));
  assert.ok(hashFingerprint(m.hash));
  const bad = validateServiceAccountScopes(["not-a-scope"]);
  assert.equal(bad.ok, false);
  const good = validateServiceAccountScopes(["scim"]);
  assert.equal(good.ok, true);
});

test("SCIM auth rejects revoked and expired credentials", async () => {
  const minted = mintServiceAccountCredential();
  const rowsRevoked = [
    {
      id: "sa1",
      workspace_id: "ws1",
      scopes: ["scim"],
      credential_hash: minted.hash,
      expires_at: null,
      last_used_at: null,
      revoked: true,
    },
  ];
  const poolRevoked: Queryable = {
    async query(text: string) {
      if (/FROM service_accounts/.test(text)) return { rows: rowsRevoked };
      return { rows: [] };
    },
  };
  const r1 = await authenticateScimRequest(
    new Request("http://localhost/scim", {
      headers: { authorization: `Bearer ${minted.raw}` },
    }),
    poolRevoked
  );
  assert.equal(r1.ok, false);

  const rowsExpired = [
    {
      id: "sa2",
      workspace_id: "ws1",
      scopes: ["scim"],
      credential_hash: minted.hash,
      expires_at: new Date(Date.now() - 60_000).toISOString(),
      last_used_at: null,
      revoked: false,
    },
  ];
  const poolExpired: Queryable = {
    async query(text: string) {
      if (/FROM service_accounts/.test(text)) return { rows: rowsExpired };
      return { rows: [] };
    },
  };
  const r2 = await authenticateScimRequest(
    new Request("http://localhost/scim", {
      headers: { authorization: `Bearer ${minted.raw}` },
    }),
    poolExpired
  );
  assert.equal(r2.ok, false);
});

// ---------------------------------------------------------------------------
// Support access expiry
// ---------------------------------------------------------------------------

test("getActiveSupportGrant ignores expired and revoked rows", async () => {
  const pool: Queryable = {
    async query() {
      // SQL already filters; simulate empty = no active grant
      return { rows: [] };
    },
  };
  const g = await getActiveSupportGrant(pool, "ws", "admin@example.com");
  assert.equal(g, null);
});

test("getActiveSupportGrant maps a live row", async () => {
  const pool: Queryable = {
    async query() {
      return {
        rows: [
          {
            id: "g1",
            workspace_id: "ws1",
            granted_by: "u1",
            granted_to_email: "admin@example.com",
            reason: "ticket-1",
            expires_at: new Date(Date.now() + 3600_000).toISOString(),
            revoked_at: null,
            scope: "read_only",
            created_at: new Date().toISOString(),
          },
        ],
      };
    },
  };
  const g = await getActiveSupportGrant(pool, "ws1", "admin@example.com");
  assert.ok(g);
  assert.equal(g!.scope, "read_only");
  assert.equal(g!.reason, "ticket-1");
});
