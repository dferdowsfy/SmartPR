// ============================================================================
// DACOUC01 end-to-end: the UI schema must actually reach the official PDF.
//
// Same risk as lumaint01.e2e.test.ts: DACOUC01's applicant-owned answers are
// coupled to the official PDF by BARE STRING pdfField IDS across two layers —
// `DACOUC01.ts` <-> `formDataPopulation.ts::dacoUc01Values()` <->
// `DACOUC01_OVERLAY` in overlayMaps.ts — with nothing but convention holding
// all three together. This file reads values back out of the generated PDF
// rather than trusting either side alone.
// ============================================================================

import assert from "node:assert/strict";
import test from "node:test";

import { DACOUC01 } from "../definitions/pr/daco/DACOUC01.ts";
import { getDefinition, getRegistryEntry } from "../engine/registry.ts";
import { resolveFormId } from "../engine/routing.ts";
import { prefillFromCanonical } from "../engine/canonicalMapping.ts";
import { validateForm } from "../engine/formValidation.ts";
import { emptyCanonicalData, type CanonicalApplicationData, type FormData } from "../engine/types.ts";
import { generateWorkingCopy } from "./library.ts";
import { extractPdfText, foldForSearch } from "./pdfReadback.ts";
import { DACOUC01_OVERLAY } from "./overlayMaps.ts";

/** A San Juan general contractor — the business this license serves. */
function contractorProfile(): CanonicalApplicationData {
  const profile = emptyCanonicalData();
  profile.business.legalName = "Constructora del Caribe LLC";
  profile.business.phone = "787-555-0142";
  profile.addresses.operatingAddress = {
    line1: "Ave. Ponce de León 1234",
    cityOrMunicipality: "San Juan",
    stateOrTerritory: "PR",
    postalCode: "00907",
    country: "Puerto Rico",
  };
  profile.addresses.principalMailing = {
    line1: "PO Box 190422",
    cityOrMunicipality: "San Juan",
    stateOrTerritory: "PR",
    postalCode: "00919",
    country: "Puerto Rico",
  };
  return profile;
}

/** A complete set of the applicant-owned answers the schema collects. */
function answers(overrides: FormData = {}): FormData {
  return {
    license_request: "renovacion",
    license_class: "regular",
    activity_type: "ambos",
    org_type: "corporacion",
    ...overrides,
  };
}

// --- registry + routing wiring ------------------------------------------------

test("DACOUC01 is served as a real schema, not a disabled placeholder", () => {
  const entry = getRegistryEntry("FORM_PR_DACO_URBANIZADOR_CONSTRUCTOR");
  assert.ok(entry, "the DACO contractor-license form is missing from the registry");
  assert.equal(entry.displayForm, true, "the DACO contractor-license form must render");
  assert.equal(entry.requirementId, "DOC_CONTRACTOR_LICENSE");
  assert.equal(getDefinition("FORM_PR_DACO_URBANIZADOR_CONSTRUCTOR")?.officialFormNumber, "DACOUC01");
});

test("DOC_CONTRACTOR_LICENSE routes to the DACO form regardless of entity type", () => {
  const profile = contractorProfile();
  assert.equal(
    resolveFormId("DOC_CONTRACTOR_LICENSE", profile),
    "FORM_PR_DACO_URBANIZADOR_CONSTRUCTOR",
    "the contractor-license requirement must route to the DACO form"
  );
});

// --- the id contract with the PDF population layer, via directOverlayValues --

test("every applicant answer the schema collects reaches the official PDF", async () => {
  const result = await generateWorkingCopy({
    formCode: "DACOUC01",
    profile: contractorProfile(),
    purpose: "filing",
    formData: answers(),
  });
  const text = foldForSearch(await extractPdfText(result.bytes));

  // SmartPR-derived, written from the one canonical profile — never re-asked.
  assert.ok(text.includes(foldForSearch("Constructora del Caribe LLC")), "applicant name must reach the PDF from canonical");
  assert.ok(text.includes(foldForSearch("787-555-0142")), "applicant phone must reach the PDF from canonical");
  assert.ok(text.includes(foldForSearch("Ave. Ponce de León 1234")), "physical address must reach the PDF from canonical");
  assert.ok(text.includes(foldForSearch("PO Box 190422")), "mailing address must reach the PDF from canonical");

  // Applicant-owned, written through directOverlayValues by pdfField id.
  const marked = (pdfField: string) =>
    result.populated.some((p) => p.pdfField === pdfField && p.value === "X");
  assert.ok(marked("license_renovacion_mark"), "the renovación mark must reach the PDF");
  assert.ok(marked("license_regular_mark"), "the regular-license mark must reach the PDF");
  assert.ok(marked("activity_ambos_mark"), "the activity ambos mark must reach the PDF");
  assert.ok(marked("org_corporacion_mark"), "the corporación mark must reach the PDF");
});

test("checkbox marks are mutually exclusive within each group", async () => {
  const result = await generateWorkingCopy({
    formCode: "DACOUC01",
    profile: contractorProfile(),
    purpose: "filing",
    formData: answers({ activity_type: "constructor", org_type: "individuo", license_request: "provisional", license_class: "provisional" }),
  });
  const marked = (pdfField: string) =>
    result.populated.some((p) => p.pdfField === pdfField && p.value === "X");
  assert.ok(marked("activity_constructor_mark"));
  assert.ok(!marked("activity_urbanizador_mark"), "only the selected activity box may be marked");
  assert.ok(!marked("activity_ambos_mark"), "only the selected activity box may be marked");
  assert.ok(!marked("activity_otros_mark"), "only the selected activity box may be marked");
  assert.ok(marked("org_individuo_mark"));
  assert.ok(!marked("org_corporacion_mark"), "only the selected organization box may be marked");
  assert.ok(marked("license_provisional_mark"));
  assert.ok(marked("license_class_provisional_mark"), "the two provisional boxes live in different rows and both apply");
  assert.ok(!marked("license_renovacion_mark"), "only the selected request box may be marked");
  assert.ok(!marked("license_regular_mark"), "only the selected license-class box may be marked");
});

test("marking 'Otro' writes the mark and the specify text", async () => {
  const result = await generateWorkingCopy({
    formCode: "DACOUC01",
    profile: contractorProfile(),
    purpose: "filing",
    formData: answers({ activity_type: "otro", activity_otros_text: "Demolición" }),
  });
  assert.ok(
    result.populated.some((p) => p.pdfField === "activity_otros_mark" && p.value === "X"),
    "the Otros box must be marked"
  );
  const text = foldForSearch(await extractPdfText(result.bytes));
  assert.ok(text.includes(foldForSearch("Demolición")), "the specified other activity must reach the PDF");
});

// --- fields SmartPR must never write ------------------------------------------

test("no overlay row touches the sworn, notary or signature pages", () => {
  for (const row of DACOUC01_OVERLAY) {
    assert.ok(
      (row.placement?.page ?? 0) < 8,
      `pdfField ${row.pdfField} must not write on the sworn/notary pages (8-9)`
    );
    assert.ok(
      row.ownership !== "signature" && row.ownership !== "notary",
      `pdfField ${row.pdfField} must never be signature- or notary-owned`
    );
  }
});

test("a populated working copy writes nothing on pages 8 and 9", async () => {
  const result = await generateWorkingCopy({
    formCode: "DACOUC01",
    profile: contractorProfile(),
    purpose: "filing",
    formData: answers(),
  });
  assert.ok(
    result.populated.every((p) => {
      const row = DACOUC01_OVERLAY.find((r) => r.pdfField === p.pdfField);
      return row !== undefined && (row.placement?.page ?? 0) < 8;
    }),
    "every populated value must come from a page-1 overlay row"
  );
  assert.ok(
    DACOUC01.notices?.some((notice) => /notario/i.test(notice.es ?? "")),
    "the form must tell the filer the sworn pages are theirs to complete before a notary"
  );
});

// --- completeness gating --------------------------------------------------------

test("a complete SmartPR profile leaves only the applicant-owned questions to answer", () => {
  const profile = contractorProfile();

  const untyped = validateForm(DACOUC01, prefillFromCanonical(DACOUC01, profile), profile);
  assert.deepEqual(
    untyped.map((e) => e.fieldId).sort(),
    ["activity_type", "license_class", "license_request", "org_type"],
    "prefill must satisfy every field SmartPR can already answer"
  );

  assert.deepEqual(validateForm(DACOUC01, prefillFromCanonical(DACOUC01, profile, answers()), profile), [], "a complete DACOUC01 must validate");
});

test("the form cannot be completed until the applicant-owned answers exist", () => {
  const profile = contractorProfile();
  const empty = validateForm(DACOUC01, {}, profile);
  for (const id of ["license_request", "license_class", "activity_type", "org_type"]) {
    assert.ok(empty.some((e) => e.fieldId === id), `${id} must be required`);
  }
});
