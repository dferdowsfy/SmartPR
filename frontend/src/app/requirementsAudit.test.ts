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
import {
  classifyEngineRequirements,
  bucketForApplicability,
  type ClassifiedRequirement,
} from "./requirementApplicability.ts";

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

test("REG-TRANSPORT-001: logistics/warehouse business without vehicle facts — transport permit is not REQUIRED", () => {
  // QA 2026-09-16: NTSP/CSP transport authorization applies to persons
  // transporting cargo/passengers for hire, not to every business whose
  // type says "logistics"/"warehouse". Business-type-only rules
  // (RULE_0185–RULE_0188) are heuristics gated on commercial_vehicles.
  // Validated review 2026-09-16: Q_COMMERCIAL_VEHICLES (RULE_0022) is
  // heuristic pending the transport_type fact — confirmed vehicle use
  // surfaces the permit as needs_more_information, never required.
  const DOC_TRANSPORT = docByName("transportation / puc permit");
  const DOC_VEHICLE = docByName("commercial vehicle registration");

  const base: EngineInput = {
    municipalityName: "Cataño",
    businessTypeName: "Logistics Company",
    businessStatus: "existing",
    answers: { Q_PHYSICAL_LOCATION: true },
  };

  const noVehicleFacts = classify(base, "existing").classified;
  const transport = byId(noVehicleFacts, DOC_TRANSPORT);
  const vehicle = byId(noVehicleFacts, DOC_VEHICLE);
  assert.ok(transport, "transport permit must be surfaced as an evaluation");
  assert.ok(vehicle, "vehicle registration must be surfaced as an evaluation");
  assert.notEqual(transport.applicability, "required", "transport permit must not be REQUIRED without vehicle facts");
  assert.notEqual(vehicle.applicability, "required", "vehicle registration must not be REQUIRED without vehicle facts");
  assert.ok(
    transport.missingFacts?.includes("commercial_vehicles"),
    "transport permit must name commercial_vehicles as the missing fact"
  );

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
  // Swept compliance_mode=verify_existing onto the whole document families:
  //  - DOC_LUMA_INTERCONNECTION: RULE_0603/0606/0608 (installer BTs),
  //    RULE_0610 (Q_RENEWABLE_INSTALL).
  //  - DOC_NET_METERING_AGREEMENT: RULE_0604/0607/0609 (installer BTs),
  //    RULE_0611 (Q_RENEWABLE_INSTALL).
  // All swept rules have no missing_fact_keys (RULE_0664 lesson) and statute
  // -confidence citations. Installer-BT rules are included per the 332b659
  // whole-family lesson — installer interconnection obligations are
  // per-project/recurring, not first-time filings.

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

  // Existing installer business type: verify_existing, not REQUIRED-as-new.
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
    byId(installer, DOC_LUMA)?.applicability,
    "verify_existing",
    "an existing solar installer verifies its interconnection standing (whole-family sweep)"
  );
});
