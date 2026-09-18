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
});
