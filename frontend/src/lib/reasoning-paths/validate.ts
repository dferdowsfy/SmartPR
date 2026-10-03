// ============================================================================
// Knowledge Graph Reasoning Paths — graph validation.
// See docs/reasoning-paths-design.md §5.
//
// validateReasoningGraph returns findings; the golden suite fails on any
// "error". The graph parameter is optional: when omitted, the seeded graph is
// loaded via loadReasoningGraph() at call time (deferred, so the index <->
// validate import cycle is safe — same pattern as the evaluator).
//
// Every check below is deterministic: entities are visited sorted by id, so
// findings come out in a stable order.
// ============================================================================

import type { ReasoningGraph, ValidationFinding } from "./types";
import { loadReasoningGraph } from "./index";
import rulesJson from "../../kb/rules.json";

interface KbRule {
  id: string;
  status?: string;
  [key: string]: unknown;
}

const KB_RULES: KbRule[] = rulesJson as unknown as KbRule[];
const KB_RULE_BY_ID: Map<string, KbRule> = new Map(KB_RULES.map((r) => [r.id, r]));
const INACTIVE_STATUSES = new Set(["inactive", "superseded", "disabled"]);

function byId(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function sameSorted(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((x, i) => x === sb[i]);
}

export function validateReasoningGraph(
  graph: ReasoningGraph = loadReasoningGraph()
): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  const condIds = new Set(graph.conditions.map((c) => c.id));

  const variants = [...graph.variants].sort(byId);
  const scenarios = [...graph.scenarios].sort(byId);
  const conditions = [...graph.conditions].sort(byId);

  // 1. variant.ruleIds referencing a rule id absent from rules.json → error.
  for (const v of variants) {
    for (const ruleId of v.ruleIds) {
      if (!KB_RULE_BY_ID.has(ruleId)) {
        findings.push({
          severity: "error",
          code: "unknown-rule",
          entityId: v.id,
          message: `Variant "${v.id}" references rule "${ruleId}", which does not exist in src/kb/rules.json.`,
        });
      }
    }
  }

  // 2. referenced rule whose status is inactive/superseded/disabled → error.
  // rules.json currently carries no status field; the check skips silently
  // for rules without one.
  for (const v of variants) {
    for (const ruleId of v.ruleIds) {
      const rule = KB_RULE_BY_ID.get(ruleId);
      if (
        rule &&
        typeof rule.status === "string" &&
        INACTIVE_STATUSES.has(rule.status)
      ) {
        findings.push({
          severity: "error",
          code: "inactive-rule",
          entityId: v.id,
          message: `Variant "${v.id}" references rule "${ruleId}" with status "${rule.status}".`,
        });
      }
    }
  }

  // 3. variant with zero ruleIds → error (orphaned: triggers but yields nothing).
  for (const v of variants) {
    if (v.ruleIds.length === 0) {
      findings.push({
        severity: "error",
        code: "orphaned-variant",
        entityId: v.id,
        message: `Variant "${v.id}" maps to zero rules (orphaned variant).`,
      });
    }
  }

  // 4. condition missing sourceId or locator → error (every regulatory
  // decision needs an authoritative citation).
  for (const c of conditions) {
    if (!c.sourceId?.trim() || !c.locator?.trim()) {
      findings.push({
        severity: "error",
        code: "missing-citation",
        entityId: c.id,
        message: `Condition "${c.id}" is missing a required citation (sourceId/locator).`,
      });
    }
  }

  // 5. scenario/variant referencing an unknown condition id → error.
  for (const s of scenarios) {
    for (const id of [...s.requiredConditions, ...s.excludedConditions]) {
      if (!condIds.has(id)) {
        findings.push({
          severity: "error",
          code: "unknown-condition",
          entityId: s.id,
          message: `Scenario "${s.id}" references unknown condition "${id}".`,
        });
      }
    }
  }
  for (const v of variants) {
    for (const id of v.selectorConditions) {
      if (!condIds.has(id)) {
        findings.push({
          severity: "error",
          code: "unknown-condition",
          entityId: v.id,
          message: `Variant "${v.id}" references unknown condition "${id}".`,
        });
      }
    }
  }

  // 6. duplicate mapping: two variants, same processId, identical sorted
  // selectorConditions, identical sorted ruleIds → error.
  for (let i = 0; i < variants.length; i++) {
    for (let j = i + 1; j < variants.length; j++) {
      const a = variants[i];
      const b = variants[j];
      if (
        a.processId === b.processId &&
        sameSorted(a.selectorConditions, b.selectorConditions) &&
        sameSorted(a.ruleIds, b.ruleIds)
      ) {
        findings.push({
          severity: "error",
          code: "duplicate-mapping",
          entityId: a.id,
          message: `Variants "${a.id}" and "${b.id}" are duplicate mappings for process "${a.processId}".`,
        });
      }
    }
  }

  // 7. scenario sharing zero condition ids with every variant's selectors
  // → warning (no variant can ever pair with it).
  for (const s of scenarios) {
    const sConds = new Set([...s.requiredConditions, ...s.excludedConditions]);
    const reachable = variants.some((v) =>
      v.selectorConditions.some((id) => sConds.has(id))
    );
    if (!reachable) {
      findings.push({
        severity: "warning",
        code: "unreachable-scenario",
        entityId: s.id,
        message: `Scenario "${s.id}" shares no condition ids with any variant's selectors.`,
      });
    }
  }

  // 8. variant with supersededBy set but active=true → warning (the
  // evaluator treats it as not-triggered; the flag combination is suspect).
  for (const v of variants) {
    if (v.supersededBy && v.active) {
      findings.push({
        severity: "warning",
        code: "superseded-active",
        entityId: v.id,
        message: `Variant "${v.id}" sets supersededBy="${v.supersededBy}" but is still active.`,
      });
    }
  }

  return findings;
}
