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
    assert.equal(businessTypeNamesForIndustry("Nonprofit / Religious Organization"), null);
    assert.equal(businessTypeNamesForIndustry(undefined), null);
  });

  it("KB type names resolve in the business-type resolver", () => {
    const { discoveryQuestionsForBusinessType } = require("./kb") as typeof import("./kb");
    const qs = discoveryQuestionsForBusinessType("Tire Recycling & Manufacturing");
    assert.ok(qs && qs.length >= 8, `expected 8+ questions, got ${qs?.length}`);
  });
});
