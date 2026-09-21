import test from "node:test";
import assert from "node:assert/strict";
import { KB, kbMeta, applyKbSnapshot, computeRequirementsFromKB, discoveryQuestionsForBusinessType } from "./kb";
import { runRulesEngine } from "./rulesEngine";
import { classifyEngineRequirements, applyEntityFormationExclusivity } from "./requirementApplicability";
import { exclusiveFormationRequirements } from "./forms/engine/requirementAugment";
import type { CanonicalApplicationData } from "./forms/engine/types";
import { buildSeedNodes } from "./rk/seed-data";
import { compileKb } from "./rk/compile";
import { determineObligations } from "./compliance/server";
import { evaluateIncentives } from "./incentives/engine";
import { PR_ACT60_CATALOG } from "./incentives/prCatalog";

const bundle = structuredClone(KB);
const profile = { business_type: "Consulting Firm", municipality: "Adjuntas", location_type: "Online Only", number_of_employees: 0 };
const formationIds = ["DOC_CERT_INCORPORATION", "DOC_ARTICLES_ORGANIZATION"];
// This fake accepts exactly the read used by determineObligations. No database,
// schema initializer, route, seeder, scheduler or publisher is invoked.
function snapshotDb(snapshot: unknown) {
  return { query: async (sql: string) => {
    assert.equal(sql, "SELECT kb_json FROM rk_kb_snapshots WHERE is_active LIMIT 1");
    return { rows: snapshot ? [{ kb_json: snapshot }] : [] };
  } } as unknown as Parameters<typeof determineObligations>[0];
}

for (const entityType of ["sole_proprietorship", "partnership"]) {
  test(`F01 ${entityType} receives neither corporate nor LLC formation`, () => {
    const rows = [...formationIds, "DOC_EIN"].map(document_id => ({ document_id }));
    assert.deepEqual(applyEntityFormationExclusivity(rows, entityType), [{ document_id: "DOC_EIN" }]);
    assert.deepEqual(exclusiveFormationRequirements({ business: { entityType } } as CanonicalApplicationData, rows), [{ document_id: "DOC_EIN" }]);
    assert.ok(!computeRequirementsFromKB(profile, {}, {}, { entityType }).some(r => formationIds.includes(r.document_id!)));
  });
}
test("F02b no-employee sole proprietor: EIN is conditional, never blocking (founder judgment 2026-09-16 §29.1)", () => {
  // Sole proprietor + no employees + no other EIN trigger → OPTIONAL/CONDITIONAL.
  // A true sole proprietor with no employees may operate on the owner's SSN
  // for federal purposes; "sole proprietor + no employees" alone never blocks.
  const soleNoEmp = computeRequirementsFromKB(
    { ...profile, business_structure: "sole_proprietorship", number_of_employees: 0 },
    { Q_EMPLOYEES_HIRED: false },
    {},
    { entityType: "sole_proprietorship", projectIntent: "new_business" }
  ).find(r => r.document_id === "DOC_EIN");
  assert.ok(soleNoEmp, "EIN should still surface for a no-employee sole proprietor");
  assert.equal(soleNoEmp?.applicability, "conditional");
  assert.equal(soleNoEmp?.mandatory, false);
  // Positive control: hiring employees keeps the EIN required (RULE_0620 basis).
  const soleWithEmp = computeRequirementsFromKB(
    { ...profile, business_structure: "sole_proprietorship", number_of_employees: 3 },
    { Q_EMPLOYEES_HIRED: true },
    {},
    { entityType: "sole_proprietorship", projectIntent: "new_business" }
  ).find(r => r.document_id === "DOC_EIN");
  assert.equal(soleWithEmp?.applicability, "required");
  assert.equal(soleWithEmp?.mandatory, true);
});
test("alcohol-license prerequisites are children of the alcohol license, never generic restaurant requirements (founder judgment 2026-09-16 §29.2)", () => {
  // A restaurant that does NOT sell alcohol must not receive ASUME, CRIM, or
  // criminal-record prerequisites through the alcohol-license path.
  const restaurantProfile = { business_type: "Restaurant", municipality: "Trujillo Alto", location_type: "Restaurant Location", number_of_employees: 8 };
  const noAlcohol = computeRequirementsFromKB(restaurantProfile, { Q_ALCOHOL_SOLD: false }, {}, { entityType: "limited_liability_company", projectIntent: "new_business" }).map(r => r.document_id);
  for (const id of ["DOC_ALCOHOL_LICENSE", "DOC_ASUME_CLEARANCE", "DOC_CRIM_CLEARANCE", "DOC_BACKGROUND_CHECK"]) {
    assert.ok(!noAlcohol.includes(id), `${id} must not fire for a restaurant with no alcohol`);
  }
  // Positive control: selling alcohol surfaces the license and its prerequisites.
  const withAlcohol = computeRequirementsFromKB(restaurantProfile, { Q_ALCOHOL_SOLD: true }, {}, { entityType: "limited_liability_company", projectIntent: "new_business" }).map(r => r.document_id);
  for (const id of ["DOC_ALCOHOL_LICENSE", "DOC_ASUME_CLEARANCE", "DOC_CRIM_CLEARANCE", "DOC_BACKGROUND_CHECK"]) {
    assert.ok(withAlcohol.includes(id), `${id} should fire when alcohol is sold`);
  }
});
test("F01 persisted obligations exclude sole-proprietor incorporation in bundled and snapshot modes", async () => {
  for (const snapshot of [null, compileKb(buildSeedNodes(), { version: 1, batchId: null })]) {
    const { obligations } = await determineObligations(snapshotDb(snapshot), { ...profile, business_structure: "sole_proprietorship" });
    assert.ok(!obligations.some(r => formationIds.includes(r.requirementId)));
    assert.ok(obligations.some(r => r.requirementId === "DOC_EIN"));
  }
});
test("F01 corporate positive and unknown review cases remain", () => {
  // Positive case: a settled new_business intent still yields a mandatory
  // corporate formation requirement.
  for (const entityType of ["stock_corporation", "close_corporation", "professional_corporation", "nonprofit_nonstock_corporation"]) {
    assert.equal(computeRequirementsFromKB(profile, {}, {}, { entityType, projectIntent: "new_business" }).find(r => r.document_id === formationIds[0])?.mandatory, true);
  }
  // Unknown intent never confirms formation: the requirement surfaces as
  // conditional/unresolved (the honest "more information needed" state).
  for (const entityType of [undefined, "other"]) {
    const row = computeRequirementsFromKB(profile, {}, {}, { entityType }).find(r => r.document_id === formationIds[0]);
    assert.equal(row?.applicability, "conditional");
    assert.equal(row?.mandatory, false);
  }
});
test("F01 project_only and existing_business intents suppress server formation augmentation", async () => {
  // The server pipeline must not imply "form the entity" for a project with
  // no new business: the requirement's trigger (new + unformed) is not met.
  const base = { ...profile, business_structure: "corporation" };
  for (const snapshot of [null, compileKb(buildSeedNodes(), { version: 1, batchId: null })]) {
    const { obligations: formed } = await determineObligations(
      snapshotDb(snapshot), { ...base, project_intent: "new_business" }
    );
    assert.ok(formed.some(r => formationIds.includes(r.requirementId)), "new_business keeps formation");
    for (const intent of ["project_only", "existing_business"]) {
      const { obligations } = await determineObligations(
        snapshotDb(snapshot), { ...base, project_intent: intent }
      );
      assert.ok(
        !obligations.some(r => formationIds.includes(r.requirementId)),
        `formation leaked into persisted obligations for intent=${intent}`
      );
    }
  }
});

for (const municipalityName of ["Adjuntas", "San Juan"]) {
  for (const coastal of [undefined, "not_sure", "not_applies", "applies"] as const) {
    test(`F05 generic env permit deleted: hazardous materials do NOT trigger DOC_ENVIRONMENTAL_PERMIT in ${municipalityName} (coastal=${coastal})`, () => {
      for (const rules of [bundle.rules, [...bundle.rules].reverse()]) {
        const kb = { ...bundle, rules };
        const generated = runRulesEngine(kb, { municipalityName, businessTypeName: "Hotel", answers: { Q_HAZARDOUS_MATERIALS: true } });
        // Validated review 2026-09-16: generic environmental permit rejected;
        // use program-specific obligations instead. The generic doc must not fire.
        const row = classifyEngineRequirements(generated.requirements, { kb, potentialDecisions: coastal ? { coastal } : {} }).find(r => r.document_id === "DOC_ENVIRONMENTAL_PERMIT");
        assert.equal(row, undefined, "deleted DOC_ENVIRONMENTAL_PERMIT should not fire");
      }
    });
  }
}
test("F05 generic env permit deleted: coastal flag alone does NOT trigger it", () => {
  const generated = runRulesEngine(bundle, { municipalityName: "San Juan", businessTypeName: "Hotel", answers: { Q_HAZARDOUS_MATERIALS: false } }).requirements;
  for (const coastal of ["not_sure", "applies", "not_applies"] as const) {
    const row = classifyEngineRequirements(generated, { kb: bundle, potentialDecisions: { coastal } }).find(r => r.document_id === "DOC_ENVIRONMENTAL_PERMIT");
    assert.equal(row, undefined, "deleted DOC_ENVIRONMENTAL_PERMIT should not fire");
  }
  assert.ok(!runRulesEngine(bundle, { municipalityName: "Adjuntas", businessTypeName: "Hotel", answers: { Q_HAZARDOUS_MATERIALS: false } }).requirements.some(r => r.document_id === "DOC_ENVIRONMENTAL_PERMIT"));
});

test("F07 room-tax renewal survives seed compilation and obligation mapping without making registration monthly", async () => {
  const snapshot = compileKb(buildSeedNodes(), { version: 1, batchId: null });
  const renewal = snapshot.extensions.renewals.find(r => r.document_id === "DOC_ROOM_TAX_RETURN");
  assert.ok(renewal);
  for (const [key, value] of Object.entries(bundle.extensions!.renewals![0])) assert.deepEqual(renewal[key], value);
  for (const source of [null, snapshot]) {
    const { obligations } = await determineObligations(snapshotDb(source), profile, { Q_SHORT_TERM_RENTAL: true });
    assert.equal(obligations.find(r => r.requirementId === "DOC_ROOM_TAX_RETURN")?.renewalFrequencyMonths, 1);
    // Tourism registration verified annual 2026-09-14 (CTPR fiscal-year
    // arancel + published renewal requirements) — no longer null.
    assert.equal(obligations.find(r => r.requirementId === "DOC_TOURISM_REGISTRATION")?.renewalFrequencyMonths, 12);
    const negative = await determineObligations(snapshotDb(source), profile, { Q_SHORT_TERM_RENTAL: false });
    assert.ok(!negative.obligations.some(r => r.requirementId === "DOC_ROOM_TAX_RETURN"));
  }
});

function withSnapshot(fn: (snap: ReturnType<typeof compileKb>) => void) {
  const savedKB = structuredClone(KB);
  const savedMeta = { ...kbMeta };
  try { fn(compileKb(buildSeedNodes(), { version: 1, batchId: null })); }
  finally { Object.assign(KB, savedKB); Object.assign(kbMeta, savedMeta); }
}
test("F09 all 141 business types preserve discovery keys, options and order after seed publication", () => {
  withSnapshot(snap => {
    const before = new Map(bundle.businessTypes.map(bt => [bt.name, discoveryQuestionsForBusinessType(bt.name)]));
    assert.equal(applyKbSnapshot(snap), true);
    const mismatches = bundle.businessTypes.filter(bt => JSON.stringify(discoveryQuestionsForBusinessType(bt.name)) !== JSON.stringify(before.get(bt.name)));
    assert.deepEqual(mismatches.map(bt => bt.id), []);
  });
});
test("F09 old snapshot profile questions stay excluded and custom select questions retain their values", () => {
  withSnapshot(snap => {
    const bt = bundle.businessTypes[0];
    // Simulate a previously published seed: stale employee stage and aliases.
    for (const question of snap.questions) {
      if (question.id === "Q_EMPLOYEE_COUNT") question.stage = "discovery";
      if (question.id === "Q_EMPLOYEES_HIRED") question.ui_key = "employees_work_on_site";
    }
    snap.questions.push({ id: "Q_CUSTOM", question: "Custom choice?", type: "select", options: ["A", "B"], ui_key: "custom_choice" });
    snap.businessTypeQuestions.push({ business_type_id: bt.id, question_id: "Q_CUSTOM" });
    snap.businessTypeQuestions.push({ business_type_id: bt.id, question_id: "Q_EMPLOYEE_COUNT" });
    snap.businessTypeQuestions.push({ business_type_id: bt.id, question_id: "Q_EMPLOYEES_HIRED" });
    applyKbSnapshot(snap);
    const questions = discoveryQuestionsForBusinessType(bt.name)!;
    assert.ok(!questions.some(q => q.id === "Q_EMPLOYEE_COUNT"));
    assert.ok(!questions.some(q => q.id === "employees_work_on_site"));
    assert.equal(questions.filter(q => q.id === "employees_hired").length, 1);
    assert.deepEqual(questions.find(q => q.id === "custom_choice")?.options, [{ value: "A", label: "A" }, { value: "B", label: "B" }]);
  });
});

const incomplete = PR_ACT60_CATALOG.filter(p => !p.criteria.length);
test("F06 all 23 industry-only programs need substantive review, with zero eligibility confidence", () => {
  assert.equal(incomplete.length, 23);
  for (const p of incomplete) {
    const result = evaluateIncentives({ industry: p.applicableIndustries.names[0] }, [p], { now: new Date("2026-09-12") }).results[0];
    assert.equal(result.eligibility, "potentially_eligible", p.id);
    assert.equal(result.confidenceScore, 0, p.id);
    assert.equal(result.isGuaranteed, false);
    assert.match(result.explanation, /needs review/i);
  }
});
test("F06 known scope exclusions and unavailable lifecycle remain excluded even with missing criteria", () => {
  const p = incomplete[0];
  for (const program of [p, { ...p, status: "expired" as const }]) {
    const result = evaluateIncentives({ industry: "Outside published scope" }, [program]).results[0];
    assert.equal(result.eligibility, "not_eligible");
    assert.equal(result.isGuaranteed, false);
  }
});

test("F06 empty or scope-only criteria cannot establish substantive eligibility", () => {
  const base = incomplete[0];
  const scope = { id: "CRIT_SCOPE", name: "Industry", description: "Industry scope only", factKey: "industry", operator: "equals" as const, expectedValue: "Manufacturing", required: true, material: true, evidenceTypeIds: [], citation: "Test scope" };
  for (const criteria of [[], [scope], [{ ...scope, factKey: "project_name", required: false }]]) {
    const result = evaluateIncentives({ industry: "Manufacturing", project_name: "Manufacturing" }, [{ ...base, criteria, applicableIndustries: { ids: [], names: [] }, geography: { level: "Puerto Rico", municipalityIds: [], municipalityNames: [] }, automaticEligibility: true }]).results[0];
    assert.equal(result.eligibility, "potentially_eligible");
    assert.equal(result.confidenceScore, 0);
    assert.equal(result.isGuaranteed, false);
    assert.match(result.explanation, /needs review/i);
  }
});

test("REG-ALCOHOL-INTAKE-001: beverage manufacturing discovery asks alcohol questions; nonalcoholic manufacturers stay silent (live S108 finding 2026-09-21)", () => {
  // Live audit finding: the Mayagüez brewery/taproom intake never asked whether
  // alcohol is manufactured or sold, so the validated fabricante chain was
  // unreachable through the real intake. The fix links the alcohol discovery
  // questions to the beverage business types.
  // NOTE: discovery ids pass through QUESTION_KEY_MAP (Q_ALCOHOL_SOLD renders
  // as "alcohol_sold"); Q_ALCOHOL_MANUFACTURED has no mapping and renders raw.
  const mfg = discoveryQuestionsForBusinessType("Beverage Manufacturing")!.map(q => q.id);
  assert.ok(mfg.includes("alcohol_sold"), "beverage manufacturing must ask whether alcohol is sold");
  assert.ok(mfg.includes("Q_ALCOHOL_MANUFACTURED"), "beverage manufacturing must ask whether alcohol is manufactured/bottled");
  const dist = discoveryQuestionsForBusinessType("Beverage Distributor")!.map(q => q.id);
  assert.ok(dist.includes("alcohol_sold"), "beverage distributor must ask whether alcohol is sold");

  // Engine behavior: answering no keeps the fabricante chain silent (it must not
  // be assumed for nonalcoholic manufacturers); answering yes fires it.
  const profile = { business_type: "Beverage Manufacturing", municipality: "Mayagüez", location_type: "Industrial", number_of_employees: 12 };
  const opts = { entityType: "limited_liability_company", projectIntent: "existing_business" } as const;
  const noAlcohol = computeRequirementsFromKB(profile, { Q_ALCOHOL_SOLD: false, Q_ALCOHOL_MANUFACTURED: false }, {}, opts).map(r => r.document_id);
  for (const id of ["DOC_ALCOHOL_LICENSE", "DOC_ASUME_CLEARANCE", "DOC_CRIM_CLEARANCE", "DOC_BACKGROUND_CHECK"]) {
    assert.ok(!noAlcohol.includes(id), `${id} must not fire for a nonalcoholic beverage manufacturer`);
  }
  const brewery = computeRequirementsFromKB(profile, { Q_ALCOHOL_SOLD: true, Q_ALCOHOL_MANUFACTURED: true }, {}, opts).map(r => r.document_id);
  assert.ok(brewery.includes("DOC_ALCOHOL_LICENSE"), "alcohol license must fire when the manufacturer brews and sells alcohol");
  assert.ok(brewery.includes("DOC_ASUME_CLEARANCE"), "ASUME prerequisite must fire on the fabricante path");
});

test("REG-ALCOHOL-INTAKE-002: beverage manufacturing discovery asks alcohol-served + commercial-vehicle questions (live S111 finding 2026-09-21)", () => {
  // Live audit finding: the Guaynabo brewery/taproom intake never asked about
  // on-site alcohol service (the taproom) or commercial vehicles (the
  // keg-delivery box truck), so those card families were unreachable through
  // the real intake. Same discovery-gap class as REG-ALCOHOL-INTAKE-001.
  // NOTE: discovery ids pass through QUESTION_KEY_MAP (Q_ALCOHOL_SERVED
  // renders as "alcohol_served", Q_COMMERCIAL_VEHICLES as
  // "commercial_vehicles").
  const mfg = discoveryQuestionsForBusinessType("Beverage Manufacturing")!.map(q => q.id);
  assert.ok(mfg.includes("alcohol_served"), "beverage manufacturing must ask whether alcohol is served on site");
  assert.ok(mfg.includes("commercial_vehicles"), "beverage manufacturing must ask about commercial vehicles");

  // Engine behavior: answering no keeps the vehicle cards silent; answering
  // yes surfaces them honestly (heuristic NMI — missing vehicle_ownership /
  // transport_type — never promoted to REQUIRED, per the 6818ff1 lesson).
  const profile = { business_type: "Beverage Manufacturing", municipality: "Guaynabo", location_type: "Industrial", number_of_employees: 8 };
  const opts = { entityType: "limited_liability_company", projectIntent: "new_business" } as const;
  const noTruck = computeRequirementsFromKB(profile, { Q_ALCOHOL_SERVED: false, Q_COMMERCIAL_VEHICLES: false }, {}, opts).map(r => r.document_id);
  assert.ok(!noTruck.includes("DOC_VEHICLE_REGISTRATION"), "no vehicle registration card for a brewery with no commercial vehicles");
  assert.ok(!noTruck.includes("DOC_TRANSPORT_PERMIT"), "no transport permit card for a brewery with no commercial vehicles");
  const truck = computeRequirementsFromKB(profile, { Q_COMMERCIAL_VEHICLES: true }, {}, opts);
  const vr = truck.find(r => r.document_id === "DOC_VEHICLE_REGISTRATION");
  assert.ok(vr, "box truck must surface the vehicle registration card");
  assert.equal(vr!.applicability, "needs_more_information", "heuristic vehicle card stays honest NMI");
});
