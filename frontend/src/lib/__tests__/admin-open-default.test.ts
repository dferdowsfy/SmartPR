import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";

import { isAdminEmail, isUserAdmin, userInGroup, setAdminPoolForTests } from "../admin";

const ENTERPRISE = {
  DEPLOYMENT_MODE: "enterprise",
  CUSTOMER_ID: "example-customer",
  CLOUD_PROVIDER: "azure",
  DATABASE_PROVIDER: "azure-postgres",
  STORAGE_PROVIDER: "azure-blob",
  AUTH_PROVIDER: "entra",
  MODEL_GATEWAY: "azure-foundry",
};
const CONFIG_KEYS = [...Object.keys(ENTERPRISE), "ADMIN_EMAILS"];

/** Fake admin_allowlist table: email -> groups. */
function fakePool(rows: Record<string, string[]>) {
  return () => ({
    query: async <T>(text: string, params: unknown[] = []) => {
      if (/COUNT\(\*\)::text AS n FROM admin_allowlist\s*$/.test(text.trim())) {
        return { rows: [{ n: String(Object.keys(rows).length) }] as T[] };
      }
      const [email, group] = params as string[];
      const groups = rows[String(email).toLowerCase()] ?? [];
      const n = groups.some((g) => g.toLowerCase() === String(group).toLowerCase()) ? 1 : 0;
      return { rows: [{ n: String(n) }] as T[] };
    },
  });
}
const failingPool = () => ({
  query: async () => {
    throw new Error("relation admin_allowlist does not exist");
  },
});

let saved: Record<string, string | undefined>;
beforeEach(() => {
  saved = Object.fromEntries(CONFIG_KEYS.map((k) => [k, process.env[k]]));
  for (const k of CONFIG_KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of CONFIG_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  setAdminPoolForTests(null);
});

function enterprise(extra: Record<string, string> = {}) {
  Object.assign(process.env, ENTERPRISE, extra);
}

describe("admin authorization — Enterprise fails closed", () => {
  it("1. empty ADMIN_EMAILS + empty DB allowlist -> not admin", async () => {
    enterprise();
    setAdminPoolForTests(fakePool({}));
    assert.equal(isAdminEmail("user@example.com"), false);
    assert.equal(await isUserAdmin("user@example.com"), false);
    assert.equal(await userInGroup("user@example.com", "billing"), false);
  });

  it("2. explicitly authorized admins are recognized (env and DB allowlist)", async () => {
    enterprise({ ADMIN_EMAILS: "Admin@Example.com" });
    setAdminPoolForTests(fakePool({ "dbadmin@example.com": ["admin"] }));
    assert.equal(isAdminEmail("admin@example.com"), true);
    assert.equal(await isUserAdmin("admin@example.com"), true);
    assert.equal(await isUserAdmin("dbadmin@example.com"), true);
  });

  it("3. ordinary authenticated user -> not admin", async () => {
    enterprise({ ADMIN_EMAILS: "admin@example.com" });
    setAdminPoolForTests(fakePool({ "dbadmin@example.com": ["admin"] }));
    assert.equal(isAdminEmail("user@example.com"), false);
    assert.equal(await isUserAdmin("user@example.com"), false);
  });

  it("4. database unavailable or erroring -> not admin", async () => {
    enterprise();
    setAdminPoolForTests(() => null);
    assert.equal(await isUserAdmin("user@example.com"), false);
    setAdminPoolForTests(failingPool);
    assert.equal(await isUserAdmin("user@example.com"), false);
  });

  it("5. malformed or incomplete deployment/admin config -> not admin", async () => {
    setAdminPoolForTests(fakePool({}));
    const cases: Record<string, string>[] = [
      { DEPLOYMENT_MODE: "enterprise" }, // missing required enterprise values
      { DEPLOYMENT_MODE: "Enterprise" }, // invalid value
      { DEPLOYMENT_MODE: "hybrid" },
      { ...ENTERPRISE, CUSTOMER_ID: "Not A Slug" },
      { DATABASE_PROVIDER: "mysql" }, // standard mode but invalid config
    ];
    for (const env of cases) {
      for (const k of CONFIG_KEYS) delete process.env[k];
      Object.assign(process.env, env);
      assert.equal(isAdminEmail("user@example.com"), false, JSON.stringify(env));
      assert.equal(await isUserAdmin("user@example.com"), false, JSON.stringify(env));
    }
    // Blank / separator-only ADMIN_EMAILS is "no admins", never "everyone".
    enterprise({ ADMIN_EMAILS: " , ,, " });
    assert.equal(isAdminEmail("user@example.com"), false);
    assert.equal(await isUserAdmin("user@example.com"), false);
  });

  it("missing email is never admin", async () => {
    enterprise({ ADMIN_EMAILS: "admin@example.com" });
    assert.equal(isAdminEmail(null), false);
    assert.equal(await isUserAdmin(undefined), false);
  });
});

describe("admin authorization — Standard behavior unchanged", () => {
  it("6a. no admins configured anywhere -> open default still applies", async () => {
    setAdminPoolForTests(fakePool({}));
    assert.equal(isAdminEmail("user@example.com"), true);
    assert.equal(await isUserAdmin("user@example.com"), true);
  });

  it("6b. no DB / DB error with empty env -> open default still applies", async () => {
    setAdminPoolForTests(() => null);
    assert.equal(await isUserAdmin("user@example.com"), true);
    setAdminPoolForTests(failingPool);
    assert.equal(await isUserAdmin("user@example.com"), true);
  });

  it("6c. once any admin is configured, only allowlisted users pass", async () => {
    process.env.ADMIN_EMAILS = "admin@example.com";
    setAdminPoolForTests(fakePool({}));
    assert.equal(isAdminEmail("user@example.com"), false);
    assert.equal(await isUserAdmin("user@example.com"), false);
    assert.equal(await isUserAdmin("admin@example.com"), true);

    delete process.env.ADMIN_EMAILS;
    setAdminPoolForTests(fakePool({ "dbadmin@example.com": ["admin"] }));
    assert.equal(await isUserAdmin("user@example.com"), false);
    assert.equal(await isUserAdmin("dbadmin@example.com"), true);
  });

  it("6d. explicit DEPLOYMENT_MODE=standard behaves like unset", async () => {
    process.env.DEPLOYMENT_MODE = "standard";
    setAdminPoolForTests(fakePool({}));
    assert.equal(await isUserAdmin("user@example.com"), true);
  });
});
