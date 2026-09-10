// ============================================================================
// AGRIIND01 end-to-end: the UI schema must actually reach the official
// Department of Agriculture PDF (DA-OCAB-05, Rev. ABRIL 2021).
//
// The risk this file exists to catch: the AGRIIND01 UI schema and
// `formDataPopulation.ts::agriBonafideIndividuoValues()` are coupled by BARE
// STRING FIELD IDS with nothing but convention holding them together. Rename
// `finca1_barrio` in the schema and the form still renders, still validates,
// still "completes" — and silently stops writing to the PDF. These tests read
// the values back out of the generated document, so that failure mode cannot
// ship quietly.
//
// A second risk is specific to this form: it mixes three write domains on
// one document — SmartPR-derived profile data, applicant answers, and an
// entire agency side (sections 23/24) plus SSN/signature boxes that must stay
// blank. The backstop tests below cover every one of those.
// ============================================================================

import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";

import { AGRIIND01 } from "../definitions/pr/agriculture/AGRIIND01.ts";
import { getDefinition, getRegistryEntry } from "../engine/registry.ts";
import { resolveFormId } from "../engine/routing.ts";
import { prefillFromCanonical } from "../engine/canonicalMapping.ts";
import { validateForm } from "../engine/formValidation.ts";
import { emptyCanonicalData, type CanonicalApplicationData, type FormData } from "../engine/types.ts";
import { generateWorkingCopy } from "./library.ts";

/** A Lares farmer with a coffee/plantain farm — the individuo persona. */
function farmerProfile(): CanonicalApplicationData {
  const profile = emptyCanonicalData();
  profile.business.entityType = "sole_proprietorship";
  profile.business.activityDescription = "Cultivo de café y plátanos";
  profile.contact.fullName = "José Manuel Rivera";
  profile.contact.phone = "787-555-0123";
  profile.contact.email = "jose.rivera@example.com";
  profile.addresses.municipality = "Lares";
  profile.addresses.principalMailing = {
    line1: "PO Box 450",
    cityOrMunicipality: "Lares",
    stateOrTerritory: "PR",
    postalCode: "00669",
    country: "Puerto Rico",
  };
  profile.addresses.operatingAddress = {
    line1: "Carr. 111 Km 12.5",
    cityOrMunicipality: "Lares",
    stateOrTerritory: "PR",
    postalCode: "00669",
    country: "Puerto Rico",
  };
  return profile;
}

const FINCA_TABLE =
  "Negocio Agrícola Cantidad de cuerdas Producción Anual Estimada " +
  "Arrobas libras mazos millares becerros cuartillos Nivel de desarrollo " +
  "en la Finca Describa las condiciones de los negocios en la finca";
const PESCA_TABLE =
  "Negocio Agrícola Clase de Pescado o Marisco Producción Anual Estimada " +
  "Libras de Pescado Marisco Anual Información sobre las Salidas Alta Mar " +
  "Lugar de Desembarco Acompañantes Embarcación entre otras";

/** A complete set of the applicant-owned answers the schema collects. */
function answers(overrides: FormData = {}): FormData {
  return {
    filing_kind: "caso_nuevo",
    filing_year: "2026",
    ssn_acknowledgement: true,
    sexo: "Masculino",
    estado_civil: "Casado",
    fecha_nacimiento: "1978-04-12",
    direccion_residencial: {
      line1: "Carr. 111 Km 12.5 Bo. Piletas",
      cityOrMunicipality: "Lares",
      stateOrTerritory: "PR",
      postalCode: "00669",
      country: "Puerto Rico",
    },
    celular: "787-555-0199",
    ocupacion: "Agricultor",
    experiencia_anos: 15,
    conyuge_nombre: "María del Carmen Torres",
    conyuge_ssn_acknowledgement: true,
    conyuge_ocupacion: "Maestra",
    conyuge_sexo: "Femenino",
    conyuge_fecha_nacimiento: "1980-09-03",
    conyuge_patrono: "Departamento de Educación",
    conyuge_ingreso_anual: 32000,
    business_kind: "existente",
    existente_empleos_nuevos: 1,
    existente_empleos_actuales: 3,
    existente_empleos_fijos: 2,
    existente_empleos_temporeros: 1,
    inversion_actual: 25000,
    finca1_carretera: "111",
    finca1_hm: "5",
    finca1_barrio: "Piletas",
    finca1_sector: "Los Llanos",
    finca1_catastro: "123-456-789",
    finca1_cuerdas_total: 25,
    finca1_cuerdas_propias: 20,
    finca1_fecha_adquisicion: "2005-06-15",
    finca1_cuerdas_arrendadas: 5,
    finca1_fecha_vencimiento: "2028-12-31",
    finca1_negocios_row1: "Café, 10 cuerdas, 200 quintales, en producción",
    finca1_negocios_row3_negocio: "Plátanos",
    finca1_negocios_row3_cuerdas: "5",
    finca1_negocios_row3_produccion: "3000 racimos",
    finca1_negocios_row3_nivel: "En desarrollo",
    tiene_segunda_finca: false,
    realiza_pesca: true,
    pesca_licencia_drna: "P-12345",
    pesca_registro_embarcacion: "PR-6789",
    pesca_libras_estadisticas: "1200",
    pesca_row1: "Chillo, 500 libras al año, desembarco en Arecibo, bote propio",
    tiene_planta: false,
    firma_acknowledgement: true,
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
  }
  return out;
}

// --- registry + routing wiring ------------------------------------------------

test("AGRIIND01 is served as a real schema, not a disabled placeholder", () => {
  const entry = getRegistryEntry("FORM_PR_AGRI_BONAFIDE_INDIVIDUO");
  assert.ok(entry, "the bona fide individuo form is missing from the registry");
  assert.equal(entry.displayForm, true, "the bona fide individuo form must render");
  assert.equal(entry.requirementId, "DOC_AGRICULTURE_REGISTRATION");
  assert.equal(entry.variantKey, "bona_fide_individuo");
  assert.equal(getDefinition("FORM_PR_AGRI_BONAFIDE_INDIVIDUO")?.officialFormNumber, "DA-OCAB-05 (Individuos)");
});

test("sole proprietors route to the individuo variant; other/unmatched entity types fall back to it", () => {
  const sole = farmerProfile();
  sole.business.entityType = "sole_proprietorship";
  assert.equal(
    resolveFormId("DOC_AGRICULTURE_REGISTRATION", sole),
    "FORM_PR_AGRI_BONAFIDE_INDIVIDUO"
  );
  const other = farmerProfile();
  other.business.entityType = "other";
  assert.equal(
    resolveFormId("DOC_AGRICULTURE_REGISTRATION", other),
    "FORM_PR_AGRI_BONAFIDE_INDIVIDUO",
    "the ungated row is the honest natural-person catch-all"
  );
});

// --- the id contract with the PDF population layer ----------------------------

test("every applicant answer the schema collects reaches the official PDF", async () => {
  const result = await generateWorkingCopy({
    formCode: "AGRIIND01",
    profile: farmerProfile(),
    purpose: "filing",
    formData: answers(),
  });
  const values = await acroValues(result.bytes);

  // Solicitud.
  assert.equal(values["AÑO SOLICITADO"], "2026");
  assert.equal(values["CASO NUEVO"], "X");
  assert.equal(values["RENOVACIÓN"], "");

  // SmartPR-derived, written from the one canonical profile — never re-asked.
  assert.equal(values["1 Nombre del Agricultor"], "José Manuel Rivera");
  assert.equal(values["5 Dirección Postal 1"], "PO Box 450, Lares, PR, 00669");
  assert.equal(values["7 Teléfono"], "787-555-0123");
  assert.equal(values["Email"], "jose.rivera@example.com");

  // Datos del agricultor, written through directAcroValues by schema field id.
  assert.equal(values["3 Sexo"], "Masculino");
  assert.equal(values["Estado Civil"], "Casado");
  assert.equal(values["4 Fecha de nacimiento"], "abril 12, 1978");
  assert.equal(values["6 Dirección Residencial 1"], "Carr. 111 Km 12.5 Bo. Piletas");
  assert.equal(values["6 Dirección Residencial 2"], "Lares, PR 00669");
  assert.equal(values["Celular"], "787-555-0199");
  assert.equal(values["8 Ocupación"], "Agricultor");
  assert.equal(values["9 Experiencia Agrícola años"], "15");

  // Cónyuge.
  assert.equal(values["Nombre del Cónyuge"], "María del Carmen Torres");
  assert.equal(values["Ocupación"], "Maestra");
  assert.equal(values["Sexo"], "Femenino");
  assert.equal(values["Fecha de Nacimiento"], "septiembre 3, 1980");
  assert.equal(values["Patrono"], "Departamento de Educación");
  assert.equal(values["Ingreso Anual cónyuge"], "32000");

  // Tipo de empresa y empleo.
  assert.equal(values["17Negocio Existente"], "X");
  assert.equal(values["16Negocio Nuevo"], "");
  assert.equal(values["1 Nuevos a crearse_2"], "1");
  assert.equal(values["2 Actuales_2"], "3");
  assert.equal(values["Fijos_2"], "2");
  assert.equal(values["Temporeros_2"], "1");
  assert.equal(values["18Inversión en Negocio Presente Año"], "25000");

  // Finca 19(a).
  assert.equal(values["19aLocalización de la Finca Núm de Carr"], "111");
  assert.equal(values["Hm"], "5");
  assert.equal(values["Bo"], "Piletas");
  assert.equal(values["Sector"], "Los Llanos");
  assert.equal(values["Municipio"], "Lares");
  assert.equal(values["Núm Catastro de estar disponible"], "123-456-789");
  assert.equal(values["Cantidad de Cuerdas"], "25");
  assert.equal(values["Propias"], "20");
  assert.equal(values["Fecha en que se adquirió"], "junio 15, 2005");
  assert.equal(values["Arrendadas"], "5");
  assert.equal(values["Fecha de vencimiento"], "diciembre 31, 2028");
  assert.equal(values[`${FINCA_TABLE}Row1`], "Café, 10 cuerdas, 200 quintales, en producción");
  assert.equal(values[`${FINCA_TABLE}Row3`], "Plátanos");
  assert.equal(values[`${FINCA_TABLE}Row3_2`], "5");
  assert.equal(values[`${FINCA_TABLE}Row3_3`], "3000 racimos");
  assert.equal(values[`${FINCA_TABLE}Row3_4`], "En desarrollo");

  // The second finca was not reported — its rows stay blank.
  assert.equal(values["Municipio_2"], "Lares", "the finca-2 municipio still prefills from the profile");
  assert.equal(values["Bo_2"], "");
  assert.equal(values[`${FINCA_TABLE}Row1_2`], "");

  // Pesca.
  assert.equal(values["Licencia de Pescador Comercial del DRNA"], "P-12345");
  assert.equal(values["Registro de Embarcación del DRNA"], "PR-6789");
  assert.equal(values["Laboratorio de Investigaciones Pesqueras"], "1200");
  assert.equal(values[`${PESCA_TABLE}Row1`], "Chillo, 500 libras al año, desembarco en Arecibo, bote propio");
});

test("a renovación marks Renovación and clears Caso Nuevo", async () => {
  const values = await acroValues(
    (
      await generateWorkingCopy({
        formCode: "AGRIIND01",
        profile: farmerProfile(),
        purpose: "filing",
        formData: answers({ filing_kind: "renovacion" }),
      })
    ).bytes
  );
  assert.equal(values["RENOVACIÓN"], "X");
  assert.equal(values["CASO NUEVO"], "");
});

test("a new business marks Negocio Nuevo and writes the 16-branch employment", async () => {
  const values = await acroValues(
    (
      await generateWorkingCopy({
        formCode: "AGRIIND01",
        profile: farmerProfile(),
        purpose: "filing",
        formData: answers({
          business_kind: "nuevo",
          nuevo_empleos_nuevos: 4,
          nuevo_empleos_actuales: 0,
          nuevo_empleos_fijos: 2,
          nuevo_empleos_temporeros: 2,
        }),
      })
    ).bytes
  );
  assert.equal(values["16Negocio Nuevo"], "X");
  assert.equal(values["17Negocio Existente"], "");
  assert.equal(values["1 Nuevos a crearse"], "4");
  assert.equal(values["2 Actuales"], "0");
  assert.equal(values["Fijos"], "2");
  assert.equal(values["Temporeros"], "2");
  // The 17-branch boxes must not carry stale values.
  assert.equal(values["1 Nuevos a crearse_2"], "");
  assert.equal(values["2 Actuales_2"], "");
});

// --- fields SmartPR must never write ------------------------------------------

test("the SSN boxes are never printed", async () => {
  const values = await acroValues(
    (
      await generateWorkingCopy({
        formCode: "AGRIIND01",
        profile: farmerProfile(),
        purpose: "filing",
        formData: answers(),
      })
    ).bytes
  );
  // Personal government identifiers are hand-written on the printed form;
  // SmartPR neither stores nor prints them (PA02 precedent).
  assert.equal(values["2 Seguro Social Personal"], "");
  assert.equal(values["Patronal"], "");
  assert.equal(values["Seguro Social"], "");
  assert.ok(
    AGRIIND01.notices?.some((notice) => /seguro social/i.test(notice.es ?? "") && /mano/i.test(notice.es ?? "")),
    "the form must tell the filer the SSN boxes are completed by hand"
  );
});

test("the signature lines are never printed", async () => {
  const values = await acroValues(
    (
      await generateWorkingCopy({
        formCode: "AGRIIND01",
        profile: farmerProfile(),
        purpose: "filing",
        formData: answers(),
      })
    ).bytes
  );
  assert.equal(values["Firma del Agricultor o"], "");
  assert.equal(values["Firma del Agrónomo de Área"], "");
  assert.equal(values["Firma del Director Regional"], "");
  assert.ok(
    AGRIIND01.notices?.some((notice) => /firm/i.test(notice.es ?? "") && /mano/i.test(notice.es ?? "")),
    "the form must tell the filer the signature is done by hand"
  );
});

test("the agency evaluation side (sections 23/24) is never populated", async () => {
  const values = await acroValues(
    (
      await generateWorkingCopy({
        formCode: "AGRIIND01",
        profile: farmerProfile(),
        purpose: "filing",
        formData: answers(),
      })
    ).bytes
  );
  const neverWritten = [
    // Para Uso Interno header.
    "REGIONAL", "MUNICIPIO", "Núm Solicitud",
    // Section 23: the agronomist's 14a/14b income computation.
    "14a Ingreso Bruto Anual A  B",
    "undefined", "undefined_2", "undefined_3", "undefined_4", "undefined_5",
    "undefined_6", "undefined_7", "undefined_8", "undefined_9", "undefined_10",
    "undefined_11",
    "14b Porcentaje de Ingreso Agrícola",
    // Section 23: recommendations and the numbered evaluation.
    "RECOMENDACIÓN 1", "RECOMENDACIÓN 2",
    "1", "2", "3", "4", "5", "6", "7", "8", "9", "10",
    "Cumple", "No Cumple",
    // Section 24: the regional director's validation.
    "1_2", "2_2", "3_2", "1_3", "2_3", "3_3", "4_2", "1_4", "2_4", "3_4",
    "Día",
  ];
  for (const field of neverWritten) {
    assert.equal(values[field], "", `${field} is an agency box SmartPR must leave blank`);
  }
});

// --- completeness gating -----------------------------------------------------

/** What the renderer actually validates: canonical prefill + typed answers. */
function asRendered(profile: CanonicalApplicationData, typed: FormData): FormData {
  return prefillFromCanonical(AGRIIND01, profile, typed);
}

test("a complete SmartPR profile leaves only the applicant-owned questions to answer", () => {
  const profile = farmerProfile();

  // Nothing typed yet: the only things missing are the questions this form has
  // to ask, never anything SmartPR already knows.
  const untyped = validateForm(AGRIIND01, prefillFromCanonical(AGRIIND01, profile), profile);
  assert.deepEqual(
    untyped.map((e) => e.fieldId).sort(),
    [
      "business_kind",
      "direccion_residencial",
      "estado_civil",
      "experiencia_anos",
      "fecha_nacimiento",
      "filing_kind",
      "filing_year",
      "finca1_barrio",
      "finca1_carretera",
      "finca1_cuerdas_total",
      "firma_acknowledgement",
      "ocupacion",
      "sexo",
      "ssn_acknowledgement",
    ].sort(),
    "prefill must satisfy every field SmartPR can already answer"
  );

  assert.deepEqual(validateForm(AGRIIND01, asRendered(profile, answers()), profile), [], "a complete AGRIIND01 must validate");
});

test("marrying the applicant requires the spouse block", () => {
  const profile = farmerProfile();
  const married = validateForm(
    AGRIIND01,
    asRendered(profile, answers({ estado_civil: "Casado", conyuge_nombre: undefined, conyuge_ssn_acknowledgement: undefined })),
    profile
  );
  assert.ok(married.some((e) => e.fieldId === "conyuge_nombre"), "spouse name must be required when married");
  assert.ok(
    married.some((e) => e.fieldId === "conyuge_ssn_acknowledgement"),
    "the spouse SSN hand-write acknowledgement must be required when married"
  );
});
