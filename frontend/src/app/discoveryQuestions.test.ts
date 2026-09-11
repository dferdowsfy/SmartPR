// Discovery questions are data-driven from the knowledge graph.
// Run: node --experimental-strip-types --test src/app/discoveryQuestions.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { discoveryQuestionsForBusinessType } from "./kb.ts";

const ids = (name: string) => discoveryQuestionsForBusinessType(name)?.map((q) => q.id) ?? [];

test("tire recycling gets its contextual knowledge-graph questions", () => {
  const list = ids("Tire Recycling & Manufacturing");
  // Curated per-type questions, mapped through intakeCompat to wizard keys
  assert.ok(list.includes("products_manufactured"), "manufacturing question");
  assert.ok(list.includes("hazardous_materials"), "hazmat question");
  assert.ok(list.includes("chemicals_used"), "chemicals question");
  assert.ok(list.includes("employees_hired"), "writeKey-mapped employees question");
  // New KB questions keep their KB id (buildEngineInput passes them through)
  assert.ok(list.includes("Q_HAZARDOUS_STORAGE"));
  assert.ok(list.includes("Q_HAZMAT_TRANSPORT"));
  assert.ok(list.includes("Q_ENVIRONMENTAL_IMPACT"));
  assert.ok(list.includes("Q_PRODUCTS_DISTRIBUTED"));
  // Profile-stage facts (asked in business basics) are never repeated
  assert.ok(!list.includes("Q_BUSINESS_STRUCTURE"));
  assert.ok(!list.includes("Q_PHYSICAL_LOCATION"));
  assert.ok(!list.includes("Q_LOCATION_TYPE"));
  assert.ok(!list.includes("Q_EMPLOYEE_COUNT"));
  // Not the generic 4-question fallback
  assert.ok(!list.includes("professional_licenses_required"));
});

test("question text comes from the knowledge graph", () => {
  const list = discoveryQuestionsForBusinessType("Tire Recycling & Manufacturing");
  const byId = new Map((list ?? []).map((q) => [q.id, q.text]));
  assert.equal(byId.get("chemicals_used"), "Will chemicals be used or stored in production?");
});

test("unknown business type returns null so callers use the hardcoded fallback", () => {
  assert.equal(discoveryQuestionsForBusinessType("Quantum Banana Stand"), null);
  assert.equal(discoveryQuestionsForBusinessType(undefined), null);
});

test("other covered types get their own contextual set, not a generic list", () => {
  const restaurant = ids("Restaurant");
  assert.ok(restaurant.length > 4, "restaurant has a full contextual set");
  assert.ok(restaurant.includes("food_prepared_on_site") || restaurant.includes("food_sold"));
  const it = ids("Software Company");
  assert.ok(it.length > 0);
  assert.ok(!it.includes("hazardous_materials"), "software does not get hazmat questions");
});
