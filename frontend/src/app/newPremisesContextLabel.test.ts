// REG-NEW-PREMISES-MUNICIPALITY-001 — the "why this applies" label on a new
// premises in another municipality must name the NEW municipality, never the
// registered one. (2026-09-30 QA, live S308: a Cataño patente card read
// "New location for your business in Bayamón — not covered by your registered
// location" because the label read the passport's municipality.)
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { newPremisesContextLabel } from "./requirementGuidance.ts";

describe("newPremisesContextLabel", () => {
  it("names the new municipality on other-municipality premises (EN)", () => {
    const label = newPremisesContextLabel(
      ["new_premises:other_municipality"], "Cataño", "Bayamón", "en");
    assert.ok(label, "label should render");
    assert.match(label, /Cataño/);
    assert.doesNotMatch(label, /Bayamón/);
  });
  it("names the new municipality on other-municipality premises (ES)", () => {
    const label = newPremisesContextLabel(
      ["new_premises:other_municipality"], "Cataño", "Bayamón", "es");
    assert.ok(label, "label should render");
    assert.match(label, /Cataño/);
    assert.doesNotMatch(label, /Bayamón/);
  });
  it("falls back to the passport municipality only when the project one is absent", () => {
    const label = newPremisesContextLabel(
      ["new_premises:other_municipality"], null, "Bayamón", "en");
    assert.ok(label && label.includes("Bayamón"), "fallback should render");
  });
  it("keeps the same-municipality label unchanged", () => {
    const label = newPremisesContextLabel(["new_premises"], "Cataño", "Cataño", "en");
    assert.match(label ?? "", /existing permits cover your current location only/);
  });
  it("returns null when no new-premises fact is present", () => {
    assert.equal(newPremisesContextLabel([], "Cataño", "Bayamón", "en"), null);
    assert.equal(newPremisesContextLabel(undefined, "Cataño", "Bayamón", "en"), null);
  });
});
