// ============================================================================
// Golden scenario catalog — SmartPR rigorous correctness framework.
//
// These 25 scenarios are the oracle Darius asked for: each one declares a
// realistic business (profile + direct intake answers), and the committed
// JSON golden in ./goldens/<id>.json records the requirement set SmartPR
// must produce for it.
//
// Workflow:
//   1. This file authors the scenario INPUTS (the meaningful part).
//   2. `npx tsx src/app/qa/snapshotGoldens.ts` runs each scenario through
//      the engine and writes the JSON goldens with status "draft".
//   3. Darius reviews each draft golden's expected set (see the review doc
//      in the knowledge-graph-accuracy-push goal files/) and corrects it.
//   4. Corrected goldens are flipped to status "validated" — from then on
//      goldenScenarios.test.ts asserts EXACT set equality, and any engine
//      change that alters a validated golden fails loudly.
//
// Draft goldens never fail the suite on drift; they report drift so the QA
// loop can see behavior changes and route them for review.
// ============================================================================

export interface GoldenScenarioDef {
  id: string;
  title: string;
  profile: Record<string, unknown>;
  answers: Record<string, unknown>;
  options: {
    entityType?: string | null;
    projectIntent?: string | null;
  };
}

export const GOLDEN_SCENARIO_DEFS: GoldenScenarioDef[] = [
  {
    id: "G01",
    title: "Restaurant with alcohol, 8 employees, leased commercial space — Trujillo Alto",
    profile: {
      business_type: "Restaurant",
      municipality: "Trujillo Alto",
      location_type: "Restaurant Location",
      number_of_employees: 8,
      industry: "Food & Beverage",
    },
    answers: {
      Q_FOOD_PREPARED: true,
      Q_FOOD_SERVED: true,
      Q_ON_SITE_CONSUMPTION: true,
      Q_ALCOHOL_SOLD: true,
      Q_ALCOHOL_SERVED: true,
      Q_EMPLOYEES_HIRED: true,
      Q_EXISTING_LEASE: true,
      Q_COMMERCIAL_SIGNAGE: true,
    },
    options: { entityType: "limited_liability_company", projectIntent: "new_business" },
  },
  {
    id: "G02",
    title: "Restaurant, no alcohol, 3 employees — Caguas",
    profile: {
      business_type: "Restaurant",
      municipality: "Caguas",
      location_type: "Restaurant Location",
      number_of_employees: 3,
      industry: "Food & Beverage",
    },
    answers: {
      Q_FOOD_PREPARED: true,
      Q_FOOD_SERVED: true,
      Q_ON_SITE_CONSUMPTION: true,
      Q_ALCOHOL_SOLD: false,
      Q_ALCOHOL_SERVED: false,
      Q_EMPLOYEES_HIRED: true,
      Q_EXISTING_LEASE: true,
    },
    options: { entityType: "limited_liability_company", projectIntent: "new_business" },
  },
  {
    id: "G03",
    title: "Bar serving alcohol, 5 employees — San Juan",
    profile: {
      business_type: "Bar",
      municipality: "San Juan",
      location_type: "Commercial Space",
      number_of_employees: 5,
      industry: "Food & Beverage",
    },
    answers: {
      Q_ALCOHOL_SOLD: true,
      Q_ALCOHOL_SERVED: true,
      Q_ON_SITE_CONSUMPTION: true,
      Q_EMPLOYEES_HIRED: true,
      Q_EXISTING_LEASE: true,
      Q_LIVE_ENTERTAINMENT: true,
      Q_COMMERCIAL_SIGNAGE: true,
    },
    options: { entityType: "limited_liability_company", projectIntent: "new_business" },
  },
  {
    id: "G04",
    title: "Home-based bookkeeping practice, solo, 0 employees — Carolina",
    profile: {
      business_type: "Accounting Firm",
      municipality: "Carolina",
      location_type: "Home-Based Business",
      number_of_employees: 0,
      industry: "Professional Services",
    },
    answers: {
      Q_HOME_BASED: true,
      Q_PHYSICAL_LOCATION: true,
      Q_EMPLOYEES_HIRED: false,
      Q_CUSTOMERS_VISIT: false,
      Q_PROFESSIONAL_LICENSES: true,
    },
    options: { entityType: "sole_proprietorship", projectIntent: "new_business" },
  },
  {
    id: "G05",
    title: "Online-only IT consulting, solo, 0 employees — Guaynabo",
    profile: {
      business_type: "IT Consulting Firm",
      municipality: "Guaynabo",
      location_type: "Online Only",
      number_of_employees: 0,
      industry: "Professional Services",
    },
    answers: {
      Q_ONLINE_ONLY: true,
      Q_EMPLOYEES_HIRED: false,
      Q_CUSTOMERS_VISIT: false,
    },
    options: { entityType: "sole_proprietorship", projectIntent: "new_business" },
  },
  {
    id: "G06",
    title: "Single-unit coastal short-term rental, owner-managed, 0 employees — Toa Baja",
    profile: {
      business_type: "Airbnb / Short-Term Rental",
      municipality: "Toa Baja",
      location_type: "Residential Property",
      number_of_employees: 0,
      industry: "Accommodation & Tourism",
    },
    answers: {
      Q_SHORT_TERM_RENTAL: true,
      Q_GUESTS_OVERNIGHT: true,
      Q_RENTAL_UNITS: "1",
      Q_TOURISM_ACTIVITY: true,
      Q_EMPLOYEES_HIRED: false,
      Q_OWNS_PROPERTY: true,
    },
    options: { entityType: "sole_proprietorship", projectIntent: "new_business" },
  },
  {
    id: "G07",
    title: "Hotel, 25 employees, coastal tourism zone — Dorado",
    profile: {
      business_type: "Hotel",
      municipality: "Dorado",
      location_type: "Hotel Property",
      number_of_employees: 25,
      industry: "Accommodation & Tourism",
    },
    answers: {
      Q_GUESTS_OVERNIGHT: true,
      Q_TOURISM_ACTIVITY: true,
      Q_FOOD_SERVED: true,
      Q_ALCOHOL_SERVED: true,
      Q_EMPLOYEES_HIRED: true,
      Q_COMMERCIAL_SIGNAGE: true,
      Q_OWNS_PROPERTY: true,
    },
    options: { entityType: "corporation", projectIntent: "new_business" },
  },
  {
    id: "G08",
    title: "Clothing retail store, 4 employees, leased — Bayamón",
    profile: {
      business_type: "Clothing Store",
      municipality: "Bayamón",
      location_type: "Retail Storefront",
      number_of_employees: 4,
      industry: "Retail",
    },
    answers: {
      Q_RETAIL_SALES: true,
      Q_INVENTORY_STORED: true,
      Q_EMPLOYEES_HIRED: true,
      Q_EXISTING_LEASE: true,
      Q_COMMERCIAL_SIGNAGE: true,
      Q_CUSTOMERS_VISIT: true,
    },
    options: { entityType: "limited_liability_company", projectIntent: "new_business" },
  },
  {
    id: "G09",
    title: "E-commerce business, online only, solo — Arecibo",
    profile: {
      business_type: "E-commerce Business",
      municipality: "Arecibo",
      location_type: "Online Only",
      number_of_employees: 0,
      industry: "Retail",
    },
    answers: {
      Q_ONLINE_ONLY: true,
      Q_RETAIL_SALES: true,
      Q_EMPLOYEES_HIRED: false,
      Q_INVENTORY_STORED: false,
    },
    options: { entityType: "limited_liability_company", projectIntent: "new_business" },
  },
  {
    id: "G10",
    title: "Food truck, 2 employees, mobile — Ponce",
    profile: {
      business_type: "Food Truck",
      municipality: "Ponce",
      location_type: "Mobile / Food Truck",
      number_of_employees: 2,
      industry: "Food & Beverage",
    },
    answers: {
      Q_FOOD_PREPARED: true,
      Q_FOOD_SOLD: true,
      Q_FOOD_TRUCK_MOBILE: true,
      Q_ALCOHOL_SOLD: false,
      Q_EMPLOYEES_HIRED: true,
      Q_COMMERCIAL_VEHICLES: true,
    },
    options: { entityType: "sole_proprietorship", projectIntent: "new_business" },
  },
  {
    id: "G11",
    title: "Car wash, 6 employees, new commercial site — Mayagüez",
    profile: {
      business_type: "Car Wash",
      municipality: "Mayagüez",
      location_type: "Commercial Lot",
      number_of_employees: 6,
      industry: "Automotive",
    },
    answers: {
      Q_EMPLOYEES_HIRED: true,
      Q_EXISTING_LEASE: false,
      Q_OWNS_PROPERTY: false,
      Q_HAZARDOUS_FLUIDS: true,
      Q_ENVIRONMENTAL_IMPACT: true,
      Q_COMMERCIAL_SIGNAGE: true,
    },
    options: { entityType: "limited_liability_company", projectIntent: "new_business" },
  },
  {
    id: "G12",
    title: "General contractor, 12 employees — Toa Alta",
    profile: {
      business_type: "General Contractor",
      municipality: "Toa Alta",
      location_type: "Office / Yard",
      number_of_employees: 12,
      industry: "Construction",
    },
    answers: {
      Q_EMPLOYEES_HIRED: true,
      Q_COMMERCIAL_VEHICLES: true,
      Q_EXISTING_LEASE: true,
      Q_HAZARDOUS_MATERIALS: false,
    },
    options: { entityType: "corporation", projectIntent: "new_business" },
  },
  {
    id: "G13",
    title: "Barbershop, 3 employees, leased — Cataño",
    profile: {
      business_type: "Barbershop",
      municipality: "Cataño",
      location_type: "Retail Storefront",
      number_of_employees: 3,
      industry: "Personal Care",
    },
    answers: {
      Q_EMPLOYEES_HIRED: true,
      Q_EXISTING_LEASE: true,
      Q_CUSTOMERS_RECEIVE_SERVICES: true,
      Q_COMMERCIAL_SIGNAGE: true,
      Q_PROFESSIONAL_LICENSES: true,
    },
    options: { entityType: "limited_liability_company", projectIntent: "new_business" },
  },
  {
    id: "G14",
    title: "Medical office, 6 employees, patients on site — San Juan",
    profile: {
      business_type: "Medical Office",
      municipality: "San Juan",
      location_type: "Medical Office",
      number_of_employees: 6,
      industry: "Healthcare",
    },
    answers: {
      Q_HEALTHCARE_SERVICES: true,
      Q_PATIENTS_VISIT: true,
      Q_EMPLOYEES_HIRED: true,
      Q_EXISTING_LEASE: true,
      Q_MEDICAL_WASTE: true,
      Q_BIOHAZARD_WASTE: false,
      Q_PROFESSIONAL_LICENSES: true,
    },
    options: { entityType: "professional_corporation", projectIntent: "new_business" },
  },
  {
    id: "G15",
    title: "Daycare, 8 employees, children on site — Carolina",
    profile: {
      business_type: "Daycare",
      municipality: "Carolina",
      location_type: "Commercial Space",
      number_of_employees: 8,
      industry: "Education & Childcare",
    },
    answers: {
      Q_CHILDREN_PRESENT: true,
      Q_EMPLOYEES_HIRED: true,
      Q_EXISTING_LEASE: true,
      Q_BACKGROUND_CHECKS: true,
      Q_CLASSES_ON_SITE: true,
    },
    options: { entityType: "corporation", projectIntent: "new_business" },
  },
  {
    id: "G16",
    title: "Auto repair shop, 5 employees, hazardous fluids — Bayamón",
    profile: {
      business_type: "Auto Repair Shop",
      municipality: "Bayamón",
      location_type: "Commercial Garage",
      number_of_employees: 5,
      industry: "Automotive",
    },
    answers: {
      Q_VEHICLE_REPAIR: true,
      Q_HAZARDOUS_FLUIDS: true,
      Q_HAZARDOUS_MATERIALS: true,
      Q_EMPLOYEES_HIRED: true,
      Q_EXISTING_LEASE: true,
      Q_ENVIRONMENTAL_IMPACT: true,
    },
    options: { entityType: "limited_liability_company", projectIntent: "new_business" },
  },
  {
    id: "G17",
    title: "Beverage manufacturing plant, 40 employees — Caguas",
    profile: {
      business_type: "Beverage Manufacturing",
      municipality: "Caguas",
      location_type: "Industrial Facility",
      number_of_employees: 40,
      industry: "Manufacturing",
    },
    answers: {
      Q_PRODUCTS_MANUFACTURED: true,
      Q_PRODUCTS_DISTRIBUTED: true,
      Q_EMPLOYEES_HIRED: true,
      Q_OWNS_PROPERTY: true,
      Q_CHEMICALS_USED: true,
      Q_ENVIRONMENTAL_IMPACT: true,
      Q_IMPORT_EXPORT: true,
    },
    options: { entityType: "corporation", projectIntent: "new_business" },
  },
  {
    id: "G18",
    title: "Farm, agricultural production, 2 employees — Arecibo",
    profile: {
      business_type: "Farm",
      municipality: "Arecibo",
      location_type: "Agricultural Land",
      number_of_employees: 2,
      industry: "Agriculture & Farming",
    },
    answers: {
      Q_AGRICULTURE_PRODUCTION: true,
      Q_EMPLOYEES_HIRED: true,
      Q_OWNS_PROPERTY: true,
      Q_PESTICIDES: true,
    },
    options: { entityType: "sole_proprietorship", projectIntent: "new_business" },
  },
  {
    id: "G19",
    title: "Law firm, 2 employees, licensed professionals — Guaynabo",
    profile: {
      business_type: "Law Firm",
      municipality: "Guaynabo",
      location_type: "Office Space",
      number_of_employees: 2,
      industry: "Professional Services",
    },
    answers: {
      Q_PROFESSIONAL_LICENSES: true,
      Q_EMPLOYEES_HIRED: true,
      Q_EXISTING_LEASE: true,
      Q_CUSTOMERS_VISIT: true,
    },
    options: { entityType: "professional_corporation", projectIntent: "new_business" },
  },
  {
    id: "G20",
    title: "Nonprofit organization, 5 employees — San Juan",
    profile: {
      business_type: "Nonprofit Organization",
      municipality: "San Juan",
      location_type: "Office Space",
      number_of_employees: 5,
      industry: "Nonprofit",
    },
    answers: {
      Q_NONPROFIT_STATUS: true,
      Q_EMPLOYEES_HIRED: true,
      Q_EXISTING_LEASE: true,
    },
    options: { entityType: "nonprofit_nonstock_corporation", projectIntent: "new_business" },
  },
  {
    id: "G21",
    title: "Convenience store with fuel sales, 6 employees — Toa Baja",
    profile: {
      business_type: "Convenience Store",
      municipality: "Toa Baja",
      location_type: "Retail Storefront",
      number_of_employees: 6,
      industry: "Retail",
    },
    answers: {
      Q_RETAIL_SALES: true,
      Q_FUEL_SOLD: true,
      Q_TOBACCO_SOLD: true,
      Q_EMPLOYEES_HIRED: true,
      Q_EXISTING_LEASE: true,
      Q_HAZARDOUS_MATERIALS: true,
      Q_COMMERCIAL_SIGNAGE: true,
    },
    options: { entityType: "limited_liability_company", projectIntent: "new_business" },
  },
  {
    id: "G22",
    title: "Bakery, 4 employees, food prepared on site — Trujillo Alto",
    profile: {
      business_type: "Bakery",
      municipality: "Trujillo Alto",
      location_type: "Retail Storefront",
      number_of_employees: 4,
      industry: "Food & Beverage",
    },
    answers: {
      Q_FOOD_PREPARED: true,
      Q_FOOD_SOLD: true,
      Q_ALCOHOL_SOLD: false,
      Q_EMPLOYEES_HIRED: true,
      Q_EXISTING_LEASE: true,
      Q_COMMERCIAL_SIGNAGE: true,
    },
    options: { entityType: "limited_liability_company", projectIntent: "new_business" },
  },
  {
    id: "G23",
    title: "Gym / fitness studio, 5 employees — Ponce",
    profile: {
      business_type: "Gym / Fitness Studio",
      municipality: "Ponce",
      location_type: "Commercial Space",
      number_of_employees: 5,
      industry: "Health & Fitness",
    },
    answers: {
      Q_EMPLOYEES_HIRED: true,
      Q_EXISTING_LEASE: true,
      Q_CUSTOMERS_VISIT: true,
      Q_CUSTOMERS_RECEIVE_SERVICES: true,
      Q_COMMERCIAL_SIGNAGE: true,
    },
    options: { entityType: "limited_liability_company", projectIntent: "new_business" },
  },
  {
    id: "G24",
    title: "Tire recycling & manufacturing, 30 employees, industrial port zone — Yabucoa",
    profile: {
      business_type: "Tire Recycling & Manufacturing",
      municipality: "Yabucoa",
      location_type: "Industrial Facility",
      number_of_employees: 30,
      industry: "Manufacturing",
    },
    answers: {
      Q_PRODUCTS_MANUFACTURED: true,
      Q_PRODUCTS_DISTRIBUTED: true,
      Q_EMPLOYEES_HIRED: true,
      Q_OWNS_PROPERTY: true,
      Q_HAZARDOUS_MATERIALS: true,
      Q_CHEMICALS_USED: true,
      Q_ENVIRONMENTAL_IMPACT: true,
      Q_IMPORT_EXPORT: true,
      Q_COMMERCIAL_VEHICLES: true,
    },
    options: { entityType: "corporation", projectIntent: "new_business" },
  },
  {
    id: "G25",
    title: "Catering business, 4 employees, commercial kitchen — Cataño",
    profile: {
      business_type: "Catering Business",
      municipality: "Cataño",
      location_type: "Commercial Kitchen",
      number_of_employees: 4,
      industry: "Food & Beverage",
    },
    answers: {
      Q_FOOD_PREPARED: true,
      Q_FOOD_SOLD: true,
      Q_COMMERCIAL_KITCHEN: true,
      Q_FOOD_DELIVERY: true,
      Q_ALCOHOL_SOLD: false,
      Q_EMPLOYEES_HIRED: true,
      Q_EXISTING_LEASE: true,
      Q_COMMERCIAL_VEHICLES: true,
    },
    options: { entityType: "limited_liability_company", projectIntent: "new_business" },
  },
];
