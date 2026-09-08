// ============================================================================
// PA02 end-to-end: the UI schema must actually reach the official OCAM PDF.
//
// The risk this file exists to catch: the PA02 UI schema and
// `formDataPopulation.ts::pa02Values()` are coupled by BARE STRING FIELD IDS
// with nothing but convention holding them together. Rename `patente_type` in
// the schema and the form still renders, still validates, still "completes" —
// and silently stops writing to the PDF. These tests read the values back out
// of the generated document, so that failure mode cannot ship quietly.
// ============================================================================

import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";

import { PA02 } from "../definitions/pr/municipal/PA02.ts";
import { getDefinition, getRegistryEntry } from "../engine/registry.ts";
import { prefillFromCanonical } from "../engine/canonicalMapping.ts";
import { validateForm } from "../engine/formValidation.ts";
import { emptyCanonicalData, type CanonicalApplicationData, type FormData } from "../engine/types.ts";
import { generateWorkingCopy } from "./library.ts";

function patenteProfile(): CanonicalApplicationData {
  const profile = emptyCanonicalData();
  profile.business.legalName = "Cafetería La Ceiba LLC";
  profile.business.entityType = "limited_liability_company";
  profile.business.activityDescription = "Restaurante y servicio de alimentos";
  profile.business.phone = "787-555-0143";
  profile.business.ein = "66-1234567";
  profile.business.operationsStartDate = "2026-03-15";
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
  profile.addresses.principalMailing = {
    line1: "PO Box 1180",
    cityOrMunicipality: "Bayamón",
    stateOrTerritory: "PR",
    postalCode: "00960",
    country: "Puerto Rico",
  };
  profile.operations.employeeCount = 9;
  profile.operations.estimatedAnnualPayroll = 214000;
  return profile;
}

/** A complete set of the applicant-owned answers the schema collects. */
function answers(overrides: FormData = {}): FormData {
  return {
    filing_year: "2026",
    uses_fiscal_year: false,
    patente_type: "normal",
    business_type_pr: "corporation",
    notarization_acknowledgement: true,
    ssn_acknowledgement: true,
    ...overrides,
  };
}

async function acroValues(bytes: Uint8Array): Promise<Record<string, string>> {
  const doc = await PDFDocument.load(bytes);
  const out: Record<string, string> = {};
  for (const field of doc.getForm().getFields()) {
    const name = field.getName();
    const kind = field.constructor.name;
    if (kind === "PDFTextField") out[name] = (field as never as { getText(): string | undefined }).getText() ?? "";
    if (kind === "PDFRadioGroup") out[name] = (field as never as { getSelected(): string | undefined }).getSelected() ?? "";
  }
  return out;
}

// --- registry wiring ---------------------------------------------------------

test("PA02 is served as a real schema, not a disabled placeholder", () => {
  const entry = getRegistryEntry("FORM_PR_PATENTE_MUNICIPAL");
  assert.ok(entry, "the patente form is missing from the registry");
  assert.equal(entry.displayForm, true, "the patente form must render");
  assert.equal(entry.requirementId, "DOC_PATENTE_MUNICIPAL");
  assert.equal(getDefinition("FORM_PR_PATENTE_MUNICIPAL")?.officialFormNumber, "PA02");
});

// --- the id contract with the PDF population layer ---------------------------

test("every applicant answer the schema collects reaches the official PDF", async () => {
  const result = await generateWorkingCopy({
    formCode: "PA02",
    profile: patenteProfile(),
    purpose: "filing",
    formData: answers({ patente_type: "exenta", patente_exempt_percent: 60 }),
  });
  const values = await acroValues(result.bytes);

  // Applicant-owned, written through directAcroValues by schema field id.
  assert.equal(values["Tipo de Patente"], "Exenta");
  assert.equal(values["Porciento Patente Exenta"], "60");
  assert.equal(values["Tipo de Negocio"], "Corporación");
  assert.equal(values["Año Natural"], "2026");
  assert.equal(values["Año"], "2026");

  // SmartPR-derived, written from the one canonical profile — never re-asked.
  assert.equal(values["Municipio"], "Bayamón");
  assert.equal(values["Nombre del Individuo, Industria, Negocio u Oficina de Servicio"], "Cafetería La Ceiba LLC");
  assert.equal(values["Número de Empleados"], "9");
  assert.equal(values["Nombre del Dueño o Representante"], "María Rivera Colón");

  // The owner's residential line has NO field in the UI schema on purpose (see
  // the comment in PA02.ts). It must still reach the PDF from the derived
  // canonical value, or removing that field would have silently blanked it.
  assert.ok(
    values["Dirección Residencial del Dueño o Representante"],
    "the owner's residential line must still populate without a UI field"
  );
});

test("the fiscal-year range is written only when the applicant declares one", async () => {
  const profile = patenteProfile();

  const calendar = await acroValues(
    (await generateWorkingCopy({ formCode: "PA02", profile, purpose: "filing", formData: answers() })).bytes
  );
  for (const field of ["Mes desde Rango", "Año desde Rango", "Mes hasta Rango", "Año hasta Rango"]) {
    assert.equal(calendar[field], "", `${field} must stay blank for a calendar-year filer`);
  }

  const fiscal = await acroValues(
    (
      await generateWorkingCopy({
        formCode: "PA02",
        profile,
        purpose: "filing",
        formData: answers({
          uses_fiscal_year: true,
          fiscal_year_from_month: "Julio",
          fiscal_year_from_year: "2026",
          fiscal_year_to_month: "Junio",
          fiscal_year_to_year: "2027",
        }),
      })
    ).bytes
  );
  assert.equal(fiscal["Mes desde Rango"], "Julio");
  assert.equal(fiscal["Año desde Rango"], "2026");
  assert.equal(fiscal["Mes hasta Rango"], "Junio");
  assert.equal(fiscal["Año hasta Rango"], "2027");
});

test("the exemption percentage is not printed on a Normal patente", async () => {
  const values = await acroValues(
    (
      await generateWorkingCopy({
        formCode: "PA02",
        profile: patenteProfile(),
        purpose: "filing",
        // A percentage left over from an earlier answer must not leak onto a
        // form the applicant has since switched back to Normal.
        formData: answers({ patente_type: "normal", patente_exempt_percent: 60 }),
      })
    ).bytes
  );
  assert.equal(values["Tipo de Patente"], "Normal");
  // "0" is the pristine template's own default for this box, not a leak. What
  // must never appear is the exemption percentage the applicant typed before
  // switching back to Normal.
  assert.equal(values["Porciento Patente Exenta"], "0");
});

// --- fields SmartPR must never write -----------------------------------------

test("the notary and official-use blocks are never populated", async () => {
  const values = await acroValues(
    (
      await generateWorkingCopy({
        formCode: "PA02",
        profile: patenteProfile(),
        purpose: "filing",
        formData: answers(),
      })
    ).bytes
  );
  const neverWritten = [
    "Número AFF", "Ciudad Juramentación", "Año Juramentación", "Mes Juramentación",
    "Día Juramentación", "Ciudad donde Habita Juramentación", "Titulo del Oficial que Juramento",
    "Jurado Por (Nombre)", "Jurado por (Apellido)",
    "Comentario", "Nombre Corto", "Nombre del Contribuyente", "Zona Geográfica",
    "Tipo de Negocio (Sección Uso Oficial)",
  ];
  for (const field of neverWritten) {
    assert.equal(values[field], "", `${field} is a notary/official-use box SmartPR must leave blank`);
  }
});

test("the owner's social security number is never printed", async () => {
  const values = await acroValues(
    (
      await generateWorkingCopy({
        formCode: "PA02",
        profile: patenteProfile(),
        purpose: "filing",
        formData: answers(),
      })
    ).bytes
  );
  // A person's government identifier is collected on the artifact by hand;
  // SmartPR does not store it and must not print it.
  assert.equal(values["Seguro Social del Dueño y/o Reg Inc"], "");
  assert.ok(
    PA02.notices?.some((notice) => /social security number/i.test(notice.en)),
    "the form must tell the filer they complete the SSN themselves"
  );
});

// --- completeness gating -----------------------------------------------------

/** What the renderer actually validates: canonical prefill + typed answers. */
function asRendered(profile: CanonicalApplicationData, typed: FormData): FormData {
  return prefillFromCanonical(PA02, profile, typed);
}

test("a complete SmartPR profile leaves only the applicant-owned questions to answer", () => {
  const profile = patenteProfile();

  // Nothing typed yet: the only things missing are the questions this form has
  // to ask, never anything SmartPR already knows.
  const untyped = validateForm(PA02, prefillFromCanonical(PA02, profile), profile);
  assert.deepEqual(
    untyped.map((e) => e.fieldId).sort(),
    ["business_type_pr", "filing_year", "notarization_acknowledgement", "patente_type", "ssn_acknowledgement"],
    "prefill must satisfy every field SmartPR can already answer"
  );

  assert.deepEqual(validateForm(PA02, asRendered(profile, answers()), profile), [], "a complete PA02 must validate");
});

test("the form cannot be completed until the applicant-owned answers exist", () => {
  const profile = patenteProfile();
  const empty = validateForm(PA02, {}, profile);
  for (const id of ["filing_year", "patente_type", "business_type_pr", "municipality"]) {
    assert.ok(empty.some((e) => e.fieldId === id), `${id} must be required`);
  }
});

test("choosing Exenta requires the exemption percentage", () => {
  const profile = patenteProfile();
  const withoutPercent = validateForm(PA02, asRendered(profile, answers({ patente_type: "exenta" })), profile);
  assert.ok(withoutPercent.some((e) => e.fieldId === "patente_exempt_percent"));

  assert.deepEqual(
    validateForm(PA02, asRendered(profile, answers({ patente_type: "exenta", patente_exempt_percent: 60 })), profile),
    []
  );
});

test("declaring a fiscal year requires its full range", () => {
  const profile = patenteProfile();
  const errors = validateForm(PA02, asRendered(profile, answers({ uses_fiscal_year: true })), profile);
  for (const id of ["fiscal_year_from_month", "fiscal_year_from_year", "fiscal_year_to_month", "fiscal_year_to_year"]) {
    assert.ok(errors.some((e) => e.fieldId === id), `${id} must be required once a fiscal year is declared`);
  }
});
