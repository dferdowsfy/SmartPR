// ============================================================================
// Refreshes coverage-baseline.json from the current golden set.
// Run deliberately after adding scenarios or rules that legitimately move
// the coverage number — never to silence a regression.
//   npx tsx src/app/qa/updateCoverageBaseline.ts
// ============================================================================

import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { computeCoverage } from "./goldenHarness";

const QA_DIR = join(dirname(fileURLToPath(import.meta.url)));
const { covered, total } = computeCoverage();
const baseline = {
  covered: covered.size,
  total,
  updated: new Date().toISOString().slice(0, 10),
  note: "Refresh only when scenarios/rules legitimately change coverage; the test fails on silent decrease.",
};
writeFileSync(join(QA_DIR, "coverage-baseline.json"), JSON.stringify(baseline, null, 2) + "\n");
console.log(`baseline written: ${covered.size}/${total} rules`);
