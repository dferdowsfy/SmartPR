import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractSessionToken,
  generateSessionToken,
  hashSessionToken,
  isGatewayAuthorized,
  sessionExpiresAt,
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
