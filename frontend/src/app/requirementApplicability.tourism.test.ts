import test from "node:test";
import assert from "node:assert/strict";
import { classifyPotentialItem, isLodgingBusinessType } from "./requirementApplicability.ts";

test("tourism Applies on bakery stays review-condition, not Required", () => {
  const meta = classifyPotentialItem("Tourism Registration", "tourism", "applies", { businessType: "Bakery" });
  assert.equal(meta.kind, "review_condition");
  assert.equal(meta.applicability, "conditional");
  assert.equal(meta.acceptsOfficialUpload, false);
});

test("tourism Applies on Hotel stays required", () => {
  const meta = classifyPotentialItem("Tourism Registration", "tourism", "applies", { businessType: "Hotel" });
  assert.equal(meta.applicability, "required");
  assert.ok(isLodgingBusinessType("Hotel"));
});
