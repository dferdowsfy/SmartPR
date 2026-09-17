import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  hashPin,
  isValidPinFormat,
  lockoutSecondsRemaining,
  verifyPin,
} from "./pin";

describe("isValidPinFormat", () => {
  it("accepts exactly 6 digits", () => {
    assert.equal(isValidPinFormat("123456"), true);
    assert.equal(isValidPinFormat("000000"), true);
  });

  it("rejects anything else", () => {
    assert.equal(isValidPinFormat("12345"), false);
    assert.equal(isValidPinFormat("1234567"), false);
    assert.equal(isValidPinFormat("12345a"), false);
    assert.equal(isValidPinFormat(""), false);
    assert.equal(isValidPinFormat(null), false);
    assert.equal(isValidPinFormat(undefined), false);
  });
});

describe("hashPin / verifyPin", () => {
  it("hashes and verifies a PIN", async () => {
    const hash = await hashPin("482916");
    assert.match(hash, /^scrypt\$16384\$8\$1\$/);
    assert.equal(await verifyPin("482916", hash), true);
  });

  it("rejects the wrong PIN", async () => {
    const hash = await hashPin("482916");
    assert.equal(await verifyPin("482917", hash), false);
  });

  it("never stores anything resembling the PIN", async () => {
    const hash = await hashPin("482916");
    assert.ok(!hash.includes("482916"), "hash must not contain the PIN");
  });

  it("uses a unique salt per hash", async () => {
    const a = await hashPin("482916");
    const b = await hashPin("482916");
    assert.notEqual(a, b);
  });

  it("refuses to hash an invalid PIN", async () => {
    await assert.rejects(() => hashPin("12345"), /6 digits/);
  });

  it("fails closed on malformed envelopes", async () => {
    assert.equal(await verifyPin("482916", "not-an-envelope"), false);
    assert.equal(await verifyPin("482916", ""), false);
    // Tampered hash portion
    const hash = await hashPin("482916");
    const tampered = `${hash.slice(0, -4)}AAAA`;
    assert.equal(await verifyPin("482916", tampered), false);
  });
});

describe("lockoutSecondsRemaining", () => {
  it("returns 0 for null / past lockouts", () => {
    assert.equal(lockoutSecondsRemaining(null), 0);
    assert.equal(lockoutSecondsRemaining(new Date(Date.now() - 1000)), 0);
  });

  it("returns positive seconds for a future lockout", () => {
    const remaining = lockoutSecondsRemaining(new Date(Date.now() + 60_000));
    assert.ok(remaining > 0 && remaining <= 60);
  });
});
