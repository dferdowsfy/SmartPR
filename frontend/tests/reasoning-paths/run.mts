// ============================================================================
// Knowledge Graph Reasoning Paths — golden-suite runner.
// Usage: tsx tests/reasoning-paths/run.mts   (npm run test:reasoning-paths)
//
// 1. Runs validateReasoningGraph() on the seeded graph; any error-severity
//    finding fails the suite before scenario tests run.
// 2. Reads every fixture in tests/reasoning-paths/golden/*.json and compares,
//    as order-insensitive sets: expected vs actual scenario ids, variant ids,
//    and permit rule ids. expectedNonApplicable must have EMPTY intersection
//    with the actual permits.
// 3. Prints per-fixture PASS/FAIL with explicit diffs. Exits nonzero if any
//    fixture fails, or if the golden dir is missing/empty.
//
// Discipline (design §8): expectations are authored BEFORE running. Never edit
// a fixture to match the engine; fix the seed/evaluator, then re-run.
// ============================================================================

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluateReasoningPaths,
  loadReasoningGraph,
  validateReasoningGraph,
} from "../../src/lib/reasoning-paths/index";

interface GoldenFixture {
  id: string;
  name: string;
  inputFacts: Record<string, unknown>;
  expectedScenarios: string[];
  expectedVariants: string[];
  expectedPermits: string[];
  expectedNonApplicable: string[];
}

const here = path.dirname(fileURLToPath(import.meta.url));
const goldenDir = path.join(here, "golden");

function setDiff(expected: string[], actual: string[]): { missing: string[]; extra: string[] } {
  const exp = new Set(expected);
  const act = new Set(actual);
  return {
    missing: [...exp].filter((x) => !act.has(x)).sort(),
    extra: [...act].filter((x) => !exp.has(x)).sort(),
  };
}

let failures = 0;

// ---------------------------------------------------------------------------
// 1. Graph validation first.
// ---------------------------------------------------------------------------
const graph = loadReasoningGraph();
const findings = validateReasoningGraph(graph);
for (const f of findings) {
  console.log(
    `[${f.severity.toUpperCase()}] ${f.code}${f.entityId ? ` (${f.entityId})` : ""}: ${f.message}`
  );
}
const errorCount = findings.filter((f) => f.severity === "error").length;
if (errorCount > 0) {
  console.error(`\nVALIDATION FAILED: ${errorCount} error-severity finding(s). Fix the graph, then re-run.`);
  process.exit(1);
}
console.log(`Validation: ${findings.length} finding(s), 0 errors.\n`);

// ---------------------------------------------------------------------------
// 2. Golden fixtures.
// ---------------------------------------------------------------------------
let files: string[];
try {
  files = readdirSync(goldenDir)
    .filter((f) => f.endsWith(".json"))
    .sort();
} catch {
  console.error(`Golden dir missing: ${goldenDir}`);
  process.exit(1);
}
if (files.length === 0) {
  console.error("No golden fixtures found — refusing to pass an empty suite.");
  process.exit(1);
}

for (const file of files) {
  const raw = readFileSync(path.join(goldenDir, file), "utf8");
  let fx: GoldenFixture;
  try {
    fx = JSON.parse(raw) as GoldenFixture;
  } catch (err) {
    failures++;
    console.log(`FAIL ${file} — fixture is not valid JSON: ${(err as Error).message}`);
    continue;
  }

  const result = evaluateReasoningPaths(fx.inputFacts ?? {});
  const actualScenarios = result.scenarios.map((s) => s.id);
  const actualVariants = [...new Set(result.paths.map((p) => p.variantId))].sort();
  const actualPermits = result.permits.map((p) => p.ruleId);

  const ds = setDiff(fx.expectedScenarios ?? [], actualScenarios);
  const dv = setDiff(fx.expectedVariants ?? [], actualVariants);
  const dp = setDiff(fx.expectedPermits ?? [], actualPermits);
  const forbidden = (fx.expectedNonApplicable ?? [])
    .filter((id) => actualPermits.includes(id))
    .sort();

  const ok =
    ds.missing.length === 0 &&
    ds.extra.length === 0 &&
    dv.missing.length === 0 &&
    dv.extra.length === 0 &&
    dp.missing.length === 0 &&
    dp.extra.length === 0 &&
    forbidden.length === 0;

  if (ok) {
    console.log(`PASS ${fx.id} — ${fx.name}`);
  } else {
    failures++;
    console.log(`FAIL ${fx.id} — ${fx.name}`);
    if (ds.missing.length > 0 || ds.extra.length > 0)
      console.log(`  scenarios: missing [${ds.missing.join(", ")}] extra [${ds.extra.join(", ")}]`);
    if (dv.missing.length > 0 || dv.extra.length > 0)
      console.log(`  variants:  missing [${dv.missing.join(", ")}] extra [${dv.extra.join(", ")}]`);
    if (dp.missing.length > 0 || dp.extra.length > 0)
      console.log(`  permits:   missing [${dp.missing.join(", ")}] extra [${dp.extra.join(", ")}]`);
    if (forbidden.length > 0)
      console.log(`  NON-APPLICABLE VIOLATION: [${forbidden.join(", ")}] appeared in permits`);
  }
}

console.log(`\n${files.length - failures}/${files.length} fixtures passed.`);
process.exit(failures > 0 ? 1 : 0);
