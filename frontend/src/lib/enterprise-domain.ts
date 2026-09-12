// ============================================================================
// Enterprise custom-domain verification — Phase 8.
//
// Pure helpers for the domain verification state machine:
//   pending -> verifying -> active | failed
//
// A domain is NEVER marked active until a DNS TXT lookup of
// `_smartpr-challenge.<domain>` returns the issued token. A TLS probe is
// recorded honestly alongside (ok/failed) but DNS is the verification gate.
// ============================================================================

export type DomainStatus = "pending" | "verifying" | "active" | "failed";
export type TlsStatus = "ok" | "failed" | "unchecked" | "unknown";

export const CHALLENGE_HOST_PREFIX = "_smartpr-challenge";

const HOSTNAME_RE =
  /^(?=.{1,253}$)(?!-)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.(?!-)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/**
 * Normalize a user-supplied domain: lowercase, strip scheme/path/port,
 * validate hostname format. Returns null when invalid.
 */
export function normalizeDomain(input: unknown): string | null {
  if (typeof input !== "string") return null;
  let d = input.trim().toLowerCase();
  if (!d) return null;
  d = d.replace(/^https?:\/\//, "").split("/")[0].split("?")[0].split("#")[0];
  // Strip a trailing port, but keep IPv6-ish inputs out (we only support
  // hostnames for custom domains).
  const lastColon = d.lastIndexOf(":");
  if (lastColon > 0 && d.indexOf(":") === lastColon && /:\d+$/.test(d)) {
    d = d.slice(0, lastColon);
  }
  if (!HOSTNAME_RE.test(d)) return null;
  // The final label must contain a letter: rejects IPv4 literals and other
  // all-numeric TLDs, which are not valid custom domains.
  const tld = d.split(".").pop() || "";
  if (!/[a-z]/.test(tld)) return null;
  return d;
}

/** True when the value is a plausible hostname (same rules as normalize). */
export function isValidHostname(input: unknown): boolean {
  return normalizeDomain(input) !== null;
}

/** The TXT hostname clients must publish, e.g. `_smartpr-challenge.acme.com`. */
export function challengeHostname(domain: string): string {
  return `${CHALLENGE_HOST_PREFIX}.${domain}`;
}

/** DNS TXT resolver shape (node:dns/promises `resolveTxt` satisfies this). */
export type TxtResolver = (hostname: string) => Promise<string[][]>;

export interface DnsVerifyOutcome {
  matched: boolean;
  records: string[];
  error: string | null;
}

/**
 * Look up the challenge TXT record and search every record chunk for the
 * expected token. Any DNS failure is reported as a non-match with an error
 * message (the caller records status=failed + last_error).
 */
export async function verifyDomainDns(
  domain: string,
  token: string,
  resolveTxt: TxtResolver
): Promise<DnsVerifyOutcome> {
  const host = challengeHostname(domain);
  let raw: string[][];
  try {
    raw = await resolveTxt(host);
  } catch (e) {
    return { matched: false, records: [], error: `DNS lookup failed for ${host}: ${(e as Error).message}` };
  }
  const records = (raw || []).flat().map(String);
  const matched = records.some((r) => r.includes(token));
  return {
    matched,
    records,
    error: matched ? null : `No TXT record at ${host} contains the verification token.`,
  };
}

export interface TlsCheckOutcome {
  tlsStatus: "ok" | "failed" | "unchecked";
  detail: string;
}

/** HTTPS probe shape; defaults to a real node:https GET with a timeout. */
export type HttpsProber = (domain: string, timeoutMs: number) => Promise<void>;

/**
 * Default TLS probe: HTTPS GET https://<domain>/ with a short timeout.
 * Any response (even an HTTP error status) counts as TLS ok — the check is
 * about certificate/TLS reachability, not content.
 */
export function defaultHttpsProbe(domain: string, timeoutMs: number): Promise<void> {
  // Lazy require keeps this module importable in edge/test contexts.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const https = require("node:https") as typeof import("node:https");
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      req.destroy();
      reject(new Error(`timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    const req = https.get(
      { hostname: domain, port: 443, path: "/", timeout: timeoutMs },
      (res) => {
        clearTimeout(timer);
        res.resume();
        resolve();
      }
    );
    req.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

export async function checkTls(
  domain: string,
  probe: HttpsProber = defaultHttpsProbe,
  timeoutMs = 8000
): Promise<TlsCheckOutcome> {
  try {
    await probe(domain, timeoutMs);
    return { tlsStatus: "ok", detail: `HTTPS reachable at https://${domain}/` };
  } catch (e) {
    const err = e as Error & { code?: string };
    // The domain does not resolve, so TLS cannot be assessed at all: record
    // an honest, documented "unchecked" rather than a failed TLS check.
    if (err.code === "ENOTFOUND" || err.code === "EAI_AGAIN") {
      return {
        tlsStatus: "unchecked",
        detail: `TLS probe could not complete: ${domain} does not resolve (${err.message})`,
      };
    }
    return { tlsStatus: "failed", detail: `HTTPS probe failed: ${err.message}` };
  }
}

// ---------------------------------------------------------------------------
// Status machine
// ---------------------------------------------------------------------------

export interface VerifyTransition {
  from: DomainStatus;
  dnsMatched: boolean;
  to: DomainStatus;
  tlsStatus: TlsStatus | null;
}

/**
 * Pure status-machine transition for a verification attempt.
 *
 * - DNS match  -> verifying (while TLS is probed). A domain is reported
 *   `active` ONLY after the DNS match AND the TLS probe result is handled:
 *     TLS ok        -> active
 *     TLS unchecked -> active, with the documented reason recorded (the probe
 *                      was attempted but the domain does not resolve, so TLS
 *                      could not be assessed)
 *     TLS failed    -> stays verifying; never active
 * - DNS mismatch / lookup error -> failed (+ last_error).
 */
export function transitionOnDnsResult(
  from: DomainStatus,
  dnsMatched: boolean
): Pick<VerifyTransition, "to" | "tlsStatus"> {
  if (!dnsMatched) return { to: "failed", tlsStatus: null };
  return { to: "verifying", tlsStatus: null };
}

/** Final transition once the TLS probe completes after a DNS match.
 * A TLS failure NEVER yields `active`: the domain stays `verifying` with
 * tls_status='failed' until HTTPS succeeds. */
export function transitionAfterTls(
  tlsStatus: TlsStatus
): Pick<VerifyTransition, "to" | "tlsStatus"> & { note: string | null } {
  if (tlsStatus === "ok") {
    return { to: "active", tlsStatus: "ok", note: null };
  }
  if (tlsStatus === "unchecked") {
    return {
      to: "active",
      tlsStatus: "unchecked",
      note: "TLS probe was attempted but the domain does not resolve, so TLS could not be assessed; DNS ownership is verified.",
    };
  }
  return {
    to: "verifying",
    tlsStatus: "failed",
    note: "DNS verified, but the HTTPS check failed; the domain stays in verifying (never active) until HTTPS succeeds.",
  };
}

/** Statuses from which a (re)verification attempt may start. */
export function canAttemptVerification(status: DomainStatus): boolean {
  return status === "pending" || status === "verifying" || status === "failed";
}
