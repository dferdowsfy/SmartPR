import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRequirementGuidance, type GuidanceContext, type GuidanceRequirement } from "../requirementGuidance";
import { KB, buildEngineInput, applyKbSnapshot } from "../kb";
import { runRulesEngine } from "../rulesEngine";
import { PR_REQUIREMENT_GUIDANCE, PR_GUIDANCE_SOURCES } from "./pr";
import { ISSUED_DOCUMENT_GUIDANCE, ISSUED_DOCUMENT_GUIDANCE_ES } from "../sampleApplicationForms";
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

// Food/business-type concepts: the bar profile fires verified business-type
// rules for the health permit (RULE_0062), fire certificate (RULE_0063) and
// CFPM (RULE_0064), so the businessType fallback explains those matches
// honestly instead of hedging (2026-09-18 QA, d4940f4 class). They are no
// longer gated sets — see the thirty test below, which expects them
// VALIDATED for the bar.
const SOLAR_GATED = new Set(["DOC_LUMA_INTERCONNECTION", "DOC_NET_METERING_AGREEMENT", "DOC_OGPE_CONSTRUCTION_PERMIT", "DOC_OPPE_INSTALLER_REG"]);
// Federal-contractor-gated: SAM.gov registration applies only to businesses
// pursuing federal contracts, so it stays provisional for the bar profile.
const CONTRACTOR_GATED = new Set(["DOC_SAM_REGISTRATION", "DOC_CONTRACTOR_LICENSE"]);
// NMI-gated: noise variance applies only to live-entertainment venues with
// amplified sound, so it stays provisional for the bar profile.
const NMI_GATED = new Set(["DOC_NOISE_VARIANCE"]);
// Vehicle-gated: commercial-vehicle registration applies only when the
// profile uses commercial vehicles; the bar profile answers no vehicle
// question, so the validated concept stays provisional for it (correct —
// MATCH_TRACE_MISSING, not a placeholder). Added with the DTOP-validated
// vehicle concept (REG-GUIDE-VEHICLE-001, 2026-09-17).
const VEHICLE_GATED = new Set(["DOC_VEHICLE_REGISTRATION"]);
// Transport-gated / agriculture-gated: the NTSP franchise and the bona fide
// farmer registration apply only to transport businesses / farms; the bar
// profile matches none of their firing rules, so the validated concepts stay
// provisional for it (correct — MATCH_TRACE_MISSING, not a placeholder).
// Added with the NTSP- and Agricultura-validated concepts
// (REG-GUIDE-TRANSPORT-001, REG-GUIDE-AGRI-001, 2026-09-18).
const TRANSPORT_AGRI_GATED = new Set(["DOC_TRANSPORT_PERMIT", "DOC_AGRICULTURE_REGISTRATION"]);

// Tourism-gated: the PRTC innkeeper registration and the monthly room-tax
// return apply only to lodging businesses; the bar profile matches none of
// their firing rules, so the validated concepts stay provisional for it
// (correct — MATCH_TRACE_MISSING, not a placeholder). Added with the
// tourism-validated concepts (REG-GUIDE-TOURISM-001, 2026-09-18).
const TOURISM_GATED = new Set(["DOC_TOURISM_REGISTRATION", "DOC_ROOM_TAX_RETURN"]);
// Sign/annual-report-gated: the sign/rótulo authorization applies only when
// signage is stated (RULE_0030) or the municipality carries the tourism
// flag (RULE_0535–0543) — Bayamón has neither; the annual report / LLC fee
// fires only for existing registered entities (RULE_0636
// requires_existing_business) — the bar profile has no business status.
// Both validated concepts stay provisional for it (correct —
// MATCH_TRACE_MISSING, not a placeholder). Added with the sign and
// annual-report concepts (REG-GUIDE-SIGN-001 / REG-GUIDE-ANNUAL-001,
// 2026-09-20).
const SIGN_ANNUAL_GATED = new Set(["DOC_SIGN_PERMIT", "DOC_ANNUAL_REPORT"]);

// Entity-gated: the Certificate of Incorporation concept applies only when a
// corporation is (or may be) the chosen legal form; the bar profile is a
// known LLC, so RULE_0001 excludes it and the validated concept stays
// provisional for it (correct — MATCH_TRACE_MISSING, not a placeholder).
// Added with the validated formation-certificate concepts
// (REG-GUIDE-FORMATION-001, 2026-09-17).
const ENTITY_GATED = new Set(["DOC_CERT_INCORPORATION"]);

// Outdoor-seating-gated: the Outdoor Seating Authorization applies only when
// outdoor seating is stated (RULE_0031) — the Bayamón bar profile answers no
// seating question, so the validated concept stays provisional for it
// (correct — MATCH_TRACE_MISSING, not a placeholder). Added with the
// validated outdoor-seating concept (REG-GUIDE-OUTDOOR-001, 2026-09-20).
const OUTDOOR_GATED = new Set(["DOC_OUTDOOR_SEATING_AUTH"]);

// Beverage-manufacturing-gated: the FDA food-facility registration and the
// three environmental cards (wastewater discharge, NPDES industrial
// stormwater, air permit) apply only to beverage-manufacturing (and a few
// other industrial) business types — the Bayamón bar profile matches none of
// their firing rules, so the validated concepts stay provisional for it
// (correct — MATCH_TRACE_MISSING, not a placeholder). Added with the
// FDA/environmental concepts (REG-GUIDE-FDA-001 / REG-GUIDE-WASTEWATER-001 /
// REG-GUIDE-STORMWATER-001 / REG-GUIDE-AIR-001, 2026-09-21).
const BEVERAGE_MFG_GATED = new Set(["DOC_FDA_FOOD_FACILITY_REGISTRATION", "DOC_WASTEWATER_DISCHARGE_AUTHORIZATION", "DOC_NPDES_INDUSTRIAL_STORMWATER", "DOC_AIR_PERMIT"]);

// Childcare-gated: the childcare license applies only to childcare/education
// businesses — the Bayamón bar profile matches none of its firing rules, so
// the validated concept stays provisional for it (correct —
// MATCH_TRACE_MISSING, not a placeholder). Added with the validated
// childcare-license concept (REG-GUIDE-CHILDCARE-001, 2026-09-22).
const CHILDCARE_GATED = new Set(["DOC_CHILDCARE_LICENSE"]);

// HOA-gated: the condo/HOA short-term-rental authorization applies only to
// condo/HOA lodging properties — the Bayamón bar profile matches none of
// its firing rules, so the validated concept stays provisional for it
// (correct — MATCH_TRACE_MISSING, not a placeholder). Added with the
// validated HOA concept (REG-GUIDE-HOA-001, 2026-09-22).
const HOA_GATED = new Set(["DOC_HOA_AUTHORIZATION"]);

// Entertainment-gated: the entertainment permit applies only to venues
// with live entertainment (RULE_0032) or entertainment business types
// (RULE_0245/0246/0247); the bar profile answers no entertainment
// question, so the validated concept stays provisional for it (correct —
// MATCH_TRACE_MISSING, not a placeholder). Added with the
// Ley 161-2009/182-1996-validated entertainment concept
// (REG-GUIDE-ENTERTAINMENT-001, 2026-09-22).
const ENTERTAINMENT_GATED = new Set(["DOC_ENTERTAINMENT_PERMIT"]);

// Dealer-gated: the DACO dealer license applies only to car dealerships
// (RULE_0698); the bar profile answers no dealership question, so the
// validated concept stays provisional for it (correct — MATCH_TRACE_MISSING,
// not a placeholder). Added with the daco.pr.gov-validated dealer-license
// concept (REG-DEALER-DACO-001, 2026-09-25).
const DEALER_GATED = new Set(["DOC_DACO_DEALER_LICENSE"]);

test("same Bayamón bar: all forty-three source-backed explanations are distinct and actionable in EN/ES", () => {
  for (const language of ["en", "es"] as const) {
    const output = Object.keys(PR_REQUIREMENT_GUIDANCE).map(id => buildRequirementGuidance(req(id), { ...ctx, language }));
    for (const g of output) {
      if (SOLAR_GATED.has(g.requirementId) || CONTRACTOR_GATED.has(g.requirementId) || NMI_GATED.has(g.requirementId) || VEHICLE_GATED.has(g.requirementId) || TRANSPORT_AGRI_GATED.has(g.requirementId) || ENTITY_GATED.has(g.requirementId) || TOURISM_GATED.has(g.requirementId) || SIGN_ANNUAL_GATED.has(g.requirementId) || OUTDOOR_GATED.has(g.requirementId) || BEVERAGE_MFG_GATED.has(g.requirementId) || CHILDCARE_GATED.has(g.requirementId) || HOA_GATED.has(g.requirementId) || ENTERTAINMENT_GATED.has(g.requirementId) || DEALER_GATED.has(g.requirementId)) {
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
    for (const field of ["regulatoryReason", "purpose", "nextAction", "consequenceOrNextStep"] as const) assert.equal(new Set(output.map(g => g[field])).size, 43);
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

// REG-GUIDE-TOURISM-001 (2026-09-18 QA): the PRTC innkeeper registration
// and room-tax return cards rendered the unvalidated-description placeholder
// on a live Trujillo Alto guest-house filing. Both concepts now validate,
// and every firing path explains the match: lodging business types via the
// businessType fallback (BT_GUEST_HOUSE here), the short-term-rental
// question, and the overnight-guests question.
test("tourism concepts validate for every lodging firing path in EN/ES", () => {
  const mkCtx = (businessTypeName: string, discoveryAnswers: Record<string, unknown>): GuidanceContext => {
    const p = { municipality: "Trujillo Alto", business_type: businessTypeName, business_structure: "LLC", location_type: "Guest House", number_of_employees: 2 };
    return { ...ctx, businessTypeName, profile: p, discoveryAnswers, engineInput: buildEngineInput(p, discoveryAnswers) };
  };
  for (const language of ["en", "es"] as const) {
    // Business-type paths: Guest House matches RULE_0145/0263 (innkeeper
    // registration); Airbnb / Short-Term Rental matches RULE_0601
    // (room-tax return). The room-tax document has no guest-house BT rule —
    // its BT path is the STR business type.
    const gh = buildRequirementGuidance(req("DOC_TOURISM_REGISTRATION"), { ...mkCtx("Guest House", {}), language });
    assert.equal(gh.status, "VALIDATED", `DOC_TOURISM_REGISTRATION: ${gh.reviewReasons}`);
    assert.deepEqual(gh.triggerFacts.map(f => f.key), ["businessType"]);
    assert.ok(gh.whyThisApplies.includes(gh.regulatoryReason));
    assert.doesNotMatch(JSON.stringify(gh), /validated description pending|not confirmed yet/);
    const str = buildRequirementGuidance(req("DOC_ROOM_TAX_RETURN"), { ...mkCtx("Airbnb / Short-Term Rental", {}), language });
    assert.equal(str.status, "VALIDATED", `DOC_ROOM_TAX_RETURN: ${str.reviewReasons}`);
    assert.deepEqual(str.triggerFacts.map(f => f.key), ["businessType"]);
    assert.doesNotMatch(JSON.stringify(str), /validated description pending|not confirmed yet/);
    // Q&A paths: the writeKey answers the bundled flow records
    // (short_term_rental, guests_stay_overnight) explain the match with
    // their own labels. REG-WIRE-001 (2026-09-18 QA): Q_GUESTS_OVERNIGHT
    // had a writeKey but no engine mapping, so the bundled flow's answer
    // never reached the engine — the mapping is now in buildEngineInput.
    for (const [writeKey, qkey, id] of [["short_term_rental", "Q_SHORT_TERM_RENTAL", "DOC_TOURISM_REGISTRATION"], ["guests_stay_overnight", "Q_GUESTS_OVERNIGHT", "DOC_ROOM_TAX_RETURN"]] as const) {
      const g = buildRequirementGuidance(req(id), { ...mkCtx("Guest House", { [writeKey]: true }), language });
      assert.equal(g.status, "VALIDATED", `${id}: ${g.reviewReasons}`);
      assert.deepEqual(g.triggerFacts.map(f => f.key), [qkey]);
    }
  }
});

// REG-GUIDE-OPPE-001 (2026-09-18 QA): the OPPE installer registration card
// rendered the unvalidated-description placeholder on a live Toa Alta
// solar-installer filing. The concept now validates for the BT firing path
// (RULE_0605, BT_SOLAR_INSTALLER) and the generic businessType fallback,
// in EN and PR-ES, with the PPPE source grounded in the verified official
// form (docs.pr.gov, rev. Feb 2025) and Ley 17-2019.
test("OPPE installer concept validates for the solar-installer firing path in EN/ES", () => {
  const mkCtx = (businessTypeName: string): GuidanceContext => {
    const p = { municipality: "Toa Alta", business_type: businessTypeName, business_structure: "LLC", location_type: "Office / Commercial", number_of_employees: 12 };
    return { ...ctx, businessTypeName, profile: p, discoveryAnswers: {}, engineInput: buildEngineInput(p, {}) };
  };
  for (const language of ["en", "es"] as const) {
    const g = buildRequirementGuidance(req("DOC_OPPE_INSTALLER_REG"), { ...mkCtx("Solar Installer"), language });
    assert.equal(g.status, "VALIDATED", `DOC_OPPE_INSTALLER_REG: ${g.reviewReasons}`);
    assert.deepEqual(g.triggerFacts.map(f => f.key), ["businessType"]);
    assert.ok(g.whyThisApplies.includes(g.regulatoryReason));
    assert.doesNotMatch(JSON.stringify(g), /validated description pending|not confirmed yet/);
    assert.match(JSON.stringify(g.sources), /Ley 17-2019|docs\.pr\.gov/);
    if (language === "es") {
      assert.doesNotMatch(g.regulatoryReason, /installer certification is the installer's credential/);
      assert.match(g.regulatoryReason, /Ley 17-2019/);
    }
  }
});

// REG-GUIDE-SIGN-001 (2026-09-20 QA): the Sign / Rótulo Permit card rendered
// the unvalidated-description placeholder on live Guaynabo (car wash),
// San Juan (boutique), and Carolina (gym) filings. The concept now
// validates for every firing path — the signage question (RULE_0030) and
// the tourism-flag retail rules (RULE_0535/0537/0539/0541/0543, via the
// businessType fallback) — in EN and PR-ES, with the Ley 355-1999
// (Ley Uniforme de Rótulos y Anuncios), Art. 29 source.
test("sign/rótulo concept validates for every signage firing path in EN/ES", () => {
  const mkCtx = (profile: Record<string, unknown>, discoveryAnswers: Record<string, unknown>): GuidanceContext => {
    return { ...ctx, businessTypeName: profile.business_type as string, profile, discoveryAnswers, engineInput: buildEngineInput(profile, discoveryAnswers) };
  };
  const guaynaboRetail = { municipality: "Guaynabo", business_type: "Clothing Store", business_structure: "LLC", location_type: "Retail Storefront", number_of_employees: 4 };
  const sanJuanRetail = { ...guaynaboRetail, municipality: "San Juan" };
  const guaynaboCarWash = { municipality: "Guaynabo", business_type: "Car Wash", business_structure: "LLC", location_type: "Commercial Space", number_of_employees: 8 };
  for (const language of ["en", "es"] as const) {
    // Question path: the commercial-signage question answers RULE_0030.
    const q = buildRequirementGuidance(req("DOC_SIGN_PERMIT"), { ...mkCtx(guaynaboRetail, { commercial_signage: true }), language });
    assert.equal(q.status, "VALIDATED", `DOC_SIGN_PERMIT (question): ${q.reviewReasons}`);
    assert.deepEqual(q.triggerFacts.map(f => f.key), ["Q_COMMERCIAL_SIGNAGE"]);
    assert.ok(q.whyThisApplies.includes(q.regulatoryReason));
    assert.doesNotMatch(JSON.stringify(q), /validated description pending|not confirmed yet/);
    assert.match(JSON.stringify(q.sources), /Ley 355-1999|355/);
    // Tourism-flag path: San Juan clothing store matches RULE_0543 with no
    // signage question answered; the businessType fallback explains it.
    const t = buildRequirementGuidance(req("DOC_SIGN_PERMIT"), { ...mkCtx(sanJuanRetail, {}), language });
    assert.equal(t.status, "VALIDATED", `DOC_SIGN_PERMIT (tourism flag): ${t.reviewReasons}`);
    assert.deepEqual(t.triggerFacts.map(f => f.key), ["businessType"]);
    assert.ok(t.triggerFacts.every(f => f.ruleIds.includes("RULE_0543")));
    assert.doesNotMatch(JSON.stringify(t), /validated description pending|not confirmed yet/);
    // Honest negative control: Guaynabo car wash with no signage fact
    // matches no rule — the card hedges (MATCH_TRACE_MISSING) but renders
    // the validated copy, never the placeholder.
    const n = buildRequirementGuidance(req("DOC_SIGN_PERMIT"), { ...mkCtx(guaynaboCarWash, {}), language });
    assert.equal(n.status, "GUIDANCE_NEEDS_REVIEW");
    assert.ok(n.reviewReasons.includes("MATCH_TRACE_MISSING"), `DOC_SIGN_PERMIT (negative): ${n.reviewReasons}`);
    assert.doesNotMatch(JSON.stringify(n), /validated description pending/);
    assert.match(JSON.stringify(n.sources), /Ley 355-1999|355/);
  }
});

// REG-GUIDE-ANNUAL-001 (2026-09-20 QA): the Annual Report / Annual Fee card
// rendered the unvalidated-description placeholder on a live Carolina gym
// filing. RULE_0636 is requires_business with requires_existing_business
// and excluded entity types, so the concept is validated against the
// existing-business firing path; the generic businessType fallback explains
// the match honestly. EN and PR-ES, Ley 164-2009 Arts. 15.01(A) y 21.03(C)
// source (April 15 deadline, $150 annual fee; late fees $750 corp /
// $500 + 1.5%/month LLC).
test("annual report concept validates via the businessType fallback in EN/ES", () => {
  for (const language of ["en", "es"] as const) {
    const p = { municipality: "Carolina", business_type: "Gym / Fitness Studio", business_structure: "LLC", location_type: "Commercial Space", number_of_employees: 8 };
    const c: GuidanceContext = { ...ctx, language, businessTypeName: p.business_type, profile: p, discoveryAnswers: {}, engineInput: buildEngineInput(p, {}, {}, { projectIntent: "existing_business" }) };
    const g = buildRequirementGuidance(req("DOC_ANNUAL_REPORT"), c);
    assert.equal(g.status, "VALIDATED", `DOC_ANNUAL_REPORT: ${g.reviewReasons}`);
    assert.deepEqual(g.triggerFacts.map(f => f.key), ["businessType"]);
    assert.ok(g.triggerFacts.every(f => f.ruleIds.includes("RULE_0636")));
    assert.ok(g.whyThisApplies.includes(g.regulatoryReason));
    assert.doesNotMatch(JSON.stringify(g), /validated description pending|not confirmed yet/);
    assert.match(JSON.stringify(g.sources), /Ley 164-2009|15\.01/);
    assert.match(g.regulatoryReason, /April 15|15 de abril/);
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

test("municipal guidance is municipality-generic: no other municipality's name leaks", () => {
  // Validated review 2026-09-16: DOC_MUNICIPAL_REGISTRATION and
  // DOC_MUNICIPAL_TAX_COMPLIANCE deleted — not universal requirements.
  for (const id of ["DOC_PATENTE_MUNICIPAL", "DOC_LEASE_AGREEMENT"]) {
    for (const municipality of ["Guaynabo", "San Juan", "Ponce"]) {
      const muniCtx = { ...ctx, municipality, engineInput: buildEngineInput({ ...profile, municipality }, answers) };
      const g = buildRequirementGuidance(req(id), muniCtx);
      assert.equal(g.status, "VALIDATED", `${id} in ${municipality}: ${g.reviewReasons}`);
      assert.doesNotMatch(JSON.stringify({ ...g, sources: undefined }), /Bayamón/i, `${id} must not name Bayamón for a ${municipality} business`);
      assert.doesNotMatch(JSON.stringify(g.sources), /Bayamón|municipiodebayamon/i, `${id} must not cite Bayamón sources for a ${municipality} business`);
      assert.match(g.whyThisApplies, new RegExp(municipality), `${id} names the actual municipality`);
    }
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
  // The bar fires no room-tax rules, so the validated room-tax concept stays
  // provisional for it (correct — MATCH_TRACE_MISSING, not a placeholder).
  assert.equal(buildRequirementGuidance(req("DOC_ROOM_TAX_RETURN"), ctx).status, "GUIDANCE_NEEDS_REVIEW");
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

test("DTRH employer registration renders a validated description, never the placeholder", () => {
  // Regression: live QA 2026-09-16 showed "A validated description of this
  // document is still pending." for a Guaynabo catering business hiring 6.
  for (const language of ["en", "es"] as const) {
    const g = buildRequirementGuidance(req("DOC_DTRH_EMPLOYER_REG"), { ...ctx, language });
    assert.equal(g.status, "VALIDATED", `DTRH: ${g.reviewReasons}`);
    assert.doesNotMatch(g.whatThisIs, /still pending|aún está pendiente/);
    assert.match(g.whatThisIs, /DTRH/);
    assert.match(JSON.stringify(g.sources), /trabajo\.pr\.gov/);
  }
});

test("REG-GUIDE-ENTITY-001: incorporation and LLC formation cite their own source", () => {
  // Regression: live QA 2026-09-17 showed the Certificate of Incorporation
  // card's legal-basis header reading "LLC formation by Certificate of
  // Organization" — both legal forms shared one guidance source.
  const corpCtx = { ...ctx, entityType: "stock_corporation" };
  const incorp = buildRequirementGuidance(req("DOC_CERT_INCORPORATION"), corpCtx);
  const incorpSources = JSON.stringify(incorp.sources);
  assert.match(incorpSources, /Certificate of Incorporation/);
  assert.doesNotMatch(incorpSources, /LLC formation by Certificate of Organization/);
  const llc = buildRequirementGuidance(req("DOC_CERT_ORGANIZATION"), ctx);
  const llcSources = JSON.stringify(llc.sources);
  assert.match(llcSources, /Certificate of Organization/);
  assert.doesNotMatch(llcSources, /incorporation by Certificate of Incorporation/);
});

// REG-GUIDE-OUTDOOR-001 (2026-09-20 QA): the Outdoor Seating Authorization
// card rendered the unvalidated-description placeholder on a live Mayagüez
// café filing (S96). The concept now validates for the seating-question
// firing path (RULE_0031, verified) in EN and PR-ES, with the
// primary-source-verified San Juan Art. 2.301 citation — self-scoped so
// non-San Juan filings are directed to their own municipal ordinance (no
// invented Mayagüez basis). The negative control confirms the card hedges
// (MATCH_TRACE_MISSING) but still renders validated copy, never the
// placeholder.
test("REG-GUIDE-OUTDOOR-001: outdoor seating concept validates for the seating-question path in EN/ES", () => {
  const mkCtx = (profile: Record<string, unknown>, discoveryAnswers: Record<string, unknown>): GuidanceContext => {
    return { ...ctx, businessTypeName: profile.business_type as string, profile, discoveryAnswers, engineInput: buildEngineInput(profile, discoveryAnswers) };
  };
  const mayaguezCafe = { municipality: "Mayagüez", business_type: "Cafe", business_structure: "LLC", location_type: "Restaurant Location", number_of_employees: 6 };
  const sanJuanCafe = { ...mayaguezCafe, municipality: "San Juan" };
  for (const language of ["en", "es"] as const) {
    // Question path: the outdoor-seating question answers RULE_0031.
    const q = buildRequirementGuidance(req("DOC_OUTDOOR_SEATING_AUTH"), { ...mkCtx(mayaguezCafe, { outdoor_seating: true }), language });
    assert.equal(q.status, "VALIDATED", `DOC_OUTDOOR_SEATING_AUTH (question): ${q.reviewReasons}`);
    assert.deepEqual(q.triggerFacts.map(f => f.key), ["Q_OUTDOOR_SEATING"]);
    assert.ok(q.triggerFacts.every(f => f.ruleIds.includes("RULE_0031")));
    assert.ok(q.whyThisApplies.includes(q.regulatoryReason));
    assert.doesNotMatch(JSON.stringify(q), /validated description pending|not confirmed yet|still pending/);
    assert.match(JSON.stringify(q.sources), /2\.301|San Juan/);
    if (language === "es") {
      assert.match(q.regulatoryReason, /Art\. 2\.301|Código de Orden Público/);
      assert.match(q.whatYouNeedToDo, /alcaldía/);
    } else {
      assert.match(q.whatYouNeedToDo, /alcald/);
    }
    // San Juan path: the same validated concept, San Juan-scoped citation.
    const s = buildRequirementGuidance(req("DOC_OUTDOOR_SEATING_AUTH"), { ...mkCtx(sanJuanCafe, { outdoor_seating: true }), language });
    assert.equal(s.status, "VALIDATED", `DOC_OUTDOOR_SEATING_AUTH (San Juan): ${s.reviewReasons}`);
    assert.match(JSON.stringify(s.sources), /2\.301/);
    // Honest negative control: Mayagüez café with no seating answer matches
    // no rule — the card hedges (MATCH_TRACE_MISSING) but renders the
    // validated copy, never the placeholder.
    const n = buildRequirementGuidance(req("DOC_OUTDOOR_SEATING_AUTH"), { ...mkCtx(mayaguezCafe, {}), language });
    assert.equal(n.status, "GUIDANCE_NEEDS_REVIEW");
    assert.ok(n.reviewReasons.includes("MATCH_TRACE_MISSING"), `DOC_OUTDOOR_SEATING_AUTH (negative): ${n.reviewReasons}`);
    assert.doesNotMatch(JSON.stringify(n), /validated description pending|still pending/);
    assert.match(JSON.stringify(n.sources), /2\.301|San Juan/);
  }
});

// REG-GUIDE-TAX-COMPLIANCE-001 (2026-09-21 QA): the Hacienda Tax Filing &
// Debt Compliance Evidence card rendered the unvalidated-description
// placeholder on live Carolina and Ponce alcohol-chain filings (S98/S99,
// 2026-09-21 00:00). The concept now validates for the Q_ALCOHOL_SOLD firing
// path (RULE_0663, verified) in EN and PR-ES, grounded in Hacienda's
// official internal-revenue license requirements (founder judgment §29.2,
// 2026-09-16, settled). The next action is status-neutral ("obtain or
// confirm") because RULE_0663 carries compliance_mode=verify_existing. The
// negative control confirms the card hedges (MATCH_TRACE_MISSING) but still
// renders validated copy, never the placeholder.
test("REG-GUIDE-TAX-COMPLIANCE-001: Hacienda tax filing/debt compliance concept validates for the alcohol path in EN/ES", () => {
  const mkCtx = (prof: Record<string, unknown>, discoveryAnswers: Record<string, unknown>): GuidanceContext => {
    return { ...ctx, businessTypeName: prof.business_type as string, profile: prof, discoveryAnswers, engineInput: buildEngineInput(prof, discoveryAnswers) };
  };
  const ponceBar = { municipality: "Ponce", business_type: "Bar", business_structure: "LLC", location_type: "Commercial Facility", number_of_employees: 3, alcohol_sold: true };
  for (const language of ["en", "es"] as const) {
    // Question path: the alcohol-sold answer fires RULE_0663 (verified).
    const q = buildRequirementGuidance(req("DOC_HACIENDA_TAX_COMPLIANCE"), { ...mkCtx(ponceBar, { alcohol_sold: true }), language });
    assert.equal(q.status, "VALIDATED", `DOC_HACIENDA_TAX_COMPLIANCE (question): ${q.reviewReasons}`);
    assert.deepEqual(q.triggerFacts.map(f => f.key), ["Q_ALCOHOL_SOLD"]);
    assert.ok(q.triggerFacts.every(f => f.ruleIds.includes("RULE_0663")));
    assert.ok(q.whyThisApplies.includes(q.regulatoryReason));
    assert.doesNotMatch(JSON.stringify(q), /validated description pending|not confirmed yet|still pending/);
    assert.match(JSON.stringify(q.sources), /Licencia de Traficante al Detalle/);
    if (language === "es") {
      assert.match(q.regulatoryReason, /radicación de planillas|deudas contributivas/);
      assert.match(q.whatYouNeedToDo, /SURI/);
    } else {
      assert.match(q.whatYouNeedToDo, /SURI/);
    }
    // Honest negative control: Ponce café with no alcohol facts at all matches
    // no rule for this document — the card hedges (MATCH_TRACE_MISSING) but
    // renders the validated copy, never the placeholder.
    const noAlcohol = { municipality: "Ponce", business_type: "Cafe", business_structure: "LLC", location_type: "Commercial Facility", number_of_employees: 3 };
    const n = buildRequirementGuidance(req("DOC_HACIENDA_TAX_COMPLIANCE"), { ...mkCtx(noAlcohol, {}), language });
    assert.equal(n.status, "GUIDANCE_NEEDS_REVIEW");
    assert.ok(n.reviewReasons.includes("MATCH_TRACE_MISSING"), `DOC_HACIENDA_TAX_COMPLIANCE (negative): ${n.reviewReasons}`);
    assert.doesNotMatch(JSON.stringify(n), /validated description pending|still pending/);
  }
});

// REG-GUIDE-ALCOHOL-SALES-001 (2026-09-21 QA): the Alcohol Sales Projection /
// Volume Information card rendered the unvalidated-description placeholder on
// live alcohol-chain filings. The concept now validates for the Q_ALCOHOL_SOLD
// firing path (RULE_0665, heuristic) in EN and PR-ES, grounded in Hacienda's
// official internal-revenue license requirements (founder judgment §29.2,
// 2026-09-16, settled). The negative control confirms the card hedges
// (MATCH_TRACE_MISSING) but still renders validated copy, never the
// placeholder.
test("REG-GUIDE-ALCOHOL-SALES-001: alcohol sales projection concept validates for the alcohol path in EN/ES", () => {
  const mkCtx = (prof: Record<string, unknown>, discoveryAnswers: Record<string, unknown>): GuidanceContext => {
    return { ...ctx, businessTypeName: prof.business_type as string, profile: prof, discoveryAnswers, engineInput: buildEngineInput(prof, discoveryAnswers) };
  };
  const ponceBar = { municipality: "Ponce", business_type: "Bar", business_structure: "LLC", location_type: "Commercial Facility", number_of_employees: 3, alcohol_sold: true };
  for (const language of ["en", "es"] as const) {
    // Question path: the alcohol-sold answer fires RULE_0665 (heuristic).
    const q = buildRequirementGuidance(req("DOC_ALCOHOL_SALES_PROJECTION"), { ...mkCtx(ponceBar, { alcohol_sold: true }), language });
    assert.equal(q.status, "VALIDATED", `DOC_ALCOHOL_SALES_PROJECTION (question): ${q.reviewReasons}`);
    assert.deepEqual(q.triggerFacts.map(f => f.key), ["Q_ALCOHOL_SOLD"]);
    assert.ok(q.triggerFacts.every(f => f.ruleIds.includes("RULE_0665")));
    assert.ok(q.whyThisApplies.includes(q.regulatoryReason));
    assert.doesNotMatch(JSON.stringify(q), /validated description pending|not confirmed yet|still pending/);
    assert.match(JSON.stringify(q.sources), /Licencia de Traficante al Detalle/);
    if (language === "es") {
      assert.match(q.regulatoryReason, /proyección de ventas/);
      assert.match(q.whatYouNeedToDo, /ventas de alcohol/);
    } else {
      assert.match(q.whatYouNeedToDo, /alcohol sales/);
    }
    // Honest negative control: Ponce café with no alcohol facts at all matches
    // no rule for this document — the card hedges (MATCH_TRACE_MISSING) but
    // renders the validated copy, never the placeholder.
    const noAlcohol = { municipality: "Ponce", business_type: "Cafe", business_structure: "LLC", location_type: "Commercial Facility", number_of_employees: 3 };
    const n = buildRequirementGuidance(req("DOC_ALCOHOL_SALES_PROJECTION"), { ...mkCtx(noAlcohol, {}), language });
    assert.equal(n.status, "GUIDANCE_NEEDS_REVIEW");
    assert.ok(n.reviewReasons.includes("MATCH_TRACE_MISSING"), `DOC_ALCOHOL_SALES_PROJECTION (negative): ${n.reviewReasons}`);
    assert.doesNotMatch(JSON.stringify(n), /validated description pending|still pending/);
  }
});

// REG-GUIDE-FDA-001 / REG-GUIDE-WASTEWATER-001 / REG-GUIDE-STORMWATER-001 /
// REG-GUIDE-AIR-001 (2026-09-21 QA): the FDA Food Facility Registration card
// and the three environmental cards (wastewater discharge, NPDES
// industrial-stormwater, air permit) rendered the unvalidated-description
// placeholder — with a confident REQUIRED badge on the FDA card — on live
// Arecibo brewery and Trujillo Alto roastery filings (S100/S102). The four
// validated concepts below cover the verified BT firing path (RULE_0656)
// and the municipality_flag heuristic paths (RULE_0668/0669, 0670/0671,
// 0674/0675) in EN and PR-ES. Negative controls confirm the cards hedge
// (MATCH_TRACE_MISSING) but still render validated copy, never the
// placeholder.
for (const [docId, ruleIds, basis, esBits] of [
  ["DOC_FDA_FOOD_FACILITY_REGISTRATION", ["RULE_0656"], /415|350d/, ["instalación alimentaria", "FDA"]] as const,
  ["DOC_WASTEWATER_DISCHARGE_AUTHORIZATION", ["RULE_0668", "RULE_0669"], /AAA/, ["aguas residuales", "AAA"]] as const,
  ["DOC_NPDES_INDUSTRIAL_STORMWATER", ["RULE_0670", "RULE_0671"], /NPDES|no-exposure/, ["aguas pluviales", "no exposición"]] as const,
  ["DOC_AIR_PERMIT", ["RULE_0674", "RULE_0675"], /DRNA/, ["permiso de aire", "DRNA"]] as const,
]) {
  test(`REG-GUIDE-${docId === "DOC_FDA_FOOD_FACILITY_REGISTRATION" ? "FDA" : docId === "DOC_WASTEWATER_DISCHARGE_AUTHORIZATION" ? "WASTEWATER" : docId === "DOC_NPDES_INDUSTRIAL_STORMWATER" ? "STORMWATER" : "AIR"}-001: ${docId} concept validates for beverage manufacturing in EN/ES`, () => {
    const mkCtx = (prof: Record<string, unknown>, discoveryAnswers: Record<string, unknown>): GuidanceContext => {
      return { ...ctx, businessTypeName: prof.business_type as string, profile: prof, discoveryAnswers, engineInput: buildEngineInput(prof, discoveryAnswers) };
    };
    const brewery = { municipality: "Arecibo", business_type: "Beverage Manufacturing", business_structure: "LLC", location_type: "Industrial Facility", number_of_employees: 8 };
    for (const language of ["en", "es"] as const) {
      const q = buildRequirementGuidance(req(docId), { ...mkCtx(brewery, {}), language });
      assert.equal(q.status, "VALIDATED", `${docId}: ${q.reviewReasons}`);
      assert.ok(q.triggerFacts.some(f => ruleIds.some(r => f.ruleIds.includes(r))), `${docId} trigger rules: ${JSON.stringify(q.triggerFacts.map(f => f.ruleIds))}`);
      assert.doesNotMatch(JSON.stringify(q), /validated description pending|not confirmed yet|still pending/);
      assert.match(JSON.stringify(q.sources), basis);
      for (const bit of esBits) {
        if (language === "es") assert.match(JSON.stringify(q), new RegExp(bit), `${docId} ES copy`);
      }
      // Honest negative control: Ponce café matches none of the firing rules
      // — the card hedges (MATCH_TRACE_MISSING) but renders validated copy,
      // never the placeholder.
      const cafe = { municipality: "Ponce", business_type: "Cafe", business_structure: "LLC", location_type: "Commercial Facility", number_of_employees: 3 };
      const n = buildRequirementGuidance(req(docId), { ...mkCtx(cafe, {}), language });
      assert.equal(n.status, "GUIDANCE_NEEDS_REVIEW");
      assert.ok(n.reviewReasons.includes("MATCH_TRACE_MISSING"), `${docId} (negative): ${n.reviewReasons}`);
      assert.doesNotMatch(JSON.stringify(n), /validated description pending|still pending/);
    }
  });
}

// REG-GUIDE-VERIFY-001 (2026-09-21 QA): the EIN and Permiso Único cards
// rendered apply-copy ("SmartPR prepares the IRS Form SS-4 application for
// you" / "complete the permit application in SBP") with a VERIFY EXISTING
// badge on a live Toa Alta auto-parts filing for an operating business
// (S101). The issued-document guidance and the DOC_EIN concept next action
// are now status-neutral: they lead with the upload and offer preparation
// only as the alternative.
test("REG-GUIDE-VERIFY-001: EIN and Permiso Único guidance lead with upload, not application (EN/ES)", () => {
  assert.match(ISSUED_DOCUMENT_GUIDANCE.ein_letter, /^Upload the IRS EIN confirmation/);
  assert.doesNotMatch(ISSUED_DOCUMENT_GUIDANCE.ein_letter, /^SmartPR prepares/);
  assert.match(ISSUED_DOCUMENT_GUIDANCE_ES.ein_letter, /^Sube la confirmación del EIN/);
  assert.match(ISSUED_DOCUMENT_GUIDANCE.permiso_unico, /^Upload the issued Permiso Único/);
  assert.doesNotMatch(ISSUED_DOCUMENT_GUIDANCE.permiso_unico, /^SmartPR prepares/);
  assert.match(ISSUED_DOCUMENT_GUIDANCE_ES.permiso_unico, /^Sube el Permiso Único emitido/);
  const einConcept = PR_REQUIREMENT_GUIDANCE["DOC_EIN"];
  assert.match(einConcept.nextAction.en, /^Upload the IRS EIN confirmation/);
  assert.match(einConcept.nextAction.es, /^Sube la confirmación del EIN/);
  assert.doesNotMatch(JSON.stringify(einConcept.nextAction), /A new entity must be formed before it can apply/);
});

// REG-GUIDE-OUTDOOR-AGENCY-001 (2026-09-21 QA): a live Toa Baja gelato filing
// (S109) rendered the Outdoor Seating Authorization card's source agency as
// "Municipio de San Juan". The Art. 2.301 citation is verified for San Juan
// only; the agency label must stay municipal-generic (matching the document
// node's own "Municipal Government") so no filing names the wrong
// municipality as the source.
test("REG-GUIDE-OUTDOOR-AGENCY-001: outdoor seating source agency is municipal-generic (live S109 finding 2026-09-21)", () => {
  const src = PR_GUIDANCE_SOURCES.outdoorSeating;
  assert.equal(src.agency, "Municipal Government");
  assert.doesNotMatch(src.agency, /San Juan/);
  // The citation itself stays the verified San Juan source with its
  // self-scoping disclosure (7488cb5) — only the agency label changed.
  assert.match(src.citation, /Art\. 2\.301/);
});

// REG-GUIDE-ALCOHOL-CITATION-001 (2026-09-21 QA): a live Guaynabo brewery
// filing (S111) showed the alcohol-license source citation as "Internal
// Revenue Code, Subtitle E" alongside the PR "Código de Rentas Internas de
// 2011" rule citation — in en-US UI "Internal Revenue Code" reads as the
// federal IRC. The source must name the Puerto Rico statute, matching the
// KB rule citation and the linked hacienda.pr.gov PDF.
test("REG-GUIDE-ALCOHOL-CITATION-001: alcohol source cites the PR Código de Rentas Internas, not the federal IRC (live S111 finding 2026-09-21)", () => {
  const src = PR_GUIDANCE_SOURCES.alcohol;
  assert.match(src.citation, /Código de Rentas Internas de 2011/);
  assert.doesNotMatch(src.citation, /Internal Revenue Code/);
});

// REG-GUIDE-BACKGROUND-001 (2026-09-22 QA): a live Guaynabo daycare filing
// (S125) fired DOC_BACKGROUND_CHECK via RULE_0195/RULE_0039, but the concept
// only knew the alcohol-license context — its copy framed the
// criminal-record certificate as an alcohol-license prerequisite and its
// dependency claimed the certificate belongs to an alcohol-license file.
// The concept is now context-aware: the copy describes the certificate
// itself, and dependencies are fact-key conditioned (the generalized
// conditionalDependencies model), so each requiring context renders only
// its own parent filing.
test("REG-GUIDE-BACKGROUND-001: background-check guidance names the true requiring context — daycare staff checks are not framed as an alcohol prerequisite", () => {
  const daycareProfile = { municipality: "Guaynabo", business_type: "Daycare", location_type: "Commercial Facility" };
  const daycareAnswers = { children_present: true };
  const daycareCtx: GuidanceContext = { language: "en", municipality: "Guaynabo", businessTypeName: "Daycare", profile: daycareProfile, discoveryAnswers: daycareAnswers, entityType: "limited_liability_company", kb: KB, engineInput: buildEngineInput(daycareProfile, daycareAnswers) };
  const daycareReq = (id: string): GuidanceRequirement => {
    const doc = KB.documents.find(d => d.id === id)!;
    return { document_id: id, code: id.toLowerCase(), name: doc?.name ?? id, agency: doc?.agency ?? "", reason: "Old generic text must not leak", applicability: "required", triggerFacts: [] };
  };
  const g = buildRequirementGuidance(daycareReq("DOC_BACKGROUND_CHECK"), daycareCtx);
  assert.equal(g.status, "VALIDATED", `daycare background check must validate, got: ${g.status} (${g.reviewReasons.join(", ")})`);
  // The trigger is the childcare branch — never the alcohol branch.
  assert.ok(g.triggerFacts.some(f => f.key === "Q_CHILDREN_PRESENT" || f.key === "businessType"), `must trigger on the childcare branch, got: ${JSON.stringify(g.triggerFacts)}`);
  assert.ok(!g.triggerFacts.some(f => f.key === "Q_ALCOHOL_SOLD" || f.key === "Q_ALCOHOL_SERVED" || f.key === "Q_ALCOHOL_MANUFACTURED"), "daycare guidance must not trigger on an alcohol branch");
  // The copy is about the certificate itself and names childcare staffing as
  // the requiring basis for this filing — the card never frames the
  // certificate as an alcohol prerequisite (REG-GUIDE-BACKGROUND-002: the
  // basis lives in branchContext, rendered for the matched branch only).
  assert.match(g.whyThisApplies, /Establishments that care for or educate children/);
  assert.doesNotMatch(g.whyThisApplies, /alcohol/i);
  assert.doesNotMatch(g.regulatoryReason, /alcohol/i);
  assert.doesNotMatch(g.nextAction, /alcohol/i);
  assert.doesNotMatch(g.consequenceOrNextStep, /alcohol/i);
  // The dependency chain is context-conditioned: the daycare card points at
  // the childcare license — never the alcohol license.
  assert.deepEqual(g.dependencies, ["DOC_CHILDCARE_LICENSE"], `daycare background check must depend on the childcare license only, got: ${JSON.stringify(g.dependencies)}`);
  // Control: the alcohol branch still validates for an actual alcohol
  // filing (the Bayamón bar fixture answers alcohol_sold) and still
  // identifies the background certificate as part of the alcohol-license
  // chain (§29.2 founder judgment preserved).
  const bar = buildRequirementGuidance(req("DOC_BACKGROUND_CHECK"), ctx);
  assert.equal(bar.status, "VALIDATED", `bar background check must validate, got: ${bar.status} (${bar.reviewReasons.join(", ")})`);
  assert.ok(bar.triggerFacts.some(f => f.key === "Q_ALCOHOL_SOLD"), `bar guidance must still trigger on the alcohol branch, got: ${JSON.stringify(bar.triggerFacts)}`);
  assert.match(bar.whyThisApplies, /Hacienda requires the criminal-record certificate inside the retail alcohol beverage license file/);
  assert.doesNotMatch(bar.whyThisApplies, /children/i);
  assert.deepEqual(bar.dependencies, ["DOC_ALCOHOL_LICENSE"], `bar background check must still depend on the alcohol license, got: ${JSON.stringify(bar.dependencies)}`);
});

// REG-GUIDE-BACKGROUND-002 (2026-09-22 QA, live S125 follow-up): the
// branchContext model — the requiring basis belongs to the matched
// condition branch, never the shared body. The validator rejects a
// branchContext that does not parallel conditions or that carries
// placeholder copy.
test("REG-GUIDE-BACKGROUND-002: branchContext parallels conditions and names the subject", () => {
  const base = PR_REQUIREMENT_GUIDANCE.DOC_BACKGROUND_CHECK;
  assert.equal(base.branchContext?.length, base.conditions.length, "branchContext must parallel conditions");
  assert.deepEqual(validateGuidanceConcept(base), [], `background-check concept must validate clean, got: ${validateGuidanceConcept(base).join(", ")}`);
  assert.ok(
    validateGuidanceConcept({ ...base, branchContext: base.branchContext!.slice(0, 3) }).includes("BRANCH_CONTEXT_INVALID"),
    "a branchContext shorter than conditions must fail validation"
  );
  assert.ok(
    validateGuidanceConcept({ ...base, branchContext: base.branchContext!.map((b, i) => i === 0 ? { en: "Some generic text about this document.", es: "Algún texto genérico sobre este documento." } : b) }).includes("BRANCH_CONTEXT_INVALID"),
    "a branch that does not name the subject must fail validation"
  );
});

// REG-GUIDE-CHILDCARE-001 (2026-09-22 QA): the Childcare / Education License
// card rendered the unvalidated-description placeholder on live daycare
// filings (S127). The concept is now validated against Ley 173-2016 and the
// official Departamento de la Familia licensing office (SULME): the license
// is the legal permission to care for children in a facility — issued for a
// specific site, non-transferable, valid up to two years, displayed
// publicly. The test pins both languages, the Ley 173-2016 citation, the
// SULME source, and that the concept validates cleanly through the model
// validator (no generic or placeholder copy).
test("REG-GUIDE-CHILDCARE-001: childcare-license guidance is validated from Ley 173-2016 / SULME, not a placeholder", () => {
  const daycareProfile = { municipality: "Bayamón", business_type: "Daycare", location_type: "Commercial Facility" };
  const daycareAnswers = { children_present: true, food_prepared: true };
  const daycareCtx: GuidanceContext = { language: "en", municipality: "Bayamón", businessTypeName: "Daycare", profile: daycareProfile, discoveryAnswers: daycareAnswers, entityType: "limited_liability_company", kb: KB, engineInput: buildEngineInput(daycareProfile, daycareAnswers) };
  const daycareReq = (id: string): GuidanceRequirement => {
    const doc = KB.documents.find(d => d.id === id)!;
    return { document_id: id, code: id.toLowerCase(), name: doc?.name ?? id, agency: doc?.agency ?? "", reason: "Old generic text must not leak", applicability: "required", triggerFacts: [] };
  };
  for (const language of ["en", "es"] as const) {
    const g = buildRequirementGuidance(daycareReq("DOC_CHILDCARE_LICENSE"), { ...daycareCtx, language });
    assert.equal(g.status, "VALIDATED", `daycare childcare license (${language}) must validate, got: ${g.status} (${g.reviewReasons.join(", ")})`);
    // Primary legal basis present in the copy.
    assert.match(g.regulatoryReason, /Ley 173-2016/);
    // Never a placeholder.
    assert.doesNotMatch(g.regulatoryReason + g.purpose + g.nextAction + g.consequenceOrNextStep, /pending|placeholder|coming soon|not yet validated/i);
    // The copy names the real requiring context: childcare licensing.
    assert.ok(g.triggerFacts.some(f => f.key === "businessType" || f.key === "Q_CHILDREN_PRESENT"), `must trigger on the childcare branch, got: ${JSON.stringify(g.triggerFacts)}`);
  }
  // Sources: Departamento de la Familia licensing office on a .pr.gov URL.
  const en = buildRequirementGuidance(daycareReq("DOC_CHILDCARE_LICENSE"), daycareCtx);
  assert.ok(en.sources.some(s => s.agency.includes("Departamento de la Familia") && s.url.includes("familia.pr.gov")), `must cite the Familia licensing office, got: ${JSON.stringify(en.sources.map(s => s.url))}`);
  assert.ok(en.sources.some(s => s.citation.includes("Ley 173-2016")), "must cite Ley 173-2016");
  // Validator must pass the authored concept cleanly.
  assert.deepEqual(validateGuidanceConcept(PR_REQUIREMENT_GUIDANCE.DOC_CHILDCARE_LICENSE), [], `childcare-license concept must validate clean, got: ${validateGuidanceConcept(PR_REQUIREMENT_GUIDANCE.DOC_CHILDCARE_LICENSE).join(", ")}`);
});

// REG-GUIDE-HOA-001 (2026-09-22 QA): the Condo / HOA Short-Term Rental
// Authorization card rendered the unvalidated-description placeholder on the
// live Guaynabo STR filing (S138). The concept is now validated against the
// rule's own cited authority, Ley 129-2020 (Ley de Condominios): short-term
// rentals of a condo unit are subject to the condominium's master deed
// (escritura matriz) and regulations — the governing documents decide. The
// test pins both languages, the Ley 129-2020 citation, that the copy stays
// conditional (never claims a universal HOA permit exists), and that the
// concept validates cleanly through the model validator.
test("REG-GUIDE-HOA-001: HOA-authorization guidance is validated from Ley 129-2020, not a placeholder", () => {
  const strProfile = { municipality: "Guaynabo", business_type: "Airbnb / Short-Term Rental", location_type: "Condominium", number_of_employees: 0 };
  const strAnswers = { hoa_condo: true, guests_stay_overnight: true, short_term_rental: true };
  const strCtx: GuidanceContext = { language: "en", municipality: "Guaynabo", businessTypeName: "Airbnb / Short-Term Rental", profile: strProfile, discoveryAnswers: strAnswers, entityType: "sole_proprietorship", kb: KB, engineInput: buildEngineInput(strProfile, strAnswers) };
  const strReq = (id: string): GuidanceRequirement => {
    const doc = KB.documents.find(d => d.id === id)!;
    return { document_id: id, code: id.toLowerCase(), name: doc?.name ?? id, agency: doc?.agency ?? "", reason: "Old generic text must not leak", applicability: "required", triggerFacts: [] };
  };
  for (const language of ["en", "es"] as const) {
    const g = buildRequirementGuidance(strReq("DOC_HOA_AUTHORIZATION"), { ...strCtx, language });
    assert.equal(g.status, "VALIDATED", `HOA authorization (${language}) must validate, got: ${g.status} (${g.reviewReasons.join(", ")})`);
    // Primary legal basis present in the copy.
    assert.match(g.regulatoryReason, /Ley 129-2020/);
    // Never a placeholder.
    assert.doesNotMatch(g.regulatoryReason + g.purpose + g.nextAction + g.consequenceOrNextStep, /pending|placeholder|coming soon|not yet validated/i);
    // Conditional framing: the governing documents decide — never a claim
    // of a universal HOA permit.
    const copy = g.regulatoryReason + g.purpose + g.nextAction + g.consequenceOrNextStep;
    assert.match(copy, /governing documents|documentos/i, "copy must stay conditional on the condo's governing documents");
    // The copy names the real requiring context: the HOA/condo question.
    assert.ok(g.triggerFacts.some(f => f.key === "businessType" || f.key === "Q_HOA_CONDO"), `must trigger on the HOA branch, got: ${JSON.stringify(g.triggerFacts)}`);
  }
  // Source: Ley 129-2020 (Ley de Condominios) cited on lexjuris.
  const en = buildRequirementGuidance(strReq("DOC_HOA_AUTHORIZATION"), strCtx);
  assert.ok(en.sources.some(s => s.citation.includes("Ley 129-2020")), `must cite Ley 129-2020, got: ${JSON.stringify(en.sources.map(s => s.citation))}`);
  // Validator must pass the authored concept cleanly.
  assert.deepEqual(validateGuidanceConcept(PR_REQUIREMENT_GUIDANCE.DOC_HOA_AUTHORIZATION), [], `HOA-authorization concept must validate clean, got: ${validateGuidanceConcept(PR_REQUIREMENT_GUIDANCE.DOC_HOA_AUTHORIZATION).join(", ")}`);
});

// REG-GUIDE-ENTERTAINMENT-001 (2026-09-22 QA): the S139 scenario (live trio
// at a new Dorado no-food bar) fires RULE_0032 (Q_LIVE_ENTERTAINMENT=true,
// heuristic + mfk=entertainment_details). The card must never claim a
// universal entertainment permit exists — Puerto Rico has no single
// island-wide instrument — and must not invent a Dorado entertainment
// permit or conflate the venue's authorization with promoter licensing
// under Ley 182-1996. The test pins both languages, the Ley 161-2009
// Art. 8.4A citation, the conditional framing, the promoter
// disambiguation, and clean validation.
test("REG-GUIDE-ENTERTAINMENT-001: entertainment-permit guidance is validated from Ley 161-2009, not a placeholder", () => {
  const profile = { municipality: "Dorado", business_type: "Bar", location_type: "Commercial Facility", number_of_employees: 6 };
  const answers = { live_entertainment: true, commercial_signage: true, alcohol_sold: true, alcohol_served: true };
  const ctx2: GuidanceContext = { language: "en", municipality: "Dorado", businessTypeName: "Bar", profile, discoveryAnswers: answers, entityType: "limited_liability_company", kb: KB, engineInput: buildEngineInput(profile, answers) };
  const req2 = (id: string): GuidanceRequirement => {
    const doc = KB.documents.find(d => d.id === id)!;
    return { document_id: id, code: id.toLowerCase(), name: doc?.name ?? id, agency: doc?.agency ?? "", reason: "Old generic text must not leak", applicability: "needs_more_information", triggerFacts: [] };
  };
  for (const language of ["en", "es"] as const) {
    const g = buildRequirementGuidance(req2("DOC_ENTERTAINMENT_PERMIT"), { ...ctx2, language });
    assert.equal(g.status, "VALIDATED", `entertainment permit (${language}) must validate, got: ${g.status} (${g.reviewReasons.join(", ")})`);
    // Primary legal basis present in the copy.
    assert.match(g.regulatoryReason, /Ley 161-2009/);
    // Never a placeholder.
    assert.doesNotMatch(g.regulatoryReason + g.purpose + g.nextAction + g.consequenceOrNextStep, /pending|placeholder|coming soon|not yet validated/i);
    // Conditional framing: Puerto Rico has no single island-wide
    // entertainment permit — never a claim of a universal instrument.
    assert.match(g.regulatoryReason, /no single island-wide entertainment permit|no hay un permiso de entretenimiento único/i);
    // The promoter-law disambiguation must be present in the copy.
    assert.match(g.purpose, /Ley 182-1996/);
    // The copy names the real requiring context: the live-entertainment
    // question.
    assert.ok(g.triggerFacts.some(f => f.key === "Q_LIVE_ENTERTAINMENT"), `must trigger on the Q_LIVE_ENTERTAINMENT branch, got: ${JSON.stringify(g.triggerFacts)}`);
  }
  // Sources: Ley 161-2009 Art. 8.4A (OGP) and Ley 182-1996 (promoter law).
  // Pin the correct L.P.R.A. section number: Art. 8.4A is codified at
  // 23 L.P.R.A § 9018c-1 (OGP consolidated text, rev. 14 May 2026) — the
  // previously-authored "§ 9048n" appears nowhere in the law.
  const en = buildRequirementGuidance(req2("DOC_ENTERTAINMENT_PERMIT"), ctx2);
  assert.ok(en.sources.some(s => s.citation.includes("Ley 161-2009")), `must cite Ley 161-2009, got: ${JSON.stringify(en.sources.map(s => s.citation))}`);
  assert.ok(en.sources.some(s => s.citation.includes("Ley 182-1996")), `must cite Ley 182-1996, got: ${JSON.stringify(en.sources.map(s => s.citation))}`);
  const ley161 = en.sources.find(s => s.citation.includes("Ley 161-2009"))!;
  assert.match(ley161.citation, /23 L\.P\.R\.A § 9018c-1/, `Art. 8.4A citation must pin the correct L.P.R.A. section number, got: ${ley161.citation}`);
  assert.doesNotMatch(ley161.citation, /9048n/, `citation must not carry the wrong § 9048n number, got: ${ley161.citation}`);
  // Validator must pass the authored concept cleanly.
  assert.deepEqual(validateGuidanceConcept(PR_REQUIREMENT_GUIDANCE.DOC_ENTERTAINMENT_PERMIT), [], `entertainment-permit concept must validate clean, got: ${validateGuidanceConcept(PR_REQUIREMENT_GUIDANCE.DOC_ENTERTAINMENT_PERMIT).join(", ")}`);
});

// REG-GUIDE-ROOMTAX-001 (2026-09-22 QA): S138 closed the §29.4
// founder-settled chain question — innkeeper registration, Innkeeper ID and
// the monthly room-tax return all fire — but the 7% room-tax rate itself
// appeared nowhere in the graph's guidance. The rate is now pinned in the
// room-tax concept in EN/ES, verified 2026-09-22 on the PRTC's own page
// (tourism.pr.gov/room-tax/: "a room occupancy tax equal to 7% of the
// room's rate").
test("REG-GUIDE-ROOMTAX-001: room-tax guidance states the verified 7% rate in EN/ES", () => {
  const strProfile = { municipality: "Guaynabo", business_type: "Airbnb / Short-Term Rental", location_type: "Condominium", number_of_employees: 0 };
  const strAnswers = { hoa_condo: true, guests_stay_overnight: true, short_term_rental: true };
  const strCtx: GuidanceContext = { language: "en", municipality: "Guaynabo", businessTypeName: "Airbnb / Short-Term Rental", profile: strProfile, discoveryAnswers: strAnswers, entityType: "sole_proprietorship", kb: KB, engineInput: buildEngineInput(strProfile, strAnswers) };
  const strReq = (id: string): GuidanceRequirement => {
    const doc = KB.documents.find(d => d.id === id)!;
    return { document_id: id, code: id.toLowerCase(), name: doc?.name ?? id, agency: doc?.agency ?? "", reason: "Old generic text must not leak", applicability: "required", triggerFacts: [] };
  };
  for (const language of ["en", "es"] as const) {
    const g = buildRequirementGuidance(strReq("DOC_ROOM_TAX_RETURN"), { ...strCtx, language });
    assert.equal(g.status, "VALIDATED", `room-tax return (${language}) must validate, got: ${g.status} (${g.reviewReasons.join(", ")})`);
    assert.match(g.regulatoryReason, /7%/, `room-tax regulatory reason (${language}) must state the 7% rate`);
    assert.match(g.purpose, /7%/, `room-tax purpose (${language}) must state the 7% rate`);
  }
  // Validator must still pass the edited concept cleanly.
  assert.deepEqual(validateGuidanceConcept(PR_REQUIREMENT_GUIDANCE.DOC_ROOM_TAX_RETURN), [], `room-tax concept must validate clean, got: ${validateGuidanceConcept(PR_REQUIREMENT_GUIDANCE.DOC_ROOM_TAX_RETURN).join(", ")}`);
});
