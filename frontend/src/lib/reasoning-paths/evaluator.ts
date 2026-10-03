// ============================================================================
// Knowledge Graph Reasoning Paths — evaluator.
// Pure functions, no I/O. See docs/reasoning-paths-design.md §4.
//
// The graph comes from loadReasoningGraph() (./index), called inside
// evaluateReasoningPaths at call time — never at module scope. This keeps the
// evaluator free of a ./seed import so test harnesses can point
// loadReasoningGraph at a scratch graph with a single import swap in index.ts.
// (The resulting index <-> evaluator import cycle is safe: the binding is only
// dereferenced when evaluateReasoningPaths runs, long after both modules are
// initialized.)
//
// The layer never invents permits: every ResolvedPermit is resolved from an
// existing RULE_* entry in src/kb/rules.json. Unknown rule ids are skipped
// (the validator reports them); the evaluator never throws on data problems.
// ============================================================================

import type {
  ConditionExpr,
  DecisionCondition,
  FactBag,
  FactPredicate,
  MatchedCondition,
  NegativePath,
  ReasoningGraph,
  ResolvedPermit,
  Scenario,
  TriggeredPath,
  ReasoningPathResult,
  ProcessVariant,
} from "./types";
import { loadReasoningGraph } from "./index";
import rulesJson from "../../kb/rules.json";

// ---------------------------------------------------------------------------
// src/kb/rules.json access (read-only).
// ---------------------------------------------------------------------------

interface KbRule {
  id: string;
  title?: string;
  rule_type?: string;
  requires_document_id?: string | null;
  citation?: string;
  citation_url?: string | null;
  status?: string;
  [key: string]: unknown;
}

const KB_RULES: KbRule[] = rulesJson as unknown as KbRule[];
const KB_RULE_BY_ID: Map<string, KbRule> = new Map(KB_RULES.map((r) => [r.id, r]));

// ---------------------------------------------------------------------------
// Fact normalization + derived facts (design §3).
// Derived facts are authoritative: they are recomputed from the base facts on
// every call and overwrite any caller-supplied value under the same name.
// ---------------------------------------------------------------------------

function normalizeFacts(facts: FactBag): FactBag {
  const bag: FactBag = { ...(facts ?? {}) };
  const ownershipChanged = bag["ownership_changed"] === true;
  const existingBusiness = bag["existing_business"] === true;
  bag["change_of_owner_process"] = ownershipChanged && existingBusiness;
  bag["no_construction"] = bag["construction_required"] !== true;
  return bag;
}

// ---------------------------------------------------------------------------
// Predicate + expression evaluation (design §2).
//
// A fact is MISSING when its value is undefined or null. Missing-fact
// semantics: exists→false, not_exists→true, eq→false, neq→true, in→false,
// not_in→true, gt/gte/lt/lte→false.
// ---------------------------------------------------------------------------

function isMissing(value: unknown): boolean {
  return value === undefined || value === null;
}

function evalPredicate(p: FactPredicate, facts: FactBag): boolean {
  const actual = facts[p.fact];
  if (isMissing(actual)) {
    switch (p.op) {
      case "not_exists":
      case "neq":
      case "not_in":
        return true;
      default:
        return false;
    }
  }
  switch (p.op) {
    case "exists":
      return true;
    case "not_exists":
      return false;
    case "eq":
      return actual === p.value;
    case "neq":
      return actual !== p.value;
    case "in":
      return Array.isArray(p.value) && (p.value as unknown[]).includes(actual);
    case "not_in":
      return Array.isArray(p.value) ? !(p.value as unknown[]).includes(actual) : false;
    case "gt":
      return typeof actual === "number" && typeof p.value === "number" && actual > p.value;
    case "gte":
      return typeof actual === "number" && typeof p.value === "number" && actual >= p.value;
    case "lt":
      return typeof actual === "number" && typeof p.value === "number" && actual < p.value;
    case "lte":
      return typeof actual === "number" && typeof p.value === "number" && actual <= p.value;
  }
}

/** all = every, any = some, not = negated. An empty or absent expression never matches. */
function evalExpr(expr: ConditionExpr | undefined | null, facts: FactBag): boolean {
  if (!expr) return false;
  const parts: boolean[] = [];
  if (expr.all) parts.push(expr.all.every((p) => evalPredicate(p, facts)));
  if (expr.any) parts.push(expr.any.some((p) => evalPredicate(p, facts)));
  if (expr.not) parts.push(!evalPredicate(expr.not, facts));
  if (parts.length === 0) return false;
  return parts.every(Boolean);
}

function evaluateConditions(
  graph: ReasoningGraph,
  facts: FactBag
): Map<string, boolean> {
  const matched = new Map<string, boolean>();
  for (const c of graph.conditions) matched.set(c.id, evalExpr(c.expr, facts));
  return matched;
}

// ---------------------------------------------------------------------------
// Scenario detection: every requiredConditions id matched AND no
// excludedConditions id matched. Unknown condition ids count as unmatched
// (the validator flags them separately).
// ---------------------------------------------------------------------------

interface ScenarioVerdict {
  scenario: Scenario;
  detected: boolean;
  blockedBy: string[]; // required ids that failed + excluded ids that matched
}

function detectScenarios(
  graph: ReasoningGraph,
  matched: Map<string, boolean>
): ScenarioVerdict[] {
  return graph.scenarios.map((s) => {
    const failedRequired = s.requiredConditions.filter((id) => !matched.get(id));
    const matchedExcluded = s.excludedConditions.filter((id) => matched.get(id));
    const blockedBy = [...failedRequired, ...matchedExcluded];
    return { scenario: s, detected: blockedBy.length === 0, blockedBy };
  });
}

// ---------------------------------------------------------------------------
// Variant triggering: active && !supersededBy, and every selectorConditions
// id matched. Unknown selector ids count as unmatched.
// ---------------------------------------------------------------------------

interface VariantVerdict {
  variant: ProcessVariant;
  triggered: boolean;
  failedSelectors: string[];
  inactive: boolean;
  superseded: boolean;
}

function triggerVariants(
  graph: ReasoningGraph,
  matched: Map<string, boolean>
): VariantVerdict[] {
  return graph.variants.map((v) => {
    const inactive = !v.active;
    const superseded = !inactive && !!v.supersededBy;
    const failedSelectors = v.selectorConditions.filter((id) => !matched.get(id));
    const triggered =
      !inactive && !superseded && failedSelectors.length === 0;
    return { variant: v, triggered, failedSelectors, inactive, superseded };
  });
}

// ---------------------------------------------------------------------------
// Permit resolution: variant ruleIds -> rules.json entries. Unknown ids are
// skipped (validator reports "unknown-rule"); never throws.
// ---------------------------------------------------------------------------

function resolvePermits(ruleIds: string[]): ResolvedPermit[] {
  const seen = new Set<string>();
  const out: ResolvedPermit[] = [];
  for (const ruleId of ruleIds) {
    if (seen.has(ruleId)) continue;
    seen.add(ruleId);
    const rule = KB_RULE_BY_ID.get(ruleId);
    if (!rule) continue;
    out.push({
      ruleId,
      documentId: rule.requires_document_id ?? null,
      title: rule.title ?? rule.rule_type ?? rule.id,
      citation: rule.citation ?? "",
      citationUrl: rule.citation_url ?? null,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Path assembly. A triggered variant pairs with each detected scenario it
// shares at least one condition id with (scenario required ∪ excluded). A
// triggered variant that shares no conditions with any detected scenario is
// paired with the detected scenario it overlaps most (ties → lowest id), so a
// triggering variant's permits are never silently dropped.
// ---------------------------------------------------------------------------

function scenarioConditionIds(s: Scenario): Set<string> {
  return new Set([...s.requiredConditions, ...s.excludedConditions]);
}

function byId(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function toMatchedCondition(
  id: string,
  condById: Map<string, DecisionCondition>
): MatchedCondition {
  const c = condById.get(id);
  return {
    id,
    triggerSummary: c?.triggerSummary ?? id,
    sourceId: c?.sourceId ?? "",
    locator: c?.locator ?? "",
  };
}

function buildPath(
  s: Scenario,
  v: ProcessVariant,
  condById: Map<string, DecisionCondition>
): TriggeredPath {
  const condIds = [...new Set([...s.requiredConditions, ...v.selectorConditions])].sort();
  const matchedConditions = condIds.map((id) => toMatchedCondition(id, condById));
  const permits = resolvePermits(v.ruleIds);

  // All required/selector ids matched by construction (scenario detected,
  // variant triggered), so every id here has a real condition behind it.
  const scenarioSummaries = s.requiredConditions.map(
    (id) => condById.get(id)?.triggerSummary ?? id
  );
  const variantSummaries = v.selectorConditions.map(
    (id) => condById.get(id)?.triggerSummary ?? id
  );
  const citations = matchedConditions.map((c) => `${c.locator} (${c.sourceId})`);
  const why =
    `Scenario "${s.label}" detected: ${scenarioSummaries.join("; ")}. ` +
    `Variant "${v.label}" selected: ${variantSummaries.join("; ")}. ` +
    `Permits: ${permits.length > 0 ? permits.map((p) => p.title).join("; ") : "none"}. ` +
    `Citations: ${citations.join("; ")}.`;

  return {
    scenarioId: s.id,
    scenarioLabel: s.label,
    variantId: v.id,
    variantLabel: v.label,
    processId: v.processId,
    matchedConditions,
    permits,
    why,
  };
}

// ---------------------------------------------------------------------------
// Main entry point.
// ---------------------------------------------------------------------------

export function evaluateReasoningPaths(facts: FactBag): ReasoningPathResult {
  const graph = loadReasoningGraph();
  const bag = normalizeFacts(facts);
  const matched = evaluateConditions(graph, bag);
  const condById = new Map(graph.conditions.map((c) => [c.id, c]));
  const condLabel = (id: string): string => condById.get(id)?.label ?? id;

  const scenarioVerdicts = detectScenarios(graph, matched);
  const detected = scenarioVerdicts
    .filter((v) => v.detected)
    .map((v) => v.scenario)
    .sort(byId);

  const variantVerdicts = triggerVariants(graph, matched);
  const triggered = variantVerdicts
    .filter((v) => v.triggered)
    .map((v) => v.variant)
    .sort(byId);

  // Triggered paths, ordered by (scenarioId, variantId) for determinism.
  const paths: TriggeredPath[] = [];
  const coveredVariants = new Set<string>();
  for (const s of detected) {
    const sConds = scenarioConditionIds(s);
    for (const v of triggered) {
      if (v.selectorConditions.some((id) => sConds.has(id))) {
        paths.push(buildPath(s, v, condById));
        coveredVariants.add(v.id);
      }
    }
  }
  for (const v of triggered) {
    if (coveredVariants.has(v.id) || detected.length === 0) continue;
    const ranked = detected
      .map((s) => ({
        s,
        overlap: v.selectorConditions.filter((id) =>
          scenarioConditionIds(s).has(id)
        ).length,
      }))
      .sort((a, b) => b.overlap - a.overlap || byId(a.s, b.s));
    const best = ranked[0];
    if (best) paths.push(buildPath(best.s, v, condById));
  }

  // Union of permits across paths, deduplicated by ruleId (first wins).
  const permits: ResolvedPermit[] = [];
  const seenRuleIds = new Set<string>();
  for (const path of paths) {
    for (const p of path.permits) {
      if (seenRuleIds.has(p.ruleId)) continue;
      seenRuleIds.add(p.ruleId);
      permits.push(p);
    }
  }

  // Negative paths: every non-detected scenario, and every ACTIVE variant
  // that did not trigger (inactive variants are silent by design).
  const negativePaths: NegativePath[] = [];
  for (const verdict of scenarioVerdicts) {
    if (verdict.detected) continue;
    const s = verdict.scenario;
    negativePaths.push({
      kind: "scenario",
      id: s.id,
      label: s.label,
      blockedBy: verdict.blockedBy,
      reason: `Scenario "${s.label}" does not apply because ${verdict.blockedBy
        .map(condLabel)
        .join("; ")}; `,
    });
  }
  for (const verdict of variantVerdicts) {
    if (verdict.triggered || verdict.inactive) continue;
    const v = verdict.variant;
    const suffix =
      verdict.superseded && verdict.failedSelectors.length === 0
        ? `it is superseded by "${v.supersededBy}"`
        : verdict.failedSelectors.map(condLabel).join("; ");
    negativePaths.push({
      kind: "variant",
      id: v.id,
      label: v.label,
      blockedBy: verdict.failedSelectors,
      reason: `Variant "${v.label}" does not apply because ${suffix}; `,
    });
  }
  negativePaths.sort(byId);

  return {
    scenarios: detected.map((s) => ({ id: s.id, label: s.label })),
    paths,
    permits,
    negativePaths,
    evaluatedConditions: graph.conditions
      .map((c) => ({ id: c.id, matched: matched.get(c.id) === true }))
      .sort(byId),
  };
}
