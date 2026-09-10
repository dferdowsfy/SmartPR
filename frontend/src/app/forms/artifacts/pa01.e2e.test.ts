// ============================================================================
// PA01 end-to-end: the UI schema must actually reach the official OGP PDF.
//
// The risk this file exists to catch: the PA01 UI schema and
// `formDataPopulation.ts::pa01Values()` are coupled by BARE STRING FIELD IDS
// with nothing but convention holding them together. Rename `patente_type` in
// the schema and the form still renders, still validates, still "completes" —
// and silently stops writing to the PDF. These tests read the values back out
// of the generated document, so that failure mode cannot ship quietly.
//
// Second risk: PA01's "Tipo de Patente" and "Tipo de Negocio" choices are
// INDEPENDENT checkboxes in the PDF (not a radio group). A stale answer left
// checked from an earlier choice would print two boxes marked — the tests
// below assert exactly one box is checked per group.
// ============================================================================

import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";

import { PA01 } from "../definitions/pr/municipal/PA01.ts";
import { getDefinition, getRegistryEntry } from "../engine/registry.ts";
import { prefillFromCanonical } from "../engine/canonicalMapping.ts";
import { validateForm } from "../engine/formValidation.ts";
import { emptyCanonicalData, type CanonicalApplicationData, type FormData } from "../engine/types.ts";
import { resolveFormId } from "../engine/routing.ts";
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
  profile.contact.email = "maria@laceiba.example";
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
  profile.operations.municipalTaxpayerId = "BAY-2024-8817";
  return profile;
}

/** A complete set of the applicant-owned answers the schema collects. */
function answers(overrides: FormData = {}): FormData {
  return {
    filing_year: "2025",
    uses_fiscal_year: false,
    amended_return: false,
    final_return: false,
    patente_type: "normal",
    business_type_pr: "corporation",
    computation_acknowledgement: true,
    signature_acknowledgement: true,
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
    if (kind === "PDFCheckBox") {
      out[name] = (field as never as { isChecked(): boolean }).isChecked() ? "checked" : "";
    }
  }
  return out;
}

// --- registry + routing wiring -----------------------------------------------

test("PA01 is served as a real schema, not a disabled placeholder", () => {
  const entry = getRegistryEntry("FORM_PR_PATENTE_ANUAL");
  assert.ok(entry, "the annual patente form is missing from the registry");
  assert.equal(entry.displayForm, true, "the annual patente form must render");
  assert.equal(entry.requirementId, "DOC_PATENTE_MUNICIPAL");
  assert.equal(getDefinition("FORM_PR_PATENTE_ANUAL")?.officialFormNumber, "PA01");
});

test("the annual declaration routes to PA01 for operating businesses, PA02 for new ones", () => {
  const operating = emptyCanonicalData();
  operating.business.formationStatus = "formed_in_puerto_rico";
  assert.equal(
    resolveFormId("DOC_PATENTE_MUNICIPAL", operating),
    "FORM_PR_PATENTE_ANUAL",
    "an already-operating business files the annual declaration"
  );

  const forming = emptyCanonicalData();
  forming.business.formationStatus = "not_formed";
  assert.equal(
    resolveFormId("DOC_PATENTE_MUNICIPAL", forming),
    "FORM_PR_PATENTE_MUNICIPAL",
    "a new business still gets the provisional PA02 application"
  );

  const foreign = emptyCanonicalData();
  foreign.business.formationStatus = "formed_outside_puerto_rico";
  assert.equal(
    resolveFormId("DOC_PATENTE_MUNICIPAL", foreign),
    "FORM_PR_PATENTE_MUNICIPAL",
    "a foreign business opening its first PR operation gets the provisional PA02"
  );
});

// --- the id contract with the PDF population layer ---------------------------

test("every applicant answer the schema collects reaches the official PDF", async () => {
  const profile = patenteProfile();
  const result = await generateWorkingCopy({
    formCode: "PA01",
    profile,
    purpose: "filing",
    formData: filledAnswers(profile, {
      patente_type: "exenta",
      patente_exempt_percent: 90,
      business_type_pr: "corporation",
      amended_return: true,
    }),
  });
  const values = await acroValues(result.bytes);

  // Applicant-owned, written through directAcroValues by schema field id.
  assert.equal(values["Text1"], "2025");
  assert.equal(values["Planilla Enmendada"], "checked");
  assert.equal(values["Planilla Final"], "");
  assert.equal(values["Exenta"], "checked");
  assert.equal(values["Normal"], "", "only one Tipo de Patente box may be checked");
  assert.equal(values["Oficio"], "");
  assert.equal(values["Otros"], "");
  assert.equal(values["Text6"], "90");
  assert.equal(values["Corporación"], "checked");
  assert.equal(values["Individuo"], "", "only one Tipo de Negocio box may be checked");
  assert.equal(values["Sociedad"], "");
  assert.equal(values["Entidad Ignorada"], "");

  // The EIN is printed for a corporation — the shared identifier blank takes
  // the business's own number, never a person's.
  assert.equal(values["Número de Seguro Social o Número de Identificación Patronal"], "66-1234567");

  // SmartPR-derived, written from the one canonical profile — never re-asked.
  assert.equal(values["Municipio de"], "Bayamón");
  assert.equal(values["Nombre de la Persona Sujeta al Pago de Patente"], "María Rivera Colón");
  assert.equal(values["Número de Identificación Municipal"], "BAY-2024-8817");
  assert.equal(values["Núm de Teléfono del Negocio"], "787-555-0143");
  assert.equal(values["Correo electrónico de la persona contacto"], "maria@laceiba.example");
  assert.equal(values["Clase de Industria Negocio o Servicio"], "Restaurante y servicio de alimentos");
  assert.ok(values["Dirección Física del Negocio u Oficina de Servicio"].includes("150 Calle Comerío"));
  assert.equal(values["Zona Postal"], "00959");
  assert.ok(values["Dirección Postal del Negocio"].includes("PO Box 1180"));
  assert.equal(values["Zona Postal_2"], "00960");
  // Establishment date split into the three blanks.
  assert.equal(values["Fecha en que Estableció el Negocio Mes Día Año"], "03");
  assert.equal(values["Text8"], "15");
  assert.equal(values["Text9"], "2026");
});

test("the fiscal-year range and designation are written only when declared", async () => {
  const profile = patenteProfile();

  const calendar = await acroValues(
    (await generateWorkingCopy({ formCode: "PA01", profile, purpose: "filing", formData: filledAnswers(profile) })).bytes
  );
  for (const field of ["Text2", "Text3", "Text4", "Text5", "Año Fiscal"]) {
    assert.equal(calendar[field], "", `${field} must stay blank for a calendar-year filer`);
  }

  const fiscal = await acroValues(
    (
      await generateWorkingCopy({
        formCode: "PA01",
        profile,
        purpose: "filing",
        formData: filledAnswers(profile, {
          uses_fiscal_year: true,
          fiscal_year_from_month: "Julio",
          fiscal_year_from_year: "2026",
          fiscal_year_to_month: "Junio",
          fiscal_year_to_year: "2027",
          fiscal_year_designation: "Año fiscal terminado el 30 de junio de 2027",
        }),
      })
    ).bytes
  );
  assert.equal(fiscal["Text2"], "Julio");
  assert.equal(fiscal["Text3"], "2026");
  assert.equal(fiscal["Text4"], "Junio");
  assert.equal(fiscal["Text5"], "2027");
  assert.equal(fiscal["Año Fiscal"], "Año fiscal terminado el 30 de junio de 2027");
});

test("Oficio and Otros patente types check exactly one box", async () => {
  const oficio = await acroValues(
    (
      await generateWorkingCopy({
        formCode: "PA01",
        profile: patenteProfile(),
        purpose: "filing",
        formData: filledAnswers(patenteProfile(), { patente_type: "oficio" }),
      })
    ).bytes
  );
  assert.equal(oficio["Oficio"], "checked");
  assert.equal(oficio["Normal"], "");
  assert.equal(oficio["Exenta"], "");
  assert.equal(oficio["Otros"], "");

  const otros = await acroValues(
    (
      await generateWorkingCopy({
        formCode: "PA01",
        profile: patenteProfile(),
        purpose: "filing",
        formData: filledAnswers(patenteProfile(), { patente_type: "otros", patente_type_other: "Patente especial por ordenanza 12" }),
      })
    ).bytes
  );
  assert.equal(otros["Otros"], "checked");
  assert.equal(otros["Text7"], "Patente especial por ordenanza 12");
  assert.equal(otros["Normal"], "");
});

test("switching back to Normal unchecks Exenta and drops the percentage", async () => {
  const values = await acroValues(
    (
      await generateWorkingCopy({
        formCode: "PA01",
        profile: patenteProfile(),
        purpose: "filing",
        // A percentage left over from an earlier answer must not leak onto a
        // form the applicant has since switched back to Normal.
        formData: filledAnswers(patenteProfile(), { patente_type: "normal", patente_exempt_percent: 90 }),
      })
    ).bytes
  );
  assert.equal(values["Normal"], "checked");
  assert.equal(values["Exenta"], "");
  assert.equal(values["Text6"], "", "the exemption percentage must not print on a Normal patente");
});

// --- fields SmartPR must never write -----------------------------------------

test("an individuo's identifier blank stays empty — the SSN is hand-written", async () => {
  const values = await acroValues(
    (
      await generateWorkingCopy({
        formCode: "PA01",
        profile: patenteProfile(),
        purpose: "filing",
        formData: filledAnswers(patenteProfile(), { business_type_pr: "individual" }),
      })
    ).bytes
  );
  // The individuo files under their own social security number, which
  // SmartPR never stores or prints. The blank stays for hand entry.
  assert.equal(values["Número de Seguro Social o Número de Identificación Patronal"], "");
  assert.equal(values["Individuo"], "checked");
  assert.ok(
    PA01.notices?.some((notice) => /social security number/i.test(notice.en)),
    "the form must tell the filer the SSN is completed by hand"
  );
});

test("the certification signature and date are never populated", async () => {
  const values = await acroValues(
    (
      await generateWorkingCopy({
        formCode: "PA01",
        profile: patenteProfile(),
        purpose: "filing",
        formData: filledAnswers(patenteProfile()),
      })
    ).bytes
  );
  assert.equal(values["Firma de la persona sujeta al pago de patente"], "");
  assert.equal(values["Fecha"], "");
});

test("the Encasillado 1 computation and the schedules stay blank for the CPA", async () => {
  const values = await acroValues(
    (
      await generateWorkingCopy({
        formCode: "PA01",
        profile: patenteProfile(),
        purpose: "filing",
        formData: filledAnswers(patenteProfile()),
      })
    ).bytes
  );
  // Page-1 summary lines computed from the page-4 schedules.
  const computationFields = [
    "Volumen de Negocios Del encasillado 6 Línea 27 Página 4",
    "Tipo de Patente Fijado por la Legislatura Municipal Del encasillado 6 Línea 29 Página 4",
    "Patente a Pagar Del encasillado 6 Línea 29 Página 4",
    "Penalidad Del Encasillado 6 Línea 32 Página 4",
    "Descuento Del encasillado 6 Línea 33 Página 4",
    "Pago en exceso de años anteriores",
    "Pago con la solicitud de prórroga",
    "34 Página 4",
    "Total a pagar Del encasillado 6 Línea 35 Página 4",
    "Acreditar al año",
    "A reintegrar De haber remanente",
  ];
  for (const field of computationFields) {
    assert.equal(values[field], "", `${field} is the taxpayer's computation — SmartPR must leave it blank`);
  }
  // A sample of the pages 2–4 schedule blanks: none of them are mapped.
  assert.equal(values["5 Intereses recibidos o devengados sobre préstamos"], "");
  assert.equal(values["15 Ingreso bruto del año de contabilidad inmediatamente anterior al actual"], "");
  assert.equal(values["Negocio no financiero"], "");
});

// --- completeness gating -----------------------------------------------------

/** What the renderer actually validates: canonical prefill + typed answers. */
function asRendered(profile: CanonicalApplicationData, typed: FormData): FormData {
  return prefillFromCanonical(PA01, profile, typed);
}

/**
 * What the schema-driven builder hands to generation: prefill has already run,
 * so canonicalKey fields (e.g. employer_ein) carry the profile's values unless
 * the filer corrected them.
 */
function filledAnswers(profile: CanonicalApplicationData, overrides: FormData = {}): FormData {
  return asRendered(profile, answers(overrides));
}

test("a complete SmartPR profile leaves only the applicant-owned questions to answer", () => {
  const profile = patenteProfile();

  // Nothing typed yet: the only things missing are the questions this form has
  // to ask, never anything SmartPR already knows.
  const untyped = validateForm(PA01, prefillFromCanonical(PA01, profile), profile);
  assert.deepEqual(
    untyped.map((e) => e.fieldId).sort(),
    [
      "business_type_pr",
      "computation_acknowledgement",
      "filing_year",
      "patente_type",
      "signature_acknowledgement",
      "ssn_acknowledgement",
    ],
    "prefill must satisfy every field SmartPR can already answer"
  );

  assert.deepEqual(validateForm(PA01, asRendered(profile, answers()), profile), [], "a complete PA01 must validate");
});

test("the form cannot be completed until the applicant-owned answers exist", () => {
  const empty = validateForm(PA01, {}, patenteProfile());
  for (const id of ["filing_year", "patente_type", "business_type_pr", "municipality"]) {
    assert.ok(empty.some((e) => e.fieldId === id), `${id} must be required`);
  }
});

test("choosing Exenta requires the exemption percentage; Otros requires the specification", () => {
  const profile = patenteProfile();
  const withoutPercent = validateForm(PA01, asRendered(profile, answers({ patente_type: "exenta" })), profile);
  assert.ok(withoutPercent.some((e) => e.fieldId === "patente_exempt_percent"));

  const withoutSpec = validateForm(PA01, asRendered(profile, answers({ patente_type: "otros" })), profile);
  assert.ok(withoutSpec.some((e) => e.fieldId === "patente_type_other"));

  assert.deepEqual(
    validateForm(PA01, asRendered(profile, answers({ patente_type: "exenta", patente_exempt_percent: 90 })), profile),
    []
  );
});

test("declaring a fiscal year requires its full range", () => {
  const profile = patenteProfile();
  const errors = validateForm(PA01, asRendered(profile, answers({ uses_fiscal_year: true })), profile);
  for (const id of ["fiscal_year_from_month", "fiscal_year_from_year", "fiscal_year_to_month", "fiscal_year_to_year"]) {
    assert.ok(errors.some((e) => e.fieldId === id), `${id} must be required once a fiscal year is declared`);
  }
});
