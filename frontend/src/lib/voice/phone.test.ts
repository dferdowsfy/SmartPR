import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { displayPhone, normalizePhone, samePhone } from "./phone";

describe("normalizePhone", () => {
  it("normalizes a 10-digit NANP number to E.164", () => {
    const result = normalizePhone("(787) 555-0142");
    assert.equal(result?.e164, "+17875550142");
    assert.equal(result?.display, "(787) 555-0142");
  });

  it("keeps an explicit country code", () => {
    const result = normalizePhone("+1 787-555-0142");
    assert.equal(result?.e164, "+17875550142");
  });

  it("accepts an 11-digit NANP number with trunk prefix", () => {
    assert.equal(normalizePhone("17875550142")?.e164, "+17875550142");
  });

  it("accepts non-NANP international numbers with a plus", () => {
    assert.equal(normalizePhone("+34 600 123 456")?.e164, "+34600123456");
  });

  it("rejects garbage input", () => {
    assert.equal(normalizePhone(""), null);
    assert.equal(normalizePhone(null), null);
    assert.equal(normalizePhone("abc"), null);
    assert.equal(normalizePhone("123"), null);
    assert.equal(normalizePhone("5550142"), null); // too short without country code
  });
});

describe("samePhone", () => {
  it("matches different formats of the same number", () => {
    assert.equal(samePhone("(787) 555-0142", "+17875550142"), true);
    assert.equal(samePhone("7875550142", "17875550142"), true);
  });

  it("distinguishes different numbers", () => {
    assert.equal(samePhone("(787) 555-0142", "(787) 555-0143"), false);
  });
});

describe("displayPhone", () => {
  it("formats NANP numbers", () => {
    assert.equal(displayPhone("+17875550142"), "(787) 555-0142");
  });

  it("passes through non-NANP numbers", () => {
    assert.equal(displayPhone("+34600123456"), "+34600123456");
  });
});
