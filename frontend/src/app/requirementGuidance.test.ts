// Acceptance coverage for the Critical Path disclosure after the guidance merge.
// Run: node --experimental-strip-types --test src/app/requirementGuidance.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { ACTIVE_JURISDICTION } from "./jurisdictions/index.ts";
import { buildRequirementGuidance, legalBasisFor, POTENTIAL_ADVISORY_REASON_ES, type GuidanceContext, type GuidanceRequirement } from "./requirementGuidance.ts";
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
  // DOC_TOURISM_REGISTRATION and DOC_ROOM_TAX_RETURN graduated to validated
  // concepts in the 2026-09-18 15:00 cycle (REG-GUIDE-TOURISM-001); they no
  // longer render the unvalidated-description placeholder — a non-lodging BT
  // like this bar instead gets honest provisional framing (GUIDANCE_NEEDS_
  // REVIEW with MATCH_TRACE_MISSING) in front of real regulatory content.
  // (DOC_CERT_INCORPORATION graduated to validated guidance in the
  // 2026-09-17 18:00 cycle — see REG-GUIDE-FORMATION-001 below.)
  for (const id of ["DOC_HOA_AUTHORIZATION"]) {
    const g = buildRequirementGuidance(req(id), context);
    assert.equal(g.status, "GUIDANCE_NEEDS_REVIEW", id);
    assert.match(g.whyThisApplies, /hasn't validated the exact regulatory basis yet/);
  }
  // Graduated documents never regress to the unvalidated placeholder: the
  // tourism concept renders real regulatory content even for this bar.
  const t = buildRequirementGuidance(req("DOC_TOURISM_REGISTRATION"), context);
  assert.equal(t.status, "GUIDANCE_NEEDS_REVIEW", "non-lodging BT: provisional framing");
  assert.doesNotMatch(t.whyThisApplies, /hasn't validated the exact regulatory basis yet/i);
  assert.match(t.whyThisApplies, /Compañía de Turismo/i);
});
test("REG-GUIDE-WITHHOLDING-001 / REG-GUIDE-FORMATION-001: validated guidance for withholding + formation certificates, never placeholders", () => {
  // Live QA 2026-09-17 18:00 cycle: a Bayamón general contractor filing
  // rendered the unvalidated-description placeholder on the REQUIRED
  // Hacienda/SURI Employer Withholding Registration card, and on both
  // formation-certificate cards while the entity type was still unknown.
  // All three now carry validated, source-grounded concepts.
  for (const language of ["en", "es"] as const) {
    const ctx: GuidanceContext = {
      ...context, language,
      businessTypeName: "General Contractor",
      discoveryAnswers: { employees_hired: true, existing_lease: true },
      entityType: undefined,
      engineInput: { municipalityName: "Bayamón", businessTypeName: "General Contractor",
        answers: { Q_EMPLOYEES_HIRED: true, Q_EXISTING_LEASE: true, Q_PHYSICAL_LOCATION: true } },
    };
    const w = buildRequirementGuidance(req("DOC_HACIENDA_EMPLOYER_WITHHOLDING"), ctx);
    assert.equal(w.status, "VALIDATED", `withholding (${language})`);
    assert.doesNotMatch(w.whyThisApplies, /hasn't validated the exact regulatory basis yet/i, `no placeholder why (${language})`);
    assert.doesNotMatch(w.whatThisIs, /still pending|unavailable/i, `no placeholder what (${language})`);
    assert.match(w.regulatoryReason, /SURI/i, `SURI named (${language})`);
    for (const id of ["DOC_CERT_INCORPORATION", "DOC_CERT_ORGANIZATION"]) {
      const g = buildRequirementGuidance(req(id), ctx);
      assert.equal(g.status, "VALIDATED", `${id} (${language})`);
      assert.doesNotMatch(g.whyThisApplies, /hasn't validated the exact regulatory basis yet/i, `no placeholder why (${id}, ${language})`);
      assert.doesNotMatch(g.whatThisIs, /still pending|unavailable/i, `no placeholder what (${id}, ${language})`);
      assert.match(g.whatThisIs, /Departamento de Estado|Department of State/i, `Dept of State named (${id}, ${language})`);
    }
  }
});
test("DOC_CFPM is a reviewed concept: without a confirmed food fact it teaches the document instead of the generic fallback", () => {
  // DOC_CFPM graduated to a validated concept (d4940f4 [business] fallback,
  // 2026-09-18 03:00 cycle): for a bar, the heuristic BT_BAR → CFPM firing
  // (RULE_0064) now validates honestly via the business fallback — the
  // concept teaches the document with real regulatory content, never the
  // unvalidated placeholder.
  const g = buildRequirementGuidance(req("DOC_CFPM"), context);
  assert.equal(g.status, "VALIDATED");
  assert.doesNotMatch(g.whyThisApplies, /hasn't validated the exact regulatory basis yet/i);
  assert.ok(g.purpose.length > 0);
  assert.match(g.regulatoryReason, /food protection|manejador/i);
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

test("sanitary permit guidance is industry-neutral, never food-handling-only", () => {
  // REG-GUIDE-HEALTH-001 (live QA 2026-09-17 21:00, S23 Bayamón barbershop):
  // the health card for a barbershop said "submit the permit application
  // for the food-handling activity" and "documents that the premises passed
  // inspection for food-handling" — the concept was written for the
  // restaurant case only, though DOC_HEALTH_PERMIT fires for barbershops,
  // salons, spas, tattoo shops, lodging and other public-facing premises
  // too (RULE_0141/0144/0147/0155–0162/0248/0692). Same defect class as the
  // solar-only construction guidance (10c5a75) and the food-only fire
  // certification (7761507). The concept lead now covers establishments
  // that handle food OR serve the public, with food as one example.
  for (const language of ["en", "es"] as const) {
    const g = buildRequirementGuidance(req("DOC_HEALTH_PERMIT"), { ...context, language });
    assert.doesNotMatch(
      g.regulatoryReason,
      /permit application for the food-handling activity|solicitud del permiso para la actividad de manejo de alimentos/i,
      `old food-handling-only next-action phrasing is gone (${language})`
    );
    assert.doesNotMatch(
      g.regulatoryReason,
      /passed inspection for food-handling|aprobó la inspección de manejo de alimentos/i,
      `old food-handling-only document-purpose phrasing is gone (${language})`
    );
    assert.match(g.regulatoryReason, /serve the public|atienden al p[uú]blico/i, `covers public-facing premises (${language})`);
    assert.match(g.regulatoryReason, /barbershop|barber[ií]a/i, `names personal-care premises as an example (${language})`);
  }
});
test("REG-GUIDE-CONSTRUCTION-001: construction-permit guidance validates for project_fact rule firings, not only solar", () => {
  // Live QA 2026-09-18 03:00 cycle (S30, Cataño warehouse renovation):
  // the REQUIRED OGPe Construction Permit card hedged "whether this
  // requirement applies to your specific case is not confirmed yet"
  // because the concept conditions only modeled the solar path while
  // RULE_0644 fires on project_type=renovation. The project fact now
  // explains the match — same defect class as the solar-only text fix
  // (10c5a75), this time in the conditions.
  for (const language of ["en", "es"] as const) {
    const ctx: GuidanceContext = {
      ...context, language,
      municipality: "Cataño", businessTypeName: "Warehouse",
      discoveryAnswers: {},
      engineInput: {
        municipalityName: "Cataño", businessTypeName: "Warehouse",
        answers: {},
        projectFacts: { project_type: "renovation" },
      },
    };
    const g = buildRequirementGuidance(req("DOC_OGPE_CONSTRUCTION_PERMIT"), ctx);
    assert.equal(g.status, "VALIDATED", `construction permit (${language})`);
    assert.doesNotMatch(g.whyThisApplies, /not confirmed yet/i, `no hedge (${language})`);
    assert.ok(
      g.triggerFacts.some(f => f.key === "project_type" && f.value === "renovation"),
      `project_type trigger explained (${language}): ${JSON.stringify(g.triggerFacts.map(f => f.key))}`
    );
  }
});
test("REG-GUIDE-VEHICLE-002: vehicle-registration guidance validates on the business-type trigger", () => {
  // Live QA 2026-09-18 03:00 cycle (S29, Bayamón food truck): the
  // VERIFY EXISTING Commercial Vehicle Registration card hedged
  // "not confirmed yet" because RULE_0690 fires on BT_FOOD_TRUCK with no
  // Q_COMMERCIAL_VEHICLES answer. The business type is the honest trigger
  // for the business_type rules — it now explains the match alongside the
  // Q&A path.
  for (const language of ["en", "es"] as const) {
    const ctx: GuidanceContext = {
      ...context, language,
      businessTypeName: "Food Truck",
      discoveryAnswers: {},
      engineInput: {
        municipalityName: "Bayamón", businessTypeName: "Food Truck",
        answers: { Q_PHYSICAL_LOCATION: true },
      },
    };
    const r = { ...req("DOC_VEHICLE_REGISTRATION"), applicability: "verify_existing" };
    const g = buildRequirementGuidance(r, ctx);
    assert.equal(g.status, "VALIDATED", `vehicle registration (${language})`);
    assert.doesNotMatch(g.whyThisApplies, /not confirmed yet/i, `no hedge (${language})`);
    assert.ok(
      g.triggerFacts.some(f => f.key === "businessType" && f.value === "Food Truck"),
      `businessType trigger explained (${language}): ${JSON.stringify(g.triggerFacts.map(f => f.key))}`
    );
  }
});

test("REG-GUIDE-TRANSPORT-001: transport-permit guidance validates on the trucking-company trigger, never a placeholder", () => {
  // Live QA 2026-09-18 12:00 cycle (S37, Bayamón trucking company): the
  // Transportation / PUC Permit card rendered the unvalidated-description
  // placeholder. The document cites Law 109-1962 / NTSP Regulation 9156
  // §10.02 at statute confidence, so the concept is now validated and
  // source-grounded. Conditions cover every firing path: the business-type
  // rules, the commercial-vehicles question, and the hazmat-transport
  // question (new GuidanceFactKeys), plus the generic businessType fallback.
  for (const language of ["en", "es"] as const) {
    const ctx: GuidanceContext = {
      ...context, language,
      businessTypeName: "Trucking Company",
      discoveryAnswers: { commercial_vehicles: true },
      engineInput: {
        municipalityName: "Bayamón", businessTypeName: "Trucking Company",
        answers: { Q_PHYSICAL_LOCATION: true, Q_COMMERCIAL_VEHICLES: true },
      },
    };
    const r = { ...req("DOC_TRANSPORT_PERMIT"), applicability: "verify_existing" };
    const g = buildRequirementGuidance(r, ctx);
    assert.equal(g.status, "VALIDATED", `transport permit (${language})`);
    assert.doesNotMatch(g.whatThisIs, /validated description.*pending/i, `no placeholder (${language})`);
    assert.doesNotMatch(g.whyThisApplies, /not confirmed yet/i, `no hedge (${language})`);
    assert.ok(
      g.triggerFacts.some(f => ["businessType", "Q_COMMERCIAL_VEHICLES", "Q_HAZMAT_TRANSPORT"].includes(f.key)),
      `an actual trigger explained (${language}): ${JSON.stringify(g.triggerFacts.map(f => f.key))}`
    );
    assert.match(g.whyThisApplies, /NTSP/i, `cites the NTSP franchise basis (${language})`);
    // Live QA 2026-09-19 03:00 (S53, Ponce trucking): on a VERIFY EXISTING
    // card the next action said "Apply for …" to a 12-year existing
    // operator. The concept is shared across business statuses, so the
    // next action must read correctly for existing holders too.
    assert.doesNotMatch(g.whatYouNeedToDo, /^(Apply|Solicita) /i, `no bare apply-first directive on verify_existing (${language})`);
    assert.match(g.whatYouNeedToDo, /or confirm the existing franchise|o confirma que la franquicia vigente/i, `status-neutral next action covers existing holders (${language})`);
  }
});

test("REG-GUIDE-HEALTH-STATUSNEUTRAL: health-permit next action reads correctly on a VERIFY EXISTING card", () => {
  // Live QA 2026-09-19 03:00 (S54, Trujillo Alto gas station): "submit the
  // permit application" told a 15-year existing operator to file a new
  // application on a VERIFY EXISTING card. Same status-blind-copy class as
  // the EIN fix (2026-09-17) and the transport fix (this cycle).
  for (const language of ["en", "es"] as const) {
    const ctx: GuidanceContext = {
      ...context, language,
      businessTypeName: "Convenience Store",
      discoveryAnswers: { food_sold: true },
      engineInput: {
        municipalityName: "Trujillo Alto", businessTypeName: "Convenience Store",
        answers: { Q_FOOD_SOLD: true },
      },
    };
    const r = { ...req("DOC_HEALTH_PERMIT"), applicability: "verify_existing" };
    const g = buildRequirementGuidance(r, ctx);
    assert.equal(g.status, "VALIDATED", `health permit (${language})`);
    assert.doesNotMatch(g.whatYouNeedToDo, /^(submit the permit application|presenta la solicitud) /i, `no bare apply-first directive on verify_existing (${language})`);
    assert.match(g.whatYouNeedToDo, /or confirm the existing sanitary permit|o confirma que el permiso sanitario vigente/i, `status-neutral next action covers existing holders (${language})`);
  }
});

test("REG-GUIDE-AGRI-001: bona-fide-farmer guidance validates on the coffee-plantation trigger, never a placeholder", () => {
  // Live QA 2026-09-18 12:00 cycle (S38, Arecibo coffee farm): the Bona Fide
  // Farmer Registration card rendered the unvalidated-description
  // placeholder. The document cites Ley 60-2019 (Código de Incentivos) at
  // statute confidence, so the concept is now validated and source-grounded.
  // Conditions cover every firing path: the farm business-type rules
  // (RULE_0218–0223) and the agriculture-production question (RULE_0041),
  // plus the generic businessType fallback.
  for (const language of ["en", "es"] as const) {
    const ctx: GuidanceContext = {
      ...context, language,
      businessTypeName: "Coffee Plantation",
      discoveryAnswers: {},
      engineInput: {
        municipalityName: "Arecibo", businessTypeName: "Coffee Plantation",
        answers: { Q_PHYSICAL_LOCATION: true },
      },
    };
    const r = { ...req("DOC_AGRICULTURE_REGISTRATION"), applicability: "verify_existing" };
    const g = buildRequirementGuidance(r, ctx);
    assert.equal(g.status, "VALIDATED", `bona fide registration (${language})`);
    assert.doesNotMatch(g.whatThisIs, /validated description.*pending/i, `no placeholder (${language})`);
    assert.doesNotMatch(g.whyThisApplies, /not confirmed yet/i, `no hedge (${language})`);
    assert.ok(
      g.triggerFacts.some(f => f.key === "businessType"),
      `businessType trigger explained (${language}): ${JSON.stringify(g.triggerFacts.map(f => f.key))}`
    );
    assert.match(g.whyThisApplies, /bona fide/i, `names the bona fide certification (${language})`);
  }
});

test("REG-GUIDE-ADVISORY-001: user-confirmed municipality advisories never render the unvalidated-document placeholder", () => {
  // Live QA 2026-09-18 12:00 cycle (S37, Bayamón trucking company): the
  // "Additional Municipal Review" card (a user-confirmed metro-flag
  // advisory, code potential_metro — not a KB document) rendered "A
  // validated description of this document is still pending." Nothing is
  // pending validation for advisories: the jurisdiction pack's authored
  // advisory text is the honest explanation.
  //
  // Follow-up regression (same cycle): the advisory() path rendered the
  // pack's English-authored reason verbatim under language === "es", leaking
  // English into Spanish disclosures. Spanish output must be Puerto Rican
  // Spanish and must reject the English advisory sentence.
  for (const language of ["en", "es"] as const) {
    const ctx: GuidanceContext = { ...context, language };
    const req: GuidanceRequirement = {
      document_id: undefined as unknown as string, code: "potential_metro",
      name: "Additional Municipal Review", agency: "Municipal Permits Office",
      reason: "This municipality is a major metropolitan area with additional municipal ordinances.",
      applicability: "conditional", triggerFacts: [],
    };
    const g = buildRequirementGuidance(req, ctx);
    assert.equal(g.status, "VALIDATED", `advisory (${language})`);
    assert.doesNotMatch(g.whatThisIs, /validated description.*pending/i, `no placeholder (${language})`);
    assert.doesNotMatch(g.whyThisApplies, /hasn't validated the exact regulatory basis/i, `no unvalidated framing (${language})`);
    if (language === "es") {
      assert.match(g.whatThisIs, /ordenanzas municipales/i, `PR-Spanish advisory text shown (${language})`);
      assert.doesNotMatch(g.whatThisIs, /additional municipal ordinances/i, `no English advisory sentence (${language})`);
      assert.doesNotMatch(g.whyThisApplies, /additional municipal ordinances/i, `no English in whyThisApplies (${language})`);
      assert.doesNotMatch(g.summary, /additional municipal ordinances/i, `no English in summary (${language})`);
    } else {
      assert.match(g.whatThisIs, /additional municipal ordinances/i, `advisory text shown (${language})`);
    }
    assert.ok(g.whatYouNeedToDo.length > 0 && g.whatHappensNext.length > 0, `all disclosure fields populated (${language})`);
  }
});

test("REG-GUIDE-ADVISORY-002: every pack municipality-flag advisory has a PR-Spanish rendering", () => {
  // The advisory() path keys Spanish output by potential_* code; a flag
  // added to the pack without a POTENTIAL_ADVISORY_REASON_ES entry would
  // leak English into Spanish filings. Pin the pack's flag order against
  // the map so the two cannot drift apart silently.
  const flags: string[] = (ACTIVE_JURISDICTION as unknown as {
    flagAdvisories: { order: string[] };
  }).flagAdvisories.order;
  assert.ok(flags.length > 0, "pack defines municipality flags");
  for (const flag of flags) {
    const code = `potential_${flag}`;
    assert.ok(
      POTENTIAL_ADVISORY_REASON_ES[code]?.length > 40,
      `PR-Spanish advisory rendering exists for ${code}`
    );
    assert.doesNotMatch(
      POTENTIAL_ADVISORY_REASON_ES[code],
      /validated description.*pending/i,
      `no placeholder text in ${code} rendering`
    );
  }
});

test("REG-GUIDE-BTID-001: per-BT `equals: \"BT_*\"` guidance conditions match fired BT rules", () => {
  // 2026-09-20 QA (S84 cycle): 22 pack conditions pair businessType with an
  // `equals: "BT_*"` id, but factValue("businessType") returns the display
  // name — so they could never match. A validated SAM.gov concept fired by
  // RULE_0638 (BT_IT_GOVERNMENT_CONTRACTOR, no question) hedged "whether
  // this requirement applies ... is not confirmed yet" whenever
  // Q_FEDERAL_CONTRACTS_GRANTS was unanswered — the d4940f4 mixed-signal
  // class. The matcher now resolves BT-id conditions against the fired
  // rules' business_type_id (presentation-only; firing/gating untouched).
  const samDoc = kb.documents.find(d => d.id === "DOC_SAM_REGISTRATION")!;
  for (const language of ["en", "es"] as const) {
    const ctx: GuidanceContext = {
      language, municipality: "San Juan", businessTypeName: "IT Government Contractor",
      discoveryAnswers: {}, profile: {}, entityType: "limited_liability_company", kb,
      engineInput: { municipalityName: "San Juan", businessTypeName: "IT Government Contractor", answers: {} },
    };
    const g = buildRequirementGuidance(
      { document_id: "DOC_SAM_REGISTRATION", code: "doc_sam_registration", name: samDoc.name, agency: samDoc.agency, reason: "", applicability: "required" },
      ctx
    );
    assert.equal(g.status, "VALIDATED", `SAM.gov validates on the BT rule alone (${language})`);
    assert.doesNotMatch(g.whyThisApplies ?? "", /not confirmed yet|no se ha confirmado/i, `no hedge on validated concept (${language})`);
    assert.deepEqual(g.triggerFacts?.map(t => t.label), language === "es" ? ["Contratista del gobierno: tecnología"] : ["Government contractor: IT"], `per-BT trigger label (${language})`);
  }
  // Negative control: a business type with no fired BT rule must NOT match
  // a BT-id condition — the hedge stays honest there.
  const ctxBar: GuidanceContext = {
    language: "en", municipality: "San Juan", businessTypeName: "Bar",
    discoveryAnswers: {}, profile: {}, entityType: "limited_liability_company", kb,
    engineInput: { municipalityName: "San Juan", businessTypeName: "Bar", answers: {} },
  };
  const gBar = buildRequirementGuidance(
    { document_id: "DOC_SAM_REGISTRATION", code: "doc_sam_registration", name: samDoc.name, agency: samDoc.agency, reason: "", applicability: "required" },
    ctxBar
  );
  assert.equal(gBar.status, "GUIDANCE_NEEDS_REVIEW", "no fired BT rule: hedge stays");
});
