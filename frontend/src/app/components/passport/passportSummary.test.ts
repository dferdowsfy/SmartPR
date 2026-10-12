// Business Passport card + guided-form prefill.
// Run: npx tsx --test src/app/components/passport/passportSummary.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { emptyCanonicalData } from "../../forms/engine/types.ts";
import { passportSummary, prefillFromPassport } from "./passportSummary.ts";
import { emptyDraft, guidedFormSections, mergeDraft } from "../clara/guidedFormModel.ts";

test("an empty passport counts every required detail as missing; filling one moves the count", () => {
  const c = emptyCanonicalData();
  const empty = passportSummary(c, "en");
  assert.ok(empty.total > 5);
  assert.equal(empty.done + empty.missing.length, empty.total);
  assert.ok(empty.missing.includes("Legal entity name"));
  c.business.legalName = "Café Luna LLC";
  const one = passportSummary(c, "en");
  assert.equal(one.done, empty.done + 1);
  assert.ok(!one.missing.includes("Legal entity name"));
  assert.ok(passportSummary(c, "es").missing.every((m) => m !== "Legal entity name"), "labels are localized");
});

test("prefill reads the passport first, the intake profile only as a fallback", () => {
  const c = emptyCanonicalData();
  c.business.legalName = "Café Luna LLC";
  c.contact.email = "ana@cafeluna.pr";
  c.addresses.principalPhysical = { line1: "Calle Sol 12", cityOrMunicipality: "Ponce", postalCode: "00730", country: "Puerto Rico" };
  const p = prefillFromPassport(c, { legalName: "Old name", phone: "787-555-0100" });
  assert.equal(p.legalName, "Café Luna LLC");
  assert.equal(p.email, "ana@cafeluna.pr");
  assert.equal(p.address, "Calle Sol 12, Ponce, 00730");
  assert.equal(p.phone, "787-555-0100");
});

test("a saved draft follows passport edits except where the user typed", () => {
  const sections = guidedFormSections({ key: "ein", name: "IRS EIN Confirmation Letter", agency: "IRS" }, "en");
  const before = emptyDraft(sections, { legalName: "Old LLC", email: "old@x.pr" });
  const saved = { ...before, values: { ...before.values, email: "typed@x.pr" }, edited: { email: true } };
  const merged = mergeDraft(emptyDraft(sections, { legalName: "New LLC", email: "new@x.pr" }), saved);
  assert.equal(merged.values.legal_name, "New LLC");
  assert.equal(merged.values.email, "typed@x.pr");
});
