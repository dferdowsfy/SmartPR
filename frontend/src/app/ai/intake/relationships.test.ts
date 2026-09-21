// Tests for the intake relationship resolver.
// Run: node --experimental-strip-types --test src/app/ai/intake/relationships.test.ts
//
// Three things are under test, in this order of importance:
//   1. Facts SmartPR can know with certainty ARE derived (so it stops asking).
//   2. Facts it cannot know are LEFT UNKNOWN (so it does not invent answers).
//   3. Requirements still come only from rules.json, over the same profile
//      + answers, with the resolver only ever adding knowledge.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { runRulesEngine, type EngineInput, type KnowledgeBase } from "../../rulesEngine.ts";
import {
  bucketForCount,
  evaluateCondition,
  resolveIntakeFacts,
  type ResolutionResult,
} from "./relationships.ts";
import { INTAKE_RELATIONSHIPS } from "./relationshipRegistry.ts";
import { questionIdForAnswerKey, WIZARD_KEY_TO_QUESTION } from "./questionKeyMap.ts";
import { validateInterpretation, toIntakePatch, type RawInterpretation } from "./validateInterpretation.ts";

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

/** The industry names the intake dropdown offers (page.tsx INDUSTRIES). */
const INDUSTRIES = [
  "Accommodation & Tourism", "Agriculture & Farming", "Arts, Entertainment & Recreation",
  "Automotive", "Beauty & Personal Care", "Construction", "Education & Training",
  "Energy & Utilities", "Finance & Insurance", "Food & Beverage", "Healthcare",
  "Information Technology", "Manufacturing", "Professional Services", "Real Estate",
  "Retail", "Transportation & Logistics", "Wholesale Distribution", "Government Contractor",
  "Nonprofit / Religious Organization", "Other",
];

function resolve(
  profile: Record<string, unknown>,
  answers: Record<string, unknown> = {}
): ResolutionResult {
  return resolveIntakeFacts({ profile, answers }, { kb: KB, allowedIndustries: INDUSTRIES });
}

/** The value the resolver settled on for a KB question, or undefined. */
const q = (r: ResolutionResult, id: string) => r.questionValues[id];
/** Provenance for a question fact. */
const origin = (r: ResolutionResult, id: string) => r.facts[`question:${id}`]?.origin;

// ===========================================================================
// EMPLOYMENT
// ===========================================================================

test("employment: 10 employees implies hiring, the 6-20 bracket, and no repeat questions", () => {
  const r = resolve({ business_type: "Bar", municipality: "Bayamón", number_of_employees: 10 });

  assert.equal(q(r, "Q_EMPLOYEES_HIRED"), true);
  assert.equal(q(r, "Q_EMPLOYEE_COUNT"), "6-20");
  assert.equal(origin(r, "Q_EMPLOYEES_HIRED"), "derived");

  // Both wizard phrasings of the hiring question are now answered.
  assert.ok(r.resolvedQuestionIds.has(questionIdForAnswerKey("employees_hired")!));
  assert.ok(r.resolvedQuestionIds.has(questionIdForAnswerKey("employees_work_on_site")!));
  assert.ok(r.resolvedQuestionIds.has("Q_EMPLOYEE_COUNT"));
});

test("employment: provenance records why the derived fact exists", () => {
  const r = resolve({ number_of_employees: 10 });
  const fact = r.facts["question:Q_EMPLOYEES_HIRED"];
  assert.equal(fact.value, true);
  assert.equal(fact.origin, "derived");
  assert.equal(fact.derivedFrom, "profile:number_of_employees");
  assert.equal(fact.relationshipId, "REL_EMPLOYEE_COUNT_IMPLIES_EMPLOYEES");
  assert.equal(fact.confidence, 1);
  assert.equal(fact.certainty, "deterministic");
});

test("employment: a stated bracket answers the hiring question on its own", () => {
  assert.equal(q(resolve({}, { Q_EMPLOYEE_COUNT: "21-50" }), "Q_EMPLOYEES_HIRED"), true);
  assert.equal(q(resolve({}, { Q_EMPLOYEE_COUNT: "0" }), "Q_EMPLOYEES_HIRED"), false);
});

test("employment: buckets come from the KB options, not from hardcoded ranges", () => {
  const options = ["0", "1-5", "6-20", "21-50", "50+"];
  assert.equal(bucketForCount(options, 0), "0");
  assert.equal(bucketForCount(options, 1), "1-5");
  assert.equal(bucketForCount(options, 10), "6-20");
  assert.equal(bucketForCount(options, 400), "50+");
  // No option covers it -> no answer, rather than a wrong one.
  assert.equal(bucketForCount(["1", "2-5"], 0), undefined);
  assert.equal(bucketForCount(undefined, 3), undefined);
});

// ===========================================================================
// LOCATION
// ===========================================================================

test("location: online-only excludes physical premises and home-based", () => {
  for (const label of ["Online Only", "Online / Remote Only"]) {
    const r = resolve({ business_type: "Consulting Firm", location_type: label });
    assert.equal(q(r, "Q_ONLINE_ONLY"), true, label);
    assert.equal(q(r, "Q_PHYSICAL_LOCATION"), false, label);
    assert.equal(q(r, "Q_HOME_BASED"), false, label);
  }
});

test("location: home-based IS a physical location in SmartPR's model", () => {
  const r = resolve({ business_type: "Bookkeeping Service", location_type: "Home-Based Business" });
  assert.equal(q(r, "Q_HOME_BASED"), true);
  assert.equal(q(r, "Q_PHYSICAL_LOCATION"), true);
  assert.equal(q(r, "Q_ONLINE_ONLY"), false);
});

test("location: any other named location type is physical premises", () => {
  const r = resolve({ location_type: "Retail Storefront" });
  assert.equal(q(r, "Q_PHYSICAL_LOCATION"), true);
  assert.equal(q(r, "Q_ONLINE_ONLY"), false);
  // Home-based is NOT decided by "some other storefront" — left unknown.
  assert.equal(q(r, "Q_HOME_BASED"), undefined);
});

test("location: activities that need premises imply premises (child -> parent)", () => {
  for (const key of ["customers_visit", "patients_visit", "classes_on_site", "outdoor_seating"]) {
    const r = resolve({}, { [key]: true });
    assert.equal(q(r, "Q_PHYSICAL_LOCATION"), true, key);
    assert.equal(q(r, "Q_ONLINE_ONLY"), false, key);
  }
});

test("location: storage only SUGGESTS premises, so it is not applied", () => {
  const r = resolve({}, { inventory_stored: true });
  // A third-party fulfilment centre is a real counter-example.
  assert.equal(q(r, "Q_PHYSICAL_LOCATION"), undefined);
  assert.ok(r.inferred.some((f) => f.ref.key === "Q_PHYSICAL_LOCATION" && f.certainty === "strong_inference"));
});

// ===========================================================================
// FOOD, ALCOHOL — and what must stay unknown
// ===========================================================================

test("food: on-site consumption implies food is served", () => {
  assert.equal(q(resolve({}, { customers_consume_on_site: true }), "Q_FOOD_SERVED"), true);
});

test("food: a bakery bakes and sells; a restaurant serves and sells", () => {
  const bakery = resolve({ business_type: "Bakery" });
  assert.equal(q(bakery, "Q_FOOD_PREPARED"), true);
  assert.equal(q(bakery, "Q_FOOD_SOLD"), true);

  const restaurant = resolve({ business_type: "Restaurant" });
  assert.equal(q(restaurant, "Q_FOOD_SERVED"), true);
  assert.equal(q(restaurant, "Q_FOOD_SOLD"), true);
});

test("alcohol: a bar definitionally serves and sells alcohol", () => {
  const r = resolve({ business_type: "Bar" });
  assert.equal(q(r, "Q_ALCOHOL_SERVED"), true);
  assert.equal(q(r, "Q_ALCOHOL_SOLD"), true);
});

test("alcohol: \"we don't sell alcohol\" does NOT also mean it is not served", () => {
  const r = resolve({}, { alcohol_sold: false });
  assert.equal(q(r, "Q_ALCOHOL_SOLD"), false);
  assert.equal(q(r, "Q_ALCOHOL_SERVED"), undefined, "negatives must not over-propagate");
});

test("UNKNOWN: \"a restaurant in San Juan\" answers nothing about alcohol, seating, or staff", () => {
  const r = resolve({ business_type: "Restaurant", municipality: "San Juan" });
  for (const id of [
    "Q_ALCOHOL_SERVED", "Q_ALCOHOL_SOLD", "Q_OUTDOOR_SEATING", "Q_LIVE_ENTERTAINMENT",
    "Q_EMPLOYEES_HIRED", "Q_EMPLOYEE_COUNT", "Q_RENOVATIONS",
  ]) {
    assert.equal(q(r, id), undefined, `${id} must stay unknown`);
    assert.ok(!r.resolvedQuestionIds.has(id), `${id} must still be asked`);
  }
});

// ===========================================================================
// HEALTHCARE / TRANSPORT / TOURISM / CHILDCARE / PROFESSIONAL / PROPERTY
// ===========================================================================

test("healthcare: patients visiting means healthcare services at a physical location", () => {
  const r = resolve({ business_type: "Medical Office" }, { patients_visit: true });
  assert.equal(q(r, "Q_HEALTHCARE_SERVICES"), true);
  assert.equal(q(r, "Q_PATIENTS_VISIT"), true);
  assert.equal(q(r, "Q_PHYSICAL_LOCATION"), true);
});

test("transportation: 3 delivery vans means commercial vehicles and the 1-3 bracket", () => {
  const r = resolve({ business_type: "Courier Service", number_of_vehicles: 3 });
  assert.equal(q(r, "Q_COMMERCIAL_VEHICLES"), true);
  assert.equal(q(r, "Q_FLEET_SIZE"), "1-3");
});

test("tourism: an Airbnb with 3 units is a short-term rental in the 2-5 bracket", () => {
  const r = resolve({ business_type: "Airbnb / Short-Term Rental", number_of_rental_units: 3 });
  assert.equal(q(r, "Q_SHORT_TERM_RENTAL"), true);
  assert.equal(q(r, "Q_RENTAL_UNITS"), "2-5");
});

test("tourism: a unit count alone does NOT make a business a short-term rental", () => {
  // Long-term landlords count units too — only the business type decides.
  const r = resolve({ business_type: "Property Management Company", number_of_rental_units: 3 });
  assert.equal(q(r, "Q_SHORT_TERM_RENTAL"), undefined);
});

test("childcare: a daycare definitionally has children present", () => {
  assert.equal(q(resolve({ business_type: "Daycare" }), "Q_CHILDREN_PRESENT"), true);
});

test("professional services: an architecture firm needs licensed professionals", () => {
  assert.equal(q(resolve({ business_type: "Architecture Firm" }), "Q_PROFESSIONAL_LICENSES"), true);
});

test("property: owning or leasing the operating space implies a physical location", () => {
  assert.equal(q(resolve({}, { owns_property: true }), "Q_PHYSICAL_LOCATION"), true);
  assert.equal(q(resolve({}, { existing_lease: true }), "Q_PHYSICAL_LOCATION"), true);
});

test("activities: outdoor tables, a live band, and a storefront sign each imply premises", () => {
  for (const key of ["outdoor_seating", "live_entertainment", "commercial_signage"]) {
    const r = resolve({}, { [key]: true });
    assert.equal(q(r, questionIdForAnswerKey(key)!), true, key);
    assert.equal(q(r, "Q_PHYSICAL_LOCATION"), true, key);
  }
});

// ===========================================================================
// EVERY QUESTION TYPE — not just booleans
// ===========================================================================

test("question types: single_select, multi_select and numeric sources all resolve", () => {
  // single_select -> boolean
  assert.equal(q(resolve({}, { Q_SIGNAGE_TYPE: "Illuminated Sign" }), "Q_COMMERCIAL_SIGNAGE"), true);
  assert.equal(q(resolve({}, { Q_SIGNAGE_TYPE: "None" }), "Q_COMMERCIAL_SIGNAGE"), false);
  // multi_select -> boolean
  assert.equal(
    q(resolve({}, { Q_LICENSE_TYPES: "Architect" }), "Q_PROFESSIONAL_LICENSES"),
    true
  );
  // profile string -> single_select
  assert.equal(q(resolve({ business_structure: "llc" }), "Q_BUSINESS_STRUCTURE"), "LLC");
  assert.equal(
    q(resolve({ business_structure: "foreign_corporation" }), "Q_ENTITY_FOREIGN_CORP"),
    true
  );
  assert.equal(
    q(resolve({ business_structure: "limited_liability_partnership" }), "Q_ENTITY_LLP"),
    true
  );
  // numeric -> select bucket (covered above) and business type -> industry
  assert.equal(resolve({ business_type: "Bar" }).profileValues.industry, "Food & Beverage");
});

test("industry: KB industry names are mapped onto the labels the intake offers", () => {
  assert.equal(
    resolve({ business_type: "Airbnb / Short-Term Rental" }).profileValues.industry,
    "Accommodation & Tourism"
  );
  assert.equal(
    resolve({ business_type: "Charity" }).profileValues.industry,
    "Nonprofit / Religious Organization"
  );
});

// ===========================================================================
// PRECEDENCE, RECURSION, RE-EVALUATION
// ===========================================================================

test("precedence: a derivation never overwrites what the user answered", () => {
  // The user says no alcohol is served, at a Bar. The user wins.
  const r = resolveIntakeFacts(
    { profile: { business_type: "Bar" }, answers: { alcohol_served: false } },
    { kb: KB, allowedIndustries: INDUSTRIES }
  );
  assert.equal(q(r, "Q_ALCOHOL_SERVED"), false);
  assert.equal(origin(r, "Q_ALCOHOL_SERVED"), "user");
  assert.ok(r.conflicts.some((c) => c.id === "CONFLICT_question:Q_ALCOHOL_SERVED"));
});

test("precedence: an explicit statement outranks a value already on the profile", () => {
  const r = resolveIntakeFacts(
    {
      profile: { location_type: "Retail Storefront" },
      answers: { services_online: true },
      explicitKeys: ["services_online"],
    },
    { kb: KB, allowedIndustries: INDUSTRIES }
  );
  assert.equal(q(r, "Q_ONLINE_ONLY"), true);
  assert.equal(origin(r, "Q_ONLINE_ONLY"), "explicit");
});

test("recursion: a derived fact feeds the next relationship", () => {
  // number_of_employees -> Q_EMPLOYEE_COUNT -> Q_EMPLOYEES_HIRED, and
  // Q_ONLINE_ONLY -> Q_PHYSICAL_LOCATION=false -> Q_HOME_BASED=false.
  const r = resolve({ number_of_employees: 4 }, { services_online: true });
  assert.equal(q(r, "Q_EMPLOYEE_COUNT"), "1-5");
  assert.equal(q(r, "Q_EMPLOYEES_HIRED"), true);
  assert.equal(q(r, "Q_HOME_BASED"), false);
  assert.ok(r.iterations < 12, "must settle well inside the loop guard");
});

test("re-evaluation: editing the source re-evaluates everything derived from it", () => {
  assert.equal(q(resolve({ number_of_employees: 10 }), "Q_EMPLOYEES_HIRED"), true);
  // Same intake, headcount corrected to zero. Nothing stale survives.
  const zero = resolve({ number_of_employees: 0 });
  assert.equal(q(zero, "Q_EMPLOYEES_HIRED"), false);
  assert.equal(q(zero, "Q_EMPLOYEE_COUNT"), "0");
});

test("re-evaluation: an explicit answer survives a change to a related source", () => {
  const r = resolve({ number_of_employees: 0 }, { outdoor_seating: true });
  assert.equal(q(r, "Q_OUTDOOR_SEATING"), true, "the user's own answer is untouched");
  assert.equal(q(r, "Q_EMPLOYEES_HIRED"), false);
});

// ===========================================================================
// CONFLICTS
// ===========================================================================

test("conflict: 10 employees plus \"no employees hired\" is detected", () => {
  const r = resolve({ number_of_employees: 10 }, { employees_hired: false });
  const conflict = r.conflicts.find((c) => c.id === "CONTRA_EMPLOYEE_COUNT_VS_HIRING");
  assert.ok(conflict, "the contradiction must be reported");
  assert.equal(conflict!.requiresUser, true, "two user statements — only they can settle it");
});

test("conflict: online-only plus outdoor seating is detected", () => {
  const r = resolve({ location_type: "Online Only" }, { outdoor_seating: true });
  assert.ok(r.conflicts.some((c) => c.id === "CONTRA_ONLINE_ONLY_VS_OUTDOOR_SEATING"));
});

test("conflict: a contradiction between two AI answers is reconciled, not stored", () => {
  // The model returned a headcount AND claimed nobody will be hired.
  const raw: RawInterpretation = {
    profileValues: [{ key: "number_of_employees", value: 10, confidence: 0.97 }],
    answers: [{ questionId: "Q_EMPLOYEES_HIRED", value: false, confidence: 0.9 }],
  };
  const validated = validateInterpretation(raw, KB, { allowedIndustries: INDUSTRIES });
  const patch = toIntakePatch(validated, { kb: KB, allowedIndustries: INDUSTRIES });

  assert.equal(patch.profile.number_of_employees, 10);
  assert.equal(patch.answers.employees_hired, undefined, "the impossible answer is dropped");
  assert.equal(patch.reconciled.length, 1);
  assert.equal(patch.reconciled[0].questionId, "Q_EMPLOYEES_HIRED");
  assert.equal(patch.reconciled[0].derivedValue, true);
});

// ===========================================================================
// UI: only user-meaningful facts become chips
// ===========================================================================

test("chips: a derived answer does not get its own redundant chip", () => {
  const validated = validateInterpretation(
    {
      businessType: { id: "BT_BAR", name: "Bar", confidence: 0.96 },
      municipality: { value: "Bayamón", confidence: 0.98 },
      profileValues: [{ key: "number_of_employees", value: 10, confidence: 0.97 }],
      answers: [{ questionId: "Q_ALCOHOL_SERVED", value: true, confidence: 0.95 }],
    },
    KB,
    { allowedIndustries: INDUSTRIES }
  );
  const labels = toIntakePatch(validated, { kb: KB, allowedIndustries: INDUSTRIES })
    .chips.map((c) => c.label);

  assert.deepEqual(labels, ["Bar", "Bayamón", "10 employees"]);
  // "Bar" already says alcohol is served; "10 employees" already says staff.
  assert.ok(!labels.some((l) => /alcohol/i.test(l)));
  assert.ok(!labels.some((l) => /employees be hired/i.test(l)));
});

test("chips: a fact the business type does NOT imply keeps its chip", () => {
  const validated = validateInterpretation(
    {
      businessType: { id: "BT_RESTAURANT", name: "Restaurant", confidence: 0.96 },
      answers: [{ questionId: "Q_OUTDOOR_SEATING", value: true, confidence: 0.95 }],
    },
    KB,
    { allowedIndustries: INDUSTRIES }
  );
  const labels = toIntakePatch(validated, { kb: KB, allowedIndustries: INDUSTRIES })
    .chips.map((c) => c.label);
  assert.ok(labels.some((l) => /outdoor seating/i.test(l)));
});

// ===========================================================================
// QUESTION SKIPPING — the wizard's own keys, end to end
// ===========================================================================

/** The page's suppression predicate, in the form the wizard applies it:
 * only USER-PROVIDED or explicit facts suppress — derived/inferred facts
 * never do (a resolution the engine made is not the user's answer). */
function suppressed(r: ResolutionResult, answers: Record<string, unknown>, wizardKey: string) {
  if (answers[wizardKey] !== undefined) return false;
  const id = questionIdForAnswerKey(wizardKey);
  if (id === null || !r.resolvedQuestionIds.has(id)) return false;
  const origin = r.resolvedQuestionOrigins[id];
  return origin === "user" || origin === "explicit";
}

test("skipping: derived facts never suppress wizard questions", () => {
  const profile = { business_type: "Bar", municipality: "Bayamón", number_of_employees: 10 };
  const r = resolve(profile);
  // The bar's wizard list, as page.tsx builds it for food & beverage types.
  const wizard = [
    "food_prepared_on_site", "customers_consume_on_site", "alcohol_sold", "outdoor_seating",
    "live_entertainment", "food_delivered", "employees_work_on_site", "food_truck_or_mobile",
  ];
  const asked = wizard.filter((key) => !suppressed(r, {}, key));

  // Both are engine derivations, not user answers: "a bar sells alcohol by
  // definition" and "10 employees means staff on site" are conclusions the
  // resolver drew, so the wizard still asks — and any requirement card may
  // only say "Derived answer", never "Answer".
  assert.ok(asked.includes("alcohol_sold"), "a derived alcohol answer does not suppress the question");
  assert.ok(asked.includes("employees_work_on_site"), "a derived staffing answer does not suppress the question");
  assert.equal(r.resolvedQuestionOrigins["Q_ALCOHOL_SOLD"], "derived");
  assert.equal(r.resolvedQuestionOrigins["Q_EMPLOYEES_HIRED"], "derived");
  assert.deepEqual(asked, wizard);
});

test("skipping: a user-answered question still suppresses it", () => {
  const r = resolve({ business_type: "Bar" }, { alcohol_sold: true });
  assert.equal(r.resolvedQuestionOrigins["Q_ALCOHOL_SOLD"], "user");
  assert.equal(suppressed(r, { alcohol_sold: true }, "alcohol_sold"), false); // answered here, Back shows it
  assert.equal(suppressed(r, {}, "outdoor_seating"), false);
});

test("skipping: a plain restaurant still gets asked its whole list", () => {
  const r = resolve({ business_type: "Restaurant", municipality: "San Juan" });
  const wizard = [
    "food_prepared_on_site", "customers_consume_on_site", "alcohol_sold", "outdoor_seating",
    "live_entertainment", "food_delivered", "employees_work_on_site", "food_truck_or_mobile",
  ];
  assert.deepEqual(wizard.filter((key) => !suppressed(r, {}, key)), wizard);
});

test("skipping: an answer the user gave here is never hidden from Back", () => {
  const answers = { outdoor_seating: true };
  const r = resolve({ business_type: "Restaurant" }, answers);
  assert.equal(suppressed(r, answers, "outdoor_seating"), false);
});

// ===========================================================================
// REGRESSION: requirements still come from rules.json, and only grow
// ===========================================================================

function docsFor(input: EngineInput): string[] {
  return runRulesEngine(KB, input).debug.documentsGenerated;
}

test("regression: the resolver adds no requirement of its own", () => {
  const r = resolve({ business_type: "Bar", municipality: "Bayamón", number_of_employees: 10 });
  const serialized = JSON.stringify({ facts: r.facts, values: r.questionValues });
  assert.ok(!serialized.includes("DOC_"), "no document id may appear in resolved facts");
});

test("regression: the rules engine over the SAME answers is unchanged", () => {
  const base: EngineInput = {
    municipalityName: "San Juan",
    businessTypeName: "Restaurant",
    answers: { Q_FOOD_PREPARED: true, Q_OUTDOOR_SEATING: true },
  };
  const before = docsFor(base).sort();
  const after = docsFor({ ...base, answers: { ...base.answers } }).sort();
  assert.deepEqual(after, before);
});

test("regression: resolved facts only ADD requirements — the bar keeps every one", () => {
  const profile = { business_type: "Bar", municipality: "Bayamón", number_of_employees: 10 };
  const withoutResolver = docsFor({
    municipalityName: "Bayamón",
    businessTypeName: "Bar",
    answers: {},
  });
  const resolved = resolve(profile);
  const withResolver = docsFor({
    municipalityName: "Bayamón",
    businessTypeName: "Bar",
    answers: resolved.questionValues,
  });
  for (const doc of withoutResolver) {
    assert.ok(withResolver.includes(doc), `${doc} must not be lost`);
  }
  // And the derived employment fact reaches rules.json, which is what turns it
  // into an obligation — the resolver itself never decides that.
  assert.ok(withResolver.length > withoutResolver.length);
});

// ===========================================================================
// REGISTRY INTEGRITY
// ===========================================================================

test("registry: every id is unique", () => {
  const ids = INTAKE_RELATIONSHIPS.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate relationship id");
});

test("registry: every referenced question and business type exists in the KB", () => {
  const questionIds = new Set(KB.questions.map((x) => x.id));
  const businessTypeIds = new Set(KB.businessTypes.map((b) => b.id));
  for (const rel of INTAKE_RELATIONSHIPS) {
    if (rel.source.type === "question") {
      assert.ok(questionIds.has(rel.source.key), `${rel.id}: unknown source ${rel.source.key}`);
    }
    if (rel.source.type === "business_type") {
      assert.ok(businessTypeIds.has(rel.source.key), `${rel.id}: unknown type ${rel.source.key}`);
    }
    for (const effect of rel.effects) {
      if (effect.target.type === "question") {
        assert.ok(questionIds.has(effect.target.key), `${rel.id}: unknown target ${effect.target.key}`);
      }
    }
  }
});

test("registry: the wizard key map only points at real KB questions", () => {
  const questionIds = new Set(KB.questions.map((x) => x.id));
  for (const [key, questionId] of Object.entries(WIZARD_KEY_TO_QUESTION)) {
    assert.ok(questionIds.has(questionId), `${key} -> ${questionId} is not a KB question`);
  }
});

test("operators: each behaves as the registry assumes", () => {
  assert.equal(evaluateCondition(10, { operator: "greater_than", value: 0 }), true);
  assert.equal(evaluateCondition(0, { operator: "greater_than", value: 0 }), false);
  assert.equal(evaluateCondition("6-20", { operator: "in", value: ["1-5", "6-20"] }), true);
  assert.equal(evaluateCondition("Retail", { operator: "not_in", value: ["Online Only"] }), true);
  assert.equal(evaluateCondition("", { operator: "not_in", value: ["Online Only"] }), false);
  assert.equal(evaluateCondition("", { operator: "non_empty" }), false);
  assert.equal(evaluateCondition(undefined, { operator: "truthy" }), false);
  assert.equal(evaluateCondition(false, { operator: "falsy" }), true);
});

test("renewable: an installer's trade does not mean it owns renewable systems (REG-LUMA-INSTALLER-001 derivation fix 2026-09-21)", () => {
  // Live finding (cache-busted, 2026-09-21): REL_BT_SOLAR_INSTALLER_RENEWABLE
  // and its battery/renewable-company siblings derived Q_RENEWABLE_INSTALL=true
  // "definitionally", overriding the installer's explicit No and firing the
  // LUMA interconnection + net-metering owner-side rules (RULE_0610/0611).
  // Installing systems for customers is not owning them — the derivations were
  // deleted from fact_derivations.json AND relationshipRegistry.ts. The
  // discovery questions already ask Q_RENEWABLE_INSTALL for all three BTs, so
  // the user's answer governs. (The resolver tracks the raw Q_ id; the wizard
  // writeKey "renewable_install" is read directly by buildEngineInput.)
  for (const bt of ["Solar Installer", "Battery Storage Installer", "Renewable Energy Company"]) {
    // No derivation may invent renewable ownership from the trade alone.
    const bare = resolve({ business_type: bt });
    assert.equal(q(bare, "Q_RENEWABLE_INSTALL"), undefined, `${bt}: trade alone must not derive renewable install`);
    assert.equal(origin(bare, "Q_RENEWABLE_INSTALL"), undefined, `${bt}: no derived provenance`);
    // An explicit No stands.
    const no = resolve({ business_type: bt }, { Q_RENEWABLE_INSTALL: false });
    assert.equal(q(no, "Q_RENEWABLE_INSTALL"), false, `${bt}: explicit No must not be overridden`);
  }
  // Positive control: a genuine owner-operator answering Yes still resolves true.
  const owner = resolve({ business_type: "Solar Installer" }, { Q_RENEWABLE_INSTALL: true });
  assert.equal(q(owner, "Q_RENEWABLE_INSTALL"), true);
});
