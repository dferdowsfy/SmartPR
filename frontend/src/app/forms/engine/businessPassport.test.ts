// Business Passport — enter-once mapping coverage for key package forms.
// Run: node --experimental-strip-types --test src/app/forms/engine/businessPassport.test.ts
import test from "node:test";
import assert from "node:assert/strict";

import { emptyCanonicalData, type CanonicalApplicationData } from "./types.ts";
import {
  BUSINESS_PASSPORT_FIELDS,
  canonicalFromBusinessRow,
  mergePreferFilled,
  passportCoverage,
  passportJsonFromCanonical,
  passportMappingCoverage,
  resolvePopulationProfile,
  worksheetPrefillFromPassport,
} from "./businessPassport.ts";
import { readCanonicalField } from "../artifacts/canonicalFields.ts";
import { loadMapping } from "../artifacts/mappingStore.ts";

const KEY_FORMS = ["CORPREG01", "SS4", "PA01", "PA02", "SC2309", "NC001", "DACOUC01"] as const;

function fullPassportProfile(): CanonicalApplicationData {
  const profile = emptyCanonicalData();
  profile.business.legalName = "Sabor Bayamón Inc.";
  profile.business.tradeName = "Sabor Bayamón";
  profile.business.entityType = "stock_corporation";
  profile.business.formationStatus = "not_formed";
  profile.business.ein = "66-1234567";
  profile.business.naicsCode = "722511";
  profile.business.activityDescription = "Full-service restaurant";
  profile.business.incorporationDate = "2026-01-15";
  profile.business.operationsStartDate = "2026-03-01";
  profile.business.email = "hola@sabor.example";
  profile.business.phone = "787-555-0142";
  profile.business.registryNumber = "12345";
  profile.business.merchantRegistrationNumber = "RC-999";
  profile.contact.fullName = "María Rivera Colón";
  profile.contact.email = "maria@sabor.example";
  profile.contact.phone = "787-555-0199";
  profile.contact.role = "President";
  profile.addresses.municipality = "Bayamón";
  profile.addresses.mailingSameAsPhysical = true;
  profile.addresses.operatingAddress = {
    line1: "125 Calle Comercio",
    cityOrMunicipality: "Bayamón",
    stateOrTerritory: "PR",
    postalCode: "00961",
    country: "Puerto Rico",
  };
  profile.addresses.principalPhysical = profile.addresses.operatingAddress;
  profile.business.employeeCount = 10;
  profile.operations.employeeCount = 10;
  profile.property.occupancyType = "leased";
  profile.property.ownerName = "Comercio Realty LLC";
  return profile;
}

test("passport field set covers identity, contact, addresses, and registry facts", () => {
  assert.ok(BUSINESS_PASSPORT_FIELDS.includes("business.legal_name"));
  assert.ok(BUSINESS_PASSPORT_FIELDS.includes("business.ein"));
  assert.ok(BUSINESS_PASSPORT_FIELDS.includes("business.naics_code"));
  assert.ok(BUSINESS_PASSPORT_FIELDS.includes("location.municipality"));
  assert.ok(BUSINESS_PASSPORT_FIELDS.includes("owner.full_name"));
  assert.ok(BUSINESS_PASSPORT_FIELDS.includes("business.incorporation_date"));
});

test("canonicalFromBusinessRow prefers filled passport_json over denormalized columns", () => {
  const profile = fullPassportProfile();
  const row = {
    legal_name: "Stale Name LLC",
    municipality: "San Juan",
    business_structure: "llc",
    passport_json: passportJsonFromCanonical(profile),
  };
  const resolved = canonicalFromBusinessRow(row);
  assert.equal(resolved.business.legalName, "Sabor Bayamón Inc.");
  assert.equal(resolved.addresses.municipality, "Bayamón");
  assert.equal(resolved.business.ein, "66-1234567");
  assert.equal(readCanonicalField(resolved, "location.physical_address"), "125 Calle Comercio, Bayamón, PR, 00961");
});

test("resolvePopulationProfile: filled passport wins over empty request fields", () => {
  const business = {
    passport_json: passportJsonFromCanonical(fullPassportProfile()),
  };
  const request = emptyCanonicalData();
  request.business.legalName = ""; // empty must not wipe passport
  request.business.email = "override@example.com"; // but request-only gaps... wait passport wins when filled
  const resolved = resolvePopulationProfile({ business, requestProfile: request });
  assert.equal(resolved.business.legalName, "Sabor Bayamón Inc.");
  // Passport email is filled, so it wins over request override by design.
  assert.equal(resolved.business.email, "hola@sabor.example");
});

test("resolvePopulationProfile: request fills passport gaps", () => {
  const thin = emptyCanonicalData();
  thin.business.legalName = "Thin Co";
  const request = emptyCanonicalData();
  request.business.ein = "66-0000001";
  request.contact.fullName = "Ada López";
  const resolved = resolvePopulationProfile({
    business: { passport_json: passportJsonFromCanonical(thin) },
    requestProfile: request,
  });
  assert.equal(resolved.business.legalName, "Thin Co");
  assert.equal(resolved.business.ein, "66-0000001");
  assert.equal(resolved.contact.fullName, "Ada López");
});

test("empty passport fields stay unanswered (never invented)", () => {
  const empty = canonicalFromBusinessRow({ legal_name: "Only Name Inc." });
  const coverage = passportCoverage(empty);
  assert.ok(coverage.filled.includes("business.legal_name"));
  assert.ok(coverage.empty.includes("business.ein"));
  assert.equal(readCanonicalField(empty, "business.ein"), undefined);
  assert.equal(readCanonicalField(empty, "owner.tax_id"), undefined);
});

test("key package forms map passport fields and populate when filled", () => {
  const profile = fullPassportProfile();
  const coverage = passportMappingCoverage([...KEY_FORMS], profile);

  for (const formCode of KEY_FORMS) {
    const mapped = coverage[formCode].mappedPassportFields;
    assert.ok(
      mapped.length > 0,
      `${formCode} should map at least one passport field`
    );
    assert.ok(
      mapped.includes("business.legal_name") || mapped.includes("owner.full_name"),
      `${formCode} should map legal name or owner from passport (got ${mapped.join(",")})`
    );
    // Every mapped passport field that the profile answers is reported filled.
    for (const field of mapped) {
      const value = readCanonicalField(profile, field);
      if (value !== undefined) {
        assert.ok(
          coverage[formCode].filledFromPassport.includes(field),
          `${formCode}: ${field} should be filledFromPassport`
        );
      }
    }

    const doc = loadMapping(formCode);
    assert.ok(doc, `${formCode} mapping missing`);
    // At least one mapped passport field must have a non-empty value on a full profile.
    assert.ok(
      coverage[formCode].filledFromPassport.length > 0,
      `${formCode} should fill at least one mapped passport field from a full profile`
    );
  }
});

test("worksheet prefill bridge exposes passport facts under legacy keys", () => {
  const prefill = worksheetPrefillFromPassport(fullPassportProfile());
  assert.equal(prefill.name, "Sabor Bayamón Inc.");
  assert.equal(prefill.trade_name, "Sabor Bayamón");
  assert.equal(prefill.ein, "66-1234567");
  assert.equal(prefill.municipality, "Bayamón");
  assert.equal(prefill.contact_name, "María Rivera Colón");
  assert.equal(prefill.number_of_employees, 10);
});

test("mergePreferFilled does not treat empty string as an override", () => {
  const merged = mergePreferFilled(
    { a: "keep", nested: { b: "keep-b" } },
    { a: "", nested: { b: "new-b", c: "add" } }
  );
  assert.equal(merged.a, "keep");
  assert.equal(merged.nested.b, "new-b");
  assert.equal(merged.nested.c, "add");
});
