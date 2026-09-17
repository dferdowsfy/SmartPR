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

test("validated why leads with the user's specific situation, not a generic paragraph", () => {
  const g = buildRequirementGuidance(req("DOC_WORKERS_COMP"), context);
  assert.equal(g.status, "VALIDATED");
  assert.ok(g.whyThisApplies.startsWith("Your situation: Hiring employees. "),
    `unexpected lead: ${g.whyThisApplies.slice(0, 80)}`);
  assert.ok(g.summary.startsWith("Your situation: Hiring employees."),
    "the summary carries the same contextual lead");
  // The validated regulatory reason itself is untouched after the lead.
  assert.ok(g.whyThisApplies.endsWith(g.regulatoryReason));
  assert.ok(g.whyThisApplies.includes("Hiring workers creates employer responsibilities"));
});

test("contextual lead names only regulatorily-relevant trigger facts, in both languages", () => {
  // The patent's trigger facts (municipality, commercial activity) are the
  // regulatory basis — named explicitly, never via an unrelated descriptor.
  const en = buildRequirementGuidance(req("DOC_PATENTE_MUNICIPAL"), context);
  assert.equal(en.status, "VALIDATED");
  assert.ok(en.whyThisApplies.startsWith("Your situation: Municipality: Bayamón; Commercial activity: Bar. "),
    `unexpected lead: ${en.whyThisApplies.slice(0, 100)}`);
  const es = buildRequirementGuidance(req("DOC_PATENTE_MUNICIPAL"), { ...context, language: "es" });
  assert.ok(es.whyThisApplies.startsWith("Tu situación: "),
    `unexpected lead: ${es.whyThisApplies.slice(0, 80)}`);
  assert.ok(es.whyThisApplies.endsWith(es.regulatoryReason));
  const esWc = buildRequirementGuidance(req("DOC_WORKERS_COMP"), { ...context, language: "es" });
  assert.ok(esWc.whyThisApplies.startsWith("Tu situación: Contratación de empleados. "),
    `unexpected lead: ${esWc.whyThisApplies.slice(0, 90)}`);
});

test("contextual lead degrades gracefully with no case facts", () => {
  const bare = buildRequirementGuidance(req("DOC_WORKERS_COMP"), {
    ...context, municipality: undefined, businessTypeName: undefined,
    profile: {}, discoveryAnswers: { Q_EMPLOYEES_HIRED: true },
    engineInput: { municipalityName: "", businessTypeName: "", answers: { Q_EMPLOYEES_HIRED: true } },
  });
  assert.equal(bare.status, "VALIDATED");
  assert.ok(bare.whyThisApplies.startsWith("Your situation: Hiring employees. "),
    `unexpected lead: ${bare.whyThisApplies.slice(0, 80)}`);
});

test("OGPe construction permit guidance is construction-first, never solar-only", () => {
  // Regression (live QA 2026-09-16): the construction-permit card for a
  // Mayagüez car wash (new construction, no solar) showed solar-photovoltaic
  // and LUMA guidance text, because the concept was written for the solar
  // case only. The document is the general OGPe construction permit.
  for (const language of ["en", "es"] as const) {
    const g = buildRequirementGuidance(req("DOC_OGPE_CONSTRUCTION_PERMIT"), { ...context, language });
    assert.equal(g.status, "GUIDANCE_NEEDS_REVIEW", `construction permit (${language})`);
    assert.doesNotMatch(g.whatThisIs, /solar/i, `whatThisIs (${language})`);
    assert.doesNotMatch(g.whatYouNeedToDo, /LUMA/i, `whatYouNeedToDo (${language})`);
    assert.match(g.regulatoryReason, /New construction|construcción nueva/, `regulatoryReason (${language})`);
    // The validated solar exemption nuance is preserved, not deleted.
    assert.match(g.regulatoryReason, /1 MW/, `solar nuance kept (${language})`);
  }
});

test("legal-basis citations stay municipality-neutral (parking subject retired by validated review)", () => {
  // Stale-test repair (2026-09-17 QA): the original subject — RULE_0271 /
  // DOC_PARKING_COMPLIANCE — was deliberately deleted by the 2026-09-16
  // validated review (9b04a1a) as a reviewer-rejected universal, so the old
  // assertions referenced rules/documents that no longer exist (failing on
  // clean HEAD). The invariant the test guarded — a filing in municipality
  // X must never cite another municipality's ordinance as its legal basis —
  // is re-pinned as a KB-wide sweep so any new leakage fails loudly.
  const rules = (kb as any).rules as Array<{
    id: string; citation?: string; municipality_flag?: string | null;
    requires_document_id?: string;
  }>;
  const docs = (kb as any).documents as Array<{ id: string; citation?: string }>;
  const MUNI = /San Juan|Bayamón|Carolina|Guaynabo|Cataño|Trujillo Alto|Toa Baja|Toa Alta|Dorado|Ponce|Mayagüez|Caguas|Arecibo/i;
  // Known exception (REQUIRES_REGULATORY_REVIEW, 2026-09-17 QA): RULE_0031
  // fires for outdoor seating in ANY municipality but cites San Juan's
  // Código de Orden Público. Unverified rule — do not "fix" by inventing a
  // neutral citation; the applicable municipal ordinance needs research.
  const KNOWN_EXCEPTIONS = new Set(["RULE_0031", "DOC_OUTDOOR_SEATING_AUTH"]);
  const offenders: string[] = [];
  for (const r of rules) {
    if (r.citation && MUNI.test(r.citation) && !r.municipality_flag && !KNOWN_EXCEPTIONS.has(r.id)) {
      offenders.push(r.id);
    }
  }
  for (const d of docs) {
    if (d.citation && MUNI.test(d.citation) && !KNOWN_EXCEPTIONS.has(d.id)) {
      offenders.push(d.id);
    }
  }
  assert.deepEqual(offenders, [], `municipality-specific citations on unscoped rules/documents: ${offenders.join(", ")}`);
  // The retired universal stays retired: no live rule may target the
  // deleted parking-compliance document.
  assert.ok(
    !rules.some((r) => r.requires_document_id === "DOC_PARKING_COMPLIANCE"),
    "DOC_PARKING_COMPLIANCE stays deleted per validated review"
  );
});

test("fire safety guidance is industry-neutral, never food-service-only", () => {
  // Regression (live QA 2026-09-17): a Mayagüez plastics plant's fire
  // certification card said "Commercial premises with food preparation or
  // public occupancy require a fire-safety inspection..." — the concept was
  // written for the restaurant case only, though it fires for manufacturers,
  // warehouses, and other premises too. Same defect class as the solar-only
  // construction guidance (commit 10c5a75).
  for (const language of ["en", "es"] as const) {
    const g = buildRequirementGuidance(req("DOC_FIRE_CERT"), { ...context, language });
    assert.doesNotMatch(
      g.regulatoryReason,
      /with food preparation or public occupancy require|con preparación de alimentos u ocupación pública requieren/i,
      `old food-service-only phrasing is gone (${language})`
    );
    assert.match(g.regulatoryReason, /industrial/i, `regulatoryReason covers industrial premises (${language})`);
  }
});

test("legalBasisFor never renders internal filenames to users", () => {
  // Regression (live QA 2026-09-17): requirement cards cited
  // "Legal basis: Validated review 2026-09-16
  // (SmartPR_25_Goldens_Validated_Review.xlsx)" — an internal workbook
  // filename. The KB keeps the full citation for the audit trail; the
  // user-facing label strips the parenthesized internal filename.
  const basis = legalBasisFor("RULE_0653", "DOC_AMBULANT_BUSINESS_LICENSE", kb as any);
  assert.ok(basis, "rule citation resolves");
  assert.doesNotMatch(basis.citation, /\.xlsx/i, "no workbook filename in the user-facing citation");
  assert.doesNotMatch(basis.citation, /SmartPR_25_Goldens/i);
  assert.match(basis.citation, /Validated review 2026-09-16/);
});

test("legalBasisFor never claims validation for unvalidated concepts", () => {
  // Regression (live QA 2026-09-17, S12): the REQUIRED Domiciliary Use
  // card's body honestly said "SmartPR hasn't validated the exact regulatory
  // basis yet" while its footer read "Legal basis: Validated review
  // 2026-09-16". A review citation is provenance, not a legal basis — it
  // must not render as one when the concept is unvalidated.
  assert.equal(
    legalBasisFor("RULE_0652", "DOC_DOMICILIARY_USE_PERMIT", kb as any, "GUIDANCE_NEEDS_REVIEW"),
    null,
    "review citation suppressed for an unvalidated concept"
  );
  // The same citation still renders for validated concepts (provenance kept).
  const validated = legalBasisFor("RULE_0652", "DOC_DOMICILIARY_USE_PERMIT", kb as any, "VALIDATED");
  assert.ok(validated, "basis resolves for a validated concept");
  assert.match(validated.citation, /Validated review 2026-09-16/);
  // Genuine statutory citations still render even when the description text
  // is pending — the statute is real, only the writeup is not.
  const statute = legalBasisFor("RULE_0009", "DOC_HEALTH_PERMIT", kb as any, "GUIDANCE_NEEDS_REVIEW");
  assert.ok(statute, "statutory citation still renders for an unvalidated concept");
  assert.match(statute.citation, /Ley 81-1912/);
  // Callers that do not pass a status keep the old behavior.
  const legacy = legalBasisFor("RULE_0652", "DOC_DOMICILIARY_USE_PERMIT", kb as any);
  assert.ok(legacy, "omitted status keeps legacy behavior");
});
test("EIN guidance never frames employers-only or new-entity-only instructions as universal", () => {
  // 2026-09-17 09:00 QA cycle: the EIN card told a 0-employee nonprofit
  // (S11, Guaynabo) "Employers need a federal tax identifier for
  // employment-tax reporting", and told an 8-year existing restaurant
  // (S10, Carolina) to "Form a new legal entity before applying". Both
  // sentences are status-specific instructions presented as universal
  // guidance. The concept copy is now status-neutral: it explains what the
  // EIN is for without assuming employer status, and scopes entity
  // formation to new entities.
  const g = buildRequirementGuidance(req("DOC_EIN"), context);
  assert.ok(!/^Employers need/.test(g.regulatoryReason),
    `regulatoryReason must not assume employer status: ${g.regulatoryReason.slice(0, 80)}`);
  assert.ok(!/Form a new legal entity before applying/.test(g.nextAction),
    `nextAction must not instruct existing businesses to form: ${g.nextAction.slice(0, 80)}`);
  assert.match(g.nextAction, /already assigned/);
  const es = buildRequirementGuidance(req("DOC_EIN"), { ...context, language: "es" });
  assert.ok(!/^Los patronos necesitan/.test(es.regulatoryReason),
    "the Puerto Rican Spanish copy carries the same neutral framing");
});

test("commercial vehicle registration guidance is DTOP-validated, never a placeholder", () => {
  // REG-GUIDE-VEHICLE-001 (live QA 2026-09-17 03:00 cycle): the Commercial
  // Vehicle Registration card for a Cataño food truck rendered the
  // unvalidated-description placeholder. The document cites Law 22-2000
  // Art. 23.01 at statute confidence, so a validated concept now exists —
  // grounded in that statute, with no invented procedure.
  for (const language of ["en", "es"] as const) {
    const g = buildRequirementGuidance(req("DOC_VEHICLE_REGISTRATION"), {
      ...context, language,
      discoveryAnswers: { commercial_vehicles: true },
      engineInput: { municipalityName: "Cataño", businessTypeName: "Food Truck", answers: { Q_COMMERCIAL_VEHICLES: true } },
    });
    assert.equal(g.status, "VALIDATED", `vehicle registration (${language})`);
    assert.doesNotMatch(g.whyThisApplies, /hasn't validated the exact regulatory basis yet/i, `no placeholder whyThisApplies (${language})`);
    assert.doesNotMatch(g.whatThisIs, /still pending|unavailable/i, `no placeholder whatThisIs (${language})`);
    assert.match(g.regulatoryReason, /Law 22-2000|Ley 22-2000/, `statute basis present (${language})`);
    assert.match(g.regulatoryReason, /marbete/i, `marbete mentioned (${language})`);
  }
});
