/**
 * Voice session tokens + trusted gateway authentication.
 *
 * Session tokens are opaque 256-bit bearer tokens ("vs_" + base64url).
 * Only the SHA-256 hash of a token is ever stored or compared; the raw
 * token is returned to the trusted voice gateway exactly once at issuance.
 *
 * The voice gateway (the Grok/xAI integration host) authenticates to the
 * phone lookup / PIN verification / session management endpoints with a
 * shared secret (VOICE_GATEWAY_API_KEY) presented as a Bearer token.
 * Comparison is timing-safe.
 *
 * TTL model:
 * - SESSION_TTL_MINUTES is a sliding idle window: each successful
 *   resolveVoiceContext renews expires_at to now + TTL (capped below).
 * - MAX_SESSION_ABSOLUTE_MINUTES is a hard cap from issued_at (aligned
 *   with xAI's ~2h max call). After the absolute cap the caller must re-PIN.
 */

import { createHash, randomBytes, timingSafeEqual } from "crypto";

export const SESSION_TOKEN_PREFIX = "vs_";
/** Sliding idle window: renewed on each successful context resolve. */
export const SESSION_TTL_MINUTES = 30;
/** Hard cap from issuance (aligns with xAI max call length). */
export const MAX_SESSION_ABSOLUTE_MINUTES = 120;

/** Generate a fresh opaque session token (returned to the gateway once). */
export function generateSessionToken(): string {
  return `${SESSION_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

/** SHA-256 hex digest used as the stored lookup key for a token. */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Initial expiry timestamp for a session issued at `from` (idle TTL only). */
export function sessionExpiresAt(from: Date = new Date()): Date {
  return new Date(from.getTime() + SESSION_TTL_MINUTES * 60_000);
}

/**
 * Sliding renew expiry: min(issued_at + absolute cap, now + idle TTL).
 * Used by resolveVoiceContext so long calls stay authenticated without
 * extending past the absolute session lifetime.
 */
export function renewedSessionExpiresAt(
  issuedAt: Date,
  now: Date = new Date()
): Date {
  const absolute = issuedAt.getTime() + MAX_SESSION_ABSOLUTE_MINUTES * 60_000;
  const sliding = now.getTime() + SESSION_TTL_MINUTES * 60_000;
  return new Date(Math.min(absolute, sliding));
}

/**
 * Validate the trusted gateway's shared secret. The secret must be
 * configured (VOICE_GATEWAY_API_KEY); an unconfigured secret fails closed.
 */
export function isGatewayAuthorized(
  authorizationHeader: string | null | undefined,
  secret: string | null | undefined = process.env.VOICE_GATEWAY_API_KEY ?? null
): boolean {
  if (!authorizationHeader || !secret) return false;
  const match = /^Bearer\s+(.+)$/.exec(authorizationHeader.trim());
  if (!match) return false;
  const presented = Buffer.from(match[1], "utf8");
  const expected = Buffer.from(secret, "utf8");
  if (presented.length !== expected.length) return false;
  return timingSafeEqual(presented, expected);
}

/** Extract a voice session token from an Authorization header. */
export function extractSessionToken(
  authorizationHeader: string | null | undefined
): string | null {
  if (!authorizationHeader) return null;
  const match = /^Bearer\s+(.+)$/.exec(authorizationHeader.trim());
  const token = match?.[1]?.trim();
  if (!token || !token.startsWith(SESSION_TOKEN_PREFIX)) return null;
  return token;
}
