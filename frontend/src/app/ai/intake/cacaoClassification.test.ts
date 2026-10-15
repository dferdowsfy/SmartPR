// Live Run 5 I1 / Run 6: cacao processing must not auto-classify as Café.
import test from "node:test";
import assert from "node:assert/strict";
import { validateInterpretation } from "./validateInterpretation.ts";
import { buildKbCandidates } from "./kbCandidates.ts";
import { KB } from "../../kb.ts";

test("cacao processing workshop drops BT_CAFE even at high confidence", () => {
  const validated = validateInterpretation(
    {
      summary: "Cacao processing with farm stand",
      businessType: { id: "BT_CAFE", name: "Cafe", confidence: 0.95, evidence: "cacao" },
    },
    KB,
    { description: "Opening a new cacao processing workshop with farm stand in Adjuntas pueblo" }
  );
  assert.equal(validated.businessType, undefined);
  assert.ok(
    validated.discarded.some((d) => d.field === "businessType" && /cacao/i.test(d.reason)),
    `expected cacao discard, got ${JSON.stringify(validated.discarded)}`
  );
});

test("real coffee shop still accepts BT_CAFE", () => {
  const validated = validateInterpretation(
    {
      summary: "Coffee shop",
      businessType: { id: "BT_CAFE", name: "Cafe", confidence: 0.95, evidence: "coffee shop" },
    },
    KB,
    { description: "Opening a new coffee shop in Adjuntas pueblo" }
  );
  assert.equal(validated.businessType?.id, "BT_CAFE");
});

test("cacao description surfaces Food Manufacturing / Farm candidates", () => {
  const c = buildKbCandidates(KB, "Opening a new cacao processing workshop with farm stand in Adjuntas");
  const ids = new Set(c.businessTypes.map((b) => b.id));
  assert.ok(ids.has("BT_FOOD_MANUFACTURING") || ids.has("BT_FARM"), `got ${[...ids].join(",")}`);
  // Café may still be a weak synonym hit via unrelated tokens; the validator
  // is the hard gate. Prefer that manufacturing/farm are present.
});
