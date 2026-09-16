// ============================================================================
// Golden-scenario correctness suite — the oracle for Darius's core worry:
// "do the rules output the CORRECT requirements?"
//
// For each committed golden in ./goldens/*.json:
//   - expectedAbsent invariants assert HARD (draft or validated): these are
//     hand-authored, e.g. no Permiso Único for a home-based business.
//   - "validated" goldens assert EXACT requirement-set equality plus pinned
//     applicability/mandatory. Any engine change that alters a validated
//     golden fails loudly — that is the signal, not noise.
//   - "draft" goldens report drift without failing: the drift report goes to
//     the QA loop, which routes changed scenarios for Darius's review.
//
// To validate a draft golden: review its expected set with Darius, correct
// it, set "status": "validated" in the JSON, and it becomes ground truth.
// ============================================================================

import test from "node:test";
import assert from "node:assert/strict";
import {
  loadGoldens,
  runGolden,
  absentViolations,
} from "./goldenHarness";

const goldens = loadGoldens();

test("golden catalog loads (25 scenarios expected)", () => {
  assert.ok(goldens.length >= 25, `expected at least 25 goldens, found ${goldens.length}`);
});

const driftReport: string[] = [];

for (const golden of goldens) {
  test(`${golden.id} [${golden.status}] ${golden.title}`, () => {
    const result = runGolden(golden);

    // Hand-authored absence invariants always assert hard.
    const violations = absentViolations(result);
    assert.deepEqual(
      violations,
      [],
      `${golden.id}: forbidden requirements surfaced: ${violations.join(", ")}`
    );

    const problems: string[] = [];
    if (result.added.length > 0) problems.push(`unexpectedly ADDED: ${result.added.join(", ")}`);
    if (result.removed.length > 0) problems.push(`unexpectedly REMOVED: ${result.removed.join(", ")}`);
    if (result.changed.length > 0) problems.push(`applicability CHANGED: ${result.changed.join(", ")}`);

    if (golden.status === "validated") {
      assert.deepEqual(problems, [], `${golden.id}: validated golden drifted:\n  - ${problems.join("\n  - ")}`);
    } else if (problems.length > 0) {
      driftReport.push(`${golden.id} drift:\n    - ${problems.join("\n    - ")}`);
    }
  });
}

test("draft-golden drift report (informational — never fails)", () => {
  if (driftReport.length === 0) {
    console.log("\n[goldens] no draft drift: all draft goldens match their snapshots.");
  } else {
    console.log(`\n[goldens] DRAFT DRIFT — ${driftReport.length} scenario(s) changed since snapshot; route for review:`);
    for (const line of driftReport) console.log("  " + line);
  }
});
