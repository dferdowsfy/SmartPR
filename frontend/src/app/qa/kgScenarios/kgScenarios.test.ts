// Knowledge-graph scenario matrix (frontend/src/app/qa/kgScenarios/README.md).
// One top-level test per scenario so the regulatory-correctness CI gate
// (scripts/ci/regulatory-baseline.mjs) tracks each one by name. Scenarios that
// fail on main are listed in ci/regulatory-known-failures.json: they still
// run and still fail; the gate reports a regression if any other scenario
// starts failing, and an improvement when a listed one starts passing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CODE_LEAK_RE, kgTestName, loadGeoContexts, loadKgScenarios, lintScenario, runAndEvaluate, type KgScenario } from "./harness.ts";

const geo = loadGeoContexts();
const scenarios = loadKgScenarios();

test("kg-scenarios: fixtures are well-formed and every expectation is signed", () => {
  assert.ok(scenarios.length >= 40, `expected >= 40 scenarios, found ${scenarios.length}`);
  const ids = scenarios.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, "scenario ids are unique");
  const problems = scenarios.flatMap((s) => lintScenario(s, geo));
  assert.deepEqual(problems, []);
});

test("kg-scenarios: the evaluator reports missing, unexpected and ordering findings (harness self-check)", () => {
  const base = scenarios.find((s) => s.id === "KG01")!;
  const probe: KgScenario = JSON.parse(JSON.stringify(base));
  probe.expect = {
    mustInclude: [{ key: "DOC_FIREARMS_LICENSE", confidence: "verified-in-code", rationale: "self-check" }],
    mustNotInclude: [{ key: "DOC_EIN", confidence: "verified-in-code", rationale: "self-check" }],
    ordering: [{ before: "DOC_PATENTE_MUNICIPAL", after: "DOC_PERMISO_UNICO", confidence: "verified-in-code", rationale: "self-check" }],
  };
  const kinds = runAndEvaluate(probe, geo).findings.map((f) => `${f.kind}:${f.key}`);
  assert.ok(kinds.includes("missing:DOC_FIREARMS_LICENSE"), kinds.join(","));
  assert.ok(kinds.includes("unexpected:DOC_EIN"), kinds.join(","));
  assert.ok(kinds.includes("ordering:DOC_PATENTE_MUNICIPAL<DOC_PERMISO_UNICO"), kinds.join(","));
  assert.ok(CODE_LEAK_RE.test("See DOC_PERMISO_UNICO") && CODE_LEAK_RE.test("RULE_0706") && !CODE_LEAK_RE.test("Permiso Único (OGPe)"));
});

for (const s of scenarios) {
  test(kgTestName(s), () => {
    const r = runAndEvaluate(s, geo);
    const detail = r.findings.map((f) => `  [${f.kind}${f.confidence ? `, ${f.confidence}` : ""}] ${f.message}`).join("\n");
    assert.equal(r.status, "pass", `${s.id} ${s.title}\n${detail}`);
  });
}
