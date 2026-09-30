// Golden regression: Darius's live test prompt for PR #109 (fixture model
// extraction; exercises the same validator → rules engine → process graph →
// card grouping pipeline the intake UI runs).
// Run: npx tsx --test src/app/processes/warehouseSolar.golden.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { validateProjectContext } from "../ai/intake/projectContext.ts";
import { kbQuestionIdFor } from "../ai/intake/questionKeyMap.ts";
import { computeRequirementsFromKB, discoveryQuestionsForBusinessType, KB } from "../kb.ts";
import { groupRequirements, splitOtherChecks, type RequirementGroupId } from "../components/filing/requirementGroups.ts";
import { computeEnergyAssessment } from "./view.ts";
import { supersededLegacyCards } from "./legacyCards.ts";
import { evaluateProcesses } from "./engine.ts";

const here = dirname(fileURLToPath(import.meta.url));
const G = JSON.parse(readFileSync(join(here, "goldens", "E01_warehouse_rooftop_solar_caguas.json"), "utf8"));

function runPipeline() {
  const { context, discarded } = validateProjectContext(G.modelProjectContext, G.description);
  // Same deferred-question setup the intake UI uses (computeRequirements in SmartPRIntake).
  const qs = discoveryQuestionsForBusinessType(G.profile.business_type) ?? [];
  const deferredQuestions = qs
    .filter((q) => G.answers[q.id] == null)
    .map((q) => ({ questionId: kbQuestionIdFor(q.id, KB.questions as { id: string }[]), writeKey: q.id }));
  const reqs = computeRequirementsFromKB(G.profile, G.answers, {}, {
    projectIntent: G.projectIntent,
    projectContext: context,
    deferredQuestions,
  }).filter((r) => r.applicability !== "not_applicable");
  const { graph, assessment } = computeEnergyAssessment({ projectContext: context, municipality: G.profile.municipality, answers: G.answers });
  const superseded = supersededLegacyCards(graph, assessment, reqs);
  const visible = reqs.filter((r) => !superseded.has(r.document_id ?? ""));
  const kbDocs = KB.documents as unknown as Array<{ id: string; depends_on_document_ids?: string[] | null }>;
  const grouping = groupRequirements(
    visible.map((r) => ({ documentId: r.document_id, applicability: r.applicability, stage: r.stage, mandatory: r.mandatory, done: false, awaitingAnswer: !!r.unansweredTriggerQuestionId })),
    kbDocs
  );
  const cards = visible.map((r, i) => ({ r, group: grouping[i].group as RequirementGroupId, waitingOn: grouping[i].waitingOn, triggerQuestionId: r.unansweredTriggerQuestionId ?? null }));
  const { main, otherChecks } = splitOtherChecks(cards, { projectIntent: G.projectIntent });
  return { context, discarded, reqs, assessment: assessment!, superseded, main, otherChecks, graph };
}

const out = runPipeline();
const proc = (id: string) => out.assessment.processes.find((p) => p.process_id === id);

test("E01 extraction: new-construction claim for a rooftop install on an existing warehouse is dropped", () => {
  assert.ok(out.discarded.some((d) => d.field === "projectContext.project_type" && /new construction/.test(d.reason)));
  assert.equal(out.context.project_type, undefined);
  assert.equal(out.context.generation_capacity_kw?.value, 400);
  assert.equal(out.context.properties_served?.value, 3);
  assert.equal(out.context.common_ownership?.value, true);
  assert.equal(out.context.energy_applicant_role?.value, "end_use_customer");
});

test("E01: no REQUIRED OGPe construction permit; construction approval is only potentially required", () => {
  const ogpe = out.reqs.find((r) => r.document_id === "DOC_OGPE_CONSTRUCTION_PERMIT");
  assert.ok(!ogpe || (ogpe.applicability !== "required" && !ogpe.mandatory), "no hard-required OGPe card");
  assert.equal(proc("PR_ENERGY_CONSTRUCTION_APPROVAL")?.state, "POTENTIALLY_REQUIRED");
  // Permiso Único (already held) does not wait on a construction permit.
  const pu = out.main.find((c) => c.r.document_id === "DOC_PERMISO_UNICO");
  assert.ok(pu);
  assert.equal(pu!.group, "registrations");
  assert.deepEqual(pu!.waitingOn, []);
});

test("E01: LUMA interconnection is REQUIRED exactly once and never 'verify existing'", () => {
  assert.equal(proc("PR_ENERGY_DG_INTERCONNECTION")?.state, "REQUIRED");
  const legacyEnergyCards = out.main.filter((c) => ["DOC_LUMA_INTERCONNECTION", "DOC_NET_METERING_AGREEMENT"].includes(c.r.document_id ?? ""));
  assert.deepEqual(legacyEnergyCards, [], "legacy LUMA / net-metering cards are rendered through the Energy section");
  assert.equal(out.superseded.get("DOC_LUMA_INTERCONNECTION")?.process_id, "PR_ENERGY_DG_INTERCONNECTION");
  assert.equal(out.superseded.get("DOC_FIRE_CERT")?.process_id, "PR_ENERGY_BESS_FIRE_REVIEW");
  assert.ok(!out.main.some((c) => c.group === "registrations" && /LUMA|Net Metering|Fire/i.test(c.r.name ?? "")));
  const dgReqs = proc("PR_ENERGY_DG_INTERCONNECTION")!.requirements.map((r) => r.id);
  assert.ok(dgReqs.includes("REQ_DG_LIABILITY_INSURANCE"), "400 kW ≥ 300 kW → liability insurance");
});

test("E01: net metering is potentially required and voluntary, never mandatory", () => {
  const nm = proc("PR_ENERGY_NET_METERING")!;
  assert.equal(nm.state, "POTENTIALLY_REQUIRED");
  assert.equal(nm.voluntary, true);
  assert.equal(out.superseded.get("DOC_NET_METERING_AGREEMENT")?.state, "POTENTIALLY_REQUIRED");
});

test("E01: microgrid registration and ESC certification are NEEDS_FACT with context-aware questions", () => {
  assert.equal(proc("PR_ENERGY_MICROGRID_REGISTRATION")?.state, "NEEDS_FACT");
  assert.equal(proc("PR_ENERGY_ESC_CERTIFICATION")?.state, "NEEDS_FACT");
  const q = new Map(out.assessment.questions.map((x) => [x.fact, x]));
  assert.match(q.get("microgrid_configuration")!.question, /Will the 3 buildings share power through their own distribution lines and controls \(a microgrid\)/);
  assert.match(q.get("sells_energy_to_third_parties")!.question, /buildings you own is not a sale/);
  assert.ok(!q.has("energy_applicant_role"), "role was inferred from the description");
  assert.ok(out.assessment.questions.length <= 3);
  // ESC certification is only a conditional prerequisite of microgrid registration.
  const pre = proc("PR_ENERGY_MICROGRID_REGISTRATION")!.prerequisites.find((p) => p.process_id === "PR_ENERGY_ESC_CERTIFICATION");
  assert.ok(pre && pre.conditional && !pre.blocking);
});

test("E01 follow-up: same-owner self-supply microgrid → no registration, no ESC certification (Reg. 9028 § 2.01(E)(1))", () => {
  const a = evaluateProcesses(out.graph, { ...out.assessment.facts, microgrid_configuration: true, sells_energy_to_third_parties: false });
  const st = (id: string) => a.processes.find((p) => p.process_id === id)?.state;
  assert.equal(st("PR_ENERGY_MICROGRID_REGISTRATION"), "NOT_REQUIRED");
  assert.equal(a.processes.find((p) => p.process_id === "PR_ENERGY_MICROGRID_REGISTRATION")!.decided_by.id, "MGR_X1");
  assert.equal(st("PR_ENERGY_MICROGRID_COMPLIANCE"), "NOT_REQUIRED");
  assert.equal(st("PR_ENERGY_ESC_CERTIFICATION"), "NOT_REQUIRED");
  // Selling to tenants flips it.
  const b = evaluateProcesses(out.graph, { ...out.assessment.facts, microgrid_configuration: true, sells_energy_to_third_parties: true, customers_served: 4 });
  assert.equal(b.processes.find((p) => p.process_id === "PR_ENERGY_MICROGRID_REGISTRATION")?.state, "REQUIRED");
  const escPre = b.processes.find((p) => p.process_id === "PR_ENERGY_MICROGRID_REGISTRATION")!.prerequisites.find((p) => p.process_id === "PR_ENERGY_ESC_CERTIFICATION");
  assert.ok(escPre && !escPre.conditional, "a selling microgrid owner must also address Reg. 8701 (§ 6.02)");
});

test("E01: incentives stay separate from compliance", () => {
  assert.ok(out.assessment.incentives.length > 0);
  assert.ok(out.assessment.incentives.every((i) => ["POTENTIALLY_ELIGIBLE", "NEEDS_FACT", "NOT_ELIGIBLE"].includes(i.state)));
  assert.ok(!out.assessment.processes.some((p) => p.process_type === "incentive"));
  assert.ok(out.assessment.gaps.every((g) => !g.process_id.startsWith("INC_")));
});

test("E01: readiness counts only REQUIRED, non-voluntary processes", () => {
  const dg = proc("PR_ENERGY_DG_INTERCONNECTION")!;
  assert.deepEqual(out.assessment.readiness, { satisfied: 0, total: dg.readiness!.total, score: 0 });
  assert.equal(dg.readiness!.total, 9);
});

test("E01: unrelated conditional checks for an existing business are collapsed and asked once per question", () => {
  const mainConditional = out.main.filter((c) => c.group === "conditional").map((c) => c.r.document_id);
  for (const d of ["DOC_EIN", "DOC_HEALTH_PERMIT", "DOC_CONTRACTOR_LICENSE", "DOC_SAM_REGISTRATION", "DOC_WORKERS_COMP", "DOC_DTRH_EMPLOYER_REG", "DOC_HACIENDA_EMPLOYER_WITHHOLDING", "DOC_SIGN_PERMIT", "DOC_IMPORT_EXPORT_REG", "DOC_VEHICLE_REGISTRATION", "DOC_TRANSPORT_PERMIT"]) {
    assert.ok(!mainConditional.includes(d), `${d} should be under Other checks`);
  }
  const collapsed = out.otherChecks.flatMap((q) => q.cards.map((c) => c.r.document_id));
  assert.ok(collapsed.includes("DOC_WORKERS_COMP") && collapsed.includes("DOC_TRANSPORT_PERMIT"), "nothing is dropped");
  const employees = out.otherChecks.filter((q) => q.questionId === "Q_EMPLOYEES_HIRED");
  assert.equal(employees.length, 1, "the employee question is asked once");
  assert.ok(employees[0].cards.length >= 3);
  const ids = out.otherChecks.map((q) => q.questionId);
  assert.equal(new Set(ids).size, ids.length);
});
