import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractSessionToken,
  generateSessionToken,
  hashSessionToken,
  isGatewayAuthorized,
  renewedSessionExpiresAt,
  sessionExpiresAt,
  MAX_SESSION_ABSOLUTE_MINUTES,
  SESSION_TOKEN_PREFIX,
  SESSION_TTL_MINUTES,
} from "./session";

describe("session tokens", () => {
  it("generates unique prefixed tokens", () => {
    const a = generateSessionToken();
    const b = generateSessionToken();
    assert.ok(a.startsWith(SESSION_TOKEN_PREFIX));
    assert.notEqual(a, b);
    assert.ok(a.length > 40, "token should carry 256 bits of entropy");
  });

  it("hashes deterministically and hides the raw token", () => {
    const token = generateSessionToken();
    assert.equal(hashSessionToken(token), hashSessionToken(token));
    assert.ok(!hashSessionToken(token).includes(token.slice(3, 12)));
  });

  it("expires TTL minutes in the future", () => {
    const before = Date.now();
    const expires = sessionExpiresAt().getTime();
    const expected = before + SESSION_TTL_MINUTES * 60_000;
    assert.ok(Math.abs(expires - expected) < 1000);
  });

  it("extracts bearer session tokens only", () => {
    const token = generateSessionToken();
    assert.equal(extractSessionToken(`Bearer ${token}`), token);
    assert.equal(extractSessionToken("Bearer not-a-voice-token"), null);
    assert.equal(extractSessionToken(null), null);
    assert.equal(extractSessionToken("Token abc"), null);
  });
});

describe("renewedSessionExpiresAt", () => {
  it("extends by idle TTL early in the session", () => {
    const issuedAt = new Date("2026-01-01T00:00:00.000Z");
    const now = new Date("2026-01-01T00:10:00.000Z");
    const renewed = renewedSessionExpiresAt(issuedAt, now);
    assert.equal(
      renewed.toISOString(),
      new Date(now.getTime() + SESSION_TTL_MINUTES * 60_000).toISOString()
    );
  });

  it("caps renew at issued_at + absolute max near end of call", () => {
    const issuedAt = new Date("2026-01-01T00:00:00.000Z");
    // 100 minutes after issue: sliding would be +30 (=130) but absolute is 120
    const now = new Date("2026-01-01T01:40:00.000Z");
    const renewed = renewedSessionExpiresAt(issuedAt, now);
    const absolute =
      issuedAt.getTime() + MAX_SESSION_ABSOLUTE_MINUTES * 60_000;
    assert.equal(renewed.getTime(), absolute);
    assert.ok(renewed.getTime() < now.getTime() + SESSION_TTL_MINUTES * 60_000);
  });

  it("keeps SESSION_TTL as idle window and absolute at 120", () => {
    assert.equal(SESSION_TTL_MINUTES, 30);
    assert.equal(MAX_SESSION_ABSOLUTE_MINUTES, 120);
  });
});

describe("isGatewayAuthorized", () => {
  const secret = "test-gateway-secret";

  it("accepts the correct bearer secret", () => {
    assert.equal(isGatewayAuthorized(`Bearer ${secret}`, secret), true);
  });

  it("rejects wrong, missing, or malformed credentials", () => {
    assert.equal(isGatewayAuthorized("Bearer wrong", secret), false);
    assert.equal(isGatewayAuthorized(null, secret), false);
    assert.equal(isGatewayAuthorized(`Bearer ${secret}`, null), false);
    assert.equal(isGatewayAuthorized(`Bearer ${secret}`, undefined), false);
    assert.equal(isGatewayAuthorized("Basic abc", secret), false);
  });

  it("fails closed when no secret is configured", () => {
    assert.equal(isGatewayAuthorized("Bearer anything", ""), false);
  });
});
