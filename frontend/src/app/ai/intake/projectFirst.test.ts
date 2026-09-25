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
import { classifyEngineRequirements } from "../../requirementApplicability.ts";
import { buildEngineInput, computeRequirementsFromKB } from "../../kb.ts";
import {
  isValidProjectIntent,
  normalizeProjectIntent,
  createsBusinessRecordForIntent,
  shouldCreateBusinessRecord,
  businessStatusForIntent,
  entityNotFormedForIntent,
  projectIntentLabel,
  projectIntentQuestionText,
  projectIntentWhyAsk,
} from "./projectIntent.ts";
import { validateProjectContext } from "./projectContext.ts";
import { buildGoalBrief, goalBriefToPromptBlock } from "../../../lib/agency-runs/goalBrief.ts";
import type { AgencyFilingConfig } from "../../../lib/agency-runs/filingTypes.ts";
import type { AgencyAction } from "../../../lib/agency-runs/agencyActions.ts";
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
  for (const id of ["RULE_0001", "RULE_0002", "RULE_0598", "RULE_0599"]) {
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
  const formed = runRulesEngine(KB, { ...muni, businessStatus: "new", entityNotFormed: true });
  const formedDoc = formed.requirements.find((r) => r.document_id === "DOC_CERT_INCORPORATION");
  assert.ok(formedDoc, "new+unformed must require incorporation");
  assert.ok(!formedDoc.formation_unresolved, "confirmed new+unformed is not unresolved");

  const existing = engineDocs({ ...muni, businessStatus: "existing", entityNotFormed: false });
  assert.ok(!existing.includes("DOC_CERT_INCORPORATION"), "existing business must NOT get incorporation");

  const projectOnly = engineDocs({ ...muni, businessStatus: "project_only", entityNotFormed: null });
  assert.ok(!projectOnly.includes("DOC_CERT_INCORPORATION"), "project_only must NOT get incorporation");

  // Unknown intent is honest, not silent: the requirement still surfaces (so
  // nothing is hidden) but is flagged formation-unresolved — the classifier
  // renders it conditional, never confirmed.
  const unknown = runRulesEngine(KB, { ...muni, businessStatus: null, entityNotFormed: null });
  const unknownDoc = unknown.requirements.find((r) => r.document_id === "DOC_CERT_INCORPORATION");
  assert.ok(unknownDoc, "unknown intent must not silently drop the formation requirement");
  assert.equal(unknownDoc.formation_unresolved, true, "unknown intent marks it unresolved");
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

test("unknown intent: formation requirements are conditional, never confirmed", () => {
  const input = buildEngineInput({ municipality: "San Juan" }, {}, {}, { projectIntent: null });
  const { requirements } = runRulesEngine(KB, input);
  const classified = classifyEngineRequirements(requirements, { kb: KB });

  // Formation-gated requirements surface as unresolved/conditional — the
  // honest "more information needed" state, never a confirmed requirement.
  for (const id of ["DOC_CERT_INCORPORATION", "DOC_EIN"]) {
    const req = classified.find((r) => r.document_id === id);
    assert.ok(req, `${id} must surface for unknown intent (not silently dropped)`);
    assert.equal(req.applicability, "conditional", `${id} must be conditional, never confirmed`);
    assert.equal(req.mandatory, false, `${id} must not be mandatory while unresolved`);
    assert.ok(
      req.triggerFacts.includes("formationGate:unresolved"),
      `${id} must carry the unresolved trigger fact`
    );
  }
  // Non-formation business baselines keep their current behavior.
  const merchant = classified.find((r) => r.document_id === "DOC_MERCHANT_REGISTRATION");
  assert.ok(merchant, "merchant registration baseline preserved for unknown intent");
  assert.equal(merchant.applicability, "required");
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

// --- buildEngineInput wiring: intent + project context -> engine -------------

test("buildEngineInput: intent and project context reach the engine", () => {
  const only = buildEngineInput(
    { municipality: "Guaynabo" },
    {},
    {},
    {
      projectIntent: "project_only",
      projectContext: {
        project_type: { value: "renovation", confidence: 0.9, evidence: "renovate" },
        square_footage: { value: 12000, confidence: 0.95 },
      },
    }
  );
  assert.equal(only.businessStatus, "project_only");
  assert.equal(only.entityNotFormed, null);
  assert.deepEqual(only.projectFacts, { project_type: "renovation", square_footage: 12000 });

  const formation = buildEngineInput({ municipality: "San Juan" }, {}, {}, { projectIntent: "new_business" });
  assert.equal(formation.businessStatus, "new");
  assert.equal(formation.entityNotFormed, true);

  const legacy = buildEngineInput({ municipality: "San Juan" }, {}, {});
  assert.equal(legacy.businessStatus, null);
  assert.equal(legacy.entityNotFormed, null);
  assert.equal(legacy.projectFacts, null);
});

test("buildEngineInput: project_only quarantines stale business facts", () => {
  const input = buildEngineInput(
    {
      municipality: "Guaynabo",
      business_type: "Restaurant",
      industry: "Food & Beverage",
      business_structure: "llc",
      number_of_employees: 10,
    },
    { employees_hired: true },
    { Q_EMPLOYEES_HIRED: true },
    { projectIntent: "project_only", projectContext: { project_type: { value: "renovation", confidence: 0.9 } } }
  );
  assert.equal(input.businessTypeName, null, "business type must not reach the engine");
  assert.deepEqual(input.answers, {}, "business answers must not reach the engine");
  assert.equal(input.entityType, null, "entity type must not reach the engine");
  assert.equal(input.municipalityName, "Guaynabo", "project location is kept");
  assert.deepEqual(input.projectFacts, { project_type: "renovation" });
});

test("engine: project facts alone fire construction requirements (no business profile)", () => {
  const input = buildEngineInput(
    { municipality: "Guaynabo" },
    {},
    {},
    { projectIntent: "project_only", projectContext: { project_type: { value: "renovation", confidence: 0.9 } } }
  );
  const docs = runRulesEngine(KB, input).debug.documentsGenerated;
  assert.ok(docs.includes("DOC_OGPE_CONSTRUCTION_PERMIT"), "renovation fires the OGPe construction permit");
  assert.ok(!docs.includes("DOC_EIN"), "no business facts -> no business requirements");
  assert.ok(!docs.includes("DOC_MERCHANT_REGISTRATION"), "no business facts -> no business requirements");
  assert.ok(!docs.includes("DOC_CERT_INCORPORATION"), "no business facts -> no formation requirements");
});

// --- Full intent path: model JSON -> validation -> engine input -> engine ---

test("end-to-end: LLM JSON flows through validation into the engine and goal brief", () => {
  const raw = {
    summary: "Property owner building a warehouse before finding tenants.",
    projectIntent: { value: "project_only", confidence: 0.9, evidence: "as the property owner, before finding tenants" },
    municipality: { value: "Guaynabo", confidence: 0.88, evidence: "in Guaynabo" },
    projectContext: {
      project_type: { value: "new_construction", confidence: 0.9, evidence: "building a new warehouse" },
      proposed_use: { value: "warehouse", confidence: 0.85, evidence: "warehouse" },
    },
  };
  const validated = validateInterpretation(raw, KB);
  assert.equal(validated.projectIntent?.value, "project_only");
  assert.equal(validated.municipality?.value, "Guaynabo");

  const { context } = validateProjectContext(raw.projectContext);
  const input = buildEngineInput(
    { municipality: validated.municipality?.value },
    {},
    {},
    { projectIntent: validated.projectIntent?.value ?? null, projectContext: context }
  );
  assert.equal(input.businessStatus, "project_only");
  const docs = runRulesEngine(KB, input).debug.documentsGenerated;
  assert.ok(docs.includes("DOC_OGPE_CONSTRUCTION_PERMIT"));
  assert.ok(!docs.includes("DOC_CERT_INCORPORATION"));
  assert.ok(!docs.includes("DOC_EIN"));

  const brief = buildGoalBrief({
    config: BRIEF_CONFIG,
    action: BRIEF_ACTION,
    project_intent: validated.projectIntent?.value ?? null,
  });
  assert.equal(brief.project_intent, "project_only");
  assert.ok(goalBriefToPromptBlock(brief).includes("PROJECT INTENT: Property / project only / Solo propiedad / proyecto"));
});

// --- Scenario tests: project_only / existing_business / new_business --------

const FORMATION_AND_BUSINESS_IDS = [
  "DOC_CERT_INCORPORATION",
  "DOC_ARTICLES_ORGANIZATION",
  "DOC_EIN",
  "DOC_MERCHANT_REGISTRATION",
  "DOC_PATENTE_MUNICIPAL",
  "DOC_MUNICIPAL_REGISTRATION",
  "DOC_MUNICIPAL_TAX_COMPLIANCE",
  "DOC_ANNUAL_REPORT",
];

test("scenario: project_only warehouse build gets zero business requirements", () => {
  const reqs = computeRequirementsFromKB(
    { municipality: "Guaynabo" },
    {},
    {},
    {
      projectIntent: "project_only",
      projectContext: {
        project_type: { value: "new_construction", confidence: 0.92, evidence: "building a new warehouse" },
        proposed_use: { value: "warehouse", confidence: 0.9, evidence: "warehouse" },
      },
    }
  );
  const ids = reqs.map((r) => r.document_id);
  for (const id of FORMATION_AND_BUSINESS_IDS) {
    assert.ok(!ids.includes(id), `project_only must not require ${id}`);
  }
  assert.ok(ids.includes("DOC_OGPE_CONSTRUCTION_PERMIT"), "construction permit fires from project facts alone");
});

test("scenario: existing hotel renovation gets zero formation requirements", () => {
  const reqs = computeRequirementsFromKB(
    { municipality: "San Juan", business_type: "Hotel", industry: "Accommodation & Tourism" },
    {},
    {},
    {
      projectIntent: "existing_business",
      projectContext: { project_type: { value: "renovation", confidence: 0.9, evidence: "renovating rooms" } },
    }
  );
  const ids = reqs.map((r) => r.document_id);
  assert.ok(!ids.includes("DOC_CERT_INCORPORATION"), "existing business must not get incorporation");
  assert.ok(!ids.includes("DOC_EIN"), "existing business must not get baseline EIN");
  assert.ok(ids.includes("DOC_OGPE_CONSTRUCTION_PERMIT"), "renovation permit fires from project facts");
});

test("scenario: new restaurant gets formation requirements", () => {
  const reqs = computeRequirementsFromKB(
    { municipality: "San Juan", business_type: "Restaurant", industry: "Food & Beverage" },
    {},
    {},
    { projectIntent: "new_business" }
  );
  const ids = reqs.map((r) => r.document_id);
  assert.ok(ids.includes("DOC_CERT_INCORPORATION"), "new business gets incorporation");
  assert.ok(ids.includes("DOC_EIN"), "new business gets EIN");
});

test("scenario: switching to project_only mid-flow drops stale business requirements", () => {
  const profile = { municipality: "Guaynabo", business_type: "Restaurant", number_of_employees: 10 };
  const before = computeRequirementsFromKB(profile, { employees_hired: true }, {}, { projectIntent: "new_business" });
  const after = computeRequirementsFromKB(
    profile,
    { employees_hired: true },
    {},
    { projectIntent: "project_only", projectContext: { project_type: { value: "renovation", confidence: 0.9 } } }
  );
  const beforeIds = new Set(before.map((r) => r.document_id));
  const afterIds = new Set(after.map((r) => r.document_id));
  assert.ok(beforeIds.has("DOC_CERT_INCORPORATION"), "new business gets formation");
  assert.ok(beforeIds.has("DOC_EIN"), "new business gets EIN");
  assert.ok(!afterIds.has("DOC_CERT_INCORPORATION"), "project_only drops formation");
  assert.ok(!afterIds.has("DOC_EIN"), "project_only drops business EIN");
  assert.ok(!afterIds.has("DOC_MERCHANT_REGISTRATION"), "project_only drops merchant registration");
  assert.ok(afterIds.has("DOC_OGPE_CONSTRUCTION_PERMIT"), "project_only keeps the construction permit");
});

// --- Record-creation gate -----------------------------------------------------

test("createsBusinessRecordForIntent: only new_business creates records", () => {
  assert.equal(createsBusinessRecordForIntent("new_business"), true);
  assert.equal(createsBusinessRecordForIntent("existing_business"), false, "existing work links, never creates");
  assert.equal(createsBusinessRecordForIntent("project_only"), false, "project work uses the Project Passport");
  assert.equal(createsBusinessRecordForIntent(null), false);
  assert.equal(createsBusinessRecordForIntent(undefined), false);
});

// --- Goal brief carries project_intent ----------------------------------------

const BRIEF_CONFIG: AgencyFilingConfig = {
  id: "OGPE_PERMISO_UNICO",
  verification: { status: "documented", evidence: "test fixture" },
  payment: { governmentFee: "unknown", feeNote: "fixture", collector: "fixture", methods: "fixture", integration: "unknown", integrationEvidence: "fixture", smartprPath: "user_pays_in_portal" },
  labelEn: "OGPe Permiso Unico",
  labelEs: "OGPe Permiso Unico",
  agencyEn: "OGPe",
  agencyEs: "OGPe",
  portalEn: "sbp.ogpe.pr.gov",
  portalEs: "sbp.ogpe.pr.gov",
  domains: ["sbp.ogpe.pr.gov"],
  startUrl: "https://sbp.ogpe.pr.gov",
  goalEn: "File the Permiso Unico",
  goalEs: "Solicitar el Permiso Unico",
  procedureEn: [],
  procedureEs: [],
  uploadsEn: "None",
  uploadsEs: "Ninguno",
  hintsEn: [],
  hintsEs: [],
  evidenceTags: [],
  needsLogin: false,
  enabled: true,
  requiresExistingAccount: false,
};

const BRIEF_ACTION: AgencyAction = {
  id: "a1",
  filing_type: "OGPE_PERMISO_UNICO",
  agency_id: "ogpe",
  title_en: "File the Permiso Unico",
  title_es: "Solicitar el Permiso Unico",
  agency_en: "OGPe",
  agency_es: "OGPe",
  status: "ready",
  known: 1,
  total: 3,
  missing_items: [],
  blocked_by: [],
  evidence_available: [],
  objective_en: "File the Permiso Unico",
  objective_es: "Solicitar el Permiso Unico",
};

test("goalBrief: project_intent reaches the agent brief and prompt block", () => {
  const brief = buildGoalBrief({ config: BRIEF_CONFIG, action: BRIEF_ACTION, project_intent: "project_only" });
  assert.equal(brief.project_intent, "project_only");
  const block = goalBriefToPromptBlock(brief);
  assert.ok(block.includes("PROJECT INTENT: Property / project only / Solo propiedad / proyecto"));

  const noIntent = buildGoalBrief({ config: BRIEF_CONFIG, action: BRIEF_ACTION });
  assert.equal(noIntent.project_intent, null);
  assert.ok(!goalBriefToPromptBlock(noIntent).includes("PROJECT INTENT:"));
});

// --- Creation guard: shouldCreateBusinessRecord --------------------------------

const CREATION_BASE = {
  signedIn: true,
  alreadyAttempted: false,
  projectIntent: "new_business" as const,
  intentConfirmed: true,
  entryParam: "new-business",
  businessParam: null,
};

test("shouldCreateBusinessRecord: confirmed new_business via the entry creates", () => {
  assert.equal(shouldCreateBusinessRecord(CREATION_BASE), true);
});

test("shouldCreateBusinessRecord: project_only NEVER creates, even confirmed", () => {
  assert.equal(
    shouldCreateBusinessRecord({ ...CREATION_BASE, projectIntent: "project_only" }),
    false,
    "a project-only intent can never create a business/matter"
  );
});

test("shouldCreateBusinessRecord: existing_business never creates", () => {
  assert.equal(
    shouldCreateBusinessRecord({ ...CREATION_BASE, projectIntent: "existing_business" }),
    false
  );
});

test("shouldCreateBusinessRecord: unknown intent never creates", () => {
  assert.equal(shouldCreateBusinessRecord({ ...CREATION_BASE, projectIntent: null }), false);
});

test("shouldCreateBusinessRecord: unconfirmed new_business waits (no race with a later switch)", () => {
  // The ?entry=new-business default alone does not confirm the branch: the
  // user may still switch to project_only before anything is created.
  assert.equal(
    shouldCreateBusinessRecord({ ...CREATION_BASE, intentConfirmed: false }),
    false
  );
});

test("shouldCreateBusinessRecord: guests, repeats, and attached records never create", () => {
  assert.equal(shouldCreateBusinessRecord({ ...CREATION_BASE, signedIn: false }), false);
  assert.equal(shouldCreateBusinessRecord({ ...CREATION_BASE, alreadyAttempted: true }), false);
  assert.equal(shouldCreateBusinessRecord({ ...CREATION_BASE, businessParam: "biz_123" }), false);
  assert.equal(shouldCreateBusinessRecord({ ...CREATION_BASE, entryParam: null }), false);
  assert.equal(shouldCreateBusinessRecord({ ...CREATION_BASE, entryParam: "other" }), false);
});
