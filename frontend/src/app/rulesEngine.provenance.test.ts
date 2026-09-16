// Provenance regression tests for the SmartPR requirements engine.
//
// The hard rule: a project requirement can only use a fact if that fact
// belongs to the current project (same intake session, explicitly confirmed),
// is a persistent business-level fact legitimately applicable to the current
// project (passport fact for the same business, on a business rule), or was
// explicitly confirmed during the current intake. Stale, suggested-but-
// unconfirmed, cross-scope, or provenance-less facts can never trigger —
// and can never suppress — a requirement.
//
// Run: node --experimental-strip-types --test src/app/rulesEngine.provenance.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  runRulesEngine,
  sameTriggerProvenance,
  type EngineInput,
  type FactMeta,
  type KnowledgeBase,
  type TriggerFactProvenance,
} from "./rulesEngine.ts";
import { buildEngineInput } from "./kb.ts";
import { classifyEngineRequirements } from "./requirementApplicability.ts";

const here = dirname(fileURLToPath(import.meta.url));
const kbDir = join(here, "..", "kb");
const load = (f: string) => JSON.parse(readFileSync(join(kbDir, f), "utf8"));
const KB: KnowledgeBase = {
  municipalities: load("municipalities.json"),
  businessTypes: load("business_types.json"),
  questions: load("questions.json"),
  documents: load("documents.json"),
  rules: load("rules.json"),
};

const meta = (over: Partial<FactMeta> = {}): FactMeta => ({
  source: "user_intake",
  scope: "business",
  ...over,
});
const confirmed = (sessionId: string, over: Partial<FactMeta> = {}) =>
  meta({ sessionId, confirmedInCurrentIntake: true, ...over });

const matchedRules = (res: ReturnType<typeof runRulesEngine>) =>
  res.debug.rulesMatched.map((m) => m.rule_id);
const blocked = (res: ReturnType<typeof runRulesEngine>) => res.debug.provenanceBlocked;

// ---------------------------------------------------------------------------
// 1. A stale fact (different session) can never trigger.
// ---------------------------------------------------------------------------
test("stale session fact cannot trigger EIN/CFSE/DTRH via employees", () => {
  const input: EngineInput = {
    municipalityName: "Guaynabo",
    answers: { Q_EMPLOYEES_HIRED: true },
    factMeta: {
      municipality: confirmed("sess-new"),
      Q_EMPLOYEES_HIRED: confirmed("sess-old"), // carried over from a previous intake
    },
    sessionId: "sess-new",
    businessStatus: "new",
    entityNotFormed: true,
  };
  const res = runRulesEngine(KB, input);
  const rules = matchedRules(res);
  assert.ok(!rules.includes("RULE_0620"), "stale employees fact fired EIN rule");
  assert.ok(!rules.includes("RULE_0020"), "stale employees fact fired workers-comp rule");
  assert.ok(!rules.includes("RULE_0619"), "stale employees fact fired DTRH rule");
  const b = blocked(res).filter((x) => x.fact_key === "Q_EMPLOYEES_HIRED");
  assert.ok(b.length >= 3, "stale blocks must be recorded, never silent");
});

// ---------------------------------------------------------------------------
// 2. A suggested-but-unconfirmed interpretation is present but inert.
// ---------------------------------------------------------------------------
test("suggested-but-unconfirmed fact cannot trigger", () => {
  const input: EngineInput = {
    municipalityName: "Guaynabo",
    answers: { Q_HAZARDOUS_MATERIALS: true },
    factMeta: {
      municipality: confirmed("sess-new"),
      Q_HAZARDOUS_MATERIALS: meta({ sessionId: "sess-new", confirmedInCurrentIntake: false }),
    },
    sessionId: "sess-new",
    businessStatus: "new",
    entityNotFormed: true,
  };
  const res = runRulesEngine(KB, input);
  assert.ok(!matchedRules(res).includes("RULE_0023"), "unconfirmed hazardous-materials read fired environmental rule");
  assert.ok(
    blocked(res).some((x) => x.rule_id === "RULE_0023" && x.fact_key === "Q_HAZARDOUS_MATERIALS"),
    "unconfirmed block must be recorded"
  );
});

// ---------------------------------------------------------------------------
// 3. A confirmed current-intake fact triggers and carries its provenance.
// ---------------------------------------------------------------------------
test("confirmed current-intake fact triggers with exact provenance", () => {
  const input: EngineInput = {
    municipalityName: "Guaynabo",
    answers: { Q_EMPLOYEES_HIRED: true },
    factMeta: {
      municipality: confirmed("sess-new"),
      Q_EMPLOYEES_HIRED: confirmed("sess-new"),
    },
    sessionId: "sess-new",
    businessStatus: "new",
    entityNotFormed: true,
  };
  const res = runRulesEngine(KB, input);
  assert.ok(matchedRules(res).includes("RULE_0620"), "confirmed employees fact should fire EIN rule");
  const req = res.requirements.find((r) => r.document_id === "DOC_EIN");
  assert.ok(req, "DOC_EIN requirement expected");
  const prov = (req.triggerFactProvenance ?? []).find((p) => p.key === "Q_EMPLOYEES_HIRED");
  assert.ok(prov, "requirement must name its triggering fact");
  assert.equal(prov.value, true);
  assert.equal(prov.source, "user_intake");
  assert.equal(prov.scope, "business");
  assert.equal(prov.sessionId, "sess-new");
  assert.equal(prov.confirmedInCurrentIntake, true);
});

// ---------------------------------------------------------------------------
// 4. A fact with no provenance metadata at all can never trigger.
// ---------------------------------------------------------------------------
test("fact without provenance metadata cannot trigger", () => {
  const input: EngineInput = {
    municipalityName: "Guaynabo",
    answers: { Q_FEDERAL_CONTRACTS_GRANTS: true },
    factMeta: { municipality: confirmed("sess-new") }, // no entry for the answer
    sessionId: "sess-new",
    businessStatus: "new",
    entityNotFormed: true,
  };
  const res = runRulesEngine(KB, input);
  assert.ok(!matchedRules(res).includes("RULE_0641"), "provenance-less fact fired SAM.gov rule");
  assert.ok(
    blocked(res).some((x) => x.fact_key === "Q_FEDERAL_CONTRACTS_GRANTS" && /no provenance metadata/.test(x.reason)),
    "missing provenance must be recorded with its reason"
  );
});

// ---------------------------------------------------------------------------
// 5-7. Passport facts: same business fires business rules; anything else fails closed.
// ---------------------------------------------------------------------------
test("passport fact for the same business fires business rules", () => {
  const input: EngineInput = {
    municipalityName: "Guaynabo",
    answers: {},
    factMeta: {
      municipality: {
        source: "passport",
        scope: "business",
        sessionId: null,
        businessId: "biz-1",
      },
    },
    sessionId: "sess-new",
    businessId: "biz-1",
    businessStatus: "existing",
  };
  const res = runRulesEngine(KB, input);
  assert.ok(
    res.debug.documentsGenerated.includes("DOC_PATENTE_MUNICIPAL"),
    "passport municipality for the same business should fire municipality baseline, got: " +
      res.debug.documentsGenerated.join(",")
  );
});

test("passport fact for a different business is blocked (fail closed)", () => {
  const input: EngineInput = {
    municipalityName: "Guaynabo",
    answers: {},
    factMeta: {
      municipality: { source: "passport", scope: "business", sessionId: null, businessId: "biz-OTHER" },
    },
    sessionId: "sess-new",
    businessId: "biz-1",
    businessStatus: "existing",
  };
  const res = runRulesEngine(KB, input);
  assert.ok(
    !res.debug.documentsGenerated.includes("DOC_PATENTE_MUNICIPAL"),
    "passport fact for another business must not fire"
  );
  assert.ok(blocked(res).some((x) => x.fact_key === "municipality"), "mismatch block must be recorded");
});

test("passport fact with no identified business is blocked (fail closed)", () => {
  const input: EngineInput = {
    municipalityName: "Guaynabo",
    answers: {},
    factMeta: {
      municipality: { source: "passport", scope: "business", sessionId: null, businessId: null },
    },
    sessionId: "sess-new",
    businessId: null,
    businessStatus: "existing",
  };
  const res = runRulesEngine(KB, input);
  assert.ok(
    !res.debug.documentsGenerated.includes("DOC_PATENTE_MUNICIPAL"),
    "passport fact with no business identity must not fire"
  );
});

// ---------------------------------------------------------------------------
// 8-9. Cross-scope facts can never trigger.
// ---------------------------------------------------------------------------
test("passport (business-scope) fact cannot trigger a project rule", () => {
  const input: EngineInput = {
    municipalityName: "Guaynabo",
    answers: {},
    projectFacts: { project_type: "renovation" },
    factMeta: {
      municipality: confirmed("sess-new"),
      project_type: { source: "passport", scope: "business", sessionId: null, businessId: "biz-1" },
    },
    sessionId: "sess-new",
    businessId: "biz-1",
    businessStatus: "existing",
  };
  const res = runRulesEngine(KB, input);
  assert.ok(!matchedRules(res).includes("RULE_0644"), "business-scope fact must not fire a project rule");
});

test("project-scope fact cannot trigger a business rule", () => {
  const input: EngineInput = {
    municipalityName: "Guaynabo",
    answers: { Q_HAZARDOUS_MATERIALS: true },
    factMeta: {
      municipality: confirmed("sess-new"),
      Q_HAZARDOUS_MATERIALS: meta({ sessionId: "sess-new", confirmedInCurrentIntake: true, scope: "project" }),
    },
    sessionId: "sess-new",
    businessStatus: "new",
    entityNotFormed: true,
  };
  const res = runRulesEngine(KB, input);
  assert.ok(!matchedRules(res).includes("RULE_0023"), "project-scope fact must not fire a business rule");
});

// ---------------------------------------------------------------------------
// 10. Negative-fact suppression needs provenance too.
// ---------------------------------------------------------------------------
test("unconfirmed negative fact cannot suppress a valid rule", () => {
  const base: EngineInput = {
    municipalityName: "Guaynabo", // metro flag -> RULE_0269 stormwater plan
    answers: {},
    projectFacts: { site_work: false },
    sessionId: "sess-new",
    businessStatus: "new",
    entityNotFormed: true,
  };
  // No provenance for site_work: suppression must not happen.
  const noMeta: EngineInput = {
    ...base,
    factMeta: { municipality: confirmed("sess-new") },
  };
  const resNoMeta = runRulesEngine(KB, noMeta);
  assert.ok(
    matchedRules(resNoMeta).includes("RULE_0269"),
    "provenance-less negative fact must not suppress the stormwater rule"
  );
  // Confirmed negative fact: suppression applies and is recorded.
  const withMeta: EngineInput = {
    ...base,
    factMeta: {
      municipality: confirmed("sess-new"),
      site_work: confirmed("sess-new", { scope: "project" }),
    },
  };
  const resWithMeta = runRulesEngine(KB, withMeta);
  assert.ok(!matchedRules(resWithMeta).includes("RULE_0269"), "confirmed negative fact should suppress");
  assert.ok(
    resWithMeta.debug.rulesSuppressed.some((s) => s.rule_id === "RULE_0269" && s.suppressed_by === "site_work"),
    "suppression must be recorded"
  );
});

// ---------------------------------------------------------------------------
// 11. Deduplicated requirements keep every basis' provenance.
// ---------------------------------------------------------------------------
test("requirement merged from several rules keeps all trigger provenances", () => {
  const input: EngineInput = {
    municipalityName: "Guaynabo",
    answers: { Q_HAZARDOUS_MATERIALS: true, Q_HAZARDOUS_FLUIDS: true },
    factMeta: {
      municipality: confirmed("sess-new"),
      Q_HAZARDOUS_MATERIALS: confirmed("sess-new"),
      Q_HAZARDOUS_FLUIDS: confirmed("sess-new"),
    },
    sessionId: "sess-new",
    businessStatus: "new",
    entityNotFormed: true,
  };
  const res = runRulesEngine(KB, input);
  const req = res.requirements.find((r) => r.document_id === "DOC_ENVIRONMENTAL_PERMIT");
  assert.ok(req, "DOC_ENVIRONMENTAL_PERMIT expected");
  const keys = (req.triggerFactProvenance ?? []).map((p) => p.key).sort();
  assert.deepEqual(keys, ["Q_HAZARDOUS_FLUIDS", "Q_HAZARDOUS_MATERIALS"]);
});

// ---------------------------------------------------------------------------
// 11b. Provenance dedup uses the full triggering identity: the same fact
// re-established in a new session (or for another business, or at another
// scope) is a distinct record; exact duplicates collapse.
// ---------------------------------------------------------------------------
test("sameTriggerProvenance keeps distinct sessions, scopes, businesses; collapses exact duplicates", () => {
  const base: TriggerFactProvenance = {
    key: "Q_EMPLOYEES_HIRED",
    value: true,
    source: "user_intake",
    scope: "business",
    sessionId: "sess-1",
    businessId: "biz-1",
    confirmedInCurrentIntake: true,
  };
  assert.ok(sameTriggerProvenance(base, { ...base }), "exact duplicate must collapse");
  assert.ok(
    !sameTriggerProvenance(base, { ...base, sessionId: "sess-2" }),
    "same fact re-confirmed in a new session is a distinct record"
  );
  assert.ok(
    !sameTriggerProvenance(base, { ...base, businessId: "biz-2" }),
    "same fact for another business is a distinct record"
  );
  assert.ok(
    !sameTriggerProvenance(base, { ...base, scope: "project" }),
    "same fact at another scope is a distinct record"
  );
  assert.ok(
    !sameTriggerProvenance(base, { ...base, source: "passport" }),
    "same fact from another source is a distinct record"
  );
  assert.ok(
    !sameTriggerProvenance(base, { ...base, value: false }),
    "same fact with another value is a distinct record"
  );
  // null/undefined session identity normalizes: both absent is still a duplicate.
  assert.ok(
    sameTriggerProvenance(
      { ...base, sessionId: null, businessId: null },
      { ...base, sessionId: undefined, businessId: undefined }
    ),
    "absent session/business identity must normalize, not diverge"
  );
});

// ---------------------------------------------------------------------------
// 12. Legacy callers (no session) keep the historical behavior.
// ---------------------------------------------------------------------------
test("legacy input without sessionId keeps historical behavior", () => {
  const res = runRulesEngine(KB, {
    municipalityName: "Guaynabo",
    answers: { Q_EMPLOYEES_HIRED: true },
    businessStatus: "new",
    entityNotFormed: true,
  });
  assert.ok(matchedRules(res).includes("RULE_0620"), "legacy callers must not be gated");
  assert.equal(blocked(res).length, 0, "legacy callers record no provenance blocks");
});

// ---------------------------------------------------------------------------
// 13. Full pipeline: the Guaynabo renovation narrative.
// ---------------------------------------------------------------------------
test("Guaynabo renovation pipeline: project permits fire, contaminated facts stay inert", () => {
  // The exact production scenario: renovating an existing commercial building
  // in Guaynabo (12,000 sq ft warehouse + office, interior demolition, new
  // walls, electrical/plumbing, layout changes). The property was already
  // operating commercially. Contaminated suggestions from a previous
  // description (construction services, federal contracts, hazardous
  // materials, employees) are present but unconfirmed — the way the intake
  // actually stores them (interpreter writeKeys mirrored into the profile,
  // admin-question answers under their Q_ ids).
  const profile = {
    name: "",
    municipality: "Guaynabo",
    business_type: "",
    business_structure: "",
    industry: "",
    location_type: "",
    employees_hired: true, // suggested, unconfirmed
    hazardous_materials: true, // suggested, unconfirmed
  };
  const answers = {
    Q_OFFERS_CONSTRUCTION_SERVICES: true, // suggested, unconfirmed
    Q_FEDERAL_CONTRACTS_GRANTS: true, // suggested, unconfirmed
    // "an existing commercial building... already operating commercially" is
    // a high-confidence read of a physical commercial location (applied,
    // confirmed) — this is what the zoning/use review fires from.
    Q_PHYSICAL_LOCATION: true,
  };
  const projectContext = {
    project_type: { value: "renovation", confidence: 0.92 },
    square_footage: { value: 12000, confidence: 0.9 },
    interior_demolition: { value: true, confidence: 0.88 },
    electrical_work: { value: true, confidence: 0.87 },
    plumbing_work: { value: true, confidence: 0.87 },
  };
  const input = buildEngineInput(profile as never, answers, {}, {
    projectIntent: "existing_business",
    projectContext: projectContext as never,
    sessionId: "sess-guaynabo",
    businessId: null,
    // Only the municipality and the physical location were explicitly
    // confirmed; every contaminated suggestion stays out of confirmedKeys.
    confirmedKeys: ["municipality", "Q_PHYSICAL_LOCATION"],
    passportKeys: [],
  });
  const { requirements } = runRulesEngine(KB, input);
  const docs = requirements.map((r) => r.document_id);

  // Required: the OGPe construction permit fires from the confirmed
  // renovation project fact.
  assert.ok(docs.includes("DOC_OGPE_CONSTRUCTION_PERMIT"), "renovation must require the OGPe construction permit");
  const ogpe = requirements.find((r) => r.document_id === "DOC_OGPE_CONSTRUCTION_PERMIT");
  assert.ok(
    (ogpe?.triggerFactProvenance ?? []).some((p) => p.key === "project_type" && p.value === "renovation"),
    "OGPe permit must cite project_type=renovation as its trigger"
  );

  // Must NOT appear: every one of these came only from unconfirmed facts.
  for (const doc of [
    "DOC_EIN",
    "DOC_WORKERS_COMP",
    "DOC_DTRH_EMPLOYER_REG",
    "DOC_SAM_REGISTRATION",
    "DOC_ENVIRONMENTAL_PERMIT",
    "DOC_CONTRACTOR_LICENSE",
  ]) {
    assert.ok(!docs.includes(doc), `${doc} must not fire from unconfirmed facts`);
  }
  // Zoning/use review fires from the confirmed metro municipality.
  assert.ok(docs.includes("DOC_ZONING"), "zoning/use review should fire from confirmed Guaynabo (metro)");
});

// ---------------------------------------------------------------------------
// 14. Existing businesses verify; new businesses file anew.
// ---------------------------------------------------------------------------
test("verify_existing posture: existing business verifies, new business files", () => {
  const input = buildEngineInput(
    { municipality: "Guaynabo", business_type: "", business_structure: "", industry: "", location_type: "", name: "", employees_hired: true } as never,
    {},
    {},
    {
      projectIntent: "existing_business",
      projectContext: null,
      sessionId: "sess-verify",
      businessId: "biz-1",
      confirmedKeys: ["municipality", "employees_hired"],
      passportKeys: [],
    }
  );
  const { requirements } = runRulesEngine(KB, input);
  const ein = requirements.find((r) => r.document_id === "DOC_EIN");
  assert.ok(ein, "confirmed employees fact should produce the EIN requirement");

  const asExisting = classifyEngineRequirements(requirements, { kb: KB, businessStatus: "existing", answers: { Q_EMPLOYEES_HIRED: true } });
  const asNew = classifyEngineRequirements(requirements, { kb: KB, businessStatus: "new", answers: { Q_EMPLOYEES_HIRED: true } });
  const existingEIN = asExisting.find((r) => r.document_id === "DOC_EIN");
  const newEIN = asNew.find((r) => r.document_id === "DOC_EIN");
  assert.equal(existingEIN?.applicability, "verify_existing", "existing business verifies its EIN");
  assert.equal(newEIN?.applicability, "required", "new business files for its EIN");

  // The provenance survives classification: the card names the triggering
  // fact with its full identity — source, scope, session, and business.
  const einFacts = existingEIN?.triggerFacts ?? [];
  const einFact = einFacts.find((t) => t.includes("Q_EMPLOYEES_HIRED"));
  assert.ok(einFact, "classified requirement must expose trigger provenance, got: " + einFacts.join(" | "));
  assert.ok(einFact.includes("source: current intake"), "must name the source, got: " + einFact);
  assert.ok(einFact.includes("scope: business"), "must name the scope, got: " + einFact);
  assert.ok(einFact.includes("session: sess-verify"), "must name the session, got: " + einFact);
  assert.ok(einFact.includes("business: biz-1"), "must name the business, got: " + einFact);
});
