import { test } from "node:test";
import assert from "node:assert/strict";
import { blockerCount, missingFieldsFor, passportPatchFor, specForKey, validateMissingValue } from "./missingRequirements";
import { coverageHit, type FilingOption } from "./agencyActions";
import { classifyWorkflows, missingCount } from "./claraWorkspaceModel";
import { flattenPassportValues } from "./prefillFromPassport";
import { canonicalFromBusinessRow, mergePreferFilled, passportJsonFromCanonical } from "../../app/forms/engine/businessPassport";

function filing(missing: { id: string; sensitive?: boolean }[], over: Partial<FilingOption> = {}): FilingOption {
  return {
    id: "DEMO", obligation_id: "o1", agency_id: "DEMO_REHEARSAL", agency_en: "Demo", agency_es: "Demo", title_en: "Demo", title_es: "Demo",
    supported: true, filing_status: missing.some((m) => !m.sensitive) ? "missing_information" : "ready_to_start",
    action: { missing_items: missing.map((m) => ({ id: m.id, label_en: m.id, label_es: m.id, sensitive: Boolean(m.sensitive) })), blocked_by: [] },
    ...over,
  } as unknown as FilingOption;
}

const KEYS = [
  "business.legalName", "business.tradeName", "business.entityType", "business.ein", "business.registryNumber",
  "contact.fullName", "contact.email", "contact.phone", "addresses.principalPhysical.line1",
  "addresses.principalPhysical.postalCode", "addresses.municipality", "addresses.state",
];
const SAMPLE: Record<string, string> = {
  "business.legalName": "Café Luna LLC", "business.tradeName": "Café Luna", "business.entityType": "limited_liability_company",
  "business.ein": "661234567", "business.registryNumber": "123456", "contact.fullName": "Ana Pérez", "contact.email": "ana@example.com",
  "contact.phone": "787-555-0100", "addresses.principalPhysical.line1": "1 Calle Sol", "addresses.principalPhysical.postalCode": "00901",
  "addresses.municipality": "San Juan", "addresses.state": "PR",
};

test("modal lists only this workflow's missing, non-sensitive fields", () => {
  const f = filing([{ id: "business.ein" }, { id: "contact.phone" }, { id: "ssn", sensitive: true }]);
  assert.deepEqual(missingFieldsFor(f).map((s) => s.key), ["business.ein", "contact.phone"]);
  assert.equal(blockerCount(f), 2);
  assert.equal(missingCount(f), 2, "sensitive run-time values never count as blockers");
});

test("validation uses SmartPR rules", () => {
  assert.ok(validateMissingValue(specForKey("contact.email"), "nope"));
  assert.equal(validateMissingValue(specForKey("contact.email"), "a@b.co"), null);
  assert.ok(validateMissingValue(specForKey("business.ein"), "12-34"));
  assert.equal(validateMissingValue(specForKey("business.ein"), "66-1234567"), null);
  assert.ok(validateMissingValue(specForKey("addresses.principalPhysical.postalCode"), "10001"));
  assert.ok(validateMissingValue(specForKey("business.entityType"), "bogus"));
  assert.ok(validateMissingValue(specForKey("business.legalName"), "  "));
});

test("every coverage key round-trips through the canonical Passport store and clears its blocker", () => {
  for (const key of KEYS) {
    const spec = specForKey(key);
    const patch = passportPatchFor([spec], { [key]: SAMPLE[key]! });
    // Same transform PATCH /api/businesses/[id] { passport, mergePassport } applies.
    const merged = mergePreferFilled({} as Record<string, unknown>, patch);
    const stored = passportJsonFromCanonical(canonicalFromBusinessRow({ passport_json: merged }));
    const reread = canonicalFromBusinessRow({ passport_json: stored });
    assert.ok(coverageHit(flattenPassportValues(reread as unknown as Record<string, unknown>), key), `${key} not satisfied after save`);
  }
});

test("EIN saved in canonical NN-NNNNNNN form", () => {
  assert.deepEqual(passportPatchFor([specForKey("business.ein")], { "business.ein": "661234567" }), { business: { ein: "66-1234567" } });
});

test("workflow readiness depends only on its own blockers", () => {
  const ready = filing([{ id: "ssn", sensitive: true }]);
  const notReady = filing([{ id: "contact.phone" }]);
  const c = classifyWorkflows([{ filings: [ready, notReady] } as never]);
  assert.equal(c.ready.length, 1);
  assert.equal(c.notReady.length, 1);
});
