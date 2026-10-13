// ============================================================================
// Postgres connection for the knowledge-graph capture layer.
//
// Storage is OPTIONAL: if DATABASE_URL is not set, isEnabled() returns false
// and every capture call becomes a safe no-op. This lets the app run (and the
// rules engine stay authoritative) with or without a database — capture simply
// turns on the moment a DATABASE_URL exists.
// ============================================================================

import { Pool } from "pg";
import { resolveDbTls } from "./dbTls";

let pool: Pool | null = null;
let warnedUnverifiedTls = false;

// Prefer the pooled connection (DATABASE_URL); fall back to DIRECT_URL.
export function connectionUrl(): string | undefined {
  return process.env.DATABASE_URL || process.env.DIRECT_URL;
}

export function isEnabled(): boolean {
  return !!connectionUrl();
}

export function getPool(): Pool | null {
  if (!isEnabled()) return null;
  if (!pool) {
    // TLS policy lives in dbTls.ts: Enterprise always verifies the server
    // certificate; Standard verifies when PGSSL_CA/PGSSL_CA_FILE/PGSSL_VERIFY
    // is set. A misconfigured Enterprise deployment throws here (fail closed).
    const tls = resolveDbTls(process.env, connectionUrl());
    if (tls.posture === "unverified" && !warnedUnverifiedTls) {
      warnedUnverifiedTls = true;
      console.warn(
        "[db] Postgres TLS is encrypted but the server certificate is NOT verified. " +
          "Set PGSSL_CA_FILE (or PGSSL_VERIFY=true) to verify it."
      );
    }
    pool = new Pool({
      connectionString: tls.connectionString,
      ssl: tls.ssl,
      max: 4,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 8_000,
    });
    pool.on("error", (err) => {
      // Never let a pool error crash the server; capture is best-effort.
      console.error("[graph] pool error:", err.message);
    });
  }
  return pool;
}

export async function query<T = unknown>(text: string, params: unknown[] = []): Promise<T[]> {
  const p = getPool();
  if (!p) return [];
  const res = await p.query(text, params);
  return res.rows as T[];
}

// ---------------------------------------------------------------------------
// Redacted connection diagnostics.
//
// "password authentication failed" is the same message for a stale password, a
// placeholder that was never substituted, an unencoded special character, and
// the wrong username for a pooler host. These checks tell those apart WITHOUT
// ever revealing the credential: only derived facts are returned, never the
// password itself, the host, or the project reference.
// ---------------------------------------------------------------------------

/** The pool's actual TLS posture for diagnostics; never throws. */
function tlsPostureSafe(): string {
  try {
    return resolveDbTls(process.env, connectionUrl()).posture;
  } catch {
    return "invalid";
  }
}

export interface ConnectionShape {
  variable: "DATABASE_URL" | "DIRECT_URL";
  parses: boolean;
  hostKind: "supabase-pooler" | "supabase-direct" | "other";
  port: string;
  usernameShape: "postgres" | "postgres.<project-ref>" | "other";
  passwordPresent: boolean;
  /** The literal placeholder Supabase prints in its connection-string UI. */
  passwordIsPlaceholder: boolean;
  /** Unencoded reserved characters in the password silently corrupt the URL. */
  passwordNeedsEncoding: boolean;
  database: string;
  sslDisabled: boolean;
  problems: string[];
}

export function describeConnection(): ConnectionShape | null {
  const raw = connectionUrl();
  if (!raw) return null;
  const variable = process.env.DATABASE_URL ? "DATABASE_URL" : "DIRECT_URL";
  const problems: string[] = [];

  // More than one "@" before the last one means an unencoded "@" inside the
  // password: the URL parser splits on the LAST one, so the host it dials and
  // the password it sends are both wrong.
  const authority = raw.replace(/^[a-z+]+:\/\//i, "").split("/")[0];
  const unencodedAt = (authority.match(/@/g) ?? []).length > 1;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return {
      variable, parses: false, hostKind: "other", port: "", usernameShape: "other",
      passwordPresent: false, passwordIsPlaceholder: false, passwordNeedsEncoding: unencodedAt,
      database: "", sslDisabled: tlsPostureSafe() === "disabled",
      problems: [`${variable} is not a parseable connection URL.`],
    };
  }

  const host = url.hostname;
  const hostKind = host.includes("pooler.supabase.com")
    ? "supabase-pooler"
    : host.endsWith(".supabase.co")
      ? "supabase-direct"
      : "other";

  const username = decodeURIComponent(url.username);
  const usernameShape = username === "postgres"
    ? "postgres"
    : /^postgres\.[a-z0-9]+$/i.test(username)
      ? "postgres.<project-ref>"
      : "other";

  const password = decodeURIComponent(url.password);
  const passwordIsPlaceholder = /^\[?YOUR[-_]?PASSWORD\]?$/i.test(password) || password === "";
  const passwordNeedsEncoding = unencodedAt || /[@/?#[\]]/.test(password);

  if (hostKind === "supabase-pooler" && usernameShape === "postgres") {
    problems.push(
      "The pooler host requires the username `postgres.<project-ref>`; a bare `postgres` is rejected as a bad password."
    );
  }
  if (passwordIsPlaceholder) {
    problems.push("The password is empty or still Supabase's `[YOUR-PASSWORD]` placeholder.");
  }
  if (passwordNeedsEncoding) {
    problems.push(
      "The password contains a reserved character (@ / ? # [ ]) that must be percent-encoded, or the URL is parsed wrongly."
    );
  }
  if (hostKind === "supabase-direct") {
    problems.push(
      "This is the direct (db.*.supabase.co) host, which is IPv6-only and unreachable from most serverless platforms. Use the pooler connection string."
    );
  }

  return {
    variable, parses: true, hostKind, port: url.port, usernameShape,
    passwordPresent: password.length > 0, passwordIsPlaceholder, passwordNeedsEncoding,
    database: url.pathname.replace(/^\//, ""),
    sslDisabled: tlsPostureSafe() === "disabled",
    problems,
  };
}
