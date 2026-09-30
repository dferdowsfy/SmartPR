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
  foodTruck: "/illustrations/projects/food-truck.png",
  salon: "/illustrations/projects/salon.png",
  manufacturing: "/illustrations/projects/manufacturing.png",
  logistics: "/illustrations/projects/logistics.png",
  school: "/illustrations/projects/school.png",
  garage: "/illustrations/projects/garage.png",
  farm: "/illustrations/projects/farm.png",
  arts: "/illustrations/projects/arts.png",
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
  const industry = normalize(input.industry);
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
  if (type === "food truck") return "foodTruck";
  if (matches(type, ["liquor store", "grocery store", "supermarket", "convenience store", "pharmacy", "auto parts store"])) return "retail";
  if (matches(type, ["restaurant", "bakery", "cafe", "coffee shop", "catering", "ice cream shop", "juice bar", "commercial kitchen"])) return "restaurant";
  if (matches(type, ["medical spa", "beauty salon", "barbershop", "nail salon", "massage therapy", "esthetics", "makeup studio", "hair removal", "spa"])) return "salon";
  if (matches(type, ["medical office", "dental office", "clinic", "clinical laboratory", "laboratory", "urgent care", "mental health practice", "physical therapy", "veterinary"])) return "clinic";
  if (type === "home health agency") return "office";
  if (matches(type, ["hotel", "resort", "guest house", "short-term rental", "short term rental"])) return "hospitality";
  if (matches(type, ["general contractor", "electrical contractor", "plumbing contractor", "hvac contractor", "roofing contractor", "concrete contractor", "construction contractor", "real estate developer"])) return "construction";
  if (type === "utility contractor") return "construction";
  if (matches(type, ["solar installer", "battery storage installer", "renewable energy company"])) return "solar";
  if (isWarehouse && hasSolarAnswers) return "solarWarehouse";
  if (isWarehouse) return "warehouse";
  if (matches(type, ["manufacturing", "materials recovery", "recycling"])) return "manufacturing";
  if (matches(type, ["trucking", "courier", "moving company", "logistics", "freight forwarding", "delivery service"])) return "logistics";
  if (matches(type, ["private school", "daycare", "tutoring", "vocational school", "training company", "after-school"])) return "school";
  if (matches(type, ["auto repair", "body shop", "car wash", "tire shop", "motorcycle repair"])) return "garage";
  if (type === "car dealership") return "retail";
  if (matches(type, ["farm", "livestock", "aquaculture", "plant nursery", "agricultural services", "coffee plantation"])) return "farm";
  if (matches(type, ["gym", "dance studio", "music venue", "event venue", "theater", "art gallery", "sports facility"])) return "arts";
  if (matches(type, ["wholesale", "beverage distributor"])) return "warehouse";
  if (matches(type, ["tour operator", "travel agency", "marketing agency", "engineering firm", "architecture firm", "notary services", "translation services", "staffing agency", "cybersecurity firm", "managed services provider", "data analytics firm", "web development agency", "mortgage broker", "financial advisory firm", "investment firm", "credit services company"])) return "office";
  if (type === "religious organization" || type === "taxi service" || type === "car rental business") return "default";
  if (type.endsWith(" store") || (type.endsWith(" shop") && !matches(type, ["repair", "body", "tire"])) || matches(type, ["e-commerce", "ecommerce"])) return "retail";
  if (matches(type, ["law firm", "attorney office", "cpa firm", "consulting firm", "accounting firm", "software company", "saas company", "insurance agency", "real estate brokerage", "property management company"])) return "office";

  // Only use an industry fallback once a specific type exists; "Food &
  // Beverage" by itself cannot distinguish a restaurant from a bar.
  if (type) {
    if (industry === "beauty & personal care") return "salon";
    if (industry === "manufacturing") return "manufacturing";
    if (industry === "education & training") return "school";
    if (industry === "agriculture & farming") return "farm";
    if (industry === "arts, entertainment & recreation") return "arts";
    if (industry === "wholesale distribution") return "warehouse";
    if (industry === "construction") return "construction";
    if (industry === "retail") return "retail";
    if (["professional services", "information technology", "finance & insurance", "real estate", "government contractor", "nonprofit / religious organization"].includes(industry)) return "office";
  }
  return "default";
}
