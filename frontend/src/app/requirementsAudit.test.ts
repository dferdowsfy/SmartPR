// ============================================================================
// Regression tests for the 2026-09-16 requirements-engine audit fix.
//
// The audit changed the engine so requirements only trigger on facts that
// actually support them:
//  - runRulesEngine (rulesEngine.ts) carries compliance_mode, verification,
//    missing_fact_keys, negated_fact_keys and numeric expected_answer
//    matchers through to the classifier; explicitly negative facts suppress
//    rules and are recorded in debug.rulesSuppressed.
//  - classifyEngineRequirements (requirementApplicability.ts) renders the
//    full applicability spectrum (required / likely_required /
//    verify_existing / needs_more_information / supporting_evidence / ...),
//    caps heuristic rules at likely_required, and maps verify_existing
//    obligations to verify_existing for existing businesses.
//
// CASES A–G mirror the audit brief. Document ids are resolved from the KB by
// name, not hardcoded — the KB owns its identifiers.
// ============================================================================

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runRulesEngine, type KnowledgeBase, type EngineInput } from "./rulesEngine.ts";
import { buildEngineInput } from "./kb.ts";
import {
  classifyEngineRequirements,
  applyEntityFormationExclusivity,
  bucketForApplicability,
  type ClassifiedRequirement,
} from "./requirementApplicability.ts";
import { ES } from "./i18n.ts";
import { PR_REQUIREMENT_GUIDANCE } from "./guidance/pr.ts";

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

/** Resolve a KB document id by matching all needles against the doc name. */
function docByName(...needles: string[]): string {
  const hits = (KB.documents as Array<{ id: string; name: string }>).filter((d) =>
    needles.every((n) => d.name.toLowerCase().includes(n.toLowerCase()))
  );
  assert.ok(hits.length > 0, `no KB document matches name needles: ${needles.join(", ")}`);
  return hits[0].id;
}

const DOC_SAM = docByName("sam.gov");
const DOC_TRANSPORT = docByName("transportation", "permit");
const DOC_BONAFIDE = docByName("bona fide");
const DOC_GLI = docByName("general liability");
const DOC_CONTRACTOR = docByName("contractor license");
const DOC_LEASE = docByName("lease agreement");
const DOC_NOISE = docByName("noise variance");
const DOC_LUMA = docByName("luma", "interconnection");
const DOC_NETMETER = docByName("net metering");
// Validated review 2026-09-16: DOC_STORMWATER_PLAN was removed; industrial
// stormwater is now DOC_NPDES_INDUSTRIAL_STORMWATER (NPDES industrial-stormwater
// coverage / no-exposure determination).
const DOC_STORMWATER = docByName("npdes", "stormwater");
const DOC_OGPE = docByName("ogpe construction permit");
const DOC_MERCHANT = docByName("merchant registration");
const DOC_DEED = docByName("property deed");
const DOC_WITHHOLDING = docByName("hacienda", "withholding");
const DOC_WORKERS_COMP = docByName("workers compensation");
const DOC_DTRH = docByName("dtrh employer");

const byId = (rows: ClassifiedRequirement[], id: string) =>
  rows.find((r) => r.document_id === id);

function classify(input: EngineInput, businessStatus: "new" | "existing" | "project_only" | null) {
  const { requirements, debug } = runRulesEngine(KB, input);
  return {
    classified: classifyEngineRequirements(requirements, { kb: KB, businessStatus }),
    debug,
  };
}

/** classify() variant that forwards confirmed municipality-flag decisions,
 *  simulating the UI's potential-requirement confirmation step. */
function classifyWithDecisions(
  input: EngineInput,
  businessStatus: "new" | "existing" | "project_only" | null,
  potentialDecisions: Record<string, "applies" | "not_applies" | "not_sure">
) {
  const { requirements, debug } = runRulesEngine(KB, input);
  return {
    classified: classifyEngineRequirements(requirements, { kb: KB, businessStatus, potentialDecisions }),
    debug,
  };
}

test("premise: doc ids resolve from documents.json and Guaynabo has the metro flag", () => {
  assert.equal(DOC_SAM, "DOC_SAM_REGISTRATION");
  assert.equal(DOC_TRANSPORT, "DOC_TRANSPORT_PERMIT");
  assert.equal(DOC_BONAFIDE, "DOC_AGRICULTURE_REGISTRATION");
  assert.equal(DOC_GLI, "DOC_INSURANCE");
  assert.equal(DOC_CONTRACTOR, "DOC_CONTRACTOR_LICENSE");
  assert.equal(DOC_LEASE, "DOC_LEASE_AGREEMENT");
  assert.equal(DOC_NOISE, "DOC_NOISE_VARIANCE");
  assert.equal(DOC_STORMWATER, "DOC_NPDES_INDUSTRIAL_STORMWATER");
  assert.equal(DOC_OGPE, "DOC_OGPE_CONSTRUCTION_PERMIT");
  assert.equal(DOC_MERCHANT, "DOC_MERCHANT_REGISTRATION");
  assert.equal(DOC_DEED, "DOC_PROPERTY_DEED");
  const guaynabo = (KB.municipalities as Array<{ name: string; flags: string[] }>).find(
    (m) => m.name === "Guaynabo"
  );
  assert.ok(guaynabo, "Guaynabo must exist in municipalities.json");
  assert.ok(guaynabo.flags.includes("metro"), "Guaynabo must carry the metro flag");
});

test("CASE A: Guaynabo renovation for an existing business — verified triggers only", () => {
  const { classified } = classify(
    {
      municipalityName: "Guaynabo",
      businessTypeName: "Real Estate Developer",
      businessStatus: "existing",
      answers: { Q_PHYSICAL_LOCATION: true },
      projectFacts: {
        project_type: "renovation and expansion",
        renovation: true,
        expansion: true,
        existing_building: true,
        interior_demolition: true,
        electrical_work: true,
        plumbing_work: true,
        site_work: false,
      },
    },
    "existing"
  );

  // OGPe Construction Permit: the verified renovation project fact triggers it.
  const ogpe = byId(classified, DOC_OGPE);
  assert.ok(ogpe, "OGPe Construction Permit should be emitted");
  assert.equal(ogpe.applicability, "required");
  assert.equal(ogpe.source_rule_id, "RULE_0644");

  // Merchant Registration: an existing obligation -> verify, never required.
  const merchant = byId(classified, DOC_MERCHANT);
  assert.ok(merchant, "Merchant Registration should be emitted");
  assert.equal(merchant.applicability, "verify_existing");

  // These must never be "required" from the Guaynabo facts alone.
  for (const id of [DOC_SAM, DOC_CONTRACTOR, DOC_LEASE, DOC_NOISE]) {
    const row = byId(classified, id);
    assert.ok(
      !row || row.applicability !== "required",
      `${id} must not be required (got ${row?.applicability})`
    );
  }

  // Stormwater: the old heuristic metro rule (RULE_0269) and the verified
  // land-disturbance trigger (RULE_0647) were both removed by the 2026-09-16
  // validated review. Industrial stormwater (NPDES) now fires only for
  // industrial business types with metro/coastal flags, pending the
  // stormwater_exposure fact — so it must be absent for an interior-only
  // real-estate renovation. Interior square footage is not land disturbance.
  const storm = byId(classified, DOC_STORMWATER);
  assert.equal(
    storm,
    undefined,
    "industrial stormwater must be absent for a non-industrial interior renovation"
  );

  // Structural integrity: every emitted requirement is explainable.
  for (const r of classified) {
    assert.ok(r.triggerFacts.length > 0, `${r.document_id} needs triggerFacts`);
    assert.ok(r.source_rule_id, `${r.document_id} needs source_rule_id`);
    assert.ok(typeof r.confidence === "number", `${r.document_id} needs confidence`);
  }

  // "Municipality selected" alone never produces a confirmed requirement:
  // universal municipality rules are verify_existing obligations.
  for (const r of classified) {
    if (r.reason.includes("Municipality selected")) {
      assert.equal(
        r.applicability,
        "verify_existing",
        `${r.document_id}: a municipality-only reason must not be required`
      );
    }
  }

  // Heuristic bases are capped and carry their review marker.
  for (const r of classified) {
    if ((r.triggerFacts ?? []).includes("heuristic:requires_regulatory_review")) {
      assert.ok(
        r.applicability !== "required",
        `${r.document_id}: a heuristic basis must never be required`
      );
    }
  }
});

test("CASE B: contractor opening a contracting business — license is needs_more_information pending residential_work", () => {
  const { classified } = classify(
    {
      municipalityName: "San Juan",
      businessTypeName: "General Contractor",
      businessStatus: "new",
      entityNotFormed: true,
      answers: {},
    },
    "new"
  );
  const lic = byId(classified, DOC_CONTRACTOR);
  assert.ok(lic, "Contractor License should be emitted for a General Contractor");
  // Validated review 2026-09-16: the DACO contractor license is heuristic
  // pending the residential_work fact — a general contractor may do
  // commercial-only work, which does not need the DACO license. Never
  // required on business type alone.
  assert.equal(lic.applicability, "needs_more_information");
  assert.equal(lic.source_rule_id, "RULE_0123");
  assert.ok(
    lic.missingFacts?.includes("residential_work"),
    "contractor license must name residential_work as the missing fact"
  );
});

test("CASE C: land disturbance alone does not trigger stormwater coverage (RULE_0647 removed)", () => {
  const { classified } = classify(
    {
      municipalityName: "Guaynabo",
      businessStatus: "project_only",
      answers: {},
      projectFacts: {
        project_type: "new_construction",
        land_disturbance_acres: 1.5,
        site_work: true,
      },
    },
    "project_only"
  );
  // Validated review 2026-09-16: RULE_0647 (land_disturbance_acres >= 1 ->
  // stormwater) was removed. Industrial stormwater (NPDES) now requires an
  // industrial business type plus a metro/coastal flag, pending the
  // stormwater_exposure fact — land disturbance alone fires nothing.
  const storm = byId(classified, DOC_STORMWATER);
  assert.equal(
    storm,
    undefined,
    "1.5 disturbed acres alone must not trigger industrial stormwater coverage"
  );

  // Positive control: an industrial business in a metro municipality surfaces
  // the NPDES industrial-stormwater evaluation, capped at
  // needs_more_information while stormwater_exposure is unknown.
  const industrial = classify(
    {
      municipalityName: "Guaynabo",
      businessTypeName: "Beverage Manufacturing",
      businessStatus: "new",
      answers: {},
    },
    "new"
  ).classified;
  const indStorm = byId(industrial, DOC_STORMWATER);
  assert.ok(indStorm, "industrial stormwater should be emitted for a metro industrial business");
  assert.equal(indStorm.applicability, "needs_more_information");
  assert.equal(indStorm.source_rule_id, "RULE_0670");
  assert.ok(
    indStorm.missingFacts?.includes("stormwater_exposure"),
    "industrial stormwater must name stormwater_exposure as the missing fact"
  );
});

test("CASE D: existing business leases — lease is supporting evidence, not a requirement", () => {
  const { classified } = classify(
    {
      municipalityName: "Guaynabo",
      businessStatus: "existing",
      answers: { Q_EXISTING_LEASE: true },
    },
    "existing"
  );
  const lease = byId(classified, DOC_LEASE);
  assert.ok(lease, "Lease Agreement should be emitted when Q_EXISTING_LEASE=true");
  assert.equal(lease.applicability, "supporting_evidence");
});

test("CASE E: existing business owns — deed is supporting evidence, lease absent", () => {
  const { classified } = classify(
    {
      municipalityName: "Guaynabo",
      businessStatus: "existing",
      answers: {},
      projectFacts: { property_tenure: "owned" },
    },
    "existing"
  );
  const deed = byId(classified, DOC_DEED);
  assert.ok(deed, "Property Deed should be emitted when property_tenure=owned");
  assert.equal(deed.applicability, "supporting_evidence");
  assert.equal(
    byId(classified, DOC_LEASE),
    undefined,
    "Lease Agreement must be absent for an owned property"
  );
});

test("CASE F: no federal-contracting intent — SAM.gov stays out", () => {
  const { classified } = classify(
    {
      municipalityName: "San Juan",
      businessTypeName: "Restaurant",
      businessStatus: "existing",
      answers: { Q_FEDERAL_CONTRACTS_GRANTS: false },
    },
    "existing"
  );
  assert.equal(
    byId(classified, DOC_SAM),
    undefined,
    "SAM.gov must not appear without federal-contracting intent"
  );
});

test("CASE G: merchant registration is verify_existing for an operating business, required for a new one", () => {
  const existing = classify(
    {
      municipalityName: "Ponce",
      businessTypeName: "Restaurant",
      businessStatus: "existing",
      answers: {},
    },
    "existing"
  ).classified;
  assert.equal(byId(existing, DOC_MERCHANT)?.applicability, "verify_existing");

  const fresh = classify(
    {
      municipalityName: "Ponce",
      businessTypeName: "Restaurant",
      businessStatus: "new",
      entityNotFormed: true,
      answers: {},
    },
    "new"
  ).classified;
  assert.equal(byId(fresh, DOC_MERCHANT)?.applicability, "required");
});

test("land_disturbance_acres no longer triggers stormwater coverage (RULE_0647 removed)", () => {
  // Validated review 2026-09-16 removed the numeric land-disturbance trigger
  // (RULE_0647). No numeric-match rule remains in the KB; land disturbance
  // alone must be inert for stormwater at any acreage.
  const base: EngineInput = {
    businessStatus: "project_only",
    answers: {},
    projectFacts: { project_type: "new_construction", site_work: true },
  };
  const below = classify(
    {
      ...base,
      projectFacts: { ...(base.projectFacts as Record<string, unknown>), land_disturbance_acres: 0.5 },
    },
    "project_only"
  ).classified;
  assert.equal(
    byId(below, DOC_STORMWATER),
    undefined,
    "0.5 acres must not trigger stormwater coverage"
  );

  const above = classify(
    {
      ...base,
      projectFacts: { ...(base.projectFacts as Record<string, unknown>), land_disturbance_acres: 1.5 },
    },
    "project_only"
  ).classified;
  const storm = byId(above, DOC_STORMWATER);
  assert.equal(
    storm,
    undefined,
    "1.5 acres must not trigger stormwater coverage after RULE_0647's removal"
  );
});

test("bucketForApplicability maps statuses to review buckets", () => {
  assert.equal(bucketForApplicability("required"), "required");
  assert.equal(bucketForApplicability("likely_required"), "required");
  assert.equal(bucketForApplicability("verify_existing"), "attention");
  assert.equal(bucketForApplicability("conditional"), "attention");
  assert.equal(bucketForApplicability("needs_more_information"), "attention");
  assert.equal(bucketForApplicability("blocked"), "attention");
  assert.equal(bucketForApplicability("supporting_evidence"), "info");
  assert.equal(bucketForApplicability("recommended"), "info");
  assert.equal(bucketForApplicability("completed"), "info");
  assert.equal(bucketForApplicability("not_applicable"), "not_applicable");
});

test("REG-TRANSPORT-001: logistics/warehouse transport permit is question-gated on Q_COMMERCIAL_VEHICLES — never REQUIRED without vehicle facts", () => {
  // QA 2026-09-16: NTSP/CSP transport authorization applies to persons
  // transporting cargo/passengers for hire, not to every business whose
  // type says "logistics"/"warehouse". Deep-research batch 1 (2026-09-21)
  // retargeted RULE_0185–RULE_0188 from business-type heuristics to
  // Q_COMMERCIAL_VEHICLES question triggers (the research verdicts judged
  // BT-alone assertion an over-assertion). The discovery intake asks
  // Q_COMMERCIAL_VEHICLES for Logistics/Warehouse BTs, so there is no recall
  // gap: an unanswered or No answer means no transport card at all; a Yes
  // surfaces the permit as needs_more_information naming transport_type —
  // never required. The authoritative trigger stays RULE_0022.
  const DOC_TRANSPORT = docByName("transportation / puc permit");
  const DOC_VEHICLE = docByName("vehicle registration");

  const base: EngineInput = {
    municipalityName: "Cataño",
    businessTypeName: "Logistics Company",
    businessStatus: "existing",
    answers: { Q_PHYSICAL_LOCATION: true },
  };

  for (const businessTypeName of ["Logistics Company", "Warehouse Operator"]) {
    const noVehicleFacts = classify({ ...base, businessTypeName }, "existing").classified;
    assert.equal(
      byId(noVehicleFacts, DOC_TRANSPORT),
      undefined,
      `${businessTypeName} with no vehicle facts must not surface a transport permit card (question-gated)`
    );
    assert.equal(
      byId(noVehicleFacts, DOC_VEHICLE),
      undefined,
      `${businessTypeName} with no vehicle facts must not surface a vehicle registration card (question-gated)`
    );
    const declined = classify(
      { ...base, businessTypeName, answers: { ...base.answers, Q_COMMERCIAL_VEHICLES: false } },
      "existing"
    ).classified;
    assert.equal(
      byId(declined, DOC_TRANSPORT),
      undefined,
      `${businessTypeName} answering No to commercial vehicles must not surface a transport permit card`
    );
  }

  const withVehicles = classify(
    { ...base, answers: { ...base.answers, Q_COMMERCIAL_VEHICLES: true } },
    "existing"
  ).classified;
  const transportReq = byId(withVehicles, DOC_TRANSPORT);
  assert.ok(transportReq, "transport permit must fire when commercial vehicles are confirmed");
  assert.equal(
    transportReq.applicability,
    "needs_more_information",
    "transport permit must be needs_more_information with confirmed vehicle use until transport_type is known"
  );
  assert.equal(transportReq.source_rule_id, "RULE_0022", "authoritative trigger must be the Q_COMMERCIAL_VEHICLES rule");
  assert.ok(
    transportReq.missingFacts?.includes("transport_type"),
    "transport permit must name transport_type as the missing fact"
  );
  const vehicleReq = byId(withVehicles, DOC_VEHICLE);
  assert.ok(vehicleReq, "vehicle registration must fire when commercial vehicles are confirmed");
  assert.equal(
    vehicleReq.applicability,
    "needs_more_information",
    "vehicle registration must be needs_more_information until vehicle_ownership is known"
  );
});

test("CASE H: Hacienda employer withholding is verify_existing for an operating employer, required for a new one", () => {
  // RULE_0650 (Q_EMPLOYEES_HIRED -> DOC_HACIENDA_EMPLOYER_WITHHOLDING) must
  // carry the same verify_existing compliance posture as its sibling
  // employer obligations (RULE_0020 workers comp, RULE_0619 DTRH). An
  // operating business with employees verifies its existing withholding
  // registration; a new employer registers for the first time.
  const existing = classify(
    {
      municipalityName: "Bayamón",
      businessTypeName: "Manufacturer",
      businessStatus: "existing",
      answers: { Q_EMPLOYEES_HIRED: true },
    },
    "existing"
  ).classified;
  const withholding = byId(existing, DOC_WITHHOLDING);
  assert.ok(withholding, "Hacienda employer withholding must fire for an employer");
  assert.equal(
    withholding.applicability,
    "verify_existing",
    "an existing business verifies its existing withholding registration"
  );
  assert.equal(
    withholding.source_rule_id,
    "RULE_0650",
    "the Q_EMPLOYEES_HIRED withholding rule should be the presented basis"
  );
  // Sibling employer obligations must agree on posture — never tell an
  // existing employer to verify two registrations while "registering" a third.
  assert.equal(
    byId(existing, DOC_WORKERS_COMP)?.applicability,
    "verify_existing",
    "workers comp posture must match"
  );
  assert.equal(
    byId(existing, DOC_DTRH)?.applicability,
    "verify_existing",
    "DTRH employer registration posture must match"
  );

  const fresh = classify(
    {
      municipalityName: "Bayamón",
      businessTypeName: "Manufacturer",
      businessStatus: "new",
      entityNotFormed: true,
      answers: { Q_EMPLOYEES_HIRED: true },
    },
    "new"
  ).classified;
  assert.equal(
    byId(fresh, DOC_WITHHOLDING)?.applicability,
    "required",
    "a new employer still registers for the first time"
  );
});

test("CASE I: swept operating obligations (RULE_0653-0664) are verify_existing for existing businesses, required for new ones", () => {
  // 2026-09-17 00:00 QA cycle — RULE_0650–0695 twin sweep. The 12 verified
  // operating-obligation rules (0653–0664) are each the sole rule for their
  // document, so setting verify_existing creates no sibling inconsistency.
  // An operating business verifies its existing license/registration/
  // certification; a new business applies for the first time.
  const DOC_AMBULANT = docByName("ambulant");
  const DOC_TAX_COMPLIANCE = docByName("hacienda", "tax filing");
  const DOC_CPR = docByName("cpr");

  const existing = classify(
    {
      municipalityName: "Arecibo",
      businessTypeName: "Food Truck",
      businessStatus: "existing",
      answers: { Q_FOOD_TRUCK_MOBILE: true, Q_ALCOHOL_SOLD: true, Q_EMPLOYEES_HIRED: true },
    },
    "existing"
  ).classified;
  assert.equal(
    byId(existing, DOC_AMBULANT)?.applicability,
    "verify_existing",
    "an existing mobile vendor verifies its ambulant-business license (RULE_0653)"
  );
  assert.equal(
    byId(existing, DOC_TAX_COMPLIANCE)?.applicability,
    "verify_existing",
    "an existing bar verifies its Hacienda tax-compliance evidence (RULE_0663)"
  );

  const daycare = classify(
    {
      municipalityName: "Caguas",
      businessTypeName: "Daycare",
      businessStatus: "existing",
      answers: { Q_EMPLOYEES_HIRED: true },
    },
    "existing"
  ).classified;
  assert.equal(
    byId(daycare, DOC_CPR)?.applicability,
    "verify_existing",
    "an existing daycare verifies current CPR/first-aid certification (RULE_0661)"
  );

  const fresh = classify(
    {
      municipalityName: "Arecibo",
      businessTypeName: "Food Truck",
      businessStatus: "new",
      entityNotFormed: true,
      answers: { Q_FOOD_TRUCK_MOBILE: true, Q_ALCOHOL_SOLD: true, Q_EMPLOYEES_HIRED: true },
    },
    "new"
  ).classified;
  assert.equal(
    byId(fresh, DOC_AMBULANT)?.applicability,
    "required",
    "a new mobile vendor still applies for the ambulant-business license"
  );
  assert.equal(
    byId(fresh, DOC_TAX_COMPLIANCE)?.applicability,
    "required",
    "a new bar still files for Hacienda tax-compliance evidence"
  );
});

test("CASE J: RULE_0652 (domiciliary-use Permiso Único) is verify_existing for existing home-based businesses", () => {
  // 2026-09-17 03:00 QA cycle (live S5): a 6-year home bookkeeping business
  // was shown Permiso Único — Domiciliary Use as a brand-new filing with no
  // verify path. RULE_0652 is verification=verified, has no
  // missing_fact_keys, and is the sole rule for DOC_DOMICILIARY_USE_PERMIT
  // — the same posture class as the RULE_0653–0663 sweep (commit e676174).
  const DOC_DOMICILIARY = docByName("domiciliary");
  const existing = classify(
    {
      municipalityName: "San Juan",
      businessTypeName: "Bookkeeping Service",
      businessStatus: "existing",
      answers: { Q_HOME_BASED: true },
    },
    "existing"
  ).classified;
  assert.equal(
    byId(existing, DOC_DOMICILIARY)?.applicability,
    "verify_existing",
    "an existing home-based business verifies its domiciliary-use authorization (RULE_0652)"
  );

  const fresh = classify(
    {
      municipalityName: "San Juan",
      businessTypeName: "Bookkeeping Service",
      businessStatus: "new",
      entityNotFormed: true,
      answers: { Q_HOME_BASED: true },
    },
    "new"
  ).classified;
  assert.equal(
    byId(fresh, DOC_DOMICILIARY)?.applicability,
    "required",
    "a new home-based business still applies for the domiciliary-use authorization"
  );
});

test("CASE K: RULE_0642 (DACO contractor license) never fires for vehicle-repair businesses", () => {
  // 2026-09-17 06:00 QA cycle (live S7, Trujillo Alto): an existing auto
  // repair shop honestly answering Yes to Q_OFFERS_CONSTRUCTION_SERVICES
  // ("construction, installation, repair, or contracting services to
  // others") was shown the DACO Contractor License as a REQUIRED Critical
  // Path card. Ley 146-1995 Registro de Contratistas covers construction
  // contractors; vehicle repair is not construction contracting. RULE_0642
  // now excludes the vehicle-repair business types.
  for (const businessTypeName of ["Auto Repair Shop", "Motorcycle Repair Shop", "Body Shop", "Tire Shop"]) {
    const rows = classify(
      {
        municipalityName: "Trujillo Alto",
        businessTypeName,
        businessStatus: "existing",
        answers: { Q_OFFERS_CONSTRUCTION_SERVICES: true },
      },
      "existing"
    ).classified;
    assert.equal(
      byId(rows, DOC_CONTRACTOR),
      undefined,
      `${businessTypeName} answering Yes to construction/repair services must not trigger the DACO contractor license`
    );
  }

  // Positive control: a genuine construction contractor in the same
  // municipality still receives the requirement.
  const contractor = classify(
    {
      municipalityName: "Trujillo Alto",
      businessTypeName: "General Contractor",
      businessStatus: "new",
      entityNotFormed: true,
      answers: { Q_OFFERS_CONSTRUCTION_SERVICES: true },
    },
    "new"
  ).classified;
  assert.equal(
    byId(contractor, DOC_CONTRACTOR)?.applicability,
    "required",
    "a new general contractor still receives the DACO contractor license"
  );

  // REG-DACO-EXCLUSION-002 (2026-09-21 21:00 QA cycle): deep-research batch 1
  // retargeted RULE_0232/RULE_0237 from business-type rules to
  // Q_OFFERS_CONSTRUCTION_SERVICES question triggers, silently bypassing
  // this exclusion — vehicle-repair BTs answering Yes got the contractor
  // card through the retargeted rules. The exclusion family must be mirrored
  // on every Q_OFFERS_CONSTRUCTION_SERVICES contractor rule so a future
  // retarget cannot drop it again.
  const rules = load("rules.json") as Array<Record<string, unknown>>;
  const contractorRuleIds = ["RULE_0642", "RULE_0232", "RULE_0237"];
  const vehicleRepairBTs = ["BT_AUTO_REPAIR_SHOP", "BT_MOTORCYCLE_REPAIR_SHOP", "BT_BODY_SHOP", "BT_TIRE_SHOP"];
  for (const id of contractorRuleIds) {
    const r = rules.find((x) => x.id === id);
    assert.ok(r, `${id} must exist`);
    const excl = (r.excluded_business_types as Array<string> | undefined) ?? [];
    for (const bt of vehicleRepairBTs) {
      assert.ok(
        excl.includes(bt),
        `${id} must exclude ${bt} (CASE K exclusion family)`
      );
    }
  }
});

test("CASE K2: Q_OFFERS_CONSTRUCTION_SERVICES scopes repair to buildings/structures", () => {
  // REG-DACO-REPAIR-001 (2026-09-20 03:00 QA cycle, live S77 Arecibo): a
  // device-repair franchise honestly answered Yes to the bundled question's
  // unqualified "repair" and was shown the DACO Contractor License as a
  // REQUIRED Critical Path card. Same defect class as CASE K (S7 auto
  // repair, 2026-09-17), but the business has no KB business type, so the
  // BT-exclusion fix cannot protect it. The generalized fix scopes the
  // question itself: all four service terms now apply to buildings or
  // structures, so any repair business (device, appliance, watch, shoe)
  // answers honestly without tripping a construction-contractor license.
  const q = (KB.questions as Array<{ id: string; question: string }>).find(
    (x) => x.id === "Q_OFFERS_CONSTRUCTION_SERVICES"
  );
  assert.ok(q, "Q_OFFERS_CONSTRUCTION_SERVICES must exist in questions.json");
  assert.match(
    q!.question,
    /on buildings or structures/i,
    "the bundled question must scope its service terms to buildings/structures"
  );
  assert.doesNotMatch(
    q!.question,
    /repair, or contracting services to others \(not only/,
    "the unqualified-repair wording must be gone"
  );

  // The ES rendering must carry the same scope (PR Spanish).
  const es = ES[q!.question] as string | undefined;
  assert.ok(es, "the reworded question needs an ES i18n entry");
  assert.match(es!, /edificios o estructuras/, "ES must scope to edificios o estructuras");

  // The guidance trigger label ("Your situation:" lead) must match the
  // question actually asked — not the old unqualified wording.
  const label = PR_REQUIREMENT_GUIDANCE.DOC_CONTRACTOR_LICENSE.conditions[0][0].label;
  assert.match(label.en, /on buildings or structures/, "EN trigger label matches the scoped question");
  assert.match(label.es, /edificios o estructuras/, "ES trigger label matches the scoped question");

  // Behavioral: a repair business with no KB business type (the S77 shape),
  // answering honestly under the new wording (No), never fires the license;
  // a genuine contractor answering Yes still does.
  for (const answers of [{ Q_OFFERS_CONSTRUCTION_SERVICES: false }]) {
    const rows = classify(
      {
        municipalityName: "Arecibo",
        businessTypeName: "Device Repair Service",
        businessStatus: "new",
        answers,
      },
      "new"
    ).classified;
    assert.equal(
      byId(rows, DOC_CONTRACTOR),
      undefined,
      "a device-repair business answering No must not trigger the DACO contractor license"
    );
  }
});

test("CASE L: DOC_HEALTH_PERMIT is verify_existing for existing businesses, required for new ones", () => {
  // 2026-09-17 09:00 QA cycle (S10, Carolina): an 8-year operating
  // restaurant was shown the Health / Sanitary Permit as REQUIRED — as if
  // applying for the first time. None of the 35 DOC_HEALTH_PERMIT rules
  // carried compliance_mode, so existing businesses were told to apply as
  // new. Health permits are recurring operating obligations: an operating
  // business verifies its existing permit; a new business applies.
  // Same defect class as the RULE_0650-0663 sweep (commit e676174).
  // Deliberately excluded: the 3 heuristic rules with missing_fact_keys
  // (RULE_0017/RULE_0089/RULE_0244) — their posture is
  // needs_more_information by design (the RULE_0664 lesson: setting
  // verify_existing on heuristic+missing-facts rules promotes NMI to
  // REQUIRED for new businesses).
  const DOC_HEALTH = docByName("health", "sanitary");

  const existing = classify(
    {
      municipalityName: "Carolina",
      businessTypeName: "Restaurant",
      businessStatus: "existing",
      answers: { Q_FOOD_PREPARED: true, Q_FOOD_SOLD: true, Q_EMPLOYEES_HIRED: true },
    },
    "existing"
  ).classified;
  const health = byId(existing, DOC_HEALTH);
  assert.ok(health, "health permit must fire for an operating restaurant");
  assert.equal(
    health.applicability,
    "verify_existing",
    "an existing restaurant verifies its existing health permit (not REQUIRED-as-new)"
  );
  assert.ok(
    ["RULE_0009", "RULE_0012", "RULE_0046"].includes(health.source_rule_id),
    `the presented basis should be a canonical food-service rule, got ${health.source_rule_id}`
  );

  // A second business type on the swept document: an existing bakery.
  const bakery = classify(
    {
      municipalityName: "Ponce",
      businessTypeName: "Bakery",
      businessStatus: "existing",
      answers: { Q_FOOD_PREPARED: true },
    },
    "existing"
  ).classified;
  assert.equal(
    byId(bakery, DOC_HEALTH)?.applicability,
    "verify_existing",
    "an existing bakery verifies its existing health permit"
  );

  // New businesses still apply for the first time.
  const fresh = classify(
    {
      municipalityName: "Carolina",
      businessTypeName: "Restaurant",
      businessStatus: "new",
      entityNotFormed: true,
      answers: { Q_FOOD_PREPARED: true, Q_FOOD_SOLD: true },
    },
    "new"
  ).classified;
  assert.equal(
    byId(fresh, DOC_HEALTH)?.applicability,
    "required",
    "a new restaurant still applies for the health permit"
  );

  // The heuristic NMI rules keep their honest posture for new businesses —
  // the sweep must not promote needs_more_information to required.
  const gym = classify(
    {
      municipalityName: "Dorado",
      businessTypeName: "Gym / Fitness Studio",
      businessStatus: "new",
      entityNotFormed: true,
      answers: {},
    },
    "new"
  ).classified;
  const gymHealth = byId(gym, DOC_HEALTH);
  assert.ok(
    !gymHealth || gymHealth.applicability !== "required",
    "the heuristic gym health rule (RULE_0244, missing health_license_trigger) must not be REQUIRED for a new business"
  );
});

test("CASE M: DOC_FIRE_CERT and DOC_CFPM are verify_existing for existing businesses, required for new ones", () => {
  // 2026-09-17 09:00 QA cycle (S10, Carolina): an 8-year operating
  // restaurant was shown the Fire Safety Certification and the Certified
  // Food Protection Manager as REQUIRED — as if applying for the first
  // time. None of the DOC_FIRE_CERT / DOC_CFPM rules carried
  // compliance_mode, so existing businesses were told to apply as new.
  // Same defect class as the DOC_HEALTH_PERMIT sweep (257f7b6, CASE L):
  // fire-safety certification and certified food protection are recurring
  // operating obligations; an operating business verifies what it holds,
  // a new business applies. Deliberately excluded: the heuristic CFPM
  // rule with missing_fact_keys (RULE_0064) — its posture is
  // needs_more_information by design (the RULE_0664 lesson).
  const DOC_FIRE = docByName("fire safety");
  const DOC_CFPM = docByName("food protection manager");

  const existing = classify(
    {
      municipalityName: "Carolina",
      businessTypeName: "Restaurant",
      businessStatus: "existing",
      answers: { Q_FOOD_PREPARED: true, Q_FOOD_SOLD: true, Q_EMPLOYEES_HIRED: true },
    },
    "existing"
  ).classified;
  const fire = byId(existing, DOC_FIRE);
  assert.ok(fire, "fire safety certification must fire for an operating restaurant");
  assert.equal(
    fire.applicability,
    "verify_existing",
    "an existing restaurant verifies its existing fire certification (not REQUIRED-as-new)"
  );
  const cfpm = byId(existing, DOC_CFPM);
  assert.ok(cfpm, "CFPM must fire for an operating restaurant");
  assert.equal(
    cfpm.applicability,
    "verify_existing",
    "an existing restaurant verifies its existing food-protection coverage (not REQUIRED-as-new)"
  );

  // New businesses still apply for the first time.
  const fresh = classify(
    {
      municipalityName: "Carolina",
      businessTypeName: "Restaurant",
      businessStatus: "new",
      entityNotFormed: true,
      answers: { Q_FOOD_PREPARED: true, Q_FOOD_SOLD: true },
    },
    "new"
  ).classified;
  assert.equal(
    byId(fresh, DOC_FIRE)?.applicability,
    "required",
    "a new restaurant still applies for the fire safety certification"
  );
  assert.equal(
    byId(fresh, DOC_CFPM)?.applicability,
    "required",
    "a new restaurant still obtains CFPM coverage"
  );

  // The heuristic NMI CFPM rule keeps its honest posture — the sweep must
  // not promote needs_more_information to required.
  assert.ok(
    !cfpm || cfpm.source_rule_id !== "RULE_0064",
    `the presented CFPM basis must not be the heuristic RULE_0064, got ${cfpm?.source_rule_id}`
  );
});

test("CASE N: DOC_TOURISM_REGISTRATION and DOC_ROOM_TAX_RETURN are verify_existing for existing STR hosts, required for new ones", () => {
  // 2026-09-17 12:00 QA cycle (S13, Bayamón): an operating short-term-rental
  // host was shown the PR Tourism Company innkeeper registration and the
  // monthly room-tax return as REQUIRED — as if applying for the first
  // time. None of the DOC_TOURISM_REGISTRATION (RULE_0033, 0139, 0142,
  // 0145, 0148, 0261–0264) or DOC_ROOM_TAX_RETURN (RULE_0601, 0602, 0691)
  // rules carried compliance_mode, so existing businesses were told to
  // apply as new. Same defect class as the DOC_HEALTH_PERMIT (257f7b6),
  // DOC_FIRE_CERT/DOC_CFPM (d23e9a4) and operating-obligation (e676174)
  // sweeps: lodging operating obligations are recurring; an operating
  // host verifies what it holds, a new host registers. Deliberately
  // swept-in: RULE_0691, which the 2026-09-17 00:00 cycle excluded for
  // recurring-filing semantics caution — re-evaluated this cycle: a
  // monthly recurring filing for an operating host is exactly
  // verify_existing semantics (verify you are current), same as the
  // Annual Report (RULE_0636). All swept rules have no missing_fact_keys
  // (the RULE_0664 lesson: never set compliance_mode on heuristic rules
  // with unresolved missing facts).
  const DOC_TOURISM = docByName("innkeeper");
  const DOC_ROOMTAX = docByName("room tax");

  const existing = classify(
    {
      municipalityName: "Bayamón",
      businessTypeName: "Airbnb / Short-Term Rental",
      businessStatus: "existing",
      answers: {
        Q_SHORT_TERM_RENTAL: true,
        Q_GUESTS_OVERNIGHT: true,
        Q_EMPLOYEES_HIRED: false,
      },
      projectFacts: { property_tenure: "owned" },
    },
    "existing"
  ).classified;
  const tourism = byId(existing, DOC_TOURISM);
  assert.ok(tourism, "innkeeper registration must fire for an operating STR host");
  assert.equal(
    tourism.applicability,
    "verify_existing",
    "an operating STR host verifies its existing innkeeper registration (not REQUIRED-as-new)"
  );
  const roomTax = byId(existing, DOC_ROOMTAX);
  assert.ok(roomTax, "room tax return must fire for an operating STR host");
  assert.equal(
    roomTax.applicability,
    "verify_existing",
    "an operating STR host verifies it is current on monthly room-tax returns (not REQUIRED-as-new)"
  );

  // New hosts still register and file for the first time.
  const fresh = classify(
    {
      municipalityName: "Bayamón",
      businessTypeName: "Airbnb / Short-Term Rental",
      businessStatus: "new",
      entityNotFormed: true,
      answers: { Q_SHORT_TERM_RENTAL: true, Q_GUESTS_OVERNIGHT: true },
      projectFacts: { property_tenure: "owned" },
    },
    "new"
  ).classified;
  assert.equal(
    byId(fresh, DOC_TOURISM)?.applicability,
    "required",
    "a new STR host still applies for the innkeeper registration"
  );
  assert.equal(
    byId(fresh, DOC_ROOMTAX)?.applicability,
    "required",
    "a new STR host still files the room-tax return going forward"
  );
});

test("CASE O: DOC_VEHICLE_REGISTRATION is verify_existing for existing vehicle-operating businesses, required for new ones", () => {
  // 2026-09-17 15:00 QA cycle (S17, Cataño): an operating food truck was
  // shown DTOP commercial vehicle registration (DOC_VEHICLE_REGISTRATION)
  // as REQUIRED — as if registering for the first time. None of the 10
  // document rules carried compliance_mode, so existing operators were
  // told to apply as new. Same defect class as the DOC_HEALTH_PERMIT
  // (257f7b6), DOC_FIRE_CERT/DOC_CFPM (d23e9a4), operating-obligation
  // (e676174), and tourism/room-tax (3348c4d) sweeps: commercial-vehicle
  // registration is an operating obligation; an existing operator verifies
  // what it holds, a new one registers. Swept compliance_mode=
  // verify_existing onto the 7 non-heuristic rules with no
  // missing_fact_keys (RULE_0178 trucking, RULE_0180 courier, RULE_0182
  // moving, RULE_0184 taxi, RULE_0190 freight forwarding, RULE_0216 car
  // dealership, RULE_0690 food truck). Deliberately excluded per the
  // RULE_0664 lesson: RULE_0021 (heuristic question-trigger with
  // missing_fact_keys=[vehicle_ownership]) and RULE_0186/RULE_0188
  // (heuristic logistics/warehouse associations with
  // missing_fact_keys=[commercial_vehicles]).
  const DOC_VEHICLE = docByName("vehicle registration");

  const existing = classify(
    {
      municipalityName: "Cataño",
      businessTypeName: "Food Truck",
      businessStatus: "existing",
      answers: {
        Q_FOOD_TRUCK_MOBILE: true,
        Q_FOOD_PREPARED: true,
        Q_FOOD_SOLD: true,
        Q_EMPLOYEES_HIRED: true,
        Q_ALCOHOL_SOLD: false,
        Q_COMMERCIAL_VEHICLES: true,
      },
    },
    "existing"
  ).classified;
  const vehicle = byId(existing, DOC_VEHICLE);
  assert.ok(vehicle, "vehicle registration must fire for an operating food truck");
  assert.equal(
    vehicle.applicability,
    "verify_existing",
    "an operating food truck verifies its existing DTOP vehicle registration (not REQUIRED-as-new)"
  );

  // The heuristic question-trigger (RULE_0021) must stay below the verified
  // business-type basis: it must never promote the document above
  // verify_existing for an existing operator. (It keeps its own
  // missing_fact_keys=[vehicle_ownership] honesty; the classifier merge lets
  // the stronger verify_existing basis win for the document posture.)

  // A new food truck still registers its commercial vehicle for the first time.
  const fresh = classify(
    {
      municipalityName: "Cataño",
      businessTypeName: "Food Truck",
      businessStatus: "new",
      entityNotFormed: true,
      answers: {
        Q_FOOD_TRUCK_MOBILE: true,
        Q_FOOD_PREPARED: true,
        Q_COMMERCIAL_VEHICLES: true,
      },
    },
    "new"
  ).classified;
  assert.equal(
    byId(fresh, DOC_VEHICLE)?.applicability,
    "required",
    "a new food truck still registers its commercial vehicle"
  );
});

test("CASE P: non-food healthcare business types no longer get the food-establishment health permit as REQUIRED", () => {
  // 2026-09-17 18:00 QA cycle (S20, Ponce): a new dental office was shown
  // DOC_HEALTH_PERMIT (Health / Sanitary Permit — cited to Ley 81-1912,
  // "reglamentación sanitaria de establecimientos de alimentos", the FOOD
  // establishment sanitary permit) as REQUIRED. A dentist's office is not
  // a food establishment; its Salud instrument is facility licensure, not
  // this permit. The 2026-09-16 validated review demoted the sibling
  // BT_MEDICAL_OFFICE (RULE_0089) to heuristic with
  // missing_fact_keys=['facility_license_category'] but missed these 8
  // siblings; they now carry the same honest needs_more_information
  // posture. RULE_0664 lesson applied: heuristic+NMI rules carry no
  // compliance_mode (verify_existing would promote NMI to REQUIRED for new
  // businesses via the classifier's businessStatus mapping).
  const DOC_HEALTH = docByName("health", "sanitary");
  const healthcareBTs: Array<[string, string]> = [
    ["Dental Office", "RULE_0092"],
    ["Pharmacy", "RULE_0095"],
    ["Clinical Laboratory", "RULE_0097"],
    ["Physical Therapy Clinic", "RULE_0101"],
    ["Veterinary Clinic", "RULE_0104"],
    ["Urgent Care Center", "RULE_0107"],
    ["Medical Spa", "RULE_0110"],
    ["Home Health Agency", "RULE_0113"],
  ];
  for (const [bt, rule] of healthcareBTs) {
    const { classified } = classify(
      {
        municipalityName: "Ponce",
        businessTypeName: bt,
        businessStatus: "new",
        entityNotFormed: true,
        answers: { Q_PHYSICAL_LOCATION: true, Q_ALCOHOL_SOLD: false },
      },
      "new"
    );
    const health = byId(classified, DOC_HEALTH);
    assert.ok(health, `${bt}: health permit row must exist (heuristic, not silently dropped)`);
    assert.equal(
      health.applicability,
      "needs_more_information",
      `${bt} (${rule}): food-establishment health permit must not be REQUIRED`
    );
    assert.ok(
      (health.missingFacts ?? []).includes("facility_license_category"),
      `${bt}: the controlling unanswered fact must be named`
    );
  }

  // The food path is untouched: a new restaurant still gets the sanitary
  // permit as REQUIRED (verified rules), an existing one as verify_existing.
  const fresh = classify(
    {
      municipalityName: "Ponce",
      businessTypeName: "Restaurant",
      businessStatus: "new",
      entityNotFormed: true,
      answers: { Q_FOOD_PREPARED: true, Q_FOOD_SOLD: true, Q_ALCOHOL_SOLD: false, Q_PHYSICAL_LOCATION: true },
    },
    "new"
  );
  assert.equal(
    byId(fresh.classified, DOC_HEALTH)?.applicability,
    "required",
    "a new restaurant still gets the food-sanitary permit as REQUIRED"
  );

  // Positive control (S19, Bayamón): a genuine contractor still gets the
  // DACO contractor license as REQUIRED — the demotion above must not
  // suppress legitimate verified bases.
  const contractor = classify(
    {
      municipalityName: "Bayamón",
      businessTypeName: "General Contractor",
      businessStatus: "new",
      entityNotFormed: true,
      answers: {
        Q_OFFERS_CONSTRUCTION_SERVICES: true,
        Q_EMPLOYEES_HIRED: true,
        Q_PHYSICAL_LOCATION: true,
        Q_ALCOHOL_SOLD: false,
      },
      projectFacts: { property_tenure: "leased" },
    },
    "new"
  );
  assert.equal(
    byId(contractor.classified, DOC_CONTRACTOR)?.applicability,
    "required",
    "a genuine general contractor still gets the DACO contractor license as REQUIRED (verified RULE_0642 basis)"
  );
});

test("CASE Q: DOC_PROFESSIONAL_LICENSE is verify_existing for existing licensed businesses, required for new ones", () => {
  // 2026-09-17 21:00 QA cycle (S23, Bayamón): an existing barbershop was
  // shown Professional License as REQUIRED — as if applying for the first
  // time. None of the 31 DOC_PROFESSIONAL_LICENSE question/BT rules
  // (RULE_0016, 0045, 0088, 0091, 0094, 0096, 0099, 0100, 0103, 0106, 0109,
  // 0112, 0114, 0115, 0116, 0118, 0119, 0120, 0121, 0122, 0209, 0210, 0211,
  // 0212, 0213, 0224, 0225, 0226, 0228, 0229, 0695) carried compliance_mode,
  // so existing businesses were told to apply as new. Same defect class as
  // the health (257f7b6), fire/CFPM (d23e9a4), tourism (3348c4d), vehicle
  // (6818ff1) and operating-obligation (e676174) sweeps: a professional
  // license is an operating obligation — an operating business verifies
  // what it holds. Deliberately excluded: RULE_0029 and RULE_0227
  // (heuristic + missing_fact_keys — the RULE_0664 lesson: never set
  // compliance_mode on heuristic rules with unresolved missing facts).
  const DOC_PROFLIC = docByName("professional license");

  const existing = classify(
    {
      municipalityName: "Bayamón",
      businessTypeName: "Barbershop",
      businessStatus: "existing",
      answers: {
        Q_EMPLOYEES_HIRED: true,
        Q_PHYSICAL_LOCATION: true,
        Q_ALCOHOL_SOLD: false,
        Q_FOOD_PREPARED: false,
        Q_PROFESSIONAL_LICENSES: true,
      },
      projectFacts: { property_tenure: "leased" },
    },
    "existing"
  ).classified;
  assert.equal(
    byId(existing, DOC_PROFLIC)?.applicability,
    "verify_existing",
    "an operating barbershop verifies its existing professional license (not REQUIRED-as-new; RULE_0695)"
  );

  const lawFirm = classify(
    {
      municipalityName: "San Juan",
      businessTypeName: "Law Firm",
      businessStatus: "existing",
      answers: { Q_PHYSICAL_LOCATION: true, Q_EMPLOYEES_HIRED: true },
      projectFacts: { property_tenure: "leased" },
    },
    "existing"
  ).classified;
  assert.equal(
    byId(lawFirm, DOC_PROFLIC)?.applicability,
    "verify_existing",
    "an operating law firm verifies its existing professional license (RULE_0114)"
  );

  // New businesses still apply for the first time.
  const fresh = classify(
    {
      municipalityName: "Bayamón",
      businessTypeName: "Barbershop",
      businessStatus: "new",
      entityNotFormed: true,
      answers: {
        Q_EMPLOYEES_HIRED: true,
        Q_PHYSICAL_LOCATION: true,
        Q_PROFESSIONAL_LICENSES: true,
      },
      projectFacts: { property_tenure: "unknown" },
    },
    "new"
  );
  assert.equal(
    byId(fresh.classified, DOC_PROFLIC)?.applicability,
    "required",
    "a new barbershop still gets the professional license as REQUIRED"
  );

  // The heuristic+NMI exclusion still holds: an unlicensed-activity
  // bookkeeper (RULE_0227, heuristic, licensed_profession_type unknown)
  // stays needs_more_information — never promoted to REQUIRED.
  const bookkeeper = classify(
    {
      municipalityName: "Dorado",
      businessTypeName: "Accounting Firm",
      businessStatus: "new",
      entityNotFormed: true,
      answers: {
        Q_HOME_BASED: true,
        Q_PHYSICAL_LOCATION: false,
        Q_EMPLOYEES_HIRED: false,
        Q_PROFESSIONAL_LICENSES: true,
      },
      projectFacts: { property_tenure: "owned" },
    },
    "new"
  );
  const bkLic = byId(bookkeeper.classified, DOC_PROFLIC);
  assert.ok(bkLic, "professional license row must exist for the accounting firm (RULE_0227 heuristic)");
  assert.equal(
    bkLic.applicability,
    "needs_more_information",
    "the bookkeeper's professional license stays needs_more_information (RULE_0227 excluded from the sweep)"
  );
  assert.ok(
    (bkLic.missingFacts ?? []).includes("licensed_profession_type"),
    "the controlling unanswered fact must be named"
  );
});

test("CASE R: DOC_ALCOHOL_LICENSE family + outdoor seating + background check are verify_existing for existing businesses, required for new ones", () => {
  // 2026-09-18 06:00 QA cycle (S32, Carolina): an operating restaurant/bar
  // serving alcohol for 2+ years (with an existing sidewalk seating area)
  // was shown the retail alcohol license, CRIM clearance, ASUME clearance,
  // alcohol-path background check, and outdoor seating authorization all as
  // REQUIRED — as if applying for the first time. None of the document
  // rules carried compliance_mode, so existing operators were told to apply
  // as new. Same defect class as the health (257f7b6), fire/CFPM (d23e9a4),
  // tourism (3348c4d), vehicle (6818ff1), and professional-license sweeps:
  // these are operating obligations — an operating business verifies what
  // it holds. Swept compliance_mode=verify_existing onto the verified rules
  // with no missing_fact_keys: DOC_ALCOHOL_LICENSE (RULE_0013, 0015, 0066,
  // 0083), DOC_CRIM_CLEARANCE (RULE_0621, 0623, 0630, 0633),
  // DOC_ASUME_CLEARANCE (RULE_0624, 0626, 0631, 0634),
  // DOC_BACKGROUND_CHECK (RULE_0039, 0192, 0195, 0198, 0201, 0204, 0207,
  // 0255, 0627, 0629, 0632, 0635), DOC_OUTDOOR_SEATING_AUTH (RULE_0031).
  // Deliberately excluded per the RULE_0664 lesson: RULE_0014, 0622, 0625,
  // 0628 (heuristic alcohol-path rules with missing_fact_keys=
  // [alcohol_sold]) and RULE_0665 (heuristic sales projection with
  // missing_fact_keys=[alcohol_sales_volume]) — verify_existing on those
  // would promote needs_more_information to REQUIRED for new businesses.
  const DOC_ALCOHOL = docByName("alcohol beverage license");
  const DOC_CRIM = docByName("crim", "clearance");
  const DOC_ASUME = docByName("asume", "clearance");
  const DOC_BGCHECK = docByName("background check");
  const DOC_SEATING = docByName("outdoor seating");
  const DOC_PROJ = docByName("alcohol sales projection");

  const existing = classify(
    {
      municipalityName: "Carolina",
      businessTypeName: "Bar",
      businessStatus: "existing",
      answers: {
        Q_ALCOHOL_SOLD: true,
        Q_OUTDOOR_SEATING: true,
        Q_EMPLOYEES_HIRED: true,
        Q_PHYSICAL_LOCATION: true,
      },
      projectFacts: { property_tenure: "leased" },
    },
    "existing"
  ).classified;
  for (const [id, label] of [
    [DOC_ALCOHOL, "alcohol license"],
    [DOC_CRIM, "CRIM clearance"],
    [DOC_ASUME, "ASUME clearance"],
    [DOC_BGCHECK, "alcohol-path background check"],
    [DOC_SEATING, "outdoor seating authorization"],
  ] as const) {
    assert.equal(
      byId(existing, id)?.applicability,
      "verify_existing",
      `an operating bar verifies its existing ${label} (not REQUIRED-as-new)`
    );
  }
  // The heuristic sales-projection rule keeps its NMI honesty — never
  // promoted to verify_existing or required by this sweep.
  assert.equal(
    byId(existing, DOC_PROJ)?.applicability,
    "needs_more_information",
    "RULE_0665 stays needs_more_information (heuristic, excluded from sweep)"
  );

  // The background-check sweep generalizes beyond alcohol: an operating
  // daycare verifies its existing background-check posture too.
  const daycare = classify(
    {
      municipalityName: "Caguas",
      businessTypeName: "Daycare",
      businessStatus: "existing",
      answers: { Q_CHILDREN_PRESENT: true, Q_PHYSICAL_LOCATION: true },
    },
    "existing"
  ).classified;
  assert.equal(
    byId(daycare, DOC_BGCHECK)?.applicability,
    "verify_existing",
    "an operating daycare verifies its existing background-check posture"
  );

  // New businesses still apply for the first time.
  const fresh = classify(
    {
      municipalityName: "Carolina",
      businessTypeName: "Bar",
      businessStatus: "new",
      entityNotFormed: true,
      answers: { Q_ALCOHOL_SOLD: true, Q_OUTDOOR_SEATING: true },
    },
    "new"
  ).classified;
  for (const [id, label] of [
    [DOC_ALCOHOL, "alcohol license"],
    [DOC_SEATING, "outdoor seating authorization"],
  ] as const) {
    assert.equal(
      byId(fresh, id)?.applicability,
      "required",
      `a new bar still gets the ${label} as REQUIRED`
    );
  }
});

test("CASE S: DOC_CHILDCARE_LICENSE + DOC_CONTRACTOR_LICENSE are verify_existing for existing businesses, required for new ones", () => {
  // 2026-09-18 09:00 QA cycle (S34 Mayagüez / S35 Caguas): an 8-year daycare
  // was shown its childcare license (Ley 173-2016) as REQUIRED, and a
  // 15-year electrical contractor was shown the DACO contractor license
  // (Ley 146-1995) as REQUIRED — both as if applying for the first time.
  // No rule on either document carried compliance_mode. Same defect class
  // as the health (257f7b6), fire/CFPM (d23e9a4), tourism (3348c4d),
  // vehicle (6818ff1), professional-license (e6b3af3), and alcohol-family
  // (ad5f516) sweeps: these are operating obligations — an operating
  // business verifies what it holds. Swept compliance_mode=verify_existing
  // onto the non-heuristic rules with no missing_fact_keys:
  // DOC_CHILDCARE_LICENSE (RULE_0194 daycare, 0197 tutoring center, 0200
  // vocational school, 0203 training company, 0206 after-school program),
  // DOC_CONTRACTOR_LICENSE (RULE_0125–0137 trade contractors, 0230–0250
  // specialty/energy/government contractors, 0642 the
  // Q_OFFERS_CONSTRUCTION_SERVICES question trigger).
  // Deliberately excluded per the RULE_0664 lesson: RULE_0123
  // (BT_GENERAL_CONTRACTOR, heuristic, missing_fact_keys=
  // [residential_work]) — verify_existing on it would promote
  // needs_more_information to REQUIRED for new general contractors.
  // (An earlier draft of this test also excluded DOC_HAZMAT_HANDLER as
  // "conditional by design"; the 2026-09-18 live production audit proved the
  // environmental families fire REQUIRED-as-new for existing plants once the
  // industrial_port flag is confirmed, so they are swept in CASE T instead —
  // with the asserted-basis gate keeping unconfirmed flags conditional.)
  const DOC_CHILDCARE = docByName("childcare", "education license");
  const DOC_CONTRACTOR = docByName("contractor license");

  // Existing daycare verifies its childcare license.
  const daycare = classify(
    {
      municipalityName: "Mayagüez",
      businessTypeName: "Daycare",
      businessStatus: "existing",
      answers: { Q_PHYSICAL_LOCATION: true, Q_EMPLOYEES_HIRED: true },
      projectFacts: { property_tenure: "leased" },
    },
    "existing"
  ).classified;
  assert.equal(
    byId(daycare, DOC_CHILDCARE)?.applicability,
    "verify_existing",
    "an operating daycare verifies its existing childcare license (not REQUIRED-as-new)"
  );

  // The sweep generalizes across the whole document family (the 332b659
  // twin-pattern lesson): an operating tutoring center verifies too. This
  // changes posture only — RULE_0197's firing for tutoring centers (open
  // F11 Ley 173-2016 applicability review) is untouched.
  const tutoring = classify(
    {
      municipalityName: "Caguas",
      businessTypeName: "Tutoring Center",
      businessStatus: "existing",
      answers: { Q_PHYSICAL_LOCATION: true },
    },
    "existing"
  ).classified;
  assert.equal(
    byId(tutoring, DOC_CHILDCARE)?.applicability,
    "verify_existing",
    "an operating tutoring center verifies its existing childcare-license posture"
  );

  // Existing electrical contractor verifies its DACO contractor license.
  const contractor = classify(
    {
      municipalityName: "Caguas",
      businessTypeName: "Electrical Contractor",
      businessStatus: "existing",
      answers: {
        Q_PHYSICAL_LOCATION: true,
        Q_EMPLOYEES_HIRED: true,
        Q_OFFERS_CONSTRUCTION_SERVICES: true,
      },
      projectFacts: { property_tenure: "leased" },
    },
    "existing"
  ).classified;
  assert.equal(
    byId(contractor, DOC_CONTRACTOR)?.applicability,
    "verify_existing",
    "an operating electrical contractor verifies its existing DACO contractor license (not REQUIRED-as-new)"
  );

  // The RULE_0642 question-trigger path is covered too: an operating
  // non-contractor business honestly answering that it offers construction
  // services verifies rather than applies as new.
  const handyman = classify(
    {
      municipalityName: "Bayamón",
      businessTypeName: "IT Consulting",
      businessStatus: "existing",
      answers: { Q_PHYSICAL_LOCATION: true, Q_OFFERS_CONSTRUCTION_SERVICES: true },
    },
    "existing"
  ).classified;
  assert.equal(
    byId(handyman, DOC_CONTRACTOR)?.applicability,
    "verify_existing",
    "RULE_0642 verify_existing posture holds for the question-trigger path"
  );

  // The heuristic general-contractor rule keeps its NMI honesty — never
  // promoted by this sweep.
  const gc = classify(
    {
      municipalityName: "Caguas",
      businessTypeName: "General Contractor",
      businessStatus: "existing",
      answers: { Q_PHYSICAL_LOCATION: true },
    },
    "existing"
  ).classified;
  assert.equal(
    byId(gc, DOC_CONTRACTOR)?.applicability,
    "needs_more_information",
    "RULE_0123 stays needs_more_information (heuristic, excluded from sweep)"
  );

  // New businesses still apply for the first time.
  const freshDaycare = classify(
    {
      municipalityName: "Mayagüez",
      businessTypeName: "Daycare",
      businessStatus: "new",
      answers: { Q_PHYSICAL_LOCATION: true },
    },
    "new"
  ).classified;
  assert.equal(
    byId(freshDaycare, DOC_CHILDCARE)?.applicability,
    "required",
    "a new daycare still gets the childcare license as REQUIRED"
  );
  const freshContractor = classify(
    {
      municipalityName: "Caguas",
      businessTypeName: "Electrical Contractor",
      businessStatus: "new",
      answers: { Q_PHYSICAL_LOCATION: true },
    },
    "new"
  ).classified;
  assert.equal(
    byId(freshContractor, DOC_CONTRACTOR)?.applicability,
    "required",
    "a new electrical contractor still gets the DACO contractor license as REQUIRED"
  );
});

test("CASE T: industrial-port environmental posture — confirmed flag verifies for existing plants; unconfirmed flags stay conditional", () => {
  // 2026-09-18 09:00 QA cycle, live production audit: a 12-year Ponce
  // chemical manufacturer (S36) was shown the NPDES industrial-discharge
  // permit, the RCRA hazardous-waste handler ID, and the Title V air-emission
  // permit as REQUIRED once the industrial_port municipality flag was
  // confirmed — as if the operating plant were applying for the first time.
  // Local evaluation had rendered them conditional only because the flag was
  // unconfirmed in the harness; production is the tiebreaker. Same defect
  // class as the earlier sweeps: these are operating obligations — an
  // operating plant verifies what it holds. Swept
  // compliance_mode=verify_existing onto the 21 non-heuristic
  // municipality_flag rules with no missing_fact_keys:
  // DOC_NPDES_INDUSTRIAL (RULE_0559 chemical, 0562 pharmaceutical, 0565
  // food, 0568 beverage, 0571 textile, 0574 furniture, 0576 medical-device
  // manufacturing), DOC_HAZMAT_HANDLER (RULE_0560, 0563, 0566, 0569, 0572,
  // 0575, 0577, plus 0585 wholesale distributor and 0586 body shop),
  // DOC_AIR_EMISSION_PERMIT (RULE_0561, 0564, 0567, 0570, 0573).
  //
  // Paired with the sweep, requirementApplicability.ts now applies posture
  // mapping only to an ASSERTED basis (required / likely_required). A
  // conditional winning basis — an unconfirmed municipality flag — stays
  // conditional for both existing and new businesses, so the sweep cannot
  // assert applicability the engine deliberately left undecided (and cannot
  // flip needs_more_information either).
  const DOC_NPDES = "DOC_NPDES_INDUSTRIAL";
  const DOC_HAZMAT = "DOC_HAZMAT_HANDLER";
  const DOC_AIR = "DOC_AIR_EMISSION_PERMIT";
  const input = {
    municipalityName: "Ponce",
    businessTypeName: "Chemical Manufacturing",
    businessStatus: "existing" as const,
    answers: { Q_PHYSICAL_LOCATION: true, Q_EMPLOYEES_HIRED: true },
  };

  // Flag confirmed (the live S36 state): an operating plant verifies.
  const confirmed = classifyWithDecisions(input, "existing", {
    industrial_port: "applies",
  }).classified;
  for (const [id, label] of [
    [DOC_NPDES, "NPDES industrial-discharge permit"],
    [DOC_HAZMAT, "RCRA hazardous-waste handler ID"],
    [DOC_AIR, "Title V air-emission permit"],
  ] as const) {
    assert.equal(
      byId(confirmed, id)?.applicability,
      "verify_existing",
      `an operating Ponce chemical plant verifies its ${label} (not REQUIRED-as-new)`
    );
  }

  // Flag unconfirmed (the local S36 harness state): honesty preserved —
  // the engine does not assert applicability it has not established.
  const unconfirmed = classify(input, "existing").classified;
  for (const [id, label] of [
    [DOC_NPDES, "NPDES industrial-discharge permit"],
    [DOC_HAZMAT, "RCRA hazardous-waste handler ID"],
    [DOC_AIR, "Title V air-emission permit"],
  ] as const) {
    assert.equal(
      byId(unconfirmed, id)?.applicability,
      "conditional",
      `an unconfirmed industrial_port flag keeps the ${label} conditional`
    );
  }

  // New plant, flag confirmed: still applies for the first time.
  const freshConfirmed = classifyWithDecisions(
    { ...input, businessStatus: "new" },
    "new",
    { industrial_port: "applies" }
  ).classified;
  assert.equal(
    byId(freshConfirmed, DOC_HAZMAT)?.applicability,
    "required",
    "a new chemical plant with a confirmed flag still gets the handler ID as REQUIRED"
  );

  // New plant, flag unconfirmed: stays conditional (the sweep must not turn
  // an undecided flag into a REQUIRED filing obligation).
  const freshUnconfirmed = classify(
    { ...input, businessStatus: "new" },
    "new"
  ).classified;
  assert.equal(
    byId(freshUnconfirmed, DOC_HAZMAT)?.applicability,
    "conditional",
    "an unconfirmed flag stays conditional for new businesses too"
  );
});

test("CASE U: transport / bona-fide-farmer / insurance / SAM.gov posture — existing businesses verify, new businesses file", () => {
  // 2026-09-18 12:00 QA cycle (S37/S38/S39): the last unswept
  // operating-obligation families rendered REQUIRED-as-new (or a vague
  // "recommended") for long-operating businesses — the same defect class as
  // the health/fire/CFPM/tourism/vehicle/contractor/childcare/alcohol sweeps.
  // Swept compliance_mode=verify_existing onto the non-heuristic rules with
  // no missing_fact_keys:
  //  - DOC_TRANSPORT_PERMIT: RULE_0177 (trucking), 0179 (courier), 0181
  //    (moving), 0183 (taxi), 0189 (freight forwarding), 0268 (logistics +
  //    island flag), 0518 (car rental + island flag), 0618 (Q_HAZMAT_TRANSPORT).
  //    Deliberately excluded the heuristic rules with missing_fact_keys
  //    (RULE_0022 transport_type, RULE_0185/0187 commercial_vehicles) per the
  //    RULE_0664 lesson.
  //  - DOC_AGRICULTURE_REGISTRATION: RULE_0218 (farm), 0219 (livestock), 0220
  //    (aquaculture), 0221 (nursery), 0222 (ag services), 0223 (coffee).
  //    Deliberately excluded RULE_0041 (verified + is_conditional=true by
  //    validated-review design — a qualification program, not a blanket permit).
  //  - DOC_INSURANCE: RULE_0249/0251/0252/0253/0254 (government-contractor
  //    business types; private instrument, evidence of coverage).
  //  - DOC_SAM_REGISTRATION: RULE_0637/0638/0639/0640 (gov-contractor BTs),
  //    0641 (Q_FEDERAL_CONTRACTS_GRANTS). SAM.gov registration renews every
  //    365 days — an existing contractor verifies, never re-registers as new.

  // S37: 10-year Bayamón trucking company — transport permit verifies.
  const trucking = classify(
    {
      municipalityName: "Bayamón",
      businessTypeName: "Trucking Company",
      businessStatus: "existing",
      answers: { Q_EMPLOYEES_HIRED: true, Q_COMMERCIAL_VEHICLES: true },
    },
    "existing"
  ).classified;
  assert.equal(
    byId(trucking, DOC_TRANSPORT)?.applicability,
    "verify_existing",
    "a 10-year trucking company verifies its NTSP transport permit (not REQUIRED-as-new)"
  );
  // A new trucking company still applies for the first time.
  const truckingNew = classify(
    {
      municipalityName: "Bayamón",
      businessTypeName: "Trucking Company",
      businessStatus: "new",
      answers: { Q_EMPLOYEES_HIRED: true, Q_COMMERCIAL_VEHICLES: true },
    },
    "new"
  ).classified;
  assert.equal(
    byId(truckingNew, DOC_TRANSPORT)?.applicability,
    "required",
    "a new trucking company still gets the transport permit as REQUIRED"
  );
  // The heuristic RULE_0022 (Q_COMMERCIAL_VEHICLES, missing transport_type)
  // also fires but must not drag the asserted business-type basis down to
  // needs_more_information — the verify_existing assertion above pins that
  // the asserted RULE_0177 basis wins. Hazmat: RULE_0618 needs an explicit
  // Q_HAZMAT_TRANSPORT=true and must stay silent on unstated facts.

  // S38: 20-year Arecibo coffee farm — bona fide farmer registration verifies.
  // The Bona Fide certification is valid 4 years: verify-existing is exactly
  // the right semantics for an operating farm.
  const farm = classify(
    {
      municipalityName: "Arecibo",
      businessTypeName: "Coffee Plantation",
      businessStatus: "existing",
      answers: {},
    },
    "existing"
  ).classified;
  assert.equal(
    byId(farm, DOC_BONAFIDE)?.applicability,
    "verify_existing",
    "a 20-year coffee farm verifies its Bona Fide Farmer Registration (not REQUIRED-as-new)"
  );
  assert.equal(
    byId(farm, DOC_BONAFIDE)?.source_rule_id,
    "RULE_0223",
    "the bona fide registration fires via the coffee-plantation rule, not the unanswered agriculture-production question (RULE_0041 stays conditional by design)"
  );
  const farmNew = classify(
    {
      municipalityName: "Arecibo",
      businessTypeName: "Coffee Plantation",
      businessStatus: "new",
      answers: {},
    },
    "new"
  ).classified;
  assert.equal(
    byId(farmNew, DOC_BONAFIDE)?.applicability,
    "required",
    "a new coffee farm still gets the bona fide registration as REQUIRED"
  );

  // S39: 8-year Trujillo Alto IT government contractor with active federal
  // contracts — SAM.gov and insurance verify; nothing re-registers as new.
  // NOTE: the production path marks DOC_INSURANCE "recommended" via the
  // jurisdiction docMappings; the raw harness KB lacks that mapping, so this
  // case forwards it explicitly to mirror production.
  const classifyRec = (
    input: EngineInput,
    businessStatus: "new" | "existing"
  ) => {
    const { requirements } = runRulesEngine(KB, input);
    return classifyEngineRequirements(requirements, {
      kb: KB,
      businessStatus,
      recommendedIds: new Set([DOC_GLI]),
    });
  };
  const contractor = classifyRec(
    {
      municipalityName: "Trujillo Alto",
      businessTypeName: "IT Government Contractor",
      businessStatus: "existing",
      answers: { Q_EMPLOYEES_HIRED: true, Q_FEDERAL_CONTRACTS_GRANTS: true },
    },
    "existing"
  );
  assert.equal(
    byId(contractor, DOC_SAM)?.applicability,
    "verify_existing",
    "an 8-year federal contractor verifies its SAM.gov registration (annual renewal — not REQUIRED-as-new)"
  );
  assert.equal(
    byId(contractor, DOC_GLI)?.applicability,
    "verify_existing",
    "an operating federal contractor verifies its liability coverage is current (not a vague 'recommended' to obtain insurance)"
  );
  const contractorNew = classifyRec(
    {
      municipalityName: "Trujillo Alto",
      businessTypeName: "IT Government Contractor",
      businessStatus: "new",
      answers: { Q_EMPLOYEES_HIRED: true, Q_FEDERAL_CONTRACTS_GRANTS: true },
    },
    "new"
  );
  assert.equal(
    byId(contractorNew, DOC_SAM)?.applicability,
    "required",
    "a new federal contractor still gets SAM.gov registration as REQUIRED"
  );
  assert.equal(
    byId(contractorNew, DOC_GLI)?.applicability,
    "recommended",
    "a new federal contractor keeps the insurance posture the KB assigns (recommended — unchanged by the sweep)"
  );
  // Contractor must not be confused with construction: no DACO license without
  // the construction-services fact.
  assert.equal(
    byId(contractor, DOC_CONTRACTOR),
    undefined,
    "an IT government contractor gets no DACO contractor license (contractor != construction)"
  );
});

test("CASE V: LUMA interconnection + net metering posture — existing customer-generators verify, new projects file", () => {
  // 2026-09-18 15:00 QA cycle (S40): a 7-year Dorado warehouse with a
  // 5-year-old rooftop solar array (self-consumption + net metering) got
  // LUMA interconnection and the net metering agreement as REQUIRED-as-new —
  // the same defect class as the health/fire/CFPM/tourism/vehicle/
  // contractor/childcare/alcohol/transport/agriculture/insurance sweeps.
  // Swept compliance_mode=verify_existing onto the document families:
  //  - DOC_LUMA_INTERCONNECTION: RULE_0610 (Q_RENEWABLE_INSTALL).
  //  - DOC_NET_METERING_AGREEMENT: RULE_0611 (Q_RENEWABLE_INSTALL).
  // All swept rules have no missing_fact_keys (RULE_0664 lesson) and statute
  // -confidence citations.
  // CORRECTION 2026-09-21 06:00 (REG-LUMA-INSTALLER-001): the installer-BT
  // rules (RULE_0603/0604/0606/0607/0608/0609) were REMOVED. The LUMA
  // interconnection registration and the net-metering agreement are
  // generator/customer instruments (Law 114-2007 Art. 9;
  // CEPR-MI-2014-0001; the KB's own guidance concepts are
  // Q_RENEWABLE_INSTALL-conditioned and written for the system owner) — a
  // solar/battery installer company does not hold them for its own
  // business; its proper instrument is the OPPE installer registration
  // (RULE_0605, untouched). The 2026-09-18 "installer interconnection
  // obligations are per-project/recurring" rationale was wrong — the
  // per-project obligation the installer carries is the OPPE registration,
  // and the owner-side rules (0610/0611) cover genuine generators.

  // S40: existing Dorado warehouse distributor, 5-year-old solar array.
  const warehouse = classify(
    {
      municipalityName: "Dorado",
      businessTypeName: "Warehouse Distributor",
      businessStatus: "existing",
      answers: { Q_RENEWABLE_INSTALL: true },
    },
    "existing"
  ).classified;
  assert.equal(
    byId(warehouse, DOC_LUMA)?.applicability,
    "verify_existing",
    "an existing warehouse with a 5-year-old solar array verifies its LUMA interconnection (not REQUIRED-as-new)"
  );
  assert.equal(
    byId(warehouse, DOC_NETMETER)?.applicability,
    "verify_existing",
    "an existing warehouse with a 5-year-old solar array verifies its net metering agreement (not REQUIRED-as-new)"
  );

  // A new warehouse with a NEW solar project still files for the first time.
  const warehouseNew = classify(
    {
      municipalityName: "Dorado",
      businessTypeName: "Warehouse Distributor",
      businessStatus: "new",
      answers: { Q_RENEWABLE_INSTALL: true },
    },
    "new"
  ).classified;
  assert.equal(
    byId(warehouseNew, DOC_LUMA)?.applicability,
    "required",
    "a new warehouse with a new solar project still gets LUMA interconnection as REQUIRED"
  );
  assert.equal(
    byId(warehouseNew, DOC_NETMETER)?.applicability,
    "required",
    "a new warehouse with a new solar project still gets the net metering agreement as REQUIRED"
  );

  // Installer business types no longer receive generator instruments: the
  // interconnection registration and net-metering agreement belong to the
  // distributed generator (customer), never to the installer company itself
  // (REG-LUMA-INSTALLER-001). An installer keeps the OPPE installer
  // registration (RULE_0605) and the DACO contractor license where earned.
  const installer = classify(
    {
      municipalityName: "San Juan",
      businessTypeName: "Solar Installer",
      businessStatus: "existing",
      answers: {},
    },
    "existing"
  ).classified;
  assert.equal(
    byId(installer, DOC_LUMA),
    undefined,
    "an existing solar installer gets NO LUMA interconnection card — the registration belongs to the generator, not the installer"
  );
  assert.equal(
    byId(installer, DOC_NETMETER),
    undefined,
    "an existing solar installer gets NO net metering card — the agreement belongs to the generator, not the installer"
  );
  assert.equal(
    byId(installer, docByName("contractor license"))?.applicability,
    "verify_existing",
    "the installer still verifies its DACO contractor license (RULE_0230 untouched)"
  );
});

test("CASE W: bundled-flow writeKey answers reach the engine (REG-WIRE-001)", () => {
  // 2026-09-18 15:00 QA cycle: three KB questions had a questionKeyMap
  // writeKey — so the bundled flow records answers under it — but no
  // buildEngineInput mapping, so the answers never reached the engine and
  // their question_trigger rules could never fire:
  //  - Q_GUESTS_OVERNIGHT (guests_stay_overnight) -> RULE_0691 room tax
  //  - Q_HAZMAT_TRANSPORT (hazardous_materials_transported) -> RULE_0618 transport permit
  //  - Q_FOOD_TRUCK_MOBILE (food_truck_or_mobile) -> RULE_0653 ambulant license
  // The mappings now follow the same on(writeKey) pattern as every other
  // question in the answers map.
  const input = buildEngineInput(
    { municipality: "Trujillo Alto", business_type: "Guest House" } as any,
    { guests_stay_overnight: true, hazardous_materials_transported: true, food_truck_or_mobile: true },
    {}
  );
  assert.equal(input.answers["Q_GUESTS_OVERNIGHT"], true, "guests_stay_overnight reaches Q_GUESTS_OVERNIGHT");
  assert.equal(input.answers["Q_HAZMAT_TRANSPORT"], true, "hazardous_materials_transported reaches Q_HAZMAT_TRANSPORT");
  assert.equal(input.answers["Q_FOOD_TRUCK_MOBILE"], true, "food_truck_or_mobile reaches Q_FOOD_TRUCK_MOBILE");
  const { requirements } = runRulesEngine(KB, input);
  const ids = new Set(requirements.map((r) => r.document_id));
  assert.ok(ids.has(docByName("room tax", "return")), "RULE_0691 fires the room-tax return from a guests-overnight answer");
  assert.ok(ids.has(docByName("transportation", "permit")), "RULE_0618 fires the transport permit from a hazmat-transport answer");
  assert.ok(ids.has(docByName("ambulant-business")), "RULE_0653 fires the ambulant license from a food-truck answer");
});

test("CASE X: OPPE installer registration posture — existing installers verify, new installers file", () => {
  // 2026-09-18 18:00 QA cycle (S43): an existing 6-year Toa Alta solar
  // installer got DOC_OPPE_INSTALLER_REG (PPPE-DDEC renewable-installer
  // certification, Ley 17-2019) as REQUIRED-as-new — the same defect class
  // as the health/fire/CFPM/tourism/vehicle/contractor/childcare/alcohol/
  // transport/agriculture/insurance/LUMA/net-metering sweeps. RULE_0605 was
  // the one sibling the 15:00 sweep missed: it points at
  // DOC_OPPE_INSTALLER_REG rather than DOC_LUMA_INTERCONNECTION /
  // DOC_NET_METERING_AGREEMENT, so the family sweep skipped it. It is the
  // sole rule for the document, carries no missing_fact_keys (RULE_0664
  // lesson), and its citation is statute-confidence (official PPPE
  // docs.pr.gov certification form).
  const DOC_OPPE = docByName("installer registration");

  // Existing installer verifies its standing certification.
  const installer = classify(
    {
      municipalityName: "Toa Alta",
      businessTypeName: "Solar Installer",
      businessStatus: "existing",
      answers: { Q_EMPLOYEES_HIRED: true },
    },
    "existing"
  ).classified;
  assert.equal(
    byId(installer, DOC_OPPE)?.applicability,
    "verify_existing",
    "an existing solar installer verifies its PPPE installer certification (not REQUIRED-as-new)"
  );

  // A new installer still applies for the first time.
  const installerNew = classify(
    {
      municipalityName: "Toa Alta",
      businessTypeName: "Solar Installer",
      businessStatus: "new",
      answers: { Q_EMPLOYEES_HIRED: true },
    },
    "new"
  ).classified;
  assert.equal(
    byId(installerNew, DOC_OPPE)?.applicability,
    "required",
    "a new solar installer still gets the PPPE installer certification as REQUIRED"
  );
});

test("CASE Y: DOC_ENTERTAINMENT_PERMIT is verify_existing for existing entertainment businesses, required for new ones", () => {
  // 2026-09-19 00:00 QA cycle (S51): an existing 6-year Toa Baja event
  // venue got DOC_ENTERTAINMENT_PERMIT (RULE_0246) as REQUIRED-as-new —
  // the same defect class as the health/fire/CFPM/tourism/vehicle/
  // contractor/childcare/alcohol/transport/agriculture/insurance/LUMA/
  // net-metering/OPPE sweeps. Whole family swept per the 332b659 lesson:
  // RULE_0245 (music venue), RULE_0246 (event venue), RULE_0247 (theater).
  // None carries missing_fact_keys (RULE_0664 lesson) or a citation, and
  // the posture fix is citation-independent. RULE_0032 deliberately
  // excluded — heuristic + missing_fact_keys=[entertainment_details].
  const DOC_ENT = docByName("entertainment permit");

  for (const businessTypeName of ["Music Venue", "Event Venue", "Theater"]) {
    // Existing entertainment businesses verify their standing authorization.
    const existing = classify(
      {
        municipalityName: "Toa Baja",
        businessTypeName,
        businessStatus: "existing",
        answers: { Q_EMPLOYEES_HIRED: true },
      },
      "existing"
    ).classified;
    assert.equal(
      byId(existing, DOC_ENT)?.applicability,
      "verify_existing",
      `an existing ${businessTypeName.toLowerCase()} verifies its entertainment permit (not REQUIRED-as-new)`
    );

    // New entertainment businesses still apply for the first time.
    const fresh = classify(
      {
        municipalityName: "Toa Baja",
        businessTypeName,
        businessStatus: "new",
        answers: { Q_EMPLOYEES_HIRED: true },
      },
      "new"
    ).classified;
    assert.equal(
      byId(fresh, DOC_ENT)?.applicability,
      "required",
      `a new ${businessTypeName.toLowerCase()} still gets the entertainment permit as REQUIRED`
    );
  }
});

test("CASE Z: DOC_PORT_FACILITY_PERMIT is verify_existing for existing port-area operators, required for new ones", () => {
  // 2026-09-19 03:00 QA cycle (S53): a 12-year Ponce trucking company with
  // the industrial_port flag confirmed got DOC_PORT_FACILITY_PERMIT
  // (RULE_0578) as REQUIRED-as-new — the same defect class as the 14 prior
  // posture sweeps (health, fire/CFPM, tourism, vehicle, contractor,
  // childcare, alcohol, transport/agriculture/insurance, LUMA,
  // net-metering, OPPE, entertainment, plus the industrial-port
  // environmental families of CASE T). Whole family swept per the 332b659
  // lesson: RULE_0578 (trucking), 0579 (freight forwarding), 0580
  // (warehouse operator), 0581 (logistics), 0582 (import/export), 0583
  // (wholesale goods distributor), 0584 (wholesale food distributor). All
  // seven are non-heuristic with no missing_fact_keys (RULE_0664 lesson).
  // The classifier's assert-basis gate (CASE T) keeps unconfirmed flags
  // conditional for both intents — the sweep cannot assert applicability
  // the engine left undecided.
  const DOC_PORT = docByName("port facility");
  assert.equal(DOC_PORT, "DOC_PORT_FACILITY_PERMIT");

  for (const businessTypeName of ["Trucking Company", "Freight Forwarding Company"]) {
    // Existing port-area operator verifies its standing authorization.
    const existing = classifyWithDecisions(
      {
        municipalityName: "Ponce",
        businessTypeName,
        businessStatus: "existing",
        answers: { Q_EMPLOYEES_HIRED: true },
      },
      "existing",
      { industrial_port: "applies" }
    ).classified;
    assert.equal(
      byId(existing, DOC_PORT)?.applicability,
      "verify_existing",
      `an existing ${businessTypeName.toLowerCase()} with a confirmed port flag verifies its port facility permit (not REQUIRED-as-new)`
    );

    // Unconfirmed flag stays conditional — the engine does not assert.
    const unconfirmed = classify(
      {
        municipalityName: "Ponce",
        businessTypeName,
        businessStatus: "existing",
        answers: { Q_EMPLOYEES_HIRED: true },
      },
      "existing"
    ).classified;
    assert.equal(
      byId(unconfirmed, DOC_PORT)?.applicability,
      "conditional",
      `an unconfirmed industrial_port flag keeps the port facility permit conditional`
    );

    // New port-area operator still applies for the first time.
    const fresh = classifyWithDecisions(
      {
        municipalityName: "Ponce",
        businessTypeName,
        businessStatus: "new",
        answers: { Q_EMPLOYEES_HIRED: true },
      },
      "new",
      { industrial_port: "applies" }
    ).classified;
    assert.equal(
      byId(fresh, DOC_PORT)?.applicability,
      "required",
      `a new ${businessTypeName.toLowerCase()} with a confirmed port flag still gets the port facility permit as REQUIRED`
    );
  }
});

test("CASE AA: DOC_PROFESSIONAL_LICENSE is needs_more_information for generic consulting firms, not REQUIRED", () => {
  // 2026-09-19 06:00 QA cycle (S57, Caguas): a new home-based consulting
  // company was shown Professional License as REQUIRED. Generic
  // consulting (management/strategy/IT/marketing) is not a licensed
  // profession in Puerto Rico — only specific licensed activities are
  // (engineers, architects, CPAs, lawyers...). The validated review had
  // already set the identical precedent for BT_ACCOUNTING_FIRM (RULE_0227,
  // golden G04): consulting is heuristic +
  // missing_fact_keys=[licensed_profession_type] so the card asks what
  // licensed activity, if any, the firm performs. Per the RULE_0664
  // lesson, heuristic+NMI rules carry no compliance_mode — the classifier
  // previously promoted verify_existing to REQUIRED for new businesses.
  // Unchanged (verified, golden-pinned or licensed professions):
  // RULE_0114 (law, G19), RULE_0115 (CPA), RULE_0118 (engineering),
  // RULE_0119 (architecture). Translation (RULE_0121) and staffing
  // (RULE_0122) are flagged for regulatory review, not changed.
  const DOC_PROFLIC = docByName("professional license");

  for (const businessStatus of ["new", "existing"] as const) {
    const consulting = classify(
      {
        municipalityName: "Caguas",
        businessTypeName: "Consulting Firm",
        businessStatus,
        answers: {
          Q_HOME_BASED: true,
          Q_PHYSICAL_LOCATION: false,
          Q_EMPLOYEES_HIRED: false,
        },
        projectFacts: { property_tenure: "unknown" },
      },
      businessStatus
    ).classified;
    const lic = byId(consulting, DOC_PROFLIC);
    assert.ok(lic, `professional license row must exist for the consulting firm (${businessStatus})`);
    assert.equal(
      lic.applicability,
      "needs_more_information",
      `a ${businessStatus} consulting firm's professional license stays needs_more_information (RULE_0116 heuristic) — never promoted to REQUIRED`
    );
    assert.ok(
      (lic.missingFacts ?? []).includes("licensed_profession_type"),
      "the controlling unanswered fact must be named"
    );
  }

  // Controls: genuinely licensed professions still hold.
  const lawFirm = classify(
    {
      municipalityName: "Carolina",
      businessTypeName: "Law Firm",
      businessStatus: "new",
      answers: { Q_EMPLOYEES_HIRED: true, Q_PHYSICAL_LOCATION: true },
      projectFacts: { property_tenure: "leased" },
    },
    "new"
  ).classified;
  assert.equal(
    byId(lawFirm, DOC_PROFLIC)?.applicability,
    "required",
    "a new law firm still gets the professional license as REQUIRED (RULE_0114 verified, golden G19)"
  );

  const cpaFirm = classify(
    {
      municipalityName: "San Juan",
      businessTypeName: "CPA Firm",
      businessStatus: "existing",
      answers: { Q_EMPLOYEES_HIRED: true, Q_PHYSICAL_LOCATION: true },
      projectFacts: { property_tenure: "leased" },
    },
    "existing"
  ).classified;
  assert.equal(
    byId(cpaFirm, DOC_PROFLIC)?.applicability,
    "verify_existing",
    "an existing CPA firm verifies its professional license (RULE_0115 verified)"
  );

  const engineer = classify(
    {
      municipalityName: "Ponce",
      businessTypeName: "Engineering Firm",
      businessStatus: "new",
      answers: { Q_EMPLOYEES_HIRED: true, Q_PHYSICAL_LOCATION: true },
      projectFacts: { property_tenure: "leased" },
    },
    "new"
  ).classified;
  assert.equal(
    byId(engineer, DOC_PROFLIC)?.applicability,
    "required",
    "a new engineering firm still gets the professional license as REQUIRED (RULE_0118 verified)"
  );
});

test("CASE AB: DOC_PROFESSIONAL_LICENSE is needs_more_information for translation, staffing, and financial-sector BTs, not REQUIRED", () => {
  // 2026-09-19 09:00 QA cycle (S58/S59/S60, Cataño/Trujillo Alto/Ponce):
  // authoritative-source review closed the 06:00 cycle's open review items.
  // RULE_0121 (translation) — the traductor-jurado credential is a Tribunal
  // Supremo court credential for sworn translators, not a Dept of State
  // professional license for translation businesses. RULE_0122 (staffing) —
  // private employment agencies are licensed by the Secretario del Trabajo y
  // Recursos Humanos under Ley 417-1947, not the professional-license
  // boards. RULE_0225 (mortgage broker) — licensed by OCS/OCIF under the
  // Mortgage Institutions Act (Act 24-2010), NMLS registration. RULE_0226
  // (financial advisory) — investment advisers register with the OCS/OCIF
  // under the Uniform Securities Law of PR (Form ADV, Series 65/66).
  // RULE_0228 (investment firm) — investment companies register with the
  // OCS/OCIF under the PR Investment Company Act (10 L.P.R.A. 671).
  // RULE_0229 (credit services) — licensed under the Ley de Agencias
  // Rectificadoras de Crédito (PR Laws Tit. 7, Cap. 64A) through DACO.
  // All 6 rules are heuristic + missing_fact_keys=[licensed_profession_type]
  // (the RULE_0116/RULE_0227 demotion precedent; golden G04) with no
  // compliance_mode (RULE_0664 lesson). DOC_PROFESSIONAL_LICENSE is not the
  // right document class for these BTs and no OCS/DTRH/DACO document exists
  // in the KB yet (follow-up). No golden pins any of these rules.
  // Deliberately unchanged: law (RULE_0114), CPA (RULE_0115), engineering
  // (RULE_0118), architecture (RULE_0119), notary (RULE_0120) — genuinely
  // board-licensed professions.
  const DOC_PROFLIC = docByName("professional license");

  const btCases: Array<[string, string]> = [
    ["Translation Services", "Cataño"],
    ["Staffing Agency", "Trujillo Alto"],
    ["Mortgage Broker", "San Juan"],
    ["Financial Advisory Firm", "Ponce"],
    ["Investment Firm", "Guaynabo"],
    ["Credit Services Company", "Bayamón"],
  ];

  for (const [businessTypeName, municipalityName] of btCases) {
    for (const businessStatus of ["new", "existing"] as const) {
      const rows = classify(
        {
          municipalityName,
          businessTypeName,
          businessStatus,
          answers: {
            Q_EMPLOYEES_HIRED: businessTypeName !== "Financial Advisory Firm",
            Q_HOME_BASED: businessTypeName === "Financial Advisory Firm",
            Q_PHYSICAL_LOCATION: businessTypeName !== "Financial Advisory Firm",
          },
          projectFacts: { property_tenure: "leased" },
        },
        businessStatus
      ).classified;
      const lic = byId(rows, DOC_PROFLIC);
      assert.ok(
        lic,
        `professional license row must exist for ${businessTypeName} (${businessStatus})`
      );
      assert.equal(
        lic.applicability,
        "needs_more_information",
        `a ${businessStatus} ${businessTypeName} firm's professional license stays needs_more_information (heuristic rule) — never REQUIRED/verify_existing`
      );
      assert.ok(
        (lic.missingFacts ?? []).includes("licensed_profession_type"),
        "the controlling unanswered fact must be named"
      );
    }
  }

  // Controls: genuinely licensed professions still hold.
  const lawFirm = classify(
    {
      municipalityName: "Carolina",
      businessTypeName: "Law Firm",
      businessStatus: "new",
      answers: { Q_EMPLOYEES_HIRED: true, Q_PHYSICAL_LOCATION: true },
      projectFacts: { property_tenure: "leased" },
    },
    "new"
  ).classified;
  assert.equal(
    byId(lawFirm, DOC_PROFLIC)?.applicability,
    "required",
    "a new law firm still gets the professional license as REQUIRED (RULE_0114 verified, golden G19)"
  );

  const architect = classify(
    {
      municipalityName: "Mayagüez",
      businessTypeName: "Architecture Firm",
      businessStatus: "existing",
      answers: { Q_EMPLOYEES_HIRED: true, Q_PHYSICAL_LOCATION: true },
      projectFacts: { property_tenure: "leased" },
    },
    "existing"
  ).classified;
  assert.equal(
    byId(architect, DOC_PROFLIC)?.applicability,
    "verify_existing",
    "an existing architecture firm verifies its professional license (RULE_0119 verified)"
  );
});

test("CASE AC: DOC_PROFESSIONAL_LICENSE is needs_more_information for real-estate developer and investment firms, REQUIRED for brokerages", () => {
  // 2026-09-19 12:00 QA cycle (S63, Toa Baja): authoritative-source review of
  // the real-estate professional-license family. Ley 10-1994 Art 2(g)
  // (20 L.P.R.A. 3025) expressly excludes from the corredor profession any
  // transaction where the person is the property owner acting for their own
  // benefit rather than as intermediary between two clients. So:
  // - RULE_0211 (developer) and RULE_0213 (investment firm): heuristic +
  //   missing_fact_keys=[licensed_profession_type], no compliance_mode
  //   (the 594af48 demotion precedent; golden G04; RULE_0664 lesson).
  // - RULE_0209 (brokerage): STAYS verified — brokers act as intermediaries
  //   for others and genuinely need the Junta de Corredores license
  //   (Ley 10-1994 Art 10/11/12; Junta adscrita al Departamento de Estado).
  // No golden pins any of these rules (checked before editing).
  const DOC_PROFLIC = docByName("professional license");

  const nmiCases: Array<[string, string]> = [
    ["Real Estate Developer", "Toa Baja"],
    ["Real Estate Investment Firm", "Toa Baja"],
  ];

  for (const [businessTypeName, municipalityName] of nmiCases) {
    for (const businessStatus of ["new", "existing"] as const) {
      const rows = classify(
        {
          municipalityName,
          businessTypeName,
          businessStatus,
          answers: {
            Q_EMPLOYEES_HIRED: false,
            Q_PHYSICAL_LOCATION: true,
          },
          projectFacts: { property_tenure: "leased" },
        },
        businessStatus
      ).classified;
      const lic = byId(rows, DOC_PROFLIC);
      assert.ok(
        lic,
        `professional license row must exist for ${businessTypeName} (${businessStatus})`
      );
      assert.equal(
        lic.applicability,
        "needs_more_information",
        `a ${businessStatus} ${businessTypeName} stays needs_more_information (heuristic rule) — never REQUIRED/verify_existing`
      );
      assert.ok(
        (lic.missingFacts ?? []).includes("licensed_profession_type"),
        "the controlling unanswered fact must be named"
      );
    }
  }

  // Controls: a brokerage (intermediary for others) genuinely needs the license.
  const brokerageNew = classify(
    {
      municipalityName: "Toa Baja",
      businessTypeName: "Real Estate Brokerage",
      businessStatus: "new",
      answers: { Q_EMPLOYEES_HIRED: false, Q_PHYSICAL_LOCATION: true },
      projectFacts: { property_tenure: "leased" },
    },
    "new"
  ).classified;
  assert.equal(
    byId(brokerageNew, DOC_PROFLIC)?.applicability,
    "required",
    "a new real-estate brokerage still gets the professional license as REQUIRED (RULE_0209 verified, Ley 10-1994)"
  );

  const brokerageExisting = classify(
    {
      municipalityName: "San Juan",
      businessTypeName: "Real Estate Brokerage",
      businessStatus: "existing",
      answers: { Q_EMPLOYEES_HIRED: true, Q_PHYSICAL_LOCATION: true },
      projectFacts: { property_tenure: "leased" },
    },
    "existing"
  ).classified;
  assert.equal(
    byId(brokerageExisting, DOC_PROFLIC)?.applicability,
    "verify_existing",
    "an existing brokerage verifies its professional license (RULE_0209 verified)"
  );
});

test("CASE AD: DOC_CONTRACTOR_LICENSE posture for landscaping and energy-consulting BTs — never REQUIRED on business type alone", () => {
  // 2026-09-19 12:00 QA cycle (S62, Bayamón): a home-based tree-care franchise
  // got the DACO contractor license (Ley 146-1995) as REQUIRED on business
  // type alone via RULE_0135. Primary-source review: Ley 146-1995 covers the
  // residential construction business (Ley 48-2017 exposicion: construccion
  // de viviendas, modificaciones, alteraciones, instalaciones y reparaciones
  // esenciales en edificaciones de vivienda). Validated golden G12 pins even
  // BT_GENERAL_CONTRACTOR at needs_more_information ("do not assume from
  // general contractor alone") — a landscaping company or energy consulting
  // firm is a weaker construction signal than a general contractor.
  // Deep-research batch 1 (2026-09-21) retargeted RULE_0232 (energy
  // consulting) from a business-type heuristic to a Q_OFFERS_CONSTRUCTION_
  // SERVICES question trigger — the research verdicts judged BT-alone
  // assertion an over-assertion. RULE_0135 (landscaping) kept its
  // business-type heuristic shape. The discovery intake asks
  // Q_OFFERS_CONSTRUCTION_SERVICES for both BTs, so there is no recall gap:
  // an unanswered or No answer means no contractor card for the consulting
  // firm; an honest Yes routes through the verified question path (RULE_0642)
  // while the heuristic sibling still names residential_work as the
  // controlling unanswered fact. Genuine construction trades (electrical
  // 0125, plumbing 0127, HVAC 0129, roofing 0131, concrete 0133, specialty
  // trade 0137, solar installer 0230, utility 0233, battery storage 0235,
  // construction govcon 0250) are unchanged.
  const DOC_CONTRACTOR = docByName("contractor license");

  // Landscaping: RULE_0135 is still a business-type heuristic — the card is
  // an honest evaluation naming residential_work, never REQUIRED.
  for (const businessStatus of ["new", "existing"] as const) {
    const rows = classify(
      {
        municipalityName: "Bayamón",
        businessTypeName: "Landscaping Company",
        businessStatus,
        answers: {
          Q_EMPLOYEES_HIRED: true,
          Q_PHYSICAL_LOCATION: true,
        },
        projectFacts: { property_tenure: "leased" },
      },
      businessStatus
    ).classified;
    const lic = byId(rows, DOC_CONTRACTOR);
    assert.ok(
      lic,
      `contractor license row must exist for Landscaping Company (${businessStatus})`
    );
    assert.equal(
      lic.applicability,
      "needs_more_information",
      `a ${businessStatus} landscaping company stays needs_more_information (heuristic rule) — never REQUIRED/verify_existing`
    );
    assert.ok(
      (lic.missingFacts ?? []).includes("residential_work"),
      "the controlling unanswered fact must be named"
    );
  }

  // Energy consulting: RULE_0232 is now a question trigger. No answer (or an
  // honest No) means no contractor card — the BT alone never asserts it.
  for (const businessStatus of ["new", "existing"] as const) {
    for (const answers of [
      { Q_EMPLOYEES_HIRED: true, Q_PHYSICAL_LOCATION: true },
      { Q_EMPLOYEES_HIRED: true, Q_PHYSICAL_LOCATION: true, Q_OFFERS_CONSTRUCTION_SERVICES: false },
    ]) {
      const rows = classify(
        {
          municipalityName: "Bayamón",
          businessTypeName: "Energy Consulting Firm",
          businessStatus,
          answers,
          projectFacts: { property_tenure: "leased" },
        },
        businessStatus
      ).classified;
      assert.equal(
        byId(rows, DOC_CONTRACTOR),
        undefined,
        `a ${businessStatus} energy consulting firm with no construction-services signal must not surface a contractor license card`
      );
    }
  }

  // An honest Yes routes through the verified question path (RULE_0642) —
  // required, with the heuristic sibling's residential_work still named as
  // the controlling unanswered fact (REG-PROVENANCE-WINNER-001).
  const yesRows = classify(
    {
      municipalityName: "Bayamón",
      businessTypeName: "Energy Consulting Firm",
      businessStatus: "new",
      answers: {
        Q_EMPLOYEES_HIRED: true,
        Q_PHYSICAL_LOCATION: true,
        Q_OFFERS_CONSTRUCTION_SERVICES: true,
      },
      projectFacts: { property_tenure: "leased" },
    },
    "new"
  ).classified;
  const yesLic = byId(yesRows, DOC_CONTRACTOR);
  assert.ok(yesLic, "an energy consulting firm answering Yes to construction services must surface the contractor license");
  assert.equal(
    yesLic.applicability,
    "required",
    "an honest Yes to construction services asserts the license via the verified question path"
  );
  assert.equal(
    yesLic.source_rule_id,
    "RULE_0642",
    "the card must cite the winning verified basis, not the heuristic sibling (REG-PROVENANCE-WINNER-001)"
  );
  assert.ok(
    (yesLic.missingFacts ?? []).includes("residential_work"),
    "the controlling unanswered fact must still be named"
  );

  // Controls: genuine construction trades still hold.
  const electrician = classify(
    {
      municipalityName: "Caguas",
      businessTypeName: "Electrical Contractor",
      businessStatus: "new",
      answers: { Q_EMPLOYEES_HIRED: true, Q_PHYSICAL_LOCATION: true },
      projectFacts: { property_tenure: "leased" },
    },
    "new"
  ).classified;
  assert.equal(
    byId(electrician, DOC_CONTRACTOR)?.applicability,
    "required",
    "a new electrical contractor still gets the DACO contractor license as REQUIRED (RULE_0125 verified)"
  );

  const generalContractor = classify(
    {
      municipalityName: "Toa Alta",
      businessTypeName: "General Contractor",
      businessStatus: "new",
      answers: { Q_EMPLOYEES_HIRED: true, Q_PHYSICAL_LOCATION: true },
      projectFacts: { property_tenure: "leased" },
    },
    "new"
  ).classified;
  assert.equal(
    byId(generalContractor, DOC_CONTRACTOR)?.applicability,
    "needs_more_information",
    "a new general contractor stays needs_more_information (RULE_0123 heuristic, validated golden G12)"
  );
});

test("CASE AE: DOC_PROFESSIONAL_LICENSE is needs_more_information for property management, not REQUIRED", () => {
  // 2026-09-19 15:00 QA cycle (S66, Carolina): a new facility-management
  // franchise (janitorial/maintenance coordination via crews and
  // subcontractors, explicitly NOT offering construction or brokerage
  // services) got Professional License as REQUIRED via RULE_0210
  // (BT_PROPERTY_MANAGEMENT_COMPANY) on the generic Juntas Examinadoras
  // citation. Primary-source review: Ley 10-1994 (20 L.P.R.A. 3035, Art. 12)
  // licenses Empresas de Bienes Raices whose personnel perform brokerage
  // functions; pure facility/janitorial management is not brokerage, and
  // Art. 2(g) exempts owner-acting transactions. Whether this BT engages in
  // licensed brokerage is an activity fact, not a BT-alone fact. RULE_0210
  // is heuristic + missing_fact_keys=[licensed_profession_type], no
  // compliance_mode (RULE_0664 lesson) — mirroring the 594af48 demotions
  // (translation/staffing/mortgage/financial-advisory/investment/credit)
  // and the 51805ec demotions (developer/investment firm).
  // Genuinely licensed paths (brokerage RULE_0209, appraisal RULE_0212,
  // insurance RULE_0224) are unchanged.
  const DOC_LICENSE = docByName("professional license");

  for (const businessStatus of ["new", "existing"] as const) {
    const rows = classify(
      {
        municipalityName: "Carolina",
        businessTypeName: "Property Management Company",
        businessStatus,
        answers: {
          Q_EMPLOYEES_HIRED: true,
          Q_PHYSICAL_LOCATION: true,
          Q_OFFERS_CONSTRUCTION_SERVICES: false,
        },
        projectFacts: { property_tenure: "leased" },
      },
      businessStatus
    ).classified;
    const lic = byId(rows, DOC_LICENSE);
    assert.ok(
      lic,
      `professional license row must exist for Property Management Company (${businessStatus})`
    );
    assert.equal(
      lic.applicability,
      "needs_more_information",
      `a ${businessStatus} property management company stays needs_more_information (heuristic RULE_0210) — never REQUIRED/verify_existing on BT alone`
    );
    assert.ok(
      (lic.missingFacts ?? []).includes("licensed_profession_type"),
      "the controlling unanswered fact must be named"
    );
  }

  // Control: genuine brokerage still holds the licensed path.
  const brokerage = classify(
    {
      municipalityName: "Carolina",
      businessTypeName: "Real Estate Brokerage",
      businessStatus: "new",
      answers: { Q_EMPLOYEES_HIRED: true, Q_PHYSICAL_LOCATION: true },
      projectFacts: { property_tenure: "leased" },
    },
    "new"
  ).classified;
  assert.equal(
    byId(brokerage, DOC_LICENSE)?.applicability,
    "required",
    "a new real estate brokerage still gets the professional license as REQUIRED (RULE_0209 verified, Ley 10-1994)"
  );
});

test("CASE AF: DOC_OWNER_AFFIDAVIT never fabricates a Lease fact for installers; verify_existing posture for existing businesses", () => {
  // 2026-09-19 18:00 QA cycle (live S69, Cataño): an existing 6-year solar
  // installer answered the forced Own/Lease binary on Q_SOLAR_OWNERSHIP with
  // "Lease" (its systems sit on CUSTOMER properties — neither option was
  // truthful) and RULE_0614 fired the Property Owner Authorization Affidavit
  // as REQUIRED-as-new. Same forced-fabrication class as the 09:00
  // Q_LICENSE_TYPES defect (dbe50f8). Fix: Q_SOLAR_OWNERSHIP gains a
  // "Customer / third-party property" option (RULE_0614 still fires only on
  // "Lease"), and RULE_0614 carries compliance_mode=verify_existing so
  // existing businesses verify a standing authorization instead of applying
  // as new (non-heuristic, no missing_fact_keys — the RULE_0664 lesson;
  // same posture-sweep class as the 09-18/09-19 series).
  const DOC_AFFIDAVIT = docByName("property owner", "affidavit");

  // 1. Installer answers the honest third option: no affidavit may fire.
  const third = classify(
    {
      municipalityName: "Cataño",
      businessTypeName: "Solar Installer",
      businessStatus: "existing",
      answers: {
        Q_EMPLOYEES_HIRED: true,
        Q_PHYSICAL_LOCATION: true,
        Q_SOLAR_OWNERSHIP: "Customer / third-party property",
      },
      projectFacts: { property_tenure: "leased" },
    },
    "existing"
  ).classified;
  assert.ok(
    !byId(third, DOC_AFFIDAVIT),
    "an installer whose systems are on customer properties must not get the owner-authorization affidavit"
  );

  // 2. Existing installer with a genuine leased-premises system: verify_existing.
  const existing = classify(
    {
      municipalityName: "Cataño",
      businessTypeName: "Solar Installer",
      businessStatus: "existing",
      answers: {
        Q_EMPLOYEES_HIRED: true,
        Q_PHYSICAL_LOCATION: true,
        Q_SOLAR_OWNERSHIP: "Lease",
      },
      projectFacts: { property_tenure: "leased" },
    },
    "existing"
  ).classified;
  assert.equal(
    byId(existing, DOC_AFFIDAVIT)?.applicability,
    "verify_existing",
    "an existing installer with solar on leased premises verifies the standing affidavit, not applies-as-new"
  );

  // 3. New installer with a leased-premises system: still required-as-new.
  const fresh = classify(
    {
      municipalityName: "Cataño",
      businessTypeName: "Solar Installer",
      businessStatus: "new",
      answers: {
        Q_EMPLOYEES_HIRED: true,
        Q_PHYSICAL_LOCATION: true,
        Q_SOLAR_OWNERSHIP: "Lease",
      },
      projectFacts: { property_tenure: "leased" },
    },
    "new"
  ).classified;
  assert.equal(
    byId(fresh, DOC_AFFIDAVIT)?.applicability,
    "required",
    "a new installer with solar on leased premises still gets the affidavit as REQUIRED"
  );

  // 4. Owner-developer path untouched: renewable energy company, leased, new.
  const developer = classify(
    {
      municipalityName: "Ponce",
      businessTypeName: "Renewable Energy Company",
      businessStatus: "new",
      answers: {
        Q_EMPLOYEES_HIRED: true,
        Q_PHYSICAL_LOCATION: true,
        Q_SOLAR_OWNERSHIP: "Lease",
      },
      projectFacts: { property_tenure: "leased" },
    },
    "new"
  ).classified;
  assert.equal(
    byId(developer, DOC_AFFIDAVIT)?.applicability,
    "required",
    "the owner-developer affidavit path on a genuine Lease answer is unchanged"
  );
});

test("CASE AG: DOC_CONTRACTOR_LICENSE is never REQUIRED on business type alone for renewable energy companies", () => {
  // 2026-09-20 06:00 QA cycle (S79, Ponce): a new utility-scale battery
  // energy-storage facility (owner/developer, not an installer — third-party
  // GC builds it) got the DACO contractor license (Ley 146-1995) as REQUIRED
  // on business type alone via RULE_0237. Same defect class as RULE_0135
  // (landscaping) / RULE_0232 (energy consulting), demoted in 51805ec:
  // verified, BT-alone, no question guard, Ley 146-1995 citation. A
  // renewable energy company is trade-adjacent, not a construction business —
  // Ley 146-1995 covers the residential construction business, and validated
  // golden G12 pins even BT_GENERAL_CONTRACTOR at needs_more_information
  // ("do not assume from general contractor alone").
  // Deep-research batch 1 (2026-09-21) retargeted RULE_0237 from a
  // business-type heuristic to a Q_OFFERS_CONSTRUCTION_SERVICES question
  // trigger — the research verdicts judged BT-alone assertion an
  // over-assertion. The discovery intake asks Q_OFFERS_CONSTRUCTION_SERVICES
  // for this BT, so there is no recall gap: an unanswered or No answer means
  // no contractor card at all; an honest Yes routes through the verified
  // question path (RULE_0642) while the heuristic sibling still names
  // residential_work as the controlling unanswered fact. The installer
  // registration (RULE_0605) and owner-side LUMA/net-metering rules (0610/0611)
  // are unchanged.
  const DOC_CONTRACTOR = docByName("contractor license");

  // The S79 shape: BT alone (no construction-services signal) never asserts
  // the license.
  for (const businessStatus of ["new", "existing"] as const) {
    for (const answers of [
      { Q_EMPLOYEES_HIRED: true, Q_PHYSICAL_LOCATION: true },
      { Q_EMPLOYEES_HIRED: true, Q_PHYSICAL_LOCATION: true, Q_OFFERS_CONSTRUCTION_SERVICES: false },
    ]) {
      const rows = classify(
        {
          municipalityName: "Ponce",
          businessTypeName: "Renewable Energy Company",
          businessStatus,
          answers,
          projectFacts: { property_tenure: "leased" },
        },
        businessStatus
      ).classified;
      assert.equal(
        byId(rows, DOC_CONTRACTOR),
        undefined,
        `a ${businessStatus} renewable energy company with no construction-services signal must not surface a contractor license card`
      );
    }
  }

  // An honest Yes routes through the verified question path (RULE_0642) —
  // required, with the heuristic sibling's residential_work still named as
  // the controlling unanswered fact (REG-PROVENANCE-WINNER-001).
  const yesRows = classify(
    {
      municipalityName: "Ponce",
      businessTypeName: "Renewable Energy Company",
      businessStatus: "new",
      answers: {
        Q_EMPLOYEES_HIRED: true,
        Q_PHYSICAL_LOCATION: true,
        Q_OFFERS_CONSTRUCTION_SERVICES: true,
      },
      projectFacts: { property_tenure: "leased" },
    },
    "new"
  ).classified;
  const yesLic = byId(yesRows, DOC_CONTRACTOR);
  assert.ok(yesLic, "a renewable energy company answering Yes to construction services must surface the contractor license");
  assert.equal(
    yesLic.applicability,
    "required",
    "an honest Yes to construction services asserts the license via the verified question path"
  );
  assert.equal(
    yesLic.source_rule_id,
    "RULE_0642",
    "the card must cite the winning verified basis, not the heuristic sibling (REG-PROVENANCE-WINNER-001)"
  );
  assert.ok(
    (yesLic.missingFacts ?? []).includes("residential_work"),
    "the controlling unanswered fact must still be named"
  );

  // Control: a genuine contractor still holds.
  const electrician = classify(
    {
      municipalityName: "Ponce",
      businessTypeName: "Electrical Contractor",
      businessStatus: "new",
      answers: { Q_EMPLOYEES_HIRED: true, Q_PHYSICAL_LOCATION: true },
      projectFacts: { property_tenure: "leased" },
    },
    "new"
  ).classified;
  assert.equal(
    byId(electrician, DOC_CONTRACTOR)?.applicability,
    "required",
    "a new electrical contractor still gets the DACO contractor license as REQUIRED (RULE_0125 verified)"
  );
});

test("CASE AH: coarse food_prepared_or_sold never asserts Q_FOOD_PREPARED (served != prepared)", () => {
  // 2026-09-20 21:00 QA cycle (S94, live Guaynabo gym): the wizard mirrors a
  // "food served = Yes" answer onto profile.food_prepared_or_sold, and
  // buildEngineInput read that coarse key as Q_FOOD_PREPARED=true —
  // manufacturing on-site food preparation from a smoothie bar serving
  // pre-packaged items. Live result: Health Permit + CFPM + Fire Safety as
  // REQUIRED with the false trigger "Will food be prepared on-site? |
  // Answer: Yes" for a question the user never answered. Root cause: the
  // disjunctive coarse key ("prepared OR sold") fanned out to three specific
  // conjunctive facts. Fix: each food fact reads only its precise keys.
  const DOC_HEALTH = docByName("health", "sanitary");
  const DOC_FIRE = docByName("fire safety");
  const DOC_CFPM = docByName("food protection manager");

  // The live defect shape: wizard discovery answer food_served=Yes plus the
  // profile mirror the wizard itself writes (SmartPRIntake handleQuestionAnswer).
  const coarse = buildEngineInput(
    {
      municipality: "Guaynabo",
      business_type: "Gym / Fitness Studio",
      location_type: "Commercial Facility",
      food_prepared_or_sold: true,
    } as any,
    { food_served: true },
    {}
  );
  assert.equal(
    coarse.answers["Q_FOOD_PREPARED"],
    false,
    "serving food must not assert on-site food preparation"
  );
  assert.equal(
    coarse.answers["Q_FOOD_SERVED"],
    true,
    "the precise served answer still lands"
  );

  const rows = classify(coarse, "new").classified;
  const health = byId(rows, DOC_HEALTH);
  assert.ok(
    !health || health.applicability !== "required",
    "a gym serving pre-packaged smoothies must not get the health permit as REQUIRED via manufactured Q_FOOD_PREPARED (RULE_0009)"
  );
  assert.ok(
    (byId(rows, DOC_FIRE)?.applicability ?? "absent") !== "required",
    "no REQUIRED fire certification from manufactured food preparation"
  );
  assert.ok(
    (byId(rows, DOC_CFPM)?.applicability ?? "absent") !== "required",
    "no REQUIRED food protection manager from manufactured food preparation"
  );

  // Coarse key arriving via the answers namespace (legacy interpreter/import
  // shape) must not assert preparation either.
  const coarseAnswers = buildEngineInput(
    { municipality: "Guaynabo", business_type: "Gym / Fitness Studio" } as any,
    { food_prepared_or_sold: true },
    {}
  );
  assert.equal(
    coarseAnswers.answers["Q_FOOD_PREPARED"],
    false,
    "coarse key in answers must not assert preparation"
  );
  assert.equal(
    coarseAnswers.answers["Q_FOOD_SOLD"],
    false,
    "coarse key in answers must not assert selling"
  );

  // Positive control: a genuine precise prepared answer still drives the
  // food-prep path.
  const precise = buildEngineInput(
    { municipality: "Guaynabo", business_type: "Restaurant" } as any,
    { food_prepared_on_site: true },
    {}
  );
  assert.equal(precise.answers["Q_FOOD_PREPARED"], true, "precise prepared key still asserts preparation");
  const preciseRows = classify(precise, "new").classified;
  assert.equal(
    byId(preciseRows, DOC_HEALTH)?.applicability,
    "required",
    "a restaurant that genuinely prepares food on-site still gets the health permit as REQUIRED (RULE_0009)"
  );
});

test("CASE AI: sports facility health permit is needs_more_information without a food/pool trigger (REG-HEALTH-SPORTS-001)", () => {
  // 2026-09-21 00:00 QA cycle (S97, Bayamon): a new youth-soccer academy
  // (no kitchen, no food service, no pool) got the Licencia Sanitaria as
  // REQUIRED on business type alone via RULE_0248 (BT_SPORTS_FACILITY).
  // Primary-source review: NOT SUPPORTED. RGSA 7655 (Reglamento General de
  // Salud Ambiental) Art VI defines "establecimiento publico" as
  // establishments that handle or produce food or beverages; Ley 1-2013 Art
  // 2.7 — the only official government enumeration of licencia-sanitaria-
  // applicable businesses — lists food services, public-health services,
  // drinking-water/ice, PUBLIC pools/spas/jacuzzis, funeral, animal-control,
  // pesticide services, and no sports facilities; SASA's official inspection
  // fee schedule names no bars and no sports facilities. The verified BT-alone
  // assert was the inverse of the validated-review demotions of RULE_0244
  // (gym) and the RULE_0116/RULE_0121 professional-license rules.
  // Fix: RULE_0248 is heuristic + missing_fact_keys=[health_license_trigger],
  // no compliance_mode (RULE_0664 lesson). A facility WITH a public pool,
  // spa, or jacuzzi IS in scope (Ley 1-2013 Art 2.7) — the named controlling
  // fact captures exactly that.
  const DOC_HEALTH = docByName("health", "sanitary");

  for (const businessStatus of ["new", "existing"] as const) {
    const rows = classify(
      {
        municipalityName: "Bayamón",
        businessTypeName: "Sports Facility",
        businessStatus,
        answers: {
          Q_EMPLOYEES_HIRED: true,
          Q_PHYSICAL_LOCATION: true,
          Q_FOOD_PREPARED: false,
          Q_FOOD_SOLD: false,
          Q_FOOD_SERVED: false,
          Q_ALCOHOL_SOLD: false,
        },
      },
      businessStatus
    ).classified;
    const health = byId(rows, DOC_HEALTH);
    assert.ok(
      health,
      `health permit row must exist for Sports Facility (${businessStatus})`
    );
    assert.equal(
      health.applicability,
      "needs_more_information",
      `a ${businessStatus} sports facility without food service stays needs_more_information (heuristic rule) — never REQUIRED/verify_existing`
    );
    assert.ok(
      (health.missingFacts ?? []).includes("health_license_trigger"),
      "the controlling unanswered fact must be named"
    );
  }

  // Control: a genuine food establishment still holds.
  const cafe = classify(
    {
      municipalityName: "Mayagüez",
      businessTypeName: "Cafe",
      businessStatus: "new",
      answers: { Q_EMPLOYEES_HIRED: true, Q_PHYSICAL_LOCATION: true },
    },
    "new"
  ).classified;
  assert.equal(
    byId(cafe, DOC_HEALTH)?.applicability,
    "required",
    "a new cafe still gets the health permit as REQUIRED (RULE_0058 verified, genuine food establishment)"
  );

  // Control: the no-food bar stays in its known REQUIRES_REVIEW posture —
  // this fix must not touch it (primary-source verdict: UNCERTAIN).
  const bar = classify(
    {
      municipalityName: "Carolina",
      businessTypeName: "Bar",
      businessStatus: "new",
      answers: {
        Q_EMPLOYEES_HIRED: true,
        Q_FOOD_PREPARED: false,
        Q_FOOD_SERVED: false,
      },
    },
    "new"
  ).classified;
  assert.equal(
    byId(bar, DOC_HEALTH)?.applicability,
    "required",
    "RULE_0062 (no-food bar) is unchanged — its UNCERTAIN primary-source verdict stays in REQUIRES_REGULATORY_REVIEW"
  );
});

test("CASE AJ: stock/close corporations never receive the LLC certificate of organization (REG-FORMATION-EXCL-001)", () => {
  // 2026-09-21 00:00 QA cycle (S98 live, Carolina): a new stock-corporation
  // draft rendered BOTH Certificate of Incorporation AND Certificate of
  // Organization (LLC) as REQUIRED — the two defects were:
  // (1) RULE_0651's excluded_entity_types used the legacy "corporation"
  //     identifier, but the live intake's canonical EntityType values are
  //     "stock_corporation"/"close_corporation" (forms/engine/types.ts); the
  //     exact-string match in rulesEngine let the LLC rule fire for corps.
  // (2) applyEntityFormationExclusivity filtered only DOC_ARTICLES_ORGANIZATION
  //     while RULE_0651 emits DOC_CERT_ORGANIZATION for the same filing
  //     (the LLC_FORMATION_DOCS set already documented the duality), so the
  //     backstop never dropped the engine's id.
  const DOC_INCORP = "DOC_CERT_INCORPORATION";
  const DOC_LLC_ORG = "DOC_CERT_ORGANIZATION";

  // 1) The engine itself must not fire the LLC certificate for stock/close corps.
  for (const entityType of ["stock_corporation", "close_corporation"] as const) {
    const rows = classify(
      {
        municipalityName: "Carolina",
        businessTypeName: "Bar",
        businessStatus: "new",
        entityType,
        entityNotFormed: true,
        answers: { Q_PHYSICAL_LOCATION: true },
      },
      "new"
    ).classified;
    assert.equal(
      byId(rows, DOC_LLC_ORG),
      undefined,
      `${entityType}: RULE_0651 must stay silent — no LLC certificate for a corporation`
    );
    const incorp = byId(rows, DOC_INCORP);
    assert.ok(
      incorp,
      `${entityType}: the corporation still gets its own Certificate of Incorporation`
    );
  }

  // 2) Defense in depth: even if an engine path emits the LLC cert under the
  //    engine's document id, the exclusivity backstop drops BOTH LLC-cert ids
  //    for corporations.
  const fabricated = [
    { document_id: DOC_INCORP },
    { document_id: DOC_LLC_ORG },
    { document_id: "DOC_ARTICLES_ORGANIZATION" },
  ];
  const kept = applyEntityFormationExclusivity(fabricated, "stock_corporation");
  assert.deepEqual(
    kept.map((r) => r.document_id),
    [DOC_INCORP],
    "stock_corporation exclusivity keeps only the incorporation certificate"
  );

  // 3) Controls: an LLC still gets the LLC certificate and no incorporation
  //    card, so the fix did not flip the LLC branch.
  const llc = classify(
    {
      municipalityName: "Carolina",
      businessTypeName: "Bar",
      businessStatus: "new",
      entityType: "limited_liability_company",
      entityNotFormed: true,
      answers: { Q_PHYSICAL_LOCATION: true },
    },
    "new"
  ).classified;
  assert.ok(
    byId(llc, DOC_LLC_ORG),
    "limited_liability_company: the LLC certificate still fires for an LLC"
  );
  assert.equal(
    byId(llc, DOC_INCORP),
    undefined,
    "limited_liability_company: no incorporation certificate for an LLC"
  );
});

test("CASE AK: LUMA interconnection and net metering belong to the generator, never the installer (REG-LUMA-INSTALLER-001)", () => {
  // 2026-09-21 06:00 QA cycle (S104, Dorado): an existing solar-installer
  // company got the LUMA Interconnection Registration and the Net Metering
  // Agreement as its own operating obligations (verify_existing) via the
  // installer-BT rules. Those instruments belong to the distributed
  // GENERATOR (the system owner/customer) — Law 114-2007 Art. 9,
  // CEPR-MI-2014-0001, and the KB's own guidance concepts (all
  // Q_RENEWABLE_INSTALL-conditioned, written for the system owner: "Execute
  // LUMA's interconnection / net metering agreement for the commercial
  // customer account"). An installer company's proper instrument is the OPPE
  // installer registration (RULE_0605, untouched); genuine generators are
  // covered by the owner-side rules RULE_0610/0611 (Q_RENEWABLE_INSTALL).
  // Fix: RULE_0603/0604/0606/0607/0608/0609 (installer BTs x both docs)
  // deleted. Generalizes across solar, battery-storage, and renewable-energy
  // installer BTs and both documents — same class as the §29.2
  // alcohol-prerequisite scoping (the instrument belongs to the license/
  // generator, not the party). This supersedes the 2026-09-18 15:00 CASE V
  // "installer interconnection obligations are per-project/recurring"
  // rationale — the per-project obligation the installer carries is the OPPE
  // registration, not a generator agreement.
  for (const [btName, status] of [
    ["Solar Installer", "new"],
    ["Solar Installer", "existing"],
    ["Battery Storage Installer", "existing"],
    ["Renewable Energy Company", "new"],
  ] as const) {
    const rows = classify(
      {
        municipalityName: "Dorado",
        businessTypeName: btName,
        businessStatus: status,
        answers: { Q_EMPLOYEES_HIRED: true, Q_OFFERS_CONSTRUCTION_SERVICES: true },
      },
      status
    ).classified;
    assert.equal(
      byId(rows, DOC_LUMA),
      undefined,
      `${btName} (${status}): no LUMA interconnection card on the installer BT alone`
    );
    assert.equal(
      byId(rows, DOC_NETMETER),
      undefined,
      `${btName} (${status}): no net metering card on the installer BT alone`
    );
  }

  // Control: the installer-appropriate instruments still fire.
  const installer = classify(
    {
      municipalityName: "Dorado",
      businessTypeName: "Solar Installer",
      businessStatus: "new",
      answers: { Q_EMPLOYEES_HIRED: true, Q_OFFERS_CONSTRUCTION_SERVICES: true },
    },
    "new"
  ).classified;
  assert.equal(
    byId(installer, docByName("installer registration"))?.applicability,
    "required",
    "a new solar installer still gets the OPPE installer registration (RULE_0605)"
  );
  assert.equal(
    byId(installer, docByName("contractor license"))?.applicability,
    "required",
    "a new solar installer offering construction services still gets the DACO contractor license (RULE_0230)"
  );

  // Control: a genuine generator-owner still gets both instruments.
  const owner = classify(
    {
      municipalityName: "Dorado",
      businessTypeName: "Warehouse Distributor",
      businessStatus: "new",
      answers: { Q_RENEWABLE_INSTALL: true },
    },
    "new"
  ).classified;
  assert.equal(
    byId(owner, DOC_LUMA)?.applicability,
    "required",
    "an owner with its own renewable installation still gets LUMA interconnection (RULE_0610)"
  );
  assert.equal(
    byId(owner, DOC_NETMETER)?.applicability,
    "required",
    "an owner with its own renewable installation still gets the net metering agreement (RULE_0611)"
  );
});

test("CASE AL: insurance agencies get professional license as needs_more_information, not REQUIRED (REG-PROF-INSURANCE-001)", () => {
  // 2026-09-21 06:00 QA cycle (S105, Toa Baja): BT_INSURANCE_AGENCY asserted
  // DOC_PROFESSIONAL_LICENSE as REQUIRED on the "Juntas Examinadoras (Dept of
  // State)" citation — even when the user answered Q_PROFESSIONAL_LICENSES=false.
  // Primary-source review: insurance producers/agencies in PR are licensed by
  // the Oficina del Comisionado de Seguros (OCS) under the Insurance Code
  // (Art 9.160(1), 26 L.P.R.A. sec. 916(1) — licenses as productor/agente
  // general/ajustador extended by the OCS; OCS producer-license forms
  // docs.pr.gov), NOT by a Junta Examinadora. Same defect class as the
  // 594af48 demotions (RULE_0121/0122/0225/0226/0228/0229).
  // Fix: RULE_0224 is heuristic + missing_fact_keys=[licensed_profession_type],
  // no compliance_mode (RULE_0664 lesson).
  const DOC_PROFLIC = docByName("professional license");
  for (const businessStatus of ["new", "existing"] as const) {
    const rows = classify(
      {
        municipalityName: "Toa Baja",
        businessTypeName: "Insurance Agency",
        businessStatus,
        answers: { Q_EMPLOYEES_HIRED: true, Q_PHYSICAL_LOCATION: true },
      },
      businessStatus
    ).classified;
    const lic = byId(rows, DOC_PROFLIC);
    assert.ok(lic, `professional license row must exist for Insurance Agency (${businessStatus})`);
    assert.equal(
      lic.applicability,
      "needs_more_information",
      `insurance agency (${businessStatus}) stays needs_more_information naming the controlling fact — never REQUIRED on the Juntas citation`
    );
    assert.ok(
      (lic.missingFacts ?? []).includes("licensed_profession_type"),
      "the controlling unanswered fact must be named"
    );
  }

  // Controls: genuinely Junta-licensed professions keep REQUIRED.
  const vet = classify(
    {
      municipalityName: "Guaynabo",
      businessTypeName: "Veterinary Clinic",
      businessStatus: "new",
      answers: { Q_EMPLOYEES_HIRED: true, Q_PHYSICAL_LOCATION: true, Q_PROFESSIONAL_LICENSES: true },
    },
    "new"
  ).classified;
  assert.equal(
    byId(vet, DOC_PROFLIC)?.applicability,
    "required",
    "a new veterinary clinic still gets the professional license as REQUIRED (RULE_0103 verified — vets are genuinely Junta-licensed)"
  );
  const pharmacy = classify(
    {
      municipalityName: "Ponce",
      businessTypeName: "Pharmacy",
      businessStatus: "new",
      answers: { Q_EMPLOYEES_HIRED: true, Q_PHYSICAL_LOCATION: true },
    },
    "new"
  ).classified;
  assert.equal(
    byId(pharmacy, DOC_PROFLIC)?.applicability,
    "required",
    "a new pharmacy still gets the professional license as REQUIRED (RULE_0094 verified)"
  );
});

test("CASE AM: RULE_0224 cites the OCS, never Juntas Examinadoras (REG-CITATION-INSURANCE-001)", () => {
  // RULE_0224 (BT_INSURANCE_AGENCY → DOC_PROFESSIONAL_LICENSE) carried the
  // document-inherited "Juntas Examinadoras (Dept of State)" citation even
  // after its 06:00-cycle demotion. PR insurance producers are licensed by
  // the Oficina del Comisionado de Seguros under the Insurance Code
  // (Art 9.160(1), 26 L.P.R.A. § 916(1)) — never by a Junta Examinadora.
  const rules = load("rules.json") as Array<Record<string, unknown>>;
  const r = rules.find((x) => x.id === "RULE_0224");
  assert.ok(r, "RULE_0224 must exist");
  const citation = String(r.citation ?? "");
  assert.ok(
    citation.includes("Oficina del Comisionado de Seguros"),
    `RULE_0224 must cite the OCS, got: ${citation}`
  );
  assert.ok(
    citation.includes("9.160"),
    `RULE_0224 must name the Insurance Code basis, got: ${citation}`
  );
  assert.ok(
    !citation.includes("Juntas Examinadoras"),
    `RULE_0224 must not cite Juntas Examinadoras, got: ${citation}`
  );
  assert.equal(
    r.citation_source,
    "rule",
    "the corrected citation overrides the inherited document citation"
  );
});

test("CASE AN: RULE_0103 cites the veterinary examining board under Dept. de Salud, never Dept. of State (REG-CITATION-VET-001)", () => {
  // RULE_0103 (BT_VETERINARY_CLINIC → DOC_PROFESSIONAL_LICENSE) carried the
  // document-inherited "Juntas Examinadoras (Dept of State)" citation.
  // Puerto Rico veterinarians are licensed by the Junta Examinadora de
  // Médicos Veterinarios, adscrita a la Oficina de Reglamentación y
  // Certificación de Profesionales de la Salud (ORCPS) del Departamento de
  // Salud — Ley Núm. 194-1979, Arts. 5 (board creation under ORCPS), 6
  // (licensing powers) y 18 (unlicensed practice is a felony). The Dept. of
  // State's Juntas Examinadoras never had jurisdiction over veterinarians.
  // Same defect class as REG-CITATION-INSURANCE-001 (RULE_0224).
  const rules = load("rules.json") as Array<Record<string, unknown>>;
  const r = rules.find((x) => x.id === "RULE_0103");
  assert.ok(r, "RULE_0103 must exist");
  const citation = String(r.citation ?? "");
  assert.ok(
    citation.includes("Junta Examinadora de Médicos Veterinarios"),
    `RULE_0103 must name the veterinary examining board, got: ${citation}`
  );
  assert.ok(
    citation.includes("194-1979"),
    `RULE_0103 must name the enabling law (Ley 194-1979), got: ${citation}`
  );
  assert.ok(
    !citation.includes("Dept of State"),
    `RULE_0103 must not cite the Dept. of State, got: ${citation}`
  );
  assert.ok(
    String(r.citation_url ?? "").includes("salud.pr.gov"),
    `RULE_0103 must link a primary Dept. de Salud source, got: ${r.citation_url}`
  );
  assert.equal(
    r.citation_source,
    "rule",
    "the corrected citation overrides the inherited document citation"
  );
  assert.ok(
    !("citation_inherited_from" in r),
    "the corrected citation must not inherit the document-level citation"
  );
});

test("REG-PROVENANCE-WINNER-001: a verified basis wins both applicability and source-rule provenance over a heuristic sibling", () => {
  // QA 2026-09-21 21:00 cycle (S120, Mayagüez): the veterinary clinic's
  // Professional License card showed required (from verified RULE_0103) but
  // source_rule=RULE_0029 — a heuristic sibling that matched the same
  // document won the provenance slot by array order alone. The card's
  // reason/source_rule must come from a basis that actually produced the
  // winning applicability: the first independent (non-geographic) basis
  // whose state matches the winning state, falling back to the first
  // winning-state basis so municipality-flag wins are preserved.
  const DOC_LICENSE = docByName("professional license");
  const DOC_CONTRACTOR = docByName("contractor license");

  // Veterinary clinic: verified RULE_0103 (BT-gated) wins over heuristic
  // RULE_0029 (question-trigger sibling on the same document).
  const vet = classify(
    {
      municipalityName: "Mayagüez",
      businessTypeName: "Veterinary Clinic",
      businessStatus: "new",
      entityType: "limited_liability_company",
      answers: {
        Q_PHYSICAL_LOCATION: true,
        Q_PROFESSIONAL_LICENSES: true,
      },
    },
    "new"
  ).classified;
  const vetLic = byId(vet, DOC_LICENSE);
  assert.ok(vetLic, "veterinary clinic must surface the professional license");
  assert.equal(vetLic.applicability, "required", "the verified veterinary basis asserts required");
  assert.equal(
    vetLic.source_rule_id,
    "RULE_0103",
    "the card must cite the winning verified basis, not the heuristic sibling RULE_0029"
  );

  // Energy consulting firm answering Yes: verified RULE_0642 (question path)
  // wins over heuristic RULE_0232 (retargeted question-trigger sibling).
  const consulting = classify(
    {
      municipalityName: "Bayamón",
      businessTypeName: "Energy Consulting Firm",
      businessStatus: "new",
      answers: { Q_PHYSICAL_LOCATION: true, Q_OFFERS_CONSTRUCTION_SERVICES: true },
    },
    "new"
  ).classified;
  const conLic = byId(consulting, DOC_CONTRACTOR);
  assert.ok(conLic, "energy consulting firm answering Yes must surface the contractor license");
  assert.equal(conLic.applicability, "required", "the verified question-path basis asserts required");
  assert.equal(
    conLic.source_rule_id,
    "RULE_0642",
    "the card must cite the winning verified basis, not the heuristic sibling RULE_0232"
  );
});

test("CASE AO: licensed-profession rules cite their actual examining authority, never the generic Juntas Examinadoras line (REG-CITATION-PROFESSIONS-001)", () => {
  // RULE_0114 (law), RULE_0115 (CPA), RULE_0118 (engineering),
  // RULE_0119 (architecture), RULE_0120 (notary) all carried the
  // document-inherited "Juntas Examinadoras (Dept of State)" citation plus
  // a third-party URL — the same defect class as REG-CITATION-VET-001
  // (RULE_0103) and REG-CITATION-INSURANCE-001 (RULE_0224). Primary-source
  // verification (QA 2026-09-22 00:00, S123 Trujillo Alto CPA firm):
  // lawyers and notaries are admitted by the Tribunal Supremo de Puerto
  // Rico (Junta Examinadora de Aspirantes al Ejercicio de la Abogacía y la
  // Notaría, 4 L.P.R.A. Ap. XVII-B) — never the Dept. of State; CPAs by the
  // Junta Examinadora de Contadores Públicos Autorizados (Ley 293-1945,
  // 20 L.P.R.A. §§ 773, 779); engineers by the Junta Examinadora de
  // Ingenieros y Agrimensores and architects by the Junta Examinadora de
  // Arquitectos y Arquitectos Paisajistas (Ley 173-1988, 20 L.P.R.A.
  // §§ 711 et seq., split by Ley 138-2000). Citation-only; verified
  // posture is unchanged for all five (genuine licensed professions).
  const rules = load("rules.json") as Array<Record<string, unknown>>;
  const expectations: Array<[string, string, string]> = [
    ["RULE_0114", "Tribunal Supremo de Puerto Rico", "poderjudicial.pr"],
    ["RULE_0115", "Junta Examinadora de Contadores Públicos Autorizados", "293-1945"],
    ["RULE_0118", "Junta Examinadora de Ingenieros y Agrimensores", "173-1988"],
    ["RULE_0119", "Junta Examinadora de Arquitectos y Arquitectos Paisajistas", "173-1988"],
    ["RULE_0120", "Tribunal Supremo de Puerto Rico", "poderjudicial.pr"],
  ];
  for (const [id, authority, marker] of expectations) {
    const r = rules.find((x) => x.id === id);
    assert.ok(r, `${id} must exist`);
    const citation = String(r.citation ?? "");
    assert.ok(
      citation.includes(authority),
      `${id} must cite ${authority}, got: ${citation}`
    );
    assert.ok(
      citation.includes(marker) || String(r.citation_url ?? "").includes(marker),
      `${id} must name/link its legal basis (${marker})`
    );
    assert.ok(
      !citation.includes("Juntas Examinadoras (Dept of State)"),
      `${id} must not carry the generic inherited line, got: ${citation}`
    );
    assert.equal(
      r.citation_source,
      "rule",
      `${id}: the corrected citation overrides the inherited document citation`
    );
    assert.ok(
      !("citation_inherited_from" in r),
      `${id}: the corrected citation must not inherit the document-level citation`
    );
    assert.ok(
      !String(r.citation_url ?? "").includes("didaxispr.com"),
      `${id} must not link the third-party URL, got: ${r.citation_url}`
    );
  }
});

test("CASE AQ: fire-certificate rules and document cite the current fire authority — the repealed Ley 43-1988 may not appear as live authority (REG-CITATION-FIRE-001)", () => {
  // 2026-09-22 QA: all 30 fire-certificate rules (RULE_0008 family) and
  // DOC_FIRE_CERT cited "Ley Núm. 43-1988" as the live authority. Ley
  // 20-2017 (Ley del Departamento de Seguridad Pública) created the
  // Negociado del Cuerpo de Bomberos within DSP and expressly repealed Ley
  // 43-1988; the fire-inspection/certification authority is therefore Ley
  // 20-2017. Every fire rule carries an explicit rule-level citation that
  // overrides the document's inherited citation.
  const rules = load("rules.json") as Array<Record<string, unknown>>;
  const docs = load("documents.json") as Array<Record<string, unknown>>;
  const fireRules = rules.filter((r) => r.requires_document_id === "DOC_FIRE_CERT");
  assert.ok(fireRules.length >= 20, `expected the fire rule family, got ${fireRules.length}`);
  for (const r of fireRules) {
    const citation = String(r.citation ?? "");
    // The repealed Ley 43-1988 may appear only in a historical change-log
    // note (Spanish "derogó/derogada" or "derogated/repealed by Ley 20-2017")
    // — never as live authority.
    assert.ok(
      !/43-1988/.test(citation) || /derogat|derog|repeal/i.test(citation),
      `${r.id} cites repealed Ley 43-1988 as live authority, got: ${citation}`
    );
    assert.ok(
      citation.includes("Ley 20-2017"),
      `${r.id} must cite the current authority (Ley 20-2017), got: ${citation}`
    );
    assert.ok(
      /bomberos|fire prevention|fire code|fire safety|fire/i.test(citation),
      `${r.id} must name the Negociado del Cuerpo de Bomberos authority, got: ${citation}`
    );
    // The fire citation is document-inherited (stamped with provenance),
    // so the fix lives at the document and propagates honestly.
    assert.equal(r.citation_inherited_from, "DOC_FIRE_CERT", `${r.id} must inherit its citation from DOC_FIRE_CERT`);
    assert.ok(
      String(r.citation_url ?? "").includes("bvirtualogp.pr.gov"),
      `${r.id} must link the primary-source Ley 20-2017 text, got: ${r.citation_url}`
    );
  }
  const doc = docs.find((d) => d.id === "DOC_FIRE_CERT");
  assert.ok(doc, "DOC_FIRE_CERT must exist");
  const docCitation = String(doc.citation ?? "");
  assert.ok(
    docCitation.includes("Ley 20-2017"),
    `DOC_FIRE_CERT must cite Ley 20-2017, got: ${docCitation}`
  );
  assert.ok(
    /repeal|derog/i.test(docCitation),
    `DOC_FIRE_CERT must note that Ley 43-1988 was repealed by Ley 20-2017, got: ${docCitation}`
  );
  assert.ok(
    String(doc.citation_url ?? "").includes("bvirtualogp.pr.gov"),
    `DOC_FIRE_CERT must link the primary-source Ley 20-2017 text, got: ${doc.citation_url}`
  );
});

test("CASE AR: a business-type professional-license rule wins the card's legal basis over the generic question rule (REG-PROVENANCE-SPECIFICITY-001)", () => {
  // 2026-09-22 09:00 QA cycle (S131, Ponce): an insurance agency answering
  // Q_PROFESSIONAL_LICENSES=yes fired both RULE_0029 (generic
  // question_trigger, "Leyes orgánicas de cada Junta Examinadora") and
  // RULE_0224 (business_type, OCS / Código de Seguros Art. 9.160(1)).
  // Array order let the generic rule win the card, so its legal basis and
  // agency pointed at the Dept of State examining boards — the wrong
  // licensing authority (REG-CITATION-INSURANCE-001's OCS citation never
  // surfaced). Fix: among independent bases with the winning state, a
  // business_type basis outranks the generic question fallback.
  // Applicability is untouched — only reason/source_rule move.
  const DOC_PROFLIC = docByName("professional license");
  const ins = classify(
    {
      municipalityName: "Ponce",
      businessTypeName: "Insurance Agency",
      businessStatus: "existing",
      answers: {
        Q_EMPLOYEES_HIRED: true,
        Q_PHYSICAL_LOCATION: true,
        Q_PROFESSIONAL_LICENSES: true,
      },
    },
    "existing"
  ).classified;
  const lic = byId(ins, DOC_PROFLIC);
  assert.ok(lic, "professional license row must exist for Insurance Agency");
  assert.equal(
    lic.source_rule_id,
    "RULE_0224",
    "the BT-specific OCS rule must win the card over the generic RULE_0029"
  );
  assert.equal(
    lic.applicability,
    "needs_more_information",
    "posture is untouched — still NMI naming the controlling fact"
  );
  assert.ok(
    (lic.missingFacts ?? []).includes("licensed_profession_type"),
    "the controlling unanswered fact must still be named"
  );

  // Control: a business type with no professional-license rule of its own
  // still sources the generic question rule.
  const generic = classify(
    {
      municipalityName: "Ponce",
      businessTypeName: "Gift Shop",
      businessStatus: "new",
      answers: {
        Q_EMPLOYEES_HIRED: true,
        Q_PHYSICAL_LOCATION: true,
        Q_PROFESSIONAL_LICENSES: true,
      },
    },
    "new"
  ).classified;
  assert.equal(
    byId(generic, DOC_PROFLIC)?.source_rule_id,
    "RULE_0029",
    "the generic fallback is unchanged when no BT-specific rule fires"
  );

  // Control: a verified BT rule still wins outright (pre-existing behavior).
  const law = classify(
    {
      municipalityName: "San Juan",
      businessTypeName: "Law Firm",
      businessStatus: "new",
      answers: {
        Q_EMPLOYEES_HIRED: true,
        Q_PHYSICAL_LOCATION: true,
        Q_PROFESSIONAL_LICENSES: true,
      },
    },
    "new"
  ).classified;
  const lawLic = byId(law, DOC_PROFLIC);
  assert.equal(lawLic?.source_rule_id, "RULE_0114", "verified BT rule still wins");
  assert.equal(lawLic?.applicability, "required", "law posture unchanged");
});

test("CASE AS: personal-care businesses get the health permit as needs_more_information, never REQUIRED on business type alone (REG-HEALTH-PERSONALCARE-001)", () => {
  // 2026-09-23 03:00 QA cycle (S151, Bayamon): a new barbershop got the
  // Licencia Sanitaria as REQUIRED on business type alone via RULE_0156
  // (BT_BARBERSHOP), citing the food-establishment regulation
  // ("reglamentacion sanitaria de establecimientos de alimentos") — the
  // same citation family corrected for tattoo as REG-CITATION-TATTOO-001
  // and the same defect class as REG-HEALTH-SPORTS-001 (RULE_0248).
  // Primary-source review: NOT SUPPORTED. No statutory basis was found
  // for requiring a Department of Health sanitary license for
  // personal-care establishments — RGSA 7655 (Reglamento General de Salud
  // Ambiental) Art VI covers food/beverage-handling "establecimientos
  // publicos"; Ley 1-2013 Art 2.7 (the only official government
  // enumeration of licencia-sanitaria-applicable businesses, now
  // derogada) listed food, public pools/spas/jacuzzis, funeral,
  // animal-control, pesticide — not barbershops/salons/spas as such;
  // PS 971 (2026) proposing Salud operating licenses for beauty and
  // aesthetic centers is not yet law. Barbering and beauty-specialty
  // occupations are individually licensed (Ley 146-1968 for barbers;
  // Ley 431-1950 for beauty specialists) — that is the PROFESSIONAL
  // LICENSE axis, not a facility sanitary license.
  // Fix: RULE_0155/0156/0157/0158/0159/0162 are heuristic +
  // missing_fact_keys=[health_license_trigger], no compliance_mode
  // (RULE_0664 lesson). Tattoo (RULE_0160, Ley 318-1999 Art 10) stays
  // verified — statutory per-type basis (S144 lesson: do not generalize
  // across body-art BTs).
  const DOC_HEALTH = docByName("health", "sanitary");

  for (const bt of ["Barbershop", "Beauty Salon", "Nail Salon", "Spa", "Massage Therapy Studio", "Esthetics Studio"] as const) {
    for (const businessStatus of ["new", "existing"] as const) {
      const rows = classify(
        {
          municipalityName: "Bayamón",
          businessTypeName: bt,
          businessStatus,
          answers: {
            Q_EMPLOYEES_HIRED: true,
            Q_PHYSICAL_LOCATION: true,
            Q_FOOD_PREPARED: false,
            Q_FOOD_SOLD: false,
            Q_FOOD_SERVED: false,
            Q_ALCOHOL_SOLD: false,
          },
        },
        businessStatus
      ).classified;
      const health = byId(rows, DOC_HEALTH);
      assert.ok(health, `health permit row must exist for ${bt} (${businessStatus})`);
      assert.equal(
        health.applicability,
        "needs_more_information",
        `${bt} (${businessStatus}) without a food/pool trigger stays needs_more_information (heuristic rule) — never REQUIRED/verify_existing`
      );
      assert.ok(
        (health.missingFacts ?? []).includes("health_license_trigger"),
        `the controlling unanswered fact must be named (${bt})`
      );
    }
  }

  // The food-establishment citation may not appear on these cards.
  const barberCite = classify(
    {
      municipalityName: "Bayamón",
      businessTypeName: "Barbershop",
      businessStatus: "new",
      answers: { Q_EMPLOYEES_HIRED: true, Q_PHYSICAL_LOCATION: true },
    },
    "new"
  ).classified;
  const barberHealth = byId(barberCite, DOC_HEALTH);
  assert.ok(
    !/establecimientos de alimentos/i.test(String((barberHealth as any).legal_basis ?? (barberHealth as any).citation ?? "")),
    "the barbershop health citation must not frame itself as food-establishment regulation"
  );

  // Control: a tattoo studio keeps the verified REQUIRED posture —
  // Ley 318-1999 Art 10 requires the studio license (REG-CITATION-TATTOO-001).
  const tattoo = classify(
    {
      municipalityName: "Ponce",
      businessTypeName: "Tattoo Shop",
      businessStatus: "new",
      answers: { Q_EMPLOYEES_HIRED: true, Q_PHYSICAL_LOCATION: true },
    },
    "new"
  ).classified;
  assert.equal(
    byId(tattoo, DOC_HEALTH)?.applicability,
    "required",
    "a new tattoo studio still gets the health permit as REQUIRED (RULE_0160 verified, statutory per-type basis)"
  );

  // Control: a genuine food establishment still holds.
  const restaurant = classify(
    {
      municipalityName: "Guaynabo",
      businessTypeName: "Restaurant",
      businessStatus: "new",
      answers: { Q_EMPLOYEES_HIRED: true, Q_PHYSICAL_LOCATION: true },
    },
    "new"
  ).classified;
  assert.equal(
    byId(restaurant, DOC_HEALTH)?.applicability,
    "required",
    "a new restaurant still gets the health permit as REQUIRED (RULE_0046 verified)"
  );
});

test("CASE REG-PROFESSION-AGENCY-001: rule-level issuing-agency override — the tattoo-artist license names Dept. de Salud, never the Juntas Examinadoras", () => {
  // 2026-09-23 06:00 QA cycle live audit (S156, Ponce): the tattoo artist
  // professional-license card cited Ley 318-1999 Arts. 3-6 correctly, but
  // the agency pill, the "Confirm with Department of State Examining
  // Boards" fallback body, and the Didaxis filing link all pointed at the
  // Juntas Examinadoras — the wrong licensing authority for a
  // Salud-issued license. The shared DOC_PROFESSIONAL_LICENSE node cannot
  // carry a per-profession authority, so RULE_0696 now overrides
  // agency/agency_url/agency_note (data-driven: the engine prefers the
  // rule's own authority over the document default; nothing hardcoded).
  const DOC_PROFLIC = docByName("professional license");
  const tattoo = classify(
    {
      municipalityName: "Ponce",
      businessTypeName: "Tattoo Shop",
      businessStatus: "existing",
      answers: { Q_EMPLOYEES_HIRED: true, Q_PHYSICAL_LOCATION: true },
    },
    "existing"
  ).classified;
  const lic = byId(tattoo, DOC_PROFLIC);
  assert.ok(lic, "professional license row must exist for an existing tattoo shop");
  assert.equal(
    lic.source_rule_id,
    "RULE_0696",
    "the Salud-licensed tattoo-artist rule must win the card"
  );
  assert.equal(
    lic.applicability,
    "verify_existing",
    "posture is untouched — an existing artist verifies their license"
  );
  assert.equal(
    lic.agency,
    "Departamento de Salud",
    "the agency pill must name the actual licensing authority"
  );
  assert.equal(
    lic.agency_url,
    "https://www.salud.pr.gov/",
    "the filing link must go to Salud, not the Didaxis Juntas portal"
  );
  assert.equal(
    lic.download_url,
    "https://www.salud.pr.gov/",
    "REG-PROFESSION-AGENCY-002: the 'File online' download destination must follow the rule's own authority, never the shared document default"
  );
  assert.equal(
    lic.download_kind,
    "guidance_page",
    "no specific tattoo-license filing portal is verified — honest 'How to file' posture"
  );
  assert.ok(
    /318-1999/.test(String(lic.download_note ?? "")),
    "the download note must cite the statutory basis"
  );
  assert.ok(
    /318-1999/.test(String(lic.agency_note ?? "")),
    "the agency note must cite the statutory basis"
  );
  assert.ok(
    !/Junta|Examining Boards/i.test(String(lic.agency ?? "")),
    "the agency pill itself must not name the Juntas"
  );
  assert.ok(
    /no las Juntas/i.test(String(lic.agency_note ?? "")),
    "the note explicitly disambiguates against the Juntas Examinadoras"
  );

  // Control: a genuine Junta-licensed profession keeps the document default.
  const barber = classify(
    {
      municipalityName: "Bayamón",
      businessTypeName: "Barbershop",
      businessStatus: "existing",
      answers: {
        Q_EMPLOYEES_HIRED: true,
        Q_PHYSICAL_LOCATION: true,
        Q_PROFESSIONAL_LICENSES: true,
      },
    },
    "existing"
  ).classified;
  const barberLic = byId(barber, DOC_PROFLIC);
  assert.ok(barberLic, "professional license row must exist for an existing barbershop");
  assert.equal(
    barberLic.agency,
    "Department of State Examining Boards",
    "genuine Junta professions keep the document default agency"
  );
  assert.equal(
    barberLic.agency_url,
    "https://www.didaxispr.com/dept/estado-juntas",
    "without a rule override the engine resolves the document default URL"
  );
  assert.equal(
    barberLic.download_url,
    "https://www.didaxispr.com/dept/estado-juntas",
    "genuine Junta professions keep the document default download destination"
  );
  assert.equal(barberLic.download_kind, "filing_portal");
});
