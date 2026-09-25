/**
 * Semantic intake: description → ScenarioContext → Passport merge →
 * knowledge-graph applicability → controlling facts → next question → …
 *
 * The model (and ./interpret) build a factual model of the situation. The KB
 * decides what applies. Nothing in this folder names a permit on its own.
 */
export {
  SCENARIO_PATHS, businessStatus, changeOfUseStatus, cloneScenario, emptyScenario, getFact, restoreScenario, isConfirmed, ownershipStatus, setFact, valueOf,
} from "./types";
export type {
  BusinessStatus, DemolitionScope, F, FactSource, OwnershipStatus, ScenarioContext, ScenarioFact, ScenarioPath, ScenarioSection, UseSpecificity,
} from "./types";
export { interpretScenario, clauseAt } from "./interpret";
export { normalizeScenario, combineScenario, evidenceInText } from "./normalize";
export {
  identityFieldsKnown, mergePassportIntoScenario, passportDeltas, passportKnownItems, passportSnapshotFromApi,
} from "./passport";
export type { PassportDelta, PassportKnownItem, PassportSnapshot } from "./passport";
export { applyScenarioAnswer, evaluateScenario, resolveBusinessTypes } from "./graph";
export type {
  ControllingFact, ControllingFactId, RegulatoryPath, ScenarioEvaluation, ScenarioQuestion, ScenarioQuestionOption,
} from "./graph";
export { describeScenario, liveFactLines, scenarioTitle } from "./describe";
export type { ScenarioChip, ScenarioSummary } from "./describe";
export { reconcileProjectContext, scenarioProjectIntent, scenarioToProjectContext } from "./adapter";
export { displayOfUse } from "./uses";
export { applyScenarioToInterpretation } from "./bridge";

import type { KnowledgeBase } from "../../../rulesEngine";
import { interpretScenario } from "./interpret";
import { combineScenario, normalizeScenario } from "./normalize";
import { mergePassportIntoScenario, type PassportSnapshot } from "./passport";
import type { ScenarioContext } from "./types";

/** One call for the intake: read, validate the model's reading, merge the Passport. */
export function buildScenario(
  description: string,
  opts: { modelScenario?: unknown; passport?: PassportSnapshot | null } = {}
): ScenarioContext {
  const base = interpretScenario(description);
  const model = opts.modelScenario ? normalizeScenario(opts.modelScenario, description).scenario : null;
  return mergePassportIntoScenario(combineScenario(base, model), opts.passport ?? null);
}

export type { KnowledgeBase };
