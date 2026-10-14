import type { NormalizedProjectProfile, ProjectFactValue } from "./types";

export interface ExistingSmartPrProfile {
  business_stage?: "new" | "existing" | null;
  municipality?: string | null;
  industry?: string | null;
  business_type?: string | null;
  location_type?: string | null;
  business_structure?: string | null;
  number_of_employees?: number | null;
  products_manufactured?: boolean | null;
  import_export?: boolean | null;
}

/**
 * Reuse only facts the user has actually confirmed in the current intake —
 * both the base profile and any discovery answer already on record. Never
 * ask again for a fact this maps; only genuinely unanswered facts (e.g.
 * renewable-energy investment, Opportunity Zone siting) fall through to a
 * follow-up question in the incentive engine.
 */
// Food service: food is prepared for local customers (dine-in, takeout,
// local delivery), not manufactured — Act 60's food & beverage manufacturing
// decree does not cover it.
const FOOD_SERVICE = /\b(restaurant|cafe|café|coffee shop|bar|nightclub|food truck|catering|commercial kitchen|ice cream|juice bar|bakery|convenience store|grocery|supermarket|liquor store)\b/i;
const FOOD_BEVERAGE_MANUFACTURING = /\b(food|beverage)\s+manufactur/i;

/**
 * Whether the business manufactures food or beverages commercially. A food
 * & beverage manufacturing business type says so; a food-service type
 * (restaurant, cafe, bar, food truck…) does not, unless the user explicitly
 * said products are manufactured; any other manufacturing type (furniture,
 * pharma…) is manufacturing, but not of food. Unknown stays unknown.
 */
function foodBeverageManufacturing(profile: ExistingSmartPrProfile): boolean | null {
  const type = profile.business_type ?? "";
  if (FOOD_BEVERAGE_MANUFACTURING.test(type)) return true;
  if (FOOD_SERVICE.test(type)) return profile.products_manufactured === true;
  if (profile.industry === "Manufacturing" && type) return false;
  if (profile.industry === "Food & Beverage") return profile.products_manufactured ?? null;
  return type || profile.industry ? false : null;
}

export function normalizeProjectProfileForIncentives(
  profile: ExistingSmartPrProfile,
  additionalFacts: Record<string, ProjectFactValue> = {}
): NormalizedProjectProfile {
  const normalized: NormalizedProjectProfile = {
    business_type: profile.business_type ?? null,
    business_stage: profile.business_stage ?? null,
    industry: profile.industry ?? null,
    municipality: profile.municipality ?? null,
    physical_location: profile.location_type ?? null,
    entity_type: profile.business_structure ?? null,
    number_of_employees: profile.number_of_employees ?? null,
    manufacturing_activity: profile.products_manufactured ?? null,
    // Already answered during discovery (Q_IMPORT_EXPORT) — reuse it rather
    // than asking the International Trading Company follow-up question again.
    export_activity: profile.import_export ?? null,
    // The industry itself, already confirmed in intake, already implies these —
    // asking a separate yes/no would just restate a fact SmartPR already has.
    tourism_activity: profile.industry === "Accommodation & Tourism" ? true : null,
    agricultural_activity: profile.industry === "Agriculture & Farming" ? true : null,
    food_beverage_manufacturing: foodBeverageManufacturing(profile),
  };
  for (const [key, value] of Object.entries(additionalFacts)) {
    normalized[key] = value;
  }
  return normalized;
}
