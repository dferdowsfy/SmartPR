// REG-SOLAR-INSTALLER-NO-INSTALL-001 — a solar company that SELLS and
// DESIGNS systems but subcontracts all installations must NOT be shown the
// installer/contractor obligations as REQUIRED (§19 owner≠contractor).
// (2026-09-30 12:00 QA, S321 Trujillo Alto: BT_SOLAR_INSTALLER rules
// RULE_0230 (DACO contractor license) and RULE_0605 (OPPE installer
// certification) fired REQUIRED despite an explicit No on the activity
// questions.) The fix uses the engine's canonical negated_fact_keys
// mechanism (strict mode only, per REG-ALCOHOL-NEGATED-001): suppression
// requires an EXPLICIT, provenance-admissible No from the current session;
// on()-derived falses from unanswered questions never suppress, and unknown
// facts keep the heuristic BT-keyed behavior.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeRequirementsFromKB } from "./kb.ts";

const profile = {
  business_type: "Solar Installer",
  municipality: "Trujillo Alto",
  location_type: "Commercial Office",
  number_of_employees: 4,
  industry: "Energy",
};
const base = {
  projectIntent: "new_business",
  entityType: "limited_liability_company",
} as const;

const baseAnswers = {
  Q_EMPLOYEES_HIRED: true,
  Q_EMPLOYEE_COUNT: 4,
  Q_OWNS_PROPERTY: false,
  Q_EXISTING_LEASE: true,
  Q_COMMERCIAL_SIGNAGE: false,
  Q_PHYSICAL_LOCATION: true,
  Q_OFFERS_CONSTRUCTION_SERVICES: false,
  Q_RENEWABLE_INSTALL: false,
  Q_RETAIL_SALES: true,
};

function cardIds(reqs: Array<{ document_id?: string }>): string[] {
  return reqs.map((r) => r.document_id ?? "");
}

describe("REG-SOLAR-INSTALLER-NO-INSTALL-001", () => {
  it("strict mode: explicit No on both activity facts suppresses both installer cards (§19)", () => {
    const reqs = computeRequirementsFromKB(profile, baseAnswers, {}, {
      ...base,
      sessionId: "reg-solar-1",
      confirmedKeys: ["business_type", "Q_OFFERS_CONSTRUCTION_SERVICES", "Q_RENEWABLE_INSTALL"],
    });
    const ids = cardIds(reqs);
    assert.ok(!ids.includes("DOC_CONTRACTOR_LICENSE"), "DACO contractor license must be absent for sales-only solar co");
    assert.ok(!ids.includes("DOC_OPPE_INSTALLER_REG"), "OPPE installer certification must be absent for sales-only solar co");
  });

  it("strict mode: explicit Yes keeps both REQUIRED for a genuine installer (recall intact)", () => {
    const reqs = computeRequirementsFromKB(profile, {
      ...baseAnswers,
      Q_OFFERS_CONSTRUCTION_SERVICES: true,
      Q_RENEWABLE_INSTALL: true,
    }, {}, {
      ...base,
      sessionId: "reg-solar-2",
      confirmedKeys: ["business_type", "Q_OFFERS_CONSTRUCTION_SERVICES", "Q_RENEWABLE_INSTALL"],
    });
    const byId = new Map(reqs.map((r) => [r.document_id, r]));
    assert.equal(byId.get("DOC_CONTRACTOR_LICENSE")?.applicability, "required");
    assert.equal(byId.get("DOC_OPPE_INSTALLER_REG")?.applicability, "required");
  });

  it("strict mode: unanswered activity facts keep the heuristic BT-keyed behavior (no false suppression)", () => {
    const answers = { ...baseAnswers };
    delete (answers as Record<string, unknown>).Q_OFFERS_CONSTRUCTION_SERVICES;
    delete (answers as Record<string, unknown>).Q_RENEWABLE_INSTALL;
    const reqs = computeRequirementsFromKB(profile, answers, {}, {
      ...base,
      sessionId: "reg-solar-3",
      confirmedKeys: ["business_type"],
    });
    const ids = cardIds(reqs);
    assert.ok(ids.includes("DOC_CONTRACTOR_LICENSE"), "heuristic contractor card must survive unanswered questions");
    assert.ok(ids.includes("DOC_OPPE_INSTALLER_REG"), "heuristic installer card must survive unanswered questions");
  });

  it("legacy no-session path: historical behavior unchanged", () => {
    const reqs = computeRequirementsFromKB(profile, baseAnswers, {}, { ...base });
    const ids = cardIds(reqs);
    assert.ok(ids.includes("DOC_CONTRACTOR_LICENSE"));
    assert.ok(ids.includes("DOC_OPPE_INSTALLER_REG"));
  });

  it("mixed: offers construction services but does not install renewables — contractor present, installer absent", () => {
    const reqs = computeRequirementsFromKB(profile, {
      ...baseAnswers,
      Q_OFFERS_CONSTRUCTION_SERVICES: true,
      Q_RENEWABLE_INSTALL: false,
    }, {}, {
      ...base,
      sessionId: "reg-solar-5",
      confirmedKeys: ["business_type", "Q_OFFERS_CONSTRUCTION_SERVICES", "Q_RENEWABLE_INSTALL"],
    });
    const ids = cardIds(reqs);
    assert.ok(ids.includes("DOC_CONTRACTOR_LICENSE"), "contractor license applies when construction services are offered");
    assert.ok(!ids.includes("DOC_OPPE_INSTALLER_REG"), "OPPE installer certification must be absent when renewables are not installed");
  });

  it("suppression generalizes across municipalities (San Juan sales-only)", () => {
    const reqs = computeRequirementsFromKB(
      { ...profile, municipality: "San Juan" }, baseAnswers, {}, {
        ...base,
        sessionId: "reg-solar-6",
        confirmedKeys: ["business_type", "Q_OFFERS_CONSTRUCTION_SERVICES", "Q_RENEWABLE_INSTALL"],
      });
    const ids = cardIds(reqs);
    assert.ok(!ids.includes("DOC_CONTRACTOR_LICENSE"));
    assert.ok(!ids.includes("DOC_OPPE_INSTALLER_REG"));
  });
});
