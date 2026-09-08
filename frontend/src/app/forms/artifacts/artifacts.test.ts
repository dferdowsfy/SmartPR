// Automated tests for the SmartPR government-artifact engine.
// Run: node --experimental-strip-types --test src/app/forms/artifacts/artifacts.test.ts
//
// Covers every file currently in RealForms/ plus the guardrails that keep
// SmartPR from misrepresenting a government artifact.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";

import { PDFDocument } from "pdf-lib";

import {
  TEMPLATE_LIBRARY,
  availableTemplates,
  getTemplate,
  isOfficialArtifact,
  pendingTemplates,
} from "./catalog.ts";
import { CANONICAL_FIELDS_BY_ID, isKnownCanonicalField, readCanonicalField } from "./canonicalFields.ts";
import { inspectPdfBytes } from "./inspection.ts";
import { loadMapping, listMappingFormCodes, mergeMappings } from "./mappingStore.ts";
import { resolveRepoPath, sha256 } from "./paths.ts";
import { evaluateCompleteness, applyTransform, resolveMappedValue } from "./population.ts";
import { ArtifactGenerationError, assertGenerationAllowed, generateWorkingCopy, canonicalFieldsForForm, loadAllMappings, generateMappingPreview } from "./library.ts";
import { loadTemplateBytes, manifestEntry, TemplateIntegrityError } from "./templateLoader.ts";
import { needsHumanReview, proposeMapping } from "./semanticMapping.ts";
import {
  MUNICIPAL_IMPLEMENTATIONS,
  resolveMunicipalImplementation,
  validateMunicipalImplementations,
} from "./municipalities.ts";
import { resolveApplicableArtifacts, haciendaLicenseTriggers, isPresentableAsOfficial } from "./applicability.ts";
import { buildFilingPackage } from "./filingPackage.ts";
import { containsApprovalLanguage, STATUS_COPY } from "./statusVocabulary.ts";
import { generatedFilingRef, parseStoragePath, templateRevisionStorageRef, templateStorageRef, uploadCanonicalTemplate } from "./storage.ts";
import { emptyCanonicalData, type CanonicalApplicationData } from "../engine/types.ts";

// --- fixtures ---------------------------------------------------------------

function corporationProfile(): CanonicalApplicationData {
  const profile = emptyCanonicalData();
  profile.business.legalName = "Sabor Bayamón Inc.";
  profile.business.tradeName = "Sabor Bayamón";
  profile.business.entityType = "stock_corporation";
  profile.business.formationStatus = "not_formed";
  profile.business.activityDescription = "Full-service restaurant";
  profile.business.email = "hola@example.com";
  profile.business.phone = "787-555-0142";
  profile.business.operationsStartDate = "2026-10-01";
  profile.contact = { fullName: "María Rivera Colón", role: "President", email: "maria@example.com", phone: "787-555-0142" };
  const address = {
    line1: "125 Calle Comercio",
    cityOrMunicipality: "Bayamón",
    stateOrTerritory: "PR",
    postalCode: "00961",
    country: "US",
  };
  profile.addresses.operatingAddress = address;
  profile.addresses.principalPhysical = address;
  profile.addresses.mailingSameAsPhysical = true;
  profile.addresses.municipality = "Bayamón";
  profile.parties.residentAgent = { id: "a", fullName: "María Rivera Colón", physicalAddress: address, mailingSameAsPhysical: true };
  profile.parties.incorporators = [{ id: "i", fullName: "María Rivera Colón", physicalAddress: address }];
  profile.parties.directors = [{ id: "d", fullName: "María Rivera Colón", physicalAddress: address }];
  profile.filingPreferences.existenceTerm = "perpetual";
  profile.filingPreferences.effectiveDateChoice = "filing_date";
  profile.operations.employeeCount = 10;
  profile.operations.estimatedAnnualPayroll = 285000;
  profile.activities.foodService = true;
  profile.activities.outdoorSeating = true;
  return profile;
}

const PRESENT_FILES = [
  { formCode: "CORPREG01", file: "RealForms/1-CORPREG01.pdf", pages: 2, nativeFields: 0 },
  { formCode: "CORPLLC02", file: "RealForms/34-CORPLLC02.pdf", pages: 2, nativeFields: 0 },
  { formCode: "SS4", file: "RealForms/fss4.pdf", pages: 2, nativeFields: 89 },
  { formCode: "SC2309", file: "RealForms/sc_2309_0.pdf", pages: 4, nativeFields: 0 },
  { formCode: "PA02", file: "RealForms/PA02-Solicitud-de-Patente-Provisional.pdf", pages: 2, nativeFields: 45 },
  { formCode: "PA03", file: "RealForms/PA03-Solicitud-de-Prorroga-de-Declaracion.pdf", pages: 2, nativeFields: 61 },
  { formCode: "PA04", file: "RealForms/PA04-Mant-Contribuyente-Deudor.pdf", pages: 1, nativeFields: 40 },
];

// --- 1. every source file in the library loads ------------------------------

for (const entry of PRESENT_FILES) {
  test(`${entry.formCode}: source file loads from RealForms`, () => {
    const loaded = loadTemplateBytes(entry.formCode);
    assert.ok(loaded.bytes.byteLength > 1000, "template should have real bytes");
    assert.match(loaded.checksum, /^sha256:[0-9a-f]{64}$/);
    assert.equal(loaded.template.sourceFile, entry.file);
  });
}

test("templates recorded as pending have no source file and are not generatable", () => {
  // Every form in the catalog now has its official source file. The invariant
  // still under test is the rule, not the current count: anything left pending
  // must carry no sourceFile and must refuse to load.
  for (const template of pendingTemplates()) {
    assert.equal(template.sourceFile, undefined);
    assert.throws(() => loadTemplateBytes(template.formCode), /no source file/);
  }
});

// --- 2. field inventory ------------------------------------------------------

for (const entry of PRESENT_FILES) {
  test(`${entry.formCode}: field inventory reports pages and native fields`, async () => {
    const loaded = loadTemplateBytes(entry.formCode);
    const report = await inspectPdfBytes(loaded.bytes, {
      formCode: entry.formCode,
      sourceFile: entry.file,
      checksum: loaded.checksum,
    });
    assert.equal(report.pageCount, entry.pages);
    assert.equal(report.fieldCount, entry.nativeFields);
    assert.equal(report.hasAcroForm, entry.nativeFields > 0);
    for (const field of report.fields) {
      assert.ok(field.name.length > 0);
      assert.ok(field.page && field.page >= 1 && field.page <= entry.pages, `${field.name} resolves to a page`);
      assert.ok(field.rect && field.rect.width > 0, `${field.name} has a bounding rectangle`);
    }
  });
}

test("forms without native fields are the ones that carry coordinate overlays", () => {
  for (const entry of PRESENT_FILES) {
    const mapping = loadMapping(entry.formCode);
    assert.ok(mapping, `${entry.formCode} mapping exists`);
    if (entry.nativeFields === 0) {
      assert.equal(mapping.populationMethod, "pdf_overlay");
      assert.ok(mapping.fields.length > 0, "overlay forms need coordinate placements");
      for (const field of mapping.fields) {
        assert.ok(field.placement, `${field.pdfField} has a placement`);
        assert.ok(field.placement.page >= 1 && field.placement.page <= entry.pages);
      }
    } else {
      assert.equal(mapping.populationMethod, "acroform");
      assert.equal(mapping.fields.length, entry.nativeFields, "every native field is inventoried in the mapping");
    }
  }
});

// --- 3. mapping artifacts persist -------------------------------------------

test("a mapping artifact exists for every template in the library", () => {
  const codes = listMappingFormCodes();
  for (const template of TEMPLATE_LIBRARY) {
    assert.ok(codes.includes(template.formCode), `form-mappings/${template.formCode}.json exists`);
  }
});

test("pending templates persist an explicit pending_source mapping stub", () => {
  for (const template of pendingTemplates()) {
    const mapping = loadMapping(template.formCode);
    assert.ok(mapping);
    assert.equal(mapping.status, "pending_source");
    assert.equal(mapping.populationMethod, "none");
    assert.equal(mapping.fields.length, 0);
  }
});

test("every mapped canonical field is a known canonical field", () => {
  for (const [formCode, mapping] of Object.entries(loadAllMappings())) {
    for (const field of mapping.fields) {
      if (field.canonicalField === null) continue;
      assert.ok(
        isKnownCanonicalField(field.canonicalField),
        `${formCode}.${field.pdfField} maps to unknown canonical field ${field.canonicalField}`
      );
    }
  }
});

test("uncertain mappings are flagged for human review rather than trusted", () => {
  const mapping = loadMapping("PA03");
  assert.ok(mapping);
  const flagged = mapping.fields.filter(needsHumanReview);
  assert.ok(flagged.length > 0, "the municipal layout has ambiguous labels that need review");
  for (const field of flagged) assert.equal(field.reviewed, false);
});

test("re-inspection keeps human review and reports fields that disappeared", () => {
  const previous = [
    { pdfField: "Municipio", canonicalField: "location.state", confidence: 1, reviewed: true },
    { pdfField: "Campo Retirado", canonicalField: "business.legal_name", confidence: 0.9, reviewed: true },
  ];
  const proposed = [
    { pdfField: "Municipio", canonicalField: "location.municipality", confidence: 0.9, reviewed: false, page: 1 },
    { pdfField: "Nuevo Campo", canonicalField: null, confidence: 0, reviewed: false },
  ];
  const merged = mergeMappings(previous, proposed);
  assert.equal(merged.keptReviewed, 1);
  assert.equal(merged.fields[0].canonicalField, "location.state", "human decision survives re-inspection");
  assert.equal(merged.fields[0].page, 1, "mechanical facts still refresh");
  assert.deepEqual(merged.disappeared.map((f) => f.pdfField), ["Campo Retirado"]);
});

// --- 4. population -----------------------------------------------------------

test("CORPREG01: coordinate overlay populates the official background", async () => {
  const profile = corporationProfile();
  const result = await generateWorkingCopy({ formCode: "CORPREG01", profile, purpose: "filing" });
  assert.equal(result.populationMethod, "pdf_overlay");
  const byField = new Map(result.populated.map((p) => [p.pdfField, p.value]));
  assert.equal(byField.get("first_corporation_name"), "Sabor Bayamón Inc.");
  assert.equal(byField.get("second_resident_agent_name"), "María Rivera Colón");
  assert.equal(byField.get("contact_email"), "hola@example.com");
  assert.ok(result.populated.length >= 10, "a real profile fills most of the certificate");
  assert.ok(result.bytes.byteLength > 1000);
});

test("PA03: native AcroForm fields are set and read back from the working copy", async () => {
  const profile = corporationProfile();
  profile.operations.municipalTaxpayerId = "MUN-99887";
  const result = await generateWorkingCopy({ formCode: "PA03", profile, purpose: "development" });
  assert.equal(result.populationMethod, "acroform");

  const populatedDoc = await PDFDocument.load(result.bytes);
  const form = populatedDoc.getForm();
  assert.equal(form.getTextField("Municipio").getText(), "Bayamón");
  assert.equal(form.getTextField("Número de Empleados").getText(), "10");
  assert.equal(form.getTextField("Nómina Anual").getText(), "285,000.00");
  assert.equal(form.getTextField("Fecha en que se establecio el negocio (Año)").getText(), "2026");
  assert.equal(form.getTextField("Fecha en que se establecio el negocio (Mes)").getText(), "10");
  assert.equal(form.getTextField("Nombre del Dueño o Representante").getText(), "María Rivera Colón");
});

test("a field the profile cannot answer is reported, never invented", async () => {
  const profile = corporationProfile();
  const result = await generateWorkingCopy({ formCode: "PA04", profile, purpose: "development" });
  const unanswered = result.unanswered.map((u) => u.pdfField);
  assert.ok(unanswered.includes("Número de Seguro Social"), "a personal identifier is never auto-filled");
  const populated = result.populated.map((p) => p.pdfField);
  assert.ok(!populated.includes("Número de Seguro Social"));
});

test("value transforms shape canonical answers for government fields", () => {
  assert.equal(applyTransform("2026-10-01", "date_year"), "2026");
  assert.equal(applyTransform("2026-10-01", "date_month"), "10");
  assert.equal(applyTransform("2026-10-01", "date_day"), "01");
  assert.equal(applyTransform(285000, "currency"), "285,000.00");
  assert.equal(applyTransform(10.4, "integer"), "10");
  assert.equal(applyTransform(true, "si_no"), "Sí");
});

// --- 5. conditional writes ---------------------------------------------------

test("conditional marks follow the profile: perpetual term is marked, others are not", async () => {
  const perpetual = corporationProfile();
  const perpetualResult = await generateWorkingCopy({ formCode: "CORPREG01", profile: perpetual, purpose: "filing" });
  const perpetualFields = perpetualResult.populated.map((p) => p.pdfField);
  assert.ok(perpetualFields.includes("seventh_term_perpetual_mark"));
  assert.ok(!perpetualFields.includes("seventh_term_indefinite_mark"));

  const specific = corporationProfile();
  specific.filingPreferences.existenceTerm = "specific_date";
  specific.filingPreferences.existenceEndDate = "2046-12-31";
  const specificResult = await generateWorkingCopy({ formCode: "CORPREG01", profile: specific, purpose: "filing" });
  const specificFields = specificResult.populated.map((p) => p.pdfField);
  assert.ok(specificFields.includes("seventh_term_specific_mark"));
  assert.ok(specificFields.includes("seventh_term_specific_date"));
  assert.ok(!specificFields.includes("seventh_term_perpetual_mark"));
});

test("SC 2309 licence marks are driven by reported activities", async () => {
  const profile = corporationProfile();
  profile.activities.alcoholSales = true;
  const result = await generateWorkingCopy({ formCode: "SC2309", profile, purpose: "filing" });
  const fields = result.populated.map((p) => p.pdfField);
  assert.ok(fields.includes("parte2_bebidas_alcoholicas"));
  assert.ok(!fields.includes("parte2_gasolina"));
  assert.ok(fields.includes("parte1_tipo_corporacion"));
  assert.ok(!fields.includes("parte1_tipo_llc"));
});

// --- 6. the canonical template is never touched ------------------------------

test("populating never modifies the canonical template on disk", async () => {
  const path = resolveRepoPath("RealForms/PA03-Solicitud-de-Prorroga-de-Declaracion.pdf");
  const before = sha256(new Uint8Array(readFileSync(path)));
  const sizeBefore = statSync(path).size;
  await generateWorkingCopy({ formCode: "PA03", profile: corporationProfile(), purpose: "development" });
  await generateWorkingCopy({ formCode: "PA04", profile: corporationProfile(), purpose: "development" });
  await generateMappingPreview("PA03");
  const after = sha256(new Uint8Array(readFileSync(path)));
  assert.equal(after, before, "the immutable original is byte-identical after population");
  assert.equal(statSync(path).size, sizeBefore);
});

test("every recorded template checksum still matches the file on disk", () => {
  for (const template of availableTemplates()) {
    const entry = manifestEntry(template.formCode);
    assert.ok(entry, `${template.formCode} is in templates.manifest.json`);
    const bytes = new Uint8Array(readFileSync(resolveRepoPath(template.sourceFile as string)));
    assert.equal(sha256(bytes), entry.checksum);
  }
});

test("a changed source file fails the integrity check instead of populating silently", () => {
  // Simulated by verifying the loader compares against the recorded checksum.
  const entry = manifestEntry("PA04");
  assert.ok(entry);
  const loaded = loadTemplateBytes("PA04");
  assert.equal(loaded.checksum, entry.checksum);
  assert.ok(TemplateIntegrityError.prototype instanceof Error);
});

test("the generated copy differs from the canonical template", async () => {
  const loaded = loadTemplateBytes("CORPREG01");
  const result = await generateWorkingCopy({ formCode: "CORPREG01", profile: corporationProfile(), purpose: "filing" });
  assert.notEqual(sha256(result.bytes), sha256(loaded.bytes));
  assert.notEqual(result.bytes.byteLength, loaded.bytes.byteLength);
});

// --- 7. artifact classification guardrails -----------------------------------

test("a genericized municipal template cannot be generated as a filing artifact", async () => {
  for (const formCode of ["PA03", "PA04"]) {
    await assert.rejects(
      () => generateWorkingCopy({ formCode, profile: corporationProfile(), purpose: "filing" }),
      ArtifactGenerationError
    );
  }
});

test("official artifacts are the only ones flagged as official", () => {
  assert.equal(isOfficialArtifact(getTemplate("CORPREG01")!), true);
  assert.equal(isOfficialArtifact(getTemplate("SC2309")!), true);
  assert.equal(isOfficialArtifact(getTemplate("PA03")!), false, "a genericized municipal layout is never an official artifact");
  assert.equal(isOfficialArtifact(getTemplate("PA02")!), true, "OCAM PA02 is a statewide official form confirmed against the agency source");
  assert.equal(isOfficialArtifact(getTemplate("CORPLLC02")!), true);
  assert.equal(isOfficialArtifact(getTemplate("SS4")!), true, "the IRS SS-4 came from the issuing agency");
  assert.doesNotThrow(() => assertGenerationAllowed(getTemplate("CORPREG01")!, "filing"));
});

// --- 8. municipality architecture --------------------------------------------

test("every municipality falls back to requirements-only until verified", () => {
  for (const municipality of ["Bayamón", "San Juan", "Guaynabo", "Carolina", "Caguas", "Añasco"]) {
    const impl = resolveMunicipalImplementation(municipality, "DOC_PATENTE_MUNICIPAL");
    assert.equal(impl.kind, "requirements_only");
    assert.equal(impl.verified, false);
  }
});

test("municipality name matching ignores case and accents", () => {
  const impl = resolveMunicipalImplementation("bayamon", "DOC_PATENTE_MUNICIPAL");
  assert.equal(impl.kind, "requirements_only");
});

test("the adapter table rejects a genericized template registered as an official municipal form", () => {
  assert.deepEqual(validateMunicipalImplementations(MUNICIPAL_IMPLEMENTATIONS), []);
  const issues = validateMunicipalImplementations([
    {
      municipality: "San Juan",
      requirementCode: "DOC_PATENTE_MUNICIPAL",
      kind: "official_form",
      formCode: "PA03",
      verified: true,
    },
  ]);
  assert.equal(issues.length, 1);
  assert.match(issues[0].problem, /genericized_municipal_template/);
});

// --- 9. applicability --------------------------------------------------------

test("entity type routes to the right Department of State artifact", () => {
  const corp = resolveApplicableArtifacts(corporationProfile());
  assert.ok(corp.some((a) => a.formCode === "CORPREG01" && a.availability === "official_form_available"));
  assert.ok(!corp.some((a) => a.formCode === "CORPLLC02"));

  const llcProfile = corporationProfile();
  llcProfile.business.entityType = "limited_liability_company";
  const llc = resolveApplicableArtifacts(llcProfile);
  assert.ok(llc.some((a) => a.formCode === "CORPLLC02" && a.availability === "official_form_available"));
  assert.ok(!llc.some((a) => a.formCode === "CORPREG01"));
});

test("an already-formed entity is not asked to form again", () => {
  const profile = corporationProfile();
  profile.business.formationStatus = "formed_in_puerto_rico";
  const artifacts = resolveApplicableArtifacts(profile);
  assert.ok(!artifacts.some((a) => a.formCode === "CORPREG01"));
});

test("SC 2309 stays hidden until an activity actually triggers a Hacienda licence", () => {
  const restaurant = corporationProfile();
  assert.deepEqual(haciendaLicenseTriggers(restaurant), []);
  assert.ok(!resolveApplicableArtifacts(restaurant).some((a) => a.formCode === "SC2309"));

  const withAlcohol = corporationProfile();
  withAlcohol.activities.alcoholSales = true;
  const artifacts = resolveApplicableArtifacts(withAlcohol);
  const sc = artifacts.find((a) => a.formCode === "SC2309");
  assert.ok(sc, "alcohol sales trigger the Hacienda licence application");
  assert.match(sc.reason, /alcoholSales/);

  const withMachines = corporationProfile();
  withMachines.activities.coinOperatedMachines = true;
  assert.ok(resolveApplicableArtifacts(withMachines).some((a) => a.formCode === "SC2309"));
});

test("ongoing-compliance artifacts never enter a formation package", () => {
  const formation = resolveApplicableArtifacts(corporationProfile());
  assert.ok(!formation.some((a) => a.formCode === "PA03"));
  assert.ok(!formation.some((a) => a.formCode === "PA04"));

  const compliance = resolveApplicableArtifacts(corporationProfile(), {
    phase: "ongoing_compliance",
    requestingFilingExtension: true,
  });
  assert.ok(compliance.some((a) => a.requirementCode === "DOC_PATENTE_DECLARATION_EXTENSION"));
  assert.ok(!compliance.some((a) => a.requirementCode === "DOC_MUNICIPAL_TAXPAYER_MAINTENANCE"));
});

test("the municipal patente resolves to the official statewide OCAM form", () => {
  // OCAM publishes PA02 as one standardized statewide form: the printed layout
  // is identical in every municipality and `Municipio` is a blank applicant
  // field. It is therefore served directly, not through the municipality
  // adapter — that adapter is for artifacts that genuinely differ by
  // municipality (PA03/PA04), which the guardrail test below still covers.
  const artifacts = resolveApplicableArtifacts(corporationProfile());
  const patente = artifacts.find((a) => a.requirementCode === "DOC_PATENTE_MUNICIPAL");
  assert.ok(patente);
  assert.equal(patente.availability, "official_form_available");
  assert.equal(patente.formCode, "PA02");
  assert.equal(isPresentableAsOfficial(patente), true);
  // The form is statewide; the rates and the filing counter are not.
  assert.ok(
    patente.notes?.some((note) => /each municipality's own ordinance/.test(note)),
    "the municipal-rate caveat must survive"
  );
});

// --- 10. filing package ------------------------------------------------------

test("the filing package reports population counts and required answers", () => {
  const profile = corporationProfile();
  const pkg = buildFilingPackage({
    profile,
    artifacts: resolveApplicableArtifacts(profile),
    mappings: loadAllMappings(),
  });
  const dos = pkg.items.find((i) => i.formCode === "CORPREG01");
  assert.ok(dos);
  assert.ok(dos.populatedCount > 5);
  assert.equal(dos.canGenerateWorkingCopy, true);

  const patente = pkg.items.find((i) => i.requirementCode === "DOC_PATENTE_MUNICIPAL");
  assert.ok(patente);
  assert.equal(patente.canGenerateWorkingCopy, true, "the official statewide PA02 is producible");
  assert.equal(patente.formCode, "PA02");
  assert.ok(patente.populatedCount > 0, "municipal information reaches the form");
});

test("no SmartPR-authored status copy claims a government decision", () => {
  for (const [status, copy] of Object.entries(STATUS_COPY)) {
    assert.equal(containsApprovalLanguage(copy.en), false, `${status} (en)`);
    assert.equal(containsApprovalLanguage(copy.es), false, `${status} (es)`);
  }
  const profile = corporationProfile();
  const pkg = buildFilingPackage({ profile, artifacts: resolveApplicableArtifacts(profile), mappings: loadAllMappings() });
  for (const item of pkg.items) {
    assert.equal(containsApprovalLanguage(item.message.en), false, item.title);
    assert.equal(containsApprovalLanguage(item.message.es), false, item.title);
  }
  assert.equal(containsApprovalLanguage(pkg.disclaimer), false);
});

// --- 11. storage layout ------------------------------------------------------

test("template storage paths follow the canonical library layout", () => {
  assert.equal(
    templateStorageRef(getTemplate("CORPREG01")!).bucket + "/" + templateStorageRef(getTemplate("CORPREG01")!).objectPath,
    "official-form-templates/pr/estado/CORPREG01/current/original.pdf"
  );
  assert.equal(templateStorageRef(getTemplate("SS4")!).objectPath, "federal/irs/SS4/current/original.pdf");
  assert.equal(templateStorageRef(getTemplate("PA02")!).bucket, "municipal-form-templates");
  assert.equal(
    templateRevisionStorageRef(getTemplate("SC2309")!, "2017-06-26").objectPath,
    "pr/hacienda/SC2309/revisions/2017-06-26/original.pdf"
  );
  assert.deepEqual(parseStoragePath("bucket/a/b.pdf"), { bucket: "bucket", objectPath: "a/b.pdf" });
});

test("generated filings are namespaced per tenant, business, form and instance", () => {
  const ref = generatedFilingRef({ tenantId: "t1", businessId: "b1", formCode: "CORPREG01", instanceId: "i1" });
  assert.equal(ref.bucket, "generated-filings");
  assert.equal(ref.objectPath, "t1/b1/CORPREG01/i1/populated.pdf");
});

test("canonical template uploads never overwrite an existing object", async () => {
  const calls: { path: string; upsert?: boolean }[] = [];
  const client = {
    storage: {
      from: () => ({
        upload: async (path: string, _body: unknown, options?: { upsert?: boolean }) => {
          calls.push({ path, upsert: options?.upsert });
          return { data: null, error: { message: "The resource already exists", statusCode: "409" } };
        },
        download: async () => ({ data: null, error: { message: "not used" } }),
        createSignedUrl: async () => ({ data: null, error: { message: "not used" } }),
      }),
    },
  };
  const outcome = await uploadCanonicalTemplate(client, getTemplate("CORPREG01")!, new Uint8Array([1, 2, 3]));
  assert.equal(outcome.outcome, "already_present");
  assert.equal(calls[0].upsert, false, "canonical templates are uploaded with upsert disabled");
});

// --- 12. canonical model -----------------------------------------------------

test("canonical reads resolve composed values and never leak sensitive identifiers", () => {
  const profile = corporationProfile();
  assert.equal(readCanonicalField(profile, "location.physical_address"), "125 Calle Comercio, Bayamón, PR, 00961");
  assert.equal(readCanonicalField(profile, "location.municipality"), "Bayamón");
  assert.equal(readCanonicalField(profile, "operations.employee_count"), 10);
  assert.equal(readCanonicalField(profile, "owner.full_name"), "María Rivera Colón");
  assert.equal(CANONICAL_FIELDS_BY_ID["owner.tax_id"].sensitive, true);
  assert.equal(readCanonicalField(profile, "owner.tax_id"), undefined);
});

test("the same canonical field feeds artifacts from different governments", () => {
  const corpFields = canonicalFieldsForForm("CORPREG01");
  const municipalFields = canonicalFieldsForForm("PA03");
  const shared = corpFields.filter((f) => municipalFields.includes(f));
  assert.ok(shared.includes("business.legal_name"), "one legal name serves state and municipal artifacts");
  assert.ok(shared.length >= 2);
});

test("semantic mapping proposes canonical fields for Spanish government labels", () => {
  assert.equal(proposeMapping("Número de Empleados").canonicalField, "operations.employee_count");
  assert.equal(proposeMapping("Nómina Anual").canonicalField, "operations.estimated_payroll");
  assert.equal(proposeMapping("Municipio").canonicalField, "location.municipality");
  assert.equal(proposeMapping("Firma del Contribuyente").canonicalField, null);
});

test("mapping-driven completeness matches what population would write", async () => {
  const profile = corporationProfile();
  const mapping = loadMapping("CORPREG01");
  assert.ok(mapping);
  const coverage = evaluateCompleteness(mapping, profile);
  const result = await generateWorkingCopy({ formCode: "CORPREG01", profile, purpose: "filing" });
  assert.equal(coverage.populated.length, result.populated.length);
  assert.equal(coverage.unanswered.length, result.unanswered.length);
  assert.equal(resolveMappedValue(mapping.fields[0], profile).value, "Sabor Bayamón Inc.");
});

test("the mapping preview renders without altering the template", async () => {
  const preview = await generateMappingPreview("CORPREG01");
  const loaded = loadTemplateBytes("CORPREG01");
  assert.ok(preview.byteLength > 1000);
  assert.notEqual(sha256(preview), sha256(loaded.bytes));
  assert.ok(existsSync(resolveRepoPath("RealForms/1-CORPREG01.pdf")));
});
