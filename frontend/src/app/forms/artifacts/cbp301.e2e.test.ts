// ============================================================================
// CBP301 end-to-end: the UI schema must actually reach the official PDF.
//
// Same risk as pa02.e2e.test.ts / lumaint01.e2e.test.ts: CBP301's applicant-
// owned answers are coupled to the official PDF by BARE STRING pdfField IDS
// across two layers — `CBP301.ts` <-> `formDataPopulation.ts::cbp301Values()`
// <-> `form-mappings/CBP301.json`'s rows — with nothing but convention holding
// all three together. This file reads values back out of the generated PDF
// rather than trusting either side alone.
//
// Honest scope, covered by the definition's notices and the FORM-INVENTORY.md
// entry: the paper Form 301 is the legacy path (continuous bonds are filed
// electronically via eBond/ACE through the broker/surety), and CBP's own page
// notes the OMB approval is expired-but-still-valid.
// ============================================================================

import assert from "node:assert/strict";
import test from "node:test";

import { CBP301 } from "../definitions/federal/cbp/CBP301.ts";
import { getDefinition, getRegistryEntry } from "../engine/registry.ts";
import { resolveFormId } from "../engine/routing.ts";
import { prefillFromCanonical } from "../engine/canonicalMapping.ts";
import { validateForm } from "../engine/formValidation.ts";
import { emptyCanonicalData, type CanonicalApplicationData, type FormData } from "../engine/types.ts";
import { primaryStartLabelFor, secondaryUploadCopy } from "../../components/filing/requirementCopy.ts";
import { L } from "../../i18n.ts";
import { generateWorkingCopy } from "./library.ts";
import { pdfTextContains, readAcroFormValues } from "./pdfReadback.ts";

const P = "topmostSubform[0].Page1[0].";
const pdf = (name: string) => `${P}${name}`;

/** A San Juan import/export business posting a single-transaction bond. */
function importerProfile(): CanonicalApplicationData {
  const profile = emptyCanonicalData();
  profile.business.legalName = "Caribe Import & Export Inc.";
  profile.business.entityType = "stock_corporation";
  profile.business.ein = "66-1234567";
  profile.addresses.operatingAddress = {
    line1: "Ave. Kennedy 123",
    cityOrMunicipality: "San Juan",
    stateOrTerritory: "PR",
    postalCode: "00920",
    country: "Puerto Rico",
  };
  return profile;
}

/** A complete set of the applicant-owned answers the schema collects. */
function answers(overrides: FormData = {}): FormData {
  return {
    bond_type: "single",
    transaction_id: "ENTRY-2026-88417",
    transaction_date: "2026-09-10",
    port_code: "1001",
    activity_code: "1",
    limit_of_liability: 50000,
    execution_date: "2026-09-10",
    broker_filer_code: "ABC",
    bond_acknowledgement: true,
    ...overrides,
  };
}

function completeFormData(profile: CanonicalApplicationData, overrides: FormData = {}): FormData {
  return prefillFromCanonical(CBP301, profile, answers(overrides));
}

// --- registry + routing ------------------------------------------------------

test("CBP301 is served as a real schema, not a disabled placeholder", () => {
  const entry = getRegistryEntry("FORM_CBP_301");
  assert.ok(entry, "the CBP customs bond form is missing from the registry");
  assert.equal(entry.displayForm, true, "the CBP customs bond form must render");
  assert.equal(entry.requirementId, "DOC_CUSTOMS_BROKER_BOND");
  assert.equal(getDefinition("FORM_CBP_301")?.officialFormNumber, "CBP301");
});

test("DOC_CUSTOMS_BROKER_BOND routes to the CBP Form 301 for any entity type", () => {
  const canonical = emptyCanonicalData();
  assert.equal(resolveFormId("DOC_CUSTOMS_BROKER_BOND", canonical), "FORM_CBP_301");
  canonical.business.entityType = "sole_proprietorship";
  assert.equal(resolveFormId("DOC_CUSTOMS_BROKER_BOND", canonical), "FORM_CBP_301");
});

// --- the id contract with the PDF population layer, via cbp301Values() ------

test("every applicant answer the schema collects reaches the official PDF", async () => {
  const profile = importerProfile();
  const result = await generateWorkingCopy({
    formCode: "CBP301",
    profile,
    purpose: "filing",
    formData: completeFormData(profile),
  });
  // AcroForm values live in the form fields (pdf-lib read-back), not in the
  // page content stream — the same read-back pattern as the SS-4 tests.
  const values = await readAcroFormValues(result.bytes);
  const readBack = Object.values(values).join(" | ");

  // Principal identity, composed into the single "Name and Physical Address"
  // field from the prefilled form answers.
  assert.ok(pdfTextContains(readBack, "Caribe Import & Export Inc."), "principal name must reach the PDF");
  assert.ok(pdfTextContains(readBack, "Ave. Kennedy 123"), "principal address must reach the PDF");
  assert.ok(pdfTextContains(readBack, "66-1234567"), "CBP identification number (EIN) must reach the PDF");

  // Section I — single transaction.
  assert.ok(pdfTextContains(readBack, "ENTRY-2026-88417"), "transaction id must reach the PDF");
  assert.ok(pdfTextContains(readBack, "1001"), "port code must reach the PDF");
  assert.ok(pdfTextContains(readBack, "2026-09-10"), "execution date must reach the PDF");

  // Section II — activity 1 (Importer or broker) + limit of liability.
  assert.ok(pdfTextContains(readBack, "50000"), "limit of liability must reach the PDF");

  // Broker filer code.
  assert.ok(pdfTextContains(readBack, "ABC"), "broker filer code must reach the PDF");
});

test("exactly one Section I box is checked and the other stays unchecked", async () => {
  const profile = importerProfile();
  const result = await generateWorkingCopy({
    formCode: "CBP301",
    profile,
    purpose: "filing",
    formData: completeFormData(profile),
  });
  assert.ok(result.populated.some((p) => p.pdfField === pdf("single[0]") && p.value === "Yes"), "single must be checked");
  assert.ok(!result.populated.some((p) => p.pdfField === pdf("continuous[0]")), "continuous must stay unchecked");
});

test("a continuous bond checks the continuous box and writes the effective date", async () => {
  const profile = importerProfile();
  const result = await generateWorkingCopy({
    formCode: "CBP301",
    profile,
    purpose: "filing",
    formData: completeFormData(profile, {
      bond_type: "continuous",
      transaction_id: undefined,
      transaction_date: undefined,
      port_code: undefined,
      effective_date: "2026-10-01",
    }),
  });
  const values = await readAcroFormValues(result.bytes);
  const readBack = Object.values(values).join(" | ");
  assert.ok(result.populated.some((p) => p.pdfField === pdf("continuous[0]") && p.value === "Yes"), "continuous must be checked");
  assert.ok(!result.populated.some((p) => p.pdfField === pdf("single[0]")), "single must stay unchecked");
  assert.ok(pdfTextContains(readBack, "2026-10-01"), "effective date must reach the PDF");
  assert.ok(!result.populated.some((p) => p.pdfField === pdf("id100[0]")), "no transaction id on a continuous bond");
});

test("the activity choice checks exactly one box and clears stale liability amounts", async () => {
  const profile = importerProfile();
  const result = await generateWorkingCopy({
    formCode: "CBP301",
    profile,
    purpose: "filing",
    formData: completeFormData(profile, { activity_code: "2" }),
  });
  assert.ok(result.populated.some((p) => p.pdfField === pdf("code2[0]") && p.value === "Yes"), "code 2 must be checked");
  assert.ok(!result.populated.some((p) => p.pdfField === pdf("code1[0]")), "code 1 must stay unchecked");
  assert.ok(
    result.populated.some((p) => p.pdfField === pdf("LimitofLiability3[0]") && p.value === "50000"),
    "the liability amount must land on activity 2's field"
  );
  assert.ok(
    !result.populated.some((p) => p.pdfField === pdf("LimitofLiability1[0]")),
    "a stale amount on activity 1's field must be cleared"
  );
});

// --- fields SmartPR must never write -----------------------------------------

test("signatures and the CBP-assigned bond number are never populated", async () => {
  const profile = importerProfile();
  const result = await generateWorkingCopy({
    formCode: "CBP301",
    profile,
    purpose: "filing",
    formData: completeFormData(profile),
  });
  for (const field of ["SignatureField1[0]", "SignatureField2[0]", "bondno[0]"]) {
    assert.ok(
      !result.populated.some((p) => p.pdfField === pdf(field)),
      `${field} must never be written by SmartPR`
    );
  }
  assert.ok(
    result.unanswered.some((u) => u.pdfField === pdf("SignatureField1[0]") && u.reason === "signature_required"),
    "the principal signature must be reported as signature_required"
  );
  assert.ok(
    result.unanswered.some((u) => u.pdfField === pdf("bondno[0]") && u.reason === "government_only"),
    "the CBP-assigned bond number must be reported as government_only"
  );
  assert.ok(
    CBP301.notices?.some((notice) => /firma/i.test(notice.es ?? "")),
    "the form must tell the filer the signature lines are theirs to complete by hand"
  );
});

test("the form is honest about the eBond/ACE modern path and the OMB caveat", () => {
  assert.ok(
    CBP301.notices?.some((notice) => /ebond/i.test(notice.en ?? "")),
    "the form must disclose that continuous bonds are filed electronically via eBond/ACE"
  );
  assert.ok(
    CBP301.notices?.some((notice) => /1651-0050/.test(notice.en ?? "")),
    "the form must disclose the expired-but-valid OMB approval"
  );
});

// --- requirement-card copy ---------------------------------------------------

test("the customs bond requirement card names the CBP form in both languages", () => {
  assert.equal(primaryStartLabelFor("CBP Customs Broker Bond"), "Complete CBP bond form");
  assert.equal(L("Complete CBP bond form", "es"), "Completa el formulario de fianza de CBP");
  const secondary = secondaryUploadCopy("CBP Customs Broker Bond", false);
  assert.equal(secondary.label, "Upload customs bond");
  assert.equal(L(secondary.label, "es"), "Sube la fianza de aduana");
});

// --- completeness gating -----------------------------------------------------

test("a complete SmartPR profile leaves only the applicant-owned questions to answer", () => {
  const profile = importerProfile();

  const untyped = validateForm(CBP301, prefillFromCanonical(CBP301, profile), profile);
  assert.deepEqual(
    untyped.map((e) => e.fieldId).sort(),
    ["activity_code", "bond_acknowledgement", "bond_type", "execution_date", "limit_of_liability"],
    "prefill must satisfy every field SmartPR can already answer"
  );

  assert.deepEqual(validateForm(CBP301, completeFormData(profile), profile), [], "a complete CBP301 must validate");
});

test("the form cannot be completed until the applicant-owned answers exist", () => {
  const profile = importerProfile();
  const empty = validateForm(CBP301, {}, profile);
  for (const id of ["bond_type", "activity_code", "limit_of_liability", "execution_date", "principal_name", "importer_cbp_id"]) {
    assert.ok(empty.some((e) => e.fieldId === id), `${id} must be required`);
  }
});
