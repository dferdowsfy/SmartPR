import { test } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { resolveDbTls, stripSslParams, DbTlsConfigError } from "./dbTls";

const ENTERPRISE = {
  DEPLOYMENT_MODE: "enterprise",
  CUSTOMER_ID: "acme",
  CLOUD_PROVIDER: "azure",
  DATABASE_PROVIDER: "azure-postgres",
  STORAGE_PROVIDER: "azure-blob",
  AUTH_PROVIDER: "entra",
  MODEL_GATEWAY: "azure-foundry",
};
const URL_PLAIN = "postgres://u:p@db.example.com:5432/app";
const noFile = () => {
  throw new Error("no file");
};

// --- Standard ---------------------------------------------------------------

test("standard default is unchanged: encrypted, unverified, URL untouched", () => {
  const url = `${URL_PLAIN}?sslmode=require`;
  const d = resolveDbTls({}, url, noFile);
  assert.equal(d.posture, "unverified");
  assert.deepEqual(d.ssl, { rejectUnauthorized: false });
  assert.equal(d.connectionString, url);
  assert.equal(d.enterprise, false);
});

test("standard PGSSL_DISABLE turns TLS off", () => {
  const d = resolveDbTls({ PGSSL_DISABLE: "1" }, URL_PLAIN, noFile);
  assert.equal(d.posture, "disabled");
  assert.equal(d.ssl, undefined);
});

test("standard keeps the historical rule: any non-empty PGSSL_DISABLE disables TLS", () => {
  for (const v of ["1", "true", "false", "0"]) {
    assert.equal(resolveDbTls({ PGSSL_DISABLE: v }, URL_PLAIN, noFile).posture, "disabled", v);
  }
  assert.equal(resolveDbTls({ PGSSL_DISABLE: "" }, URL_PLAIN, noFile).posture, "unverified");
});

test("enterprise refuses any truthy PGSSL_DISABLE; 'false' cannot disable TLS", () => {
  assert.equal(resolveDbTls({ ...ENTERPRISE, PGSSL_DISABLE: "false" }, URL_PLAIN, noFile).ssl?.rejectUnauthorized, true);
});

test("PGSSL_CA with escaped CRLF newlines becomes a clean PEM", () => {
  const d = resolveDbTls({ PGSSL_CA: "-----BEGIN-----\\r\\nabc\\r\\n-----END-----" }, URL_PLAIN, noFile);
  assert.equal(d.ssl?.ca, "-----BEGIN-----\nabc\n-----END-----");
});

test("malformed percent-encoding in the URL does not crash the policy", () => {
  const d = resolveDbTls(ENTERPRISE, `${URL_PLAIN}?x%ZZ=1&sslmode=verify-full`, noFile);
  assert.equal(d.connectionString, `${URL_PLAIN}?x%ZZ=1`);
  assert.doesNotThrow(() => resolveDbTls(ENTERPRISE, `${URL_PLAIN}?sslmode=%ZZ&a=1`, noFile));
});

test("standard PGSSL_CA verifies against the given CA and strips URL ssl params", () => {
  const d = resolveDbTls({ PGSSL_CA: "-----BEGIN CERTIFICATE-----\\nabc\\n-----END CERTIFICATE-----" }, `${URL_PLAIN}?sslmode=no-verify&application_name=smartpr`, noFile);
  assert.equal(d.posture, "verified-ca");
  assert.equal(d.ssl?.rejectUnauthorized, true);
  assert.match(d.ssl?.ca ?? "", /\nabc\n/);
  assert.equal(d.connectionString, `${URL_PLAIN}?application_name=smartpr`);
});

test("standard PGSSL_CA_FILE is read; an unreadable file is an error", () => {
  const d = resolveDbTls({ PGSSL_CA_FILE: "/ca.pem" }, URL_PLAIN, () => "PEM");
  assert.equal(d.ssl?.ca, "PEM");
  assert.throws(() => resolveDbTls({ PGSSL_CA_FILE: "/missing.pem" }, URL_PLAIN, noFile), DbTlsConfigError);
});

test("standard PGSSL_VERIFY uses the system trust store", () => {
  const d = resolveDbTls({ PGSSL_VERIFY: "true" }, URL_PLAIN, noFile);
  assert.equal(d.posture, "verified-system");
  assert.deepEqual(d.ssl, { rejectUnauthorized: true });
});

// --- Enterprise -------------------------------------------------------------

test("enterprise always verifies the server certificate", () => {
  const d = resolveDbTls(ENTERPRISE, URL_PLAIN, noFile);
  assert.equal(d.posture, "verified-system");
  assert.deepEqual(d.ssl, { rejectUnauthorized: true });
  assert.equal(d.enterprise, true);
});

test("enterprise pins a CA when given", () => {
  const d = resolveDbTls({ ...ENTERPRISE, PGSSL_CA_FILE: "/ca.pem" }, URL_PLAIN, () => "PEM");
  assert.deepEqual(d.ssl, { rejectUnauthorized: true, ca: "PEM" });
});

test("enterprise refuses PGSSL_DISABLE", () => {
  assert.throws(() => resolveDbTls({ ...ENTERPRISE, PGSSL_DISABLE: "1" }, URL_PLAIN, noFile), DbTlsConfigError);
});

for (const mode of ["disable", "allow", "prefer", "no-verify", "NO-VERIFY"]) {
  test(`enterprise refuses sslmode=${mode} in the URL`, () => {
    assert.throws(() => resolveDbTls(ENTERPRISE, `${URL_PLAIN}?sslmode=${mode}`, noFile), DbTlsConfigError);
  });
}

test("enterprise ignores PGSSL_VERIFY=false; it cannot weaken verification", () => {
  const d = resolveDbTls({ ...ENTERPRISE, PGSSL_VERIFY: "false" }, URL_PLAIN, noFile);
  assert.equal(d.ssl?.rejectUnauthorized, true);
});

test("enterprise strips sslmode=verify-full so the explicit policy is authoritative", () => {
  const d = resolveDbTls(ENTERPRISE, `${URL_PLAIN}?sslmode=verify-full`, noFile);
  assert.equal(d.connectionString, URL_PLAIN);
});

test("an invalid deployment config fails closed to enterprise TLS", () => {
  const d = resolveDbTls({ DEPLOYMENT_MODE: "enterprise" }, URL_PLAIN, noFile);
  assert.equal(d.enterprise, true);
  assert.equal(d.ssl?.rejectUnauthorized, true);
  assert.throws(() => resolveDbTls({ DEPLOYMENT_MODE: "bogus", PGSSL_DISABLE: "1" }, URL_PLAIN, noFile), DbTlsConfigError);
});

// --- pg integration: the policy actually reaches the client -----------------

test("pg keeps the policy's ssl object when ssl URL params are stripped", () => {
  const d = resolveDbTls({ ...ENTERPRISE, PGSSL_CA: "PEM" }, `${URL_PLAIN}?sslmode=require`, noFile);
  const pool = new Pool({ connectionString: d.connectionString, ssl: d.ssl });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ssl = (pool as any).options.ssl;
  assert.equal(ssl.rejectUnauthorized, true);
  assert.equal(ssl.ca, "PEM");
  void pool.end();
});

// --- stripSslParams ---------------------------------------------------------

test("stripSslParams removes only ssl parameters", () => {
  assert.equal(stripSslParams(undefined), undefined);
  assert.equal(stripSslParams(URL_PLAIN), URL_PLAIN);
  assert.equal(stripSslParams(`${URL_PLAIN}?sslmode=require`), URL_PLAIN);
  assert.equal(
    stripSslParams(`${URL_PLAIN}?pgbouncer=true&sslrootcert=/x&SSLMode=require&uselibpqcompat=true`),
    `${URL_PLAIN}?pgbouncer=true`
  );
});
