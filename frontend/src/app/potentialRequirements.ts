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
export function potentialItemsForFlags(flags: string[]): PotentialDef[] {
  return ACTIVE_JURISDICTION.flagAdvisories.order
    .filter((f) => flags.includes(f) && POTENTIAL_BY_FLAG[f])
    .map((f) => POTENTIAL_BY_FLAG[f]);
}

// Add the municipality-driven items the user confirmed during intake. Keeping
// this merge pure makes the Step 1 answers the single source of truth for the
// checklist and prevents the requirements screen from mutating its own result.
export function confirmedPotentialRequirements(
  definitions: PotentialDef[],
  decisions: Record<string, PotentialDecision>
): PotentialRequirement[] {
  return definitions
    .filter((definition) => decisions[definition.flag] === "applies")
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
