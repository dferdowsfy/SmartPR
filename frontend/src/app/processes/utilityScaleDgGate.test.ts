import test from "node:test";
import assert from "node:assert/strict";
import { gateUtilityScaleDgCards } from "./legacyCards.ts";
import { hasEnergySignal } from "./energyFacts.ts";

test("utility-scale Over 1 MW demotes net metering to conditional when offtake unanswered", () => {
  const out = gateUtilityScaleDgCards(
    [
      { document_id: "DOC_NET_METERING_AGREEMENT", applicability: "required", mandatory: true },
      { document_id: "DOC_LUMA_INTERCONNECTION", applicability: "required", mandatory: true },
      { document_id: "DOC_EIN", applicability: "required", mandatory: true },
    ],
    { solarSize: "Over 1 MW" },
  );
  assert.equal(out[0].applicability, "conditional");
  assert.equal(out[0].mandatory, false);
  assert.equal(out[1].applicability, "conditional");
  assert.equal(out[2].applicability, "required");
});

test("wholesale offtake marks DG cards not_applicable", () => {
  const out = gateUtilityScaleDgCards(
    [{ document_id: "DOC_NET_METERING_AGREEMENT", applicability: "required", mandatory: true }],
    { energyMarketSegment: "wholesale" },
  );
  assert.equal(out[0].applicability, "not_applicable");
});

test("F8: structural_work alone is not an energy project signal", () => {
  assert.equal(hasEnergySignal({ structural_work: true, municipality: "Cayey" }), false);
  assert.equal(hasEnergySignal({ generation_technology: "solar" }), true);
});
