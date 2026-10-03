# Knowledge Graph Reasoning Paths — Design

**Status:** build commission from Darius, 2026-10-03.
**Goal:** SmartPR reliably answers "What permits apply to this exact situation, what does not apply, and why?" through explicit, citable reasoning paths.

## 1. Concept

A **Reasoning Path** is an explicit, auditable chain:

```
Facts → DecisionConditions → Scenario → ProcessVariant → Permits (rules)
```

- **Scenario**: a named situation pattern, e.g. `SCN_EXISTING_BIZ_OWNERSHIP_CHANGE_SAME_USE_REMODEL`
  ("I bought an existing restaurant; it stays a restaurant; I'm remodeling the kitchen; ownership changed").
  A scenario is *detected* when all of its `requiredConditions` match the input facts and none of its
  `excludedConditions` match.
- **DecisionCondition**: a single predicate over facts, e.g. `COND_OWNERSHIP_CHANGED`
  (`{fact: "ownership_changed", op: "eq", value: true}`), carrying a human-readable `triggerSummary`
  ("Ownership of the business changed hands") and a `sourceId` citation.
- **ProcessVariant**: a variant of a regulatory process selected by conditions, e.g.
  `VAR_PERMISO_UNICO_CHANGE_OF_USE` (variant of the OGPe Permiso Único process for change-of-use).
  A variant *triggers* when all its `selectorConditions` match. Each variant maps to existing
  permit rules via `ruleIds` (RULE_* ids from `src/kb/rules.json`) — the layer never invents permits.
- **Negative path**: for every scenario/variant that does NOT trigger, the evaluator records *why*
  (which condition failed and what fact value blocked it), producing "does not apply because…".

The layer is **additive**: it does not replace or weaken the existing rules engine
(`rules.json` evaluation). Variants reference existing rule ids; validation fails the build if a
referenced rule id does not exist or is inactive.

## 2. Condition DSL

Reuse the trigger DSL already established in `src/kb/regulatory_processes.json`:

```ts
type FactOp = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "not_in" | "exists" | "not_exists";
interface FactPredicate { fact: string; op: FactOp; value?: unknown }
interface ConditionExpr { all?: FactPredicate[]; any?: FactPredicate[]; not?: FactPredicate }
```

A DecisionCondition has: `id`, `label`, `triggerSummary` (why-language), `expr: ConditionExpr`,
`sourceId` (regulatory_sources.json id or a rules.json citation string), `locator` (e.g. "Art. 8.4A").

## 3. Fact catalog (v1)

Facts are a flat `Record<string, unknown>`. The v1 catalog (all booleans unless noted):

| fact | meaning |
|---|---|
| `new_business` | a new business entity is being formed / is unformed |
| `existing_business` | an already-operating business |
| `existing_location` | operating at an already-built, previously occupied location |
| `construction_required` | new construction, expansion, or structural work |
| `remodeling` | interior remodel/rehabilitation without footprint expansion |
| `ownership_changed` | the business changed hands |
| `use_changed` | the activity/use at the location changed |
| `same_use` | the activity/use stays the same |
| `permit_renewal` | renewing existing permits (no other changes) |
| `residential_use` | the project is residential |
| `commercial_use` | the project is commercial |
| `utility_connection` | new utility service connection needed |
| `utility_type` | "electric" \| "water" \| "both" \| null |
| `subdivision` | segregating/subdividing a parcel |
| `business_activity` | string: "restaurant" \| "daycare" \| "pharmacy" \| "solar" \| "manufacturing" \| "retail" \| "office" \| null |
| `controlled_substances` | pharmacy handles controlled substances |
| `food_service` | prepares/serves food |
| `energy_capacity_kw` | number \| null (solar) |
| `grid_interconnection` | solar connects to LUMA grid |
| `employees` | number \| null |
| `municipality` | string \| null |

Derived facts (computed by the evaluator before matching, never asked twice):
- `change_of_owner_process = ownership_changed && existing_business`
- `no_construction = !construction_required`

## 4. Evaluator (`src/lib/reasoning-paths/`)

Pure functions, no I/O:

```
evaluateReasoningPaths(facts: FactBag): ReasoningPathResult
```

Steps:
1. Normalize facts + compute derived facts.
2. Evaluate every DecisionCondition → `matched: boolean`, record per-predicate results.
3. Detect scenarios: all `requiredConditions` matched AND no `excludedConditions` matched.
4. Trigger variants: all `selectorConditions` matched AND (variant.active && !variant.supersededBy).
5. Collect permits: union of `ruleIds` across triggered variants → resolve each to
   `{ruleId, documentId, title, citation, citationUrl}` from `rules.json`.
   A variant triggering with zero resolvable rules is reported (not silently dropped).
6. Negative paths: for each non-detected scenario → first blocking condition + fact values;
   for each non-triggered variant → blocking conditions. Sorted deterministically.
7. "Why" text: per triggered path, join the `triggerSummary` of matched conditions +
   scenario label + variant label + citations.

Result shape:

```ts
interface TriggeredPath {
  scenarioId: string; scenarioLabel: string;
  variantId: string; variantLabel: string; processId: string;
  matchedConditions: { id: string; triggerSummary: string; sourceId: string; locator: string }[];
  permits: ResolvedPermit[];           // deduplicated by ruleId
  why: string;                          // assembled explanation
}
interface NegativePath { kind: "scenario"|"variant"; id: string; label: string; blockedBy: string[]; reason: string }
interface ReasoningPathResult {
  scenarios: { id: string; label: string }[];
  paths: TriggeredPath[];
  permits: ResolvedPermit[];            // union across paths
  negativePaths: NegativePath[];
  evaluatedConditions: { id: string; matched: boolean }[];
}
```

## 5. Graph validation (`validate.ts`)

`validateReasoningGraph()` returns a list of findings; the test runner fails on any `error`:
- orphaned variant: triggers but maps to zero active rules → error
- rule id referenced but missing from rules.json → error
- rule referenced but `status: inactive/superseded` → error
- duplicate mapping: same ruleId mapped by two variants of the same process with identical selectors → error
- conflicting selectors: two variants of one process whose selectors can both match but map to
  contradictory outcomes (one includes rule R, another's negative list excludes R) → warning
- condition without sourceId/citation → error ("every regulatory decision has an authoritative citation")
- scenario with no variants reachable → warning
- superseded variant still referenced by a scenario → error

## 6. Seed data (`seed.ts`)

Authored by the knowledge-graph owner (human-reviewed). v1 must cover the 20 golden scenario
families (see §9). Every condition carries a real citation — reuse citation strings and source ids
from `rules.json` / `regulatory_processes.json` / `regulatory_sources.json`. **Never invent a
statute, fee, or deadline.** Where the KB is genuinely silent (e.g. ownership-transfer
"traspaso" mechanics), encode the condition with `confidence: "kb-silent"` and leave the
variant's permit list to the permits the KB *does* establish (patente, SURI update, Permiso Único);
do not fabricate a transfer permit.

## 7. Admin surface (`src/app/admin/knowledge-base/tabs/ReasoningPathsTab.tsx`)

Registered in `shell.tsx` as tab `"reasoning-paths"` labeled "Reasoning Paths". Sections:
1. **Scenario browser**: list of scenarios with their conditions and variants (read-only, from seed).
2. **Ad-hoc test**: fact editor (checkboxes/selects for the v1 catalog) + Run → triggered paths
   (scenario → variant → permits with why + citations) and negative paths.
3. **Golden suite**: run all fixtures in `tests/reasoning-paths/golden/*.json`, table of
   pass/fail with per-test diff (expected vs actual for scenarios, variants, permits, non-applicables).
4. **Graph health**: `validateReasoningGraph()` findings list.

Client-side only: import the evaluator directly (pure TS, no API needed).

## 8. Golden fixtures + runner

- Fixtures: `frontend/tests/reasoning-paths/golden/RP-001.json` … each:
  `{id, name, inputFacts, expectedScenarios[], expectedVariants[], expectedPermits[] (rule ids),
    expectedNonApplicable[] (rule ids that must NOT appear)}`
- Runner: `frontend/tests/reasoning-paths/run.mts` (tsx). For each fixture:
  evaluate → compare sets (order-insensitive) → report mismatches.
  Also runs `validateReasoningGraph()` first; any error fails the suite before scenario tests.
- npm script: `"test:reasoning-paths": "tsx tests/reasoning-paths/run.mts"`.
- Discipline: expectations are authored BEFORE running (the oracle). Never edit a fixture to
  match the engine; fix the seed/evaluator, then re-run.

## 9. v1 scenario families (20 + 1 complex)

RP-001 new business, existing location, no construction · RP-002 new business with remodeling ·
RP-003 existing business, ownership change · RP-004 existing business, change of use ·
RP-005 existing business, permit renewal · RP-006 new commercial construction ·
RP-007 residential use · RP-008 commercial utility connection · RP-009 residential utility connection ·
RP-010 property subdivision · RP-011 restaurant opening · RP-012 daycare conversion ·
RP-013 pharmacy opening · RP-014 solar/renewable project · RP-015 manufacturing facility ·
RP-016 multiple simultaneous changes · RP-017 ownership change + remodel · RP-018 change of use + construction ·
RP-019 NEGATIVE: construction_required=false → no construction permit ·
RP-020 NEGATIVE: ownership_changed=false → no change-of-owner process ·
RP-021 COMPLEX: bought existing Guaynabo restaurant, same use, kitchen remodel, ownership changed
  (must detect ownership-change path AND remodel path separately, with separate whys).

## 10. Non-goals

- Replacing the existing rules engine. It stays; this layer references it.
- Auto-editing seed data from test results. Remediation is human-reviewed, minimal, and
  must improve the reusable model (no test-specific exceptions — enforce by code review;
  the runner cannot detect intent, so keep remediation commits small and reviewed).
- Real-time portal data. Facts are user/Clara-supplied.

## 11. QA summary (produced at completion)

Total tests · passed · failed · remediated · remaining unresolved · rules added ·
rules changed · rules disabled · missing citations · areas needing regulatory research.
