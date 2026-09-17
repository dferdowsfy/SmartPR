import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  hashPin,
  isValidPinFormat,
  lockoutSecondsRemaining,
  normalizePinInput,
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

describe("normalizePinInput", () => {
  it("passes plain digits through", () => {
    assert.equal(normalizePinInput("123456"), "123456");
  });

  it("strips separators", () => {
    assert.equal(normalizePinInput("123 456"), "123456");
    assert.equal(normalizePinInput("123-456"), "123456");
    assert.equal(normalizePinInput("1 2 3 4 5 6"), "123456");
  });

  it("translates English digit words", () => {
    assert.equal(
      normalizePinInput("one two three four five six"),
      "123456"
    );
    assert.equal(normalizePinInput("ONE TWO THREE FOUR FIVE SIX"), "123456");
    assert.equal(normalizePinInput("zero nine eight"), "098");
  });

  it("translates Spanish digit words", () => {
    assert.equal(
      normalizePinInput("uno dos tres cuatro cinco seis"),
      "123456"
    );
    assert.equal(normalizePinInput("cero nueve"), "09");
  });

  it("handles mixed words and digits", () => {
    assert.equal(normalizePinInput("one 2 three 4 5 six"), "123456");
  });

  it("returns empty for non-digit input", () => {
    assert.equal(normalizePinInput("hello world"), "");
    assert.equal(normalizePinInput(""), "");
    assert.equal(normalizePinInput(null), "");
    assert.equal(normalizePinInput(undefined), "");
  });
});
