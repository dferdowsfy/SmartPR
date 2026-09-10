// ============================================================================
// LUMAINT01 end-to-end: the UI schema must actually reach the official PDF.
//
// Same risk as nc001.e2e.test.ts: LUMAINT01's applicant-owned answers are
// coupled to the official PDF by BARE STRING pdfField IDS across two layers —
// `LUMAINT01.ts` <-> `formDataPopulation.ts::lumaInt01Values()` <->
// `form-mappings/LUMAINT01.json`'s placements — with nothing but convention
// holding all three together. This file reads values back out of the
// generated PDF rather than trusting either side alone.
// ============================================================================

import assert from "node:assert/strict";
import test from "node:test";

import { LUMAINT01 } from "../definitions/pr/luma/LUMAINT01.ts";
import { getDefinition, getRegistryEntry } from "../engine/registry.ts";
import { prefillFromCanonical } from "../engine/canonicalMapping.ts";
import { validateForm } from "../engine/formValidation.ts";
import { emptyCanonicalData, type CanonicalApplicationData, type FormData } from "../engine/types.ts";
import { generateWorkingCopy } from "./library.ts";
import { extractPdfText, foldForSearch } from "./pdfReadback.ts";

/** A Bayamón warehouse adding solar — the commercial use case this form serves. */
function lumaProfile(): CanonicalApplicationData {
  const profile = emptyCanonicalData();
  profile.contact.fullName = "Almacenes del Caribe Inc.";
  profile.addresses.operatingAddress = {
    line1: "Carr. 167 Km 12.3",
    cityOrMunicipality: "Bayamón",
    stateOrTerritory: "PR",
    postalCode: "00959",
    country: "Puerto Rico",
  };
  return profile;
}

/** A complete set of the applicant-owned answers the schema collects. */
function answers(overrides: FormData = {}): FormData {
  return {
    account_number: "1234567890",
    installer_name: "Juan Pérez",
    installer_company: "Power Solar PR LLC",
    regulation: "distribution",
    project_name: "Almacén Bayamón — 250 kW",
    project_number: "GD-2026-0417",
    capacity_kw: "250",
    signature_date: "2026-09-10",
    signature_acknowledgement: true,
    ...overrides,
  };
}

// --- registry wiring ---------------------------------------------------------

test("LUMAINT01 is served as a real schema, not a disabled placeholder", () => {
  const entry = getRegistryEntry("FORM_PR_LUMA_INTERCONNECTION");
  assert.ok(entry, "the LUMA interconnection form is missing from the registry");
  assert.equal(entry.displayForm, true, "the LUMA interconnection form must render");
  assert.equal(entry.requirementId, "DOC_LUMA_INTERCONNECTION");
  assert.equal(getDefinition("FORM_PR_LUMA_INTERCONNECTION")?.officialFormNumber, "LUMAINT01");
});

// --- the id contract with the PDF population layer, via directOverlayValues -

test("every applicant answer the schema collects reaches the official PDF", async () => {
  const result = await generateWorkingCopy({
    formCode: "LUMAINT01",
    profile: lumaProfile(),
    purpose: "filing",
    formData: answers(),
  });
  const text = foldForSearch(await extractPdfText(result.bytes));

  // Applicant-owned, written through directOverlayValues by pdfField id.
  assert.ok(text.includes(foldForSearch("1234567890")), "LUMA account number must reach the PDF");
  assert.ok(text.includes(foldForSearch("Juan Pérez")), "installer name must reach the PDF");
  assert.ok(text.includes(foldForSearch("Power Solar PR LLC")), "installer company must reach the PDF");
  assert.ok(text.includes(foldForSearch("GD-2026-0417")), "project number must reach the PDF");
  assert.ok(text.includes(foldForSearch("septiembre 10, 2026")), "the signature date must be formatted in Spanish");

  // SmartPR-derived, written from the one canonical profile — never re-asked.
  assert.ok(text.includes(foldForSearch("Almacenes del Caribe Inc.")), "customer name must reach the PDF from canonical");
  assert.ok(text.includes(foldForSearch("Carr. 167 Km 12.3")), "project address must reach the PDF from canonical");
});

test("the regulation mark reflects the selection and its counterpart stays blank", async () => {
  const result = await generateWorkingCopy({
    formCode: "LUMAINT01",
    profile: lumaProfile(),
    purpose: "filing",
    formData: answers({ regulation: "transmission" }),
  });
  assert.ok(result.populated.some((p) => p.pdfField === "regulation_transmission_mark" && p.value === "X"));
  assert.ok(!result.populated.some((p) => p.pdfField === "regulation_distribution_mark"));
  assert.ok(!result.unanswered.some((u) => u.pdfField === "regulation_transmission_mark"));
});

// --- fields SmartPR must never write -----------------------------------------

test("the customer signature line is never populated", async () => {
  const result = await generateWorkingCopy({
    formCode: "LUMAINT01",
    profile: lumaProfile(),
    purpose: "filing",
    formData: answers(),
  });
  assert.ok(
    !result.populated.some((p) => p.pdfField === "customer_signature"),
    "customer_signature is a hand-signature line SmartPR must leave blank"
  );
  assert.ok(
    LUMAINT01.notices?.some((notice) => /firma del cliente/i.test(notice.es)),
    "the form must tell the filer the signature line is theirs to complete by hand"
  );
});

// --- completeness gating -----------------------------------------------------

test("a complete SmartPR profile leaves only the applicant-owned questions to answer", () => {
  const profile = lumaProfile();

  const untyped = validateForm(LUMAINT01, prefillFromCanonical(LUMAINT01, profile), profile);
  assert.deepEqual(
    untyped.map((e) => e.fieldId).sort(),
    [
      "account_number",
      "capacity_kw",
      "installer_name",
      "project_name",
      "regulation",
      "signature_acknowledgement",
      "signature_date",
    ],
    "prefill must satisfy every field SmartPR can already answer"
  );

  assert.deepEqual(validateForm(LUMAINT01, prefillFromCanonical(LUMAINT01, profile, answers()), profile), [], "a complete LUMAINT01 must validate");
});

test("the form cannot be completed until the applicant-owned answers exist", () => {
  const profile = lumaProfile();
  const empty = validateForm(LUMAINT01, {}, profile);
  for (const id of ["account_number", "installer_name", "regulation", "project_name", "capacity_kw"]) {
    assert.ok(empty.some((e) => e.fieldId === id), `${id} must be required`);
  }
});
