// Regression tests for the S24 phantom-Q&A defect (2026-09-17 QA cycle).
// Run: npx tsx --test src/app/ai/intake/questionKeyMap.test.ts
//
// Live Cataño auto-repair: the Commercial Vehicle Registration and
// Transportation/PUC Permit cards cited
// "Question: Will commercial vehicles be used? | Answer: Yes" for a question
// the intake never asked. Root cause: the AI interpreter's prefill arrived as
// a PROFILE value (vehicles_used=true), and applyInterpretedIntake only
// flagged discovery-answer keys in aiPrefilledKeys — so answerProvenance
// marked the value "user".
//
// The fix: prefillKeysForPatch() flags both namespaces (answer keys with
// their Q_ ids; profile keys by raw key, resolved through the question's
// writeKey/aliases by kb.ts). These tests pin the helper and the end-to-end
// label behavior. Presentation-only: firing/gating are untouched.
import test from "node:test";
import assert from "node:assert/strict";

import {
  mirrorAnswersToProfile,
  prefillKeysForPatch,
  questionIdForAnswerKey,
} from "./questionKeyMap.ts";
import { computeRequirementsFromKB } from "../../kb.ts";

const AUTO_REPAIR_PROFILE = {
  business_type: "Auto Repair Shop",
  municipality: "Cataño",
  location_type: "Commercial Space",
  number_of_employees: 0,
  business_structure: "Sole Proprietorship",
};

function vehicleReasons(reqs: Array<{ document_id?: string; reason?: string }>) {
  return reqs
    .filter(
      (r) =>
        r.document_id === "DOC_VEHICLE_REGISTRATION" ||
        r.document_id === "DOC_TRANSPORT_PERMIT"
    )
    .map((r) => r.reason ?? "");
}

test("answer keys are flagged with their KB question id (established behavior)", () => {
  const flags = prefillKeysForPatch(["commercial_vehicles"], []);
  assert.ok(flags.includes("commercial_vehicles"));
  assert.ok(flags.includes("Q_COMMERCIAL_VEHICLES"));
});

test("profile keys are flagged by raw key only — no Q_ id, no skip side effects", () => {
  const flags = prefillKeysForPatch([], ["vehicles_used"]);
  assert.ok(flags.includes("vehicles_used"));
  // The Q_ id must NOT be flagged for profile-sourced values: adding it
  // would suppress the guided question via isQuestionPreAnswered, and a
  // profile-sourced prefill has no "answered from description" entry the
  // user could correct it from. Provenance resolves the raw key through
  // the question's writeKey/aliases instead.
  assert.ok(!flags.includes("Q_COMMERCIAL_VEHICLES"));
});

test("profile keys with no KB mapping are inert but harmless", () => {
  const flags = prefillKeysForPatch([], ["business_type", "municipality"]);
  assert.ok(flags.includes("business_type"));
  assert.ok(flags.includes("municipality"));
  assert.equal(questionIdForAnswerKey("business_type"), null);
});

test("profile-sourced prefill renders 'Derived answer:', not 'Answer:'", () => {
  const profile = { ...AUTO_REPAIR_PROFILE, vehicles_used: true };
  const flags = prefillKeysForPatch([], ["vehicles_used"]);
  const reqs = computeRequirementsFromKB(profile, {}, {}, {
    projectIntent: "existing_business",
    aiPrefilledKeys: flags,
  }) as Array<{ document_id?: string; reason?: string }>;
  const reasons = vehicleReasons(reqs);
  assert.ok(reasons.length === 2, `expected 2 vehicle cards, got ${reasons.length}`);
  for (const reason of reasons) {
    assert.match(reason, /Derived answer: Yes/);
    assert.doesNotMatch(reason, /\| Answer: Yes/);
  }
});

test("unflagged values keep the legacy 'Answer:' label (user-provided path)", () => {
  const reqs = computeRequirementsFromKB(
    AUTO_REPAIR_PROFILE,
    { commercial_vehicles: true },
    {},
    { projectIntent: "existing_business", aiPrefilledKeys: [] }
  ) as Array<{ document_id?: string; reason?: string }>;
  const reasons = vehicleReasons(reqs);
  assert.ok(reasons.length === 2, `expected 2 vehicle cards, got ${reasons.length}`);
  for (const reason of reasons) {
    assert.match(reason, /\| Answer: Yes/);
  }
});

test("answer-sourced prefill still renders 'Derived answer:' (a025d1d behavior preserved)", () => {
  const flags = prefillKeysForPatch(["commercial_vehicles"], []);
  const reqs = computeRequirementsFromKB(
    AUTO_REPAIR_PROFILE,
    { commercial_vehicles: true },
    {},
    { projectIntent: "existing_business", aiPrefilledKeys: flags }
  ) as Array<{ document_id?: string; reason?: string }>;
  const reasons = vehicleReasons(reqs);
  assert.ok(reasons.length === 2, `expected 2 vehicle cards, got ${reasons.length}`);
  for (const reason of reasons) {
    assert.match(reason, /Derived answer: Yes/);
  }
});

// Regression: S170 live 2026-09-24 (Arecibo auto-repair). Repairing vehicles
// is not operating commercial vehicles, but both wrote the shared
// profile.vehicles_used field — so every auto-repair shop answering Yes to
// "vehicles repaired" got phantom Commercial Vehicle Registration +
// Transportation/PUC cards citing "Answer: Yes" for the never-asked
// Q_COMMERCIAL_VEHICLES. Same class recurred live 2026-09-17 (Cataño,
// Trujillo Alto); the interpreter-prefill half was fixed by 8242730, this
// pins the mirror half.
test("vehicle_repair does NOT mirror to vehicles_used", () => {
  const mirrored = mirrorAnswersToProfile({ vehicle_repair: true });
  assert.ok(
    !("vehicles_used" in mirrored),
    `vehicle_repair leaked into vehicles_used: ${JSON.stringify(mirrored)}`
  );
  // The genuine mapping is untouched: commercial_vehicles still mirrors.
  assert.equal(mirrorAnswersToProfile({ commercial_vehicles: true }).vehicles_used, true);
});

test("end-to-end: vehicle_repair prefill produces no phantom vehicle cards", () => {
  // Simulates applyInterpretedIntake: mirror the interpreted answers onto
  // the profile, flag prefill keys, then run the engine as the checklist
  // does. Before the fix this produced 2 vehicle cards with "Answer: Yes".
  const answers = { vehicle_repair: true };
  const mirrored = mirrorAnswersToProfile(answers);
  const profile = { ...AUTO_REPAIR_PROFILE, ...mirrored };
  const flags = prefillKeysForPatch(Object.keys(answers), Object.keys(mirrored));
  const reqs = computeRequirementsFromKB(profile, answers, {}, {
    projectIntent: "existing_business",
    aiPrefilledKeys: flags,
  }) as Array<{ document_id?: string; reason?: string }>;
  const reasons = vehicleReasons(reqs);
  assert.equal(reasons.length, 0, `phantom vehicle cards fired: ${JSON.stringify(reasons)}`);
});

// Regression tests for REG-MOBILE-AMBULANT-PROVENANCE-001 (2026-09-28 QA).
// Live Arecibo food truck: the municipal ambulant license (RULE_0653)
// appeared in the non-strict preview, then VANISHED after the user answered
// "Yes" to "Will the business operate from a food truck or mobile unit?".
// Root cause: Q_FOOD_TRUCK_MOBILE was missing from the forward
// QUESTION_KEY_MAP even though the reverse map and buildEngineInput's
// on("food_truck_or_mobile", ...) both know the writeKey. In strict (live)
// mode the structured Yes recorded under the writeKey never inherited
// confirmation — isQuestionConfirmed / isPassportKey / isQuestionAiPrefilled
// all resolve through the forward table — so the fact was quarantined and
// the card gated off. validateInterpretation additionally dropped the AI
// interpreter's Q_FOOD_TRUCK_MOBILE patch ("if (!binding) continue").
// These tests pin the strict-mode end-to-end behavior: a writeKey-confirmed
// Yes keeps the ambulant card; an unconfirmed one gates it (provenance rule).

const FOOD_TRUCK_PROFILE = {
  business_name: "REG-MOBILE-AMBULANT",
  business_type: "Food Truck",
  industry: "Food & Beverage",
  municipality: "Arecibo",
  business_structure: "sole_proprietorship",
  location_type: "Mobile Business",
  number_of_employees: 0,
};

function ambulantCard(reqs: Array<{ document_id?: string }>): boolean {
  return reqs.some((r) => r.document_id === "DOC_AMBULANT_BUSINESS_LICENSE");
}

test("strict mode: writeKey-confirmed food-truck Yes keeps the ambulant card", () => {
  const reqs = computeRequirementsFromKB(
    FOOD_TRUCK_PROFILE,
    { food_truck_or_mobile: true },
    {},
    {
      projectIntent: "new_business",
      sessionId: "sess-reg-mobile-ambulant",
      confirmedKeys: ["food_truck_or_mobile"],
    }
  ) as Array<{ document_id?: string }>;
  assert.ok(
    ambulantCard(reqs),
    "confirmed writeKey Yes must survive the provenance gate (RULE_0653)"
  );
});

test("strict mode: Q-id-confirmed food-truck Yes keeps the ambulant card", () => {
  const reqs = computeRequirementsFromKB(
    FOOD_TRUCK_PROFILE,
    { Q_FOOD_TRUCK_MOBILE: true },
    {},
    {
      projectIntent: "new_business",
      sessionId: "sess-reg-mobile-ambulant",
      confirmedKeys: ["Q_FOOD_TRUCK_MOBILE"],
    }
  ) as Array<{ document_id?: string }>;
  assert.ok(ambulantCard(reqs), "confirmed Q_ id Yes must keep RULE_0653");
});

test("strict mode: unconfirmed food-truck Yes still gates the ambulant card (provenance rule intact)", () => {
  const reqs = computeRequirementsFromKB(
    FOOD_TRUCK_PROFILE,
    { food_truck_or_mobile: true },
    {},
    {
      projectIntent: "new_business",
      sessionId: "sess-reg-mobile-ambulant",
      confirmedKeys: [],
    }
  ) as Array<{ document_id?: string }>;
  assert.ok(
    !ambulantCard(reqs),
    "unconfirmed facts must stay inert in strict mode — the gate itself is correct"
  );
});

test("non-strict baseline: food-truck Yes fires the ambulant card", () => {
  const reqs = computeRequirementsFromKB(
    FOOD_TRUCK_PROFILE,
    { food_truck_or_mobile: true },
    {},
    { projectIntent: "new_business" }
  ) as Array<{ document_id?: string }>;
  assert.ok(ambulantCard(reqs), "non-strict legacy behavior must not change");
});
