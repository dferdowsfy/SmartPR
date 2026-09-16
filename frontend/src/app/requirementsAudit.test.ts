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
const DOC_CONTRACTOR = docByName("contractor license");
const DOC_LEASE = docByName("lease agreement");
const DOC_NOISE = docByName("noise variance");
const DOC_STORMWATER = docByName("stormwater");
const DOC_OGPE = docByName("ogpe construction permit");
const DOC_MERCHANT = docByName("merchant registration");
const DOC_DEED = docByName("property deed");

const byId = (rows: ClassifiedRequirement[], id: string) =>
  rows.find((r) => r.document_id === id);

function classify(input: EngineInput, businessStatus: "new" | "existing" | "project_only" | null) {
  const { requirements, debug } = runRulesEngine(KB, input);
  return {
    classified: classifyEngineRequirements(requirements, { kb: KB, businessStatus }),
    debug,
  };
}

test("premise: doc ids resolve from documents.json and Guaynabo has the metro flag", () => {
  assert.equal(DOC_SAM, "DOC_SAM_REGISTRATION");
  assert.equal(DOC_CONTRACTOR, "DOC_CONTRACTOR_LICENSE");
  assert.equal(DOC_LEASE, "DOC_LEASE_AGREEMENT");
  assert.equal(DOC_NOISE, "DOC_NOISE_VARIANCE");
  assert.equal(DOC_STORMWATER, "DOC_STORMWATER_PLAN");
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
  const { classified, debug } = classify(
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

  // Stormwater: the heuristic metro rule (RULE_0269) is suppressed by the
  // negative fact site_work=false, so the plan must be absent or undecided —
  // never "required". Interior square footage is not land disturbance.
  const storm = byId(classified, DOC_STORMWATER);
  assert.ok(!storm || storm.applicability !== "required", "stormwater must never be required here");
  if (storm) {
    assert.ok(
      storm.applicability === "needs_more_information" ||
        storm.applicability === "likely_required",
      `unexpected stormwater applicability: ${storm.applicability}`
    );
  }
  assert.ok(
    debug.rulesSuppressed.some((s) => s.rule_id === "RULE_0269"),
    "RULE_0269 should be recorded as suppressed by site_work=false"
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

test("CASE B: contractor opening a contracting business — license is required", () => {
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
  assert.equal(lic.applicability, "required");
  assert.equal(lic.source_rule_id, "RULE_0123");
});

test("CASE C: 1.5-acre site development — verified land-disturbance trigger requires stormwater", () => {
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
  const storm = byId(classified, DOC_STORMWATER);
  assert.ok(storm, "Stormwater plan should be emitted for 1.5 disturbed acres");
  assert.equal(storm.applicability, "required");
  assert.equal(
    storm.source_rule_id,
    "RULE_0647",
    "the verified land-disturbance rule should be the presented basis"
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

test("numeric project_fact matcher: land_disturbance_acres >= 1 (RULE_0647)", () => {
  // No municipality: the heuristic metro rule cannot fire, isolating RULE_0647.
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
  assert.ok(storm, "1.5 acres must trigger stormwater coverage");
  assert.equal(storm.applicability, "required");
  assert.equal(storm.source_rule_id, "RULE_0647");
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
  // (RULE_0185–RULE_0188) are heuristics gated on commercial_vehicles;
  // Q_COMMERCIAL_VEHICLES (RULE_0022) remains the authoritative trigger.
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
  assert.equal(transportReq.applicability, "required", "transport permit must be REQUIRED with confirmed vehicle use");
  assert.equal(transportReq.source_rule_id, "RULE_0022", "authoritative trigger must be the Q_COMMERCIAL_VEHICLES rule");
});
