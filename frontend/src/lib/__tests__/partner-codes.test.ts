import test from "node:test";
import assert from "node:assert/strict";
import { normalizePartnerCode, PartnerCodeError } from "../partnerCodes";

test("normalizePartnerCode trims and uppercases", () => {
  assert.equal(normalizePartnerCode("  luyo-90  "), "LUYO-90");
  assert.equal(normalizePartnerCode(""), null);
  assert.equal(normalizePartnerCode(null), null);
  assert.equal(normalizePartnerCode("   "), null);
});

test("PartnerCodeError carries code + status", () => {
  const err = new PartnerCodeError("expired", "That partner code has expired.");
  assert.equal(err.code, "expired");
  assert.equal(err.status, 400);
  assert.match(err.message, /expired/i);
});
