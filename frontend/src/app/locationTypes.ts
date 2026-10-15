// ============================================================================
// Canonical location-type semantics.
//
// The intake offers location-type labels from two lists: a generic one
// ("Online / Remote Only") and per-business-type ones ("Online Only"). Both
// mean the same thing, and BOTH the rules-engine adapter (kb.ts) and the intake
// relationship registry (ai/intake/relationshipRegistry.ts) have to agree on
// which labels carry which meaning — otherwise the same business resolves
// differently depending on which dropdown the user picked from.
//
// This module has no dependencies on purpose, so both sides can import it.
// ============================================================================

/** Labels that mean "no physical premises at all". */
export const ONLINE_ONLY_LOCATION_TYPES = [
  "Online Only",
  "Online / Remote Only",
  "Online",
  "Remote Only",
];

/** Labels that mean "operated from a home" (which IS a physical location). */
export const HOME_BASED_LOCATION_TYPES = ["Home-Based Business", "Home Based Business"];

/**
 * Labels that mean "mobile business" — the business operates from a vehicle
 * or at customer locations and has NO fixed commercial premises.
 * REG-MOBILE-PHYSICAL-001 (2026-09-22 QA): for permit rules a mobile
 * business is not a "nonresidential commercial premises" (same class as the
 * home-based REG-HOME-PHYSICAL-001 correction). "Mobile / Food Truck" is
 * included so the canonical semantics cover the food-truck label too — the
 * permit-model correction deliberately EXEMPTS the food-truck case (see
 * applyPermitModelCorrections) to preserve the Darius-validated G10
 * posture (Permiso Único REQUIRED for a mobile food unit).
 */
export const MOBILE_LOCATION_TYPES = ["Mobile Business", "Mobile / Food Truck", "Mobile"];

const canon = (value: string | null | undefined) => (value || "").trim().toLowerCase();

const ONLINE_ONLY_SET = new Set(ONLINE_ONLY_LOCATION_TYPES.map(canon));
const HOME_BASED_SET = new Set(HOME_BASED_LOCATION_TYPES.map(canon));
const MOBILE_SET = new Set(MOBILE_LOCATION_TYPES.map(canon));

export function isOnlineOnlyLocation(locationType: string | null | undefined): boolean {
  return ONLINE_ONLY_SET.has(canon(locationType));
}

export function isHomeBasedLocation(locationType: string | null | undefined): boolean {
  return HOME_BASED_SET.has(canon(locationType));
}

export function isMobileLocation(locationType: string | null | undefined): boolean {
  return MOBILE_SET.has(canon(locationType));
}

/**
 * Location-type labels that mean the same premises but are spelled
 * differently in the generic list and the per-business-type lists.
 * J1 (Run 7 live, Cidra pizzeria, 2026-10-15): the description prefilled
 * "Restaurant / Food Service Location" from the generic list; picking the
 * business type "Restaurant" then silently cleared it, because that type's
 * list calls the same thing "Restaurant Location".
 */
const LOCATION_TYPE_ALIAS_GROUPS: readonly (readonly string[])[] = [
  ["Restaurant / Food Service Location", "Restaurant Location", "Restaurant / Food Service"],
  ["Online / Remote Only", "Online Only", "Online", "Remote Only"],
  ["Shared Workspace / Coworking", "Shared Workspace"],
  ["Home-Based Business", "Home Based Business"],
];

/**
 * The label in `allowed` that means the same as `current`: `current` itself
 * when allowed, otherwise an equivalent spelling the list offers, else "".
 */
export function locationTypeInAllowed(current: string | null | undefined, allowed: readonly string[]): string {
  const value = (current || "").trim();
  if (!value) return "";
  if (allowed.includes(value)) return value;
  const group = LOCATION_TYPE_ALIAS_GROUPS.find((g) => g.some((label) => canon(label) === canon(value)));
  if (!group) return "";
  return allowed.find((option) => group.some((label) => canon(label) === canon(option))) ?? "";
}
