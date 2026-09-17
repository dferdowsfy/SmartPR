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
import { HOME_BASED_LOCATION_TYPES } from "./locationTypes.ts";

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
