import test from "node:test";
import assert from "node:assert/strict";
import { applyPassportProposals, PASSPORT_EXTRACTION_FIELDS, passportExtractionPrompt, validatePassportProposals } from "./passportExtraction.ts";
import { emptyCanonicalData } from "../../forms/engine/types.ts";
import { setCanonicalValue } from "../../forms/engine/canonicalMapping.ts";
import { readPath } from "../../forms/engine/formConditions.ts";
import { canonicalFromBusinessRow, passportJsonFromCanonical } from "../../forms/engine/businessPassport.ts";

// These are deterministic extraction-contract fixtures, not claims about live
// model accuracy. The route suite additionally exercises real handlers with a
// mocked xAI transport; live voice acceptance still requires credentials/audio.
export const fixtures = [
  { text: "My legal entity name is Caribe Foods LLC.", values: { legalName: "Caribe Foods LLC" } },
  { text: "We're an LLC already formed in Puerto Rico.", values: { entityType: "LLC", formationStatus: "formed_in_puerto_rico" } },
  { text: "My EIN is 66-1234567 and we have twelve employees.", values: { ein: "66-1234567", employeeCount: 12 } },
  { text: "Our primary contact is Maria Rivera. Her email is maria@example.com and her phone is 787-555-1212.", values: { contactFullName: "Maria Rivera", contactEmail: "maria@example.com", contactPhone: "787-555-1212" } },
  { text: "Our physical address is 123 Main Street, San Juan, Puerto Rico 00901 and our mailing address is the same.", values: { "principalPhysical.line1": "123 Main Street", "principalPhysical.cityOrMunicipality": "San Juan", "principalPhysical.stateOrTerritory": "Puerto Rico", "principalPhysical.postalCode": "00901", mailingSameAsPhysical: true } },
  { text: "We lease the property. The owner is José Rivera and it's approximately 4,500 square feet.", values: { occupancyType: "Leased", ownerName: "José Rivera", squareFootage: 4500 } },
  { text: "Somos una LLC, ya formada en Puerto Rico, tenemos 15 empleados y el EIN es 66-1234567.", values: { entityType: "LLC", formationStatus: "formed_in_puerto_rico", employeeCount: 15, ein: "66-1234567" } },
  { text: "My trade name is Caribe Kitchen.", values: { tradeName: "Caribe Kitchen" } },
  { text: "El nombre legal es Caribe Holdings LLC. Somos una LLC. Ya está registrada en Puerto Rico. Tenemos doce empleados. El EIN es 66-1234567. El local es alquilado. El número catastral es 040-012-345-67.", values: { legalName: "Caribe Holdings LLC", entityType: "LLC", formationStatus: "formed_in_puerto_rico", employeeCount: 12, ein: "66-1234567", occupancyType: "alquilado", cadastralNumber: "040-012-345-67" } },
  { text: "My legal entity name is Caribe Foods LLC. My trade name is Caribe Kitchen. We're an LLC already formed in Puerto Rico. The EIN is 66-1234567. We have 12 employees. Our primary contact is Maria Rivera, her email is maria@caribekitchen.com and her phone number is 787-555-1234.", values: { legalName: "Caribe Foods LLC", tradeName: "Caribe Kitchen", entityType: "LLC", formationStatus: "formed_in_puerto_rico", ein: "66-1234567", employeeCount: 12, contactFullName: "Maria Rivera", contactEmail: "maria@caribekitchen.com", contactPhone: "787-555-1234" } },
];
const rows = (values: Record<string, unknown>, evidence: string) => Object.entries(values).map(([fieldId, value]) => ({ fieldId, value, evidence, confidence: 0.99 }));
function extract(values: Record<string, unknown>, text: string) { return validatePassportProposals(rows(values, text), text, "en"); }

for (const [i, fixture] of fixtures.entries()) {
  test(`dictation ${i + 1}: ${fixture.text}`, () => {
    const proposals = extract(fixture.values, fixture.text);
    assert.equal(proposals.length, Object.keys(fixture.values).length);
    const result = applyPassportProposals(emptyCanonicalData(), proposals, [], ["entityType", "formationStatus"]);
    assert.equal(result.conflicts.length, 0);
    assert.equal(result.applied.length, proposals.length);
    const stored = canonicalFromBusinessRow({ passport_json: passportJsonFromCanonical(result.next) });
    for (const p of proposals) assert.equal(readPath(stored, p.canonicalKey), p.value);
  });
}

test("one field leaves all unrelated fields and arrays untouched", () => {
  const base = emptyCanonicalData();
  base.contact.fullName = "Typed contact";
  base.property.ownerName = "Typed owner";
  const next = applyPassportProposals(base, extract({ ein: "66-1234567" }, "My EIN is 66-1234567")).next;
  assert.deepEqual(next, { ...base, business: { ...base.business, ein: "66-1234567", einPending: false } });
  assert.equal(base.business.ein, undefined);
});

test("existing values require confirmation, equal formatted EIN is unchanged", () => {
  const base = emptyCanonicalData();
  base.business.legalName = "Existing LLC";
  base.business.ein = "661234567";
  const proposals = extract({ legalName: "New LLC", ein: "66-1234567" }, "My legal name is New LLC and my EIN is 66-1234567");
  const result = applyPassportProposals(base, proposals);
  assert.equal(result.next, base);
  assert.equal(result.conflicts.length, 1);
  const confirmed = applyPassportProposals(base, proposals, result.conflicts);
  assert.equal(confirmed.next.business.legalName, "New LLC");
  assert.equal(confirmed.next.business.ein, "661234567");
});

test("editing while confirmation is open invalidates earlier approval", () => {
  const base = emptyCanonicalData(); base.business.legalName = "Original";
  const proposals = extract({ legalName: "Spoken LLC" }, "Legal name is Spoken LLC");
  const review = applyPassportProposals(base, proposals);
  const typed = setCanonicalValue(base, "business.legalName", "Manual edit");
  const result = applyPassportProposals(typed, proposals, review.conflicts);
  assert.equal(result.next.business.legalName, "Manual edit");
  assert.equal(result.conflicts[0].previous, "Manual edit");
});

test("partial addresses merge leaves without confusing physical/mail/operating scopes", () => {
  const base = emptyCanonicalData();
  base.addresses.principalPhysical = { line1: "Existing street", cityOrMunicipality: "San Juan", postalCode: "", country: "US" };
  const p = extract({ "principalPhysical.postalCode": "00901", "operatingAddress.line1": "500 Avenida Central", "operatingAddress.cityOrMunicipality": "Bayamón", "operatingAddress.postalCode": "00961" }, "Our physical address postal code is 00901. Our operating address is 500 Avenida Central, Bayamón 00961.");
  const result = applyPassportProposals(base, p);
  assert.equal(result.next.addresses.principalPhysical?.line1, "Existing street");
  assert.equal(result.next.addresses.principalPhysical?.postalCode, "00901");
  assert.equal(result.next.addresses.operatingAddress?.cityOrMunicipality, "Bayamón");
  assert.equal(result.next.addresses.principalMailing, undefined);
  assert.equal(result.next.addresses.operatingAddress?.country, "");
});

test("pending EIN uses existing flag and requires confirmation before clearing an EIN", () => {
  const p = extract({ einPending: true }, "I don't have an EIN yet.");
  assert.equal(applyPassportProposals(emptyCanonicalData(), p).next.business.einPending, true);
  const base = emptyCanonicalData(); base.business.ein = "66-1234567";
  const review = applyPassportProposals(base, p);
  assert.equal(review.next.business.ein, "66-1234567");
  const confirmed = applyPassportProposals(base, p, review.conflicts);
  assert.equal(confirmed.next.business.ein, undefined);
  assert.equal(confirmed.next.business.einPending, true);
});

test("explicit false and zero are existing values, not empty", () => {
  const base = emptyCanonicalData(); base.business.employeeCount = 0; base.addresses.mailingSameAsPhysical = false;
  const result = applyPassportProposals(base, extract({ employeeCount: 12, mailingSameAsPhysical: true }, "We have 12 employees. Mailing is the same."));
  assert.equal(result.conflicts.length, 2);
});

test("known default selections are fillable; explicitly saved defaults need confirmation", () => {
  const p = extract({ formationStatus: "formed_in_puerto_rico" }, "Already formed in Puerto Rico");
  assert.equal(applyPassportProposals(emptyCanonicalData(), p).conflicts.length, 1);
  assert.equal(applyPassportProposals(emptyCanonicalData(), p, [], ["formationStatus"]).next.business.formationStatus, "formed_in_puerto_rico");
});

test("ambiguous corporation, hypothetical values, invented numbers and dates are rejected", () => {
  assert.deepEqual(extract({ entityType: "stock_corporation" }, "We're a corporation."), []);
  assert.deepEqual(extract({ ein: "66-1234567" }, "Maybe our EIN is 66-1234567?"), []);
  assert.deepEqual(extract({ employeeCount: 99 }, "We have twelve employees."), []);
  assert.deepEqual(extract({ incorporationDate: "2024-02-30" }, "February 30, 2024"), []);
  assert.deepEqual(extract({ incorporationDate: "2024-03-01" }, "January 1, 2024"), []);
  assert.deepEqual(extract({ incorporationDate: "2024-03-01" }, "03/01/2024"), []);
  assert.deepEqual(extract({ employeeCount: -1 }, "-1 employees"), []);
  assert.deepEqual(extract({ employeeCount: 2.5 }, "2.5 employees"), []);
});

test("unknown/arbitrary keys, object injection, numeric identifiers and absent evidence rejected", () => {
  assert.deepEqual(extract({ occupancyType: "__proto__" }, "Other property ownership."), []);
  const transcript = "My legal name is Caribe LLC. EIN 001234567";
  assert.deepEqual(validatePassportProposals([
    { fieldId: "__proto__.polluted", value: "yes", confidence: 1, evidence: transcript },
    { fieldId: "legalName", value: { toString: "Caribe LLC" }, confidence: 1, evidence: transcript },
    { fieldId: "ein", value: 1234567, confidence: 1, evidence: transcript },
    { fieldId: "tradeName", value: "Made up", confidence: 1, evidence: "Not in transcript" },
    { fieldId: "registryNumber", value: "001234567", confidence: 0.6, evidence: transcript },
  ], transcript, "en"), []);
  const p = extract({ legalName: "Caribe LLC" }, transcript)[0];
  assert.equal(applyPassportProposals(emptyCanonicalData(), [{ ...p, canonicalKey: "__proto__.polluted" }]).applied.length, 0);
});

test("identifiers retain leading zeros and formatting; Spanish normalization works", () => {
  const text = "El EIN es 00-1234567. Registro de Estado 000045. Hacienda 000078. El número catastral es 040-012-345-67. NAICS 072251. El local es alquilado. El correo es maria arroba example punto com. Formación 1 de enero de 2024.";
  const p = extract({ ein: "00-1234567", registryNumber: "000045", merchantRegistrationNumber: "000078", cadastralNumber: "040-012-345-67", naicsCode: "072251", occupancyType: "alquilado", email: "maria@example.com", incorporationDate: "2024-01-01" }, text);
  assert.equal(p.length, 8);
  assert.equal(p.find((x) => x.fieldId === "registryNumber")?.value, "000045");
  assert.equal(p.find((x) => x.fieldId === "occupancyType")?.value, "leased");
});

test("contradictory proposals for one field require clarification, not first/last wins", () => {
  const text = "My name is A LLC or B LLC";
  assert.deepEqual(validatePassportProposals([...rows({ legalName: "A LLC" }, text), ...rows({ legalName: "B LLC" }, text)], text, "en"), []);
});

test("catalog includes every Passport UI field, all address components and unavailable EIN", () => {
  assert.equal(PASSPORT_EXTRACTION_FIELDS.length, 45);
  assert.equal(new Set(PASSPORT_EXTRACTION_FIELDS.map((f) => f.canonicalKey)).size, 45);
  assert.match(passportExtractionPrompt(), /English, Spanish, or mixed-language/);
  for (const field of PASSPORT_EXTRACTION_FIELDS) assert.ok(passportExtractionPrompt().includes(field.id));
});

test("remaining business/contact/property fields and all three complete address scopes are accepted", () => {
  const parts: Array<[string, unknown, string]> = [
    ["jurisdictionOfFormation", "Delaware", "We formed the company in Delaware."],
    ["formationStatus", "formed_outside_puerto_rico", "We formed the company in Delaware."],
    ["forProfitStatus", "non-profit", "We're a non-profit."],
    ["purpose", "Food preparation and catering", "Our purpose is Food preparation and catering."],
    ["email", "entity@example.com", "Our entity email is entity@example.com."],
    ["phone", "787-555-0100", "Our main telephone is 787-555-0100."],
    ["operationsStartDate", "2027-01-05", "We start operations January 5, 2027."],
    ["contactRole", "Manager", "Our primary contact's role is Manager."],
    ["municipality", "Bayamón", "Our operating municipality is Bayamón."],
  ];
  for (const scope of ["principalPhysical", "principalMailing", "operatingAddress"]) {
    for (const [part, value] of Object.entries({ line1: "123 Main Street", line2: "Suite 4", cityOrMunicipality: "San Juan", stateOrTerritory: "PR", postalCode: "00901", country: "US" })) {
      parts.push([`${scope}.${part}`, value, `Our ${scope} is 123 Main Street, Suite 4, San Juan, PR 00901, US.`]);
    }
  }
  const transcript = parts.map(([, , evidence]) => evidence).join(" ");
  const proposals = validatePassportProposals(parts.map(([fieldId, value, evidence]) => ({ fieldId, value, evidence, confidence: 0.99 })), transcript, "en");
  assert.equal(proposals.length, parts.length);
});

test("all explicit corporation subtypes work; a name suffix never establishes structure", () => {
  const field = PASSPORT_EXTRACTION_FIELDS.find((f) => f.id === "entityType")!;
  for (const option of field.options!) {
    const evidence = `Our entity type is ${option.label.en}.`;
    assert.equal(extract({ entityType: option.value }, evidence)[0]?.value, option.value);
  }
  assert.deepEqual(extract({ entityType: "limited_liability_company" }, "Our legal name is Caribe LLC."), []);
});

test("employee count conflicts include stored operations count and confirmation updates both consumers", () => {
  const base = emptyCanonicalData(); base.operations.employeeCount = 2;
  const proposals = extract({ employeeCount: 12 }, "We have twelve employees.");
  const review = applyPassportProposals(base, proposals);
  assert.equal(review.next.operations.employeeCount, 2);
  assert.equal(review.conflicts.length, 1);
  const confirmed = applyPassportProposals(base, proposals, review.conflicts);
  assert.equal(confirmed.next.business.employeeCount, 12);
  assert.equal(confirmed.next.operations.employeeCount, 12);
});
