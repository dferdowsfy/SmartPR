// QA 2026-09-25 09:00 cycle: run 3 new scenarios through the rules engine.
import { runGolden } from "./src/app/qa/goldenHarness.js";

const scenarios = [
  {
    id: "S196",
    title: "New vet clinic, Ponce",
    profile: {
      business_type: "Veterinary Clinic",
      business_type_id: "BT_VETERINARY_CLINIC",
      municipality: "Ponce",
      location_type: "Commercial Space",
      number_of_employees: 4,
      industry: "Professional Services",
      business_purpose: "Veterinary clinic providing medical care for small animals",
    },
    answers: {
      Q_EXISTING_BUSINESS: false,
      Q_EMPLOYEES_HIRED: true,
      Q_EXISTING_LEASE: true,
      Q_RENOVATIONS: false,
      Q_COMMERCIAL_SIGNAGE: true,
      Q_FOOD_PREPARED: false,
      Q_FOOD_SERVED: false,
      Q_ALCOHOL_SOLD: false,
      Q_FUEL_SOLD: false,
      Q_HAZARDOUS_MATERIALS: false,
      Q_FEDERAL_CONTRACTING: false,
      Q_HOME_BASED: false,
    },
    options: { entityType: "limited_liability_company", projectIntent: "new_business" },
    expected: [],
    expectedAbsent: [],
  },
  {
    id: "S197",
    title: "New used-car dealership, Bayamon (adversarial)",
    profile: {
      business_type: "Car Dealership",
      business_type_id: "BT_CAR_DEALERSHIP",
      municipality: "Bayamón",
      location_type: "Commercial Lot",
      number_of_employees: 10,
      industry: "Retail",
      business_purpose: "Retail sale of used motor vehicles purchased at auction; no service or repair shop; no in-house financing",
    },
    answers: {
      Q_EXISTING_BUSINESS: false,
      Q_EMPLOYEES_HIRED: true,
      Q_EXISTING_LEASE: false,
      Q_RENOVATIONS: false,
      Q_COMMERCIAL_SIGNAGE: true,
      Q_FOOD_PREPARED: false,
      Q_ALCOHOL_SOLD: false,
      Q_FUEL_SOLD: false,
      Q_HAZARDOUS_MATERIALS: false,
      Q_FEDERAL_CONTRACTING: false,
      Q_HOME_BASED: false,
    },
    options: { entityType: "limited_liability_company", projectIntent: "new_business" },
    expected: [],
    expectedAbsent: [],
  },
  {
    id: "S198",
    title: "Existing home-based bakery, Mayaguez (sole prop, 0 emp)",
    profile: {
      business_type: "Bakery",
      business_type_id: "BT_BAKERY",
      municipality: "Mayagüez",
      location_type: "Home",
      number_of_employees: 0,
      industry: "Food & Beverage",
      business_purpose: "Home-based bakery selling at farmers markets and taking custom orders online; operating 3 years",
    },
    answers: {
      Q_EXISTING_BUSINESS: true,
      Q_EMPLOYEES_HIRED: false,
      Q_EXISTING_LEASE: false,
      Q_RENOVATIONS: false,
      Q_COMMERCIAL_SIGNAGE: false,
      Q_FOOD_PREPARED: true,
      Q_FOOD_SERVED: false,
      Q_ALCOHOL_SOLD: false,
      Q_FUEL_SOLD: false,
      Q_HAZARDOUS_MATERIALS: false,
      Q_FEDERAL_CONTRACTING: false,
      Q_HOME_BASED: true,
    },
    options: { entityType: "sole_proprietorship", projectIntent: "existing_business" },
    expected: [],
    expectedAbsent: [],
  },
];

for (const s of scenarios) {
  const r = runGolden(s as any);
  console.log("=".repeat(90));
  console.log(`${s.id}: ${s.title}`);
  console.log(`requirements: ${r.actual.size}`);
  const rows = [...r.actual.entries()];
  for (const [id, v] of rows) {
    console.log(`  [${v.applicability}${v.mandatory ? "/MAND" : ""}] ${id} — ${v.name} (rule ${v.source_rule})`);
  }
  console.log(`rules fired: ${r.rulesFired.length}: ${r.rulesFired.sort().join(", ")}`);
}
