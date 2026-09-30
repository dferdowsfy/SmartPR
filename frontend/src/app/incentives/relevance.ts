// Which incentive-engine opportunities are worth showing on the requirements
// page. The engine lists every program the profile is not excluded from,
// including ones where nothing about the project points to the program
// (an Air and Maritime Transportation decree for a solar installer, because
// the industry is unknown and Guaynabo is inside Puerto Rico). On the page a
// program must have a real signal: its industry scope matches, or at least
// one substantive criterion is satisfied. A geography match alone is not a
// signal — every program covers Puerto Rico. The full list stays available
// in the opportunities drawer.
import type { CriterionEvaluation } from "./types";

export function isGeographyScope(c: Pick<CriterionEvaluation, "criterionId">): boolean {
  return c.criterionId.endsWith(":geography_scope");
}

export function hasRelevantSignal(o: { criteriaSatisfied: Pick<CriterionEvaluation, "criterionId">[] }): boolean {
  return o.criteriaSatisfied.some((c) => !isGeographyScope(c));
}

export function relevantIncentiveOpportunities<O extends { criteriaSatisfied: Pick<CriterionEvaluation, "criterionId">[] }>(opportunities: readonly O[]): O[] {
  return opportunities.filter(hasRelevantSignal);
}
