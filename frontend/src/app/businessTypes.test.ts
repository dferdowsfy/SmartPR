import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { businessTypeNamesForIndustry } from "./kb";

// The intake business-type dropdown must include KB-added types (e.g.
// BT_TIRE_RECYCLING) without dropping the existing hardcoded options.
describe("businessTypeNamesForIndustry", () => {
  it("includes Tire Recycling & Manufacturing under Manufacturing", () => {
    const names = businessTypeNamesForIndustry("Manufacturing");
    assert.ok(names && names.includes("Tire Recycling & Manufacturing"),
      `tire type missing: ${JSON.stringify(names)}`);
  });

  it("returns null for industries the KB doesn't know (hardcoded fallback)", () => {
    assert.equal(businessTypeNamesForIndustry("Some Unknown Industry"), null);
    assert.equal(businessTypeNamesForIndustry(undefined), null);
  });

  it("resolves intake labels that differ from KB industry names (alias map)", () => {
    // Regression: "Government Contractor" (intake) vs "Government Contractors"
    // (KB) — every IND_GOVCON business type was silently missing from the
    // intake dropdown, so BT-keyed rules (e.g. GL Insurance for government
    // contractors) could never fire for any user.
    const govcon = businessTypeNamesForIndustry("Government Contractor");
    assert.ok(govcon && govcon.includes("IT Government Contractor"),
      `IT gov-con type missing: ${JSON.stringify(govcon)}`);
    assert.ok(govcon && govcon.includes("Construction Government Contractor"),
      `construction gov-con type missing: ${JSON.stringify(govcon)}`);

    const tourism = businessTypeNamesForIndustry("Accommodation & Tourism");
    assert.ok(tourism && tourism.includes("Guest House"),
      `Guest House missing: ${JSON.stringify(tourism)}`);

    const nonprofit = businessTypeNamesForIndustry("Nonprofit / Religious Organization");
    assert.ok(nonprofit && nonprofit.includes("Nonprofit Organization"),
      `Nonprofit Organization missing: ${JSON.stringify(nonprofit)}`);
  });

  it("KB type names resolve in the business-type resolver", () => {
    const { discoveryQuestionsForBusinessType } = require("./kb") as typeof import("./kb");
    const qs = discoveryQuestionsForBusinessType("Tire Recycling & Manufacturing");
    assert.ok(qs && qs.length >= 8, `expected 8+ questions, got ${qs?.length}`);
  });

  it("the renewable-energy question reaches large-roof commercial BTs (warehouse use case)", () => {
    // 2026-09-18 18:00 QA cycle (S40/R1 retest): a Dorado warehouse
    // distributor with a 5-year-old LUMA net-metered rooftop array never
    // got asked the renewable question, so RULE_0610/0611 could never fire
    // and the LUMA/net-metering cards were invisible in production. The
    // question was gated to the 5 energy-industry BTs only. It now also
    // covers warehouse/distribution/logistics, manufacturing, and
    // hospitality BTs — the realistic rooftop-solar owners. The question
    // id in the flow is the questionKeyMap writeKey ("renewable_install").
    const { discoveryQuestionsForBusinessType } = require("./kb") as typeof import("./kb");
    const ids = (name: string) =>
      (discoveryQuestionsForBusinessType(name) ?? []).map((q) => q.id);
    for (const name of ["Warehouse Distributor", "Logistics Company", "Furniture Manufacturing", "Hotel", "Solar Installer"]) {
      assert.ok(ids(name).includes("renewable_install"),
        `renewable question missing for ${name}: ${JSON.stringify(ids(name))}`);
    }
  });

  it("the fuel-sales question reaches convenience stores (gas-station use case)", () => {
    // 2026-09-19 03:00 QA cycle (S54 live retest): a 15-year Trujillo Alto
    // gas station resolved to "Convenience Store" (the KB has no gas-station
    // business type) and the intake NEVER asked about fuel sales across its
    // 13 follow-up questions — Q_FUEL_SOLD was gated to 7 automotive BTs
    // only, so the fuel dimension was dropped entirely and the DACO
    // fuel-retailer registration + fuel-dispenser weights & measures cards
    // never fired (two false negatives). Same defect class as the
    // Q_RENEWABLE_INSTALL gating fix (a97bbb9): a rule's trigger question
    // must be asked of every BT that can plausibly answer yes. Convenience
    // Store is the gas-station proxy, so it now gets the question; a Yes
    // fires RULE_0654/0655 (verify_existing for existing stations) and
    // RULE_0682 (NMI honest, missing tank_type).
    const { discoveryQuestionsForBusinessType } = require("./kb") as typeof import("./kb");
    const ids = (name: string) =>
      (discoveryQuestionsForBusinessType(name) ?? []).map((q) => q.id);
    assert.ok(ids("Convenience Store").includes("Q_FUEL_SOLD"),
      `fuel-sales question missing for Convenience Store: ${JSON.stringify(ids("Convenience Store"))}`);
    // Automotive BTs keep the question (no regression on existing gating).
    for (const name of ["Auto Repair Shop", "Car Wash", "Tire Shop"]) {
      assert.ok(ids(name).includes("Q_FUEL_SOLD"),
        `fuel-sales question missing for ${name}`);
    }
  });
});
