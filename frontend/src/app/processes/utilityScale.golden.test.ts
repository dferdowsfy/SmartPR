// Utility-scale / wholesale generation + storage goldens (Rosa's use case) and
// routing guards between customer-side DG and wholesale plants. Fixture model
// extractions run through the same validator → fact map → process graph the
// intake UI uses. Run: npx tsx --test src/app/processes/utilityScale.golden.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { validateProjectContext, projectContextChips } from "../ai/intake/projectContext.ts";
import { computeEnergyAssessment } from "./view.ts";
import { evaluateProcesses, type ProcessAssessment } from "./engine.ts";
import { loadEnergyProcessGraph } from "./kb.ts";
import { buildProcessGraph, mergeProcessKBs } from "./graph.ts";
import { processSequence } from "./sequence.ts";
import { kbExtractionPromptLines } from "./extraction.ts";
import type { FactMap, ProcessKB } from "./types.ts";

const here = dirname(fileURLToPath(import.meta.url));
const load = (f: string) => JSON.parse(readFileSync(join(here, "goldens", f), "utf8"));
const graph = loadEnergyProcessGraph();

function run(file: string) {
  const G = load(file);
  const { context, discarded } = validateProjectContext(G.modelProjectContext, G.description);
  const { assessment } = computeEnergyAssessment({ projectContext: context, municipality: G.profile.municipality });
  return { G, context, discarded, a: assessment! };
}
const st = (a: ProcessAssessment, id: string) => a.processes.find((p) => p.process_id === id)?.state;
const proc = (a: ProcessAssessment, id: string) => a.processes.find((p) => p.process_id === id);
const ids = (a: ProcessAssessment) => a.processes.map((p) => p.process_id);
const DG = ["PR_ENERGY_DG_INTERCONNECTION", "PR_ENERGY_NET_METERING"];
const isUtility = (id: string) => id.startsWith("PR_UTILITY_");

// ------------------------------------------------------------------ E02 ----
test("E02 Salinas 20 MW solar + 40 MWh BESS selling to LUMA → utility-scale path, never DG/net metering", () => {
  const { a, context, discarded } = run("E02_utility_hybrid_solar_bess_salinas.json");
  assert.equal(context.generation_capacity_kw?.value, 20000, "20 MW → kW");
  assert.equal((context as Record<string, { value: unknown }>).storage_energy_mwh?.value, 40);
  assert.ok(discarded.some((d) => d.field === "projectContext.site_zoning"), "an ungrounded zoning claim is dropped");
  assert.equal(a.facts.energy_market_segment, "wholesale");
  assert.deepEqual(a.project_types.filter((p) => p.id.startsWith("PT_UTILITY")).map((p) => [p.id, p.status]), [["PT_UTILITY_HYBRID_SOLAR_BESS", "has_type"]]);
  for (const id of DG) assert.ok(!ids(a).includes(id), `${id} must not be a candidate`);
  for (const id of [
    "PR_UTILITY_INTERCONNECTION_STUDIES", "PR_UTILITY_MTR_COMPLIANCE", "PR_UTILITY_PPOA_APPROVAL", "PR_ENERGY_ESC_CERTIFICATION",
    "PR_LAND_USE_CONSULTA_UBICACION", "PR_ENV_COMPLIANCE_DETERMINATION", "PR_UTILITY_INTERCONNECTION_AGREEMENT", "PR_UTILITY_CONSTRUCTION_PERMIT", "PR_UTILITY_COMMISSIONING_COD",
  ]) assert.equal(st(a, id), "REQUIRED", id);
  assert.equal(proc(a, "PR_ENERGY_ESC_CERTIFICATION")!.decided_by.id, "ESC_R5");
  assert.equal(proc(a, "PR_UTILITY_PPOA_APPROVAL")!.citation!.locator, "Art. 6.32(a) (22 LPRA § 1054ff)");
  assert.equal(st(a, "PR_UTILITY_PROCUREMENT_RFP"), "NEEDS_FACT");
  // MTR requirements follow the technology: PV (with its storage obligation) + BESS, not wind.
  const mtr = proc(a, "PR_UTILITY_MTR_COMPLIANCE")!.requirements.map((r) => r.id);
  assert.ok(mtr.includes("REQ_MTR_PV") && mtr.includes("REQ_MTR_PV_STORAGE") && mtr.includes("REQ_MTR_BESS") && !mtr.includes("REQ_MTR_WTG"));
  // Only the controlling unknowns, ranked: tranche, grid connection point/voltage, land classification.
  assert.deepEqual(a.questions.map((q) => q.fact), ["procurement_tranche", "interconnection_voltage", "site_zoning"]);
  assert.match(a.questions[1].question, /38 kV sub-transmission or 115 kV transmission/);
  // Sequential order: site → offtake → certification → studies → agreements → construction → COD.
  const seq = processSequence(a)!;
  assert.deepEqual(seq.map((s) => s.stage_id), ["site", "offtake", "certification", "studies", "agreements", "construction", "commissioning"]);
  assert.deepEqual(seq.map((s) => s.step), [1, 2, 3, 4, 5, 6, 7]);
  const cod = seq.find((s) => s.stage_id === "commissioning")!.processes[0];
  assert.ok(cod.waits_on.some((w) => /Interconnection agreement/.test(w.name)) && cod.waits_on.some((w) => /Construction permit/.test(w.name)));
  // Chips are KB-driven.
  const chips = projectContextChips(context).map((c) => c.label);
  for (const c of ["20 MW", "40 MWh storage", "Sells to PREPA/LUMA"]) assert.ok(chips.includes(c), c);
});

test("E02 follow-ups: industrial zoning removes the public-hearing step; tranche = yes makes procurement REQUIRED", () => {
  const { a } = run("E02_utility_hybrid_solar_bess_salinas.json");
  const b = evaluateProcesses(graph, { ...a.facts, site_zoning: "industrial", procurement_tranche: true, interconnection_voltage: "transmission" });
  assert.ok(!proc(b, "PR_LAND_USE_CONSULTA_UBICACION")!.requirements.some((r) => r.id === "REQ_LU_PUBLIC_HEARING"));
  assert.equal(st(b, "PR_UTILITY_PROCUREMENT_RFP"), "REQUIRED");
  assert.ok(proc(b, "PR_UTILITY_INTERCONNECTION_STUDIES")!.requirements.some((r) => r.id === "REQ_STUDY_TRANSMISSION_IMPACT" && r.state === "AGENCY_STEP"));
  assert.equal(b.questions.length, 0);
  const c = evaluateProcesses(graph, { ...a.facts, procurement_tranche: false });
  const rfp = proc(c, "PR_UTILITY_PROCUREMENT_RFP")!;
  assert.equal(rfp.state, "POTENTIALLY_REQUIRED");
  assert.equal(rfp.citation!.status, "needs_expert_validation");
});

// ------------------------------------------------------------------ E03 ----
test("E03 standalone 50 MW / 200 MWh BESS → storage path (ESSA, BESS MTRs, ESC), land use flagged for expert validation", () => {
  const { a } = run("E03_standalone_bess_guayama.json");
  assert.equal(a.facts.storage_capacity_kw, 50000);
  assert.equal(a.facts.energy_market_segment, "wholesale");
  assert.ok(a.project_types.some((p) => p.id === "PT_UTILITY_STANDALONE_BESS" && p.status === "has_type"));
  for (const id of DG) assert.ok(!ids(a).includes(id));
  assert.equal(st(a, "PR_ENERGY_ESC_CERTIFICATION"), "REQUIRED");
  const ppoa = proc(a, "PR_UTILITY_PPOA_APPROVAL")!;
  assert.ok(ppoa.requirements.some((r) => r.id === "REQ_ESSA_EXECUTED") && !ppoa.requirements.some((r) => r.id === "REQ_PPOA_EXECUTED"));
  const mtr = proc(a, "PR_UTILITY_MTR_COMPLIANCE")!.requirements.map((r) => r.id);
  assert.ok(mtr.includes("REQ_MTR_BESS") && !mtr.includes("REQ_MTR_PV"));
  assert.ok(proc(a, "PR_UTILITY_INTERCONNECTION_STUDIES")!.requirements.some((r) => r.id === "REQ_STUDY_TRANSMISSION_IMPACT"));
  const lu = proc(a, "PR_LAND_USE_CONSULTA_UBICACION")!;
  assert.equal(lu.state, "POTENTIALLY_REQUIRED");
  assert.equal(lu.citation!.status, "needs_expert_validation");
  assert.ok(ids(a).includes("PR_ENERGY_BESS_FIRE_REVIEW"));
  assert.ok(a.questions.length <= 3 && a.questions[0].fact === "procurement_tranche");
});

// ------------------------------------------------------------------ E04 ----
test("E04 industrial behind-the-meter 3 MW solar + BESS stays DG (no PPOA/ESC/utility studies) but gets land use for ground PV > 1 MW", () => {
  const { a } = run("E04_industrial_btm_hybrid_barceloneta.json");
  assert.equal(a.facts.energy_market_segment, "customer_side");
  assert.ok(a.project_types.some((p) => p.id === "PT_ONSITE_GENERATION" && p.status === "has_type"));
  assert.ok(!a.project_types.some((p) => p.id.startsWith("PT_UTILITY")));
  assert.equal(st(a, "PR_ENERGY_DG_INTERCONNECTION"), "REQUIRED");
  assert.equal(st(a, "PR_ENERGY_NET_METERING"), "POTENTIALLY_REQUIRED");
  assert.equal(proc(a, "PR_ENERGY_NET_METERING")!.voluntary, true);
  assert.ok(!ids(a).some(isUtility), "no utility-scale processes");
  assert.ok(!ids(a).includes("PR_ENERGY_ESC_CERTIFICATION"));
  assert.equal(st(a, "PR_LAND_USE_CONSULTA_UBICACION"), "REQUIRED");
  assert.equal(proc(a, "PR_LAND_USE_CONSULTA_UBICACION")!.decided_by.id, "LU_R1");
  assert.equal(st(a, "PR_ENV_COMPLIANCE_DETERMINATION"), "REQUIRED");
});

// ------------------------------------------------------------------ E05 ----
test("E05 'we want to build a solar farm' → asks who buys the power and the size; concludes nothing", () => {
  const { a } = run("E05_insufficient_solar_farm.json");
  assert.equal(a.facts.energy_market_segment, undefined);
  assert.deepEqual(a.processes.filter((p) => p.state === "REQUIRED").map((p) => p.process_id), []);
  for (const id of DG) assert.ok(!ids(a).includes(id), "a solar farm is not routed to DG while the buyer is unknown");
  assert.ok(a.project_types.some((p) => p.id === "PT_UTILITY_SOLAR" && p.status === "possible"));
  assert.ok(a.questions.length <= 3);
  assert.equal(a.questions[0].fact, "power_offtaker");
  assert.ok(a.questions.some((q) => q.fact === "generation_capacity_kw"));
  assert.ok(processSequence(a) === null, "no sequence until something applies");
});

// ----------------------------------------------------------- guards ----
test("routing guards: a 400 kW rooftop is never utility-scale; a 20 MW farm selling to LUMA is never net metering", () => {
  const rooftop: FactMap = { generation_technology: "solar", battery_storage: true, generation_capacity_kw: 400, mounting_type: "roof", parallel_operation: true, customer_class: "commercial" };
  // Includes a misextraction ("sell excess to LUMA" read as a utility sale) and no mounting stated.
  for (const extra of [{}, { power_offtaker: "luma_prepa" }, { sells_to_utility_under_ppa: true }, { mounting_type: undefined }]) {
    const a = evaluateProcesses(graph, { ...rooftop, ...extra } as FactMap);
    assert.equal(a.facts.energy_market_segment, "customer_side", JSON.stringify(extra));
    assert.equal(st(a, "PR_ENERGY_DG_INTERCONNECTION"), "REQUIRED", JSON.stringify(extra));
    assert.ok(!ids(a).some(isUtility), `rooftop routed to utility-scale: ${JSON.stringify(extra)}`);
  }
  const farm: FactMap = { generation_technology: "solar", battery_storage: true, generation_capacity_kw: 20000, power_offtaker: "luma_prepa", parallel_operation: true };
  for (const extra of [{}, { net_metering_requested: true }, { customer_class: "commercial" }, { mounting_type: "ground" }, { energy_market_segment: "customer_side" }]) {
    const a = evaluateProcesses(graph, { ...farm, ...extra } as FactMap);
    assert.ok(!ids(a).includes("PR_ENERGY_NET_METERING") || st(a, "PR_ENERGY_NET_METERING") === "NOT_REQUIRED", `net metering for ${JSON.stringify(extra)}`);
    assert.ok(!ids(a).includes("PR_ENERGY_DG_INTERCONNECTION"), `DG for ${JSON.stringify(extra)}`);
    assert.equal(a.facts.energy_market_segment, "wholesale", "derived facts are recomputed, never trusted from input");
  }
  // 20 MW self-supply (customer side): net metering excluded above 5 MW regardless of class.
  const self = evaluateProcesses(graph, { ...farm, power_offtaker: "self" });
  assert.equal(st(self, "PR_ENERGY_NET_METERING"), "NOT_REQUIRED");
  assert.equal(proc(self, "PR_ENERGY_NET_METERING")!.decided_by.id, "NM_X4");
});

test("E01 regression: the warehouse rooftop assessment is unchanged from main", () => {
  const G = load("E01_warehouse_rooftop_solar_caguas.json");
  const expected = load("E01_expected_assessment.json");
  const { context } = validateProjectContext(G.modelProjectContext, G.description);
  const { assessment: a } = computeEnergyAssessment({ projectContext: context, municipality: G.profile.municipality, answers: G.answers });
  const actual = {
    project_types: a!.project_types.map((p) => ({ id: p.id, status: p.status })),
    processes: a!.processes.map((p) => ({ id: p.process_id, state: p.state, reason: p.reason, decided_by: p.decided_by, missing_facts: p.missing_facts, voluntary: p.voluntary,
      requirements: p.requirements.map((r) => ({ id: r.id, state: r.state })), prerequisites: p.prerequisites.map((x) => ({ id: x.process_id, state: x.state, blocking: x.blocking, conditional: x.conditional })), readiness: p.readiness })),
    incentives: a!.incentives.map((i) => ({ id: i.incentive_id, state: i.state, missing: i.missing_facts })),
    questions: a!.questions.map((q) => ({ fact: q.fact, question: q.question, resolves: q.resolves })),
    readiness: a!.readiness,
  };
  assert.deepEqual(actual, expected);
  assert.equal(a!.facts.energy_market_segment, "customer_side");
  assert.equal(processSequence(a), null, "DG view has no sequence panel");
});

// -------------------------------------------------------- generality ----
test("intake: KB facts are accepted and typed by the KB; prompt lines come from KB data (EN/ES)", () => {
  const desc = "Planta de 50 MW, 40,000 kWh de baterías, venta a LUMA, torre de 90 metros";
  const { context, discarded } = validateProjectContext({
    storage_energy_mwh: { value: "40,000 kWh", confidence: 0.9, evidence: "40,000 kWh de baterías" },
    power_offtaker: { value: "the utility", confidence: 0.9, evidence: "venta a LUMA" },
    grid_position: { value: "Front of meter", confidence: 0.9, evidence: "venta a LUMA" },
    structure_height_ft: { value: "90 metros", confidence: 0.9, evidence: "torre de 90 metros" },
    not_a_fact: { value: 1, confidence: 0.9, evidence: "Planta" },
  }, desc);
  const c = context as Record<string, { value: unknown }>;
  assert.equal(c.storage_energy_mwh.value, 40);
  assert.equal(c.structure_height_ft.value, 295);
  assert.equal(c.power_offtaker, undefined);
  assert.equal(c.grid_position.value, "front_of_meter", "enum values are normalized to KB options");
  assert.ok(discarded.some((d) => d.field === "projectContext.power_offtaker" && d.reason === "not an allowed option"));
  assert.ok(discarded.some((d) => d.field === "projectContext.not_a_fact" && d.reason === "unknown key"));
  const en = kbExtractionPromptLines("en");
  const es = kbExtractionPromptLines("es");
  for (const k of ["power_offtaker", "grid_position", "energy_facility_type", "storage_energy_mwh", "site_control", "site_zoning", "environmental_sensitivity", "procurement_tranche"]) {
    assert.ok(en.includes(`"${k}"`) && es.includes(`"${k}"`), k);
  }
  assert.match(es, /medición neta es "self"/);
});

test("generality: new domains are KB packs; the graph rejects undeclared facts and duplicate ids", () => {
  const telecom: ProcessKB = {
    version: "t1", domain: "telecom", jurisdiction: "PR", agencies: [{ id: "nrt", name: "Negociado de Telecomunicaciones" }],
    facts: [{ key: "tower_height_ft", label: "Tower height", type: "number", question: "How tall?", why: "FAA" }],
    evidence_types: [], requirements: [], incentives: [],
    project_types: [{ id: "PT_TOWER", name: "Tower", classifier: { fact: "tower_height_ft", op: "gt", value: 0 }, may_require: ["PR_T"], may_qualify_for: [] }],
    processes: [{ id: "PR_T", name: "Tower notice", process_type: "filing", domain: "telecom", administered_by: ["faa"], source_ids: ["SRC_FAA_14CFR77_9"], requirement_ids: [], prerequisites: [],
      applicability: [{ id: "T_R1", outcome: "REQUIRED", trigger_summary: ">200 ft", trigger: { fact: "tower_height_ft", op: "gt", value: 200 }, source_id: "SRC_FAA_14CFR77_9", locator: "77.9(a)", controlling_language: "more than 200 ft. AGL", confidence: "high", status: "verified" }] }],
  };
  const merged = buildProcessGraph({ kb: mergeProcessKBs([graph.kb, telecom]), sources: [...graph.sources.values()], agencies: [...graph.agencies.values()] });
  const a = evaluateProcesses(merged, { tower_height_ft: 250 });
  assert.equal(st(a, "PR_T"), "REQUIRED");
  assert.throws(() => buildProcessGraph({ kb: mergeProcessKBs([graph.kb, graph.kb]), sources: [...graph.sources.values()], agencies: [...graph.agencies.values()] }), /Duplicate/);
  const bad = { ...telecom, processes: [{ ...telecom.processes[0], gate: { fact: "typo_fact", op: "eq" as const, value: true } }] };
  assert.throws(() => buildProcessGraph({ kb: bad, sources: [...graph.sources.values()], agencies: [...graph.agencies.values()] }), /undeclared fact typo_fact/);
});

test("KB integrity (utility scale): every new rule/requirement cites a 2026-09-30-verified primary source; uncertain ones are flagged", () => {
  const newSources = [...graph.sources.values()].filter((s) => s.date_last_verified === "2026-09-30");
  assert.ok(newSources.length >= 15);
  for (const s of newSources) assert.ok(/^https?:\/\//.test(s.url) && s.citation, s.id);
  const flagged = graph.kb.requirements.filter((r) => r.status === "needs_expert_validation").map((r) => r.id);
  assert.ok(flagged.includes("REQ_NOI_FILING") && flagged.includes("REQ_LU_RUSTIC_LAND"));
  for (const p of graph.kb.processes.filter((x) => x.stage)) assert.ok(graph.kb.stages!.some((s) => s.id === p.stage), p.id);
});
