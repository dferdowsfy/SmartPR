// ============================================================================
// Rule-coverage test — answers "how much of the rulebook has testing
// actually exercised?"
//
// Runs every golden scenario, unions the rule ids that fired (from the
// engine's own debug.rulesMatched), and reports covered/total rules.
//
// The baseline in coverage-baseline.json ratchets: coverage may never
// silently DECREASE. Refresh it deliberately with:
//   npx tsx src/app/qa/updateCoverageBaseline.ts
// after adding scenarios or rules that legitimately move the number.
//
// The uncovered-rule list printed here is the QA loop's targeting input:
// rules that have never fired in any test are where the next false
// negatives are hiding.
// ============================================================================

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadGoldens, computeCoverage } from "./goldenHarness";
import { KB } from "../kb";

const QA_DIR = join(dirname(fileURLToPath(import.meta.url)));

test("rule coverage never regresses vs baseline", () => {
  const { covered, total } = computeCoverage();
  const baseline = JSON.parse(
    readFileSync(join(QA_DIR, "coverage-baseline.json"), "utf8")
  ) as { covered: number; total: number };

  const pct = ((covered.size / total) * 100).toFixed(1);
  console.log(`\n[coverage] ${covered.size}/${total} rules fired by golden scenarios (${pct}%)`);

  // Uncovered rules, grouped by type, for the QA loop to target.
  const uncovered = (KB.rules as Array<{ id: string; rule_type: string }>)
    .filter((r) => !covered.has(r.id));
  const byType = new Map<string, string[]>();
  for (const r of uncovered) {
    const list = byType.get(r.rule_type) ?? [];
    list.push(r.id);
    byType.set(r.rule_type, list);
  }
  console.log(`[coverage] ${uncovered.length} rules never fired in any golden scenario:`);
  for (const [type, ids] of [...byType.entries()].sort()) {
    console.log(`[coverage]   ${type}: ${ids.length} (${ids.slice(0, 12).join(", ")}${ids.length > 12 ? ", …" : ""})`);
  }

  assert.ok(
    covered.size >= baseline.covered,
    `rule coverage regressed: ${covered.size} < baseline ${baseline.covered}. ` +
      `If rules were removed, refresh the baseline with npx tsx src/app/qa/updateCoverageBaseline.ts`
  );
});
