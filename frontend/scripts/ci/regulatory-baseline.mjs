#!/usr/bin/env node
// ============================================================================
// Regulatory-correctness regression gate (see
// docs/enterprise-azure/CI_SECURITY_BASELINE.md).
//
// Reads the TAP output of `npm run test:regulatory-correctness` and compares
// the set of failing top-level tests with ci/regulatory-known-failures.json.
// The known failures are real, pre-existing defects. They are neither skipped
// nor hidden: the tests still run and still fail, and this gate reports them.
//
//   failing set == known set              -> PASS, with a visible warning
//   any other test fails                  -> FAIL (regression)
//   a known failure now passes            -> FAIL (improvement: update the
//                                            baseline intentionally)
//   a known failure is missing entirely   -> FAIL (renamed/removed test)
//   fewer tests than baseline, or any
//   skipped/todo/cancelled tests          -> FAIL (coverage must not shrink)
//
// Usage (from frontend/):
//   NODE_OPTIONS=--test-reporter=tap npm run test:regulatory-correctness > out.tap || true
//   node scripts/ci/regulatory-baseline.mjs out.tap
// ============================================================================

import { readFileSync } from "node:fs";

const BASELINE_PATH = "ci/regulatory-known-failures.json";
const tapPath = process.argv[2];
if (!tapPath) {
  console.error("usage: regulatory-baseline.mjs <tap-output-file>");
  process.exit(2);
}

const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
const tap = readFileSync(tapPath, "utf8").split("\n");

const passed = new Set();
const failed = new Set();
// Top-level results only (no indentation); subtest detail stays in the log.
for (const line of tap) {
  const m = /^(not ok|ok) \d+ - (.*?)(?: # (SKIP|TODO)\b.*)?$/.exec(line);
  if (!m) continue;
  (m[1] === "ok" ? passed : failed).add(m[2]);
}
const summary = (key) => {
  const line = tap.find((l) => l.startsWith(`# ${key} `));
  return line ? Number(line.slice(key.length + 3)) : NaN;
};
const total = summary("tests");
const skipped = summary("skipped") + summary("todo") + summary("cancelled");

const known = new Set(baseline.knownFailures.map((k) => k.name));
const problems = [];

if (!Number.isFinite(total) || passed.size + failed.size === 0) {
  problems.push("Could not parse TAP output (was the reporter forced to tap?).");
}
if (total < baseline.minimumTests) {
  problems.push(`Test count dropped: ${total} < baseline ${baseline.minimumTests}.`);
}
if (skipped > 0) problems.push(`${skipped} skipped/todo/cancelled test(s); none are allowed.`);

const unexpected = [...failed].filter((n) => !known.has(n));
const fixed = [...known].filter((n) => passed.has(n));
const missing = [...known].filter((n) => !passed.has(n) && !failed.has(n));

for (const n of unexpected) problems.push(`REGRESSION: new failure: ${n}`);
for (const n of missing) problems.push(`Known failure no longer present (renamed/removed?): ${n}`);
for (const n of fixed) {
  problems.push(
    `IMPROVEMENT: known failure now passes: ${n}\n` +
      `    Remove it from frontend/${BASELINE_PATH} in the same PR to lock in the fix.`
  );
}

console.log(`Regulatory correctness: ${passed.size}/${total} passed, ${failed.size} failed.`);
if (problems.length) {
  console.log("\nFAIL:");
  for (const p of problems) console.log(`  ${p}`);
  process.exit(1);
}
const ids = baseline.knownFailures.map((k) => k.id).join(", ");
console.log(`::warning::Known baseline failures (${failed.size}): ${ids}. No new failures.`);
