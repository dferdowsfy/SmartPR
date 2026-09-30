/** Decorative project imagery only. Regulatory requirements never depend on this choice. */
export const PROJECT_ILLUSTRATIONS = {
  default: "/illustrations/projects/default.png",
  restaurant: "/illustrations/projects/restaurant.png",
  bar: "/illustrations/projects/bar.png",
  retail: "/illustrations/projects/retail.png",
  clinic: "/illustrations/projects/clinic.png",
  construction: "/illustrations/projects/construction.png",
  office: "/illustrations/projects/office.png",
  warehouse: "/illustrations/projects/warehouse.png",
  solar: "/illustrations/projects/solar.png",
  solarWarehouse: "/illustrations/projects/solar-warehouse.png",
  hospitality: "/illustrations/projects/hospitality.png",
} as const;

export type ProjectIllustration = keyof typeof PROJECT_ILLUSTRATIONS;

export interface ProjectIllustrationInput {
  businessType?: string | null;
  industry?: string | null;
  locationType?: string | null;
  answers?: Record<string, unknown> | null;
}

const normalize = (value: string | null | undefined) =>
  (value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();

const matches = (value: string, terms: string[]) => terms.some((term) => value === term || value.includes(term));

/**
 * Prefer a confirmed business type over a broad industry. Never read the
 * business name or a raw transcript: an illustration must not promote an
 * uncertain mention into an asserted project fact.
 */
export function selectProjectIllustration(input: ProjectIllustrationInput): ProjectIllustration {
  const type = normalize(input.businessType);
  const location = normalize(input.locationType);
  const answers = input.answers || {};
  const hasSolarAnswers = [
    "Q_SOLAR_MOUNTING", "solar_mounting",
    "Q_SOLAR_SIZE", "solar_size",
    "Q_SOLAR_STRUCTURE", "solar_existing_structure",
    "Q_SOLAR_BATTERY", "solar_battery",
  ].some((key) => {
    const value = answers[key];
    return typeof value === "boolean" || (typeof value === "string" && value.trim().length > 0);
  });
  const isWarehouse = matches(type, ["warehouse", "distribution center"]) || location === "warehouse";

  if (["bar", "nightclub", "pub", "tavern", "cocktail lounge"].includes(type) || (type.endsWith(" bar") && type !== "juice bar")) return "bar";
  if (matches(type, ["liquor store", "grocery store", "supermarket", "convenience store", "pharmacy", "auto parts store"])) return "retail";
  if (matches(type, ["restaurant", "bakery", "cafe", "coffee shop", "catering", "ice cream shop", "juice bar", "commercial kitchen"])) return "restaurant";
  if (matches(type, ["medical office", "dental office", "clinic", "clinical laboratory", "laboratory", "urgent care", "mental health practice", "physical therapy", "veterinary"])) return "clinic";
  if (matches(type, ["hotel", "resort", "guest house", "short-term rental", "short term rental"])) return "hospitality";
  if (matches(type, ["general contractor", "electrical contractor", "plumbing contractor", "hvac contractor", "roofing contractor", "concrete contractor", "construction contractor", "real estate developer"])) return "construction";
  if (matches(type, ["solar installer", "battery storage installer", "renewable energy company"])) return "solar";
  if (isWarehouse && hasSolarAnswers) return "solarWarehouse";
  if (isWarehouse) return "warehouse";
  if (type.endsWith(" store") || (type.endsWith(" shop") && !matches(type, ["repair", "body", "tire"])) || matches(type, ["e-commerce", "ecommerce"])) return "retail";
  if (matches(type, ["law firm", "attorney office", "cpa firm", "consulting firm", "accounting firm", "software company", "saas company", "insurance agency", "real estate brokerage", "property management company"])) return "office";

  // The industry alone is too broad to distinguish a restaurant from a bar,
  // or an energy consultant from an installed solar project.
  return "default";
}
