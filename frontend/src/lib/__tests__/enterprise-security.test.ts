// Phase 6 unit tests: security helpers, SCIM auth, webhook dispatch.
// Run with:
//   npx tsx --test src/lib/__tests__/enterprise-security.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

process.env.ENTERPRISE_WEBHOOK_ENC_KEY = "ab".repeat(32); // fixed test key (64 hex)

import {
  redactSecrets,
  hashFingerprint,
  sha256Hex,
  encryptSecret,
  decryptSecret,
  getWebhookEncryptionKey,
  signWebhookPayload,
  verifyWebhookSignature,
  canEnableEnforcement,
  authenticateScimRequest,
  extractBearerToken,
  enterpriseRoleToLegacy,
  roleForScimGroup,
} from "../enterprise-security";
import {
  WEBHOOK_EVENTS,
  isWebhookEvent,
  SERVICE_ACCOUNT_SCOPES,
  validateServiceAccountScopes,
  isInertWebhookUrl,
  mintWebhookSecret,
  mintServiceAccountCredential,
  backoffDelayMs,
  MAX_DELIVERY_ATTEMPTS,
  dispatchWebhookEvent,
  buildWebhookEnvelope,
} from "../enterprise-integrations";
import type { Queryable } from "../enterprise-integrations";

// ---------------------------------------------------------------------------
// HMAC sign/verify round-trip
// ---------------------------------------------------------------------------

test("HMAC sign/verify round-trip", () => {
  const secret = "test-secret";
  const body = JSON.stringify({ a: 1 });
  const sig = signWebhookPayload(secret, body);
  assert.ok(sig.startsWith("sha256="));
  assert.ok(verifyWebhookSignature(secret, body, sig));
  assert.ok(!verifyWebhookSignature(secret, body + "x", sig), "tampered body must fail");
  assert.ok(!verifyWebhookSignature("other-secret", body, sig), "wrong secret must fail");
  assert.ok(!verifyWebhookSignature(secret, body, null), "missing signature must fail");
  assert.ok(!verifyWebhookSignature(secret, body, "sha256=deadbeef"), "bad sig must fail");
});

// ---------------------------------------------------------------------------
// AES-256-GCM secret encryption round-trip
// ---------------------------------------------------------------------------

test("AES-GCM encrypt/decrypt round-trip", () => {
  const enc = encryptSecret("whsec_hello");
  assert.ok(enc.startsWith("enc_v1:"));
  assert.equal(decryptSecret(enc), "whsec_hello");
  // Tamper with the ciphertext part.
  const parts = enc.split(".");
  parts[1] = Buffer.from("tampered!!").toString("base64");
  assert.throws(() => decryptSecret(parts.join(".")), "tampered ciphertext must fail");
  // Wrong key must fail.
  const otherKey = Buffer.from("cd".repeat(32), "hex");
  assert.throws(() => decryptSecret(enc, otherKey), "wrong key must fail");
});

test("encryption key validation", () => {
  assert.equal(getWebhookEncryptionKey().length, 32);
  const saved = process.env.ENTERPRISE_WEBHOOK_ENC_KEY;
  delete process.env.ENTERPRISE_WEBHOOK_ENC_KEY;
  assert.throws(() => getWebhookEncryptionKey(), "missing key must throw");
  process.env.ENTERPRISE_WEBHOOK_ENC_KEY = "short";
  assert.throws(() => getWebhookEncryptionKey(), "short key must throw");
  process.env.ENTERPRISE_WEBHOOK_ENC_KEY = saved;
});

// ---------------------------------------------------------------------------
// Secret redaction
// ---------------------------------------------------------------------------

test("redactSecrets strips secret values, keeps non-secrets", () => {
  const input = {
    name: "Acme",
    secret_configured: true,
    secret_enc: "enc_v1:abc.def.ghi",
    rawSecret: "whsec_xxx",
    credential: "sk_ent_xxx",
    credential_hash: "abc123",
    nested: { password: "hunter2", note: "fine" },
    signature: "sha256:deadbeef",
    secret_fingerprint: "sha256:9f2c…e1",
    credential_fingerprint: "sha256:7a11…c4",
    count: 3,
  };
  const out = redactSecrets(input) as Record<string, unknown>;
  assert.equal(out.name, "Acme");
  assert.equal(out.secret_configured, true, "boolean flags survive");
  assert.equal(out.count, 3);
  assert.equal(out.secret_enc, "[redacted]");
  assert.equal(out.rawSecret, "[redacted]");
  assert.equal(out.credential, "[redacted]");
  assert.equal(out.credential_hash, "[redacted]");
  // Truncated fingerprints and HMAC signatures are display-safe: they reveal
  // nothing without the secret and the UIs depend on them.
  assert.equal(out.signature, "sha256:deadbeef", "HMAC signature survives");
  assert.equal(out.secret_fingerprint, "sha256:9f2c…e1", "fingerprint survives");
  assert.equal(out.credential_fingerprint, "sha256:7a11…c4", "credential fingerprint survives");
  assert.equal((out.nested as Record<string, unknown>).password, "[redacted]");
  assert.equal((out.nested as Record<string, unknown>).note, "fine");
  // Input not mutated.
  assert.equal(input.rawSecret, "whsec_xxx");
});

test("hashFingerprint shows only a truncated fingerprint", () => {
  const fp = hashFingerprint(sha256Hex("x"));
  assert.ok(fp?.startsWith("sha256:"));
  assert.ok(!fp?.includes(sha256Hex("x")));
  assert.equal(hashFingerprint(null), null);
});

// ---------------------------------------------------------------------------
// Enforcement gate
// ---------------------------------------------------------------------------

test("canEnableEnforcement requires a fresh successful test", () => {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  assert.equal(canEnableEnforcement(null, now), false);
  assert.equal(canEnableEnforcement("not-a-date", now), false);
  assert.equal(canEnableEnforcement(new Date(now - 40 * day).toISOString(), now), false);
  assert.equal(canEnableEnforcement(new Date(now - 29 * day).toISOString(), now), true);
  assert.equal(canEnableEnforcement(new Date(now - 60 * 1000).toISOString(), now), true);
});

// ---------------------------------------------------------------------------
// SCIM bearer auth (fake pool)
// ---------------------------------------------------------------------------

interface FakeRow extends Record<string, unknown> {}

function fakeScimPool(account: FakeRow | null): Queryable & { updated: string[] } {
  const updated: string[] = [];
  return {
    updated,
    async query(text: string, params?: unknown[]) {
      if (/FROM service_accounts/.test(text)) {
        return { rows: account ? [account] : [] };
      }
      if (/UPDATE service_accounts SET last_used_at/.test(text)) {
        updated.push(String(params?.[0] ?? ""));
        return { rows: [] };
      }
      throw new Error(`unexpected query: ${text.slice(0, 60)}`);
    },
  };
}

function scimReq(token: string | null) {
  return { headers: { get: (n: string) => (n.toLowerCase() === "authorization" && token ? `Bearer ${token}` : null) } };
}

const VALID_TOKEN = `sk_ent_${randomBytes(16).toString("base64url")}`;
const VALID_HASH = sha256Hex(VALID_TOKEN);
function validAccount(overrides: FakeRow = {}): FakeRow {
  return {
    id: "acc-1",
    workspace_id: "ws-1",
    name: "provisioner",
    scopes: ["scim"],
    credential_hash: VALID_HASH,
    expires_at: null,
    revoked: false,
    ...overrides,
  };
}

test("SCIM auth: valid token passes and stamps last_used_at", async () => {
  const pool = fakeScimPool(validAccount());
  const res = await authenticateScimRequest(scimReq(VALID_TOKEN), pool);
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.account.workspace_id, "ws-1");
    assert.deepEqual(res.account.scopes, ["scim"]);
  }
  assert.deepEqual(pool.updated, ["acc-1"]);
});

test("SCIM auth: invalid token rejected", async () => {
  const pool = fakeScimPool(validAccount());
  const res = await authenticateScimRequest(scimReq("sk_ent_wrong"), pool);
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.status, 401);
});

test("SCIM auth: unknown token rejected", async () => {
  const pool = fakeScimPool(null);
  const res = await authenticateScimRequest(scimReq(VALID_TOKEN), pool);
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.status, 401);
});

test("SCIM auth: revoked credential rejected", async () => {
  const pool = fakeScimPool(validAccount({ revoked: true }));
  const res = await authenticateScimRequest(scimReq(VALID_TOKEN), pool);
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.status, 401);
    assert.match(res.reason, /revoked/);
  }
});

test("SCIM auth: expired credential rejected", async () => {
  const pool = fakeScimPool(validAccount({ expires_at: new Date(Date.now() - 1000) }));
  const res = await authenticateScimRequest(scimReq(VALID_TOKEN), pool);
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.status, 401);
    assert.match(res.reason, /expired/);
  }
});

test("SCIM auth: missing scim scope rejected with 403", async () => {
  const pool = fakeScimPool(validAccount({ scopes: ["reports:read"] }));
  const res = await authenticateScimRequest(scimReq(VALID_TOKEN), pool);
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.status, 403);
});

test("SCIM auth: missing bearer header rejected", async () => {
  const pool = fakeScimPool(validAccount());
  const res = await authenticateScimRequest(scimReq(null), pool);
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.status, 401);
});

test("extractBearerToken parses the Authorization header", () => {
  assert.equal(extractBearerToken(scimReq("abc").headers), "abc");
  assert.equal(
    extractBearerToken({ get: () => "Basic xyz" }),
    null
  );
});

// ---------------------------------------------------------------------------
// Group/role mapping helpers
// ---------------------------------------------------------------------------

test("enterpriseRoleToLegacy bridges enterprise roles", () => {
  assert.equal(enterpriseRoleToLegacy("org_owner"), "OWNER");
  assert.equal(enterpriseRoleToLegacy("auditor"), "VIEWER");
  assert.equal(enterpriseRoleToLegacy("contributor"), "MEMBER");
  assert.equal(enterpriseRoleToLegacy("compliance_manager"), "ADMIN");
  assert.equal(enterpriseRoleToLegacy("unknown-role"), "MEMBER");
});

test("roleForScimGroup uses mappings, falls back to default", () => {
  const mappings = [{ group: "Finance", role: "compliance_manager" }];
  assert.equal(roleForScimGroup("finance", mappings, "contributor"), "compliance_manager");
  assert.equal(roleForScimGroup("Engineering", mappings, "contributor"), "contributor");
  assert.equal(roleForScimGroup("Engineering", mappings, "bogus"), "contributor");
});

// ---------------------------------------------------------------------------
// Inert-URL detection (demo webhook stays inert)
// ---------------------------------------------------------------------------

test("isInertWebhookUrl: demo/test URLs never fire", () => {
  assert.equal(isInertWebhookUrl("https://api.mycompany.com/hook"), false);
  assert.equal(isInertWebhookUrl("https://hooks.mycompany.com:8443/smartpr"), false);
  assert.equal(isInertWebhookUrl("http://api.mycompany.com/hook"), true, "non-https is inert");
  assert.equal(isInertWebhookUrl("https://example.com/hook"), true);
  assert.equal(isInertWebhookUrl("https://hooks.example.com/hook"), true);
  assert.equal(isInertWebhookUrl("https://localhost:3000/hook"), true);
  assert.equal(isInertWebhookUrl("https://127.0.0.1/hook"), true);
  assert.equal(isInertWebhookUrl("https://webhook.test/hook"), true);
  assert.equal(isInertWebhookUrl("not-a-url"), true);
  assert.equal(isInertWebhookUrl(""), true);
  assert.equal(isInertWebhookUrl(null), true);
});

// ---------------------------------------------------------------------------
// Scopes + secret minting
// ---------------------------------------------------------------------------

test("validateServiceAccountScopes enforces the allowlist", () => {
  const ok = validateServiceAccountScopes(["scim", "reports:read"]);
  assert.equal(ok.ok, true);
  if (ok.ok) assert.deepEqual(ok.scopes, ["scim", "reports:read"]);
  const bad = validateServiceAccountScopes(["scim", "admin:everything"]);
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.deepEqual(bad.invalid, ["admin:everything"]);
  assert.equal(validateServiceAccountScopes([]).ok, false);
  assert.equal(validateServiceAccountScopes("scim").ok, false);
  assert.ok(SERVICE_ACCOUNT_SCOPES.includes("scim"));
});

test("mintWebhookSecret: raw shown once, enc decrypts, hash matches", () => {
  const m = mintWebhookSecret();
  assert.ok(m.raw.startsWith("whsec_"));
  assert.equal(decryptSecret(m.encrypted), m.raw);
  assert.equal(m.hash, sha256Hex(m.raw));
});

test("mintServiceAccountCredential: hash matches raw", () => {
  const m = mintServiceAccountCredential();
  assert.ok(m.raw.startsWith("sk_ent_"));
  assert.equal(m.hash, sha256Hex(m.raw));
});

test("webhook event catalog is the 9 spec'd events", () => {
  assert.equal(WEBHOOK_EVENTS.length, 9);
  assert.ok(isWebhookEvent("evidence.approved"));
  assert.ok(!isWebhookEvent("bogus.event"));
});

test("backoffDelayMs is exponential and bounded", () => {
  assert.equal(backoffDelayMs(1), 5 * 60 * 1000);
  assert.equal(backoffDelayMs(2), 10 * 60 * 1000);
  assert.equal(backoffDelayMs(5), 80 * 60 * 1000);
  assert.ok(backoffDelayMs(100) <= 24 * 60 * 60 * 1000);
  assert.equal(MAX_DELIVERY_ATTEMPTS, 5);
});

// ---------------------------------------------------------------------------
// dispatchWebhookEvent with fake pool + fake fetcher
// ---------------------------------------------------------------------------

function fakeDispatchPool(endpoints: Array<Record<string, unknown>>) {
  const inserted: Array<{ status: string; payload: string }> = [];
  const pool: Queryable & { inserted: typeof inserted } = {
    inserted,
    async query(text: string, params?: unknown[]) {
      if (/FROM webhook_endpoints/.test(text)) return { rows: endpoints };
      if (/INSERT INTO webhook_deliveries/.test(text)) {
        // Status is a SQL literal in the VALUES clause: (..., 'delivered', ...)
        const m = /,\s*'(pending|delivered|failed|disabled|skipped)'\s*,/.exec(text);
        inserted.push({ status: m ? m[1] : "?", payload: String(params?.[2] ?? "") });
        return { rows: [] };
      }
      throw new Error(`unexpected query: ${text.slice(0, 60)}`);
    },
  };
  return pool;
}

test("dispatch: inert demo URL is skipped with no external traffic", async () => {
  const pool = fakeDispatchPool([
    { id: "ep-demo", url: "https://example.com/hook", secret_enc: encryptSecret("s"), events: ["evidence.approved"], active: true },
  ]);
  let fetched = 0;
  const results = await dispatchWebhookEvent("ws-1", "evidence.approved", { id: "ev-1" }, {
    pool,
    fetcher: async () => {
      fetched += 1;
      return { status: 200, text: async () => "ok" };
    },
  });
  assert.equal(results.length, 1);
  assert.equal(results[0].outcome, "skipped");
  assert.equal(fetched, 0, "inert URL must never be fetched");
  assert.equal(pool.inserted.length, 1);
  assert.equal(pool.inserted[0].status, "skipped");
});

test("dispatch: live endpoint is delivered with an HMAC signature", async () => {
  const secret = "live-signing-secret";
  const pool = fakeDispatchPool([
    { id: "ep-live", url: "https://hooks.mycompany.com/smartpr", secret_enc: encryptSecret(secret), events: ["*"], active: true },
  ]);
  let seenHeaders: Record<string, string> = {};
  let seenBody = "";
  const results = await dispatchWebhookEvent("ws-1", "deadline.approaching", { id: "dl-1" }, {
    pool,
    fetcher: async (_url, init) => {
      seenHeaders = (init?.headers ?? {}) as Record<string, string>;
      seenBody = String(init?.body ?? "");
      return { status: 200, text: async () => "ok" };
    },
  });
  assert.equal(results[0].outcome, "delivered");
  assert.equal(seenHeaders["x-smartpr-event"], "deadline.approaching");
  assert.ok(verifyWebhookSignature(secret, seenBody, seenHeaders["x-smartpr-signature"]), "signature must verify");
  const envelope = JSON.parse(seenBody);
  assert.equal(envelope.event_type, "deadline.approaching");
  assert.equal(envelope.workspace_id, "ws-1");
  assert.ok(envelope.event_id);
  // Stored payload round-trips for retries.
  assert.deepEqual(JSON.parse(pool.inserted[0].payload), envelope);
});

test("dispatch: failed POST is recorded with retry scheduled", async () => {
  const pool = fakeDispatchPool([
    { id: "ep-bad", url: "https://hooks.mycompany.com/down", secret_enc: encryptSecret("s"), events: ["evidence.rejected"], active: true },
  ]);
  const before = Date.now();
  const results = await dispatchWebhookEvent("ws-1", "evidence.rejected", {}, {
    pool,
    fetcher: async () => ({ status: 500, text: async () => "boom" }),
  });
  assert.equal(results[0].outcome, "failed");
  assert.equal(pool.inserted[0].status, "failed");
  assert.ok(Date.now() - before < 60_000, "sanity");
});

test("dispatch: unknown event type dispatches nowhere", async () => {
  const pool = fakeDispatchPool([
    { id: "ep-1", url: "https://hooks.mycompany.com/x", secret_enc: encryptSecret("s"), events: ["*"], active: true },
  ]);
  const results = await dispatchWebhookEvent("ws-1", "bogus.event", {}, { pool });
  assert.deepEqual(results, []);
});

test("buildWebhookEnvelope carries the required fields", () => {
  const env = buildWebhookEnvelope("ws-9", "evidence.submitted", { x: 1 });
  assert.equal(env.workspace_id, "ws-9");
  assert.equal(env.event_type, "evidence.submitted");
  assert.deepEqual(env.data, { x: 1 });
  assert.ok(typeof env.event_id === "string" && (env.event_id as string).length > 0);
  assert.ok(typeof env.occurred_at === "string");
});

// ---------------------------------------------------------------------------
// SCIM role replacement + Groups/[id] update parsing
// ---------------------------------------------------------------------------
import { setEnterpriseRole } from "../../app/api/scim/_util";
import { parseGroupUpdate } from "../../app/api/scim/v2/Groups/[id]/route";

function fakeRolePool(seen: string[]): Queryable {
  return {
    async query(text: string, params?: unknown[]) {
      seen.push(text);
      if (/FROM enterprise_roles/.test(text)) {
        return { rows: [{ id: "role-uuid-1" }] };
      }
      if (/DELETE FROM role_assignments/.test(text)) {
        assert.ok(/scope_type = 'organization'/.test(text), "delete is org-scope only");
        assert.equal(params?.[0], "user-1");
        return { rows: [] };
      }
      if (/INSERT INTO role_assignments/.test(text)) {
        assert.equal(params?.[0], "user-1");
        assert.equal(params?.[2], "role-uuid-1");
        return { rows: [] };
      }
      throw new Error(`unexpected query: ${text.slice(0, 60)}`);
    },
  };
}

test("setEnterpriseRole deletes org-scope rows then assigns the new role", async () => {
  const seen: string[] = [];
  const pool = fakeRolePool(seen);
  await setEnterpriseRole(pool, "user-1", "ws-setrole", "auditor");
  const delIdx = seen.findIndex((q) => /DELETE FROM role_assignments/.test(q));
  const insIdx = seen.findIndex((q) => /INSERT INTO role_assignments/.test(q));
  assert.ok(delIdx >= 0, "deletes existing assignments");
  assert.ok(insIdx > delIdx, "inserts after deleting");
});

test("parseGroupUpdate accepts a PUT body with a valid role", () => {
  const out = parseGroupUpdate(
    { displayName: "Finance", role: "auditor" },
    { group: "Finance", role: "contributor" }
  );
  assert.ok(!(out instanceof Response));
  if (!(out instanceof Response)) {
    assert.equal(out.displayName, "Finance");
    assert.equal(out.role, "auditor");
  }
});

test("parseGroupUpdate rejects an unknown role with 400", async () => {
  const out = parseGroupUpdate({ role: "ceo" }, { group: "Finance", role: "auditor" });
  assert.ok(out instanceof Response);
  if (out instanceof Response) assert.equal(out.status, 400);
});

test("parseGroupUpdate applies SCIM patch Operations", () => {
  const out = parseGroupUpdate(
    {
      Operations: [
        { op: "replace", path: "role", value: "org_admin" },
        { op: "replace", path: "displayName", value: "IT Admins" },
      ],
    },
    { group: "IT", role: "contributor" }
  );
  assert.ok(!(out instanceof Response));
  if (!(out instanceof Response)) {
    assert.equal(out.role, "org_admin");
    assert.equal(out.displayName, "IT Admins");
  }
});
