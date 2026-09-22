// Regression: QA 2026-09-22 12:00 cycle (live audit S135).
//
// A gym with a smoothie bar established Q_FOOD_SERVED=true but was never
// asked Q_FOOD_PREPARED — 40 business-type discovery lists ask about food
// served/sold without ever asking whether food is prepared on-site. The
// verified food-preparation pathway (RULE_0009 Health, RULE_0010 CFPM,
// RULE_0011 Fire) keys on Q_FOOD_PREPARED, so production generated only the
// demoted heuristic RULE_0244 card. needsFoodPrepFollowUp() is the
// deterministic guard: food involvement established + preparation unknown +
// question not already listed => ask Q_FOOD_PREPARED.
// Run: npx tsx --test src/app/foodPrepFollowUp.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  needsFoodPrepFollowUp,
  FOOD_PREP_FOLLOW_UP_QUESTION_ID,
  buildFoodPrepFollowUpQuestion,
} from "./SmartPRIntake.tsx";

test("food served=true arms the Q_FOOD_PREPARED follow-up", () => {
  assert.equal(
    needsFoodPrepFollowUp({ food_served: true }, ["customers_visit", "food_served"]),
    true,
    "serving food with preparation unknown must ask Q_FOOD_PREPARED"
  );
  assert.equal(
    needsFoodPrepFollowUp({ Q_FOOD_SERVED: true }, ["Q_FOOD_SERVED"]),
    true,
    "KB-id vocabulary must also arm the follow-up"
  );
});

test("food sold=true arms the Q_FOOD_PREPARED follow-up", () => {
  assert.equal(
    needsFoodPrepFollowUp({ food_sold: true }, ["food_sold"]),
    true,
    "selling food with preparation unknown must ask Q_FOOD_PREPARED"
  );
});

test("no follow-up once preparation is answered", () => {
  assert.equal(
    needsFoodPrepFollowUp(
      { food_served: true, food_prepared_on_site: false },
      ["customers_visit", "food_served"]
    ),
    false,
    "an answered preparation question must not be re-asked"
  );
  assert.equal(
    needsFoodPrepFollowUp({ Q_FOOD_SERVED: true, Q_FOOD_PREPARED: true }, ["Q_FOOD_SERVED"]),
    false,
    "KB-id answered preparation must not be re-asked"
  );
});

test("no follow-up when the question is already in the list", () => {
  assert.equal(
    needsFoodPrepFollowUp(
      { food_served: true },
      ["food_served", FOOD_PREP_FOLLOW_UP_QUESTION_ID]
    ),
    false,
    "must not duplicate a listed follow-up"
  );
});

test("no follow-up without food involvement", () => {
  assert.equal(needsFoodPrepFollowUp({}, ["customers_visit"]), false);
  assert.equal(
    needsFoodPrepFollowUp({ food_served: false }, ["food_served"]),
    false,
    "an explicit No on serving must not arm the follow-up"
  );
  assert.equal(
    needsFoodPrepFollowUp({ employees_hired: true }, ["employees_hired"]),
    false
  );
});

test("the built follow-up reuses the KB's canonical Q_FOOD_PREPARED text", () => {
  const q = buildFoodPrepFollowUpQuestion();
  assert.equal(q.id, FOOD_PREP_FOLLOW_UP_QUESTION_ID);
  assert.equal(q.text, "Will food be prepared on-site?");
});
