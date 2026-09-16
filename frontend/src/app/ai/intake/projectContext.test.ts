// Tests for the intake parser's Project Context upgrade.
// Run: npx tsx --test src/app/ai/intake/projectContext.test.ts
//
// Covers the canned Guaynabo fixture end to end: the prompt contract (schema,
// business-vs-project rule, confidence bands), defensive validation of the
// model output, evidence + requires_confirmation plumbing, and the
// deterministic follow-up generator (never repeats stated facts).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  validateProjectContext,
  mergeProjectContext,
  projectIsActive,
  projectFactKnown,
  projectContextFollowUps,
  projectContextAnswerToFacts,
  projectContextBriefLines,
  type ProjectContext,
} from "./projectContext.ts";
import {
  validateInterpretation,
  promoteSuggested,
  type RawInterpretation,
} from "./validateInterpretation.ts";
import type { KnowledgeBase } from "../../rulesEngine.ts";

const here = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Canned fixture: the Guaynabo warehouse description from the spec, as the
// model is instructed to return it.
// ---------------------------------------------------------------------------

const GUAYNABO_MODEL_RESPONSE: RawInterpretation & { projectContext: unknown } = {
  summary: "Renovation/expansion of a commercial building in Guaynabo into warehouse + office space; permitting issues killed the project.",
  businessType: null,
  municipality: { value: "Guaynabo", confidence: 0.95, evidence: "commercial building in Guaynabo" },
  profileValues: [
    // Strongest evidence points at warehouse/industrial, but it is implied —
    // not stated outright — so it must fill as needing confirmation.
    { key: "location_type", value: "Warehouse", confidence: 0.72, evidence: "warehouse and office area" },
    // Below the 0.60 floor: omitted, never applied.
    { key: "number_of_employees", value: 40, confidence: 0.4, evidence: "team" },
  ],
  answers: [],
  projectContext: {
    project_type: { value: "renovation and expansion", confidence: 0.9, evidence: "planning to renovate an existing commercial building in Guaynabo to add a new 12,000-square-foot warehouse" },
    existing_building: { value: true, confidence: 0.95, evidence: "renovate an existing commercial building" },
    renovation: { value: true, confidence: 0.95, evidence: "planning to renovate" },
    expansion: { value: true, confidence: 0.9, evidence: "to add a new 12,000-square-foot warehouse and office area" },
    new_construction: { value: true, confidence: 0.85, evidence: "add a new 12,000-square-foot warehouse" },
    property_type: { value: "commercial building", confidence: 0.92, evidence: "existing commercial building" },
    existing_use: { value: "commercial", confidence: 0.9, evidence: "already operating commercially" },
    proposed_use: { value: "warehouse + office", confidence: 0.9, evidence: "warehouse and office area" },
    square_footage: { value: "12,000", confidence: 0.95, evidence: "12,000-square-foot" },
    scope_of_work: { value: "interior demolition, new walls, electrical and plumbing work, layout changes", confidence: 0.9, evidence: "included interior demolition, new walls, electrical and plumbing work, and some changes to the building layout" },
    interior_demolition: { value: true, confidence: 0.95, evidence: "interior demolition" },
    new_walls: { value: true, confidence: 0.9, evidence: "new walls" },
    layout_changes: { value: true, confidence: 0.85, evidence: "changes to the building layout" },
    electrical_work: { value: true, confidence: 0.95, evidence: "electrical and plumbing work" },
    plumbing_work: { value: true, confidence: 0.95, evidence: "electrical and plumbing work" },
    construction_approvals_required: { value: true, confidence: 0.9, evidence: "needed construction and related approvals" },
    known_permitting_issue: { value: "permitting process became a major issue", confidence: 0.92, evidence: "the permitting process became a major issue" },
    historical_project_status: { value: "project fell through", confidence: 0.9, evidence: "the project eventually fell through" },
    // Malformed entries the validator must drop individually:
    structural_work: { value: true }, // missing confidence
    bogus_key: { value: "x", confidence: 0.9 }, // unknown key
    exterior_work: "yes", // malformed entry (not an object)
  },
};

const MIN_KB = {
  municipalities: [{ name: "Guaynabo" }],
  businessTypes: [],
  questions: [],
  documents: [],
  rules: [],
} as unknown as KnowledgeBase;

const KB_OPTIONS = { allowedIndustries: [] as string[], allowedLocationTypes: ["Warehouse", "Industrial Facility"] };

// ---------------------------------------------------------------------------
// Prompt contract (the single Grok call)
// ---------------------------------------------------------------------------

test("prompt: projectContext schema, evidence, and business-vs-project rule", () => {
  const source = readFileSync(join(here, "..", "..", "api", "intake", "interpret", "route.ts"), "utf8");
  // The schema the model must fill.
  for (const key of [
    "projectContext",
    "square_footage",
    "interior_demolition",
    "known_permitting_issue",
    "historical_project_status",
    "occupancy_change",
  ]) {
    assert.ok(source.includes(`"${key}"`), `prompt missing projectContext key ${key}`);
  }
  // Every fact carries an evidence quote.
  assert.ok(source.includes("evidence"), "prompt must require evidence quotes");
  // Confidence bands, exactly as specified.
  assert.ok(source.includes("0.85"), "prompt must state the 0.85 auto-apply band");
  assert.ok(source.includes("0.60"), "prompt must state the 0.60 floor");
  assert.ok(source.includes("requires_confirmation"), "prompt must define requires_confirmation");
  // Business vs project: construction work must not imply the industry.
  assert.ok(
    source.includes("BUSINESS vs PROJECT"),
    "prompt must carry the business-vs-project prohibition"
  );
  assert.ok(
    source.includes("does NOT mean the industry"),
    "prompt must forbid inferring Construction from construction work"
  );
  // Unknown stays unknown.
  assert.ok(source.includes("Unknown remains unknown"), "prompt must state unknown-is-unknown");
  // The worked Guaynabo example anchors the behavior.
  assert.ok(source.includes("Guaynabo"), "prompt must include the Guaynabo worked example");
});

test("prompt: non-passport output budget raised for the larger schema", () => {
  const source = readFileSync(join(here, "..", "..", "api", "intake", "interpret", "route.ts"), "utf8");
  assert.ok(
    source.includes("maxOutputTokens: passportMode ? 6500 : 1600"),
    "non-passport budget must be 1600 tokens for projectContext + evidence"
  );
});

// ---------------------------------------------------------------------------
// Defensive validation of projectContext
// ---------------------------------------------------------------------------

test("validateProjectContext: Guaynabo fixture extracts the expected facts", () => {
  const { context, discarded } = validateProjectContext(GUAYNABO_MODEL_RESPONSE.projectContext);
  assert.equal(context.project_type?.value, "renovation and expansion");
  assert.equal(context.existing_building?.value, true);
  assert.equal(context.renovation?.value, true);
  assert.equal(context.expansion?.value, true);
  assert.equal(context.new_construction?.value, true);
  assert.equal(context.property_type?.value, "commercial building");
  assert.equal(context.existing_use?.value, "commercial");
  assert.equal(context.proposed_use?.value, "warehouse + office");
  // Numeric coercion: "12,000" -> 12000.
  assert.equal(context.square_footage?.value, 12000);
  assert.equal(context.interior_demolition?.value, true);
  assert.equal(context.new_walls?.value, true);
  assert.equal(context.layout_changes?.value, true);
  assert.equal(context.electrical_work?.value, true);
  assert.equal(context.plumbing_work?.value, true);
  assert.equal(context.construction_approvals_required?.value, true);
  assert.equal(context.known_permitting_issue?.value, "permitting process became a major issue");
  assert.equal(context.historical_project_status?.value, "project fell through");
  // Evidence rides along.
  assert.ok(context.square_footage?.evidence?.includes("12,000-square-foot"));
  // Unstated facts stay unknown.
  assert.ok(!projectFactKnown(context, "structural_work"));
  assert.ok(!projectFactKnown(context, "exterior_work"));
  assert.ok(!projectFactKnown(context, "site_work"));
  assert.ok(!projectFactKnown(context, "occupancy_change"));
  // Malformed entries dropped individually — the rest survives.
  assert.equal(discarded.length, 3);
  const reasons = Object.fromEntries(discarded.map((d) => [d.field, d.reason]));
  assert.equal(reasons["projectContext.structural_work"], "missing confidence");
  assert.equal(reasons["projectContext.bogus_key"], "unknown key");
  assert.equal(reasons["projectContext.exterior_work"], "malformed entry");
});

test("validateProjectContext: non-object input yields empty context, never throws", () => {
  for (const bad of [null, undefined, "x", 42, []]) {
    const { context, discarded } = validateProjectContext(bad);
    assert.deepEqual(context, {});
    assert.deepEqual(discarded, []);
  }
});

test("validateProjectContext: confidence is clamped to 0..1", () => {
  const { context } = validateProjectContext({
    renovation: { value: true, confidence: 7, evidence: "renovate" },
  });
  assert.equal(context.renovation?.confidence, 1);
});

// ---------------------------------------------------------------------------
// Confidence bands + evidence on the visible-field path
// ---------------------------------------------------------------------------

test("validateInterpretation: 0.90+ applies silently, 0.60-0.85 fills flagged, <0.60 omitted", () => {
  const validated = validateInterpretation(GUAYNABO_MODEL_RESPONSE, MIN_KB, KB_OPTIONS);
  // Municipality 0.95: applied silently.
  assert.equal(validated.municipality?.value, "Guaynabo");
  assert.equal(validated.municipality?.requiresConfirmation, false);
  assert.ok(validated.municipality?.evidence?.includes("Guaynabo"));
  // Location type 0.72: filled but flagged as needing confirmation.
  assert.equal(validated.suggested.profileValues.length, 1);
  const suggested = validated.suggested.profileValues[0];
  assert.equal(suggested.key, "location_type");
  assert.equal(suggested.value, "Warehouse");
  assert.equal(suggested.requiresConfirmation, true);
  assert.ok(suggested.evidence?.includes("warehouse"));
  // Nothing applied at full confidence for location_type.
  assert.ok(!validated.profileValues.some((p) => p.key === "location_type"));
  // Employees 0.40: omitted entirely.
  assert.ok(!validated.profileValues.some((p) => p.key === "number_of_employees"));
  assert.ok(!validated.suggested.profileValues.some((p) => p.key === "number_of_employees"));
  assert.ok(validated.discarded.some((d) => d.field === "profileValues.number_of_employees"));
});

test("validateInterpretation: business-vs-project — industry never inferred from construction work", () => {
  const raw: RawInterpretation = {
    profileValues: [
      // A model that (wrongly) guessed Construction from the renovation work.
      { key: "industry", value: "Construction", confidence: 0.55, evidence: "renovation" },
    ],
  };
  const validated = validateInterpretation(raw, MIN_KB, KB_OPTIONS);
  assert.equal(validated.profileValues.length, 0);
  assert.equal(validated.suggested.profileValues.length, 0);
  assert.ok(validated.discarded.some((d) => d.field === "profileValues.industry"));
});

test("promoteSuggested: shapes suggested facts for the fill-but-flag path", () => {
  const validated = validateInterpretation(GUAYNABO_MODEL_RESPONSE, MIN_KB, KB_OPTIONS);
  const promoted = promoteSuggested(validated);
  assert.equal(promoted.profileValues.length, 1);
  assert.equal(promoted.profileValues[0].key, "location_type");
  assert.equal(promoted.suggested.profileValues.length, 0);
  assert.equal(promoted.municipality, undefined);
});

// ---------------------------------------------------------------------------
// Deterministic follow-ups
// ---------------------------------------------------------------------------

function guaynaboContext(): ProjectContext {
  const { context } = validateProjectContext(GUAYNABO_MODEL_RESPONSE.projectContext);
  return context;
}

test("projectIsActive: true for the Guaynabo project, false for business-only facts", () => {
  assert.equal(projectIsActive(guaynaboContext()), true);
  assert.equal(projectIsActive({}), false);
  assert.equal(projectIsActive(null), false);
  assert.equal(projectIsActive({ municipality: { value: "Guaynabo", confidence: 0.9 } }), false);
});

test("projectContextFollowUps: Guaynabo asks the meaningful unknowns, never repeats stated facts", () => {
  const questions = projectContextFollowUps(guaynaboContext(), { ownerKnown: false });
  const ids = questions.map((q) => q.id);
  // Asked: owner/operator, occupancy change, structural scope, exterior/site.
  assert.deepEqual(ids, [
    "pc_owner_operator",
    "pc_occupancy_change",
    "pc_structural_work",
    "pc_exterior_site",
  ]);
  // NOT asked: facility use — proposed_use ("warehouse + office") was stated.
  assert.ok(!ids.includes("pc_facility_use"), "must not repeat the stated facility use");
  // Every question explains why it is asked.
  for (const q of questions) {
    assert.ok(q.text.length > 0);
    assert.ok(q.whyWeAsk.length > 0, `${q.id} must carry whyWeAsk`);
  }
  // The facility-use question offers the spec's answer set when it IS asked.
  const sparse: ProjectContext = {
    renovation: { value: true, confidence: 0.9, evidence: "renovating" },
  };
  const sparseQuestions = projectContextFollowUps(sparse, { ownerKnown: true });
  const facility = sparseQuestions.find((q) => q.id === "pc_facility_use");
  assert.ok(facility, "facility use must be asked when proposed_use is unknown");
  assert.deepEqual(
    facility?.options?.map((o) => o.value),
    ["warehouse", "industrial", "office", "mixed_use"]
  );
});

test("projectContextFollowUps: skips the owner question when the owner is known", () => {
  const questions = projectContextFollowUps(guaynaboContext(), { ownerKnown: true });
  assert.ok(!questions.some((q) => q.id === "pc_owner_operator"));
});

test("projectContextFollowUps: silent when there is no project", () => {
  assert.deepEqual(projectContextFollowUps({}, { ownerKnown: false }), []);
  assert.deepEqual(projectContextFollowUps(null, { ownerKnown: false }), []);
});

test("projectContextAnswerToFacts: guided answers become confidence-1 facts", () => {
  const en = "en" as const;
  // Exterior/site is one question covering two facts.
  const exterior = projectContextAnswerToFacts("pc_exterior_site", true, en);
  assert.deepEqual(
    exterior.map((f) => f.key),
    ["exterior_work", "site_work"]
  );
  assert.ok(exterior.every((f) => f.fact.confidence === 1 && f.fact.value === true));
  const facility = projectContextAnswerToFacts("pc_facility_use", "warehouse", en);
  assert.equal(facility.length, 1);
  assert.equal(facility[0].key, "proposed_use");
  assert.equal(facility[0].fact.value, "warehouse");
  assert.equal(facility[0].fact.confidence, 1);
  const owner = projectContextAnswerToFacts("pc_owner_operator", false, en);
  assert.equal(owner[0].key, "business_is_owner_operator");
  assert.equal(owner[0].fact.value, false);
  // Unknown question ids and mismatched types apply nothing.
  assert.deepEqual(projectContextAnswerToFacts("pc_nope", true, en), []);
  assert.deepEqual(projectContextAnswerToFacts("pc_occupancy_change", "warehouse", en), []);
});

test("mergeProjectContext: restated facts win, otherwise higher confidence wins", () => {
  const prev: ProjectContext = {
    renovation: { value: true, confidence: 0.9, evidence: "renovate" },
    square_footage: { value: 10000, confidence: 0.95, evidence: "10k sqft" },
  };
  // A lower-confidence restatement of square footage must NOT clobber it…
  const merged = mergeProjectContext(prev, {
    square_footage: { value: 12000, confidence: 0.6, evidence: "12k sqft" },
  });
  assert.equal(merged.square_footage?.value, 10000);
  // …but a higher-confidence fact refines it.
  const refined = mergeProjectContext(prev, {
    square_footage: { value: 12000, confidence: 0.99, evidence: "12,000 sqft" },
  });
  assert.equal(refined.square_footage?.value, 12000);
  // New facts are added.
  const extended = mergeProjectContext(prev, {
    structural_work: { value: false, confidence: 1, evidence: "user said no" },
  });
  assert.equal(extended.structural_work?.value, false);
  assert.equal(extended.renovation?.value, true);
});

test("projectContextBriefLines: only known facts, nothing invented", () => {
  const lines = projectContextBriefLines(guaynaboContext());
  assert.ok(lines.some((l) => l.includes("square_footage: 12000")));
  assert.ok(lines.some((l) => l.includes("renovation: true")));
  assert.ok(!lines.some((l) => l.includes("structural_work")), "unknown facts must not appear");
  assert.ok(lines.every((l) => l.includes("confidence")));
  const bare = projectContextBriefLines(guaynaboContext(), { includeEvidence: false });
  assert.ok(bare.every((l) => !l.includes("evidence:")));
  assert.deepEqual(projectContextBriefLines(null), []);
});

// --- Guaynabo fixture: confidence/evidence retention + name honesty ----------

test("validateProjectContext: Guaynabo facts carry confidence and evidence", () => {
  const { context } = validateProjectContext(GUAYNABO_MODEL_RESPONSE.projectContext);
  // Every retained key fact keeps its confidence and a verbatim evidence quote.
  for (const key of [
    "project_type",
    "existing_building",
    "renovation",
    "expansion",
    "property_type",
    "existing_use",
    "proposed_use",
    "square_footage",
    "interior_demolition",
    "electrical_work",
    "plumbing_work",
    "construction_approvals_required",
    "known_permitting_issue",
    "historical_project_status",
  ] as const) {
    const fact = context[key];
    assert.ok(fact, `${key} must be retained`);
    assert.ok(typeof fact.confidence === "number" && fact.confidence >= 0.85, `${key} keeps confidence`);
    assert.ok(typeof fact.evidence === "string" && fact.evidence.length > 0, `${key} keeps evidence`);
  }
  // The permitting problem and the failed prior attempt are facts too.
  assert.equal(context.known_permitting_issue?.value, "permitting process became a major issue");
  assert.equal(context.historical_project_status?.value, "project fell through");
});

test("validateInterpretation: business name stays blank when the user never states it", () => {
  const validated = validateInterpretation(GUAYNABO_MODEL_RESPONSE, MIN_KB, KB_OPTIONS);
  const all = [...validated.profileValues, ...validated.suggested.profileValues];
  assert.ok(!all.some((p) => p.key === "name"), "no name may be invented from the description");
  assert.ok(!validated.discarded.some((d) => d.field.includes("name")), "no name entry to discard either");
});

test("validateInterpretation: a stated business name is kept with evidence, never altered", () => {
  const raw: RawInterpretation = {
    summary: "Existing manufacturer renovating a building in Guaynabo.",
    municipality: { value: "Guaynabo", confidence: 0.95, evidence: "in Guaynabo" },
    profileValues: [
      { key: "name", value: "Caribe Metalworks LLC", confidence: 0.92, evidence: "Caribe Metalworks LLC is an existing manufacturing company" },
    ],
  };
  const validated = validateInterpretation(raw, MIN_KB, KB_OPTIONS);
  const name = validated.profileValues.find((p) => p.key === "name");
  assert.ok(name, "a stated business name must be retained");
  assert.equal(name?.value, "Caribe Metalworks LLC");
  assert.ok(name?.evidence?.includes("Caribe Metalworks LLC"));
  assert.equal(name?.requiresConfirmation, false);
});
