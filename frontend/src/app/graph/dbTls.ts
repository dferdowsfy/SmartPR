// ============================================================================
// Postgres TLS policy.
//
// Decides how the app's Postgres pool encrypts and verifies its connection.
// Pure: reads only the env object passed in and performs no I/O except reading
// a CA file named by PGSSL_CA_FILE.
//
// Enterprise (or an invalid deployment config — fails closed):
//   - TLS is mandatory; PGSSL_DISABLE is refused.
//   - The server certificate is ALWAYS verified (rejectUnauthorized: true),
//     against PGSSL_CA / PGSSL_CA_FILE when given, else the system trust store.
//   - A connection string asking for a weaker sslmode is refused.
//
// Standard (unchanged by default so production keeps connecting):
//   - PGSSL_DISABLE: no TLS (local development only).
//   - PGSSL_CA / PGSSL_CA_FILE: verify against that CA (e.g. Supabase's CA).
//   - PGSSL_VERIFY=true: verify against the system trust store.
//   - Otherwise: encrypted but unverified, as before, with a one-time warning.
//     This is tracked debt: set PGSSL_CA_FILE to close it.
// ============================================================================

import { readFileSync } from "node:fs";
import { loadDeploymentConfig } from "../../lib/config/deployment";

type Env = Record<string, string | undefined>;

export type PgSsl = undefined | { rejectUnauthorized: boolean; ca?: string };

export interface TlsDecision {
  ssl: PgSsl;
  /**
   * The connection string to hand to pg. pg lets ssl* query parameters in the
   * URL REPLACE the ssl object entirely (dropping a pinned CA), so whenever
   * this policy verifies, those parameters are stripped and the policy wins.
   * In Standard's unverified posture the URL is passed through untouched.
   */
  connectionString: string | undefined;
  /** Human-readable summary, safe to log (no secrets). */
  posture: "disabled" | "verified-ca" | "verified-system" | "unverified";
  enterprise: boolean;
}

export class DbTlsConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DbTlsConfigError";
  }
}

const WEAK_SSLMODES = new Set(["disable", "allow", "prefer", "no-verify"]);

function flag(env: Env, name: string): boolean {
  const v = env[name]?.trim().toLowerCase();
  return !!v && v !== "0" && v !== "false" && v !== "no";
}

function isEnterprise(env: Env): boolean {
  try {
    return loadDeploymentConfig(env).mode !== "standard";
  } catch {
    // Invalid deployment config: behave as Enterprise (fail closed).
    return true;
  }
}

function weakSslMode(connectionString: string | undefined): string | null {
  if (!connectionString) return null;
  const match = /[?&]sslmode=([^&]+)/i.exec(connectionString);
  if (!match) return null;
  const mode = decodeURIComponent(match[1]).toLowerCase();
  return WEAK_SSLMODES.has(mode) ? mode : null;
}

const SSL_URL_PARAMS = new Set(["sslmode", "ssl", "sslrootcert", "sslcert", "sslkey", "uselibpqcompat"]);

/** Removes ssl-related query parameters so the explicit ssl object is authoritative. */
export function stripSslParams(connectionString: string | undefined): string | undefined {
  if (!connectionString) return connectionString;
  const q = connectionString.indexOf("?");
  if (q === -1) return connectionString;
  const base = connectionString.slice(0, q);
  const kept = connectionString
    .slice(q + 1)
    .split("&")
    .filter((pair) => pair && !SSL_URL_PARAMS.has(decodeURIComponent(pair.split("=")[0]).toLowerCase()));
  return kept.length ? `${base}?${kept.join("&")}` : base;
}

function loadCa(env: Env, readFile: (path: string) => string): string | undefined {
  const inline = env.PGSSL_CA?.trim();
  if (inline) return inline.replace(/\\n/g, "\n");
  const file = env.PGSSL_CA_FILE?.trim();
  if (!file) return undefined;
  try {
    return readFile(file);
  } catch {
    throw new DbTlsConfigError(`PGSSL_CA_FILE could not be read (${file}).`);
  }
}

export function resolveDbTls(
  env: Env = process.env,
  connectionString?: string,
  readFile: (path: string) => string = (p) => readFileSync(p, "utf8")
): TlsDecision {
  const enterprise = isEnterprise(env);

  if (enterprise) {
    if (flag(env, "PGSSL_DISABLE")) {
      throw new DbTlsConfigError("PGSSL_DISABLE is not permitted in Enterprise mode; database TLS is mandatory.");
    }
    const weak = weakSslMode(connectionString);
    if (weak) {
      throw new DbTlsConfigError(`sslmode=${weak} is not permitted in Enterprise mode; use sslmode=verify-full or omit it.`);
    }
    const ca = loadCa(env, readFile);
    const cs = stripSslParams(connectionString);
    return ca
      ? { ssl: { rejectUnauthorized: true, ca }, connectionString: cs, posture: "verified-ca", enterprise }
      : { ssl: { rejectUnauthorized: true }, connectionString: cs, posture: "verified-system", enterprise };
  }

  if (flag(env, "PGSSL_DISABLE")) return { ssl: undefined, connectionString, posture: "disabled", enterprise };
  const ca = loadCa(env, readFile);
  if (ca) {
    return { ssl: { rejectUnauthorized: true, ca }, connectionString: stripSslParams(connectionString), posture: "verified-ca", enterprise };
  }
  if (flag(env, "PGSSL_VERIFY")) {
    return { ssl: { rejectUnauthorized: true }, connectionString: stripSslParams(connectionString), posture: "verified-system", enterprise };
  }
  // Unchanged Standard behaviour: URL passed through exactly as before.
  return { ssl: { rejectUnauthorized: false }, connectionString, posture: "unverified", enterprise };
}
