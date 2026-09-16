/**
 * Lease-answer honesty (2026-09-16).
 *
 * Regression suite for the invented-lease bug: the requirements page showed
 * "Lease Agreement — Question: … | Answer: Yes" for a user who was never
 * asked whether they lease. `buildEngineInput` used to assert
 * `Q_EXISTING_LEASE` from a bare physical location; the lease question did
 * not even exist in the discovery flow.
 *
 * Invariants pinned here:
 *  1. An unanswered lease stays UNKNOWN — never true, never "Answer: Yes".
 *  2. The lease question exists in the discovery flow (bundled + fallback).
 *  3. Unknown lease + physical location renders a conditional
 *     "more information needed" requirement with an inline answer control,
 *     never a REQUIRED lease.
 *  4. A real Yes produces REQUIRED with "Answer: Yes"; a real No removes it.
 *  5. "Answer:" is reserved for user-provided answers; engine derivations
 *     render as "Derived answer".
 *  6. No adapter default invents an unanswered boolean (location trio stays
 *     unknown when no location was chosen).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  KB,
  buildEngineInput,
  computeRequirementsFromKB,
  discoveryQuestionsForBusinessType,
  UNANSWERED_TRIGGER_QUESTIONS,
} from "./kb";
import { runRulesEngine } from "./rulesEngine";
import { resolveIntakeFacts } from "./ai/intake/relationships";
import { buildRequirementGuidance } from "./requirementGuidance";

const RESTAURANT = {
  business_type: "Restaurant",
  municipality: "San Juan",
  location_type: "Restaurant Location",
};

function engineInputFor(profile: Record<string, unknown>, answers: Record<string, unknown> = {}) {
  const resolved = resolveIntakeFacts(
    { profile, answers },
    { kb: KB, allowedIndustries: undefined }
  );
  return buildEngineInput(profile, answers, resolved.questionValues);
}

// --- 1. Unanswered lease stays unknown -------------------------------------

test("lease: unanswered lease is undefined, never invented as Yes", () => {
  const input = engineInputFor(RESTAURANT);
  assert.equal(input.answers["Q_EXISTING_LEASE"], undefined);
  assert.equal(input.answerProvenance?.["Q_EXISTING_LEASE"], undefined);
});

test("lease: physical location alone no longer triggers the lease document", () => {
  const reqs = computeRequirementsFromKB(RESTAURANT, {}, {});
  const lease = reqs.filter((r) => r.document_id === "DOC_LEASE_AGREEMENT");
  assert.ok(
    lease.every((r) => r.applicability === "conditional"),
    "lease may only appear as conditional while the answer is unknown"
  );
  for (const r of lease) {
    assert.ok(!r.reason.includes("Answer:"), `no invented answer in reason: ${r.reason}`);
  }
});

test("lease: empty profile invents no affirmative answers", () => {
  const input = engineInputFor({});
  for (const [k, v] of Object.entries(input.answers)) {
    assert.notEqual(v, true, `${k} must not default to true when unanswered`);
  }
  assert.equal(input.answers["Q_PHYSICAL_LOCATION"], undefined);
  assert.equal(input.answers["Q_HOME_BASED"], undefined);
  assert.equal(input.answers["Q_ONLINE_ONLY"], undefined);
});

// --- 2. The lease question exists in the discovery flow --------------------

test("lease: bundled discovery includes the lease question for physical businesses", () => {
  const ids = (discoveryQuestionsForBusinessType("Restaurant") ?? []).map((q) => q.id);
  assert.ok(ids.includes("existing_lease"), "bundled Restaurant flow asks about the lease");
});

test("lease: unanswered-trigger registry covers the lease question", () => {
  const entry = UNANSWERED_TRIGGER_QUESTIONS.find((t) => t.questionId === "Q_EXISTING_LEASE");
  assert.ok(entry, "Q_EXISTING_LEASE is a curated unanswered-trigger question");
  assert.equal(entry!.writeKey, "existing_lease");
});

// --- 3. Unknown lease renders conditional "more information needed" --------

test("lease: unknown lease + physical location → conditional with inline-answer marker", () => {
  const reqs = computeRequirementsFromKB(RESTAURANT, {}, {});
  const lease = reqs.find((r) => r.document_id === "DOC_LEASE_AGREEMENT");
  assert.ok(lease, "lease requirement is surfaced while the answer is unknown");
  assert.equal(lease!.applicability, "conditional");
  assert.equal(lease!.mandatory, false);
  assert.equal(lease!.unansweredTriggerQuestionId, "Q_EXISTING_LEASE");
  assert.ok(!lease!.reason.includes("Answer:"), "no answer is claimed");
  assert.ok(
    lease!.triggerFacts?.includes("unanswered:Q_EXISTING_LEASE"),
    "trigger facts name the unknown question"
  );
});

test("lease: unknown lease + online-only location → no lease requirement at all", () => {
  const reqs = computeRequirementsFromKB(
    { ...RESTAURANT, location_type: "Online Only" },
    {},
    {}
  );
  assert.ok(
    !reqs.some((r) => r.document_id === "DOC_LEASE_AGREEMENT"),
    "a lease is impossible without a physical location"
  );
});

// --- 4. Real answers drive the real requirement ----------------------------

test("lease: explicit Yes → REQUIRED with Answer: Yes", () => {
  const answers = { existing_lease: true };
  const reqs = computeRequirementsFromKB(RESTAURANT, answers, {});
  const lease = reqs.find((r) => r.document_id === "DOC_LEASE_AGREEMENT");
  assert.ok(lease, "lease is required after a Yes");
  assert.equal(lease!.applicability, "required");
  assert.equal(lease!.mandatory, true);
  assert.equal(lease!.unansweredTriggerQuestionId, undefined);
  assert.ok(lease!.reason.includes("Answer: Yes"), `reason names the user's answer: ${lease!.reason}`);
});

test("lease: explicit No → no lease requirement, no conditional", () => {
  const answers = { existing_lease: false };
  const reqs = computeRequirementsFromKB(RESTAURANT, answers, {});
  assert.ok(
    !reqs.some((r) => r.document_id === "DOC_LEASE_AGREEMENT"),
    "an explicit No is a real answer: the requirement goes away"
  );
});

// --- 5. "Answer:" is reserved for user-provided answers ---------------------

test("provenance: derived values render as Derived answer, never Answer", () => {
  // A bar "sells alcohol by definition" — a resolver derivation, not an answer.
  const input = engineInputFor({ business_type: "Bar", municipality: "San Juan", location_type: "Restaurant Location" });
  const debug = runRulesEngine(KB, input).debug;
  const alcoholRule = debug.rulesMatched.find((r) => r.rule_id === "RULE_0013");
  assert.ok(alcoholRule, "alcohol rule fires on the derived value");
  assert.ok(
    alcoholRule!.reason.includes("Derived answer:"),
    `derived value labeled honestly: ${alcoholRule!.reason}`
  );
  assert.ok(!alcoholRule!.reason.includes("| Answer:"), "never presented as the user's answer");
});

test("provenance: a real user answer still renders as Answer: Yes", () => {
  const input = engineInputFor(
    { business_type: "Bar", municipality: "San Juan", location_type: "Restaurant Location" },
    { alcohol_sold: true }
  );
  const debug = runRulesEngine(KB, input).debug;
  const alcoholRule = debug.rulesMatched.find((r) => r.rule_id === "RULE_0013");
  assert.ok(alcoholRule, "alcohol rule fires on the user's answer");
  assert.ok(alcoholRule!.reason.includes("| Answer: Yes"), alcoholRule!.reason);
});

// --- 6. Guidance stays provisional while the lease is unknown --------------

test("lease: guidance is provisional while the lease answer is unknown", () => {
  const reqs = computeRequirementsFromKB(RESTAURANT, {}, {});
  const lease = reqs.find((r) => r.document_id === "DOC_LEASE_AGREEMENT");
  assert.ok(lease, "conditional lease requirement exists");
  const guidance = buildRequirementGuidance(
    {
      document_id: lease!.document_id,
      code: lease!.code,
      name: lease!.name,
      agency: lease!.agency,
      reason: lease!.reason,
      applicability: lease!.applicability,
      triggerFacts: lease!.triggerFacts,
    },
    {
      language: "en",
      municipality: "San Juan",
      businessTypeName: "Restaurant",
      discoveryAnswers: {},
      profile: RESTAURANT as unknown as Record<string, unknown>,
    }
  );
  assert.notEqual(guidance.status, "VALIDATED", "unknown lease must not validate guidance");
});
