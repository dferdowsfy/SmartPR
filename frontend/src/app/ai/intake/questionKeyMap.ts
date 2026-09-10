// ============================================================================
// KB question id  ->  SmartPR intake answer keys.
//
// WHY THIS EXISTS
// `buildEngineInput()` (kb.ts) translates the intake into KB question answers.
// For the legacy-mapped questions it ALWAYS produces a concrete boolean, e.g.
//
//     Q_OUTDOOR_SEATING: on("outdoor_seating")   // false when unanswered
//
// so its "pass through direct KB answers" branch (`a[q.id] === undefined`)
// never fires for them. Writing `Q_OUTDOOR_SEATING: true` into the discovery
// answers would therefore be silently ignored.
//
// The AI interpreter speaks in KB question ids (the stable, validatable
// vocabulary). This table converts those ids into the exact answer keys
// `buildEngineInput()` already reads, so interpreted facts flow through the
// EXISTING engine input with no duplicated rule logic.
//
// `writeKey` is the canonical key we set; `aliases` documents the other keys
// `on(...)` accepts for the same question.
// ============================================================================

export interface QuestionKeyBinding {
  /** The discovery-answer key SmartPR writes for this KB question. */
  writeKey: string;
  /** Other keys `buildEngineInput` accepts for the same question. */
  aliases?: string[];
}

/**
 * Only questions listed here can be applied to the intake. Candidate retrieval
 * uses the same list, so the model is never offered a question SmartPR cannot
 * consume.
 */
export const QUESTION_KEY_MAP: Record<string, QuestionKeyBinding> = {
  Q_FOOD_PREPARED: { writeKey: "food_prepared_on_site", aliases: ["food_prepared_or_sold", "food_prepared"] },
  Q_FOOD_SOLD: { writeKey: "food_sold", aliases: ["food_prepared_or_sold"] },
  Q_FOOD_SERVED: { writeKey: "food_served", aliases: ["food_prepared_or_sold"] },
  Q_ALCOHOL_SOLD: { writeKey: "alcohol_sold" },
  Q_ALCOHOL_SERVED: { writeKey: "alcohol_served", aliases: ["alcohol_sold"] },
  Q_HEALTHCARE_SERVICES: { writeKey: "healthcare_services", aliases: ["healthcare_professionals", "patients_visit"] },
  Q_CONTROLLED_SUBSTANCES: { writeKey: "controlled_substances" },
  Q_MEDICAL_WASTE: { writeKey: "medical_waste" },
  Q_BIOHAZARD_WASTE: { writeKey: "biohazard_waste" },
  Q_EMPLOYEES_HIRED: { writeKey: "employees_hired", aliases: ["employees_work_on_site"] },
  Q_COMMERCIAL_VEHICLES: { writeKey: "commercial_vehicles", aliases: ["vehicles_used"] },
  Q_HAZARDOUS_MATERIALS: { writeKey: "hazardous_materials" },
  Q_HAZARDOUS_FLUIDS: { writeKey: "hazardous_fluids", aliases: ["hazardous_fluids_stored"] },
  Q_CHEMICALS_USED: { writeKey: "chemicals_used", aliases: ["chemicals_stored"] },
  Q_PRODUCTS_MANUFACTURED: { writeKey: "products_manufactured", aliases: ["products_manufactured_on_site"] },
  Q_IMPORT_EXPORT: { writeKey: "import_export" },
  Q_PROFESSIONAL_LICENSES: { writeKey: "professional_licenses_required", aliases: ["professional_licenses", "licensed_professionals"] },
  Q_COMMERCIAL_SIGNAGE: { writeKey: "commercial_signage" },
  Q_OUTDOOR_SEATING: { writeKey: "outdoor_seating" },
  Q_LIVE_ENTERTAINMENT: { writeKey: "live_entertainment" },
  Q_SHORT_TERM_RENTAL: { writeKey: "short_term_rental", aliases: ["guests_stay_overnight"] },
  Q_TOURISM_ACTIVITY: { writeKey: "tourism_activity", aliases: ["water_activities", "excursions"] },
  Q_OWNS_PROPERTY: { writeKey: "owns_property" },
  Q_EXISTING_LEASE: { writeKey: "existing_lease" },
  Q_CHILDREN_PRESENT: { writeKey: "children_present" },
  Q_PESTICIDES: { writeKey: "pesticides" },
  Q_AGRICULTURE_PRODUCTION: { writeKey: "agriculture_production", aliases: ["food_products_sold"] },
  Q_FIREARMS_SOLD: { writeKey: "firearms_sold" },
  Q_NONPROFIT_STATUS: { writeKey: "nonprofit_status" },
  Q_RENOVATIONS: { writeKey: "renovations" },
  Q_VEHICLE_REPAIR: { writeKey: "vehicle_repair", aliases: ["vehicles_repaired"] },
  Q_RENEWABLE_INSTALL: { writeKey: "renewable_install" },
  Q_SOLAR_MOUNTING: { writeKey: "solar_mounting" },
  Q_SOLAR_SIZE: { writeKey: "solar_size" },
  Q_SOLAR_STRUCTURE: { writeKey: "solar_existing_structure" },
  Q_SOLAR_OWNERSHIP: { writeKey: "solar_property_ownership" },
  Q_SOLAR_BATTERY: { writeKey: "solar_battery" },
};

/**
 * Location-derived questions. `buildEngineInput` computes these from
 * `profile.location_type`, not from a discovery-answer key, so an interpreted
 * value has to move the profile field instead. `null` means "this answer does
 * not by itself determine a location type" (we leave the profile alone).
 */
export const LOCATION_QUESTION_IDS = new Set(["Q_PHYSICAL_LOCATION", "Q_HOME_BASED", "Q_ONLINE_ONLY"]);

export function locationTypeForAnswer(questionId: string, value: boolean): string | null {
  switch (questionId) {
    case "Q_ONLINE_ONLY":
      return value ? "Online Only" : null;
    case "Q_HOME_BASED":
      return value ? "Home-Based Business" : null;
    case "Q_PHYSICAL_LOCATION":
      // "No physical location" implies online-only; "yes" leaves the specific
      // location type to the normal intake (retail vs office vs restaurant…).
      return value ? null : "Online Only";
    default:
      return null;
  }
}

/**
 * Discovery-answer key -> BusinessProfile boolean field.
 *
 * `handleQuestionAnswer()` mirrors answers onto the profile as the user goes,
 * because several downstream helpers (question filtering, follow-up context)
 * read the profile rather than the answer map. Interpreted answers take the
 * same path so AI-filled and hand-answered intakes behave identically.
 */
const PROFILE_MIRROR: Record<string, string> = {
  food_prepared_on_site: "food_prepared_or_sold",
  food_served: "food_prepared_or_sold",
  food_sold: "food_prepared_or_sold",
  alcohol_sold: "alcohol_sold",
  alcohol_served: "alcohol_sold",
  outdoor_seating: "outdoor_seating",
  live_entertainment: "live_entertainment",
  employees_hired: "employees_hired",
  healthcare_services: "healthcare_services",
  professional_licenses_required: "professional_licenses_required",
  commercial_vehicles: "vehicles_used",
  vehicle_repair: "vehicles_used",
  hazardous_materials: "hazardous_materials",
  hazardous_fluids: "hazardous_materials",
  chemicals_used: "hazardous_materials",
  controlled_substances: "hazardous_materials",
  products_manufactured: "products_manufactured",
  medical_waste: "medical_waste",
  biohazard_waste: "medical_waste",
  import_export: "import_export",
  commercial_signage: "commercial_signage",
  short_term_rental: "short_term_rental",
};

/**
 * Project interpreted discovery answers onto the BusinessProfile booleans.
 * Only `true` propagates: a profile field left untouched keeps SmartPR's
 * "unknown" state instead of asserting a negative the user never gave.
 */
export function mirrorAnswersToProfile(
  answers: Record<string, boolean | string>
): Record<string, boolean> {
  const profile: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(answers)) {
    const field = PROFILE_MIRROR[key];
    if (field && value === true) profile[field] = true;
  }
  return profile;
}

/** KB question ids the interpreter is allowed to return. */
export function applicableQuestionIds(): string[] {
  return [...Object.keys(QUESTION_KEY_MAP), ...LOCATION_QUESTION_IDS];
}

export function isApplicableQuestionId(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(QUESTION_KEY_MAP, id) || LOCATION_QUESTION_IDS.has(id);
}

// ============================================================================
// Wizard answer key  ->  KB question id
//
// `QUESTION_KEY_MAP` above answers "where do I WRITE this question's answer".
// This table answers the reverse — "which KB question is this wizard key
// about" — which is what the relationship resolver needs in order to read the
// intake as facts, and what question suppression needs in order to decide that
// a wizard question is already answered.
//
// The guided wizard uses a wider vocabulary than the interpreter does (see
// `hardcodedQuestionsForBusinessType` in page.tsx), so this table covers every
// id the wizard can show, not just the interpreter-applicable subset.
//
// Where a mapping looks lossy it is deliberately matching SmartPR's EXISTING
// semantics in `buildEngineInput()` / `handleQuestionAnswer()` — e.g.
// "will employees work on-site" has always fed Q_EMPLOYEES_HIRED.
// ============================================================================
export const WIZARD_KEY_TO_QUESTION: Record<string, string> = {
  // Location & premises
  physical_location: "Q_PHYSICAL_LOCATION",
  physical_office: "Q_PHYSICAL_OFFICE",
  services_online: "Q_ONLINE_ONLY",
  customers_visit: "Q_CUSTOMERS_VISIT",
  clients_visit: "Q_CLIENTS_VISIT",
  patients_visit: "Q_PATIENTS_VISIT",
  customers_receive_services: "Q_CUSTOMERS_RECEIVE_SERVICES",
  owns_property: "Q_OWNS_PROPERTY",
  existing_lease: "Q_EXISTING_LEASE",
  renovations: "Q_RENOVATIONS",
  commercial_signage: "Q_COMMERCIAL_SIGNAGE",

  // Employment
  employees_hired: "Q_EMPLOYEES_HIRED",
  employees_work_on_site: "Q_EMPLOYEES_HIRED",

  // Food & beverage
  food_prepared_on_site: "Q_FOOD_PREPARED",
  food_prepared: "Q_FOOD_PREPARED",
  food_sold: "Q_FOOD_SOLD",
  food_served: "Q_FOOD_SERVED",
  customers_consume_on_site: "Q_ON_SITE_CONSUMPTION",
  food_delivered: "Q_FOOD_DELIVERY",
  food_truck_or_mobile: "Q_FOOD_TRUCK_MOBILE",
  alcohol_sold: "Q_ALCOHOL_SOLD",
  alcohol_served: "Q_ALCOHOL_SERVED",
  outdoor_seating: "Q_OUTDOOR_SEATING",
  live_entertainment: "Q_LIVE_ENTERTAINMENT",

  // Healthcare
  healthcare_services: "Q_HEALTHCARE_SERVICES",
  healthcare_professionals: "Q_HEALTHCARE_SERVICES",
  diagnostic_testing: "Q_DIAGNOSTIC_TESTING",
  controlled_substances: "Q_CONTROLLED_SUBSTANCES",
  medical_waste: "Q_MEDICAL_WASTE",
  biohazard_waste: "Q_BIOHAZARD_WASTE",
  needles_or_invasive: "Q_NEEDLES_INVASIVE",

  // Hazards, chemicals, manufacturing
  hazardous_materials: "Q_HAZARDOUS_MATERIALS",
  hazardous_materials_stored: "Q_HAZARDOUS_MATERIALS",
  hazardous_materials_transported: "Q_HAZMAT_TRANSPORT",
  hazardous_fluids: "Q_HAZARDOUS_FLUIDS",
  hazardous_fluids_stored: "Q_HAZARDOUS_FLUIDS",
  chemicals_used: "Q_CHEMICALS_USED",
  chemicals_stored: "Q_CHEMICALS_USED",
  products_manufactured: "Q_PRODUCTS_MANUFACTURED",
  products_manufactured_on_site: "Q_PRODUCTS_MANUFACTURED",
  products_distributed: "Q_PRODUCTS_DISTRIBUTED",

  // Vehicles & logistics
  commercial_vehicles: "Q_COMMERCIAL_VEHICLES",
  vehicles_used: "Q_COMMERCIAL_VEHICLES",
  vehicles_repaired: "Q_VEHICLE_REPAIR",
  vehicle_repair: "Q_VEHICLE_REPAIR",
  goods_stored: "Q_GOODS_STORED",
  equipment_stored: "Q_GOODS_STORED",
  inventory_stored: "Q_INVENTORY_STORED",
  products_stored: "Q_INVENTORY_STORED",
  deliveries_made: "Q_DELIVERIES",
  import_export: "Q_IMPORT_EXPORT",

  // Retail
  hardware_sold: "Q_HARDWARE_SOLD",
  firearms_sold: "Q_FIREARMS_SOLD",

  // Tourism
  guests_stay_overnight: "Q_GUESTS_OVERNIGHT",
  short_term_rental: "Q_SHORT_TERM_RENTAL",
  tourism_activity: "Q_TOURISM_ACTIVITY",
  water_activities: "Q_WATER_ACTIVITIES",
  excursions: "Q_EXCURSIONS",

  // Education & childcare
  children_present: "Q_CHILDREN_PRESENT",
  classes_on_site: "Q_CLASSES_ON_SITE",

  // Professional / other
  licensed_professionals: "Q_PROFESSIONAL_LICENSES",
  professional_licenses: "Q_PROFESSIONAL_LICENSES",
  professional_licenses_required: "Q_PROFESSIONAL_LICENSES",
  properties_managed: "Q_PROPERTY_MANAGEMENT",
  nonprofit_status: "Q_NONPROFIT_STATUS",
  pesticides: "Q_PESTICIDES",
  agriculture_production: "Q_AGRICULTURE_PRODUCTION",
  food_products_sold: "Q_AGRICULTURE_PRODUCTION",
};

/**
 * The KB question a discovery-answer key is about.
 *
 * Accepts a wizard key, one of `QUESTION_KEY_MAP`'s write keys/aliases, or a
 * raw `Q_*` id (which the wizard uses for admin-created snapshot questions).
 * Returns `null` for compound keys with no single KB meaning — notably
 * `food_prepared_or_sold`, which conflates three different questions.
 */
export function questionIdForAnswerKey(key: string): string | null {
  if (!key) return null;
  if (key.startsWith("Q_")) return key;
  return WIZARD_KEY_TO_QUESTION[key] ?? null;
}
