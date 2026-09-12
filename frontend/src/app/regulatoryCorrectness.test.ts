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
test("F01 persisted obligations exclude sole-proprietor incorporation in bundled and snapshot modes", async () => {
  for (const snapshot of [null, compileKb(buildSeedNodes(), { version: 1, batchId: null })]) {
    const { obligations } = await determineObligations(snapshotDb(snapshot), { ...profile, business_structure: "sole_proprietorship" });
    assert.ok(!obligations.some(r => formationIds.includes(r.requirementId)));
    assert.ok(obligations.some(r => r.requirementId === "DOC_EIN"));
  }
});
test("F01 corporate positive and unknown review cases remain", () => {
  for (const entityType of ["stock_corporation", "close_corporation", "professional_corporation", "nonprofit_nonstock_corporation"]) {
    assert.equal(computeRequirementsFromKB(profile, {}, {}, { entityType }).find(r => r.document_id === formationIds[0])?.mandatory, true);
  }
  for (const entityType of [undefined, "other"]) {
    const row = computeRequirementsFromKB(profile, {}, {}, { entityType }).find(r => r.document_id === formationIds[0]);
    assert.equal(row?.applicability, "conditional");
    assert.equal(row?.mandatory, false);
  }
});

for (const municipalityName of ["Adjuntas", "San Juan"]) {
  for (const coastal of [undefined, "not_sure", "not_applies", "applies"] as const) {
    test(`F05 independent hazard survives coastal=${coastal} in ${municipalityName}, regardless of rule order`, () => {
      for (const rules of [bundle.rules, [...bundle.rules].reverse()]) {
        const kb = { ...bundle, rules };
        const generated = runRulesEngine(kb, { municipalityName, businessTypeName: "Hotel", answers: { Q_HAZARDOUS_MATERIALS: true } });
        const row = classifyEngineRequirements(generated.requirements, { kb, potentialDecisions: coastal ? { coastal } : {} }).find(r => r.document_id === "DOC_ENVIRONMENTAL_PERMIT");
        assert.equal(row?.applicability, "required");
        assert.equal(row?.mandatory, true);
        assert.equal(row?.source_rule_id, "RULE_0023");
        assert.match(row?.reason ?? "", /hazardous/i);
        assert.ok(row?.triggerFacts.some(f => f.startsWith("rule:")));
      }
    });
  }
}
test("F05 flag-only environmental basis remains conditional, confirmable and suppressible", () => {
  const generated = runRulesEngine(bundle, { municipalityName: "San Juan", businessTypeName: "Hotel", answers: { Q_HAZARDOUS_MATERIALS: false } }).requirements;
  for (const [coastal, expected] of [["not_sure", "conditional"], ["applies", "required"], ["not_applies", "not_applicable"]] as const) {
    const row = classifyEngineRequirements(generated, { kb: bundle, potentialDecisions: { coastal } }).find(r => r.document_id === "DOC_ENVIRONMENTAL_PERMIT");
    assert.equal(row?.applicability, expected);
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
    assert.equal(obligations.find(r => r.requirementId === "DOC_TOURISM_REGISTRATION")?.renewalFrequencyMonths, null);
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
