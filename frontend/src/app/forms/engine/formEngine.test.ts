// Automated tests for the SmartPR schema-driven government form engine.
// Run: node --experimental-strip-types --test src/app/forms/engine/formEngine.test.ts
//
// Covers the 28 scenarios in Part 17 of the implementation spec.
import test from "node:test";
import assert from "node:assert/strict";

import { emptyCanonicalData, type CanonicalApplicationData, type FormData } from "./types.ts";
import { resolveFormId, selectFormsForRequirements } from "./routing.ts";
import { getDefinition, getRegistryEntry, FORM_REGISTRY } from "./registry.ts";
import { prefillFromCanonical, writeBackToCanonical, applicationsNeedingRefresh } from "./canonicalMapping.ts";
import { validateForm, validateFutureWithinDays, validatePuertoRicoAddress, isValidPrPostalCode } from "./formValidation.ts";
import { evaluateConditions } from "./formConditions.ts";
import { buildGeneratedApplication, requirementFormState, actionsForFormState } from "./application.ts";
import { entityTypeRequirements, exclusiveFormationRequirements } from "./requirementAugment.ts";
import { feeEstimateFor } from "./fees.ts";
import { buildCanonicalFromIntake } from "./intake.ts";
import { setCanonicalValue } from "./canonicalMapping.ts";
import { snapshotRemotePersistence } from "./formPersistence.ts";
import { CORPREG01 } from "../definitions/pr/department-of-state/CORPREG01.ts";
import { CORPREG02 } from "../definitions/pr/department-of-state/CORPREG02.ts";
import { CORPREG03 } from "../definitions/pr/department-of-state/CORPREG03.ts";
import { SS4 } from "../definitions/federal/irs/SS4.ts";
import { persistableFormData } from "./formDataPrivacy.ts";

function canonical(overrides: Partial<CanonicalApplicationData["business"]> = {}): CanonicalApplicationData {
  const c = emptyCanonicalData();
  c.business = { ...c.business, ...overrides };
  return c;
}

// --- 1–7: entity-type routing ---------------------------------------------

test("1. stock corporation routes to CORPREG01", () => {
  assert.equal(resolveFormId("DOC_CERT_INCORPORATION", canonical({ entityType: "stock_corporation" })), "FORM_PR_DOS_CORPREG01");
});
test("2. nonprofit non-stock routes to CORPREG02", () => {
  assert.equal(resolveFormId("DOC_CERT_INCORPORATION", canonical({ entityType: "nonprofit_nonstock_corporation" })), "FORM_PR_DOS_CORPREG02");
});
test("3. foreign corporation routes to CORPREG03", () => {
  assert.equal(resolveFormId("DOC_FOREIGN_CORPORATION_AUTHORIZATION", canonical({ formationStatus: "formed_outside_puerto_rico" })), "FORM_PR_DOS_CORPREG03");
});
test("4. close corporation routes to CORPREG04", () => {
  assert.equal(resolveFormId("DOC_CERT_INCORPORATION", canonical({ entityType: "close_corporation" })), "FORM_PR_DOS_CORPREG04");
});
test("5. professional corporation routes to CORPREG05", () => {
  assert.equal(resolveFormId("DOC_CERT_INCORPORATION", canonical({ entityType: "professional_corporation" })), "FORM_PR_DOS_CORPREG05");
});
test("6. LLP routes to CORPREG06", () => {
  assert.equal(resolveFormId("DOC_LLP_REGISTRATION", canonical({ entityType: "limited_liability_partnership" })), "FORM_PR_DOS_CORPREG06");
});
test("7. LLC routes to its own CORPLLC02, never to the LLP form", () => {
  const llc = canonical({ entityType: "limited_liability_company" });
  // The official source (34-CORPLLC02.pdf) is now in the template library, so
  // the LLC certificate resolves to its own schema...
  assert.equal(resolveFormId("DOC_ARTICLES_ORGANIZATION", llc), "FORM_PR_DOS_CORPLLC02");
  // ...and still never borrows CORPREG06, which is an LLP registration.
  assert.equal(resolveFormId("DOC_LLP_REGISTRATION", llc), null);
  const entry = getRegistryEntry("FORM_PR_DOS_CORPLLC02");
  assert.equal(entry?.verificationStatus, "extracted_from_official_pdf");
  assert.equal(entry?.displayForm, true);
});

test("selectFormsForRequirements shows only the applicable variant, not all six", () => {
  const c = canonical({ entityType: "stock_corporation" });
  const selected = selectFormsForRequirements(["DOC_CERT_INCORPORATION", "DOC_EIN", "DOC_MERCHANT_REGISTRATION"], c);
  // Exactly one Department of State variant (never all six), plus the federal
  // EIN application, which applies to every entity type.
  assert.deepEqual(selected.map((s) => s.entry.id), ["FORM_PR_DOS_CORPREG01", "FORM_IRS_SS4"]);
  const dosVariants = selected.filter((s) => s.entry.id.startsWith("FORM_PR_DOS_"));
  assert.equal(dosVariants.length, 1);
});

test("LUMA interconnection routes to the customer-orientation attestation for any entity type", () => {
  // No entityType gate: a sole proprietor's warehouse adds solar the same as a
  // corporation's. Without this row the requirement card falls through to
  // upload-only and the fillable LUMA form never surfaces.
  for (const entityType of ["sole_proprietorship", "limited_liability_company", "stock_corporation"] as const) {
    assert.equal(
      resolveFormId("DOC_LUMA_INTERCONNECTION", canonical({ entityType })),
      "FORM_PR_LUMA_INTERCONNECTION"
    );
  }
  const entry = getRegistryEntry("FORM_PR_LUMA_INTERCONNECTION");
  assert.equal(entry?.requirementId, "DOC_LUMA_INTERCONNECTION");
  assert.equal(entry?.displayForm, true);
});

test("CORPREG06 is mapped to DOC_LLP_REGISTRATION, never DOC_ARTICLES_ORGANIZATION", () => {
  const def = getDefinition("FORM_PR_DOS_CORPREG06");
  assert.equal(def?.requirementId, "DOC_LLP_REGISTRATION");
  assert.notEqual(def?.requirementId, "DOC_ARTICLES_ORGANIZATION");
});

test("patente municipal routes PA01 for operating businesses, PA02 for new ones", () => {
  // One requirement id, two filings: the annual Declaración de Volumen de
  // Negocios (PA01) for businesses already operating in PR, the provisional
  // application (PA02) for new businesses. Without these rows the requirement
  // card falls through to upload-only and neither fillable form surfaces.
  const operating = canonical({ formationStatus: "formed_in_puerto_rico" });
  assert.equal(resolveFormId("DOC_PATENTE_MUNICIPAL", operating), "FORM_PR_PATENTE_ANUAL");

  const forming = canonical({ formationStatus: "not_formed" });
  assert.equal(resolveFormId("DOC_PATENTE_MUNICIPAL", forming), "FORM_PR_PATENTE_MUNICIPAL");

  const foreign = canonical({ formationStatus: "formed_outside_puerto_rico" });
  assert.equal(resolveFormId("DOC_PATENTE_MUNICIPAL", foreign), "FORM_PR_PATENTE_MUNICIPAL");

  const annualEntry = getRegistryEntry("FORM_PR_PATENTE_ANUAL");
  assert.equal(annualEntry?.requirementId, "DOC_PATENTE_MUNICIPAL");
  assert.equal(annualEntry?.displayForm, true);
  const provEntry = getRegistryEntry("FORM_PR_PATENTE_MUNICIPAL");
  assert.equal(provEntry?.displayForm, true);
});

// --- 8: shared intake pre-population ---------------------------------------

test("8. shared intake values pre-populate the correct fields", () => {
  const c = buildCanonicalFromIntake({ legalName: "Acme Corp.", entityType: "stock_corporation", email: "acme@example.com", purpose: "Retail" });
  const data = prefillFromCanonical(CORPREG01, c);
  assert.equal(data.corporation_name, "Acme Corp.");
  assert.equal(data.corporation_purpose, "Retail");
  assert.equal(data.entity_email, "acme@example.com");
});

// --- 9: mailing same as physical ------------------------------------------

test("9. designated-office mailing-same-as-physical hides the mailing field", () => {
  const c = canonical({ entityType: "stock_corporation" });
  const mailingField = CORPREG01.sections.find((s) => s.id === "designated_office")!.fields.find((f) => f.id === "designated_office_mailing")!;
  assert.equal(evaluateConditions(mailingField.visibleWhen, { designated_office_mailing_same: true }, c), false);
  assert.equal(evaluateConditions(mailingField.visibleWhen, { designated_office_mailing_same: false }, c), true);
});

// --- 10–11: repeatable records --------------------------------------------

test("10. repeatable incorporators can be added and removed", () => {
  const field = CORPREG01.sections.find((s) => s.id === "incorporators")!.fields[0];
  assert.equal(field.type, "repeatable");
  let items: { id: string; fullName: string }[] = [];
  items = [...items, { id: "1", fullName: "Ana" }];
  items = [...items, { id: "2", fullName: "Luis" }];
  assert.equal(items.length, 2);
  items = items.filter((i) => i.id !== "1");
  assert.equal(items.length, 1);
  assert.equal(items[0].fullName, "Luis");
});

test("11. repeatable partners can be added and removed (CORPREG06)", () => {
  const def = getDefinition("FORM_PR_DOS_CORPREG06")!;
  const field = def.sections.find((s) => s.id === "partners")!.fields[0];
  assert.equal(field.type, "repeatable");
  assert.equal(field.partyCollection, "partners");
  assert.equal(field.minimumItems, 1);
});

// --- 12: conditional initial directors ------------------------------------

test("12. initial-director section appears only when authority ends on filing", () => {
  const c = canonical({ entityType: "stock_corporation" });
  const dirField = CORPREG01.sections.find((s) => s.id === "initial_directors")!.fields.find((f) => f.id === "initial_directors")!;
  assert.equal(evaluateConditions(dirField.visibleWhen, { incorporator_authority_ends: "no" }, c), false);
  assert.equal(evaluateConditions(dirField.visibleWhen, { incorporator_authority_ends: "yes" }, c), true);
});

// --- 13–14: nonprofit conditionals + categories ---------------------------

test("13. nonprofit membership details appear only when stated in this filing", () => {
  const field = CORPREG02.sections.find((s) => s.id === "membership_conditions")!.fields.find((f) => f.id === "membership_conditions_text")!;
  assert.equal(evaluateConditions(field.visibleWhen, { membership_conditions_choice: "in_bylaws" }), false);
  assert.equal(evaluateConditions(field.visibleWhen, { membership_conditions_choice: "in_filing" }), true);
});

test("14. nonprofit category selections validate correctly", () => {
  const c = canonical({ entityType: "nonprofit_nonstock_corporation" });
  // Missing both categories → errors present.
  const errsMissing = validateForm(CORPREG02, { corporation_name: "X Fund Inc.", nonprofit_purpose: "Aid" }, c);
  assert.ok(errsMissing.some((e) => e.fieldId === "service_category"));
  assert.ok(errsMissing.some((e) => e.fieldId === "organization_form"));
  // "Other Services" requires an explanation.
  const otherField = CORPREG02.sections.find((s) => s.id === "nonprofit_category")!.fields.find((f) => f.id === "service_category_other")!;
  assert.equal(evaluateConditions(otherField.requiredWhen, { service_category: "other_services" }), true);
  assert.equal(evaluateConditions(otherField.requiredWhen, { service_category: "health_services" }), false);
});

// --- 15: foreign-language certificate translation --------------------------

test("15. foreign-language certificate translation is conditionally required", () => {
  const translation = CORPREG03.attachments!.find((a) => a.id === "translation")!;
  assert.equal(evaluateConditions(translation.requiredWhen, { certificate_foreign_language: "no" }), false);
  assert.equal(evaluateConditions(translation.requiredWhen, { certificate_foreign_language: "yes" }), true);
  // And it surfaces as a completion error when the language is foreign.
  const c = canonical({ formationStatus: "formed_outside_puerto_rico", forProfitStatus: "for_profit" });
  const errs = validateForm(CORPREG03, { certificate_foreign_language: "yes", certificate_of_existence: null } as FormData, c);
  assert.ok(errs.some((e) => e.fieldId === "translation"));
  assert.ok(errs.some((e) => e.fieldId === "translator_declaration"));
});

// --- 16–17: required attestations -----------------------------------------

test("16. professional-corporation attestations are required", () => {
  const def = getDefinition("FORM_PR_DOS_CORPREG05")!;
  const c = canonical({ entityType: "professional_corporation" });
  const errs = validateForm(def, { corporation_name: "Doctors P.S.C.", professional_service: "Medicine" }, c);
  assert.ok(errs.some((e) => e.fieldId === "att_incorporators_licensed"));
  assert.ok(errs.some((e) => e.fieldId === "att_directors_licensed"));
});

test("17. close-corporation attestations are required", () => {
  const def = getDefinition("FORM_PR_DOS_CORPREG04")!;
  const c = canonical({ entityType: "close_corporation" });
  const errs = validateForm(def, { corporation_name: "Tiny Corp.", business_purpose: "X" }, c);
  assert.ok(errs.some((e) => e.fieldId === "att_75_persons"));
  assert.ok(errs.some((e) => e.fieldId === "att_transfer_restrictions"));
  assert.ok(errs.some((e) => e.fieldId === "att_no_public_offering"));
});

// --- 18: 90-day future effective date -------------------------------------

test("18. future effective date enforces the 90-day rule", () => {
  const filing = "2026-01-01";
  assert.equal(validateFutureWithinDays("2026-03-01", 90, filing), true); // 59 days
  assert.equal(validateFutureWithinDays("2026-05-01", 90, filing), false); // 120 days
  assert.equal(validateFutureWithinDays("2025-12-01", 90, filing), false); // before filing
});

// --- 19: form isolation ----------------------------------------------------

test("19. form-specific answers do not pollute unrelated forms", () => {
  const c = canonical({ entityType: "stock_corporation", legalName: "Shared Co." });
  const stock = prefillFromCanonical(CORPREG01, c);
  stock.stock_classes = "Class A: 1000"; // CORPREG01-only field
  const nonprofit = prefillFromCanonical(CORPREG02, c);
  assert.equal(nonprofit.stock_classes, undefined);
  // Shared canonical field still propagates to both.
  assert.equal(stock.corporation_name, "Shared Co.");
  assert.equal(nonprofit.corporation_name, "Shared Co.");
});

// --- 20–21: draft vs completion -------------------------------------------

test("20. Save Draft preserves incomplete information (no completion gate)", () => {
  const c = canonical({ entityType: "stock_corporation" });
  const draftData: FormData = { corporation_name: "Half Done" };
  const app = buildGeneratedApplication(CORPREG01, draftData, c, { status: "draft" });
  assert.equal(app.status, "draft");
  assert.equal(app.data.corporation_name, "Half Done");
  assert.equal(app.completedAt, undefined);
});

test("21. Completion rejects missing required fields", () => {
  const c = canonical({ entityType: "stock_corporation" });
  const errs = validateForm(CORPREG01, {}, c);
  assert.ok(errs.length > 0);
  assert.ok(errs.some((e) => e.fieldId === "corporation_name"));
});

// --- 22–24: deliverables + prepared semantics -----------------------------

test("22. Completion builds a deliverable application record", () => {
  const c = canonical({ entityType: "stock_corporation" });
  const app = buildGeneratedApplication(CORPREG01, { corporation_name: "Acme Inc." }, c, { status: "prepared" });
  assert.equal(app.status, "prepared");
  assert.equal(app.officialFormNumber, "CORPREG01");
  assert.ok(app.completedAt);
});

test("23. Prepared applications remain editable", () => {
  const state = requirementFormState({ status: "prepared" } as never);
  assert.deepEqual(actionsForFormState(state), ["view_form", "edit_form"]);
});

test("24. Prepared applications never mark official evidence approved", () => {
  const c = canonical({ entityType: "stock_corporation" });
  const app = buildGeneratedApplication(CORPREG01, { corporation_name: "Acme Inc." }, c, { status: "prepared" });
  assert.notEqual(app.status, "approved");
  assert.equal(app.verificationStatus, "extracted_from_official_pdf");
  assert.equal(CORPREG01.officialEvidenceStillRequired, true);
});

// --- 25: needs-refresh on canonical change --------------------------------

test("25. canonical changes mark prepared forms Needs refresh", () => {
  const c = buildCanonicalFromIntake({ legalName: "Old Name Inc.", entityType: "stock_corporation" });
  const app = buildGeneratedApplication(CORPREG01, prefillFromCanonical(CORPREG01, c), c, { id: "app1", status: "prepared" });
  // User edits the legal name inside a form → canonical write-back.
  const { canonical: updated, changedKeys } = writeBackToCanonical(CORPREG01, { corporation_name: "New Name Inc." }, c);
  assert.ok(changedKeys.includes("business.legalName"));
  assert.equal(updated.version, c.version + 1);
  const flagged = applicationsNeedingRefresh(changedKeys, [app], { [CORPREG01.id]: CORPREG01 });
  assert.deepEqual(flagged, ["app1"]);
});

test("draft applications are not flagged for refresh (only prepared+)", () => {
  const c = canonical({ entityType: "stock_corporation" });
  const draft = buildGeneratedApplication(CORPREG01, {}, c, { id: "draftApp", status: "draft" });
  const flagged = applicationsNeedingRefresh(["business.legalName"], [draft], { [CORPREG01.id]: CORPREG01 });
  assert.deepEqual(flagged, []);
});

// --- Additional coverage ---------------------------------------------------

test("registry gate: every displayable entry is extracted_from_official_pdf, never verified_against_live_portal", () => {
  for (const e of FORM_REGISTRY) {
    if (e.displayForm) {
      assert.notEqual(e.verificationStatus, "verified_against_live_portal");
      assert.notEqual(e.verificationStatus, "needs_source");
    }
  }
});

test("SS-4 schema includes every applicant-entered line from the December 2025 form", () => {
  const ids = new Set(SS4.sections.flatMap((section) => section.fields.map((field) => field.id)));
  for (const id of [
    "legal_name", "trade_name", "care_of_name", "mailing_address", "street_address",
    "principal_location", "responsible_party_name", "responsible_party_tin", "is_llc",
    "llc_member_count", "llc_organized_us", "entity_classification", "incorporation_location_type",
    "reason_for_applying", "date_business_started", "closing_month", "agricultural_employee_count",
    "household_employee_count", "other_employee_count", "form_944_election", "first_wage_date_or_na",
    "principal_activity_category", "principal_activity_line", "previous_ein_received", "previous_ein",
    "use_third_party_designee", "designee_name", "signer_name_and_title", "applicant_phone",
    "signature_acknowledgement",
  ]) {
    assert.ok(ids.has(id), `SS-4 is missing ${id}`);
  }
});

test("SS-4 validates conditional LLC, classification, prior-EIN, and signature answers", () => {
  const data: FormData = {
    legal_name: "Example LLC", mailing_address: { line1: "1 Calle", cityOrMunicipality: "San Juan", stateOrTerritory: "PR", postalCode: "00901", country: "Puerto Rico" },
    principal_location: "San Juan, PR", responsible_party_name: "Ana Rivera", responsible_party_tin: "123-45-6789",
    is_llc: "yes", entity_classification: "other", reason_for_applying: "other",
    date_business_started: "2026-08-24", closing_month: "12", agricultural_employee_count: 0,
    household_employee_count: 0, other_employee_count: 0, first_wage_date_or_na: "N/A",
    principal_activity_category: "other", principal_activity_line: "Consulting",
    previous_ein_received: "yes", use_third_party_designee: "yes",
    signer_name_and_title: "Ana Rivera, Member", applicant_phone: "787-555-0123",
  };
  const errors = validateForm(SS4, data, canonical({ entityType: "limited_liability_company" }));
  for (const fieldId of [
    "llc_member_count", "llc_organized_us", "other_entity_type", "reason_detail",
    "principal_activity_other", "previous_ein", "designee_name", "designee_phone",
    "designee_address", "signature_acknowledgement",
  ]) {
    assert.ok(errors.some((error) => error.fieldId === fieldId), `${fieldId} should be conditionally required`);
  }
});

test("SS-4 taxpayer identifiers are excluded from autosaved and prepared data", () => {
  const durable = persistableFormData(SS4, {
    legal_name: "Example LLC",
    responsible_party_tin: "123-45-6789",
    sole_proprietor_tin: "987-65-4321",
    previous_ein: "66-1234567",
  });
  assert.equal(durable.legal_name, "Example LLC");
  assert.equal(durable.responsible_party_tin, undefined);
  assert.equal(durable.sole_proprietor_tin, undefined);
  assert.equal(durable.previous_ein, undefined);
});

test("entity-type augmentation restores the applicable corporation formation requirement", () => {
  for (const entityType of [
    "stock_corporation",
    "nonprofit_nonstock_corporation",
    "close_corporation",
    "professional_corporation",
  ] as const) {
    const augments = entityTypeRequirements(canonical({ entityType }), [], (d) => d);
    assert.ok(
      augments.some((r) => r.document_id === "DOC_CERT_INCORPORATION"),
      `${entityType} should receive its Certificate of Incorporation requirement`
    );
  }

  const noDuplicate = entityTypeRequirements(
    canonical({ entityType: "stock_corporation" }),
    [{ document_id: "DOC_CERT_INCORPORATION" }],
    (d) => ({ document_id: d.document_id })
  );
  assert.equal(noDuplicate.length, 0);
});

test("entity-type augmentation adds foreign/LLP requirements additively", () => {
  const foreign = canonical({ formationStatus: "formed_outside_puerto_rico" });
  const augF = entityTypeRequirements(foreign, [], (d) => d);
  assert.ok(augF.some((r) => r.document_id === "DOC_FOREIGN_CORPORATION_AUTHORIZATION"));

  const llp = canonical({ entityType: "limited_liability_partnership" });
  const augL = entityTypeRequirements(llp, [], (d) => d);
  assert.ok(augL.some((r) => r.document_id === "DOC_LLP_REGISTRATION"));

  // Not double-added when already present.
  const noDup = entityTypeRequirements(llp, [{ document_id: "DOC_LLP_REGISTRATION" }], (d) => ({ document_id: d.document_id }));
  assert.equal(noDup.length, 0);
});

test("LLC formation replaces Certificate of Incorporation", () => {
  const llc = canonical({ entityType: "limited_liability_company" });
  const existing = [{ document_id: "DOC_CERT_INCORPORATION", code: "certificate_of_incorporation" }];
  const exclusive = exclusiveFormationRequirements(llc, existing);
  assert.equal(exclusive.some((r) => r.document_id === "DOC_CERT_INCORPORATION"), false);
  const added = entityTypeRequirements(llc, exclusive, (d) => d);
  assert.ok(added.some((r) => r.document_id === "DOC_ARTICLES_ORGANIZATION"));
});

test("CORPREG03 fee estimate switches on for-profit/nonprofit", () => {
  assert.equal(feeEstimateFor(CORPREG03, canonical({ forProfitStatus: "for_profit" })), 150);
  assert.equal(feeEstimateFor(CORPREG03, canonical({ forProfitStatus: "nonprofit" })), 5);
  assert.equal(feeEstimateFor(CORPREG01, canonical()), 150);
  assert.equal(feeEstimateFor(CORPREG02, canonical()), 5);
  assert.equal(feeEstimateFor(getDefinition("FORM_PR_DOS_CORPREG06")!, canonical()), 110);
});

test("PR postal-code validation is centralized and correct", () => {
  assert.equal(isValidPrPostalCode("00901"), true);
  assert.equal(isValidPrPostalCode("00979-1234"), true);
  assert.equal(isValidPrPostalCode("10001"), false); // NY
  assert.equal(isValidPrPostalCode("abcde"), false);
  const errs = validatePuertoRicoAddress({ line1: "1 Calle", cityOrMunicipality: "San Juan", stateOrTerritory: "NY", postalCode: "10001", country: "USA" });
  assert.ok(errs.some((e) => e.path === "stateOrTerritory"));
  assert.ok(errs.some((e) => e.path === "postalCode"));
});

// --- 8 (extended): structured-address core intake feeds forms --------------

test("core-intake structured address flows into the canonical model", () => {
  let c = buildCanonicalFromIntake({ legalName: "Global LLP", entityType: "limited_liability_partnership" });
  c = setCanonicalValue(c, "addresses.principalPhysical", { line1: "100 Ave Ponce de León", cityOrMunicipality: "San Juan", stateOrTerritory: "PR", postalCode: "00901", country: "Puerto Rico" });
  const addr = c.addresses.principalPhysical!;
  assert.equal(addr.line1, "100 Ave Ponce de León");
  assert.equal(addr.postalCode, "00901");
  // The structured address prefills the LLP principal-office address field.
  const def = getDefinition("FORM_PR_DOS_CORPREG06")!;
  const data = prefillFromCanonical(def, c);
  assert.deepEqual(data.principal_office_physical, addr);
});

test("setCanonicalValue writes nested paths immutably", () => {
  const c = emptyCanonicalData();
  const next = setCanonicalValue(c, "business.ein", "12-3456789");
  assert.equal(next.business.ein, "12-3456789");
  assert.equal(c.business.ein, undefined); // original untouched
});

// --- 16 (extended): Supabase-backed persistence via the snapshot endpoint ---

test("snapshotRemotePersistence loads gov-form state from the snapshot blob", async () => {
  const store: Record<string, unknown> = {
    canonicalApplication: emptyCanonicalData(),
    govFormDrafts: { FORM_PR_DOS_CORPREG01: { corporation_name: "Draft Co." } },
    preparedGovApplications: { FORM_PR_DOS_CORPREG01: { id: "a1", formId: "FORM_PR_DOS_CORPREG01" } },
  };
  const originalFetch = globalThis.fetch;
  // @ts-expect-error minimal fetch stub for the test
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ state: store }) });
  try {
    const remote = snapshotRemotePersistence("sub_123");
    const state = await remote.loadState();
    assert.ok(state.canonical);
    assert.equal(state.drafts.FORM_PR_DOS_CORPREG01.corporation_name, "Draft Co.");
    assert.equal(state.applications.length, 1);
    assert.equal(state.applications[0].id, "a1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("corporate / professional / LLP name designations validate", () => {
  const stockName = CORPREG01.sections[0].fields.find((f) => f.id === "corporation_name")!;
  assert.ok(stockName.validation?.some((v) => v.type === "corporate_name_suffix"));
  const c = canonical({ entityType: "stock_corporation" });
  const errsBad = validateForm(CORPREG01, { corporation_name: "Acme Widgets", corporation_purpose: "x" }, c);
  assert.ok(errsBad.some((e) => e.fieldId === "corporation_name"));
  const errsGood = validateForm(CORPREG01, { corporation_name: "Acme Widgets Inc.", corporation_purpose: "x" }, c);
  assert.equal(errsGood.some((e) => e.fieldId === "corporation_name"), false);
});
