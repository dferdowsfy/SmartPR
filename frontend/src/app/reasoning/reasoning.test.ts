import { test } from "node:test";
import assert from "node:assert/strict";
import { reason, runMappingTests } from "./scenarioReasoning";
import { checkGraphQuality } from "./graphQuality";
import { factsFromIntake } from "./intakeFacts";
import { bundledReasoningGraph } from "./loadGraph";

const g = bundledReasoningGraph();
const asOf = "2026-10-03";

test("start new business in existing premises, no construction → Permiso Único (new)", () => {
  const r = reason(g, { project_intent: "new_business", existing_premises: true, construction_required: false, home_based: false }, { asOf });
  assert.deepEqual(r.applicableVariants.map((v) => v.id), ["PV_PERMISO_UNICO_NEW"]);
  assert.ok(r.applicablePermits.includes("DOC_PERMISO_UNICO"));
  const p = r.paths.find((x) => x.status === "applies")!;
  assert.match(p.why.join("\n"), /applies because/);
  assert.ok(p.sources.some((s) => s.authority === "discovery_only"));
});

test("start new business + remodel → Permiso Único and PCOC paths together", () => {
  const r = reason(g, { project_intent: "new_business", existing_premises: true, construction_required: true, home_based: false }, { asOf });
  const ids = r.applicableVariants.map((v) => v.id);
  assert.ok(ids.includes("PV_PCOC"));
  assert.ok(ids.includes("PV_PERMISO_UNICO_NEW"));
  assert.ok(r.scenarios.some((s) => s.code === "REMODEL"));
  assert.ok(r.scenarios.some((s) => s.code === "START_NEW_BUSINESS"));
});

test("unknown facts never count as met", () => {
  const r = reason(g, { project_intent: "new_business" }, { asOf });
  assert.equal(r.applicableVariants.length, 0);
  assert.ok(r.paths.some((p) => p.status === "needs_facts" && p.missingFacts.includes("existing_premises")));
});

test("inactive mapping is ignored", () => {
  const g2 = { ...g, mappings: g.mappings.map((m) => (m.id === "MAP_START_NEW_PU" ? { ...m, mapping_status: "inactive" } : m)) };
  const r = reason(g2, { project_intent: "new_business", existing_premises: true, construction_required: false, home_based: false }, { asOf });
  assert.equal(r.applicableVariants.length, 0);
});

test("mapping test cases pass", () => {
  for (const m of g.mappings) for (const r of runMappingTests(g, m.id, { asOf })) assert.ok(r.pass, `${m.id}: ${r.name}`);
});

test("quality flags variants without permits, orphan scenarios, discovery-only citations", () => {
  const q = checkGraphQuality(g, { asOf });
  assert.ok(q.some((i) => i.code === "variant_no_permit" && i.nodeId === "PV_SUBDIVISION"));
  assert.ok(q.some((i) => i.code === "orphan" && i.nodeId === "SCN_OPERATE_EXISTING_BUSINESS"));
  assert.ok(q.some((i) => i.code === "missing_citation"));
  assert.ok(!q.some((i) => i.code === "missing_reference"), JSON.stringify(q.filter((i) => i.code === "missing_reference")));
});

test("quality flags contradictory conditions and duplicates", () => {
  const m = g.mappings[0];
  const g2 = { ...g, mappings: [...g.mappings, { ...m, id: "MAP_DUP" }, { ...m, id: "MAP_BAD", condition_ids: ["COND_CONSTRUCTION_YES", "COND_CONSTRUCTION_NO"] }] };
  const q = checkGraphQuality(g2, { asOf });
  assert.ok(q.some((i) => i.code === "duplicate_mapping" && i.nodeId === "MAP_DUP"));
  assert.ok(q.some((i) => i.code === "conflicting_conditions" && i.nodeId === "MAP_BAD"));
});

test("intake facts: explicit change of use, home-based, unknowns stay unknown", () => {
  const f = factsFromIntake({ projectIntent: "new_business", profile: { location_type: "Home-based", municipality: "Guaynabo" }, answers: {}, scenario: null });
  assert.equal(f.home_based, true);
  assert.equal(f.residential, false);
  assert.equal(f.municipality, "Guaynabo");
  assert.ok(!("existing_premises" in f));
});
