// ============================================================================
// Knowledge Graph Reasoning Paths — core types.
// Pure data model + evaluator contract. No I/O. See docs/reasoning-paths-design.md.
// ============================================================================

export type FactOp =
  | "eq" | "neq" | "gt" | "gte" | "lt" | "lte"
  | "in" | "not_in" | "exists" | "not_exists";

export interface FactPredicate {
  fact: string;
  op: FactOp;
  value?: unknown;
}

export interface ConditionExpr {
  all?: FactPredicate[];
  any?: FactPredicate[];
  not?: FactPredicate;
}

/** A single auditable predicate over the fact bag. */
export interface DecisionCondition {
  id: string;               // e.g. "COND_OWNERSHIP_CHANGED"
  label: string;            // short human label
  triggerSummary: string;   // "why" language, shown when matched
  expr: ConditionExpr;
  sourceId: string;         // regulatory_sources.json id or citation string — REQUIRED
  locator: string;          // e.g. "Art. 8.4A" — REQUIRED
  confidence?: "high" | "medium" | "kb-silent";
}

/** A named situation pattern. Detected when requiredConditions all match
 *  and no excludedConditions match. */
export interface Scenario {
  id: string;               // e.g. "SCN_EXISTING_BIZ_OWNERSHIP_CHANGE"
  label: string;
  description: string;
  requiredConditions: string[];  // DecisionCondition ids
  excludedConditions: string[];  // DecisionCondition ids
}

/** A variant of a regulatory process, selected by conditions.
 *  Maps to EXISTING permit rules (RULE_* ids from src/kb/rules.json). */
export interface ProcessVariant {
  id: string;               // e.g. "VAR_PERMISO_UNICO_CHANGE_OF_USE"
  label: string;
  processId: string;        // regulatory_processes.json process id (informational)
  selectorConditions: string[];  // DecisionCondition ids — all must match
  ruleIds: string[];        // RULE_* ids — the permits this variant produces
  active: boolean;
  supersededBy?: string;    // variant id that replaces this one
  note?: string;
}

export interface ResolvedPermit {
  ruleId: string;
  documentId: string | null;
  title: string;
  citation: string;
  citationUrl: string | null;
}

export interface MatchedCondition {
  id: string;
  triggerSummary: string;
  sourceId: string;
  locator: string;
}

export interface TriggeredPath {
  scenarioId: string;
  scenarioLabel: string;
  variantId: string;
  variantLabel: string;
  processId: string;
  matchedConditions: MatchedCondition[];
  permits: ResolvedPermit[];
  why: string;
}

export interface NegativePath {
  kind: "scenario" | "variant";
  id: string;
  label: string;
  blockedBy: string[];      // condition ids that failed
  reason: string;           // "does not apply because …"
}

export interface ReasoningPathResult {
  scenarios: { id: string; label: string }[];
  paths: TriggeredPath[];
  permits: ResolvedPermit[];          // union across paths, deduped by ruleId
  negativePaths: NegativePath[];
  evaluatedConditions: { id: string; matched: boolean }[];
}

export interface ReasoningGraph {
  conditions: DecisionCondition[];
  scenarios: Scenario[];
  variants: ProcessVariant[];
}

export type FactBag = Record<string, unknown>;

export interface ValidationFinding {
  severity: "error" | "warning";
  code: string;
  message: string;
  entityId?: string;
}
