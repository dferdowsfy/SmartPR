import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import businessTypes from "../../../kb/business_types.json";
import industries from "../../../kb/industries.json";
import { PROJECT_ILLUSTRATIONS, selectProjectIllustration } from "./projectIllustrations";

test("every selected illustration has a shipped asset, including the full business-type catalog", () => {
  for (const src of Object.values(PROJECT_ILLUSTRATIONS)) {
    assert.equal(existsSync(path.join(process.cwd(), "public", src)), true, src);
  }
  const industryNames = new Map(industries.map((industry) => [industry.id, industry.name]));
  const intakeIndustryNames: Record<string, string> = {
    IND_TOURISM: "Accommodation & Tourism",
    IND_GOVCON: "Government Contractor",
    IND_NONPROFIT: "Nonprofit / Religious Organization",
  };
  const neutral: string[] = [];
  for (const type of businessTypes) {
    const key = selectProjectIllustration({
      businessType: type.name,
      industry: intakeIndustryNames[type.industry_id] || industryNames.get(type.industry_id),
    });
    assert.ok(PROJECT_ILLUSTRATIONS[key], type.id);
    if (key === "default") neutral.push(type.name);
  }
  assert.deepEqual(neutral.sort(), ["Car Rental Business", "Excursion Company", "Religious Organization", "Taxi Service"]);
});

test("specific business types stay distinct and unknowns remain neutral", () => {
  assert.equal(selectProjectIllustration({ businessType: "Restaurant", industry: "Food & Beverage" }), "restaurant");
  assert.equal(selectProjectIllustration({ businessType: "Bar", industry: "Food & Beverage" }), "bar");
  assert.equal(selectProjectIllustration({ businessType: "Juice Bar", industry: "Food & Beverage" }), "restaurant");
  assert.equal(selectProjectIllustration({ businessType: "Liquor Store", industry: "Food & Beverage" }), "retail");
  assert.equal(selectProjectIllustration({ businessType: "Pharmacy", industry: "Healthcare" }), "retail");
  assert.equal(selectProjectIllustration({ businessType: "Auto Repair Shop", industry: "Automotive" }), "garage");
  assert.equal(selectProjectIllustration({ businessType: "Food Truck", industry: "Food & Beverage" }), "foodTruck");
  assert.equal(selectProjectIllustration({ businessType: "Beauty Salon", industry: "Beauty & Personal Care" }), "salon");
  assert.equal(selectProjectIllustration({ businessType: "Private School", industry: "Education & Training" }), "school");
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

test('confirmed request facts select images without any manually selected business type', () => {
  const fact = (value: string) => ({ value, source: 'explicit', confidence: 0.99 });
  assert.equal(selectProjectIllustration({ scenario: { operations: { activity: fact('restaurant') } } }), 'restaurant');
  assert.equal(selectProjectIllustration({ scenario: { property: { proposedUse: fact('bar') } } }), 'bar');
  assert.equal(selectProjectIllustration({ businessType: 'Bar', scenario: { property: { proposedUse: fact('restaurant / food service') } } }), 'bar');
  assert.equal(selectProjectIllustration({ businessType: 'Warehouse Operator', scenario: { property: { proposedUse: fact('restaurant'), existingUse: fact('warehouse') } } }), 'restaurant');
  assert.equal(selectProjectIllustration({ projectContext: { generation_technology: { value: 'solar', confidence: 0.99 }, existing_use: { value: 'warehouse', confidence: 0.99 } } }), 'solarWarehouse');
  assert.equal(selectProjectIllustration({ projectContext: { generation_technology: { value: 'solar', confidence: 0.65 } } }), 'default');
  assert.equal(selectProjectIllustration({ scenario: { operations: { activity: { value: 'restaurant', source: 'inferred', confidence: 0.75 } } } }), 'default');
  assert.equal(existsSync(path.join(process.cwd(), 'public/illustrations/projects/solar.png')), false);
});
