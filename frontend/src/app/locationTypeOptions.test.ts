// Regression: QA 2026-09-17 (live, San Juan home-based tutor).
//
// The intake AI correctly extracted "Home-Based Business" from the
// description ("I teach ... from my apartment"), but the location-type
// combobox for "Tutoring Center" offered only "Educational Facility" and
// "Commercial Office". The forced commercial choice overwrote the extracted
// fact, and buildEngineInput derives Q_HOME_BASED solely from the
// location_type value — so the home-based context was silently lost and the
// sole Permiso Único was framed as "Nonresidential business location".
//
// Business types that can plausibly operate from home must offer a
// home-based label in the location-type combobox; otherwise the extracted
// home-based fact gets clobbered by a forced commercial pick.
// Run: npx tsx --test src/app/locationTypeOptions.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { LOCATION_TYPES_BY_BUSINESS_TYPE } from "./SmartPRIntake.tsx";
import { HOME_BASED_LOCATION_TYPES, isHomeBasedLocation } from "./locationTypes.ts";

const canon = (s: string) => s.trim().toLowerCase();
const HOME_BASED = new Set(HOME_BASED_LOCATION_TYPES.map(canon));

const hasHomeBasedOption = (businessType: string): boolean =>
  (LOCATION_TYPES_BY_BUSINESS_TYPE[businessType] ?? []).some((o) => HOME_BASED.has(canon(o)));

test("Tutoring Center offers a home-based location option", () => {
  assert.ok(
    hasHomeBasedOption("Tutoring Center"),
    `Tutoring Center options must include a home-based label; got: ` +
      (LOCATION_TYPES_BY_BUSINESS_TYPE["Tutoring Center"] ?? []).join(", ")
  );
});

// Generalized 2026-09-18 (live, Cataño home-based jeweler): the same defect
// recurred for "Jewelry Store", whose options were ["Retail Storefront"]
// only. Retail and personal-care business types that can plausibly operate
// from home must all offer a home-based label, so the AI-extracted
// home-based fact survives the location combobox.
const HOME_PLAUSIBLE_BUSINESS_TYPES = [
  "Clothing Store",
  "Jewelry Store",
  "Electronics Store",
  "Sporting Goods Store",
  "Pet Store",
  "Gift Shop",
  "Cosmetics Store",
  "Home Goods Store",
  "Beauty Salon",
  "Barbershop",
  "Nail Salon",
  "Spa",
  "Massage Therapy",
  "Tattoo Shop",
  "Esthetics Studio",
  "Makeup Studio",
];

test("home-plausible retail/personal-care types offer a home-based location option", () => {
  const missing = HOME_PLAUSIBLE_BUSINESS_TYPES.filter((bt) => !hasHomeBasedOption(bt));
  assert.deepEqual(
    missing,
    [],
    `business types missing a home-based location option: ${missing.join(", ")}`
  );
});

// Generalized 2026-09-20 (live, Dorado home-based bakery): the same defect
// recurred for "Bakery", whose options were Restaurant Location / Retail
// Storefront / Commercial Kitchen / Industrial Facility only. The auditor
// had to pick "Commercial Kitchen" (least-wrong), so the checklist treated
// a home kitchen as a commercial establishment — Permiso Único REQUIRED as
// "Nonresidential business location" and health/fire/CFPM framed for
// commercial premises. Food business types that can plausibly operate from
// home must offer a home-based label so Q_HOME_BASED survives the combobox.
test("Bakery offers a home-based location option", () => {
  assert.ok(
    hasHomeBasedOption("Bakery"),
    `Bakery options must include a home-based label; got: ` +
      (LOCATION_TYPES_BY_BUSINESS_TYPE["Bakery"] ?? []).join(", ")
  );
});

// REG-LOCATION-STR-001 (2026-09-21 18:00 QA, live Arecibo STR filing): an
// owner-managed investment condo (owner does not live there) had no
// residential-rental location option — the combobox offered only
// Home-Based Business / Tourism Facility / Mixed Use Property. The auditor
// picked "Home-Based Business" as the least-wrong fit, which derived
// Q_HOME_BASED and falsely required Permiso Único — Domiciliary Use.
// Short-term-rental business types must offer a plain residential-property
// option that does NOT resolve to a home-based location.
test("short-term-rental business types offer a non-home-based residential property option", () => {
  for (const bt of ["Airbnb", "Short-Term Rental"]) {
    const options = LOCATION_TYPES_BY_BUSINESS_TYPE[bt] ?? [];
    assert.ok(
      options.includes("Residential Property"),
      `${bt} options must include "Residential Property"; got: ${options.join(", ")}`
    );
    assert.equal(
      isHomeBasedLocation("Residential Property"),
      false,
      `"Residential Property" must not resolve as home-based (would wrongly trigger Domiciliary Use)`
    );
  }
});

// REG-LOCATION-MOBILE-001 (2026-09-22 15:00 QA, live S136): a mobile car
// detailer ("Car Wash") was forced into "Commercial Facility" because the
// automotive combobox offered no mobile label — the forced commercial pick
// derived Q_PHYSICAL_LOCATION=Yes and put Permiso Único in the blocking
// critical path. Business types that can plausibly operate as fully mobile
// or field-service operations must offer "Mobile Business" so the extracted
// mobile fact survives the combobox and the REG-MOBILE-PHYSICAL-001 engine
// correction fires.
import { isMobileLocation } from "./locationTypes.ts";

const MOBILE_PLAUSIBLE_BUSINESS_TYPES = [
  "Car Wash",
  "Auto Repair Shop",
  "Body Shop",
  "Motorcycle Repair",
  "Tire Shop",
  "General Contractor",
  "Electrical Contractor",
  "Plumbing Contractor",
  "HVAC Contractor",
  "Roofing Contractor",
  "Concrete Contractor",
  "Specialty Trade Contractor",
  "Landscaping Company",
  "Surveying Company",
];

test("mobile-plausible business types offer a Mobile Business location option", () => {
  const missing = MOBILE_PLAUSIBLE_BUSINESS_TYPES.filter(
    (bt) => !(LOCATION_TYPES_BY_BUSINESS_TYPE[bt] ?? []).some((o) => isMobileLocation(o))
  );
  assert.deepEqual(
    missing,
    [],
    `business types missing a mobile location option: ${missing.join(", ")}`
  );
});
