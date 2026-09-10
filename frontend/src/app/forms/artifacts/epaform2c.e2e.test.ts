// ============================================================================
// EPAFORM2C end-to-end: the UI schema must actually reach the official PDF.
//
// Same risk as epaform1.e2e.test.ts: EPAFORM2C's applicant-owned answers are
// coupled to the official PDF by BARE STRING pdfField IDS across two layers —
// `EPAFORM2C.ts` <-> `formDataPopulation.ts::epaForm2cValues()` <->
// `form-mappings/EPAFORM2C.json` — with nothing but convention holding all
// three together. This file reads values back out of the generated PDF rather
// than trusting either side alone.
//
// Scope honesty is pinned here too: SmartPR writes only the header and the
// Section 1.1 outfall basics for the first two outfalls. The effluent tables,
// latitude/longitude boxes, screening checkboxes, and the Section 12.2
// certification block are never written — the filer completes them by hand
// with their engineer, and the certification is hand-signed (EPA accepts no
// electronic signatures on this form).
// ============================================================================

import assert from "node:assert/strict";
import test from "node:test";

import { EPAFORM2C } from "../definitions/federal/epa/EPAFORM2C.ts";
import { getDefinition, getRegistryEntry } from "../engine/registry.ts";
import { prefillFromCanonical } from "../engine/canonicalMapping.ts";
import { validateForm } from "../engine/formValidation.ts";
import { emptyCanonicalData, type CanonicalApplicationData, type FormData } from "../engine/types.ts";
import { generateWorkingCopy } from "./library.ts";
import { readAcroFormValues } from "./pdfReadback.ts";

/** A Guaynabo chemical manufacturer — the existing discharger this form serves. */
function manufacturerProfile(): CanonicalApplicationData {
  const profile = emptyCanonicalData();
  profile.business.legalName = "Caribe Chemical Manufacturing Inc.";
  profile.business.entityType = "stock_corporation";
  return profile;
}

/** A complete set of the applicant-owned answers the schema collects. */
function answers(overrides: FormData = {}): FormData {
  return {
    epa_id_number: "PRD987654321",
    npdes_permit_number: "PR0023456",
    outfall_1_number: "001",
    outfall_1_receiving_water: "Río Bayamón",
    outfall_2_number: "002",
    outfall_2_receiving_water: "Bahía de San Juan",
    effluent_data_acknowledgement: true,
    signature_acknowledgement: true,
    ...overrides,
  };
}

// --- registry wiring ----------------------------------------------------------

test("EPAFORM2C is served as a real schema, not a disabled placeholder", () => {
  const entry = getRegistryEntry("FORM_EPA_NPDES_FORM2C");
  assert.ok(entry, "EPA Form 2C is missing from the registry");
  assert.equal(entry.displayForm, true, "EPA Form 2C must render");
  assert.equal(entry.requirementId, "DOC_NPDES_INDUSTRIAL");
  assert.equal(getDefinition("FORM_EPA_NPDES_FORM2C")?.officialFormNumber, "EPAFORM2C");
});

// --- the id contract with the PDF population layer, via directAcroValues -------

test("every applicant answer the schema collects reaches the official PDF", async () => {
  const result = await generateWorkingCopy({
    formCode: "EPAFORM2C",
    profile: manufacturerProfile(),
    purpose: "filing",
    formData: prefillFromCanonical(EPAFORM2C, manufacturerProfile(), answers()),
  });
  const values = await readAcroFormValues(result.bytes);

  assert.equal(values["EPA Identification Number"], "PRD987654321", "EPA ID must reach the PDF");
  assert.equal(values["NPDES Permit Number"], "PR0023456", "NPDES permit number must reach the PDF");
  assert.equal(values["Outfall Number11"], "001", "first outfall number must reach the PDF");
  assert.equal(values["Receiving Water Name11"], "Río Bayamón", "first receiving water must reach the PDF");
  assert.equal(values["Outfall Number11_2"], "002", "second outfall number must reach the PDF");
  assert.equal(values["Receiving Water Name11_2"], "Bahía de San Juan", "second receiving water must reach the PDF");

  // SmartPR-derived from the canonical profile — never re-asked.
  assert.equal(values["Facility Name"], "Caribe Chemical Manufacturing Inc.", "facility name must reach the PDF header from canonical");
});

// --- fields SmartPR must never write -------------------------------------------

test("the effluent tables and the Section 12.2 certification block are never populated", async () => {
  const result = await generateWorkingCopy({
    formCode: "EPAFORM2C",
    profile: manufacturerProfile(),
    purpose: "filing",
    formData: prefillFromCanonical(EPAFORM2C, manufacturerProfile(), answers()),
  });
  const values = await readAcroFormValues(result.bytes);

  // The Section 12.2 certification block — hand-signed under penalty of law.
  for (const field of ["Name print or type first and last name", "Official title", "Date signed", "Signature"]) {
    assert.ok(!values[field], `${field} must stay blank for hand signing — EPA accepts no e-signatures`);
  }

  // The third outfall row is outside SmartPR's two-outfall scope.
  assert.ok(!values["Outfall Number11_3"], "the third outfall row must stay blank for hand completion");
  assert.ok(!values["Receiving Water Name11_3"], "the third receiving-water row must stay blank for hand completion");

  assert.ok(
    EPAFORM2C.notices?.some((notice) => /a mano/i.test(notice.es ?? "")),
    "the form must tell the filer the certification is completed by hand"
  );
});

// --- completeness gating --------------------------------------------------------

test("a complete profile plus the applicant answers leaves nothing unanswered", () => {
  const profile = manufacturerProfile();
  assert.deepEqual(
    validateForm(EPAFORM2C, prefillFromCanonical(EPAFORM2C, profile, answers()), profile),
    [],
    "a complete EPA Form 2C must validate"
  );
});

test("the form cannot be completed until the applicant-owned answers exist", () => {
  const profile = manufacturerProfile();
  const empty = validateForm(EPAFORM2C, {}, profile);
  for (const id of ["outfall_1_number", "outfall_1_receiving_water", "effluent_data_acknowledgement", "signature_acknowledgement"]) {
    assert.ok(empty.some((e) => e.fieldId === id), `${id} must be required`);
  }
});
