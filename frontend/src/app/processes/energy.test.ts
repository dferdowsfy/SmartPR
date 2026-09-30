// Energy-sector regulatory process graph: scenario tests (no live LLM calls).
// Run: npx tsx --test src/app/processes/energy.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadEnergyProcessGraph } from "./kb.ts";
import { evaluateProcesses, explainProcess, linkLegacyDocuments, type ProcessAssessment } from "./engine.ts";
import { evaluateCondition } from "./conditions.ts";
import { energyFactsFromProjectContext } from "./energyFacts.ts";
import { validateProjectContext } from "../ai/intake/projectContext.ts";
import { runRulesEngine, type KnowledgeBase } from "../rulesEngine.ts";
import type { FactMap } from "./types.ts";

const graph = loadEnergyProcessGraph();
const run = (facts: FactMap, provided: string[] = []) => evaluateProcesses(graph, facts, { providedEvidenceIds: provided });
const proc = (a: ProcessAssessment, id: string) => a.processes.find((p) => p.process_id === id);
const state = (a: ProcessAssessment, id: string) => proc(a, id)?.state;
const inc = (a: ProcessAssessment, id: string) => a.incentives.find((i) => i.incentive_id === id);
const required = (a: ProcessAssessment) => a.processes.filter((p) => p.state === "REQUIRED").map((p) => p.process_id);
const asked = (a: ProcessAssessment) => a.questions.map((q) => q.fact);

// ---------------------------------------------------------------- KB ----

test("KB integrity: every rule, exception and requirement carries a verified-dated primary source", () => {
  for (const s of graph.sources.values()) {
    assert.ok(/^https?:\/\//.test(s.url), `${s.id} url`);
    assert.equal(s.date_last_verified, "2026-09-29", `${s.id} date_last_verified`);
    assert.ok(s.title && s.authority, `${s.id} title/authority`);
    assert.ok(["high", "medium", "low"].includes(s.confidence));
  }
  for (const p of graph.processes.values()) {
    assert.ok(["permit", "license", "registration", "certification", "interconnection", "incentive", "inspection", "filing", "approval"].includes(p.process_type));
    for (const r of p.applicability) {
      assert.ok(graph.sources.has(r.source_id), `${r.id} source`);
      assert.ok(r.controlling_language && r.locator && r.confidence && r.status, `${r.id} citation fields`);
    }
  }
  for (const r of graph.requirements.values()) {
    assert.ok(r.controlling_language && r.locator, `${r.id} citation fields`);
    if (r.kind !== "agency_step") assert.ok(r.evidence_ids.length > 0, `${r.id} evidence`);
    for (const e of r.evidence_ids) assert.match(e, /^DOC_[A-Z0-9_]{1,80}$/, "evidence ids reuse the locker DOC_* tag vocabulary");
  }
  // Low-confidence rules that come from SmartPR's pre-existing KB (not a fetched primary source) are flagged.
  const legacy = graph.sources.get("SRC_SMARTPR_KB_EXISTING_RULES")!;
  assert.equal(legacy.status, "needs_expert_validation");
  assert.equal(legacy.confidence, "low");
});

test("graph exposes the required relationship kinds", () => {
  const kinds = new Set(graph.edges.map((e) => e.kind));
  for (const k of ["may_require", "administered_by", "requires", "satisfied_by", "derived_from", "prerequisite_for", "may_qualify_for", "has_eligibility_requirement", "aliases_document"]) {
    assert.ok(kinds.has(k as never), k);
  }
  assert.ok(graph.edges.some((e) => e.from === "PR_ENERGY_MICROGRID_REGISTRATION" && e.kind === "administered_by" && e.to === "nepr"));
  assert.ok(graph.edges.some((e) => e.from === "INC_ACT60_GREEN_ENERGY" && e.kind === "administered_by" && e.to === "ddec"));
});

test("condition evaluator is three-valued; lenient ops never hold a decision open", () => {
  assert.equal(evaluateCondition({ fact: "x", op: "eq", value: true }, {}).value, null);
  assert.deepEqual(evaluateCondition({ fact: "x", op: "eq", value: true }, {}).unknownFacts, ["x"]);
  assert.equal(evaluateCondition({ fact: "x", op: "stated" }, {}).value, false);
  assert.equal(evaluateCondition({ any: [{ fact: "x", op: "eq", value: 1 }, { fact: "y", op: "eq", value: 1 }] }, { y: 1 }).value, true);
  assert.equal(evaluateCondition({ all: [{ fact: "x", op: "eq", value: 1 }, { fact: "y", op: "eq", value: 1 }] }, { y: 2 }).value, false);
  assert.equal(evaluateCondition({ not: { fact: "x", op: "gte", value: 3 } }, { x: 1 }).value, true);
});

// ---------------------------------------------------------- scenarios ----

test("A: commercial building adding rooftop solar — asks about grid connection, no microgrid/ESC assumed", () => {
  const a = run({ generation_technology: "solar", customer_class: "commercial", mounting_type: "roof", energy_project_status: "proposed" });
  assert.equal(state(a, "PR_ENERGY_DG_INTERCONNECTION"), "NEEDS_FACT");
  assert.equal(state(a, "PR_ENERGY_NET_METERING"), "NEEDS_FACT");
  assert.equal(state(a, "PR_ENERGY_CONSTRUCTION_APPROVAL"), "POTENTIALLY_REQUIRED");
  assert.equal(proc(a, "PR_ENERGY_MICROGRID_REGISTRATION"), undefined, "a rooftop system is not assumed to be a microgrid");
  assert.equal(proc(a, "PR_ENERGY_ESC_CERTIFICATION"), undefined, "no energy-company certification assumed");
  assert.deepEqual(required(a), []);
  assert.equal(asked(a)[0], "parallel_operation");
});

test("B: commercial solar + battery with LUMA interconnection — required processes, evidence gaps, kW-based insurance", () => {
  const facts: FactMap = { generation_technology: "solar", battery_storage: true, customer_class: "commercial", generation_capacity_kw: 150, parallel_operation: true, net_metering_requested: true, mounting_type: "roof", municipality: "Bayamón" };
  const a = run(facts, ["DOC_EVID_LUMA_DG_APPLICATION", "DOC_OPPE_INSTALLER_REG"]);
  assert.equal(state(a, "PR_ENERGY_DG_INTERCONNECTION"), "REQUIRED");
  assert.equal(state(a, "PR_ENERGY_NET_METERING"), "REQUIRED");
  assert.equal(state(a, "PR_ENERGY_BESS_FIRE_REVIEW"), "POTENTIALLY_REQUIRED");
  const dg = proc(a, "PR_ENERGY_DG_INTERCONNECTION")!;
  const reqIds = dg.requirements.map((r) => r.id);
  assert.ok(reqIds.includes("REQ_DG_INSURANCE_WAIVER"), "<300 kW → insurance waiver");
  assert.ok(!reqIds.includes("REQ_DG_LIABILITY_INSURANCE"));
  assert.equal(dg.requirements.find((r) => r.id === "REQ_DG_PORTAL_APPLICATION")!.state, "SATISFIED");
  assert.equal(dg.requirements.find((r) => r.id === "REQ_INSTALLER_CERTIFICATION")!.state, "SATISFIED");
  assert.equal(dg.requirements.find((r) => r.id === "REQ_DG_CERTIFIED_DIAGRAM")!.state, "MISSING");
  assert.ok(dg.readiness && dg.readiness.satisfied === 2 && dg.readiness.total === reqIds.length);
  assert.ok(a.gaps.some((g) => g.kind === "missing_evidence" && g.requirement_id === "REQ_DG_CERTIFIED_DIAGRAM"));
  // Net metering depends on interconnection.
  assert.ok(proc(a, "PR_ENERGY_NET_METERING")!.prerequisites.some((p) => p.process_id === "PR_ENERGY_DG_INTERCONNECTION" && p.blocking));
  assert.equal(dg.citation!.url, graph.sources.get("SRC_LUMA_NM_AGREEMENT_25KW")!.url);
  assert.ok(dg.agencies.some((x) => x.id === "luma"));
  // 400 kW flips to liability insurance.
  const big = run({ ...facts, generation_capacity_kw: 400 });
  const bigIds = proc(big, "PR_ENERGY_DG_INTERCONNECTION")!.requirements.map((r) => r.id);
  assert.ok(bigIds.includes("REQ_DG_LIABILITY_INSURANCE") && !bigIds.includes("REQ_DG_INSURANCE_WAIVER"));
  // Residential >25 kW falls outside net metering (Ley 114 Art. 2(a)).
  const res = run({ ...facts, customer_class: "residential", generation_capacity_kw: 30 });
  assert.equal(state(res, "PR_ENERGY_NET_METERING"), "NOT_REQUIRED");
  assert.equal(proc(res, "PR_ENERGY_NET_METERING")!.decided_by.id, "NM_X1");
});

test("C: proposed microgrid serving multiple facilities — registration, compliance, ESC certification, prerequisites", () => {
  const a = run({ generation_technology: "solar", battery_storage: true, microgrid_configuration: true, properties_served: 5, customers_served: 5, sells_energy_to_third_parties: true, generation_capacity_kw: 2000, parallel_operation: true, municipality: "Caguas", energy_project_status: "proposed" });
  for (const id of ["PR_ENERGY_MICROGRID_REGISTRATION", "PR_ENERGY_MICROGRID_COMPLIANCE", "PR_ENERGY_ESC_CERTIFICATION", "PR_ENERGY_DG_INTERCONNECTION"]) {
    assert.equal(state(a, id), "REQUIRED", id);
  }
  const reg = proc(a, "PR_ENERGY_MICROGRID_REGISTRATION")!;
  assert.ok(reg.agencies.some((x) => x.id === "nepr"));
  assert.ok(reg.prerequisites.some((p) => p.process_id === "PR_ENERGY_ESC_CERTIFICATION"), "ESC owner must also meet Reg 8701");
  assert.ok(proc(a, "PR_ENERGY_MICROGRID_COMPLIANCE")!.prerequisites.some((p) => p.process_id === "PR_ENERGY_MICROGRID_REGISTRATION"));
  assert.ok(proc(a, "PR_ENERGY_MICROGRID_COMPLIANCE")!.requirements.some((r) => r.id === "REQ_MG_ANNUAL_REPORT"));
  assert.equal(proc(a, "PR_ENERGY_ESC_CERTIFICATION")!.decided_by.id, "ESC_R1");
  assert.ok(proc(a, "PR_ENERGY_ESC_CERTIFICATION")!.requirements.some((r) => r.id === "REQ_ESC_FINANCIAL_CAPACITY"));
  const construction = proc(a, "PR_ENERGY_CONSTRUCTION_APPROVAL")!;
  assert.equal(construction.state, "REQUIRED", "> 1 MW → existing SmartPR OGPe rule");
  assert.equal(construction.citation!.confidence, "low");
  assert.ok(construction.explanation.some((s) => s.kind === "jurisdiction" && s.label.includes("Caguas")));
  assert.equal(inc(a, "INC_ACT60_GREEN_ENERGY")!.state, "POTENTIALLY_ELIGIBLE");
  // Individual self-supply microgrid (≤2 customers, no sales) is outside Reg 9028.
  const self = run({ microgrid_configuration: true, customers_served: 1, sells_energy_to_third_parties: false, parallel_operation: true });
  assert.equal(state(self, "PR_ENERGY_MICROGRID_REGISTRATION"), "NOT_REQUIRED");
  assert.equal(state(self, "PR_ENERGY_MICROGRID_COMPLIANCE"), "NOT_REQUIRED");
  assert.equal(state(self, "PR_ENERGY_ESC_CERTIFICATION"), "NOT_REQUIRED");
});

test("D: company proposing energy services in Puerto Rico — ESC certification from Reg 8701 triggers", () => {
  const a = run({ energy_applicant_role: "energy_service_provider", proposed_energy_services: ["billing", "resale"], energy_project_status: "proposed" });
  const esc = proc(a, "PR_ENERGY_ESC_CERTIFICATION")!;
  assert.equal(esc.state, "REQUIRED");
  assert.equal(esc.decided_by.id, "ESC_R3");
  assert.ok(esc.requirements.some((r) => r.id === "REQ_ESC_CERT_REQUEST" && r.state === "MISSING"));
  assert.equal(esc.citation!.source_id, "SRC_PREB_REG_8701");
  // Seller below 1 MW with no billing/resale/wheeling: not an ESC under § 1.08(A)(5)(c).
  const small = run({ sells_energy_to_third_parties: true, generation_capacity_kw: 500, proposed_energy_services: ["generation_sale"] });
  assert.equal(state(small, "PR_ENERGY_ESC_CERTIFICATION"), "NOT_REQUIRED");
  // Seller with unknown capacity → ask the capacity, don't conclude.
  const unk = run({ sells_energy_to_third_parties: true, proposed_energy_services: ["generation_sale"] });
  assert.equal(state(unk, "PR_ENERGY_ESC_CERTIFICATION"), "NEEDS_FACT");
  assert.ok(asked(unk).includes("generation_capacity_kw"));
  // Installers need PPPE certification.
  const inst = run({ energy_applicant_role: "installer" });
  assert.equal(state(inst, "PR_ENERGY_INSTALLER_CERTIFICATION"), "REQUIRED");
});

test("E: 'I want renewable energy incentives' — incentives only, never requirements", () => {
  const a = run({ energy_incentive_interest: true });
  assert.deepEqual(required(a), []);
  assert.equal(a.processes.length, 0);
  assert.equal(inc(a, "INC_ACT60_GREEN_ENERGY")!.state, "NEEDS_FACT");
  assert.equal(inc(a, "INC_ACT60_GREEN_ENERGY_DEDUCTION")!.state, "NEEDS_FACT");
  assert.ok(asked(a).includes("sells_energy_to_third_parties"));
  assert.ok(a.gaps.every((g) => !g.process_id.startsWith("INC_")), "incentives never become gaps");
  const seller = run({ energy_incentive_interest: true, sells_energy_to_third_parties: true, generation_technology: "solar", energy_project_status: "proposed" });
  assert.equal(inc(seller, "INC_ACT60_GREEN_ENERGY")!.state, "POTENTIALLY_ELIGIBLE");
  assert.equal(inc(seller, "INC_ACT60_GREEN_ENERGY_DEDUCTION")!.state, "POTENTIALLY_ELIGIBLE");
  const selfUse = run({ energy_incentive_interest: true, sells_energy_to_third_parties: false, energy_applicant_role: "end_use_customer" });
  assert.equal(inc(selfUse, "INC_ACT60_GREEN_ENERGY")!.state, "NOT_ELIGIBLE");
});

test("F: existing business expansion — legacy permit requirements and energy processes coexist", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const load = (f: string) => JSON.parse(readFileSync(join(here, "..", "..", "kb", f), "utf8"));
  const KB: KnowledgeBase = { municipalities: load("municipalities.json"), businessTypes: load("business_types.json"), questions: load("questions.json"), documents: load("documents.json"), rules: load("rules.json") };
  const legacy = runRulesEngine(KB, { municipalityName: "Ponce", businessTypeName: "Restaurant", answers: { Q_PHYSICAL_LOCATION: true, Q_RENEWABLE_INSTALL: true } });
  const docs = legacy.debug.documentsGenerated;
  assert.ok(docs.includes("DOC_HEALTH_PERMIT"), "non-energy permits still produced");
  assert.ok(docs.includes("DOC_LUMA_INTERCONNECTION"), "legacy energy rule still fires");
  const a = run({ generation_technology: "solar", parallel_operation: true, customer_class: "commercial", energy_project_status: "proposed", municipality: "Ponce" });
  const links = linkLegacyDocuments(graph, docs, a);
  const luma = links.find((l) => l.document_id === "DOC_LUMA_INTERCONNECTION");
  assert.ok(luma, "legacy card aliases the general process");
  assert.equal(luma!.process_id, "PR_ENERGY_DG_INTERCONNECTION");
  assert.equal(luma!.state, "REQUIRED");
  assert.ok(!links.some((l) => l.document_id === "DOC_HEALTH_PERMIT"), "non-energy docs are untouched");
});

test("G: 'thinking about a microgrid at our facility' — targeted questions, no premature conclusions", () => {
  const a = run({ microgrid_configuration: true });
  assert.deepEqual(required(a), [], "nothing REQUIRED yet");
  assert.equal(state(a, "PR_ENERGY_MICROGRID_REGISTRATION"), "NEEDS_FACT");
  assert.equal(state(a, "PR_ENERGY_MICROGRID_COMPLIANCE"), "NEEDS_FACT");
  assert.equal(state(a, "PR_ENERGY_ESC_CERTIFICATION"), "NEEDS_FACT");
  const q = asked(a);
  assert.ok(q.length > 0 && q.length <= 3, "small targeted set, not a questionnaire");
  assert.ok(q.includes("sells_energy_to_third_parties"));
  assert.ok(q.includes("customers_served") || q.includes("parallel_operation"));
  const sells = a.questions.find((x) => x.fact === "sells_energy_to_third_parties")!;
  assert.ok(sells.resolves.length >= 2, "asks the fact that resolves the most decisions");
  assert.ok(sells.question.length > 0 && sells.why.length > 0);
});

// ------------------------------------------------ NL end-to-end (fixture) ----

test("E2E: natural-language intake → validated facts → graph → processes → evidence gaps → source-backed explanation", () => {
  const description = "We are planning a solar-plus-storage microgrid in Caguas serving five separate businesses in our industrial park. We will sell them the power. It is 2 MW and will be connected to the LUMA grid.";
  // Fixture of the xAI interpreter's projectContext output (the live route
  // sends the same shape through the same validator).
  const modelProjectContext = {
    generation_technology: { value: "solar", confidence: 0.95, evidence: "solar-plus-storage microgrid" },
    battery_storage: { value: true, confidence: 0.9, evidence: "solar-plus-storage" },
    microgrid_configuration: { value: true, confidence: 0.95, evidence: "microgrid in Caguas" },
    customers_served: { value: "5", confidence: 0.9, evidence: "serving five separate businesses" },
    properties_served: { value: 5, confidence: 0.85, evidence: "serving five separate businesses" },
    sells_energy_to_third_parties: { value: true, confidence: 0.95, evidence: "We will sell them the power" },
    generation_capacity_kw: { value: "2 MW", confidence: 0.9, evidence: "It is 2 MW" },
    parallel_operation: { value: true, confidence: 0.9, evidence: "connected to the LUMA grid" },
    energy_project_status: { value: "proposed", confidence: 0.9, evidence: "We are planning" },
    municipality: { value: "Caguas", confidence: 0.95, evidence: "Caguas" },
    // Ungrounded claim — must be dropped by the validator.
    sells_to_utility_under_ppa: { value: true, confidence: 0.9, evidence: "PPA with PREPA" },
  };
  const { context, discarded } = validateProjectContext(modelProjectContext, description);
  assert.ok(discarded.some((d) => d.field === "projectContext.sells_to_utility_under_ppa"));
  assert.equal(context.generation_capacity_kw?.value, 2000, "MW converted to kW");
  const { facts, evidence } = energyFactsFromProjectContext(context, graph.kb);
  const a = evaluateProcesses(graph, facts, { factEvidence: evidence, providedEvidenceIds: ["DOC_EVID_MICROGRID_REGISTRATION_FORM"] });
  const reg = proc(a, "PR_ENERGY_MICROGRID_REGISTRATION")!;
  assert.equal(reg.state, "REQUIRED");
  assert.equal(reg.requirements.find((r) => r.id === "REQ_MG_REGISTRATION_FORM")!.state, "SATISFIED");
  assert.ok(a.gaps.some((g) => g.requirement_id === "REQ_MG_ENGINEER_CERT"));
  const text = explainProcess(reg);
  assert.match(text, /fact: Customers served: 5 \("serving five separate businesses"\)/);
  assert.match(text, /classification: Microgrid/);
  assert.match(text, /source: Regulation 9028/);
  assert.ok(text.includes(graph.sources.get("SRC_PREB_REG_9028")!.url));
  assert.match(text, /agency: Negociado de Energía/);
  assert.equal(state(a, "PR_ENERGY_ESC_CERTIFICATION"), "REQUIRED");
  assert.equal(proc(a, "PR_ENERGY_ESC_CERTIFICATION")!.decided_by.id, "ESC_R1", "PPA claim was dropped; sale ≥1 MW decides");
});
