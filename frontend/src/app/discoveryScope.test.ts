// Run: npx tsx --test src/app/discoveryScope.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { discoveryQuestionsForBusinessType } from "./kb";

const ids = (bt: string) => (discoveryQuestionsForBusinessType(bt) ?? []).map((q) => q.id);

test("restaurant: no construction-contracting or federal-contracts questions", () => {
  const q = ids("Restaurant");
  assert.ok(q.length > 5, "restaurant still has its discovery questions");
  assert.ok(!q.includes("Q_OFFERS_CONSTRUCTION_SERVICES"));
  assert.ok(!q.includes("Q_FEDERAL_CONTRACTS_GRANTS"));
  assert.ok(q.includes("Q_FOOD_PREPARED") || q.some((id) => /food/i.test(id)), q.join(","));
});

test("nail salon and clothing store: neither question", () => {
  for (const bt of ["Nail Salon", "Clothing Store"]) {
    const q = ids(bt);
    assert.ok(!q.includes("Q_OFFERS_CONSTRUCTION_SERVICES") && !q.includes("Q_FEDERAL_CONTRACTS_GRANTS"), bt);
  }
});

test("contractors still get both; consulting firm gets federal contracts only", () => {
  for (const bt of ["General Contractor", "Solar Installer"]) {
    const q = ids(bt);
    assert.ok(q.includes("Q_OFFERS_CONSTRUCTION_SERVICES"), bt);
    assert.ok(q.includes("Q_FEDERAL_CONTRACTS_GRANTS"), bt);
  }
  const c = ids("Consulting Firm");
  assert.ok(c.includes("Q_FEDERAL_CONTRACTS_GRANTS") && !c.includes("Q_OFFERS_CONSTRUCTION_SERVICES"));
  assert.ok(ids("Nonprofit Organization").includes("Q_FEDERAL_CONTRACTS_GRANTS"));
});

test("G10: tour operator / kayak rental: no overnight or short-term-rental questions", () => {
  for (const bt of ["Tour Operator", "Water Sports & Watercraft Rental", "Excursion Company", "Car Rental Business"]) {
    const q = ids(bt);
    assert.ok(!q.some((id) => /guest|overnight|short_term_rental/i.test(id)), `${bt}: ${q.join(",")}`);
  }
  const hotel = ids("Hotel");
  assert.ok(hotel.some((id) => /guest|overnight|short_term/i.test(id)), hotel.join(","));
});

test("G10: hardware store: no food-sold question; bakery still has it", () => {
  assert.ok(!ids("Hardware Store").some((id) => /food_sold/i.test(id)));
  assert.ok(!ids("Clothing Store").some((id) => /food_sold/i.test(id)));
  assert.ok(ids("Bakery").some((id) => /food/i.test(id)));
  assert.ok(ids("Restaurant").some((id) => /food/i.test(id)));
});
