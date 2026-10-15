// J1 (Run 7 live, Cidra pizzeria, 2026-10-15): the description prefilled
// "Restaurant / Food Service Location" (generic list); choosing the business
// type "Restaurant" cleared it because that type's list spells the same
// premises "Restaurant Location". Equivalent spellings must carry over.
// Run: npx tsx --test src/app/locationTypeAlias.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { locationTypeInAllowed } from "./locationTypes.ts";

// Mirrors LOCATION_TYPES_BY_BUSINESS_TYPE in SmartPRIntake.tsx (importing the
// component here pulls in maplibre CSS, which node's test runner cannot load).
const LOCATION_TYPES_BY_BUSINESS_TYPE: Record<string, string[]> = {
  "Restaurant": ["Restaurant Location", "Retail Storefront", "Mixed Use Property", "Tourism Facility", "Commercial Office"],
  "Fast Food Restaurant": ["Restaurant Location", "Retail Storefront", "Mixed Use Property"],
  "Bakery": ["Restaurant Location", "Retail Storefront", "Commercial Kitchen", "Industrial Facility", "Home-Based Business"],
  "Cafe": ["Restaurant Location", "Retail Storefront", "Mixed Use Property"],
  "Coffee Shop": ["Restaurant Location", "Retail Storefront", "Mixed Use Property"],
  "Bar": ["Restaurant Location", "Retail Storefront", "Entertainment Venue", "Tourism Facility"],
};

test("generic restaurant label maps to the Restaurant type's label", () => {
  for (const bt of ["Restaurant", "Fast Food Restaurant", "Bakery", "Cafe", "Coffee Shop", "Bar"]) {
    assert.equal(
      locationTypeInAllowed("Restaurant / Food Service Location", LOCATION_TYPES_BY_BUSINESS_TYPE[bt]),
      "Restaurant Location",
      bt,
    );
  }
});

test("allowed label is kept as-is; unrelated label is dropped", () => {
  const allowed = LOCATION_TYPES_BY_BUSINESS_TYPE["Restaurant"];
  assert.equal(locationTypeInAllowed("Retail Storefront", allowed), "Retail Storefront");
  assert.equal(locationTypeInAllowed("Warehouse", allowed), "");
  assert.equal(locationTypeInAllowed("", allowed), "");
});

test("online and coworking spellings carry over", () => {
  assert.equal(locationTypeInAllowed("Online / Remote Only", ["Commercial Office", "Online Only"]), "Online Only");
  assert.equal(locationTypeInAllowed("Shared Workspace / Coworking", ["Commercial Office", "Shared Workspace"]), "Shared Workspace");
});
