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
