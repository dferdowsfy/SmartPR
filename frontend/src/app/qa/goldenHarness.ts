// ============================================================================
// Golden-scenario harness — shared loader, runner, and diff logic.
//
// A golden JSON file records: scenario inputs, the expected requirement set,
// and a status ("draft" | "validated").
//
//   - "validated": the expected set is Darius-reviewed ground truth. The
//     suite asserts EXACT set equality (document ids) plus per-requirement
//     applicability/mandatory where the golden pins them. Any engine change
//     that alters a validated golden fails the suite loudly.
//   - "draft": the expected set is a snapshot of current engine behavior
//     awaiting Darius's review. Drift is REPORTED but never fails — the QA
//     loop picks the drift report up and routes changed scenarios for review.
//
// expectedAbsent lists document ids that must NEVER appear for the scenario
// (hand-authored invariants, e.g. no Permiso Único for a home-based
// business). These assert hard in both draft and validated goldens.
// ============================================================================

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { computeRequirementsFromKB } from "../kb";
import { buildEngineInput } from "../kb";
import { applyPermitModelCorrections } from "../kb";
import { KB } from "../kb";
import { runRulesEngine } from "../rulesEngine";

const QA_DIR = join(dirname(fileURLToPath(import.meta.url)));
const GOLDENS_DIR = join(QA_DIR, "goldens");

export interface GoldenExpectedRequirement {
  document_id: string;
  name?: string;
  applicability?: string;
  mandatory?: boolean;
  source_rule?: string;
}

export interface Golden {
  id: string;
  title: string;
  status: "draft" | "validated";
  profile: Record<string, unknown>;
  answers: Record<string, unknown>;
  options: {
    entityType?: string | null;
    projectIntent?: string | null;
  };
  expected: GoldenExpectedRequirement[];
  expectedAbsent: string[];
}

export interface GoldenRunResult {
  golden: Golden;
  /** document_id -> { applicability, mandatory, name, source_rule } */
  actual: Map<string, { applicability: string; mandatory: boolean; name: string; source_rule: string }>;
  /** rule ids that fired during this run (for coverage). */
  rulesFired: string[];
  /** document ids present in actual but not expected. */
  added: string[];
  /** document ids expected but missing from actual. */
  removed: string[];
  /** document ids whose applicability/mandatory changed vs the golden. */
  changed: string[];
}

export function loadGoldens(): Golden[] {
  const files = readdirSync(GOLDENS_DIR).filter((f) => f.endsWith(".json")).sort();
  return files.map((f) => JSON.parse(readFileSync(join(GOLDENS_DIR, f), "utf8")) as Golden);
}

export function runGolden(golden: Golden): GoldenRunResult {
  const rows = computeRequirementsFromKB(
    golden.profile,
    golden.answers,
    {},
    {
      entityType: golden.options.entityType ?? undefined,
      projectIntent: (golden.options.projectIntent as "new_business" | null) ?? undefined,
    }
  );
  const actual = new Map<
    string,
    { applicability: string; mandatory: boolean; name: string; source_rule: string }
  >();
  for (const r of rows) {
    const id = r.document_id!;
    if (!actual.has(id)) {
      actual.set(id, {
        applicability: r.applicability ?? "unknown",
        mandatory: !!r.mandatory,
        name: r.name ?? id,
        source_rule: (r as { source_rule?: string }).source_rule ?? "",
      });
    }
  }

  // Coverage: which rules fired, via the lower-level engine with the same input.
  const input = buildEngineInput(golden.profile, golden.answers, {}, {
    projectIntent: (golden.options.projectIntent as "new_business" | null) ?? null,
  });
  // Mirror computeRequirementsFromSnapshot's direct-answer + permit-model steps.
  for (const question of KB.questions as Array<{ id: string }>) {
    const direct = golden.answers[question.id];
    if (direct !== undefined) input.answers[question.id] = direct as boolean | string;
  }
  applyPermitModelCorrections(input.answers);
  const { debug } = runRulesEngine(KB, input);
  const rulesFired = [...new Set(debug.rulesMatched.map((m) => m.rule_id))];

  const expectedIds = new Set(golden.expected.map((e) => e.document_id));
  const actualIds = new Set(actual.keys());
  const added = [...actualIds].filter((id) => !expectedIds.has(id));
  const removed = [...expectedIds].filter((id) => !actualIds.has(id));
  const changed: string[] = [];
  for (const e of golden.expected) {
    const a = actual.get(e.document_id);
    if (!a) continue;
    if (e.applicability && a.applicability !== e.applicability) changed.push(e.document_id);
    else if (e.mandatory !== undefined && a.mandatory !== e.mandatory) changed.push(e.document_id);
  }
  return { golden, actual, rulesFired, added, removed, changed };
}

/** Hard invariant failures: expectedAbsent ids that showed up. */
export function absentViolations(result: GoldenRunResult): string[] {
  return result.golden.expectedAbsent.filter((id) => result.actual.has(id));
}

export function totalRuleCount(): number {
  return (KB.rules as unknown[]).length;
}

/** Union of rule ids fired across every golden scenario (for coverage). */
export function computeCoverage(): { covered: Set<string>; total: number } {
  const covered = new Set<string>();
  for (const golden of loadGoldens()) {
    for (const ruleId of runGolden(golden).rulesFired) covered.add(ruleId);
  }
  return { covered, total: totalRuleCount() };
}
