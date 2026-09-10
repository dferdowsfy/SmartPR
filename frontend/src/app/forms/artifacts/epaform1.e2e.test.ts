// ============================================================================
// EPAFORM1 end-to-end: the UI schema must actually reach the official PDF.
//
// Same risk as lumaint01.e2e.test.ts: EPAFORM1's applicant-owned answers are
// coupled to the official PDF by BARE STRING pdfField IDS across two layers —
// `EPAFORM1.ts` <-> `formDataPopulation.ts::epaForm1Values()` <->
// `form-mappings/EPAFORM1.json` — with nothing but convention holding all
// three together. This file reads values back out of the generated PDF rather
// than trusting either side alone.
//
// It also pins the honest package routing: DOC_NPDES_INDUSTRIAL resolves to
// BOTH EPA forms (Form 1 + Form 2C), and the Section 11.2 certification block
// is never written — EPA accepts no electronic signatures on this form.
// ============================================================================

import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";

import { EPAFORM1 } from "../definitions/federal/epa/EPAFORM1.ts";
import { getDefinition, getRegistryEntry } from "../engine/registry.ts";
import { resolveFormIds, selectEntriesForRequirement } from "../engine/routing.ts";
import { prefillFromCanonical } from "../engine/canonicalMapping.ts";
import { validateForm } from "../engine/formValidation.ts";
import { emptyCanonicalData, type CanonicalApplicationData, type FormData } from "../engine/types.ts";
import { generateWorkingCopy } from "./library.ts";
import { readAcroFormValues } from "./pdfReadback.ts";

/** A Guaynabo chemical manufacturer — the industrial discharger this package serves. */
function manufacturerProfile(): CanonicalApplicationData {
  const profile = emptyCanonicalData();
  profile.business.legalName = "Caribe Chemical Manufacturing Inc.";
  profile.business.phone = "787-555-0142";
  profile.business.activityDescription = "Manufacture of industrial cleaning compounds";
  profile.business.entityType = "stock_corporation";
  profile.contact.fullName = "María Rodríguez";
  profile.contact.role = "Plant Manager";
  profile.contact.phone = "787-555-0142";
  profile.contact.email = "maria.rodriguez@caribechemical.example";
  const address = {
    line1: "Carr. 165 Km 4.2, Parque Industrial",
    cityOrMunicipality: "Guaynabo",
    stateOrTerritory: "PR",
    postalCode: "00969",
    country: "Puerto Rico",
  };
  profile.addresses.principalMailing = { ...address };
  profile.addresses.operatingAddress = { ...address };
  profile.addresses.municipality = "Guaynabo";
  return profile;
}

/** A complete set of the applicant-owned answers the schema collects. */
function answers(overrides: FormData = {}): FormData {
  return {
    epa_id_number: "PRD987654321",
    npdes_permit_number: "PR0023456",
    sic_code_1: "2819",
    sic_desc_1: "Industrial inorganic chemicals",
    sic_code_2: "",
    sic_desc_2: "",
    naics_code_1: "325180",
    naics_desc_1: "Other basic inorganic chemical manufacturing",
    naics_code_2: "",
    naics_desc_2: "",
    existing_npdes_number: "PR0023456",
    existing_rcra_number: "",
    existing_uic_number: "",
    existing_psd_number: "",
    existing_nonattainment_number: "",
    existing_neshaps_number: "",
    existing_ocean_dumping_number: "",
    existing_dredge_number: "",
    cooling_water_source: "Río Bayamón",
    signature_acknowledgement: true,
    ...overrides,
  };
}

// --- registry wiring ----------------------------------------------------------

test("EPAFORM1 is served as a real schema, not a disabled placeholder", () => {
  const entry = getRegistryEntry("FORM_EPA_NPDES_FORM1");
  assert.ok(entry, "EPA Form 1 is missing from the registry");
  assert.equal(entry.displayForm, true, "EPA Form 1 must render");
  assert.equal(entry.requirementId, "DOC_NPDES_INDUSTRIAL");
  assert.equal(getDefinition("FORM_EPA_NPDES_FORM1")?.officialFormNumber, "EPAFORM1");
});

// --- the two-form package routing ----------------------------------------------

test("DOC_NPDES_INDUSTRIAL routes to the two-form EPA package, in filing order", () => {
  const canonical = manufacturerProfile();
  assert.deepEqual(
    resolveFormIds("DOC_NPDES_INDUSTRIAL", canonical),
    ["FORM_EPA_NPDES_FORM1", "FORM_EPA_NPDES_FORM2C"],
    "the requirement must expose Form 1 AND Form 2C — never just one"
  );
  const entries = selectEntriesForRequirement(
    "DOC_NPDES_INDUSTRIAL",
    canonical,
    new Set(["DOC_NPDES_INDUSTRIAL"])
  );
  assert.deepEqual(
    entries.map((e) => e.id),
    ["FORM_EPA_NPDES_FORM1", "FORM_EPA_NPDES_FORM2C"],
    "both package entries must be displayable"
  );
});

test("single-form requirements still resolve to exactly one form", () => {
  const canonical = manufacturerProfile();
  assert.deepEqual(
    resolveFormIds("DOC_LUMA_INTERCONNECTION", canonical),
    ["FORM_PR_LUMA_INTERCONNECTION"],
    "existing single-form behavior must be preserved"
  );
});

// --- the id contract with the PDF population layer, via directAcroValues -------

test("every applicant answer the schema collects reaches the official PDF", async () => {
  const result = await generateWorkingCopy({
    formCode: "EPAFORM1",
    profile: manufacturerProfile(),
    purpose: "filing",
    formData: prefillFromCanonical(EPAFORM1, manufacturerProfile(), answers()),
  });
  const values = await readAcroFormValues(result.bytes);

  // Applicant-owned, written through epaForm1Values by pdfField id.
  assert.equal(values["EPA Identification Number"], "PRD987654321", "EPA ID must reach the PDF");
  assert.equal(values["NPDES Permit Number"], "PR0023456", "NPDES permit number must reach the PDF");
  assert.equal(values["SIC Codes31"], "2819", "primary SIC code must reach the PDF");
  assert.equal(values["Description optional31"], "Industrial inorganic chemicals", "SIC description must reach the PDF");
  assert.equal(values["NAICS Codes32"], "325180", "primary NAICS code must reach the PDF");
  assert.equal(values["Identify the source of cooling water"], "Río Bayamón", "cooling-water source must reach the PDF");

  // Split address components — one box per component, never a multiline blob.
  assert.equal(values["Street or PO box"], "Carr. 165 Km 4.2, Parque Industrial", "mailing street must reach the PDF");
  assert.equal(values["City or town"], "Guaynabo", "mailing city must reach the PDF");
  assert.equal(values["State"], "PR", "mailing state must reach the PDF");
  assert.equal(values["ZIP code"], "00969", "mailing ZIP must reach the PDF");
  assert.equal(values["Street route number or other specific identifier"], "Carr. 165 Km 4.2, Parque Industrial", "location street must reach the PDF");

  // SmartPR-derived from the canonical profile — never re-asked.
  assert.equal(values["Facility Name"], "Caribe Chemical Manufacturing Inc.", "facility name must reach the PDF from canonical");
  assert.equal(values["County name"], "Guaynabo", "municipio must reach the county box from canonical");
  assert.equal(values["Describe the nature of your business"], "Manufacture of industrial cleaning compounds", "business description must reach the PDF from canonical");
});

test("a first-time applicant may leave both header identifiers blank", async () => {
  const result = await generateWorkingCopy({
    formCode: "EPAFORM1",
    profile: manufacturerProfile(),
    purpose: "filing",
    formData: prefillFromCanonical(EPAFORM1, manufacturerProfile(), answers({ epa_id_number: "", npdes_permit_number: "", existing_npdes_number: "" })),
  });
  const values = await readAcroFormValues(result.bytes);
  assert.ok(!values["EPA Identification Number"], "blank EPA ID must stay blank for a new applicant");
  assert.ok(!values["NPDES Permit Number"], "blank NPDES number must stay blank for a new applicant");
  assert.ok(!values["water"], "blank existing-permit number must stay blank");
});

test("entering an existing-permit number checks its Section 6 box; empty rows stay unchecked", async () => {
  const result = await generateWorkingCopy({
    formCode: "EPAFORM1",
    profile: manufacturerProfile(),
    purpose: "filing",
    formData: prefillFromCanonical(EPAFORM1, manufacturerProfile(), answers()),
  });
  const doc = await PDFDocument.load(result.bytes);
  const form = doc.getForm();
  assert.equal(form.getCheckBox("NPDES discharges to surface").isChecked(), true, "the NPDES box must be checked when a permit number is given");
  assert.equal((await readAcroFormValues(result.bytes))["water"], "PR0023456", "the NPDES permit number must reach its box");
  for (const box of ["RCRA", "UIC underground", "PSD", "Nonattainment", "NESHAPs", "Ocean dumping", "Dredge"]) {
    assert.equal(form.getCheckBox(box).isChecked(), false, `${box} must stay unchecked when no permit number is given`);
  }
});

// --- fields SmartPR must never write -------------------------------------------

test("the Section 11.2 certification block is never populated", async () => {
  const result = await generateWorkingCopy({
    formCode: "EPAFORM1",
    profile: manufacturerProfile(),
    purpose: "filing",
    formData: prefillFromCanonical(EPAFORM1, manufacturerProfile(), answers()),
  });
  const values = await readAcroFormValues(result.bytes);
  for (const field of ["Name print or type first and last name", "Official title", "Date signed", "Signature"]) {
    assert.ok(!values[field], `${field} must stay blank for hand signing — EPA accepts no e-signatures`);
  }
  assert.ok(
    EPAFORM1.notices?.some((notice) => /a mano/i.test(notice.es ?? "")),
    "the form must tell the filer the certification is completed by hand"
  );
});

// --- completeness gating --------------------------------------------------------

test("a complete profile plus the applicant answers leaves nothing unanswered", () => {
  const profile = manufacturerProfile();
  assert.deepEqual(
    validateForm(EPAFORM1, prefillFromCanonical(EPAFORM1, profile, answers()), profile),
    [],
    "a complete EPA Form 1 must validate"
  );
});

test("the form cannot be completed until the applicant-owned answers exist", () => {
  const profile = manufacturerProfile();
  const empty = validateForm(EPAFORM1, {}, profile);
  for (const id of ["sic_code_1", "naics_code_1", "signature_acknowledgement"]) {
    assert.ok(empty.some((e) => e.fieldId === id), `${id} must be required`);
  }
});
