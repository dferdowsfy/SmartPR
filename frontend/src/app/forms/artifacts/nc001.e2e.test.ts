// ============================================================================
// NC001 end-to-end: the UI schema must actually reach the official PDF.
//
// Same risk as pa02.e2e.test.ts, doubled: NC001's applicant-owned answers are
// coupled to the official PDF by BARE STRING pdfField IDS across not one but
// TWO layers — `NC001.ts` <-> `formDataPopulation.ts::nc001Values()` <->
// `form-mappings/NC001.json`'s placements — with nothing but convention
// holding all three together. This file is also the first end-to-end proof
// that `directOverlayValues` (added alongside this form) actually reaches a
// pdf_overlay document; PA02 only ever exercised the acroform branch.
// ============================================================================

import assert from "node:assert/strict";
import test from "node:test";

import { NC001 } from "../definitions/pr/department-of-state/NC001.ts";
import { getDefinition, getRegistryEntry } from "../engine/registry.ts";
import { prefillFromCanonical } from "../engine/canonicalMapping.ts";
import { validateForm } from "../engine/formValidation.ts";
import { emptyCanonicalData, type CanonicalApplicationData, type FormData } from "../engine/types.ts";
import { generateWorkingCopy } from "./library.ts";
import { extractPdfText, foldForSearch } from "./pdfReadback.ts";

function nc001Profile(): CanonicalApplicationData {
  const profile = emptyCanonicalData();
  profile.business.legalName = "Cafetería La Ceiba LLC";
  profile.business.entityType = "limited_liability_company";
  profile.business.activityDescription = "Restaurante y servicio de alimentos";
  profile.business.phone = "787-555-0143";
  profile.contact.fullName = "María Rivera Colón";
  profile.contact.role = "Miembro gestor";
  profile.addresses.municipality = "Bayamón";
  profile.addresses.operatingAddress = {
    line1: "150 Calle Comerío",
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
    trade_name: "La Ceiba Café",
    used_since: "yes",
    used_since_date: "2026-03-15",
    entity_kind: "juridica",
    state_or_country_or_citizenship: "Puerto Rico",
    applicant_name: "María Rivera Colón",
    applicant_phone: "787-555-0143",
    principal_address: nc001Profile().addresses.operatingAddress,
    principal_phone: "787-555-0143",
    nature_of_business: "Restaurante y servicio de alimentos",
    application_date: "2026-09-09",
    notarization_acknowledgement: true,
    ...overrides,
  };
}

// --- registry wiring ---------------------------------------------------------

test("NC001 is served as a real schema, not a disabled placeholder", () => {
  const entry = getRegistryEntry("FORM_PR_DOS_DBA");
  assert.ok(entry, "the DBA/trade-name form is missing from the registry");
  assert.equal(entry.displayForm, true, "the DBA form must render");
  assert.equal(entry.requirementId, "DOC_DBA_REGISTRATION");
  assert.equal(getDefinition("FORM_PR_DOS_DBA")?.officialFormNumber, "NC001");
});

// --- the id contract with the PDF population layer, via directOverlayValues -

test("every applicant answer the schema collects reaches the official PDF", async () => {
  const result = await generateWorkingCopy({
    formCode: "NC001",
    profile: nc001Profile(),
    purpose: "filing",
    formData: answers(),
  });
  const text = foldForSearch(await extractPdfText(result.bytes));

  // Applicant-owned, written through directOverlayValues by pdfField id.
  assert.ok(text.includes(foldForSearch("La Ceiba Café")), "trade name must reach the PDF");
  assert.ok(text.includes(foldForSearch("marzo 15, 2026")), "the used-since date must be formatted in Spanish");
  assert.ok(text.includes(foldForSearch("Puerto Rico")), "state/country/citizenship line must reach the PDF");

  // SmartPR-derived, written from the one canonical profile — never re-asked.
  assert.ok(text.includes(foldForSearch("María Rivera Colón")), "applicant name must reach the PDF from canonical");
  assert.ok(text.includes(foldForSearch("787-555-0143")), "phone must reach the PDF from canonical");
  assert.ok(text.includes(foldForSearch("150 Calle Comerío")), "principal address must reach the PDF from canonical");
  assert.ok(
    text.includes(foldForSearch("Restaurante y servicio de alimentos")),
    "nature of business must reach the PDF from canonical"
  );

  // The applicant's name is repeated on page 2's declaration header — resolved
  // independently from the SAME canonical field, not routed back through
  // formData. Two occurrences proves both placements actually drew.
  const occurrences = text.split(foldForSearch("Maria Rivera Colon")).length - 1;
  assert.ok(occurrences >= 2, "applicant name must appear on both page 1 and the page-2 declaration header");
});

test("the entity-kind mark reflects the selection and its counterpart stays blank", async () => {
  const result = await generateWorkingCopy({
    formCode: "NC001",
    profile: nc001Profile(),
    purpose: "filing",
    formData: answers({ entity_kind: "natural" }),
  });
  assert.ok(result.populated.some((p) => p.pdfField === "entity_kind_natural_mark" && p.value === "X"));
  assert.ok(!result.populated.some((p) => p.pdfField === "entity_kind_juridica_mark"));
  assert.ok(!result.unanswered.some((u) => u.pdfField === "entity_kind_natural_mark"));
});

test("the used-since date is written only when the applicant declares prior use", async () => {
  const result = await generateWorkingCopy({
    formCode: "NC001",
    profile: nc001Profile(),
    purpose: "filing",
    formData: answers({ used_since: "no", used_since_date: undefined }),
  });
  assert.ok(result.populated.some((p) => p.pdfField === "not_used_mark" && p.value === "X"));
  assert.ok(!result.populated.some((p) => p.pdfField === "used_since_mark"));
  assert.ok(!result.populated.some((p) => p.pdfField === "used_since_date"));
});

// --- fields SmartPR must never write -----------------------------------------

test("the notary, signature and agency-assigned blocks are never populated", async () => {
  const result = await generateWorkingCopy({
    formCode: "NC001",
    profile: nc001Profile(),
    purpose: "filing",
    formData: answers(),
  });
  const neverWritten = [
    "reg_number",
    "applicant_signature_p1",
    "declaration_body",
    "applicant_signature_p2",
    "affidavit_number",
    "sworn_date",
    "notary_seal",
    "notary_signature",
  ];
  for (const pdfField of neverWritten) {
    assert.ok(
      !result.populated.some((p) => p.pdfField === pdfField),
      `${pdfField} is a notary/signature/government-only box SmartPR must leave blank`
    );
  }
  assert.ok(
    NC001.notices?.some((notice) => /sworn declaration/i.test(notice.en)),
    "the form must tell the filer the sworn declaration and signatures are theirs to complete"
  );
});

// --- completeness gating -----------------------------------------------------

/** What the renderer actually validates: canonical prefill + typed answers. */
function asRendered(profile: CanonicalApplicationData, typed: FormData): FormData {
  return prefillFromCanonical(NC001, profile, typed);
}

test("a complete SmartPR profile leaves only the applicant-owned questions to answer", () => {
  const profile = nc001Profile();

  const untyped = validateForm(NC001, prefillFromCanonical(NC001, profile), profile);
  assert.deepEqual(
    untyped.map((e) => e.fieldId).sort(),
    [
      "application_date",
      "entity_kind",
      "notarization_acknowledgement",
      "state_or_country_or_citizenship",
      "trade_name",
      "used_since",
    ],
    "prefill must satisfy every field SmartPR can already answer"
  );

  assert.deepEqual(validateForm(NC001, asRendered(profile, answers()), profile), [], "a complete NC001 must validate");
});

test("the form cannot be completed until the applicant-owned answers exist", () => {
  const profile = nc001Profile();
  const empty = validateForm(NC001, {}, profile);
  for (const id of ["trade_name", "entity_kind", "used_since", "application_date"]) {
    assert.ok(empty.some((e) => e.fieldId === id), `${id} must be required`);
  }
});

test("declaring prior use requires the date; not-yet-used does not", () => {
  const profile = nc001Profile();

  const withoutDate = validateForm(NC001, asRendered(profile, answers({ used_since: "yes", used_since_date: undefined })), profile);
  assert.ok(withoutDate.some((e) => e.fieldId === "used_since_date"));

  assert.deepEqual(
    validateForm(NC001, asRendered(profile, answers({ used_since: "no", used_since_date: undefined })), profile),
    []
  );
});
