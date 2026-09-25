/**
 * Scenario ⇄ the legacy interpretation the intake already consumes.
 *
 * The rest of the intake (profile fields, project intent card, flat project
 * facts feeding the rules engine) keeps working unchanged; the scenario reading
 * is applied on top so keyword-level conclusions can't leak through:
 *
 * - project intent "new_business" survives only if the scenario says the
 *   business is new ("a new commercial operation" is not a new business);
 *   the scenario's own status fills the intent when the model gave none;
 * - flat project facts are reconciled (an unconfirmed change of use is not a
 *   change of use; a vague proposed use is not a proposed use).
 */
import type { ValidatedInterpretation } from "../validateInterpretation";
import { isConfirmed } from "./types";
import { reconcileProjectContext, scenarioProjectIntent } from "./adapter";
import type { ScenarioContext } from "./types";

export function applyScenarioToInterpretation(
  validated: ValidatedInterpretation,
  scenario: ScenarioContext
): ValidatedInterpretation {
  const out: ValidatedInterpretation = {
    ...validated,
    suggested: { ...validated.suggested },
    discarded: [...validated.discarded],
    scenario,
  };
  const status = scenario.business.status?.value;
  const dropNew = (where: "applied" | "suggested") => {
    const intent = where === "applied" ? out.projectIntent : out.suggested.projectIntent;
    if (intent?.value === "new_business" && status !== "new") {
      if (where === "applied") delete out.projectIntent;
      else delete out.suggested.projectIntent;
      out.discarded.push({ field: `projectIntent(${where})`, reason: "no new-business formation in the scenario" });
    }
    if (intent?.value === "existing_business" && status === "new") {
      if (where === "applied") delete out.projectIntent;
      else delete out.suggested.projectIntent;
      out.discarded.push({ field: `projectIntent(${where})`, reason: "the scenario forms a new business" });
    }
  };
  dropNew("applied");
  dropNew("suggested");
  // "I want to open a daycare": the scenario only infers a new business, so
  // the model's intent is a suggestion to confirm, never an applied fact.
  if (out.projectIntent && scenario.business.status && !isConfirmed(scenario.business.status)) {
    out.suggested.projectIntent = { ...out.projectIntent, requiresConfirmation: true };
    delete out.projectIntent;
  }
  const si = scenarioProjectIntent(scenario);
  if (si && !out.projectIntent && !out.suggested.projectIntent) {
    const s = scenario.business.status!;
    const fact = { value: si.value, confidence: s.confidence, evidence: s.evidenceText, requiresConfirmation: !si.confirmed };
    if (si.confirmed && s.confidence >= 0.85) out.projectIntent = fact;
    else out.suggested.projectIntent = { ...fact, requiresConfirmation: true };
  }
  out.projectContext = reconcileProjectContext(validated.projectContext, scenario);
  return out;
}
