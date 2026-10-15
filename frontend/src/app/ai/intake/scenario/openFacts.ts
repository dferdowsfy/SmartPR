// Controlling facts the intake still has to learn — minus the ones another
// part of the intake has already answered (live loop 2026-10-14: after the
// last question the hint asked whether this is "an existing business or a new
// one being formed" while the Project choice already said New business).
//
// Display only: the scenario and the knowledge-graph evaluation are not
// changed, so no path or requirement moves; only what the user is told is
// still needed.

import type { ProjectIntent } from "../projectIntent.ts";
import type { ScenarioEvaluation } from "./graph.ts";

type Controlling = ScenarioEvaluation["controlling"][number];

/** Scenario question id → controlling-fact id it settles when skipped/answered. */
const SKIP_SETTLES: Record<string, Controlling["id"]> = {
  sq_authorized_use: "authorized_use",
  sq_change_of_use: "change_of_use",
  sq_location: "location",
  sq_structural_exterior: "structural_exterior",
  sq_footprint: "footprint",
  sq_site_circulation: "site_circulation",
  sq_activity: "activity",
};

/** Controlling-fact ids the intake's own Project choice answers. */
export function answeredByIntake(ctx: {
  projectIntent: ProjectIntent | null | undefined;
  /** Scenario question ids the user skipped or answered with "Not sure" / "Other". */
  skippedQuestions?: readonly string[] | null;
}): Set<string> {
  const answered = new Set<string>();
  // New business / Existing business / Project only each settle "existing or new?".
  if (ctx.projectIntent) answered.add("business_status");
  // H11 (live 2026-10-15): skipping "current authorized use" (or Not sure /
  // Other) left it in the "may also need" hint forever because skip only
  // removes the question, not the controlling fact.
  for (const qid of ctx.skippedQuestions ?? []) {
    const id = SKIP_SETTLES[qid];
    if (id) answered.add(id);
  }
  return answered;
}

export function openControllingFacts(
  controlling: readonly Controlling[],
  ctx: { projectIntent: ProjectIntent | null | undefined; skippedQuestions?: readonly string[] | null },
): Controlling[] {
  const answered = answeredByIntake(ctx);
  return controlling.filter((c) => !answered.has(c.id));
}

/** The evaluation as shown to the user: same paths and questions, open facts only. */
export function evaluationAsShown<T extends ScenarioEvaluation | null>(
  evaluation: T,
  ctx: { projectIntent: ProjectIntent | null | undefined; skippedQuestions?: readonly string[] | null },
): T {
  if (!evaluation) return evaluation;
  const controlling = openControllingFacts(evaluation.controlling, ctx);
  return (controlling.length === evaluation.controlling.length ? evaluation : { ...evaluation, controlling }) as T;
}
