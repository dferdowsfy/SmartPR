import { test } from "node:test";
import assert from "node:assert/strict";

import { DeploymentConfigError, STANDARD_DEFAULTS, loadDeploymentConfig } from "./deployment";

const ENTERPRISE = {
  DEPLOYMENT_MODE: "enterprise",
  CUSTOMER_ID: "example-customer",
  CLOUD_PROVIDER: "azure",
  DATABASE_PROVIDER: "azure-postgres",
  STORAGE_PROVIDER: "azure-blob",
  AUTH_PROVIDER: "entra",
  MODEL_GATEWAY: "azure-foundry",
};

test("empty env yields today's Standard deployment", () => {
  assert.deepEqual(loadDeploymentConfig({}), STANDARD_DEFAULTS);
});

test("unrelated existing variables do not change Standard defaults", () => {
  const cfg = loadDeploymentConfig({ DATABASE_URL: "postgres://x", NEXT_PUBLIC_SUPABASE_URL: "https://x" });
  assert.deepEqual(cfg, STANDARD_DEFAULTS);
});

test("blank values are treated as unset", () => {
  assert.deepEqual(loadDeploymentConfig({ DEPLOYMENT_MODE: "  ", MODEL_GATEWAY: "" }), STANDARD_DEFAULTS);
});

test("invalid enum values are rejected", () => {
  assert.throws(() => loadDeploymentConfig({ DEPLOYMENT_MODE: "hybrid" }), DeploymentConfigError);
  assert.throws(() => loadDeploymentConfig({ DATABASE_PROVIDER: "mysql" }), DeploymentConfigError);
  assert.throws(() => loadDeploymentConfig({ MODEL_GATEWAY: "openai" }), DeploymentConfigError);
});

test("CUSTOMER_ID is rejected in Standard mode", () => {
  assert.throws(() => loadDeploymentConfig({ CUSTOMER_ID: "acme" }), DeploymentConfigError);
});

test("enterprise without CUSTOMER_ID fails closed", () => {
  const env: Record<string, string> = { ...ENTERPRISE };
  delete env.CUSTOMER_ID;
  assert.throws(() => loadDeploymentConfig(env), /CUSTOMER_ID is required/);
});

test("enterprise never falls back to Supabase or direct model access", () => {
  for (const key of ["CLOUD_PROVIDER", "DATABASE_PROVIDER", "STORAGE_PROVIDER", "AUTH_PROVIDER", "MODEL_GATEWAY"]) {
    const env: Record<string, string> = { ...ENTERPRISE };
    delete env[key];
    assert.throws(() => loadDeploymentConfig(env), new RegExp(`${key} is required`));
  }
});

test("malformed CUSTOMER_ID is rejected", () => {
  assert.throws(() => loadDeploymentConfig({ ...ENTERPRISE, CUSTOMER_ID: "Acme Corp" }), DeploymentConfigError);
});

test("full enterprise config parses", () => {
  assert.deepEqual(loadDeploymentConfig(ENTERPRISE), {
    mode: "enterprise",
    customerId: "example-customer",
    cloudProvider: "azure",
    databaseProvider: "azure-postgres",
    storageProvider: "azure-blob",
    authProvider: "entra",
    modelGateway: "azure-foundry",
  });
});

test("config objects are frozen", () => {
  assert.ok(Object.isFrozen(loadDeploymentConfig({})));
  assert.ok(Object.isFrozen(loadDeploymentConfig(ENTERPRISE)));
  assert.ok(Object.isFrozen(STANDARD_DEFAULTS));
});

test("errors report every problem at once", () => {
  try {
    loadDeploymentConfig({ DEPLOYMENT_MODE: "enterprise" });
    assert.fail("expected throw");
  } catch (err) {
    assert.ok(err instanceof DeploymentConfigError);
    assert.equal(err.problems.length, 6);
  }
});
