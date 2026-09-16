// Tests for the project-first intake layer.
// Run: npx tsx --test src/app/ai/intake/projectFirst.test.ts
//
// Covers: intent helpers, bilingual intent copy, the prompt contract,
// validateInterpretation confidence bands, the five spec worked examples,
// deterministic engine gating (formation only for new+unformed; zero
// business requirements for project_only; construction permits from project
// facts alone), and the versioned Project Passport.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { runRulesEngine, type KnowledgeBase, type EngineInput } from "../../rulesEngine.ts";
import {
  isValidProjectIntent,
  normalizeProjectIntent,
  businessStatusForIntent,
  entityNotFormedForIntent,
  projectIntentLabel,
  projectIntentQuestionText,
  projectIntentWhyAsk,
} from "./projectIntent.ts";
import { validateInterpretation } from "./validateInterpretation.ts";
import {
  projectPassportFromContext,
  validateProjectPassport,
  projectPassportTitle,
  PROJECT_PASSPORT_VERSION,
} from "../../forms/engine/projectPassport.ts";

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
const rulesById = new Map(KB.rules.map((r) => [r.id, r]));

// --- Intent helpers -------------------------------------------------------

test("intent: closed set normalization", () => {
  assert.equal(normalizeProjectIntent("existing_business"), "existing_business");
  assert.equal(normalizeProjectIntent(" NEW_BUSINESS "), "new_business");
  assert.equal(normalizeProjectIntent("project_only"), "project_only");
  assert.equal(normalizeProjectIntent("startup"), null);
  assert.equal(normalizeProjectIntent(null), null);
  assert.ok(isValidProjectIntent("project_only"));
  assert.ok(!isValidProjectIntent("business"));
});

test("intent: engine status mapping", () => {
  assert.equal(businessStatusForIntent("new_business"), "new");
  assert.equal(businessStatusForIntent("existing_business"), "existing");
  assert.equal(businessStatusForIntent("project_only"), "project_only");
  assert.equal(businessStatusForIntent(null), null);
  assert.equal(entityNotFormedForIntent("new_business"), true);
  assert.equal(entityNotFormedForIntent("existing_business"), false);
  // project_only / unknown fail closed — formation rules must stay silent.
  assert.equal(entityNotFormedForIntent("project_only"), null);
  assert.equal(entityNotFormedForIntent(null), null);
});

test("intent: bilingual copy", () => {
  assert.equal(
    projectIntentQuestionText("en"),
    "Is this for an existing business, a new business, or a property/project that is not tied to a business yet?"
  );
  assert.equal(
    projectIntentQuestionText("es"),
    "¿Es esto para un negocio existente, un negocio nuevo, o una propiedad/proyecto que aún no está atado a un negocio?"
  );
  assert.equal(projectIntentLabel("existing_business", "en"), "Existing business");
  assert.equal(projectIntentLabel("new_business", "es"), "Negocio nuevo");
  assert.equal(projectIntentLabel("project_only", "es"), "Solo propiedad / proyecto");
  assert.ok(projectIntentWhyAsk("en").length > 0);
  assert.ok(projectIntentWhyAsk("es").length > 0);
});

// --- Prompt contract -------------------------------------------------------

test("prompt: project_intent schema and disambiguation guidance", () => {
  const source = readFileSync(join(here, "..", "..", "api", "intake", "interpret", "route.ts"), "utf8");
  assert.ok(source.includes('"project_intent"'), "schema must include project_intent");
  assert.ok(source.includes("existing_business"), "must name existing_business");
  assert.ok(source.includes("new_business"), "must name new_business");
  assert.ok(source.includes("project_only"), "must name project_only");
  assert.ok(source.includes("CONFIDENCE BANDS"), "intent must follow confidence bands");
  assert.ok(
    source.includes("project_only means no business"),
    "must disambiguate: construction FOR an existing company is existing_business"
  );
  assert.ok(source.includes("Never default"), "intent must never be defaulted");
});

// --- validateInterpretation confidence bands --------------------------------

test("validateInterpretation: intent confidence bands", () => {
  const raw = (confidence: number, value = "existing_business") => ({
    projectIntent: { value, confidence, evidence: "we operate our hotel" },
  });
  const applied = validateInterpretation(raw(0.9), KB);
  assert.equal(applied.projectIntent?.value, "existing_business");
  assert.equal(applied.projectIntent?.requiresConfirmation, false);
  assert.equal(applied.suggested.projectIntent, undefined);

  const suggested = validateInterpretation(raw(0.7), KB);
  assert.equal(suggested.projectIntent, undefined);
  assert.equal(suggested.suggested.projectIntent?.value, "existing_business");
  assert.equal(suggested.suggested.projectIntent?.requiresConfirmation, true);

  const dropped = validateInterpretation(raw(0.4), KB);
  assert.equal(dropped.projectIntent, undefined);
  assert.equal(dropped.suggested.projectIntent, undefined);
  assert.ok(dropped.discarded.some((d) => d.field === "projectIntent"));

  const unknown = validateInterpretation(raw(0.95, "some_startup"), KB);
  assert.equal(unknown.projectIntent, undefined);
  assert.ok(unknown.discarded.some((d) => d.field === "projectIntent"));
});

// --- Five spec worked examples ----------------------------------------------
// These mirror what the interpreter emits for each narrative; validation
// (never the test) is what admits them into the intake.

const exampleRaw = (value: string, confidence: number, evidence: string) => ({
  projectIntent: { value, confidence, evidence },
});

test("worked examples: the five intent branches validate", () => {
  // 1. Existing company building a new warehouse -> existing_business
  const ex1 = validateInterpretation(
    exampleRaw("existing_business", 0.92, "our company is building a new warehouse"), KB);
  assert.equal(ex1.projectIntent?.value, "existing_business");
  // 2. Existing hotel renovating rooms -> existing_business
  const ex2 = validateInterpretation(
    exampleRaw("existing_business", 0.9, "we operate a hotel and are renovating rooms"), KB);
  assert.equal(ex2.projectIntent?.value, "existing_business");
  // 3. Existing manufacturer adding a production line -> existing_business
  const ex3 = validateInterpretation(
    exampleRaw("existing_business", 0.88, "our plant is adding a production line"), KB);
  assert.equal(ex3.projectIntent?.value, "existing_business");
  // 4. Property owner building pre-tenant -> project_only
  const ex4 = validateInterpretation(
    exampleRaw("project_only", 0.9, "as the property owner, building before finding tenants"), KB);
  assert.equal(ex4.projectIntent?.value, "project_only");
  // 5. New entrepreneur opening a restaurant -> new_business
  const ex5 = validateInterpretation(
    exampleRaw("new_business", 0.91, "I want to open a restaurant"), KB);
  assert.equal(ex5.projectIntent?.value, "new_business");
});

// --- Deterministic engine gating --------------------------------------------

const engineDocs = (input: EngineInput): string[] =>
  runRulesEngine(KB, input).debug.documentsGenerated;

test("KB audit: formation rules carry the new-business gate", () => {
  for (const id of ["RULE_0001", "RULE_0598", "RULE_0599"]) {
    assert.equal(
      rulesById.get(id)?.requires_new_unformed_business, true,
      `${id} must be gated to new + unformed`
    );
  }
  for (const id of ["RULE_0001", "RULE_0002", "RULE_0003", "RULE_0004", "RULE_0005", "RULE_0006", "RULE_0636"]) {
    assert.equal(rulesById.get(id)?.requires_business, true, `${id} must require a business`);
  }
  for (const id of ["RULE_0643", "RULE_0644", "RULE_0645", "RULE_0646"]) {
    const r = rulesById.get(id);
    assert.ok(r, `${id} must exist`);
    assert.equal(r?.rule_type, "project_fact");
    assert.equal(r?.requires_document_id, "DOC_OGPE_CONSTRUCTION_PERMIT");
  }
});

test("formation: Certificate of Incorporation fires only for new + unformed", () => {
  const muni = { municipalityName: "San Juan", businessTypeName: null, answers: {} };
  const formed = engineDocs({ ...muni, businessStatus: "new", entityNotFormed: true });
  assert.ok(formed.includes("DOC_CERT_INCORPORATION"), "new+unformed must require incorporation");

  const existing = engineDocs({ ...muni, businessStatus: "existing", entityNotFormed: false });
  assert.ok(!existing.includes("DOC_CERT_INCORPORATION"), "existing business must NOT get incorporation");

  const projectOnly = engineDocs({ ...muni, businessStatus: "project_only", entityNotFormed: null });
  assert.ok(!projectOnly.includes("DOC_CERT_INCORPORATION"), "project_only must NOT get incorporation");

  // Unknown intent preserves current behavior (the assumed-new-business
  // baseline) — the gate only narrows known intents.
  const unknown = engineDocs({ ...muni, businessStatus: null, entityNotFormed: null });
  assert.ok(unknown.includes("DOC_CERT_INCORPORATION"), "unknown intent keeps the current baseline");
});

test("project_only: zero business requirements, even with a municipality", () => {
  const docs = engineDocs({
    municipalityName: "Guaynabo",
    businessTypeName: null,
    answers: {},
    businessStatus: "project_only",
    entityNotFormed: null,
  });
  for (const id of [
    "DOC_CERT_INCORPORATION",
    "DOC_EIN",
    "DOC_MERCHANT_REGISTRATION",
    "DOC_PATENTE_MUNICIPAL",
    "DOC_MUNICIPAL_REGISTRATION",
    "DOC_MUNICIPAL_TAX_COMPLIANCE",
    "DOC_ANNUAL_REPORT",
  ]) {
    assert.ok(!docs.includes(id), `project_only must not require ${id}`);
  }
});

test("unknown intent preserves current baseline behavior", () => {
  const docs = engineDocs({
    municipalityName: "San Juan",
    businessTypeName: null,
    answers: {},
    businessStatus: null,
    entityNotFormed: null,
  });
  // Baselines still fire when intent was never determined — the formation
  // baseline included, exactly as before this gate existed.
  assert.ok(docs.includes("DOC_EIN"), "EIN baseline preserved for unknown intent");
  assert.ok(docs.includes("DOC_MERCHANT_REGISTRATION"), "merchant reg baseline preserved");
  assert.ok(docs.includes("DOC_CERT_INCORPORATION"), "formation baseline preserved when unknown");
});

test("construction permits fire from project facts alone", () => {
  const base: EngineInput = {
    municipalityName: "Guaynabo",
    businessTypeName: null,
    answers: {},
    businessStatus: "project_only",
    entityNotFormed: null,
  };
  const reno = engineDocs({ ...base, projectFacts: { project_type: "renovation" } });
  assert.ok(reno.includes("DOC_OGPE_CONSTRUCTION_PERMIT"), "renovation triggers construction permit");

  const newBuild = engineDocs({ ...base, projectFacts: { project_type: "new_construction" } });
  assert.ok(newBuild.includes("DOC_OGPE_CONSTRUCTION_PERMIT"), "new construction triggers permit");

  const structural = engineDocs({ ...base, projectFacts: { structural_work: true } });
  assert.ok(structural.includes("DOC_OGPE_CONSTRUCTION_PERMIT"), "structural work triggers permit");

  const approvals = engineDocs({ ...base, projectFacts: { construction_approvals_required: true } });
  assert.ok(approvals.includes("DOC_OGPE_CONSTRUCTION_PERMIT"), "required approvals trigger permit");

  const none = engineDocs({ ...base, projectFacts: {} });
  assert.ok(!none.includes("DOC_OGPE_CONSTRUCTION_PERMIT"), "no project facts, no permit");
  // And the project still gets zero business requirements alongside.
  assert.ok(!none.includes("DOC_EIN"), "project_only still has zero business requirements");
});

// --- Project Passport ---------------------------------------------------------

test("projectPassport: build, round-trip, and branch rules", () => {
  const context = {
    project_type: { value: "renovation", confidence: 0.9, evidence: "renovate an existing building" },
    municipality_name: { value: "Guaynabo", confidence: 0.95 },
  } as never;

  const only = projectPassportFromContext({ intent: "project_only", projectContext: context });
  assert.ok(only);
  assert.equal(only.version, PROJECT_PASSPORT_VERSION);
  assert.equal(only.intent, "project_only");
  assert.equal(only.business_id, null, "project_only links no business");
  assert.equal(only.facts["project_type"].value, "renovation");

  const linked = projectPassportFromContext({
    intent: "existing_business",
    business_id: "biz-123",
    projectContext: context,
  });
  assert.equal(linked?.business_id, "biz-123", "existing_business links the business");

  const forming = projectPassportFromContext({
    intent: "new_business",
    business_id: "biz-999",
    projectContext: context,
  });
  assert.equal(forming?.business_id, null, "new_business links no business yet");

  assert.equal(projectPassportFromContext({ intent: null, projectContext: context }), null);

  const restored = validateProjectPassport(JSON.parse(JSON.stringify(linked)));
  assert.deepEqual(restored, linked, "persisted passport must round-trip exactly");

  assert.equal(validateProjectPassport({ ...linked, version: 999 }), null, "wrong version rejected");
  assert.equal(validateProjectPassport({ ...linked, intent: "startup" }), null, "unknown intent rejected");
  assert.equal(validateProjectPassport(null), null);

  assert.equal(projectPassportTitle(only!), "renovation — Guaynabo");
});
