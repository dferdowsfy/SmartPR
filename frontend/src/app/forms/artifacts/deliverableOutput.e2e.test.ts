// ============================================================================
// Deliverable-output verification.
// Run: node --experimental-strip-types --test src/app/forms/artifacts/deliverableOutput.e2e.test.ts
//
// Does SmartPR actually populate the preloaded government forms?
//
// The population engine reports which fields it wrote. Asserting on that report
// only proves the code took a branch. These tests instead reopen the produced
// bytes with an independent reader and pull the content back out:
//
//   pdf_overlay (CORPREG01, CORPLLC02, SC2309) → pdf.js text extraction
//   acroform    (SS4, PA02, PA03, PA04)        → pdf-lib form-field read-back
//
// Each populated value is also checked against the BLANK template, so a match
// proves population put it there rather than it being government boilerplate.
// ============================================================================

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { resolveApplicableArtifacts } from "./applicability.ts";
import { getTemplate, isOfficialArtifact } from "./catalog.ts";
import { FORM_REGISTRY, getDefinition } from "../engine/registry.ts";
import { ArtifactGenerationError, generateWorkingCopy } from "./library.ts";
import { extractPdfText, pdfTextContains, readAcroFormValues } from "./pdfReadback.ts";
import { resolveRepoPath, sha256 } from "./paths.ts";
import { emptyCanonicalData, type CanonicalApplicationData, type FormData } from "../engine/types.ts";

// Deliberately distinctive values: none of these strings occur in a blank
// government form, so finding them in the output can only mean SmartPR wrote
// them there.
const APPLICANT = {
  legalName: "Sabor Bayamón Inc.",
  tradeName: "Sabor Bayamón",
  agent: "María Rivera Colón",
  street: "125 Calle Comercio",
  municipality: "Bayamón",
  postalCode: "00961",
  email: "hola@saborbayamon.com",
  phone: "787-555-0142",
  ein: "66-1234567",
  merchantNumber: "MRC-4471902",
  taxpayerId: "CTM-8890-BAY",
  activity: "Full-service restaurant with indoor and outdoor seating.",
} as const;

const ADDRESS = {
  line1: APPLICANT.street,
  cityOrMunicipality: APPLICANT.municipality,
  stateOrTerritory: "PR",
  postalCode: APPLICANT.postalCode,
  country: "US",
};

/** A fully answered restaurant profile — the state a user reaches before filing. */
function applicantProfile(): CanonicalApplicationData {
  const profile = emptyCanonicalData();

  profile.business.legalName = APPLICANT.legalName;
  profile.business.tradeName = APPLICANT.tradeName;
  profile.business.entityType = "stock_corporation";
  profile.business.formationStatus = "not_formed";
  profile.business.activityDescription = APPLICANT.activity;
  profile.business.email = APPLICANT.email;
  profile.business.phone = APPLICANT.phone;
  profile.business.ein = APPLICANT.ein;
  profile.business.merchantRegistrationNumber = APPLICANT.merchantNumber;
  profile.business.incorporationDate = "2026-09-15";
  profile.business.operationsStartDate = "2026-10-01";
  profile.business.employeeCount = 10;

  profile.contact = {
    fullName: APPLICANT.agent,
    email: APPLICANT.email,
    phone: APPLICANT.phone,
    role: "President",
  };

  profile.addresses.principalPhysical = ADDRESS;
  profile.addresses.operatingAddress = ADDRESS;
  profile.addresses.mailingSameAsPhysical = true;
  profile.addresses.municipality = APPLICANT.municipality;

  const party = { physicalAddress: ADDRESS, mailingSameAsPhysical: true };
  profile.parties.residentAgent = { id: "a", fullName: APPLICANT.agent, ...party };
  profile.parties.incorporators = [{ id: "i", fullName: APPLICANT.agent, ...party }];
  profile.parties.directors = [{ id: "d", fullName: APPLICANT.agent, ...party }];
  profile.parties.authorizedSigners = [{ id: "s", fullName: APPLICANT.agent, ...party }];

  profile.filingPreferences.existenceTerm = "perpetual";
  profile.filingPreferences.effectiveDateChoice = "filing_date";

  profile.operations.employeeCount = 10;
  profile.operations.estimatedAnnualPayroll = 285000;
  profile.operations.estimatedAnnualGrossReceipts = 940000;
  profile.operations.municipalTaxpayerId = APPLICANT.taxpayerId;
  profile.operations.fiscalYearEnd = "12-31";

  profile.activities.foodService = true;
  profile.activities.outdoorSeating = true;
  // Alcohol makes the Hacienda licence artifact (SC 2309) genuinely applicable.
  profile.activities.alcoholSales = true;

  return profile;
}

/** The same applicant, formed as an LLC — the only entity type CORPLLC02 serves. */
function llcProfile(): CanonicalApplicationData {
  const profile = applicantProfile();
  profile.business.entityType = "limited_liability_company";
  return profile;
}

/** Text of the untouched original on disk, for "was it already there?" checks. */
async function blankTemplateText(formCode: string): Promise<string> {
  const template = getTemplate(formCode);
  assert.ok(template?.sourceFile, `${formCode} has no source file`);
  const bytes = new Uint8Array(readFileSync(resolveRepoPath(template.sourceFile)));
  return extractPdfText(bytes);
}

// --- Official overlay artifacts ---------------------------------------------

test("CORPREG01: the delivered certificate physically contains the applicant's data", async () => {
  const result = await generateWorkingCopy({
    formCode: "CORPREG01",
    profile: applicantProfile(),
    purpose: "filing",
  });

  assert.equal(result.populationMethod, "pdf_overlay");
  assert.ok(result.bytes.length > 0, "no bytes produced");

  const delivered = await extractPdfText(result.bytes);
  const blank = await blankTemplateText("CORPREG01");

  // Each value must be in the delivered copy AND absent from the blank form —
  // together that is proof SmartPR wrote it, not the government's boilerplate.
  for (const value of [
    APPLICANT.legalName,
    APPLICANT.agent,
    APPLICANT.street,
    APPLICANT.postalCode,
    APPLICANT.email,
  ]) {
    assert.ok(pdfTextContains(delivered, value), `"${value}" is missing from the delivered CORPREG01`);
    assert.ok(!pdfTextContains(blank, value), `"${value}" was already in the blank template — not a real population check`);
  }
});

test("CORPREG01: accented characters survive into the delivered PDF", async () => {
  const result = await generateWorkingCopy({
    formCode: "CORPREG01",
    profile: applicantProfile(),
    purpose: "filing",
  });
  const delivered = await extractPdfText(result.bytes);
  // Asserted unfolded: this catches an encoding bug that accent-folded
  // comparisons elsewhere in this file would forgive.
  assert.ok(delivered.includes("Bayamón"), "the ó was lost writing the municipality");
  assert.ok(delivered.includes("María"), "the í was lost writing the resident agent");
});

test("SC2309: the alcohol licence artifact is populated from the same profile", async () => {
  const profile = applicantProfile();

  // It is only worth delivering because the profile makes it applicable.
  const applicable = resolveApplicableArtifacts(profile).map((a) => a.formCode);
  assert.ok(applicable.includes("SC2309"), "alcohol sales should make SC 2309 applicable");

  const result = await generateWorkingCopy({ formCode: "SC2309", profile, purpose: "filing" });
  const delivered = await extractPdfText(result.bytes);
  const blank = await blankTemplateText("SC2309");

  for (const value of [APPLICANT.legalName, APPLICANT.merchantNumber, APPLICANT.ein]) {
    assert.ok(pdfTextContains(delivered, value), `"${value}" is missing from the delivered SC 2309`);
    assert.ok(!pdfTextContains(blank, value), `"${value}" was already in the blank SC 2309`);
  }
});

test("the engine does not over-report: every field it claims to have written is in the output", async () => {
  const result = await generateWorkingCopy({
    formCode: "CORPREG01",
    profile: applicantProfile(),
    purpose: "filing",
  });
  const delivered = await extractPdfText(result.bytes);

  assert.ok(result.populated.length >= 10, `expected a well-populated certificate, got ${result.populated.length}`);

  const missing = result.populated
    // Multi-line values (address blocks, party lists) are drawn as separate
    // runs; check them line by line rather than as one string.
    .flatMap((field) => field.value.split(/\r?\n/).map((line) => ({ field, line: line.trim() })))
    .filter(({ line }) => line.length > 2)
    .filter(({ line }) => !pdfTextContains(delivered, line))
    .map(({ field, line }) => `${field.pdfField} → "${line}"`);

  assert.deepEqual(missing, [], "the engine reported writing values that are not in the delivered PDF");
});

// --- AcroForm artifacts ------------------------------------------------------

test("PA02/PA03/PA04: values read back through the PDF form API", async () => {
  for (const formCode of ["PA02", "PA03", "PA04"]) {
    // Genericized municipal layouts are development-only artifacts; the guard
    // covering that is asserted separately below.
    const result = await generateWorkingCopy({
      formCode,
      profile: applicantProfile(),
      purpose: "development",
    });
    assert.equal(result.populationMethod, "acroform", `${formCode} should populate native fields`);

    const values = await readAcroFormValues(result.bytes);
    const readBack = Object.values(values).join(" | ");

    assert.ok(
      pdfTextContains(readBack, APPLICANT.legalName),
      `${formCode}: the legal name did not read back out of the form fields`
    );
    assert.ok(
      pdfTextContains(readBack, APPLICANT.municipality),
      `${formCode}: the municipality did not read back out of the form fields`
    );

    // A blank template reads back as empty; a populated one must not.
    const nonEmpty = Object.values(values).filter((v) => v.trim().length > 0);
    assert.ok(nonEmpty.length >= 5, `${formCode}: only ${nonEmpty.length} fields carry a value`);
  }
});

test("CORPLLC02: the LLC certificate is populated from an LLC profile", async () => {
  const profile = llcProfile();

  const applicable = resolveApplicableArtifacts(profile).map((a) => a.formCode);
  assert.ok(applicable.includes("CORPLLC02"), "an LLC should reach its own certificate");
  assert.ok(!applicable.includes("CORPREG01"), "an LLC must not be handed the stock-corporation form");

  const result = await generateWorkingCopy({ formCode: "CORPLLC02", profile, purpose: "filing" });
  assert.equal(result.populationMethod, "pdf_overlay");

  const delivered = await extractPdfText(result.bytes);
  const blank = await blankTemplateText("CORPLLC02");
  for (const value of [APPLICANT.legalName, APPLICANT.agent, APPLICANT.street, APPLICANT.email]) {
    assert.ok(pdfTextContains(delivered, value), `"${value}" is missing from the delivered CORPLLC02`);
    assert.ok(!pdfTextContains(blank, value), `"${value}" was already in the blank CORPLLC02`);
  }
});

test("CORPLLC02: the signature and attestation-date blanks are never auto-filled", async () => {
  const result = await generateWorkingCopy({ formCode: "CORPLLC02", profile: llcProfile(), purpose: "filing" });
  const written = result.populated.map((f) => f.pdfField);
  for (const field of written) {
    assert.doesNotMatch(field, /signature|attestation_(day|month|year)/i, `${field} must be left for the filer to sign`);
  }
});

test("SS-4: the EIN application is populated on the real IRS form", async () => {
  const result = await generateWorkingCopy({ formCode: "SS4", profile: applicantProfile(), purpose: "filing" });
  assert.equal(result.populationMethod, "acroform");

  const values = await readAcroFormValues(result.bytes);
  const readBack = Object.values(values).join(" | ");
  for (const value of [APPLICANT.legalName, APPLICANT.tradeName, APPLICANT.agent, APPLICANT.municipality]) {
    assert.ok(pdfTextContains(readBack, value), `SS-4: "${value}" did not read back out of the form fields`);
  }

  // Line 12 asks for the closing MONTH, so an "MM-DD" year end must be trimmed.
  const closingMonth = result.populated.find((f) => f.pdfField.endsWith("f1_32[0]"));
  assert.equal(closingMonth?.value, "12", "line 12 should carry the month alone, not a month-day pair");
});

test("SS-4: builder-only and transient answers populate every applicable IRS line", async () => {
  const formData: FormData = {
    legal_name: APPLICANT.legalName,
    trade_name: APPLICANT.tradeName,
    mailing_address: ADDRESS,
    street_address_different: false,
    principal_location: "Bayamón, PR",
    responsible_party_name: APPLICANT.agent,
    responsible_party_tin: "123-45-6789",
    is_llc: "no",
    entity_classification: "corporation",
    corporation_return_form: "1120",
    incorporation_location_type: "foreign_country",
    incorporation_foreign_country: "Puerto Rico",
    reason_for_applying: "started_new_business",
    reason_detail: "Restaurant",
    date_business_started: "2026-10-01",
    closing_month: "12",
    agricultural_employee_count: 0,
    household_employee_count: 0,
    other_employee_count: 10,
    form_944_election: false,
    first_wage_date_or_na: "2026-10-15",
    principal_activity_category: "food_service",
    principal_activity_line: APPLICANT.activity,
    previous_ein_received: "no",
    use_third_party_designee: "no",
    signer_name_and_title: `${APPLICANT.agent}, President`,
    applicant_phone: APPLICANT.phone,
  };
  const result = await generateWorkingCopy({ formCode: "SS4", profile: applicantProfile(), formData, purpose: "filing" });
  const values = await readAcroFormValues(result.bytes);
  const readBack = Object.values(values).join(" | ");

  for (const expected of [
    "Bayamón, PR 00961",
    "123-45-6789",
    "1120",
    "Puerto Rico",
    "Restaurant",
    "2026-10-15",
    `${APPLICANT.agent}, President`,
  ]) {
    assert.ok(pdfTextContains(readBack, expected), `SS-4 builder value "${expected}" was not written to the official PDF`);
  }
  assert.equal(
    result.populated.find((entry) => entry.pdfField.endsWith("f1_11[0]"))?.value,
    "[provided]",
    "population metadata must not copy the responsible party's raw taxpayer identifier"
  );
  assert.ok(
    !values["topmostSubform[0].Page1[0].f1_7[0]"],
    "line 5 must stay blank when the applicant says the physical and mailing addresses are the same"
  );
  assert.deepEqual(
    result.populated.filter((entry) => entry.pdfField.includes("c1_6[")).map((entry) => entry.pdfField),
    ["topmostSubform[0].Page1[0].c1_6[5]"],
    "the builder must leave exactly one principal-activity checkbox selected"
  );
  assert.equal(result.unanswered.length, 0, "non-applicable SS-4 alternatives must not be counted as missing required answers");
});

test("SS-4: identifiers and determinations SmartPR cannot make are left blank", async () => {
  const result = await generateWorkingCopy({ formCode: "SS4", profile: applicantProfile(), purpose: "filing" });
  const written = new Set(result.populated.map((f) => f.pdfField));

  // 7b SSN/ITIN — a government identifier SmartPR never stores.
  assert.ok(!written.has("topmostSubform[0].Page1[0].f1_11[0]"), "the responsible party's SSN/ITIN must stay blank");
  // 8c / 9b — federal tax determinations for the filer or their CPA.
  for (const field of ["c1_2[0]", "c1_2[1]", "f1_21[0]", "f1_22[0]"]) {
    assert.ok(
      !written.has(`topmostSubform[0].Page1[0].${field}`),
      `${field} is a tax determination and must not be auto-answered`
    );
  }
  // Nothing at all is written on page 2, which is the signature block.
  assert.ok(!result.populated.some((f) => f.pdfField.includes("Page2")), "page 2 carries the signature block");
});

test("SS-4 line 9a: an LLC is not assigned a federal tax classification", async () => {
  const corp = await generateWorkingCopy({ formCode: "SS4", profile: applicantProfile(), purpose: "filing" });
  const corpFields = new Set(corp.populated.map((f) => f.pdfField));
  // A stock corporation checks 9a "Corporation" and answers 8a "No".
  assert.ok(corpFields.has("topmostSubform[0].Page1[0].c1_3[4]"));
  assert.ok(corpFields.has("topmostSubform[0].Page1[0].c1_1[1]"));

  const llc = await generateWorkingCopy({ formCode: "SS4", profile: llcProfile(), purpose: "filing" });
  const llcFields = new Set(llc.populated.map((f) => f.pdfField));
  // An LLC answers 8a "Yes" but leaves every 9a box alone: the right one
  // depends on its federal tax election, which the profile does not carry.
  assert.ok(llcFields.has("topmostSubform[0].Page1[0].c1_1[0]"), "8a should be Yes for an LLC");
  const nineA = [...llcFields].filter((f) => f.includes("c1_3["));
  assert.deepEqual(nineA, [], "no 9a entity-type box may be checked for an LLC");
});

// --- What the UI download promises -------------------------------------------

test("every displayable form holding an official template can actually produce it", async () => {
  // The form modal decides what to download from exactly this catalog lookup:
  // when an official template exists it waits for the populated agency PDF and
  // refuses to substitute the SmartPR worksheet. That promise only holds if
  // every such form is genuinely producible — otherwise the download is a dead
  // end. This walks the same registry the UI walks.
  const displayable = FORM_REGISTRY.filter((entry) => entry.displayForm);
  assert.ok(displayable.length > 0, "no displayable forms in the registry");

  const checked: string[] = [];
  for (const entry of displayable) {
    const definition = getDefinition(entry.id);
    assert.ok(definition, `${entry.id} is displayable but has no definition`);
    const template = getTemplate(definition.officialFormNumber);
    if (!template || !isOfficialArtifact(template)) continue;

    const profile = definition.variantKey === "limited_liability_company" ? llcProfile() : applicantProfile();
    const result = await generateWorkingCopy({
      formCode: definition.officialFormNumber,
      profile,
      purpose: "filing",
    });
    assert.ok(result.bytes.length > 0, `${definition.officialFormNumber} produced no bytes`);
    assert.ok(
      result.populated.length > 0,
      `${definition.officialFormNumber} produced an entirely blank form — the download would hand over an empty PDF`
    );
    checked.push(definition.officialFormNumber);
  }

  // Guards against the set silently emptying (e.g. a catalog rename), which
  // would make this test vacuously pass.
  assert.deepEqual(checked.sort(), ["CBP301", "CORPLLC02", "CORPREG01", "DACOUC01", "EPAFORM1", "EPAFORM2C", "LUMAINT01", "NC001", "PA01", "PA02", "SS4"]);
});

// --- Safety invariants -------------------------------------------------------

test("generating a deliverable never modifies the canonical original on disk", async () => {
  const codes = ["CORPREG01", "CORPLLC02", "SS4", "SC2309", "NC001", "PA01", "PA02", "PA03", "PA04"];
  const before = codes.map((code) => {
    const template = getTemplate(code);
    return sha256(new Uint8Array(readFileSync(resolveRepoPath(template!.sourceFile!))));
  });

  for (const code of codes) {
    await generateWorkingCopy({
      formCode: code,
      profile: code === "CORPLLC02" ? llcProfile() : applicantProfile(),
      // Official codes accept "filing"; genericized ones only "development".
      purpose: code.startsWith("PA") ? "development" : "filing",
    });
  }

  const after = codes.map((code) => {
    const template = getTemplate(code);
    return sha256(new Uint8Array(readFileSync(resolveRepoPath(template!.sourceFile!))));
  });
  assert.deepEqual(after, before, "a template file changed while producing working copies");
});

test("a genericized municipal template cannot be delivered as a filing artifact", async () => {
  // PA02 is deliberately absent: it is an official statewide OCAM form, not a
  // genericized municipal layout. PA03/PA04 remain genericized working copies.
  for (const formCode of ["PA03", "PA04"]) {
    await assert.rejects(
      () => generateWorkingCopy({ formCode, profile: applicantProfile(), purpose: "filing" }),
      ArtifactGenerationError,
      `${formCode} must not be presentable as an official municipal form`
    );
  }
});
