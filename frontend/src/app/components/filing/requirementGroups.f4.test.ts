import test from "node:test";
import assert from "node:assert/strict";
import { groupRequirements } from "./requirementGroups.ts";

test("F4: Optional / Likely required / Review condition are not REQUIRED NOW", () => {
  const docs = [{ id: "DOC_A" }, { id: "DOC_B" }, { id: "DOC_C" }, { id: "DOC_D" }];
  const g = groupRequirements(
    [
      { documentId: "DOC_A", applicability: "required", mandatory: true, done: false, awaitingAnswer: false },
      { documentId: "DOC_B", applicability: "likely_required", mandatory: false, done: false, awaitingAnswer: false },
      { documentId: "DOC_C", applicability: "recommended", mandatory: false, done: false, awaitingAnswer: false },
      { documentId: "DOC_D", applicability: "required", kind: "review_condition", mandatory: true, done: false, awaitingAnswer: false },
    ],
    docs,
  );
  assert.equal(g[0].group, "required_now");
  assert.equal(g[1].group, "conditional");
  assert.equal(g[2].group, "conditional");
  assert.equal(g[3].group, "conditional");
});
