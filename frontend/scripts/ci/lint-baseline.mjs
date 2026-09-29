#!/usr/bin/env node
// ============================================================================
// Lint regression gate (transitional, see docs/enterprise-azure/CI_SECURITY_BASELINE.md).
//
// The repository carries pre-existing lint debt. Rather than weakening rules or
// adding ignores, this script compares a full-repo ESLint JSON report against a
// committed baseline of problem COUNTS per (file, rule, severity):
//
//   - any (file, rule, severity) count above its baseline      -> FAIL
//   - any problem in a file/rule not in the baseline           -> FAIL
//   - any problem at all in a file added or modified vs --base -> FAIL
//   - counts below baseline (debt paid down)                   -> FAIL until the
//     baseline is intentionally lowered with --update, so the ratchet only
//     ever moves toward zero and improvements are recorded, not silently lost.
//
// Counts rather than line numbers keep the baseline stable when unrelated
// lines move.
//
// Usage (from frontend/):
//   npx eslint -f json -o <report.json> .
//   node scripts/ci/lint-baseline.mjs --report <report.json> [--base <git-ref>]
//   node scripts/ci/lint-baseline.mjs --report <report.json> --update
// ============================================================================

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const BASELINE_PATH = "ci/lint-baseline.json";
const LINTABLE = /\.(?:[cm]?[jt]sx?)$/;

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

const reportPath = arg("--report");
const base = arg("--base");
const update = process.argv.includes("--update");
if (!reportPath) {
  console.error("usage: lint-baseline.mjs --report <eslint.json> [--base <ref>] [--update]");
  process.exit(2);
}

const root = process.cwd();
const report = JSON.parse(readFileSync(reportPath, "utf8"));

/** @type {Record<string, Record<string, number>>} file -> "severity:rule" -> count */
const current = {};
let errors = 0;
let warnings = 0;
for (const result of report) {
  const file = path.relative(root, result.filePath).split(path.sep).join("/");
  for (const msg of result.messages) {
    const severity = msg.severity === 2 ? "error" : "warning";
    if (severity === "error") errors++;
    else warnings++;
    const key = `${severity}:${msg.ruleId ?? "(fatal)"}`;
    current[file] ??= {};
    current[file][key] = (current[file][key] ?? 0) + 1;
  }
}

function sorted(obj) {
  return Object.fromEntries(
    Object.keys(obj)
      .sort()
      .map((k) => [k, typeof obj[k] === "object" ? sorted(obj[k]) : obj[k]])
  );
}

if (update) {
  writeFileSync(
    BASELINE_PATH,
    JSON.stringify({ totals: { errors, warnings }, files: sorted(current) }, null, 2) + "\n"
  );
  console.log(`Wrote ${BASELINE_PATH}: ${errors} errors, ${warnings} warnings.`);
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
const regressions = [];
const improvements = [];

for (const [file, rules] of Object.entries(current)) {
  for (const [key, count] of Object.entries(rules)) {
    const allowed = baseline.files[file]?.[key] ?? 0;
    if (count > allowed) regressions.push(`${file}  ${key}  ${allowed} -> ${count}`);
  }
}
for (const [file, rules] of Object.entries(baseline.files)) {
  for (const [key, allowed] of Object.entries(rules)) {
    const count = current[file]?.[key] ?? 0;
    if (count < allowed) improvements.push(`${file}  ${key}  ${allowed} -> ${count}`);
  }
}

// Files added/modified relative to --base must be fully lint-clean.
const dirtyChanged = [];
if (base) {
  const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const changed = execFileSync(
    "git",
    ["diff", "--name-only", "--diff-filter=AMR", `${base}...HEAD`, "--", "."],
    { encoding: "utf8" }
  )
    .split("\n")
    .filter(Boolean)
    .map((p) => path.relative(root, path.resolve(repoRoot, p)).split(path.sep).join("/"))
    .filter((p) => LINTABLE.test(p));
  for (const file of changed) {
    const rules = current[file];
    if (rules) {
      const n = Object.values(rules).reduce((a, b) => a + b, 0);
      dirtyChanged.push(`${file}  (${n} problem${n === 1 ? "" : "s"})`);
    }
  }
  console.log(`Changed lintable files checked for zero problems: ${changed.length}`);
}

console.log(
  `Lint totals: ${errors} errors, ${warnings} warnings ` +
    `(baseline ${baseline.totals.errors} errors, ${baseline.totals.warnings} warnings).`
);

let failed = false;
if (regressions.length) {
  failed = true;
  console.log(`\nFAIL: ${regressions.length} lint regression(s) above baseline:`);
  for (const r of regressions) console.log(`  ${r}`);
}
if (dirtyChanged.length) {
  failed = true;
  console.log(`\nFAIL: added/modified files must be lint-clean (fix the whole file):`);
  for (const r of dirtyChanged) console.log(`  ${r}`);
}
if (improvements.length) {
  failed = true;
  console.log(
    `\nFAIL (improvement): ${improvements.length} baseline entr${improvements.length === 1 ? "y" : "ies"} ` +
      `now lower than recorded. Lower the baseline intentionally:\n` +
      `  npx eslint -f json -o /tmp/eslint.json . ; node scripts/ci/lint-baseline.mjs --report /tmp/eslint.json --update`
  );
  for (const r of improvements) console.log(`  ${r}`);
}
if (!failed && errors + warnings > 0) {
  console.log(`\n::warning::Known lint debt: ${errors} errors, ${warnings} warnings (matches baseline; no regression).`);
}
process.exit(failed ? 1 : 0);
