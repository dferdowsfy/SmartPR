// ============================================================================
// SC2309 end-to-end: the UI schema must actually reach the official Hacienda
// PDF.
//
// Same risk as lumaint01.e2e.test.ts: SC2309's applicant-owned answers are
// coupled to the official PDF by BARE STRING pdfField IDS across three
// layers — `definitions/pr/hacienda/SC2309.ts` <-> 
// `formDataPopulation.ts::sc2309Values()` <-> `form-mappings/SC2309.json`'s
// placements — with nothing but convention holding all three together. This
// file reads values back out of the generated PDF rather than trusting
// either side alone, and pins the never-write guarantees (signature, notary
// block, Uso Oficial).
// ============================================================================

import assert from "node:assert/strict";
import test from "node:test";

import { SC2309 } from "../definitions/pr/hacienda/SC2309.ts";
import { getDefinition, getRegistryEntry } from "../engine/registry.ts";
import { resolveFormId, selectFormForRequirement } from "../engine/routing.ts";
import { getTemplate, isOfficialArtifact } from "./catalog.ts";
import { prefillFromCanonical } from "../engine/canonicalMapping.ts";
import { validateForm } from "../engine/formValidation.ts";
import { emptyCanonicalData, type CanonicalApplicationData, type FormData } from "../engine/types.ts";
import { generateWorkingCopy } from "./library.ts";
import { extractPdfText, foldForSearch } from "./pdfReadback.ts";

/** A San Juan corporation opening a bar — the use case this form serves. */
function sc2309Profile(): CanonicalApplicationData {
  const profile = emptyCanonicalData();
  profile.business.legalName = "Barra La Esquina Inc.";
  profile.business.tradeName = "La Esquina";
  profile.business.entityType = "stock_corporation";
  profile.business.formationStatus = "formed_in_puerto_rico";
  profile.business.ein = "66-1234567";
  profile.business.phone = "787-555-0142";
  profile.business.merchantRegistrationNumber = "1234-5678901-02";
  profile.contact.fullName = "María Delgado";
  profile.addresses.operatingAddress = {
    line1: "123 Calle Loíza",
    cityOrMunicipality: "San Juan",
    stateOrTerritory: "PR",
    postalCode: "00911",
    country: "Puerto Rico",
  };
  profile.addresses.principalMailing = {
    line1: "PO Box 14001",
    cityOrMunicipality: "San Juan",
    stateOrTerritory: "PR",
    postalCode: "00916",
    country: "Puerto Rico",
  };
  profile.activities.alcoholSales = true;
  return profile;
}

/** Applicant-owned answers for a first-time alcohol license request. */
function answers(overrides: FormData = {}): FormData {
  return {
    numero_seguro_social: "584-01-2345",
    lic_bebidas: true,
    periodo: "largo",
    tiene_licencia: "no",
    cerca_escuela_iglesia: "no",
    declarante_nombre: "María Delgado",
    declarante_titulo: "Presidenta",
    declarante_fecha: "2026-09-12",
    juramento: true,
    firma_aviso: true,
    ...overrides,
  };
}

// --- registry wiring ---------------------------------------------------------

test("SC2309 is served as a real schema, not a disabled placeholder", () => {
  const entry = getRegistryEntry("FORM_PR_HACIENDA_SC2309");
  assert.ok(entry, "the SC2309 form is missing from the registry");
  assert.equal(entry.displayForm, true, "the SC2309 form must render");
  assert.equal(entry.requirementId, "DOC_ALCOHOL_LICENSE");
  assert.equal(entry.officialFormNumber, "SC2309");
  assert.equal(getDefinition("FORM_PR_HACIENDA_SC2309")?.officialFormNumber, "SC2309");
  assert.ok(!getRegistryEntry("FORM_PR_ALCOHOL_LICENSE"), "the needs_source placeholder must be gone");
});

test("DOC_ALCOHOL_LICENSE routes to the SC2309 form", () => {
  const profile = sc2309Profile();
  assert.equal(resolveFormId("DOC_ALCOHOL_LICENSE", profile), "FORM_PR_HACIENDA_SC2309");
  const entry = selectFormForRequirement("DOC_ALCOHOL_LICENSE", profile, new Set(["DOC_ALCOHOL_LICENSE"]));
  assert.ok(entry, "selectFormForRequirement must return the SC2309 entry");
  assert.equal(entry.id, "FORM_PR_HACIENDA_SC2309");
});

// --- the official artifact wins over the preparation worksheet ----------------

test("the official SC2309 artifact passes the UI's official-artifact gate", () => {
  // Mirrors SmartPRIntake's govFormEntryForReq: a requirement shows the
  // official form (and NOT the sample worksheet) only when the resolved
  // entry's template is the agency's real PDF.
  const profile = sc2309Profile();
  const entry = selectFormForRequirement("DOC_ALCOHOL_LICENSE", profile, new Set(["DOC_ALCOHOL_LICENSE"]));
  assert.ok(entry);
  const template = getTemplate(entry.officialFormNumber);
  assert.ok(template && isOfficialArtifact(template), "SC2309 must resolve to Hacienda's real PDF so the worksheet is never offered instead");
  assert.equal(template.sourceFile, "RealForms/sc_2309_0.pdf");
});

// --- the id contract with the PDF population layer ---------------------------

test("profile facts and applicant answers reach the official PDF", async () => {
  const result = await generateWorkingCopy({
    formCode: "SC2309",
    profile: sc2309Profile(),
    purpose: "filing",
    formData: answers(),
  });
  const text = foldForSearch(await extractPdfText(result.bytes));

  // SmartPR-derived, written from the one canonical profile.
  assert.ok(text.includes(foldForSearch("Barra La Esquina Inc.")), "taxpayer name must reach the PDF from canonical");
  assert.ok(text.includes(foldForSearch("La Esquina")), "trade name must reach the PDF from canonical");
  assert.ok(text.includes(foldForSearch("66-1234567")), "EIN must reach the PDF from canonical");
  assert.ok(text.includes(foldForSearch("123 Calle Loíza")), "business location must reach the PDF from canonical");
  assert.ok(text.includes(foldForSearch("PO Box 14001")), "postal address must reach the PDF from canonical");

  // Applicant-owned, written through sc2309Values by pdfField id.
  assert.ok(text.includes(foldForSearch("584-01-2345")), "SSN typed on the form must reach the PDF");
  assert.ok(text.includes(foldForSearch("María Delgado")), "declarant name must reach the PDF");
  assert.ok(text.includes(foldForSearch("Presidenta")), "declarant title must reach the PDF");
  assert.ok(text.includes(foldForSearch("septiembre 12, 2026")), "the declaration date must be formatted in Spanish");

  // Marks, verified through the populated record (X glyphs don't read back as text reliably).
  const marked = (id: string) => result.populated.some((p) => p.pdfField === id && p.value === "X");
  assert.ok(marked("tipo_corporacion_mark"), "corporation taxpayer-type mark must be set from the entity type");
  assert.ok(marked("lic_bebidas_mark"), "the alcohol license mark must be set");
  assert.ok(marked("periodo_largo_mark"), "the long-period mark must reflect the selection");
  assert.ok(!result.populated.some((p) => p.pdfField === "periodo_corto_mark"), "the unchosen period mark must stay blank");
  assert.ok(marked("tiene_licencia_no_mark"), "the 'no prior license' mark must be set");
  assert.ok(marked("cerca_escuela_iglesia_no_mark"), "the 'not near school/church' mark must be set");

  // Sensitive values are masked in the population record, never copied raw.
  const ssnRecord = result.populated.find((p) => p.pdfField === "numero_seguro_social");
  assert.ok(ssnRecord, "the SSN must be recorded as populated");
  assert.equal(ssnRecord.value, "[provided]", "the SSN must be masked in population metadata");
});

// --- fields SmartPR must never write -----------------------------------------

test("signature, notary and official-use blocks are never populated", async () => {
  const result = await generateWorkingCopy({
    formCode: "SC2309",
    profile: sc2309Profile(),
    purpose: "filing",
    formData: answers(),
  });
  for (const blocked of ["firma_declarante", "notario_bloque", "numero_affidavit", "numero_solicitud", "uso_oficial_bloque"]) {
    assert.ok(
      !result.populated.some((p) => p.pdfField === blocked),
      `${blocked} must never be written by SmartPR`
    );
  }
  assert.ok(
    SC2309.notices?.some((notice) => /firme la línea 'firma' a mano/i.test(notice.es)),
    "the form must tell the filer the signature line is theirs to complete by hand"
  );
  assert.ok(
    SC2309.notices?.some((notice) => /jurado y suscrito ante mí/i.test(notice.es)),
    "the form must explain the notary block is completed at signing"
  );
});

// --- completeness gating -----------------------------------------------------

test("a complete SmartPR profile leaves only the applicant-owned questions to answer", () => {
  const profile = sc2309Profile();
  const missing = validateForm(SC2309, prefillFromCanonical(SC2309, profile), profile).map((e) => e.fieldId);
  // Everything the canonical profile supplies must already be answered.
  for (const prefilled of ["nombre", "numero_registro_comerciante", "nombre_comercial", "numero_identificacion_patronal", "numero_telefono", "direccion_postal", "localizacion_negocio", "declarante_nombre"]) {
    assert.ok(!missing.includes(prefilled), `${prefilled} should prefill from the canonical profile`);
  }
  // The applicant-owned answers must still be required.
  for (const applicantOwned of ["numero_seguro_social", "periodo", "tiene_licencia", "cerca_escuela_iglesia", "juramento", "firma_aviso"]) {
    assert.ok(missing.includes(applicantOwned), `${applicantOwned} must be required from the applicant`);
  }
});
