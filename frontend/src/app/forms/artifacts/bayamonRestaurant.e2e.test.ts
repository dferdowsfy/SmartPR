// End-to-end scenario test for the government-artifact engine.
// Run: node --experimental-strip-types --test src/app/forms/artifacts/bayamonRestaurant.e2e.test.ts
//
//   "I want to open a restaurant in Bayamón with 10 employees and outdoor seating."
//
// One intake sentence → canonical profile → applicable artifacts → populated
// working copies of the real government files.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { resolveApplicableArtifacts } from "./applicability.ts";
import { buildFilingPackage, itemStatusLabel } from "./filingPackage.ts";
import { applyExtraction, extractIntake } from "./intakeExtraction.ts";
import { loadMunicipalities } from "./kbLoader.ts";
import { generateWorkingCopy, loadAllMappings, outstandingQuestionsForProfile } from "./library.ts";
import { resolveRepoPath, sha256 } from "./paths.ts";
import { emptyCanonicalData, type CanonicalApplicationData } from "../engine/types.ts";

const DESCRIPTION = "I want to open a restaurant in Bayamón with 10 employees and outdoor seating.";

function seededProfile(): CanonicalApplicationData {
  return applyExtraction(extractIntake(DESCRIPTION, loadMunicipalities()), emptyCanonicalData());
}

/** The answers the user gives to the follow-up questions SmartPR still needs. */
function completedProfile(): CanonicalApplicationData {
  const profile = seededProfile();
  profile.business.legalName = "Sabor Bayamón Inc.";
  profile.business.tradeName = "Sabor Bayamón";
  profile.business.entityType = "stock_corporation";
  profile.business.formationStatus = "not_formed";
  profile.business.activityDescription = "Full-service restaurant with indoor and outdoor seating.";
  profile.business.email = "hola@saborbayamon.com";
  profile.business.phone = "787-555-0142";
  profile.business.operationsStartDate = "2026-10-01";
  profile.business.einPending = true;
  profile.contact = {
    fullName: "María Rivera Colón",
    email: "maria@saborbayamon.com",
    phone: "787-555-0142",
    role: "President",
  };
  const address = {
    line1: "125 Calle Comercio",
    cityOrMunicipality: "Bayamón",
    stateOrTerritory: "PR",
    postalCode: "00961",
    country: "US",
  };
  profile.addresses.operatingAddress = address;
  profile.addresses.principalPhysical = address;
  profile.addresses.mailingSameAsPhysical = true;
  profile.parties.residentAgent = { id: "a", fullName: "María Rivera Colón", physicalAddress: address, mailingSameAsPhysical: true };
  profile.parties.incorporators = [{ id: "i", fullName: "María Rivera Colón", physicalAddress: address }];
  profile.parties.directors = [{ id: "d", fullName: "María Rivera Colón", physicalAddress: address }];
  profile.parties.authorizedSigners = [{ id: "s", fullName: "María Rivera Colón", physicalAddress: address }];
  profile.filingPreferences.existenceTerm = "perpetual";
  profile.filingPreferences.effectiveDateChoice = "filing_date";
  profile.operations.estimatedAnnualPayroll = 285000;
  profile.operations.estimatedAnnualGrossReceipts = 940000;
  return profile;
}

test("intake extracts exactly the facts the sentence states", () => {
  const extraction = extractIntake(DESCRIPTION, loadMunicipalities());
  assert.equal(extraction.businessType, "restaurant");
  assert.equal(extraction.municipality, "Bayamón");
  assert.equal(extraction.employeeCount, 10);
  assert.equal(extraction.activities.outdoorSeating, true);
  assert.equal(extraction.activities.foodService, true);
  // Nothing beyond the sentence is invented.
  assert.equal(extraction.activities.alcoholSales, undefined);
  assert.equal(extraction.activities.entertainment, undefined);
});

test("SmartPR only asks for what the sentence did not answer", () => {
  const profile = seededProfile();
  const artifacts = resolveApplicableArtifacts(profile);
  const questions = outstandingQuestionsForProfile(profile, artifacts);
  const asked = questions.map((q) => q.canonicalField);
  assert.ok(asked.includes("business.legal_name"));
  assert.ok(asked.includes("business.entity_type"), "entity type decides which state artifact applies");
  assert.ok(asked.includes("owner.full_name"));
  assert.ok(asked.includes("location.physical_address"));
  assert.ok(!asked.includes("location.municipality"), "the municipality was already stated");
  assert.ok(!asked.includes("operations.employee_count"), "the headcount was already stated");
});

test("the restaurant's filing package holds the right artifacts and no others", () => {
  const profile = completedProfile();
  const artifacts = resolveApplicableArtifacts(profile);
  const codes = artifacts.map((a) => a.formCode ?? a.requirementCode).sort();
  assert.deepEqual(codes, ["CORPREG01", "PA02", "SS4"]);

  const pkg = buildFilingPackage({ profile, artifacts, mappings: loadAllMappings() });
  const dos = pkg.items.find((i) => i.formCode === "CORPREG01");
  const irs = pkg.items.find((i) => i.formCode === "SS4");
  const patente = pkg.items.find((i) => i.requirementCode === "DOC_PATENTE_MUNICIPAL");

  assert.ok(dos && irs && patente);
  assert.equal(dos.agency, "Puerto Rico Department of State");
  assert.equal(dos.presentableAsOfficial, true);
  assert.ok(dos.populatedCount >= 10, `expected a well-populated certificate, got ${dos.populatedCount}`);

  assert.equal(irs.agency, "Internal Revenue Service");
  // The official SS-4 is now in the template library, so the EIN application is
  // a real generatable artifact rather than a requirements-only placeholder.
  assert.equal(irs.availability, "official_form_available");
  assert.ok(irs.populatedCount > 0, "the profile answers several SS-4 lines");
  // Whatever the status, the label never claims the filing was accepted.
  assert.doesNotMatch(itemStatusLabel(irs), /approved|granted|officially accepted/i);

  // The official OCAM PA02 is a statewide form — one layout for every
  // municipality — so the patente is a real generatable artifact rather than a
  // requirements-only placeholder. The municipal caveat rides along in notes:
  // the form is statewide, the rates and the filing counter are not.
  assert.equal(patente.availability, "official_form_available");
  assert.equal(patente.canGenerateWorkingCopy, true);
  assert.equal(patente.formCode, "PA02");

  // Hacienda is absent: a restaurant with no licence-triggering activity.
  assert.equal(pkg.items.some((i) => i.formCode === "SC2309"), false);
});

test("the Department of State working copy is populated from the one profile", async () => {
  const profile = completedProfile();
  const templatePath = resolveRepoPath("RealForms/1-CORPREG01.pdf");
  const templateChecksumBefore = sha256(new Uint8Array(readFileSync(templatePath)));

  const result = await generateWorkingCopy({ formCode: "CORPREG01", profile, purpose: "filing" });
  const values = new Map(result.populated.map((p) => [p.pdfField, p.value]));
  assert.equal(values.get("first_corporation_name"), "Sabor Bayamón Inc.");
  assert.equal(values.get("second_designated_office_physical"), "125 Calle Comercio, Bayamón, PR, 00961");
  assert.equal(values.get("third_purpose"), "Full-service restaurant with indoor and outdoor seating.");
  assert.equal(values.get("seventh_term_perpetual_mark"), "X");
  assert.equal(values.get("contact_email"), "hola@saborbayamon.com");

  // Everything not answerable from the profile is reported, not guessed.
  const unanswered = result.unanswered.map((u) => u.pdfField);
  assert.ok(unanswered.includes("fourth_authorized_capital_stock"));

  assert.equal(
    sha256(new Uint8Array(readFileSync(templatePath))),
    templateChecksumBefore,
    "the canonical government file is untouched"
  );
});

test("switching the same restaurant to an LLC changes only the state artifact", () => {
  const profile = completedProfile();
  profile.business.entityType = "limited_liability_company";
  const artifacts = resolveApplicableArtifacts(profile);
  assert.ok(artifacts.some((a) => a.formCode === "CORPLLC02" && a.availability === "official_form_available"));
  assert.ok(!artifacts.some((a) => a.formCode === "CORPREG01"));
  assert.ok(artifacts.some((a) => a.requirementCode === "DOC_PATENTE_MUNICIPAL"));
  assert.ok(artifacts.some((a) => a.formCode === "SS4"));
});

test("adding alcohol sales to the same restaurant adds the Hacienda application", async () => {
  const profile = completedProfile();
  profile.activities.alcoholSales = true;
  const artifacts = resolveApplicableArtifacts(profile);
  const hacienda = artifacts.find((a) => a.formCode === "SC2309");
  assert.ok(hacienda, "SC 2309 becomes applicable once alcohol sales are reported");
  assert.equal(hacienda.agency, "Departamento de Hacienda");

  const result = await generateWorkingCopy({ formCode: "SC2309", profile, purpose: "filing" });
  const fields = result.populated.map((p) => p.pdfField);
  assert.ok(fields.includes("parte2_bebidas_alcoholicas"));
  assert.ok(fields.includes("parte1_nombre"));
});

test("the package never tells the restaurant its filing was approved", () => {
  const profile = completedProfile();
  const pkg = buildFilingPackage({ profile, artifacts: resolveApplicableArtifacts(profile), mappings: loadAllMappings() });
  const text = JSON.stringify(pkg).toLowerCase();
  for (const claim of ["approved", "granted", "government approved", "officially accepted"]) {
    assert.equal(text.includes(claim), false, `filing package must not claim "${claim}"`);
  }
});
