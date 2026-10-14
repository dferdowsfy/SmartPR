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

/** Controlling-fact ids the intake's own Project choice answers. */
export function answeredByIntake(ctx: { projectIntent: ProjectIntent | null | undefined }): Set<string> {
  const answered = new Set<string>();
  // New business / Existing business / Project only each settle "existing or new?".
  if (ctx.projectIntent) answered.add("business_status");
  return answered;
}

export function openControllingFacts(controlling: readonly Controlling[], ctx: { projectIntent: ProjectIntent | null | undefined }): Controlling[] {
  const answered = answeredByIntake(ctx);
  return controlling.filter((c) => !answered.has(c.id));
}

/** The evaluation as shown to the user: same paths and questions, open facts only. */
export function evaluationAsShown<T extends ScenarioEvaluation | null>(evaluation: T, ctx: { projectIntent: ProjectIntent | null | undefined }): T {
  if (!evaluation) return evaluation;
  const controlling = openControllingFacts(evaluation.controlling, ctx);
  return (controlling.length === evaluation.controlling.length ? evaluation : { ...evaluation, controlling }) as T;
}
