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
  // Validated review 2026-09-16: with tenure entirely unknown the lease
  // question is needs_more_information (intake must ask ownership/tenure
  // first), not conditional.
  assert.ok(
    lease.every((r) => r.applicability === "needs_more_information"),
    "lease may only appear as needs_more_information while tenure is unknown"
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

test("lease: unknown lease + physical location → needs_more_information with inline-answer marker", () => {
  const reqs = computeRequirementsFromKB(RESTAURANT, {}, {});
  const lease = reqs.find((r) => r.document_id === "DOC_LEASE_AGREEMENT");
  assert.ok(lease, "lease requirement is surfaced while the answer is unknown");
  // Validated review 2026-09-16: tenure unknown means the intake must ask
  // ownership/tenure first — needs_more_information, not conditional.
  assert.equal(lease!.applicability, "needs_more_information");
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

test("lease: explicit Yes → supporting evidence with Answer: Yes (not a standalone requirement)", () => {
  const answers = { existing_lease: true };
  const reqs = computeRequirementsFromKB(RESTAURANT, answers, {});
  const lease = reqs.find((r) => r.document_id === "DOC_LEASE_AGREEMENT");
  assert.ok(lease, "lease surfaces after a Yes");
  // A lease is supporting evidence for the application, not an independent
  // regulatory requirement — it must never present as a mandatory filing.
  assert.equal(lease!.applicability, "supporting_evidence");
  assert.equal(lease!.mandatory, false);
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

test("provenance: location-derived physical/home/online values render as Derived answer, never Answer", () => {
  // 2026-09-17 QA (live S4/S5/S6): requirement cards cited "Question: Will
  // the business operate from a physical location? | Answer: Yes" and
  // "Question: Will the business be operated from a home? | Answer: Yes"
  // for users who were never asked those questions — the values came from
  // the location-type dropdown, not from answers. The location model is a
  // translation of a dropdown choice, so its values are derived.
  const mobile = engineInputFor({
    business_type: "Food Truck",
    municipality: "Arecibo",
    location_type: "Mobile Business",
  });
  const mobileRule = runRulesEngine(KB, mobile).debug.rulesMatched.find(
    (r) => r.rule_id === "RULE_0007"
  );
  assert.ok(mobileRule, "Permiso Único fires for the mobile vendor via the location-derived physical value");
  assert.ok(
    mobileRule!.reason.includes("Derived answer:"),
    `location-derived value labeled honestly: ${mobileRule!.reason}`
  );
  assert.ok(!mobileRule!.reason.includes("| Answer:"), "never presented as the user's answer");

  const home = engineInputFor({
    business_type: "Bookkeeping Service",
    municipality: "San Juan",
    location_type: "Home-Based Business",
  });
  const homeRule = runRulesEngine(KB, home).debug.rulesMatched.find(
    (r) => r.rule_id === "RULE_0652"
  );
  assert.ok(homeRule, "domiciliary-use pathway fires for the home-based business");
  assert.ok(homeRule!.reason.includes("Derived answer:"), homeRule!.reason);
  assert.ok(!homeRule!.reason.includes("| Answer:"), "never presented as the user's answer");
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

// --- 7. Home-based is not a nonresidential physical location (REG-HOME-PHYSICAL-001) ---
//
// 2026-09-16 QA (Carolina home-based bookkeeper): buildEngineInput set
// Q_PHYSICAL_LOCATION=true for ANY known non-online location, including
// "Home-Based Business". That fired RULE_0007 (Permiso Único) and RULE_0008
// (Zoning) whose own trigger text says "Nonresidential business location" —
// a direct contradiction of the home-based fact. Q_PHYSICAL_LOCATION means a
// nonresidential commercial premises, so a home-based location must resolve
// it to false, never true.

const HOME_BOOKKEEPER = {
  business_type: "Bookkeeping Service",
  municipality: "Carolina",
  location_type: "Home-Based Business",
  number_of_employees: 0,
};

test("home-based: Q_PHYSICAL_LOCATION is false, never true", () => {
  const input = engineInputFor(HOME_BOOKKEEPER, { employees_hired: false });
  assert.equal(input.answers["Q_PHYSICAL_LOCATION"], false);
  assert.equal(input.answers["Q_HOME_BASED"], true);
});

test("home-based: Permiso Único and Zoning rules do not fire (REG-HOME-PHYSICAL-001)", () => {
  const input = engineInputFor(HOME_BOOKKEEPER, { employees_hired: false });
  const debug = runRulesEngine(KB, input).debug;
  const matched = debug.rulesMatched.map((r) => r.rule_id);
  assert.ok(!matched.includes("RULE_0007"), "RULE_0007 (Permiso Único) must not fire for a home-based business");
  assert.ok(!matched.includes("RULE_0008"), "RULE_0008 (Zoning) must not fire for a home-based business");
  const reqs = computeRequirementsFromKB(HOME_BOOKKEEPER, { employees_hired: false }, {});
  const docs = reqs.map((r) => r.document_id);
  assert.ok(!docs.includes("DOC_PERMISO_UNICO"), "no Permiso Único requirement for a home-based business");
  assert.ok(!docs.includes("DOC_ZONING"), "no Zoning requirement for a home-based business");
});

test("home-based neighbors: commercial, online-only and unknown locations unchanged", () => {
  // Commercial premises still count as a physical (nonresidential) location.
  assert.equal(
    engineInputFor({ ...HOME_BOOKKEEPER, location_type: "Restaurant Location" }).answers["Q_PHYSICAL_LOCATION"],
    true
  );
  // Online-only has no physical premises.
  assert.equal(
    engineInputFor({ ...HOME_BOOKKEEPER, location_type: "Online Only" }).answers["Q_PHYSICAL_LOCATION"],
    false
  );
  // A location the user never chose stays unknown — never invented.
  assert.equal(
    engineInputFor({ business_type: "Bookkeeping Service", municipality: "Carolina" }).answers["Q_PHYSICAL_LOCATION"],
    undefined
  );
});

// --- 7b. REG-HOME-PHYSICAL-001 order-dependence (2026-09-16 evening QA) ---
//
// computeRequirementsFromSnapshot re-asserts the caller's raw answers over
// buildEngineInput's permit-model correction. The intake model deliberately
// records Q_PHYSICAL_LOCATION=true for a home ("a home is a physical
// place"), so without the re-applied correction a home-based business got
// RULE_0007 (Permiso Único) and RULE_0008 (Zoning) as REQUIRED — the exact
// bug REG-HOME-PHYSICAL-001 was supposed to kill.
test("home-based: raw Q_PHYSICAL_LOCATION=true in answers does not defeat the correction (order-dependence)", () => {
  const reqs = computeRequirementsFromKB(
    HOME_BOOKKEEPER,
    { Q_HOME_BASED: true, Q_PHYSICAL_LOCATION: true, employees_hired: false },
    {}
  );
  const docs = reqs.map((r) => r.document_id);
  assert.ok(!docs.includes("DOC_PERMISO_UNICO"), "no Permiso Único even when raw answers carry Q_PHYSICAL_LOCATION=true");
  assert.ok(!docs.includes("DOC_ZONING"), "no Zoning even when raw answers carry Q_PHYSICAL_LOCATION=true");
});

test("home-based: non-home business with Q_PHYSICAL_LOCATION=true still fires the premises rules", () => {
  const reqs = computeRequirementsFromKB(
    { ...HOME_BOOKKEEPER, location_type: "Commercial Office" },
    { Q_PHYSICAL_LOCATION: true, employees_hired: false },
    {}
  );
  const docs = reqs.map((r) => r.document_id);
  assert.ok(docs.includes("DOC_PERMISO_UNICO"), "commercial premises still trigger Permiso Único");
});

// --- 7. Interpreter pre-answers never render as the user's own answer -------
 // 2026-09-17 06:00 QA cycle (live S7, Trujillo Alto): a vehicle-registration
 // card cited "Question: Will commercial vehicles be used? | Answer: Yes"
 // for a question the guided flow never asked — the intake interpreter had
 // pre-answered it from the business description (aiPrefilledKeys). "Answer:"
 // is reserved for answers the user actually provided; interpreter
 // pre-answers must render as "Derived answer:".

test("ai-prefill: interpreter-answered questions render 'Derived answer', never 'Answer: Yes'", () => {
  const answers = { Q_COMMERCIAL_VEHICLES: true };
  const prefilled = computeRequirementsFromKB(RESTAURANT, answers, {}, {
    aiPrefilledKeys: ["Q_COMMERCIAL_VEHICLES"],
  });
  const vehicle = prefilled.filter((r) => r.document_id === "DOC_VEHICLE_REGISTRATION");
  assert.ok(vehicle.length > 0, "vehicle registration still triggers from the prefilled answer");
  for (const r of vehicle) {
    assert.ok(!r.reason.includes("| Answer:"), `prefilled answer must not render as the user's answer: ${r.reason}`);
    assert.ok(r.reason.includes("Derived answer:"), `prefilled answer renders honestly: ${r.reason}`);
  }

  // Control: the same answer with no aiPrefilledKeys keeps the user's label.
  const manual = computeRequirementsFromKB(RESTAURANT, answers, {}, {});
  const manualVehicle = manual.filter((r) => r.document_id === "DOC_VEHICLE_REGISTRATION");
  assert.ok(manualVehicle.length > 0, "vehicle registration still triggers from a manual answer");
  for (const r of manualVehicle) {
    assert.ok(r.reason.includes("| Answer: Yes"), `manual answer keeps the user label: ${r.reason}`);
  }
});

// 2026-09-17 15:00 QA cycle (live Trujillo Alto auto-repair retest): the
// vehicle card still cited "Question: Will commercial vehicles be used? |
// Answer: Yes" for a question never asked. Root cause: the intake registers
// prefilled answers by writeKey (commercial_vehicles), but answerProvenance
// only matched the Q_ id form — so the value slipped through as "user".
// The engine must recognize the writeKey/alias forms too, not just Q_ ids.
test("ai-prefill: writeKey-form prefill keys also render 'Derived answer'", () => {
  const answers = { Q_COMMERCIAL_VEHICLES: true };
  const prefilled = computeRequirementsFromKB(RESTAURANT, answers, {}, {
    aiPrefilledKeys: ["commercial_vehicles"],
  });
  const vehicle = prefilled.filter((r) => r.document_id === "DOC_VEHICLE_REGISTRATION");
  assert.ok(vehicle.length > 0, "vehicle registration still triggers from the prefilled answer");
  for (const r of vehicle) {
    assert.ok(!r.reason.includes("| Answer:"), `writeKey prefill must not render as the user's answer: ${r.reason}`);
    assert.ok(r.reason.includes("Derived answer:"), `writeKey prefill renders honestly: ${r.reason}`);
  }

  // Alias form as well (vehicles_used is an alias of the same question).
  const aliased = computeRequirementsFromKB(RESTAURANT, answers, {}, {
    aiPrefilledKeys: ["vehicles_used"],
  });
  const aliasedVehicle = aliased.filter((r) => r.document_id === "DOC_VEHICLE_REGISTRATION");
  assert.ok(aliasedVehicle.length > 0, "vehicle registration still triggers from the aliased prefill");
  for (const r of aliasedVehicle) {
    assert.ok(!r.reason.includes("| Answer:"), `alias prefill must not render as the user's answer: ${r.reason}`);
    assert.ok(r.reason.includes("Derived answer:"), `alias prefill renders honestly: ${r.reason}`);
  }
});
