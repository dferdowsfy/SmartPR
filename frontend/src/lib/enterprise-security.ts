// ============================================================================
// Enterprise identity/security center helpers — Phase 6.
//
// Server-side ONLY. Never import this module (or anything it re-exports)
// from client components: it handles raw webhook secrets, encryption keys,
// and SCIM bearer credentials.
//
// Covers:
//   - Security posture reads (getSecurityPosture)
//   - Secret redaction for anything that leaves the server (redactSecrets)
//   - SCIM bearer-token auth against service_accounts (authenticateScimRequest)
//   - HMAC-SHA256 webhook signing / verification
//   - AES-256-GCM encryption of stored webhook secrets
//   - SSO connection testing + enforcement gating primitives
// ============================================================================

import {
  createHash,
  createHmac,
  timingSafeEqual,
  randomBytes,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { getPool } from "../app/graph/db";
import {
  getRequestMeta,
  writeAuditEvent,
  isRoleKey,
  type Queryable,
  type RoleKey,
} from "./enterprise-permissions";

export type { Queryable };

// ---------------------------------------------------------------------------
// Secret redaction
// ---------------------------------------------------------------------------

/** Keys whose STRING values are secrets and must never leave the server. */
const SECRET_KEY_PATTERN =
  /password|passwd|secret|credential|private[_-]?key|client[_-]?secret|bearer|ssn/i;
const TOKEN_KEY_PATTERN = /(^|[_-])(token|signature)$/i;

/**
 * Keys that look secret-like but are safe to display: truncated fingerprints
 * (`*_fingerprint`, e.g. "sha256:9f2c…e1") and HMAC `signature` values (an
 * HMAC of the stored delivery body reveals nothing without the secret).
 */
const DISPLAY_SAFE_KEY_PATTERN = /(^|[_-])(fingerprint|signature)$/i;

/**
 * Deep-strip secret values from an object graph. String values under
 * secret-looking keys become "[redacted]"; non-string values (booleans like
 * `secret_configured`, counts, timestamps) pass through untouched. Returns a
 * deep copy; never mutates the input.
 */
export function redactSecrets<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => redactSecrets(v)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (
        typeof v === "string" &&
        !DISPLAY_SAFE_KEY_PATTERN.test(k) &&
        (SECRET_KEY_PATTERN.test(k) || TOKEN_KEY_PATTERN.test(k))
      ) {
        out[k] = "[redacted]";
      } else {
        out[k] = redactSecrets(v);
      }
    }
    return out as T;
  }
  return value;
}

/** Truncated fingerprint safe for display (e.g. "sha256:9f2c…e1"). */
export function hashFingerprint(hashHex: string | null | undefined): string | null {
  if (!hashHex || typeof hashHex !== "string") return null;
  const h = hashHex.replace(/^sha256:/i, "");
  if (h.length < 12) return null;
  return `sha256:${h.slice(0, 4)}…${h.slice(-2)}`;
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// AES-256-GCM secret encryption (webhook signing secrets at rest)
// ---------------------------------------------------------------------------

/**
 * 32-byte encryption key from ENTERPRISE_WEBHOOK_ENC_KEY (64 hex chars).
 * Throws when unset/invalid — callers translate this into an honest
 * "encryption not configured" error instead of storing secrets in the clear.
 */
export function getWebhookEncryptionKey(): Buffer {
  const raw = (process.env.ENTERPRISE_WEBHOOK_ENC_KEY || "").trim();
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error(
      "ENTERPRISE_WEBHOOK_ENC_KEY is not set or invalid: expected 64 hex chars (256-bit key). " +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }
  return Buffer.from(raw, "hex");
}

/** Encrypt a secret; returns "enc_v1:<iv>.<ciphertext>.<tag>" (base64 parts). */
export function encryptSecret(plaintext: string, key?: Buffer): string {
  const k = key ?? getWebhookEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const b64 = (b: Buffer) => b.toString("base64");
  return `enc_v1:${b64(iv)}.${b64(ct)}.${b64(tag)}`;
}

/** Decrypt a value produced by encryptSecret. Throws on tamper/format errors. */
export function decryptSecret(enc: string, key?: Buffer): string {
  const k = key ?? getWebhookEncryptionKey();
  const m = /^enc_v1:([A-Za-z0-9+/=]+)\.([A-Za-z0-9+/=]+)\.([A-Za-z0-9+/=]+)$/.exec(enc || "");
  if (!m) throw new Error("unrecognized encrypted-secret format");
  const iv = Buffer.from(m[1], "base64");
  const ct = Buffer.from(m[2], "base64");
  const tag = Buffer.from(m[3], "base64");
  const decipher = createDecipheriv("aes-256-gcm", k, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

// ---------------------------------------------------------------------------
// HMAC-SHA256 webhook signing
// ---------------------------------------------------------------------------

export const WEBHOOK_SIGNATURE_HEADER = "x-smartpr-signature";

export function signWebhookPayload(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
}

/** Constant-time comparison of "sha256=<hex>" signatures. */
export function verifyWebhookSignature(
  secret: string,
  body: string,
  signature: string | null | undefined
): boolean {
  if (!signature || !secret) return false;
  const expected = signWebhookPayload(secret, body);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// Security posture
// ---------------------------------------------------------------------------

export interface SsoTestResult {
  success: boolean;
  checked_at: string;
  details: Record<string, unknown>;
}

export interface SecurityPosture {
  workspace_id: string;
  sso: {
    enabled: boolean;
    domain: string | null;
    provider_id: string | null;
    verified_at: string | null;
    verification_fresh: boolean;
    last_successful_login: string | null;
    enforcement: "disabled" | "enabled";
    test: SsoTestResult | null;
  };
  policies: {
    session_minutes: number;
    mfa_policy: string;
    auto_provision: boolean;
    default_role: string;
  };
  group_mappings: Array<{ group: string; role: string }>;
}

const ENFORCEMENT_TEST_FRESHNESS_DAYS = 30;

/** True when a verified_at timestamp is recent enough to allow enforcement. */
export function canEnableEnforcement(verifiedAt: string | null, nowMs = Date.now()): boolean {
  if (!verifiedAt) return false;
  const t = Date.parse(verifiedAt);
  if (Number.isNaN(t)) return false;
  return nowMs - t <= ENFORCEMENT_TEST_FRESHNESS_DAYS * 24 * 60 * 60 * 1000;
}

function parseGroupMappings(raw: unknown): Array<{ group: string; role: string }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m) => m && typeof m === "object")
    .map((m) => ({
      group: String((m as Record<string, unknown>).group ?? ""),
      role: String((m as Record<string, unknown>).role ?? ""),
    }))
    .filter((m) => m.group.length > 0);
}

/**
 * Full security posture for a workspace. Never includes secrets — only
 * status booleans, timestamps, and policy values.
 */
export async function getSecurityPosture(
  workspaceId: string,
  pool?: Queryable | null
): Promise<SecurityPosture> {
  const p = pool === undefined ? getPool() : pool;
  if (!p) throw new Error("no_database");
  const { rows } = await p.query(
    `SELECT sso_enabled, sso_domain, sso_provider_id,
            sso_verified_at, sso_last_successful_login, sso_enforcement,
            session_minutes, mfa_policy, auto_provision, sso_default_role,
            sso_group_mappings,
            login_branding -> 'sso_test' AS sso_test
       FROM workspace_branding WHERE workspace_id = $1`,
    [workspaceId]
  );
  const r = (rows[0] ?? {}) as Record<string, unknown>;
  const verifiedAt =
    r.sso_verified_at instanceof Date
      ? r.sso_verified_at.toISOString()
      : typeof r.sso_verified_at === "string"
        ? r.sso_verified_at
        : null;
  const lastLogin =
    r.sso_last_successful_login instanceof Date
      ? r.sso_last_successful_login.toISOString()
      : typeof r.sso_last_successful_login === "string"
        ? r.sso_last_successful_login
        : null;
  let test: SsoTestResult | null = null;
  try {
    const rawTest =
      typeof r.sso_test === "string" ? JSON.parse(r.sso_test) : (r.sso_test as unknown);
    if (rawTest && typeof rawTest === "object" && "success" in rawTest) {
      test = rawTest as SsoTestResult;
    }
  } catch {
    test = null;
  }
  return {
    workspace_id: workspaceId,
    sso: {
      enabled: r.sso_enabled === true,
      domain: typeof r.sso_domain === "string" ? r.sso_domain : null,
      provider_id: typeof r.sso_provider_id === "string" ? r.sso_provider_id : null,
      verified_at: verifiedAt,
      verification_fresh: canEnableEnforcement(verifiedAt),
      last_successful_login: lastLogin,
      enforcement: r.sso_enforcement === "enabled" ? "enabled" : "disabled",
      test,
    },
    policies: {
      session_minutes:
        typeof r.session_minutes === "number" && r.session_minutes > 0
          ? r.session_minutes
          : 480,
      mfa_policy:
        typeof r.mfa_policy === "string" && r.mfa_policy ? r.mfa_policy : "optional",
      auto_provision: r.auto_provision === true,
      default_role:
        typeof r.sso_default_role === "string" && r.sso_default_role
          ? r.sso_default_role
          : "contributor",
    },
    group_mappings: parseGroupMappings(r.sso_group_mappings),
  };
}

// ---------------------------------------------------------------------------
// SCIM bearer-token auth (service_accounts with the 'scim' scope)
// ---------------------------------------------------------------------------

export interface ScimAccount {
  id: string;
  workspace_id: string;
  name: string;
  scopes: string[];
}

export type ScimAuthResult =
  | { ok: true; account: ScimAccount }
  | { ok: false; status: 401 | 403 | 503; reason: string };

/** Extract the bearer token from an Authorization header. */
export function extractBearerToken(
  headers: { get: (name: string) => string | null }
): string | null {
  const h = headers.get("authorization") || headers.get("Authorization");
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1].trim() : null;
}

/**
 * Validate a SCIM request's bearer token against service_accounts.
 * Requires the 'scim' scope; rejects revoked/expired credentials; updates
 * last_used_at on success (best-effort). Comparisons are constant-time.
 */
export async function authenticateScimRequest(
  req: { headers: { get: (name: string) => string | null } },
  pool?: Queryable | null
): Promise<ScimAuthResult> {
  const p = pool === undefined ? getPool() : pool;
  if (!p) return { ok: false, status: 503, reason: "database unavailable" } as ScimAuthResult;

  const token = extractBearerToken(req.headers);
  if (!token) {
    return { ok: false, status: 401, reason: "missing bearer token" };
  }

  const tokenHash = sha256Hex(token);
  let rows: Array<Record<string, unknown>> = [];
  try {
    const res = await p.query(
      `SELECT id::text AS id, workspace_id::text AS workspace_id, name, scopes,
              credential_hash, expires_at, last_used_at, revoked
         FROM service_accounts WHERE credential_hash = $1 LIMIT 1`,
      [tokenHash]
    );
    rows = res.rows;
  } catch {
    return { ok: false, status: 503, reason: "database unavailable" } as ScimAuthResult;
  }

  const row = rows[0];
  if (!row || typeof row.credential_hash !== "string") {
    return { ok: false, status: 401, reason: "invalid token" };
  }
  // Constant-time compare even though the SQL already matched (defense in depth).
  const stored = Buffer.from(String(row.credential_hash), "utf8");
  const presented = Buffer.from(tokenHash, "utf8");
  if (stored.length !== presented.length || !timingSafeEqual(stored, presented)) {
    return { ok: false, status: 401, reason: "invalid token" };
  }
  if (row.revoked === true) {
    return { ok: false, status: 401, reason: "credential revoked" };
  }
  const expiresAt =
    row.expires_at instanceof Date
      ? row.expires_at
      : typeof row.expires_at === "string"
        ? new Date(row.expires_at)
        : null;
  if (expiresAt && !Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() <= Date.now()) {
    return { ok: false, status: 401, reason: "credential expired" };
  }
  const scopes = Array.isArray(row.scopes) ? row.scopes.map(String) : [];
  if (!scopes.includes("scim")) {
    return { ok: false, status: 403, reason: "missing 'scim' scope" };
  }

  // Best-effort usage stamp; never blocks the request.
  try {
    await p.query(`UPDATE service_accounts SET last_used_at = now() WHERE id = $1`, [row.id]);
  } catch {
    /* non-fatal */
  }

  return {
    ok: true,
    account: {
      id: String(row.id),
      workspace_id: String(row.workspace_id),
      name: String(row.name ?? ""),
      scopes,
    },
  };
}

// ---------------------------------------------------------------------------
// SCIM role/group mapping helpers
// ---------------------------------------------------------------------------

/** Enterprise role -> legacy workspace_members role (best-effort bridge). */
export const ENTERPRISE_TO_LEGACY_ROLE: Record<string, "OWNER" | "ADMIN" | "MEMBER" | "VIEWER"> = {
  org_owner: "OWNER",
  org_admin: "ADMIN",
  compliance_executive: "ADMIN",
  compliance_manager: "ADMIN",
  facility_manager: "ADMIN",
  billing_admin: "ADMIN",
  contributor: "MEMBER",
  evidence_reviewer: "MEMBER",
  external_counsel: "MEMBER",
  auditor: "VIEWER",
};

export function enterpriseRoleToLegacy(role: string): "OWNER" | "ADMIN" | "MEMBER" | "VIEWER" {
  return ENTERPRISE_TO_LEGACY_ROLE[role] ?? "MEMBER";
}

export interface GroupMapping {
  group: string;
  role: RoleKey;
}

/** Resolve the enterprise role for a SCIM group name via sso_group_mappings. */
export function roleForScimGroup(
  groupName: string,
  mappings: Array<{ group: string; role: string }>,
  defaultRole: string
): RoleKey {
  const hit = mappings.find(
    (m) => m.group.toLowerCase() === String(groupName).toLowerCase()
  );
  if (hit && isRoleKey(hit.role)) return hit.role;
  return isRoleKey(defaultRole) ? defaultRole : "contributor";
}

// ---------------------------------------------------------------------------
// Audit helper for Phase 6 mutations
// ---------------------------------------------------------------------------

export async function auditSecurityEvent(
  pool: Queryable | null,
  req: { headers: { get: (name: string) => string | null } },
  event: {
    actorUserId?: string | null;
    workspaceId?: string | null;
    action: string;
    targetType?: string | null;
    targetId?: string | null;
    before?: unknown;
    after?: unknown;
    source?: string;
    reason?: string | null;
  }
): Promise<void> {
  const meta = getRequestMeta(req);
  await writeAuditEvent(pool, {
    actorUserId: event.actorUserId ?? null,
    workspaceId: event.workspaceId ?? null,
    action: event.action,
    targetType: event.targetType ?? null,
    targetId: event.targetId ?? null,
    before: event.before,
    after: event.after,
    ip: meta.ip,
    userAgent: meta.userAgent,
    correlationId: meta.correlationId,
    source: event.source ?? "api",
    reason: event.reason ?? null,
  });
}
