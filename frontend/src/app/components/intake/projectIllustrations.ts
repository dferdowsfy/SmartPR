/** Decorative project imagery only. Regulatory requirements never depend on this choice. */
export const PROJECT_ILLUSTRATIONS = {
  default: "/illustrations/projects/default.png",
  restaurant: "/illustrations/projects/restaurant.png",
  fineDining: "/illustrations/projects/fine-dining.png",
  bar: "/illustrations/projects/bar.png",
  gym: "/illustrations/projects/gym.png",
  retail: "/illustrations/projects/retail.png",
  pharmacy: "/illustrations/projects/pharmacy.png",
  autoParts: "/illustrations/projects/auto-parts.png",
  clinic: "/illustrations/projects/clinic.png",
  construction: "/illustrations/projects/construction.png",
  office: "/illustrations/projects/office.png",
  warehouse: "/illustrations/projects/warehouse.png",
  solar: "/illustrations/projects/solar-warehouse.png",
  solarWarehouse: "/illustrations/projects/solar-warehouse.png",
  hospitality: "/illustrations/projects/hospitality.png",
  luxuryHotel: "/illustrations/projects/luxury-hotel.png",
  vacationRental: "/illustrations/projects/vacation-rental.png",
  foodTruck: "/illustrations/projects/food-truck.png",
  salon: "/illustrations/projects/salon.png",
  spa: "/illustrations/projects/spa.png",
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
  /** Already validated description facts; uncertain suggestions are ignored. */
  projectContext?: Partial<Record<string, { value: string | number | boolean; confidence: number }>> | null;
  scenario?: {
    business?: { proposedActivity?: VisualFact };
    property?: { proposedUse?: VisualFact; existingUse?: VisualFact };
    project?: { type?: { value: string[]; source: string; confidence: number } };
    operations?: { activity?: VisualFact };
  } | null;
}

interface VisualFact { value: string; source: string; confidence: number }
const confirmedScenarioValue = (fact: VisualFact | undefined) =>
  fact && fact.source !== "inferred" && fact.confidence >= 0.85 ? fact.value : "";

const normalize = (value: string | null | undefined) =>
  (value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();

const matches = (value: string, terms: string[]) => terms.some((term) => value === term || value.includes(term));
const isFineDining = (value: string) => matches(value, ["fine dining", "fine-dining", "upscale restaurant", "luxury restaurant", "high-end restaurant", "high end restaurant", "gourmet restaurant", "alta cocina", "restaurante de lujo"]);
const isLuxuryHotel = (value: string) => matches(value, ["luxury hotel", "high-end hotel", "high end hotel", "upscale hotel", "boutique hotel", "five-star hotel", "5-star hotel", "luxury resort", "hotel de lujo", "hotel boutique"]);
const isVacationRental = (value: string) => matches(value, ["airbnb", "short-term rental", "short term rental", "vacation rental", "holiday rental", "guest house", "alquiler a corto plazo", "alquiler vacacional", "casa vacacional"]);

/**
 * Prefer a confirmed proposed use, then business type, over a broad industry. Never read the
 * business name or a raw transcript: an illustration must not promote an
 * uncertain mention into an asserted project fact.
 */
export function selectProjectIllustration(input: ProjectIllustrationInput): ProjectIllustration {
  const context = input.projectContext || {};
  const confirmedContext = (key: string) => {
    const fact = context[key];
    return fact && fact.confidence >= 0.85 ? fact.value : undefined;
  };
  const scenario = input.scenario;
  const proposedUse = confirmedScenarioValue(scenario?.property?.proposedUse) || String(confirmedContext("proposed_use") ?? "");
  const businessType = normalize(input.businessType);
  // The scenario groups bars/food trucks under a broad food-service use.
  // Keep the more specific confirmed business artwork within that group.
  const normalizedUse = normalize(proposedUse);
  const broadFoodServiceUse = ['restaurant', 'restaurant / food service', 'food service'].includes(normalizedUse);
  const specificBusinessType = (['bar', 'nightclub', 'food truck', 'juice bar'].includes(businessType) || isFineDining(businessType)) && broadFoodServiceUse
    || isLuxuryHotel(businessType) && ['hotel', 'hotel / lodging', 'accommodation'].includes(normalizedUse)
    || isVacationRental(businessType) && ['hotel', 'hotel / lodging', 'accommodation', 'hospitality'].includes(normalizedUse);
  const type = (specificBusinessType ? businessType : normalizedUse) || businessType || normalize(
    confirmedScenarioValue(scenario?.operations?.activity)
      || confirmedScenarioValue(scenario?.business?.proposedActivity)
      || String(confirmedContext("proposed_use") ?? confirmedContext("business_activity") ?? "")
      || confirmedScenarioValue(scenario?.property?.existingUse)
      || String(confirmedContext("existing_use") ?? confirmedContext("property_type") ?? "")
  );
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
  const hasSolarProject = matches(normalize(String(confirmedContext("generation_technology") ?? "")), ["solar", "photovoltaic", "fotovoltaic"]);
  const isWarehouse = matches(type, ["warehouse", "distribution center", "almacen"]) || location === "warehouse";

  if (["bar", "nightclub", "pub", "tavern", "cocktail lounge"].includes(type) || (type.endsWith(" bar") && type !== "juice bar")) return "bar";
  if (type === "food truck") return "foodTruck";
  if (isFineDining(type)) return "fineDining";
  if (matches(type, ["pharmacy", "drugstore", "chemist shop", "farmacia"])) return "pharmacy";
  if (matches(type, ["auto parts store", "auto parts shop", "auto parts retailer", "auto parts company", "car parts store", "automotive parts store", "tienda de autopartes", "tienda de piezas de auto", "repuestos de autos"])) return "autoParts";
  if (matches(type, ["liquor store", "grocery store", "supermarket", "convenience store"])) return "retail";
  if (matches(type, ["restaurant", "restaurante", "bakery", "cafe", "coffee shop", "catering", "ice cream shop", "juice bar", "commercial kitchen"])) return "restaurant";
  if (type === "spa" || matches(type, ["day spa", "wellness spa", "massage spa", "medical spa"])) return "spa";
  if (matches(type, ["beauty salon", "barbershop", "nail salon", "massage therapy", "esthetics", "makeup studio", "hair removal"])) return "salon";
  if (matches(type, ["medical office", "consultorio medico", "dental office", "clinic", "clinical laboratory", "laboratory", "urgent care", "mental health practice", "physical therapy", "veterinary"])) return "clinic";
  if (matches(type, ["gym", "gimnasio", "fitness center", "fitness studio", "health club", "yoga studio", "pilates studio"])) return "gym";
  if (type === "home health agency") return "office";
  if (isLuxuryHotel(type)) return "luxuryHotel";
  if (isVacationRental(type)) return "vacationRental";
  if (matches(type, ["hotel", "resort"])) return "hospitality";
  if (matches(type, ["general contractor", "electrical contractor", "plumbing contractor", "hvac contractor", "roofing contractor", "concrete contractor", "construction contractor", "real estate developer"])) return "construction";
  if (type === "utility contractor") return "construction";
  if (matches(type, ["solar installer", "battery storage installer", "renewable energy company"])) return "solar";
  if (isWarehouse && (hasSolarAnswers || hasSolarProject)) return "solarWarehouse";
  if (isWarehouse) return "warehouse";
  if (matches(type, ["manufacturing", "materials recovery", "recycling"])) return "manufacturing";
  if (matches(type, ["trucking", "courier", "moving company", "logistics", "freight forwarding", "delivery service"])) return "logistics";
  if (matches(type, ["private school", "daycare", "tutoring", "vocational school", "training company", "after-school"])) return "school";
  if (matches(type, ["auto repair", "body shop", "car wash", "tire shop", "motorcycle repair"])) return "garage";
  if (type === "car dealership") return "retail";
  if (matches(type, ["farm", "livestock", "aquaculture", "plant nursery", "agricultural services", "coffee plantation"])) return "farm";
  if (matches(type, ["dance studio", "music venue", "event venue", "theater", "art gallery", "sports facility"])) return "arts";
  if (matches(type, ["wholesale", "beverage distributor"])) return "warehouse";
  if (matches(type, ["tour operator", "travel agency", "marketing agency", "engineering firm", "architecture firm", "notary services", "translation services", "staffing agency", "cybersecurity firm", "managed services provider", "data analytics firm", "web development agency", "mortgage broker", "financial advisory firm", "investment firm", "credit services company"])) return "office";
  if (type === "religious organization" || type === "taxi service" || type === "car rental business") return "default";
  if (type.endsWith(" store") || (type.endsWith(" shop") && !matches(type, ["repair", "body", "tire"])) || matches(type, ["e-commerce", "ecommerce"])) return "retail";
  if (matches(type, ["law firm", "attorney office", "cpa firm", "consulting firm", "accounting firm", "software company", "saas company", "insurance agency", "real estate brokerage", "property management company"])) return "office";

  if (hasSolarProject) return "solar";
  const constructionTypes = scenario?.project?.type;
  if (constructionTypes && constructionTypes.source !== "inferred" && constructionTypes.confidence >= 0.85
    && constructionTypes.value.some((value) => ["renovation", "new_construction", "expansion", "demolition"].includes(value))) return "construction";
  if (["new_construction", "renovation", "expansion"].some((key) => confirmedContext(key) === true)) return "construction";

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
