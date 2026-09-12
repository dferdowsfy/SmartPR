import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRequirementGuidance, type GuidanceContext, type GuidanceRequirement } from "../requirementGuidance";
import { KB, buildEngineInput, applyKbSnapshot } from "../kb";
import { runRulesEngine } from "../rulesEngine";
import { PR_REQUIREMENT_GUIDANCE } from "./pr";
import { duplicateGuidanceIds, validateGuidanceConcept } from "./model";
import { buildSeedNodes } from "../rk/seed-data";
import { compileKb } from "../rk/compile";
import { NODE_TYPE_CONFIGS, validateNodeData } from "../rk/registry";
import { L } from "../i18n";

const profile = { municipality: "Bayamón", business_type: "Bar", business_structure: "LLC", location_type: "Restaurant Location", number_of_employees: 10, alcohol_sold: true };
const answers = { alcohol_sold: true, existing_lease: true };
const ctx: GuidanceContext = { language: "en", municipality: profile.municipality, businessTypeName: profile.business_type, profile, discoveryAnswers: answers, entityType: "limited_liability_company", kb: KB, engineInput: buildEngineInput(profile, answers) };
function req(id: string): GuidanceRequirement {
  const doc = KB.documents.find(d => d.id === id)!;
  return { document_id: id, code: id.toLowerCase(), name: doc?.name ?? id, agency: doc?.agency ?? "", reason: "Old generic text must not leak", applicability: "required", triggerFacts: id === "DOC_ARTICLES_ORGANIZATION" ? ["entityType:limited_liability_company"] : [] };
}

// Food-triggered concepts (Health Permit, Fire Cert, CFPM) stay provisional for this
// profile because it never answers a food question — that is correct, not a bug.
// Solar-triggered concepts stay provisional for the same reason: a bar answers no
// solar questions.
const FOOD_GATED = new Set(["DOC_HEALTH_PERMIT", "DOC_FIRE_CERT", "DOC_CFPM"]);
const SOLAR_GATED = new Set(["DOC_LUMA_INTERCONNECTION", "DOC_NET_METERING_AGREEMENT", "DOC_OGPE_CONSTRUCTION_PERMIT"]);

test("same Bayamón bar: all twenty-one source-backed explanations are distinct and actionable in EN/ES", () => {
  for (const language of ["en", "es"] as const) {
    const output = Object.keys(PR_REQUIREMENT_GUIDANCE).map(id => buildRequirementGuidance(req(id), { ...ctx, language }));
    for (const g of output) {
      if (FOOD_GATED.has(g.requirementId) || SOLAR_GATED.has(g.requirementId)) {
        assert.equal(g.status, "GUIDANCE_NEEDS_REVIEW", `${g.requirementId}: ${g.reviewReasons}`);
        assert.ok(g.regulatoryReason && g.purpose && g.nextAction && g.consequenceOrNextStep);
        continue;
      }
      assert.equal(g.status, "VALIDATED", `${g.requirementId}: ${g.reviewReasons}`);
      assert.ok(g.triggerFacts.length && g.sources.length && g.sourceVersion);
      assert.ok(g.triggerFacts.every(f => f.ruleIds.length && f.conditionPath.includes(g.requirementId)));
      // The why is contextual (trigger-fact lead) but always ends with the
      // untouched validated regulatory reason — never a rewritten rationale.
      assert.ok(g.whyThisApplies.endsWith(g.regulatoryReason), `${g.requirementId}: why must end with the validated regulatory reason`);
      assert.ok(g.whyThisApplies === g.regulatoryReason || /^(Your situation|Tu situación): /.test(g.whyThisApplies),
        `${g.requirementId}: unexpected why lead`);
      assert.doesNotMatch(g.whyThisApplies, /You confirmed|Confirmaste/);
      assert.doesNotMatch(JSON.stringify(g), /Old generic text|BarBayamón|compliance profile current|issued or required by/);
    }
    for (const field of ["regulatoryReason", "purpose", "nextAction", "consequenceOrNextStep"] as const) assert.equal(new Set(output.map(g => g[field])).size, 21);
  }
});

test("alcohol and LLC do not leak municipality or unrelated business facts", () => {
  const alcohol = buildRequirementGuidance(req("DOC_ALCOHOL_LICENSE"), ctx);
  assert.deepEqual(alcohol.triggerFacts.map(f => f.key), ["Q_ALCOHOL_SOLD"]);
  assert.doesNotMatch(alcohol.whyThisApplies, /Bayamón|Bar|employee|LLC/);
  const llc = buildRequirementGuidance(req("DOC_ARTICLES_ORGANIZATION"), ctx);
  assert.deepEqual(llc.triggerFacts.map(f => f.key), ["entityType"]);
  assert.doesNotMatch(llc.whyThisApplies, /Bayamón|alcohol/);
  assert.match(buildRequirementGuidance(req("DOC_PATENTE_MUNICIPAL"), ctx).whyThisApplies, /Bayamón/);
});

test("EIN prerequisite follows the selected entity without adding any obligation", () => {
  assert.deepEqual(buildRequirementGuidance(req("DOC_EIN"), ctx).dependencies, ["DOC_ARTICLES_ORGANIZATION"]);
  assert.deepEqual(buildRequirementGuidance(req("DOC_EIN"), { ...ctx, entityType: "stock_corporation" }).dependencies, ["DOC_CERT_INCORPORATION"]);
  assert.deepEqual(buildRequirementGuidance(req("DOC_EIN"), { ...ctx, entityType: "sole_proprietorship" }).dependencies, []);
});

test("existing disclosure headings translate without changing markup or interactions", () => {
  for (const text of ["Why do I need this?", "Why you need this", "What this is", "What you'll do", "Then what?", "SmartPR identified this because:", "Verified"]) {
    assert.notEqual(L(text, "es"), text);
    assert.equal(L(text, "en"), text);
  }
});

test("unknown, false and contradictory sales never become affirmative explanations", () => {
  for (const discoveryAnswers of [{}, { alcohol_sold: false }, { alcohol_sold: true, Q_ALCOHOL_SOLD: false }]) {
    const g = buildRequirementGuidance(req("DOC_ALCOHOL_LICENSE"), { ...ctx, profile: { ...profile, alcohol_sold: undefined }, discoveryAnswers });
    assert.equal(g.status, "GUIDANCE_NEEDS_REVIEW");
    assert.deepEqual(g.triggerFacts, []);
    assert.match(g.whyThisApplies, /not confirmed yet/);
    assert.ok(g.whyThisApplies.includes(g.regulatoryReason));
  }
});

test("physical premises do not imply a signed lease; ownership contradicts leased premises", () => {
  for (const discoveryAnswers of [{}, { existing_lease: false }, { existing_lease: true, owns_property: true }]) {
    assert.equal(buildRequirementGuidance(req("DOC_LEASE_AGREEMENT"), { ...ctx, discoveryAnswers }).status, "GUIDANCE_NEEDS_REVIEW");
  }
  const g = buildRequirementGuidance(req("DOC_LEASE_AGREEMENT"), ctx);
  assert.match(g.whatThisIs, /not a government-issued permit/);
  assert.match(g.whatYouNeedToDo, /signed lease/);
});

test("local Bayamón sources cannot assert another municipality's requirements", () => {
  for (const id of ["DOC_PATENTE_MUNICIPAL", "DOC_LEASE_AGREEMENT"]) {
    assert.equal(buildRequirementGuidance(req(id), { ...ctx, municipality: "San Juan" }).status, "GUIDANCE_NEEDS_REVIEW");
  }
});

test("canonical lease confirmation is reused, while ownership and contradictions are respected", () => {
  assert.equal(buildRequirementGuidance(req("DOC_LEASE_AGREEMENT"), { ...ctx, discoveryAnswers: {}, occupancyType: "leased" }).status, "VALIDATED");
  for (const occupancyType of ["owned", "other"] as const) assert.equal(buildRequirementGuidance(req("DOC_LEASE_AGREEMENT"), { ...ctx, occupancyType }).status, "GUIDANCE_NEEDS_REVIEW");
  assert.equal(buildRequirementGuidance(req("DOC_LEASE_AGREEMENT"), { ...ctx, discoveryAnswers: { existing_lease: false }, occupancyType: "leased" }).status, "GUIDANCE_NEEDS_REVIEW");
});

test("a physical-location boolean alone does not establish nonresidential use", () => {
  for (const location_type of ["", "Home-Based Business", "Online / Remote Only", "Mobile Business", "Mixed Use Property"]) {
    assert.equal(buildRequirementGuidance(req("DOC_PERMISO_UNICO"), { ...ctx, profile: { ...profile, location_type, physical_location: true } }).status, "GUIDANCE_NEEDS_REVIEW");
  }
});

test("conditional and suppressed items never receive definitive obligation explanations", () => {
  for (const applicability of ["conditional", "not_applicable", "recommended"]) assert.equal(buildRequirementGuidance({ ...req("DOC_ALCOHOL_LICENSE"), applicability }, ctx).status, "GUIDANCE_NEEDS_REVIEW");
});

test("missing source, rationale, purpose, validation or genuine match fails closed", () => {
  const concept = PR_REQUIREMENT_GUIDANCE.DOC_ALCOHOL_LICENSE;
  for (const change of [{ sources: [] }, { purpose: { en: "", es: "" } }, { validationStatus: "needs_review" }, { regulatoryReason: { en: "This applies based on what SmartPR knows about your project.", es: "" } }]) {
    const kb = { ...KB, documents: KB.documents.map(d => d.id === concept.requirementId ? { ...d, requirement_guidance: { ...concept, ...change } } : d) };
    assert.equal(buildRequirementGuidance(req(concept.requirementId), { ...ctx, kb }).status, "GUIDANCE_NEEDS_REVIEW");
  }
  assert.equal(buildRequirementGuidance(req(concept.requirementId), { ...ctx, engineInput: undefined }).status, "GUIDANCE_NEEDS_REVIEW");
  assert.equal(buildRequirementGuidance(req("DOC_FIRE_CERT"), ctx).status, "GUIDANCE_NEEDS_REVIEW");
  assert.equal(buildRequirementGuidance(req("DOC_TOURISM_REGISTRATION"), ctx).status, "GUIDANCE_NEEDS_REVIEW");
});

test("bad graph JSON cannot crash the page", () => {
  for (const bad of [null, "text", 7, {}, { ...PR_REQUIREMENT_GUIDANCE.DOC_ALCOHOL_LICENSE, sources: [null] }, { ...PR_REQUIREMENT_GUIDANCE.DOC_ALCOHOL_LICENSE, conditions: [null] }]) {
    const kb = { ...KB, documents: KB.documents.map(d => ({ ...d, requirement_guidance: bad })) };
    assert.equal(buildRequirementGuidance(req("DOC_ALCOHOL_LICENSE"), { ...ctx, kb }).status, "GUIDANCE_NEEDS_REVIEW");
  }
});

test("title-swap and copied unrelated explanations are rejected", () => {
  const alcohol = PR_REQUIREMENT_GUIDANCE.DOC_ALCOHOL_LICENSE;
  const copy = { ...alcohol, requirementId: "DOC_PERMISO_UNICO" };
  assert.deepEqual([...duplicateGuidanceIds([alcohol, copy])].sort(), ["DOC_ALCOHOL_LICENSE", "DOC_PERMISO_UNICO"]);
  const kb = { ...KB, documents: KB.documents.map(d => d.id === copy.requirementId ? { ...d, requirement_guidance: copy } : d) };
  assert.equal(buildRequirementGuidance(req(copy.requirementId), { ...ctx, kb }).status, "GUIDANCE_NEEDS_REVIEW");
  assert.ok(validateGuidanceConcept(alcohol, copy.requirementId).includes("REQUIREMENT_MISMATCH"));
});

test("irrelevant template context is rejected before guidance is returned", () => {
  const concept = structuredClone(PR_REQUIREMENT_GUIDANCE.DOC_ALCOHOL_LICENSE);
  concept.regulatoryReason.en += " In {municipality}.";
  assert.ok(validateGuidanceConcept(concept).includes("IRRELEVANT_CONTEXT"));
});

test("generic purpose or missing subject is rejected even with a source URL", () => {
  for (const purpose of ["Alcohol Beverage License is required by Hacienda.", "The document records all the relevant information about this business."]) {
    const concept = structuredClone(PR_REQUIREMENT_GUIDANCE.DOC_ALCOHOL_LICENSE);
    concept.purpose.en = purpose;
    assert.ok(validateGuidanceConcept(concept).some(e => /purpose_en_(GENERIC|SUBJECT_MISSING)/.test(e)));
  }
});

test("publication rejects missing, withdrawn, stale-version and unrelated sources", () => {
  for (const change of [null, { legal_status: "repealed" }, { source_version: "changed" }, { supports_document_ids: [] }]) {
    const nodes = buildSeedNodes().flatMap(n => n.entityId !== "SRC_GUIDANCE_ALCOHOL" ? [n] : change === null ? [] : [{ ...n, data: { ...n.data, ...change } }]);
    assert.throws(() => compileKb(nodes, { version: 1, batchId: null }), /GUIDANCE_NEEDS_REVIEW/);
  }
});

test("source/condition/dependency edges and compiled graph retain guidance; engine output is unchanged", () => {
  const before = runRulesEngine(KB, ctx.engineInput!);
  const nodes = buildSeedNodes();
  for (const id of Object.keys(PR_REQUIREMENT_GUIDANCE)) {
    const node = nodes.find(n => n.entityId === id)!;
    assert.deepEqual(validateNodeData("document", node.data), []);
    const edges = NODE_TYPE_CONFIGS.document.edgesOf(node.data);
    assert.ok(edges.some(e => e.edgeType === "derived_from"));
    for (const s of PR_REQUIREMENT_GUIDANCE[id].sources) assert.ok(nodes.find(n => n.entityId === s.id));
  }
  const compiled = compileKb(nodes, { version: 1, batchId: null });
  assert.deepEqual(compiled.documents.find(d => d.id === "DOC_ALCOHOL_LICENSE")?.requirement_guidance, PR_REQUIREMENT_GUIDANCE.DOC_ALCOHOL_LICENSE);
  for (const id of Object.keys(PR_REQUIREMENT_GUIDANCE)) buildRequirementGuidance(req(id), ctx);
  assert.deepEqual(runRulesEngine(KB, ctx.engineInput!), before);
});

test("old snapshots gain bundled content; published changes and explicit withdrawal win", () => {
  const original = structuredClone(KB);
  try {
    const documents = original.documents.map(d => { const copy = { ...d }; delete copy.requirement_guidance; return copy; });
    assert.ok(applyKbSnapshot({ ...original, documents }));
    assert.equal(buildRequirementGuidance(req("DOC_ALCOHOL_LICENSE"), ctx).status, "VALIDATED");
    const overridden = documents.map(d => d.id === "DOC_ALCOHOL_LICENSE" ? { ...d, requirement_guidance: null } : d);
    assert.ok(applyKbSnapshot({ ...original, documents: overridden }));
    assert.equal(buildRequirementGuidance(req("DOC_ALCOHOL_LICENSE"), ctx).status, "GUIDANCE_NEEDS_REVIEW");
  } finally { applyKbSnapshot(original); }
});

test("each validated purpose teaches something requirement-specific, with no application/issuance confusion", () => {
  const signatures: Record<string, RegExp> = {
    DOC_ALCOHOL_LICENSE: /category of alcoholic-beverage sales/,
    DOC_EIN: /official evidence of the EIN/,
    DOC_MERCHANT_REGISTRATION: /IVU withholding agent/,
    DOC_PERMISO_UNICO: /operating-permit process/,
    DOC_PATENTE_MUNICIPAL: /municipal business-tax obligation/,
    DOC_LEASE_AGREEMENT: /agreement with the landlord/,
    DOC_ARTICLES_ORGANIZATION: /establishes the limited liability company/,
    DOC_WORKERS_COMP: /workers' compensation coverage/,
  };
  for (const [id, pattern] of Object.entries(signatures)) {
    const guidance = buildRequirementGuidance(req(id), ctx);
    assert.match(guidance.purpose, pattern);
    for (const other of Object.keys(signatures).filter(k => k !== id)) assert.doesNotMatch(buildRequirementGuidance(req(other), ctx).purpose, pattern);
  }
});

test("unvalidated requirements get a contextual 'why', never generic filler", () => {
  for (const language of ["en", "es"] as const) {
    const g = buildRequirementGuidance(req("DOC_OWNER_AFFIDAVIT"), { ...ctx, language });
    assert.equal(g.status, "GUIDANCE_NEEDS_REVIEW");
    // Contextual: names the confirmed facts of this specific case...
    assert.match(g.whyThisApplies, /Bar/);
    assert.match(g.whyThisApplies, /Bayamón/);
    // ...but stays honest about what SmartPR has not validated.
    assert.match(g.whyThisApplies, language === "es" ? /aún no tiene validada/ : /hasn't validated/);
    assert.doesNotMatch(g.whyThisApplies, /Old generic text/);
    assert.deepEqual(
      g.triggeredBy,
      language === "es" ? ["Tipo de negocio: Bar", "Municipio: Bayamón"] : ["Business type: Bar", "Municipality: Bayamón"]
    );
  }
  // No case facts at all: the honest generic remains, never invented context.
  const bare = buildRequirementGuidance(req("DOC_OWNER_AFFIDAVIT"), { ...ctx, municipality: null, businessTypeName: null });
  assert.match(bare.whyThisApplies, /not yet been fully validated/);
  assert.doesNotMatch(bare.whyThisApplies, /Bar|Bayamón/);
  assert.deepEqual(bare.triggeredBy, []);
});

test("provisional caveat names the case instead of speaking generically", () => {
  // DOC_LUMA_INTERCONNECTION is solar-gated: provisional for the bar profile.
  const g = buildRequirementGuidance(req("DOC_LUMA_INTERCONNECTION"), { ...ctx, language: "es" });
  assert.equal(g.status, "GUIDANCE_NEEDS_REVIEW");
  assert.match(g.whyThisApplies, /Bar en Bayamón/);
});
