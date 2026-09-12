// ============================================================================
// The SmartPR intake relationship registry.
//
// Every deterministic relationship between intake facts lives HERE, as data.
// Nothing in this file executes; ./relationships.ts is the machine that reads
// it. Keeping the relationships declarative is the point: they are reviewable,
// diffable and testable, and the AI can never invent one at runtime.
//
// RULES FOR ADDING A RELATIONSHIP
//
// 1. `deterministic` means "given SmartPR's data model, the target CANNOT be
//    anything else". If you can describe a real business where the target is
//    false, it is `strong_inference` (recorded, not applied) or it does not
//    belong here at all.
// 2. Never encode a regulatory conclusion. `Q_ALCOHOL_SERVED = true` is a fact;
//    "therefore an alcohol licence is required" is rules.json's job.
// 3. Business types may only assert what is DEFINITIONAL. A daycare has
//    children; a restaurant does NOT necessarily serve alcohol, have outdoor
//    seating, host live entertainment, or hire employees.
// 4. Negatives propagate far less freely than positives. "Alcohol is not sold"
//    does not mean "alcohol is not served".
// ============================================================================

import type { FactContradiction, IntakeRelationship } from "./relationships.ts";
// The rules-engine adapter reads the SAME lists, so a location type resolves
// identically whichever of the intake's two dropdowns it came from.
import { ONLINE_ONLY_LOCATION_TYPES, HOME_BASED_LOCATION_TYPES } from "../../locationTypes.ts";

export { ONLINE_ONLY_LOCATION_TYPES, HOME_BASED_LOCATION_TYPES };

// --- Shared vocabularies ----------------------------------------------------

/** KB industry id -> the industry label the intake dropdown offers. */
export const INDUSTRY_NAME_ALIASES: Record<string, string> = {
  IND_FOOD: "Food & Beverage",
  IND_HEALTH: "Healthcare",
  IND_PROF: "Professional Services",
  IND_IT: "Information Technology",
  IND_RETAIL: "Retail",
  IND_CONSTRUCTION: "Construction",
  IND_TOURISM: "Accommodation & Tourism",
  IND_BEAUTY: "Beauty & Personal Care",
  IND_MANUFACTURING: "Manufacturing",
  IND_TRANSPORT: "Transportation & Logistics",
  IND_EDUCATION: "Education & Training",
  IND_REALESTATE: "Real Estate",
  IND_AUTOMOTIVE: "Automotive",
  IND_AGRICULTURE: "Agriculture & Farming",
  IND_FINANCE: "Finance & Insurance",
  IND_ENERGY: "Energy & Utilities",
  IND_WHOLESALE: "Wholesale Distribution",
  IND_ARTS: "Arts, Entertainment & Recreation",
  IND_GOVCON: "Government Contractor",
  IND_NONPROFIT: "Nonprofit / Religious Organization",
};

const EMPLOYEE_BUCKETS_WITH_STAFF = ["1-5", "6-20", "21-50", "50+"];
const FLEET_BUCKETS_WITH_VEHICLES = ["1-3", "4-10", "10+"];
const SIGNAGE_TYPES_WITH_SIGN = ["Wall Sign", "Freestanding Sign", "Illuminated Sign", "Digital Sign"];
const PHYSICAL_KB_LOCATION_TYPES = ["Commercial Facility", "Industrial Facility"];

// --- Small builders keep the registry readable ------------------------------

const det = (
  target: string,
  value: unknown,
  relationship: IntakeRelationship["effects"][number]["relationship"] = "IMPLIES"
): IntakeRelationship["effects"][number] => ({
  target: { type: "question", key: target },
  value,
  certainty: "deterministic",
  relationship,
});

const maybe = (
  target: string,
  value: unknown,
  relationship: IntakeRelationship["effects"][number]["relationship"] = "IMPLIES"
): IntakeRelationship["effects"][number] => ({
  target: { type: "question", key: target },
  value,
  certainty: "strong_inference",
  relationship,
});

/** A business type that definitionally answers one or more questions. */
function fromBusinessType(
  id: string,
  businessTypeId: string,
  effects: IntakeRelationship["effects"],
  note: string
): IntakeRelationship {
  return {
    id,
    source: { type: "business_type", key: businessTypeId },
    condition: { operator: "truthy" },
    effects,
    note,
  };
}

/** A boolean question that, when true, definitionally answers another. */
function whenTrue(
  id: string,
  questionId: string,
  effects: IntakeRelationship["effects"],
  note: string
): IntakeRelationship {
  return {
    id,
    source: { type: "question", key: questionId },
    condition: { operator: "equals", value: true },
    effects,
    note,
  };
}

/** Questions that cannot be true without somewhere to do them. */
const PHYSICAL_PRESENCE_QUESTIONS: Array<[string, string]> = [
  ["Q_OUTDOOR_SEATING", "Outdoor seating occupies premises."],
  ["Q_ON_SITE_CONSUMPTION", "Consuming food on-site requires a site."],
  ["Q_PATIENTS_VISIT", "Patients cannot visit an online-only operation."],
  ["Q_CUSTOMERS_VISIT", "Customers cannot visit an online-only operation."],
  ["Q_CLIENTS_VISIT", "Clients cannot visit an online-only operation."],
  ["Q_PHYSICAL_OFFICE", "A physical office is a physical location."],
  ["Q_CLASSES_ON_SITE", "On-site classes require a site."],
  ["Q_CHILDREN_PRESENT", "Children present at the location implies a location."],
  ["Q_CUSTOMERS_RECEIVE_SERVICES", "On-site personal-care services require premises."],
  ["Q_PARKING_PROVIDED", "Customer parking belongs to a physical site."],
  ["Q_COMMERCIAL_KITCHEN", "A commercial kitchen is a physical facility."],
  ["Q_FOOD_PREPARED", "Preparing food on-site requires a site."],
  ["Q_PRODUCTS_MANUFACTURED", "Manufacturing on-site requires a site."],
  ["Q_LIVE_ENTERTAINMENT", "Live entertainment happens at a venue."],
  ["Q_COMMERCIAL_SIGNAGE", "Commercial signage is mounted at premises."],
  ["Q_RENOVATIONS", "Construction at the location implies a location."],
  ["Q_GUESTS_OVERNIGHT", "Overnight guests stay somewhere physical."],
  ["Q_OWNS_PROPERTY", "Owning the operating property implies a physical location."],
  ["Q_EXISTING_LEASE", "Leasing commercial space implies a physical location."],
];

// ============================================================================
// THE REGISTRY
// ============================================================================

export const INTAKE_RELATIONSHIPS: IntakeRelationship[] = [
  // ==========================================================================
  // A. QUANTITY -> EXISTENCE, and quantity -> the KB's count bucket
  // ==========================================================================
  {
    id: "REL_EMPLOYEE_COUNT_IMPLIES_EMPLOYEES",
    source: { type: "profile", key: "number_of_employees" },
    condition: { operator: "greater_than", value: 0 },
    effects: [det("Q_EMPLOYEES_HIRED", true)],
    note: "A headcount above zero means employees are hired. Never ask again.",
  },
  {
    id: "REL_EMPLOYEE_COUNT_ZERO_IMPLIES_NO_EMPLOYEES",
    source: { type: "profile", key: "number_of_employees" },
    condition: { operator: "equals", value: 0 },
    effects: [det("Q_EMPLOYEES_HIRED", false, "IMPLIES_FALSE")],
    note: "\"No employees\" is an explicit negative, not missing information.",
  },
  {
    id: "REL_EMPLOYEE_COUNT_BUCKET",
    source: { type: "profile", key: "number_of_employees" },
    condition: { operator: "is_number" },
    effects: [
      {
        target: { type: "question", key: "Q_EMPLOYEE_COUNT" },
        derive: { kind: "count_bucket" },
        certainty: "deterministic",
        relationship: "DERIVED_VALUE",
      },
    ],
    note: "10 employees is the \"6-20\" bucket — the same fact in the KB's units.",
  },
  {
    id: "REL_EMPLOYEE_BUCKET_IMPLIES_EMPLOYEES",
    source: { type: "question", key: "Q_EMPLOYEE_COUNT" },
    condition: { operator: "in", value: EMPLOYEE_BUCKETS_WITH_STAFF },
    effects: [det("Q_EMPLOYEES_HIRED", true)],
    note: "Any non-zero staffing bucket answers the hiring question.",
  },
  {
    id: "REL_EMPLOYEE_BUCKET_ZERO_IMPLIES_NO_EMPLOYEES",
    source: { type: "question", key: "Q_EMPLOYEE_COUNT" },
    condition: { operator: "equals", value: "0" },
    effects: [det("Q_EMPLOYEES_HIRED", false, "IMPLIES_FALSE")],
    note: "The '0' employee-count bucket means nobody is employed.",
  },

  {
    id: "REL_VEHICLE_COUNT_IMPLIES_COMMERCIAL_VEHICLES",
    source: { type: "profile", key: "number_of_vehicles" },
    condition: { operator: "greater_than", value: 0 },
    effects: [det("Q_COMMERCIAL_VEHICLES", true)],
    note: "Three delivery vans means commercial vehicles are operated.",
  },
  {
    id: "REL_VEHICLE_COUNT_ZERO_IMPLIES_NO_VEHICLES",
    source: { type: "profile", key: "number_of_vehicles" },
    condition: { operator: "equals", value: 0 },
    effects: [det("Q_COMMERCIAL_VEHICLES", false, "IMPLIES_FALSE")],
    note: "A vehicle count of zero means no commercial vehicles are operated.",
  },
  {
    id: "REL_VEHICLE_COUNT_BUCKET",
    source: { type: "profile", key: "number_of_vehicles" },
    condition: { operator: "is_number" },
    effects: [
      {
        target: { type: "question", key: "Q_FLEET_SIZE" },
        derive: { kind: "count_bucket" },
        certainty: "deterministic",
        relationship: "DERIVED_VALUE",
      },
    ],
    note: "A numeric vehicle count maps to the matching fleet-size bucket.",
  },
  {
    id: "REL_FLEET_SIZE_IMPLIES_COMMERCIAL_VEHICLES",
    source: { type: "question", key: "Q_FLEET_SIZE" },
    condition: { operator: "in", value: FLEET_BUCKETS_WITH_VEHICLES },
    effects: [det("Q_COMMERCIAL_VEHICLES", true)],
    note: "Any non-zero fleet bucket means commercial vehicles are operated.",
  },
  {
    id: "REL_FLEET_SIZE_ZERO_IMPLIES_NO_VEHICLES",
    source: { type: "question", key: "Q_FLEET_SIZE" },
    condition: { operator: "equals", value: "0" },
    effects: [det("Q_COMMERCIAL_VEHICLES", false, "IMPLIES_FALSE")],
    note: "The '0' fleet-size bucket means no commercial vehicles are operated.",
  },

  {
    id: "REL_RENTAL_UNIT_COUNT_BUCKET",
    source: { type: "profile", key: "number_of_rental_units" },
    condition: { operator: "greater_than", value: 0 },
    effects: [
      {
        target: { type: "question", key: "Q_RENTAL_UNITS" },
        derive: { kind: "count_bucket" },
        certainty: "deterministic",
        relationship: "DERIVED_VALUE",
      },
    ],
    note:
      "The unit count is the same fact in the KB's units. It does NOT by itself " +
      "mean short-term rental — long-term landlords count units too. That comes " +
      "from the business type.",
  },

  // ==========================================================================
  // B. LOCATION — the mutually exclusive core of the intake
  //
  // SmartPR's model is binary: physical location and online-only are exact
  // complements, and a home-based business IS a physical location.
  // ==========================================================================
  {
    id: "REL_LOCATION_TYPE_ONLINE_ONLY",
    source: { type: "profile", key: "location_type" },
    condition: { operator: "in", value: ONLINE_ONLY_LOCATION_TYPES },
    effects: [
      det("Q_ONLINE_ONLY", true),
      det("Q_PHYSICAL_LOCATION", false, "MUTUALLY_EXCLUSIVE"),
      det("Q_HOME_BASED", false, "MUTUALLY_EXCLUSIVE"),
    ],
    note: "Both spellings the intake offers for online-only land here.",
  },
  {
    id: "REL_LOCATION_TYPE_HOME_BASED",
    source: { type: "profile", key: "location_type" },
    condition: { operator: "in", value: HOME_BASED_LOCATION_TYPES },
    effects: [
      det("Q_HOME_BASED", true),
      det("Q_PHYSICAL_LOCATION", true, "PARENT_CHILD"),
      det("Q_ONLINE_ONLY", false, "MUTUALLY_EXCLUSIVE"),
    ],
    note: "A home IS a physical location in SmartPR's model.",
  },
  {
    id: "REL_LOCATION_TYPE_PHYSICAL",
    source: { type: "profile", key: "location_type" },
    condition: { operator: "not_in", value: ONLINE_ONLY_LOCATION_TYPES },
    effects: [
      det("Q_PHYSICAL_LOCATION", true),
      det("Q_ONLINE_ONLY", false, "MUTUALLY_EXCLUSIVE"),
    ],
    note: "Any named location type other than online-only is physical premises.",
  },
  {
    id: "REL_KB_LOCATION_TYPE_ONLINE",
    source: { type: "question", key: "Q_LOCATION_TYPE" },
    condition: { operator: "equals", value: "Online Only" },
    effects: [
      det("Q_ONLINE_ONLY", true),
      det("Q_PHYSICAL_LOCATION", false, "MUTUALLY_EXCLUSIVE"),
      det("Q_HOME_BASED", false, "MUTUALLY_EXCLUSIVE"),
    ],
    note: "'Online Only' is definitionally not a physical or home-based location.",
  },
  {
    id: "REL_KB_LOCATION_TYPE_HOME",
    source: { type: "question", key: "Q_LOCATION_TYPE" },
    condition: { operator: "equals", value: "Home-Based Business" },
    effects: [
      det("Q_HOME_BASED", true),
      det("Q_PHYSICAL_LOCATION", true, "PARENT_CHILD"),
      det("Q_ONLINE_ONLY", false, "MUTUALLY_EXCLUSIVE"),
    ],
    note: "A home-based business operates from a physical (home) location and is not online-only.",
  },
  {
    id: "REL_KB_LOCATION_TYPE_FACILITY",
    source: { type: "question", key: "Q_LOCATION_TYPE" },
    condition: { operator: "in", value: PHYSICAL_KB_LOCATION_TYPES },
    effects: [
      det("Q_PHYSICAL_LOCATION", true),
      det("Q_ONLINE_ONLY", false, "MUTUALLY_EXCLUSIVE"),
      det("Q_HOME_BASED", false, "MUTUALLY_EXCLUSIVE"),
    ],
    note: "A commercial or industrial facility is a physical location, not online-only or home-based.",
  },
  whenTrue(
    "REL_ONLINE_ONLY_EXCLUDES_PHYSICAL",
    "Q_ONLINE_ONLY",
    [
      det("Q_PHYSICAL_LOCATION", false, "MUTUALLY_EXCLUSIVE"),
      det("Q_HOME_BASED", false, "MUTUALLY_EXCLUSIVE"),
    ],
    "Online-only and physical premises cannot both be true."
  ),
  whenTrue(
    "REL_HOME_BASED_IS_PHYSICAL",
    "Q_HOME_BASED",
    [det("Q_PHYSICAL_LOCATION", true, "PARENT_CHILD"), det("Q_ONLINE_ONLY", false, "MUTUALLY_EXCLUSIVE")],
    "Home-based businesses operate from a physical place."
  ),
  whenTrue(
    "REL_PHYSICAL_EXCLUDES_ONLINE_ONLY",
    "Q_PHYSICAL_LOCATION",
    [det("Q_ONLINE_ONLY", false, "MUTUALLY_EXCLUSIVE")],
    "Physical premises means the business is not online-only."
  ),
  {
    id: "REL_NO_PHYSICAL_LOCATION_IS_ONLINE_ONLY",
    source: { type: "question", key: "Q_PHYSICAL_LOCATION" },
    condition: { operator: "equals", value: false },
    effects: [
      det("Q_ONLINE_ONLY", true, "MUTUALLY_EXCLUSIVE"),
      det("Q_HOME_BASED", false, "MUTUALLY_EXCLUSIVE"),
    ],
    note: "SmartPR treats physical and online-only as exact complements.",
  },

  // --- C. CHILD -> PARENT: activities that presuppose premises --------------
  ...PHYSICAL_PRESENCE_QUESTIONS.map(([questionId, note]) =>
    whenTrue(
      `REL_${questionId.replace(/^Q_/, "")}_IMPLIES_PHYSICAL_LOCATION`,
      questionId,
      [det("Q_PHYSICAL_LOCATION", true, "PARENT_CHILD")],
      note
    )
  ),
  whenTrue(
    "REL_INVENTORY_SUGGESTS_PHYSICAL_LOCATION",
    "Q_INVENTORY_STORED",
    [maybe("Q_PHYSICAL_LOCATION", true, "PARENT_CHILD")],
    "Usually premises — but an online seller can use a third-party warehouse, so this is not certain."
  ),
  whenTrue(
    "REL_GOODS_STORED_SUGGESTS_PHYSICAL_LOCATION",
    "Q_GOODS_STORED",
    [maybe("Q_PHYSICAL_LOCATION", true, "PARENT_CHILD")],
    "Storage may be outsourced; likely but not certain."
  ),

  // ==========================================================================
  // D. SPECIFIC ACTIVITY -> BROADER ACTIVITY
  //
  // Only where the broader fact CANNOT be false given the specific one.
  // ==========================================================================
  whenTrue(
    "REL_ON_SITE_CONSUMPTION_IMPLIES_FOOD_SERVED",
    "Q_ON_SITE_CONSUMPTION",
    [det("Q_FOOD_SERVED", true)],
    "Customers eating on-site are being served food."
  ),
  whenTrue(
    "REL_COMMERCIAL_KITCHEN_IMPLIES_FOOD_PREPARED",
    "Q_COMMERCIAL_KITCHEN",
    [det("Q_FOOD_PREPARED", true)],
    "A commercial kitchen exists to prepare food."
  ),
  whenTrue(
    "REL_FOOD_DELIVERY_SUGGESTS_FOOD_SOLD",
    "Q_FOOD_DELIVERY",
    [maybe("Q_FOOD_SOLD", true)],
    "Delivered food is normally sold, but a charity meal service is not selling."
  ),
  whenTrue(
    "REL_PATIENTS_VISIT_IMPLIES_HEALTHCARE",
    "Q_PATIENTS_VISIT",
    [det("Q_HEALTHCARE_SERVICES", true)],
    "Patients (not clients or customers) means healthcare is provided."
  ),
  whenTrue(
    "REL_DIAGNOSTIC_TESTING_IMPLIES_HEALTHCARE",
    "Q_DIAGNOSTIC_TESTING",
    [det("Q_HEALTHCARE_SERVICES", true)],
    "Diagnostic testing is a healthcare service."
  ),
  whenTrue(
    "REL_NEEDLES_SUGGEST_BIOHAZARD_WASTE",
    "Q_NEEDLES_INVASIVE",
    [maybe("Q_BIOHAZARD_WASTE", true)],
    "Sharps normally produce regulated waste — likely, but we let the user confirm."
  ),
  whenTrue(
    "REL_HAZARDOUS_FLUIDS_IMPLY_HAZARDOUS_MATERIALS",
    "Q_HAZARDOUS_FLUIDS",
    [det("Q_HAZARDOUS_MATERIALS", true)],
    "Hazardous fluids ARE hazardous materials (SmartPR already treats them as one)."
  ),
  whenTrue(
    "REL_CHEMICALS_IMPLY_HAZARDOUS_MATERIALS",
    "Q_CHEMICALS_USED",
    [det("Q_HAZARDOUS_MATERIALS", true)],
    "Mirrors SmartPR's existing profile mapping for stored chemicals."
  ),
  whenTrue(
    "REL_HAZMAT_TRANSPORT_IMPLIES_HAZARDOUS_MATERIALS",
    "Q_HAZMAT_TRANSPORT",
    [det("Q_HAZARDOUS_MATERIALS", true)],
    "Transporting hazardous materials means handling them."
  ),
  whenTrue(
    "REL_HAZARDOUS_STORAGE_IMPLIES_HAZARDOUS_MATERIALS",
    "Q_HAZARDOUS_STORAGE",
    [det("Q_HAZARDOUS_MATERIALS", true)],
    "Dedicated hazardous storage presupposes hazardous materials."
  ),
  whenTrue(
    "REL_FUEL_SOLD_IMPLIES_HAZARDOUS_FLUIDS",
    "Q_FUEL_SOLD",
    [det("Q_HAZARDOUS_FLUIDS", true)],
    "Fuel is a hazardous fluid, stored and handled on-site."
  ),
  whenTrue(
    "REL_VEHICLE_REPAIR_SUGGESTS_HAZARDOUS_FLUIDS",
    "Q_VEHICLE_REPAIR",
    [maybe("Q_HAZARDOUS_FLUIDS", true)],
    "Most shops handle oils and solvents — likely, not certain."
  ),
  whenTrue(
    "REL_PESTICIDES_SUGGEST_CHEMICALS",
    "Q_PESTICIDES",
    [maybe("Q_CHEMICALS_USED", true)],
    "Agrochemicals are chemicals, but the KB question is scoped to production use."
  ),
  whenTrue(
    "REL_CUSTOMS_BROKER_IMPLIES_IMPORT_EXPORT",
    "Q_CUSTOMS_BROKER",
    [det("Q_IMPORT_EXPORT", true)],
    "A customs broker is only used for import/export activity."
  ),
  whenTrue(
    "REL_WATER_ACTIVITIES_IMPLY_TOURISM",
    "Q_WATER_ACTIVITIES",
    [det("Q_TOURISM_ACTIVITY", true)],
    "Mirrors buildEngineInput()'s existing tourism aggregation."
  ),
  whenTrue(
    "REL_EXCURSIONS_IMPLY_TOURISM",
    "Q_EXCURSIONS",
    [det("Q_TOURISM_ACTIVITY", true)],
    "Mirrors buildEngineInput()'s existing tourism aggregation."
  ),
  whenTrue(
    "REL_LIVESTOCK_IMPLIES_AGRICULTURE",
    "Q_LIVESTOCK",
    [det("Q_AGRICULTURE_PRODUCTION", true)],
    "Raising livestock is agricultural production."
  ),
  {
    id: "REL_LICENSE_TYPES_IMPLY_PROFESSIONAL_LICENSES",
    source: { type: "question", key: "Q_LICENSE_TYPES" },
    condition: { operator: "non_empty" },
    effects: [det("Q_PROFESSIONAL_LICENSES", true, "REQUIRES_VALUE")],
    note: "Naming which licences apply answers whether any apply (multi_select).",
  },
  {
    id: "REL_SIGNAGE_TYPE_IMPLIES_SIGNAGE",
    source: { type: "question", key: "Q_SIGNAGE_TYPE" },
    condition: { operator: "in", value: SIGNAGE_TYPES_WITH_SIGN },
    effects: [det("Q_COMMERCIAL_SIGNAGE", true, "REQUIRES_VALUE")],
    note: "Choosing a sign type means the business has commercial signage.",
  },
  {
    id: "REL_SIGNAGE_TYPE_NONE_IMPLIES_NO_SIGNAGE",
    source: { type: "question", key: "Q_SIGNAGE_TYPE" },
    condition: { operator: "equals", value: "None" },
    effects: [det("Q_COMMERCIAL_SIGNAGE", false, "IMPLIES_FALSE")],
    note: "Choosing 'None' means the business has no commercial signage.",
  },

  // ==========================================================================
  // E. ENTITY STRUCTURE -> the questions that restate it
  // ==========================================================================
  {
    id: "REL_BUSINESS_STRUCTURE_TO_KB_QUESTION",
    source: { type: "profile", key: "business_structure" },
    condition: { operator: "non_empty" },
    effects: [
      {
        target: { type: "question", key: "Q_BUSINESS_STRUCTURE" },
        derive: {
          kind: "value_map",
          map: {
            llc: "LLC",
            corporation: "Corporation",
            close_corporation: "Corporation",
            foreign_corporation: "Corporation",
            nonprofit_nonstock_corporation: "Corporation",
            professional_corporation: "Professional Corporation",
            sole_proprietorship: "Sole Proprietorship",
            partnership: "Partnership",
            limited_liability_partnership: "Partnership",
            other: "Other",
          },
        },
        certainty: "deterministic",
        relationship: "DERIVED_VALUE",
      },
    ],
    note: "The intake's entity picker and the KB question are the same fact.",
  },
  {
    id: "REL_FOREIGN_CORPORATION",
    source: { type: "profile", key: "business_structure" },
    condition: { operator: "equals", value: "foreign_corporation" },
    effects: [det("Q_ENTITY_FOREIGN_CORP", true)],
    note: "A foreign-corporation structure is definitionally a foreign corporation.",
  },
  {
    id: "REL_LIMITED_LIABILITY_PARTNERSHIP",
    source: { type: "profile", key: "business_structure" },
    condition: { operator: "equals", value: "limited_liability_partnership" },
    effects: [det("Q_ENTITY_LLP", true)],
    note: "An LLP structure is definitionally a limited liability partnership.",
  },
  {
    id: "REL_NONPROFIT_STRUCTURE",
    source: { type: "profile", key: "business_structure" },
    condition: { operator: "equals", value: "nonprofit_nonstock_corporation" },
    effects: [det("Q_NONPROFIT_STATUS", true)],
    note: "A nonprofit non-stock corporation is definitionally a nonprofit.",
  },

  // ==========================================================================
  // F. BUSINESS TYPE — industry, plus DEFINITIONAL facts only
  // ==========================================================================
  {
    id: "REL_BUSINESS_TYPE_DERIVES_INDUSTRY",
    source: { type: "profile", key: "business_type_id" },
    condition: { operator: "non_empty" },
    effects: [
      {
        target: { type: "profile", key: "industry" },
        derive: { kind: "kb_industry" },
        certainty: "deterministic",
        relationship: "DERIVED_VALUE",
      },
    ],
    note: "Each KB business type belongs to exactly one industry — a lookup, not a guess.",
  },

  // --- Food & beverage ------------------------------------------------------
  fromBusinessType("REL_BT_BAR", "BT_BAR", [det("Q_ALCOHOL_SERVED", true), det("Q_ALCOHOL_SOLD", true)],
    "A bar exists to serve and sell alcohol — definitional, unlike a restaurant."),
  fromBusinessType("REL_BT_RESTAURANT", "BT_RESTAURANT",
    [det("Q_FOOD_SERVED", true), det("Q_FOOD_SOLD", true), maybe("Q_FOOD_PREPARED", true)],
    "A restaurant serves and sells food. It does NOT definitionally serve alcohol, " +
    "have outdoor seating, host live entertainment, or hire employees."),
  fromBusinessType("REL_BT_FAST_FOOD", "BT_FAST_FOOD_RESTAURANT",
    [det("Q_FOOD_SERVED", true), det("Q_FOOD_SOLD", true), maybe("Q_FOOD_PREPARED", true)], "Serves and sells food."),
  fromBusinessType("REL_BT_CAFE", "BT_CAFE",
    [det("Q_FOOD_SERVED", true), det("Q_FOOD_SOLD", true)], "Serves and sells food and drink."),
  fromBusinessType("REL_BT_BAKERY", "BT_BAKERY",
    [det("Q_FOOD_PREPARED", true), det("Q_FOOD_SOLD", true)], "A bakery bakes and sells what it bakes."),
  fromBusinessType("REL_BT_FOOD_TRUCK", "BT_FOOD_TRUCK",
    [det("Q_FOOD_TRUCK_MOBILE", true), det("Q_FOOD_SOLD", true)], "A food truck IS a mobile food unit."),
  fromBusinessType("REL_BT_CATERING", "BT_CATERING_BUSINESS",
    [det("Q_FOOD_PREPARED", true), det("Q_FOOD_SERVED", true)], "Catering prepares and serves food."),
  fromBusinessType("REL_BT_COMMERCIAL_KITCHEN", "BT_COMMERCIAL_KITCHEN",
    [det("Q_COMMERCIAL_KITCHEN", true), det("Q_FOOD_PREPARED", true)], "Definitional."),
  fromBusinessType("REL_BT_ICE_CREAM", "BT_ICE_CREAM_SHOP",
    [det("Q_FOOD_SOLD", true), det("Q_FOOD_SERVED", true)], "Sells and serves food."),
  fromBusinessType("REL_BT_JUICE_BAR", "BT_JUICE_BAR",
    [det("Q_FOOD_SOLD", true), det("Q_FOOD_SERVED", true)], "Sells and serves food and drink."),

  // --- Healthcare -----------------------------------------------------------
  ...[
    "BT_MEDICAL_OFFICE",
    "BT_DENTAL_OFFICE",
    "BT_CLINICAL_LABORATORY",
    "BT_MENTAL_HEALTH_PRACTICE",
    "BT_PHYSICAL_THERAPY_CLINIC",
    "BT_URGENT_CARE_CENTER",
    "BT_MEDICAL_SPA",
    "BT_HOME_HEALTH_AGENCY",
  ].map((id) =>
    fromBusinessType(`REL_${id}_HEALTHCARE`, id, [det("Q_HEALTHCARE_SERVICES", true)],
      "Providing healthcare services is what this business type is.")
  ),

  // --- Licensed professions -------------------------------------------------
  ...[
    "BT_LAW_FIRM",
    "BT_CPA_FIRM",
    "BT_ENGINEERING_FIRM",
    "BT_ARCHITECTURE_FIRM",
    "BT_NOTARY_SERVICES",
    "BT_ACCOUNTING_FIRM",
    "BT_REAL_ESTATE_BROKERAGE",
    "BT_INSURANCE_AGENCY",
    "BT_MORTGAGE_BROKER",
  ].map((id) =>
    fromBusinessType(`REL_${id}_LICENSED`, id, [det("Q_PROFESSIONAL_LICENSES", true)],
      "This profession cannot be practised in Puerto Rico without a licence.")
  ),

  // --- Tourism & lodging ----------------------------------------------------
  fromBusinessType("REL_BT_SHORT_TERM_RENTAL", "BT_AIRBNB_SHORT_TERM_RENTAL",
    [det("Q_SHORT_TERM_RENTAL", true), det("Q_GUESTS_OVERNIGHT", true)], "Definitional."),
  ...["BT_HOTEL", "BT_RESORT", "BT_GUEST_HOUSE"].map((id) =>
    fromBusinessType(`REL_${id}_OVERNIGHT`, id, [det("Q_GUESTS_OVERNIGHT", true)],
      "Lodging hosts overnight guests — but it is NOT a short-term rental, which is a distinct category.")
  ),
  fromBusinessType("REL_BT_TOUR_OPERATOR", "BT_TOUR_OPERATOR", [det("Q_TOURISM_ACTIVITY", true)], "Definitional."),
  fromBusinessType("REL_BT_EXCURSION_COMPANY", "BT_EXCURSION_COMPANY",
    [det("Q_TOURISM_ACTIVITY", true), det("Q_EXCURSIONS", true)], "Definitional."),

  // --- Childcare & education ------------------------------------------------
  fromBusinessType("REL_BT_DAYCARE", "BT_DAYCARE", [det("Q_CHILDREN_PRESENT", true)],
    "A daycare has children present — the textbook definitional derivation."),
  fromBusinessType("REL_BT_AFTER_SCHOOL", "BT_AFTER_SCHOOL_PROGRAM", [det("Q_CHILDREN_PRESENT", true)], "Definitional."),
  fromBusinessType("REL_BT_PRIVATE_SCHOOL", "BT_PRIVATE_SCHOOL", [maybe("Q_CHILDREN_PRESENT", true)],
    "Almost always minors, but adult private schools exist — inference, not certainty."),

  // --- Transportation -------------------------------------------------------
  ...[
    "BT_TRUCKING_COMPANY",
    "BT_COURIER_SERVICE",
    "BT_MOVING_COMPANY",
    "BT_TAXI_SERVICE",
    "BT_LOGISTICS_COMPANY",
    "BT_FREIGHT_FORWARDING_COMPANY",
  ].map((id) =>
    fromBusinessType(`REL_${id}_VEHICLES`, id, [det("Q_COMMERCIAL_VEHICLES", true)],
      "This business type operates commercial vehicles by definition.")
  ),
  ...["BT_WAREHOUSE_OPERATOR", "BT_WAREHOUSE_DISTRIBUTOR"].map((id) =>
    fromBusinessType(`REL_${id}_STORAGE`, id, [det("Q_GOODS_STORED", true)], "Definitional.")
  ),
  fromBusinessType("REL_BT_IMPORT_EXPORT", "BT_IMPORT_EXPORT_BUSINESS", [det("Q_IMPORT_EXPORT", true)], "Definitional."),

  // --- Automotive -----------------------------------------------------------
  ...["BT_AUTO_REPAIR_SHOP", "BT_BODY_SHOP", "BT_MOTORCYCLE_REPAIR_SHOP", "BT_TIRE_SHOP"].map((id) =>
    fromBusinessType(`REL_${id}_REPAIR`, id, [det("Q_VEHICLE_REPAIR", true)], "Definitional.")
  ),

  // --- Manufacturing --------------------------------------------------------
  ...[
    "BT_FOOD_MANUFACTURING",
    "BT_PHARMACEUTICAL_MANUFACTURING",
    "BT_MEDICAL_DEVICE_MANUFACTURING",
    "BT_TEXTILE_MANUFACTURING",
    "BT_FURNITURE_MANUFACTURING",
    "BT_BEVERAGE_MANUFACTURING",
    "BT_CHEMICAL_MANUFACTURING",
  ].map((id) =>
    fromBusinessType(`REL_${id}_MANUFACTURES`, id, [det("Q_PRODUCTS_MANUFACTURED", true)], "Definitional.")
  ),
  fromBusinessType("REL_BT_CHEMICAL_MANUFACTURING_CHEMICALS", "BT_CHEMICAL_MANUFACTURING",
    [det("Q_CHEMICALS_USED", true)], "Chemical manufacturing uses chemicals in production."),

  // --- Agriculture ----------------------------------------------------------
  ...["BT_FARM", "BT_AQUACULTURE_OPERATION", "BT_PLANT_NURSERY", "BT_COFFEE_PLANTATION"].map((id) =>
    fromBusinessType(`REL_${id}_AGRICULTURE`, id, [det("Q_AGRICULTURE_PRODUCTION", true)], "Definitional.")
  ),
  fromBusinessType("REL_BT_LIVESTOCK", "BT_LIVESTOCK_OPERATION",
    [det("Q_AGRICULTURE_PRODUCTION", true), det("Q_LIVESTOCK", true)], "Definitional."),

  // --- Personal care --------------------------------------------------------
  ...[
    "BT_BEAUTY_SALON",
    "BT_BARBERSHOP",
    "BT_NAIL_SALON",
    "BT_SPA",
    "BT_MASSAGE_THERAPY_STUDIO",
    "BT_ESTHETICS_STUDIO",
    "BT_TATTOO_SHOP",
  ].map((id) =>
    fromBusinessType(`REL_${id}_ON_SITE_SERVICES`, id, [det("Q_CUSTOMERS_RECEIVE_SERVICES", true)],
      "Personal-care services are delivered to the customer in person.")
  ),
  fromBusinessType("REL_BT_TATTOO_NEEDLES", "BT_TATTOO_SHOP", [det("Q_NEEDLES_INVASIVE", true)],
    "Tattooing uses needles by definition."),

  // --- Entertainment venues -------------------------------------------------
  ...["BT_MUSIC_VENUE", "BT_THEATER"].map((id) =>
    fromBusinessType(`REL_${id}_LIVE_ENTERTAINMENT`, id, [det("Q_LIVE_ENTERTAINMENT", true)], "Definitional.")
  ),

  // --- Energy, government, nonprofit, real estate ---------------------------
  ...["BT_SOLAR_INSTALLER", "BT_BATTERY_STORAGE_INSTALLER", "BT_RENEWABLE_ENERGY_COMPANY"].map((id) =>
    fromBusinessType(`REL_${id}_RENEWABLE`, id, [det("Q_RENEWABLE_INSTALL", true)], "Definitional.")
  ),
  ...[
    "BT_CONSTRUCTION_GOVERNMENT_CONTRACTOR",
    "BT_IT_GOVERNMENT_CONTRACTOR",
    "BT_PROFESSIONAL_SERVICES_GOVERNMENT_CONTRACTOR",
    "BT_FACILITIES_GOVERNMENT_CONTRACTOR",
  ].map((id) =>
    fromBusinessType(`REL_${id}_GOV`, id, [det("Q_GOV_CONTRACT", true)], "Definitional.")
  ),
  ...[
    "BT_NONPROFIT_ORGANIZATION",
    "BT_RELIGIOUS_ORGANIZATION",
    "BT_COMMUNITY_ORGANIZATION",
    "BT_FOUNDATION",
    "BT_CHARITY",
  ].map((id) =>
    fromBusinessType(`REL_${id}_NONPROFIT`, id, [det("Q_NONPROFIT_STATUS", true)], "Definitional.")
  ),
  fromBusinessType("REL_BT_PROPERTY_MANAGEMENT", "BT_PROPERTY_MANAGEMENT_COMPANY",
    [det("Q_PROPERTY_MANAGEMENT", true)], "Managing property for others is what the business is."),
];

// ============================================================================
// CONTRADICTIONS
//
// States that cannot both be true. The resolver already stops a weaker source
// from overwriting a stronger one; these catch impossible combinations ACROSS
// different questions, which precedence alone cannot see.
// ============================================================================

export const INTAKE_CONTRADICTIONS: FactContradiction[] = [
  {
    id: "CONTRA_EMPLOYEE_COUNT_VS_HIRING",
    when: [
      { ref: { type: "profile", key: "number_of_employees" }, operator: "greater_than", value: 0 },
      { ref: { type: "question", key: "Q_EMPLOYEES_HIRED" }, operator: "equals", value: false },
    ],
    message: "A headcount above zero was given, but the intake also says no employees will be hired.",
  },
  {
    id: "CONTRA_EMPLOYEE_BUCKET_VS_COUNT",
    when: [
      { ref: { type: "profile", key: "number_of_employees" }, operator: "greater_than", value: 0 },
      { ref: { type: "question", key: "Q_EMPLOYEE_COUNT" }, operator: "equals", value: "0" },
    ],
    message: "The headcount and the employee-count bracket disagree.",
  },
  {
    id: "CONTRA_ONLINE_ONLY_VS_PHYSICAL",
    when: [
      { ref: { type: "question", key: "Q_ONLINE_ONLY" }, operator: "equals", value: true },
      { ref: { type: "question", key: "Q_PHYSICAL_LOCATION" }, operator: "equals", value: true },
    ],
    message: "The business cannot be online-only and operate from a physical location.",
  },
  {
    id: "CONTRA_ONLINE_ONLY_VS_HOME_BASED",
    when: [
      { ref: { type: "question", key: "Q_ONLINE_ONLY" }, operator: "equals", value: true },
      { ref: { type: "question", key: "Q_HOME_BASED" }, operator: "equals", value: true },
    ],
    message: "The business cannot be online-only and home-based at the same time.",
  },
  {
    id: "CONTRA_ONLINE_ONLY_VS_OUTDOOR_SEATING",
    when: [
      { ref: { type: "question", key: "Q_ONLINE_ONLY" }, operator: "equals", value: true },
      { ref: { type: "question", key: "Q_OUTDOOR_SEATING" }, operator: "equals", value: true },
    ],
    message: "An online-only business cannot have outdoor seating.",
  },
  {
    id: "CONTRA_NO_PHYSICAL_VS_OUTDOOR_SEATING",
    when: [
      { ref: { type: "question", key: "Q_PHYSICAL_LOCATION" }, operator: "equals", value: false },
      { ref: { type: "question", key: "Q_OUTDOOR_SEATING" }, operator: "equals", value: true },
    ],
    message: "Outdoor seating requires a physical location.",
  },
  {
    id: "CONTRA_NO_PHYSICAL_VS_CUSTOMERS_VISIT",
    when: [
      { ref: { type: "question", key: "Q_PHYSICAL_LOCATION" }, operator: "equals", value: false },
      { ref: { type: "question", key: "Q_CUSTOMERS_VISIT" }, operator: "equals", value: true },
    ],
    message: "Customers cannot visit a business with no physical location.",
  },
  {
    id: "CONTRA_FLEET_SIZE_VS_COMMERCIAL_VEHICLES",
    when: [
      { ref: { type: "question", key: "Q_FLEET_SIZE" }, operator: "equals", value: "0" },
      { ref: { type: "question", key: "Q_COMMERCIAL_VEHICLES" }, operator: "equals", value: true },
    ],
    message: "The fleet size is zero, but the intake also says commercial vehicles are used.",
  },
];
