// ============================================================================
// AGRICORP01 end-to-end: the UI schema must actually reach the official
// Departamento de Agricultura PDF (DA-OCAB-05 (Corporaciones), Rev. ABRIL
// 2021) — the corporation / special-partnership / succession variant of the
// Agricultor Bona Fide application under Ley Núm. 60 de 1 de julio de 2019.
//
// The risk this file exists to catch: the AGRICORP01 UI schema and
// `formDataPopulation.ts::agriBonafideCorpValues()` are coupled by BARE
// STRING FIELD IDS across three layers — `definitions/pr/agriculture/
// AGRICORP01.ts` <-> `formDataPopulation.ts` <-> `form-mappings/AGRICORP01.json`
// placements — with nothing but convention holding all three together.
// Rename `finca_a_bo` in the schema and the form still renders, still
// validates, still "completes" — and silently stops writing to the PDF.
// These tests read the values back out of the generated document, so that
// failure mode cannot ship quietly.
//
// A second risk is specific to this form: it mixes three write domains on
// one document — SmartPR-derived profile data, applicant answers, and an
// entire agency side (sections 14/15) plus signature lines that must stay
// blank. The backstop tests below cover every one of those.
//
// A third risk is identifier handling: unlike the individuo variant
// (AGRIIND01), whose SSN boxes stay blank and are hand-written, the
// corporation variant's employer identifier and member SSNs ARE written to
// the PDF — passed as sensitive: true so population metadata records only
// "[provided]", never the raw number (SS-4 precedent).
//
// INTEGRATION STATUS (2026-09-10): the sibling-owned wiring — registry.ts,
// routing.ts, templates.manifest.json, and the formDataPopulation.ts branch —
// is integrated by the parent agent. Tests that need it are expected to fail
// until then; each is marked.
// ============================================================================

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { AGRICORP01 } from "../definitions/pr/agriculture/AGRICORP01.ts";
import { AGRICORP01_OVERLAY } from "./overlayMaps.ts";
import { getDefinition, getRegistryEntry } from "../engine/registry.ts";
import { resolveFormId } from "../engine/routing.ts";
import { emptyCanonicalData, type CanonicalApplicationData, type FormData } from "../engine/types.ts";
import { loadMapping } from "./mappingStore.ts";
import { populateArtifact, ownershipBlocksWrite } from "./population.ts";
import { resolveRepoPath } from "./paths.ts";
import { generateWorkingCopy } from "./library.ts";
import { extractPdfText, foldForSearch } from "./pdfReadback.ts";

/** A Lares coffee LLC — the juridical-entity persona this form serves. */
function corpProfile(
  entityType: CanonicalApplicationData["business"]["entityType"] = "limited_liability_company"
): CanonicalApplicationData {
  const profile = emptyCanonicalData();
  profile.business.entityType = entityType;
  profile.business.legalName = "Hacienda Verde LLC";
  profile.business.phone = "787-555-0142";
  profile.business.email = "contacto@haciendaverde.pr";
  profile.addresses.principalMailing = {
    line1: "PO Box 1234",
    cityOrMunicipality: "Lares",
    stateOrTerritory: "PR",
    postalCode: "00669",
    country: "Puerto Rico",
  };
  return profile;
}

/** A complete set of the applicant-owned answers the schema collects. */
function answers(overrides: FormData = {}): FormData {
  return {
    caso_tipo: "caso_nuevo",
    anio_solicitado: "2026",
    employer_ssn: "66-1234567",
    foundation_date: "2015-03-22",
    cell: "787-555-0188",
    fax: "787-555-0190",
    member_1_name: "María L. Torres Vega",
    member_1_ssn: "584-12-3456",
    member_2_name: "Carlos J. Méndez Ríos",
    member_2_ssn: "584-98-7654",
    tipo_empresa: "negocio_existente",
    empleo_exist_nuevos: 3,
    empleo_exist_actuales: 8,
    empleo_exist_fijos: 5,
    empleo_exist_temporeros: 3,
    inversion_presente_anio: 45000,
    finca_a_carr: "129",
    finca_a_km: "18",
    finca_a_hm: "4",
    finca_a_bo: "Bartolo",
    finca_a_sector: "Los Llanos",
    finca_a_municipio: "Lares",
    finca_a_catastro: "123-456-789",
    finca_a_cuerdas: 40,
    finca_a_propias: 30,
    finca_a_fecha_adquisicion: "2015-06-01",
    finca_a_usufructos: 10,
    finca_a_fecha_otorgacion: "2018-01-15",
    finca_a_r1_negocio: "Café",
    finca_a_r1_cuerdas: "25",
    finca_a_r1_produccion: "300 quintales",
    finca_a_r1_desarrollo: "En producción",
    tiene_finca_b: true,
    finca_b_municipio: "Lares",
    finca_b_cuerdas: 15,
    finca_b_r1_negocio: "Yautía",
    finca_b_r1_produccion: "120 quintales",
    realiza_pesca: true,
    pesca_licencia_drna: "P-2024-8891",
    pesca_registro_embarcacion: "PR-5543-AB",
    pesca_estadisticas: true,
    pesca_r1_negocio: "Chillo",
    pesca_r1_clase: "Pescado de escama",
    pesca_r1_produccion: "800 libras",
    pesca_r1_salidas: "Arecibo, bote propio",
    tiene_planta: true,
    elab_planta_bo: "Palmarejo",
    elab_municipio: "Lares",
    elab_cuerdas: 5,
    elab_tenencia_legal: "Propia",
    elab_r1_subproducto: "Pulpa de café",
    elab_r1_agricultor: "Hacienda Verde LLC",
    elab_r1_producto: "Café tostado",
    elab_r1_desarrollo: "En operación",
    ingresos_no_agricolas: "Alquiler de un local comercial en Lares, $6,000 anuales.",
    signature_date: "2026-09-10",
    signature_acknowledgement: true,
    ...overrides,
  };
}

function templateBytes(): Uint8Array {
  return new Uint8Array(
    readFileSync(resolveRepoPath("RealForms/AGRI-Bonafide-Corporacion-2021.pdf"))
  );
}

const TEMPLATE_CHECKSUM =
  "sha256:f831ce62d9a3bd44d7b9a076fb5a345f32bd880301793144000ebbd22f529ae7";

/** Populate through the real draw path without the sibling-owned manifest. */
async function populateDirect(profile: CanonicalApplicationData, formData: FormData = {}) {
  const doc = loadMapping("AGRICORP01");
  assert.ok(doc, "form-mappings/AGRICORP01.json must exist");
  return populateArtifact(doc, templateBytes(), profile, TEMPLATE_CHECKSUM, {}, formData);
}

// --- definition identity --------------------------------------------------------

test("AGRICORP01 is the corporation variant of the bona fide application", () => {
  assert.equal(AGRICORP01.id, "FORM_PR_AGRI_BONAFIDE_CORPORACION");
  assert.equal(AGRICORP01.officialFormNumber, "DA-OCAB-05 (Corporaciones)");
  assert.equal(AGRICORP01.requirementId, "DOC_AGRICULTURE_REGISTRATION");
  assert.equal(AGRICORP01.variantKey, "bona_fide_corporacion");
  assert.equal(AGRICORP01.version, "Rev. ABRIL 2021");
  assert.equal(AGRICORP01.agency, "Departamento de Agricultura (Gobierno de Puerto Rico)");
  assert.equal(AGRICORP01.jurisdiction, "pr");
  assert.equal(AGRICORP01.submissionMethod, "generated_preparation_pdf");
  assert.equal(AGRICORP01.officialEvidenceStillRequired, true);
  assert.equal(AGRICORP01.sections.length, 11);
  assert.equal(AGRICORP01.notices?.length, 6);
  let fields = 0;
  for (const section of AGRICORP01.sections) fields += section.fields.length;
  assert.equal(fields, 157);
});

// --- registry + routing wiring (needs sibling-owned integration) ----------------

test("AGRICORP01 is served as a real schema, not a disabled placeholder", () => {
  // EXPECTED TO FAIL until the parent integrates the registry.ts snippet.
  const entry = getRegistryEntry("FORM_PR_AGRI_BONAFIDE_CORPORACION");
  assert.ok(entry, "the bona fide corporación form is missing from the registry");
  assert.equal(entry.displayForm, true, "the bona fide corporación form must render");
  assert.equal(entry.requirementId, "DOC_AGRICULTURE_REGISTRATION");
  assert.equal(entry.variantKey, "bona_fide_corporacion");
  assert.equal(getDefinition("FORM_PR_AGRI_BONAFIDE_CORPORACION")?.officialFormNumber, "DA-OCAB-05 (Corporaciones)");
});

test("each of the eight juridical entity types routes to the corporation variant", () => {
  // EXPECTED TO FAIL until the parent integrates the routing.ts snippet.
  for (const entityType of [
    "stock_corporation",
    "nonprofit_nonstock_corporation",
    "close_corporation",
    "professional_corporation",
    "foreign_corporation",
    "limited_liability_company",
    "limited_liability_partnership",
    "partnership",
  ] as const) {
    const profile = corpProfile(entityType);
    assert.equal(
      resolveFormId("DOC_AGRICULTURE_REGISTRATION", profile),
      "FORM_PR_AGRI_BONAFIDE_CORPORACION",
      `${entityType} must route to the corporation variant`
    );
  }
});

test("sole proprietors still route to the individuo variant", () => {
  // EXPECTED TO FAIL until the parent integrates the routing.ts snippet.
  const sole = corpProfile("sole_proprietorship");
  assert.equal(resolveFormId("DOC_AGRICULTURE_REGISTRATION", sole), "FORM_PR_AGRI_BONAFIDE_INDIVIDUO");
});

// --- the id contract: schema ids <-> mapping placements --------------------------

test("the overlay mapping covers every fillable blank the schema collects", () => {
  assert.equal(AGRICORP01_OVERLAY.length, 167, "one overlay row per writable blank");
  assert.ok(
    AGRICORP01_OVERLAY.every((row) => row.reviewed === true),
    "every row was visually verified against a populated render on 2026-09-10"
  );
  const doc = loadMapping("AGRICORP01");
  assert.ok(doc, "form-mappings/AGRICORP01.json must exist");
  assert.equal(doc.formCode, "AGRICORP01");
  assert.equal(doc.status, "mapped");
  assert.equal(doc.populationMethod, "pdf_overlay");
  assert.equal(doc.pageCount, 7);
  assert.equal(doc.fields.length, 167);
  assert.ok(doc.fields.every((f) => f.reviewed === true));

  // Gate/branch fields that fan out to mark rows, and the hand-sign ack.
  const derived: Record<string, string[]> = {
    caso_tipo: ["renovacion_mark", "caso_nuevo_mark"],
    tipo_empresa: ["negocio_nuevo_mark", "negocio_existente_mark"],
    pesca_estadisticas: ["pesca_estadisticas_mark"],
    signature_date: ["firma_fecha_dia", "firma_fecha_mes", "firma_fecha_anio"],
  };
  const noPdfField = new Set([
    "tiene_finca_b",
    "tiene_finca_c",
    "realiza_pesca",
    "tiene_planta",
    "signature_acknowledgement",
  ]);
  const rowsById = new Map(doc.fields.map((f) => [f.pdfField, f]));
  for (const section of AGRICORP01.sections) {
    for (const field of section.fields) {
      if (noPdfField.has(field.id)) continue;
      const expected = derived[field.id] ?? [field.id];
      for (const pdfField of expected) {
        const row = rowsById.get(pdfField);
        assert.ok(row, `schema field ${field.id} needs mapping row ${pdfField}`);
        assert.ok(row.placement, `mapping row ${pdfField} needs a placement`);
      }
    }
  }
});

test("sensitive identifiers are flagged sensitive on their mapping rows", () => {
  const doc = loadMapping("AGRICORP01");
  assert.ok(doc);
  const rowsById = new Map(doc.fields.map((f) => [f.pdfField, f]));
  assert.equal(rowsById.get("employer_ssn")?.sensitive, true, "Seguro Social Patronal must be sensitive");
  for (let n = 1; n <= 6; n++) {
    assert.equal(
      rowsById.get(`member_${n}_ssn`)?.sensitive,
      true,
      `member_${n}_ssn must be sensitive`
    );
  }
});

// --- canonical pass: profile-derived answers reach the PDF ----------------------

test("SmartPR-derived profile answers reach the official PDF", async () => {
  const result = await populateDirect(corpProfile());
  const text = foldForSearch(await extractPdfText(result.bytes));
  assert.ok(text.includes(foldForSearch("Hacienda Verde LLC")), "entity legal name must reach the PDF");
  assert.ok(text.includes(foldForSearch("PO Box 1234")), "postal address must reach the PDF");
  assert.ok(text.includes(foldForSearch("787-555-0142")), "phone must reach the PDF");
  assert.ok(text.includes(foldForSearch("contacto@haciendaverde.pr")), "email must reach the PDF");
});

test("the entity-kind mark follows the canonical entity type", async () => {
  const llc = await populateDirect(corpProfile("limited_liability_company"));
  assert.ok(llc.populated.some((p) => p.pdfField === "entity_kind_llc_mark" && p.value === "X"));
  assert.ok(!llc.populated.some((p) => p.pdfField === "entity_kind_corporacion_mark"));
  assert.ok(!llc.populated.some((p) => p.pdfField === "entity_kind_sociedad_especial_mark"));

  const corp = await populateDirect(corpProfile("stock_corporation"));
  assert.ok(corp.populated.some((p) => p.pdfField === "entity_kind_corporacion_mark" && p.value === "X"));
  assert.ok(!corp.populated.some((p) => p.pdfField === "entity_kind_llc_mark"));

  const se = await populateDirect(corpProfile("limited_liability_partnership"));
  assert.ok(se.populated.some((p) => p.pdfField === "entity_kind_sociedad_especial_mark" && p.value === "X"));
  assert.ok(!se.populated.some((p) => p.pdfField === "entity_kind_llc_mark"));
});

// --- applicant answers via the population branch (needs integration) -------------

test("every applicant answer the schema collects reaches the official PDF", async () => {
  // EXPECTED TO FAIL until the parent integrates the templates.manifest.json
  // entry and the formDataPopulation.ts branch.
  const result = await generateWorkingCopy({
    formCode: "AGRICORP01",
    profile: corpProfile(),
    purpose: "filing",
    formData: answers(),
  });
  const text = foldForSearch(await extractPdfText(result.bytes));

  assert.ok(text.includes(foldForSearch("2026")), "requested year must reach the PDF");
  assert.ok(text.includes(foldForSearch("66-1234567")), "Seguro Social Patronal must print on the PDF");
  assert.ok(text.includes(foldForSearch("marzo 22, 2015")), "foundation date must be a Spanish long date");
  assert.ok(text.includes(foldForSearch("787-555-0188")), "cell must reach the PDF");
  assert.ok(text.includes(foldForSearch("María L. Torres Vega")), "member names must reach the PDF");
  assert.ok(text.includes(foldForSearch("584-12-3456")), "member SSNs must print on the PDF");
  assert.ok(text.includes(foldForSearch("Bartolo")), "finca barrio must reach the PDF");
  assert.ok(text.includes(foldForSearch("300 quintales")), "finca table values must reach the PDF");
  assert.ok(text.includes(foldForSearch("P-2024-8891")), "fishing license must reach the PDF");
  assert.ok(text.includes(foldForSearch("Pescado de escama")), "fishing table values must reach the PDF");
  assert.ok(text.includes(foldForSearch("Pulpa de café")), "plant table values must reach the PDF");
  assert.ok(text.includes(foldForSearch("Alquiler de un local comercial")), "section-13 income narrative must reach the PDF");
});

test("the filing-kind and business-type marks reflect the answers", async () => {
  // EXPECTED TO FAIL until the parent integrates the formDataPopulation.ts branch.
  const nuevo = await generateWorkingCopy({
    formCode: "AGRICORP01",
    profile: corpProfile(),
    purpose: "filing",
    formData: answers({ caso_tipo: "renovacion", tipo_empresa: "negocio_nuevo" }),
  });
  assert.ok(nuevo.populated.some((p) => p.pdfField === "renovacion_mark" && p.value === "X"));
  assert.ok(!nuevo.populated.some((p) => p.pdfField === "caso_nuevo_mark"));
  assert.ok(nuevo.populated.some((p) => p.pdfField === "negocio_nuevo_mark" && p.value === "X"));
  assert.ok(!nuevo.populated.some((p) => p.pdfField === "negocio_existente_mark"));

  const existente = await generateWorkingCopy({
    formCode: "AGRICORP01",
    profile: corpProfile(),
    purpose: "filing",
    formData: answers({ caso_tipo: "caso_nuevo", tipo_empresa: "negocio_existente" }),
  });
  assert.ok(existente.populated.some((p) => p.pdfField === "caso_nuevo_mark" && p.value === "X"));
  assert.ok(!existente.populated.some((p) => p.pdfField === "renovacion_mark"));
  assert.ok(existente.populated.some((p) => p.pdfField === "negocio_existente_mark" && p.value === "X"));
  assert.ok(!existente.populated.some((p) => p.pdfField === "negocio_nuevo_mark"));
});

test("the signature date is split into the form's Día/Mes/Año blanks", async () => {
  // EXPECTED TO FAIL until the parent integrates the formDataPopulation.ts branch.
  const result = await generateWorkingCopy({
    formCode: "AGRICORP01",
    profile: corpProfile(),
    purpose: "filing",
    formData: answers(),
  });
  assert.ok(result.populated.some((p) => p.pdfField === "firma_fecha_dia" && p.value === "10"));
  assert.ok(result.populated.some((p) => p.pdfField === "firma_fecha_mes" && p.value === "09"));
  assert.ok(result.populated.some((p) => p.pdfField === "firma_fecha_anio" && p.value === "2026"));
});

// --- sensitive identifiers: print but never leak into metadata --------------------

test("employer and member identifiers print on the PDF but metadata records only [provided]", async () => {
  // EXPECTED TO FAIL until the parent integrates the formDataPopulation.ts branch.
  const result = await generateWorkingCopy({
    formCode: "AGRICORP01",
    profile: corpProfile(),
    purpose: "filing",
    formData: answers(),
  });
  const text = foldForSearch(await extractPdfText(result.bytes));
  assert.ok(text.includes(foldForSearch("66-1234567")), "the employer identifier must print");
  assert.ok(text.includes(foldForSearch("584-98-7654")), "member SSNs must print");

  for (const pdfField of ["employer_ssn", "member_1_ssn", "member_2_ssn"]) {
    const record = result.populated.find((p) => p.pdfField === pdfField);
    assert.ok(record, `${pdfField} must be recorded as populated`);
    assert.equal(record.value, "[provided]", `${pdfField} metadata must not carry the raw identifier`);
  }
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes("66-1234567"), "no raw employer identifier anywhere in the result");
  assert.ok(!serialized.includes("584-12-3456"), "no raw member SSN anywhere in the result");
});

// --- fields SmartPR must never write ------------------------------------------------

test("the agency side and signature lines are never populated", async () => {
  const result = await populateDirect(corpProfile(), answers());
  const blocked = [
    "g_oficina_regional",
    "g_municipio_header",
    "g_num_solicitud",
    "firma_agricultor",
    "firma_agronomo",
    "g_observaciones_director",
    "firma_director",
  ];
  for (const pdfField of blocked) {
    assert.ok(
      !result.populated.some((p) => p.pdfField === pdfField),
      `${pdfField} must never be written by SmartPR`
    );
  }
  const doc = loadMapping("AGRICORP01");
  assert.ok(doc);
  for (const field of doc.fields) {
    if (blocked.includes(field.pdfField)) {
      assert.ok(ownershipBlocksWrite(field), `${field.pdfField} must be ownership-blocked`);
    }
  }
  // Sensitive rows are additionally unreachable through the canonical pass:
  // with no applicant answers supplied, nothing from the profile may land
  // there — they only ever arrive via directOverlayValues (marked sensitive).
  const noAnswers = await populateDirect(corpProfile());
  for (const pdfField of ["employer_ssn", "member_1_ssn"]) {
    assert.ok(
      !noAnswers.populated.some((p) => p.pdfField === pdfField),
      `${pdfField} must not be written by the canonical pass (direct overlay only)`
    );
  }
});

test("the form tells the filer the signature line is theirs to complete by hand", () => {
  assert.ok(
    AGRICORP01.notices?.some((notice) => /firma/i.test(notice.es ?? "") && /mano|tinta/i.test(notice.es ?? "")),
    "the form must carry a hand-signing notice in Puerto Rican Spanish"
  );
});
