import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import businessTypes from "../../../kb/business_types.json";
import { PROJECT_ILLUSTRATIONS, selectProjectIllustration } from "./projectIllustrations";

test("every selected illustration has a shipped asset, including the full business-type catalog", () => {
  for (const src of Object.values(PROJECT_ILLUSTRATIONS)) {
    assert.equal(existsSync(path.join(process.cwd(), "public", src)), true, src);
  }
  for (const type of businessTypes) {
    const key = selectProjectIllustration({ businessType: type.name });
    assert.ok(PROJECT_ILLUSTRATIONS[key], type.id);
  }
});

test("specific business types stay distinct and unknowns remain neutral", () => {
  assert.equal(selectProjectIllustration({ businessType: "Restaurant", industry: "Food & Beverage" }), "restaurant");
  assert.equal(selectProjectIllustration({ businessType: "Bar", industry: "Food & Beverage" }), "bar");
  assert.equal(selectProjectIllustration({ businessType: "Juice Bar", industry: "Food & Beverage" }), "restaurant");
  assert.equal(selectProjectIllustration({ businessType: "Liquor Store", industry: "Food & Beverage" }), "retail");
  assert.equal(selectProjectIllustration({ businessType: "Pharmacy", industry: "Healthcare" }), "retail");
  assert.equal(selectProjectIllustration({ businessType: "Auto Repair Shop", industry: "Automotive" }), "default");
  assert.equal(selectProjectIllustration({ industry: "Food & Beverage" }), "default");
  assert.equal(selectProjectIllustration({ businessType: "Unknown Business" }), "default");
});

test("solar warehouse requires explicit solar answers and updates when they change", () => {
  const base = { businessType: "Warehouse Operator", locationType: "Warehouse" };
  assert.equal(selectProjectIllustration(base), "warehouse");
  assert.equal(selectProjectIllustration({ ...base, answers: { Q_SOLAR_BATTERY: false } }), "solarWarehouse");
  assert.equal(selectProjectIllustration({ ...base, answers: { solar_mounting: "Roof-mounted" } }), "solarWarehouse");
  assert.equal(selectProjectIllustration({ ...base, answers: {} }), "warehouse");
  assert.equal(selectProjectIllustration({ businessType: "Bar", locationType: "Warehouse", answers: { Q_SOLAR_BATTERY: true } }), "bar");
});
