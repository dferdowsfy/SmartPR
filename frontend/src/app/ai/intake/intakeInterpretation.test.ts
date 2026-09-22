// Tests for the AI-assisted natural-language intake.
// Run: node --experimental-strip-types --test src/app/ai/intake/intakeInterpretation.test.ts
//
// The model is stubbed: these tests verify the deterministic layers around it —
// KB candidate retrieval, validation of returned ids, confidence policy, the
// mapping onto EXISTING intake values, and that requirements still come from the
// existing rules engine rather than from the model.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { runRulesEngine, type EngineInput, type KnowledgeBase } from "../../rulesEngine.ts";
import { buildKbCandidates } from "./kbCandidates.ts";
import { QUESTION_KEY_MAP } from "./questionKeyMap.ts";
import {
  validateInterpretation,
  toIntakePatch,
  classifyConfidence,
  coerceAnswerValue,
  type RawInterpretation,
} from "./validateInterpretation.ts";
import { mirrorAnswersToProfile } from "./questionKeyMap.ts";

const here = dirname(fileURLToPath(import.meta.url));
const kbDir = join(here, "..", "..", "..", "kb");
const load = (f: string) => JSON.parse(readFileSync(join(kbDir, f), "utf8"));
const KB: KnowledgeBase = {
  municipalities: load("municipalities.json"),
  businessTypes: load("business_types.json"),
  questions: load("questions.json"),
  documents: load("documents.json"),
  rules: load("rules.json"),
};

const INDUSTRIES = ["Food & Beverage", "Professional Services", "Healthcare", "Retail"];

// `kb.ts` cannot be imported here (it pulls in JSON modules that need import
// attributes under node --test), so the binding between our write keys and
// buildEngineInput() is verified against its SOURCE instead. That catches drift
// without duplicating the mapping logic in a stub.
const KB_TS_SOURCE = readFileSync(join(here, "..", "..", "kb.ts"), "utf8");

/**
 * Run the REAL rules engine over KB question answers. Requirements always come
 * from rules.json — never from the model.
 */
function runEngineWithAnswers(
  answers: Record<string, boolean | string>,
  businessTypeName?: string,
  municipalityName = "San Juan"
): string[] {
  const input: EngineInput = { municipalityName, businessTypeName: businessTypeName ?? null, answers };
  return runRulesEngine(KB, input).debug.documentsGenerated;
}

/** Validate + convert to an intake patch, the way the UI does. */
function interpret(raw: RawInterpretation) {
  const validated = validateInterpretation(raw, KB, { allowedIndustries: INDUSTRIES });
  // The UI passes the active KB so the patch can reconcile contradictory model
  // answers and drop chips that restate a fact another chip already implies.
  return { validated, patch: toIntakePatch(validated, { kb: KB, allowedIndustries: INDUSTRIES }) };
}

// --- 1–2: business type + municipality resolution --------------------------

test("1. restaurant in San Juan populates business type and municipality", () => {
  const { patch } = interpret({
    businessType: { id: "BT_RESTAURANT", name: "Restaurant", confidence: 0.96 },
    municipality: { value: "San Juan", confidence: 0.99 },
  });
  assert.equal(patch.profile.business_type, "Restaurant");
  assert.equal(patch.profile.municipality, "San Juan");
});

test("2. a coffee shop surfaces the existing Cafe business type as a candidate", () => {
  const candidates = buildKbCandidates(KB, "I want to open a coffee shop in San Juan");
  const ids = candidates.businessTypes.map((b) => b.id);
  assert.ok(ids.includes("BT_CAFE"), `expected BT_CAFE among candidates, got ${ids.join(", ")}`);
  assert.deepEqual(candidates.municipalities, ["San Juan"]);
  // And the model choosing it resolves to the real KB name.
  const { patch } = interpret({ businessType: { id: "BT_CAFE", name: "Cafe", confidence: 0.9 } });
  assert.equal(patch.profile.business_type, "Cafe");
});

// --- 3–5: stated vs negated vs unmentioned --------------------------------

test("3. \"with outdoor seating\" sets the outdoor seating answer to true", () => {
  const { patch } = interpret({
    answers: [{ questionId: "Q_OUTDOOR_SEATING", value: true, confidence: 0.99 }],
  });
  assert.equal(patch.answers.outdoor_seating, true);
});

test("4. \"without outdoor seating\" sets it to false", () => {
  const { patch } = interpret({
    answers: [{ questionId: "Q_OUTDOOR_SEATING", value: false, confidence: 0.95 }],
  });
  assert.equal(patch.answers.outdoor_seating, false);
});

test("5. outdoor seating not mentioned stays undefined (unknown, not false)", () => {
  const { patch } = interpret({
    businessType: { id: "BT_RESTAURANT", name: "Restaurant", confidence: 0.96 },
  });
  assert.equal(patch.answers.outdoor_seating, undefined);
  assert.ok(!("outdoor_seating" in patch.answers));
});

// --- 6–7: alcohol ----------------------------------------------------------

test("6. \"serve wine\" populates the alcohol-served question", () => {
  const candidates = buildKbCandidates(KB, "a cafe in Ponce where we serve wine");
  const qids = candidates.questions.map((q) => q.id);
  assert.ok(qids.includes("Q_ALCOHOL_SERVED"), "alcohol-served must be offered as a candidate");

  const { patch } = interpret({
    answers: [{ questionId: "Q_ALCOHOL_SERVED", value: true, confidence: 0.98 }],
  });
  assert.equal(patch.answers.alcohol_served, true);
  // Serving is not the same claim as selling — that stays unknown.
  assert.equal(patch.answers.alcohol_sold, undefined);
});

test("7. alcohol not mentioned leaves every alcohol answer undefined", () => {
  const { patch } = interpret({
    businessType: { id: "BT_CAFE", name: "Cafe", confidence: 0.94 },
    answers: [{ questionId: "Q_FOOD_SERVED", value: true, confidence: 0.9 }],
  });
  assert.equal(patch.answers.alcohol_sold, undefined);
  assert.equal(patch.answers.alcohol_served, undefined);
});

// --- 8: home-based consulting ---------------------------------------------

test("8. home-based consulting maps to a consulting type and home-based location", () => {
  const candidates = buildKbCandidates(KB, "a home-based consulting company in Caguas");
  const ids = candidates.businessTypes.map((b) => b.id);
  assert.ok(ids.includes("BT_CONSULTING_FIRM"), `expected consulting candidate, got ${ids.join(", ")}`);
  assert.ok(candidates.questions.some((q) => q.id === "Q_HOME_BASED"));

  const { patch } = interpret({
    businessType: { id: "BT_CONSULTING_FIRM", name: "Consulting Firm", confidence: 0.91 },
    answers: [{ questionId: "Q_HOME_BASED", value: true, confidence: 0.95 }],
  });
  assert.equal(patch.profile.business_type, "Consulting Firm");
  // Home-based is location-derived: it moves location_type, which is what
  // buildEngineInput() actually reads for Q_HOME_BASED.
  assert.equal(patch.profile.location_type, "Home-Based Business");
});

// --- 9: invalid AI output --------------------------------------------------

test("9. invalid KB ids are discarded, not applied", () => {
  const { validated, patch } = interpret({
    businessType: { id: "BT_TOTALLY_MADE_UP", name: "Spaceport", confidence: 0.99 },
    municipality: { value: "Atlantis", confidence: 0.99 },
    answers: [
      { questionId: "Q_NOT_A_REAL_QUESTION", value: true, confidence: 0.99 },
      { questionId: "Q_OUTDOOR_SEATING", value: true, confidence: 0.97 },
    ],
  });
  assert.equal(patch.profile.business_type, undefined);
  assert.equal(patch.profile.municipality, undefined);
  assert.equal(patch.answers.Q_NOT_A_REAL_QUESTION, undefined);
  // The one valid answer still applies.
  assert.equal(patch.answers.outdoor_seating, true);
  assert.equal(validated.discarded.length, 3);
});

test("9b. a question that exists in the KB but is not applicable is discarded", () => {
  // Q_BUSINESS_STRUCTURE is a real KB question but is not part of the
  // interpreter's applicable set, so it must never be auto-applied.
  const { validated } = interpret({
    answers: [{ questionId: "Q_BUSINESS_STRUCTURE", value: "LLC", confidence: 0.99 }],
  });
  assert.ok(validated.discarded.some((d) => d.field === "answers.Q_BUSINESS_STRUCTURE"));
  assert.equal(validated.answers.length, 0);
});

test("9c. a wrongly typed answer value is discarded", () => {
  const { validated } = interpret({
    answers: [{ questionId: "Q_OUTDOOR_SEATING", value: "maybe", confidence: 0.99 }],
  });
  assert.equal(validated.answers.length, 0);
  assert.ok(validated.discarded.some((d) => d.reason.includes("question type")));
});

test("9d. the model can never emit requirements through the intake patch", () => {
  const patch = toIntakePatch(
    validateInterpretation(
      {
        answers: [{ questionId: "Q_OUTDOOR_SEATING", value: true, confidence: 0.99 }],
        // Anything requirement-shaped is simply not part of the schema.
        ...({ requirements: ["DOC_OUTDOOR_SEATING_AUTH"] } as Record<string, unknown>),
      } as RawInterpretation,
      KB
    )
  );
  const serialized = JSON.stringify(patch);
  assert.ok(!serialized.includes("DOC_"), "no document ids may reach the intake patch");
});

// --- 10: requirements still come from the rules engine ---------------------

test("10. requirements are produced by the existing rules engine, not the model", () => {
  const { patch } = interpret({
    businessType: { id: "BT_CAFE", name: "Cafe", confidence: 0.96 },
    municipality: { value: "San Juan", confidence: 0.99 },
    answers: [
      { questionId: "Q_OUTDOOR_SEATING", value: true, confidence: 0.99 },
      { questionId: "Q_ALCOHOL_SERVED", value: true, confidence: 0.98 },
    ],
  });
  // The patch itself carries no requirement — only intake values.
  assert.deepEqual(Object.keys(patch.answers).sort(), ["alcohol_served", "outdoor_seating"]);

  // rules.json — not the model — turns those answers into these documents.
  const docs = runEngineWithAnswers(
    { Q_OUTDOOR_SEATING: true, Q_ALCOHOL_SERVED: true },
    String(patch.profile.business_type)
  );
  assert.ok(docs.includes("DOC_OUTDOOR_SEATING_AUTH"), "outdoor seating rule must fire");
  assert.ok(docs.includes("DOC_ALCOHOL_LICENSE"), "alcohol rule must fire");
  // Universal baseline still applies.
  assert.ok(docs.includes("DOC_CERT_INCORPORATION"));
  assert.ok(docs.includes("DOC_MERCHANT_REGISTRATION"));
});

test("10b. an unmentioned topic produces no requirement", () => {
  const docs = runEngineWithAnswers({}, "Cafe");
  assert.ok(!docs.includes("DOC_OUTDOOR_SEATING_AUTH"), "must not infer outdoor seating");
  assert.ok(!docs.includes("DOC_ALCOHOL_LICENSE"), "must not infer alcohol");
});

test("10c. every write key is one buildEngineInput() actually reads", () => {
  // Guards the bridge: if kb.ts renames an answer key, this fails loudly
  // instead of silently dropping interpreted answers on the floor.
  // Entries may wrap across lines, so match on whitespace-collapsed source.
  // Scoped to the answers object inside buildEngineInput(): other tables in
  // kb.ts (e.g. DERIVED_SOURCE_KEYS) also mention Q_ ids and must not match.
  const flat = KB_TS_SOURCE.replace(/\s+/g, " ");
  const answersObj = flat.indexOf("const a: Record<string, boolean | string | undefined> = {");
  assert.ok(answersObj !== -1, "answers object must exist in buildEngineInput()");
  for (const [questionId, binding] of Object.entries(QUESTION_KEY_MAP)) {
    const start = flat.indexOf(`${questionId}:`, answersObj);
    assert.ok(start !== -1, `${questionId} must be mapped in buildEngineInput()`);
    // The entry runs until the next Q_* key in the answers object.
    const rest = flat.slice(start + questionId.length + 1);
    const next = rest.search(/Q_[A-Z_]+:/);
    const entry = next === -1 ? rest : rest.slice(0, next);
    const accepted = [binding.writeKey, ...(binding.aliases ?? [])];
    assert.ok(
      accepted.some((key) => entry.includes(`"${key}"`)),
      `${questionId}: none of [${accepted.join(", ")}] appear in buildEngineInput() entry: ${entry.trim()}`
    );
  }
});

// --- 11: failure fallback --------------------------------------------------

test("11. a failed interpretation yields an empty patch so guided intake continues", () => {
  for (const bad of [null, undefined, {}, { answers: null }] as RawInterpretation[]) {
    const validated = validateInterpretation(bad, KB);
    const patch = toIntakePatch(validated);
    assert.deepEqual(patch.profile, {});
    assert.deepEqual(patch.answers, {});
  }
  // An empty patch changes nothing, so the standard intake still drives the
  // engine exactly as it did before AI was involved.
  const docs = runEngineWithAnswers({}, "Restaurant");
  assert.ok(docs.includes("DOC_CERT_INCORPORATION"));
});

// --- Confidence policy (Part 7) -------------------------------------------

test("confidence bands: >=0.85 applies, 0.60–0.84 suggests, <0.60 drops", () => {
  assert.equal(classifyConfidence(0.95), "applied");
  assert.equal(classifyConfidence(0.85), "applied");
  assert.equal(classifyConfidence(0.7), "suggested");
  assert.equal(classifyConfidence(0.6), "suggested");
  assert.equal(classifyConfidence(0.4), "discarded");
  assert.equal(classifyConfidence(undefined), "discarded");

  const { validated, patch } = interpret({
    businessType: { id: "BT_CAFE", name: "Cafe", confidence: 0.72 },
    answers: [
      { questionId: "Q_OUTDOOR_SEATING", value: true, confidence: 0.5 },
      { questionId: "Q_ALCOHOL_SERVED", value: true, confidence: 0.92 },
    ],
  });
  // 0.72 -> suggestion, not auto-applied.
  assert.equal(patch.profile.business_type, undefined);
  assert.equal(validated.suggested.businessType?.name, "Cafe");
  // 0.50 -> dropped entirely.
  assert.equal(patch.answers.outdoor_seating, undefined);
  // 0.92 -> applied.
  assert.equal(patch.answers.alcohol_served, true);
});

// --- Supporting behavior ---------------------------------------------------

test("industry values outside the app's list are rejected", () => {
  const { validated } = interpret({
    profileValues: [
      { key: "industry", value: "Food & Beverage", confidence: 0.95 },
      { key: "industry", value: "Intergalactic Trade", confidence: 0.95 },
    ],
  });
  assert.equal(validated.profileValues.length, 1);
  assert.equal(validated.profileValues[0].value, "Food & Beverage");
});

test("profile keys outside the allowed set are rejected", () => {
  const { validated, patch } = interpret({
    profileValues: [{ key: "readiness_score", value: "100", confidence: 0.99 }],
  });
  assert.equal(patch.profile.readiness_score, undefined);
  assert.ok(validated.discarded.some((d) => d.field === "profileValues.readiness_score"));
});

test("candidate retrieval only offers questions the intake can apply", () => {
  const candidates = buildKbCandidates(KB, "a restaurant in Bayamon with live music and staff");
  for (const q of candidates.questions) {
    assert.ok(
      KB.questions.some((k) => k.id === q.id),
      `candidate ${q.id} must exist in the KB`
    );
  }
  assert.ok(candidates.questions.length > 0);
  assert.ok(candidates.questions.length <= 26);
});

test("municipality matching is accent-insensitive", () => {
  const candidates = buildKbCandidates(KB, "a bakery in Bayamon");
  assert.deepEqual(candidates.municipalities, ["Bayamón"]);
  const { patch } = interpret({ municipality: { value: "Bayamon", confidence: 0.95 } });
  assert.equal(patch.profile.municipality, "Bayamón");
});

test("answer coercion accepts yes/no strings but rejects nonsense", () => {
  assert.equal(coerceAnswerValue("yes", "boolean"), true);
  assert.equal(coerceAnswerValue("no", "boolean"), false);
  assert.equal(coerceAnswerValue(true, "boolean"), true);
  assert.equal(coerceAnswerValue("perhaps", "boolean"), undefined);
  assert.equal(coerceAnswerValue("LLC", "single_select", ["LLC", "Corporation"]), "LLC");
  assert.equal(coerceAnswerValue("Sociedad", "single_select", ["LLC", "Corporation"]), undefined);
});

// --- Field coverage: everything a sentence can populate --------------------

test("\"a bar that serves alcohol with 10 employees\" fills the employee field", () => {
  const { patch } = interpret({
    businessType: { id: "BT_BAR", name: "Bar", confidence: 0.96 },
    profileValues: [
      { key: "industry", value: "Food & Beverage", confidence: 0.93 },
      { key: "number_of_employees", value: 10, confidence: 0.97 },
    ],
    answers: [{ questionId: "Q_ALCOHOL_SERVED", value: true, confidence: 0.98 }],
  });
  assert.equal(patch.profile.business_type, "Bar");
  // Numeric, not a string — the profile field is `number | null`.
  assert.equal(patch.profile.number_of_employees, 10);
  assert.equal(typeof patch.profile.number_of_employees, "number");
  assert.equal(patch.answers.alcohol_served, true);
  // The headcount is stored ONCE, as the fact the user stated. "Will employees
  // be hired?" is not written here — the relationship resolver derives it from
  // `number_of_employees`, so the answer can never outlive its source.
  // See relationships.test.ts for the derivation itself.
  assert.equal(patch.answers.employees_hired, undefined);
  assert.ok(patch.chips.some((c) => c.label === "10 employees"));
});

test("a zero headcount does not claim the business hires employees", () => {
  const { patch } = interpret({
    profileValues: [{ key: "number_of_employees", value: 0, confidence: 0.95 }],
  });
  assert.equal(patch.profile.number_of_employees, 0);
  assert.equal(patch.answers.employees_hired, undefined);
});

test("employee counts are validated: non-numeric and out-of-range are dropped", () => {
  for (const bad of ["a bunch", -3, 999999, null]) {
    const { validated } = interpret({
      profileValues: [{ key: "number_of_employees", value: bad, confidence: 0.95 }],
    });
    assert.equal(validated.profileValues.length, 0, `expected ${JSON.stringify(bad)} to be dropped`);
  }
});

test("business structure maps onto the intake's entity-type values", () => {
  const { patch } = interpret({
    profileValues: [{ key: "business_structure", value: "limited_liability_partnership", confidence: 0.9 }],
  });
  assert.equal(patch.profile.business_structure, "limited_liability_partnership");
  assert.ok(patch.chips.some((c) => c.label === "Limited Liability Partnership"));

  const { validated } = interpret({
    profileValues: [{ key: "business_structure", value: "s-corp-ish", confidence: 0.9 }],
  });
  assert.equal(validated.profileValues.length, 0);
});

test("an explicitly named business populates the name field", () => {
  const { patch } = interpret({
    profileValues: [{ key: "name", value: "Luna's", confidence: 0.94 }],
  });
  assert.equal(patch.profile.name, "Luna's");
});

test("location type is validated against the app's list", () => {
  const validated = validateInterpretation(
    { profileValues: [{ key: "location_type", value: "Home-Based Business", confidence: 0.95 }] },
    KB,
    { allowedIndustries: INDUSTRIES, allowedLocationTypes: ["Home-Based Business", "Online Only"] }
  );
  assert.equal(validated.profileValues[0].value, "Home-Based Business");
});

test("only true answers mirror onto the profile (false never asserts a negative)", () => {
  const mirrored = mirrorAnswersToProfile({ outdoor_seating: true, alcohol_sold: false });
  assert.equal(mirrored.outdoor_seating, true);
  assert.equal(mirrored.alcohol_sold, undefined);
});

// --- Official identifiers: dictated details must land in fields, not the text box ---

test("a dictated EIN is normalized to XX-XXXXXXX and the chip masks all but the last 4", () => {
  const { validated, patch } = interpret({
    profileValues: [{ key: "ein", value: "158258967", confidence: 0.95 }],
  });
  assert.equal(validated.profileValues[0].value, "15-8258967");
  assert.equal(patch.profile.ein, "15-8258967");
  assert.deepEqual(patch.chips.map((c) => c.label), ["EIN ••••8967"]);
});

test("an EIN that is not 9 digits is discarded, never stored", () => {
  const { validated, patch } = interpret({
    profileValues: [{ key: "ein", value: "12345", confidence: 0.95 }],
  });
  assert.equal(validated.profileValues.length, 0);
  assert.equal(patch.profile.ein, undefined);
  assert.ok(validated.discarded.some((d) => d.field === "profileValues.ein"));
});

test("a dictated formation date lands as ISO and reads as a friendly chip", () => {
  const { patch } = interpret({
    profileValues: [{ key: "incorporation_date", value: "2027-01-01", confidence: 0.96 }],
  });
  assert.equal(patch.profile.incorporation_date, "2027-01-01");
  assert.deepEqual(patch.chips.map((c) => c.label), ["Formed Jan 1, 2027"]);
});

test("an impossible calendar date is discarded", () => {
  const { validated } = interpret({
    profileValues: [{ key: "incorporation_date", value: "2027-02-30", confidence: 0.96 }],
  });
  assert.equal(validated.profileValues.length, 0);
  assert.ok(validated.discarded.some((d) => d.field === "profileValues.incorporation_date"));
});

test("merchant registration number and physical address pass through as stated", () => {
  const { patch } = interpret({
    profileValues: [
      { key: "merchant_registration_number", value: "168-56-97810", confidence: 0.93 },
      { key: "physical_address", value: "1 Cavet 8", confidence: 0.9 },
    ],
  });
  assert.equal(patch.profile.merchant_registration_number, "168-56-97810");
  assert.equal(patch.profile.physical_address, "1 Cavet 8");
  assert.deepEqual(patch.chips.map((c) => c.label), ["Merchant reg. 168-56-97810", "1 Cavet 8"]);
});

test("official identifiers below the auto-apply threshold are suggested, never applied", () => {
  const { validated, patch } = interpret({
    profileValues: [{ key: "ein", value: "158258967", confidence: 0.7 }],
  });
  assert.equal(validated.suggested.profileValues[0].key, "ein");
  assert.equal(patch.profile.ein, undefined);
});

test("every explicitly named identity field is parsed: DBA, owner, email, phone, NAICS, for-profit", () => {
  const { patch } = interpret({
    profileValues: [
      { key: "trade_name", value: "Luna's Bar", confidence: 0.94 },
      { key: "owner_name", value: "Jose Rivera", confidence: 0.95 },
      { key: "email", value: "jose@example.com", confidence: 0.97 },
      { key: "phone", value: "(787) 555-0123", confidence: 0.96 },
      { key: "naics_code", value: "722511", confidence: 0.95 },
      { key: "for_profit_status", value: "for_profit", confidence: 0.98 },
    ],
  });
  assert.equal(patch.profile.trade_name, "Luna's Bar");
  assert.equal(patch.profile.owner_name, "Jose Rivera");
  assert.equal(patch.profile.email, "jose@example.com");
  assert.equal(patch.profile.phone, "7875550123");
  assert.equal(patch.profile.naics_code, "722511");
  assert.equal(patch.profile.for_profit_status, "for_profit");
  assert.deepEqual(patch.chips.map((c) => c.label), [
    "DBA Luna's Bar",
    "Owner: Jose Rivera",
    "jose@example.com",
    "7875550123",
    "NAICS 722511",
    "For profit",
  ]);
});

test("an invalid email, short phone number, or bad NAICS code is discarded", () => {
  const { validated, patch } = interpret({
    profileValues: [
      { key: "email", value: "not-an-email", confidence: 0.95 },
      { key: "phone", value: "123", confidence: 0.95 },
      { key: "naics_code", value: "ABC", confidence: 0.95 },
    ],
  });
  assert.equal(validated.profileValues.length, 0);
  assert.equal(patch.profile.email, undefined);
  assert.equal(patch.profile.phone, undefined);
  assert.equal(patch.profile.naics_code, undefined);
  assert.equal(validated.discarded.length, 3);
});

test("'nonprofit' is accepted as for_profit_status", () => {
  const { patch } = interpret({
    profileValues: [{ key: "for_profit_status", value: "nonprofit", confidence: 0.97 }],
  });
  assert.equal(patch.profile.for_profit_status, "nonprofit");
  assert.deepEqual(patch.chips.map((c) => c.label), ["Nonprofit"]);
});

// --- PR-Spanish renovation phrasings surface Q_RENOVATIONS -------------------
// QA 2026-09-21 21:00 live audit: "hay que hacer un pequeño arreglo interior
// antes de abrir" (restaurant, Cataño) and "hay que acondicionar por dentro"
// (vet clinic, Mayagüez) never surfaced the renovation question, so the
// construction-permit path stayed silent. These candidacy checks pin the fix.

test("\"pequeño arreglo interior\" surfaces Q_RENOVATIONS as a candidate", () => {
  const candidates = buildKbCandidates(
    KB,
    "Queremos abrir un restaurante en Cataño, hay que hacer un pequeño arreglo interior antes de abrir"
  );
  const qids = candidates.questions.map((q) => q.id);
  assert.ok(qids.includes("Q_RENOVATIONS"), `Q_RENOVATIONS must be a candidate, got ${qids.join(", ")}`);
});

test("\"acondicionar por dentro\" surfaces Q_RENOVATIONS as a candidate", () => {
  const candidates = buildKbCandidates(
    KB,
    "Vamos a abrir una clínica veterinaria en Mayagüez, alquilamos un local que hay que acondicionar por dentro"
  );
  const qids = candidates.questions.map((q) => q.id);
  assert.ok(qids.includes("Q_RENOVATIONS"), `Q_RENOVATIONS must be a candidate, got ${qids.join(", ")}`);
});
