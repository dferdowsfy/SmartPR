// Acceptance coverage for the Critical Path disclosure after the guidance merge.
// Run: node --experimental-strip-types --test src/app/requirementGuidance.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { ACTIVE_JURISDICTION } from "./jurisdictions/index.ts";
import { buildRequirementGuidance, legalBasisFor, type GuidanceContext, type GuidanceRequirement } from "./requirementGuidance.ts";
import { validateGuidanceConcept } from "./guidance/model.ts";

const kb = ACTIVE_JURISDICTION.kb;
const context: GuidanceContext = {
  language: "en", municipality: "Bayamón", businessTypeName: "Bar",
  discoveryAnswers: { alcohol_sold: true, employees_hired: true, existing_lease: true },
  profile: { location_type: "Restaurant Location", number_of_employees: 10 },
  entityType: "limited_liability_company", kb,
  engineInput: { municipalityName: "Bayamón", businessTypeName: "Bar",
    answers: { Q_ALCOHOL_SOLD: true, Q_EMPLOYEES_HIRED: true, Q_EXISTING_LEASE: true, Q_PHYSICAL_LOCATION: true } },
};
const ids = ["DOC_ALCOHOL_LICENSE", "DOC_EIN", "DOC_PATENTE_MUNICIPAL",
  "DOC_MERCHANT_REGISTRATION", "DOC_PERMISO_UNICO", "DOC_LEASE_AGREEMENT",
  "DOC_ARTICLES_ORGANIZATION", "DOC_WORKERS_COMP"];
function req(id: string): GuidanceRequirement {
  const d = kb.documents.find(d => d.id === id)!;
  return { document_id: id, code: id.toLowerCase(), name: d.name, agency: d.agency,
    reason: "Legacy reason must not become the regulatory explanation", applicability: "required",
    triggerFacts: id === "DOC_ARTICLES_ORGANIZATION" ? ["entityType:limited_liability_company"] : [] };
}

test("each reviewed concept passes validation and produces guidance for matching confirmed facts", () => {
  for (const id of ids) {
    assert.deepEqual(validateGuidanceConcept(kb.documents.find(d => d.id === id)?.requirement_guidance, id), []);
    assert.equal(buildRequirementGuidance(req(id), context).status, "VALIDATED", id);
  }
});
test("unreviewed documents are flagged, even if a previous builder asserted an explanation", () => {
  // The old fixture incorrectly declared these valid for a bar without relevant facts or source URLs.
  for (const id of ["DOC_TOURISM_REGISTRATION", "DOC_ROOM_TAX_RETURN", "DOC_HOA_AUTHORIZATION", "DOC_CERT_INCORPORATION"]) {
    const g = buildRequirementGuidance(req(id), context);
    assert.equal(g.status, "GUIDANCE_NEEDS_REVIEW", id);
    assert.match(g.whyThisApplies, /hasn't validated the exact regulatory basis yet/);
  }
});
test("DOC_CFPM is a reviewed concept: without a confirmed food fact it teaches the document instead of the generic fallback", () => {
  const g = buildRequirementGuidance(req("DOC_CFPM"), context);
  assert.equal(g.status, "GUIDANCE_NEEDS_REVIEW");
  assert.match(g.whyThisApplies, /not confirmed yet/);
  assert.ok(g.purpose.length > 0);
});
test("unrelated Critical Path requirements have distinct rationale and purpose in both languages", () => {
  for (const language of ["en", "es"] as const) {
    const guidance = ids.map(id => buildRequirementGuidance(req(id), { ...context, language }));
    assert.equal(new Set(guidance.map(g => g.whyThisApplies)).size, ids.length);
    assert.equal(new Set(guidance.map(g => g.whatThisIs)).size, ids.length);
  }
});
test("alcohol triggers expose only confirmed sales, not concatenated municipality context", () => {
  const g = buildRequirementGuidance(req("DOC_ALCOHOL_LICENSE"), context);
  assert.deepEqual(g.triggerFacts.map(f => f.key), ["Q_ALCOHOL_SOLD"]);
  assert.ok(g.triggeredBy.every(tag => !/[a-z][A-Z]/.test(tag)));
});
test("municipality is retained for local patent evidence, not inserted into federal or territory-wide guidance", () => {
  for (const id of ["DOC_EIN", "DOC_MERCHANT_REGISTRATION", "DOC_PERMISO_UNICO"]) {
    assert.ok(buildRequirementGuidance(req(id), context).triggerFacts.every(f => f.key !== "municipality"));
  }
  assert.ok(buildRequirementGuidance(req("DOC_PATENTE_MUNICIPAL"), context).triggerFacts.some(f => f.key === "municipality" && f.value === "Bayamón"));
});
test("a matched rule cannot turn an unconfirmed inference into something the user said", () => {
  const g = buildRequirementGuidance(req("DOC_ALCOHOL_LICENSE"), { ...context, discoveryAnswers: {} });
  assert.equal(g.status, "GUIDANCE_NEEDS_REVIEW");
});

test("legalBasisFor resolves the triggering rule's graph citation", () => {
  const rule = (kb.rules as any[]).find((r) => typeof r.citation === "string" && r.citation.length > 10);
  assert.ok(rule, "seed KB has at least one cited rule");
  const basis = legalBasisFor(rule.id, null, kb as any);
  assert.ok(basis, "a cited rule yields a legal basis");
  assert.equal(basis.citation, rule.citation);
  assert.equal(basis.ruleId, rule.id);
});

test("legalBasisFor falls back to the required document's citation", () => {
  const rule = (kb.rules as any[]).find((r) => r.citation_source === "document" && r.requires_document_id);
  assert.ok(rule, "seed KB has a rule with an inherited document citation");
  const basis = legalBasisFor("RULE_DOES_NOT_EXIST", rule.requires_document_id, kb as any);
  assert.ok(basis, "document citation is used when the rule is unknown");
  assert.equal(basis.inheritedFromDocument, rule.requires_document_id);
});

test("legalBasisFor returns null when the graph has no citation", () => {
  assert.equal(legalBasisFor("RULE_DOES_NOT_EXIST", "DOC_DOES_NOT_EXIST", kb as any), null);
});
