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
