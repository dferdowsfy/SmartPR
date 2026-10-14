// ============================================================================
// Potential (conditional) requirements derived from geo (municipality) flags.
//
// These are NOT deterministic rules. They are advisory relationships: a geo flag
// suggests a document/agency review MAY apply depending on the business's
// operations. The user confirms applicability (Applies / Does Not Apply /
// Not Sure). Only "Applies" promotes an item to Mandatory.
//
// The flag->advisory mapping is jurisdiction-specific and lives in the ACTIVE
// Regulatory Knowledge Pack — this module just reads it. Rules remain
// authoritative; nothing here changes the deterministic engine.
// ============================================================================

import { ACTIVE_JURISDICTION, type FlagAdvisory } from "./jurisdictions/index.ts";

// Re-exported under the historical name so existing imports keep working.
export type PotentialDef = FlagAdvisory;
export type PotentialDecision = "applies" | "not_applies" | "not_sure";

export interface PotentialRequirement {
  code: string;
  name: string;
  mandatory: boolean;
  status: "pending";
  agency: string;
  reason: string;
  category: string;
  source_rule: string;
  /** Authoritative legal basis for the card's SOURCE row (optional; the row
   * renders "—" when absent rather than an invented citation). */
  citation?: string;
  citation_url?: string;
}

export const POTENTIAL_BY_FLAG: Record<string, PotentialDef> =
  ACTIVE_JURISDICTION.flagAdvisories.byFlag;

// Potential items for a set of geo flags, in the jurisdiction's display order.
// A jurisdiction-specific advisory replaces the generic ones it supersedes
// (San Juan's own review replaces the metro "Additional Municipal Review").
export function potentialItemsForFlags(flags: string[]): PotentialDef[] {
  const present = ACTIVE_JURISDICTION.flagAdvisories.order
    .filter((f) => flags.includes(f) && POTENTIAL_BY_FLAG[f])
    .map((f) => POTENTIAL_BY_FLAG[f]);
  const superseded = new Set(present.flatMap((d) => d.supersedes ?? []));
  return present.filter((d) => !superseded.has(d.flag));
}

// The advisories the user is asked about: an auto-applying advisory is
// settled by the location itself and never becomes a question.
export function potentialQuestionsFor(definitions: PotentialDef[]): PotentialDef[] {
  return definitions.filter((d) => !d.autoApplies);
}

/** The decision that counts for an advisory: auto-applying ones always apply. */
export function effectivePotentialDecision(
  definition: PotentialDef,
  decisions: Record<string, PotentialDecision>
): PotentialDecision | undefined {
  return definition.autoApplies ? "applies" : decisions[definition.flag];
}

// Add the municipality-driven items the user confirmed during intake. Keeping
// this merge pure makes the Step 1 answers the single source of truth for the
// checklist and prevents the requirements screen from mutating its own result.
export function confirmedPotentialRequirements(
  definitions: PotentialDef[],
  decisions: Record<string, PotentialDecision>
): PotentialRequirement[] {
  return definitions
    .filter((definition) => effectivePotentialDecision(definition, decisions) === "applies")
    .map((definition) => ({
      code: `potential_${definition.flag}`,
      name: definition.document,
      mandatory: true,
      status: "pending" as const,
      agency: definition.agency,
      reason: definition.why,
      category: "Potentially Required",
      source_rule: `flag:${definition.flag}`,
      citation: definition.citation,
      citation_url: definition.citation_url,
    }));
}

export function mergeConfirmedPotentialRequirements<T extends { code: string }>(
  requirements: T[],
  definitions: PotentialDef[],
  decisions: Record<string, PotentialDecision>
): Array<T | PotentialRequirement> {
  const existingCodes = new Set(requirements.map((requirement) => requirement.code));
  const confirmed = confirmedPotentialRequirements(definitions, decisions)
    .filter((requirement) => !existingCodes.has(requirement.code));
  return [...requirements, ...confirmed];
}
