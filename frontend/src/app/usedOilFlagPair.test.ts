// Used-oil generator ID municipality-flag pair (RULE_0678 metro / RULE_0679 coastal).
// 2026-10-01 00:00 QA, S333 Arecibo (positive control): a BT_AUTO_REPAIR_SHOP in a
// coastal municipality must surface DOC_USED_OIL_GENERATOR_ID via RULE_0679 (not the
// metro RULE_0678); the metro pair must fire in a metro municipality; a municipality
// holding neither flag must surface nothing. This locks the flag-pair scoping the
// engine demonstrated so any future BT-coverage expansion (REG-USEDOIL-BT-COVERAGE-001,
// Darius) or flag rescoring is a deliberate, test-visible change.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeRequirementsFromKB } from "./kb.ts";

const profileFor = (municipality: string) => ({
  business_type: "Auto Repair Shop",
  municipality,
  location_type: "Commercial Storefront",
  number_of_employees: 6,
  industry: "Automotive",
});
const answers = {
  Q_EMPLOYEES_HIRED: true,
  Q_EMPLOYEE_COUNT: 6,
  Q_OWNS_PROPERTY: true,
  Q_EXISTING_LEASE: false,
  Q_PHYSICAL_LOCATION: true,
  Q_VEHICLE_REPAIR: true,
  Q_OFFERS_CONSTRUCTION_SERVICES: false,
};
const opts = { projectIntent: "existing_business", entityType: "limited_liability_company" } as const;

function usedOilCards(municipality: string) {
  const reqs = computeRequirementsFromKB(profileFor(municipality), answers, {}, opts);
  return reqs.filter((r: any) => r.document_id === "DOC_USED_OIL_GENERATOR_ID");
}

describe("used-oil generator ID municipality-flag pair (S333)", () => {
  it("coastal municipality (Arecibo): RULE_0679 fires, metro RULE_0678 does not", () => {
    const cards = usedOilCards("Arecibo");
    assert.equal(cards.length, 1, "exactly one used-oil card expected");
    assert.equal(cards[0].source_rule ?? (cards[0] as any).rule_id, "RULE_0679");
    assert.equal(cards[0].applicability, "needs_more_information");
    const mfk = (cards[0] as any).missingFacts ?? (cards[0] as any).missing_fact_keys ?? [];
    assert.ok(mfk.includes("used_oil_generation"), "honest missing-fact key expected");
  });

  it("metro municipality (Bayamón): RULE_0678 fires, coastal RULE_0679 does not", () => {
    const cards = usedOilCards("Bayamón");
    assert.equal(cards.length, 1, "exactly one used-oil card expected");
    assert.equal(cards[0].source_rule ?? (cards[0] as any).rule_id, "RULE_0678");
    assert.equal(cards[0].applicability, "needs_more_information");
  });

  it("no-flag municipality (Adjuntas): no used-oil card at all", () => {
    const cards = usedOilCards("Adjuntas");
    assert.equal(cards.length, 0, "used-oil axis must stay silent without a coastal/metro flag");
  });

  it("BT boundary: a car wash in a coastal municipality gets no used-oil card (REG-USEDOIL-BT-COVERAGE-001)", () => {
    const reqs = computeRequirementsFromKB(
      { ...profileFor("Arecibo"), business_type: "Car Wash" },
      answers, {}, opts,
    );
    const cards = reqs.filter((r: any) => r.document_id === "DOC_USED_OIL_GENERATOR_ID");
    assert.equal(cards.length, 0, "current BT scoping is BT_AUTO_REPAIR_SHOP only — expansion is a deliberate Darius decision");
  });
});
