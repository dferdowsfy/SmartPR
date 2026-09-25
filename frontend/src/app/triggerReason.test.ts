import { test } from "node:test";
import assert from "node:assert/strict";
import { translateFlagTriggerReason, translateTriggerReason } from "./triggerReason";

// REG-TRIGGER-LABEL-001 (2026-09-21 QA): live filings showed the raw
// internal "Municipality Flag = metro + Business Type = X" string on
// DRNA/EPA cards (en-US) and translated jargon ("Bandera de Municipio")
// in Spanish. The flag name is internal KB vocabulary — the label must use
// user vocabulary in both languages.
test("REG-TRIGGER-LABEL-001: municipality-flag trigger labels render in user vocabulary (EN/ES)", () => {
  const raw = "Municipality Flag = metro + Business Type = Auto Repair Shop";
  assert.equal(
    translateFlagTriggerReason(raw, "Carolina", "en"),
    "Municipality: Carolina · Business type: Auto Repair Shop",
  );
  assert.equal(
    translateFlagTriggerReason(raw, "Carolina", "es"),
    "Municipio: Carolina · Tipo de negocio: Auto Repair Shop",
  );
  // Flag-only (no business type) variant.
  assert.equal(
    translateFlagTriggerReason("Municipality Flag = tourism", "Fajardo", "en"),
    "Municipality: Fajardo",
  );
  // Non-flag reasons pass through untouched (null = not a flag trigger).
  assert.equal(translateFlagTriggerReason("Business Type = Auto Repair Shop", "Carolina", "en"), null);
  assert.equal(translateFlagTriggerReason("Question: Will alcohol be sold? | Answer: Yes", "Guaynabo", "en"), null);
  // No internal vocabulary leaks in either language.
  for (const lang of ["en", "es"] as const) {
    const label = translateFlagTriggerReason(raw, "Carolina", lang)!;
    assert.doesNotMatch(label, /Flag|Bandera/i);
  }
});

// REG-TRIGGER-LABEL-002 (2026-09-21 15:00 QA): the same defect class on the
// remaining raw engine reason shapes — "Business Type = X" (health/FDA
// cards) and "Project fact: project_type = renovation" (OGPe construction
// card), both live-reproduced on a Guaynabo brewery filing. The shared
// helper must translate them in both languages; unknown project-fact keys
// fall through (null) rather than inventing labels.
test("REG-TRIGGER-LABEL-002: business-type and project-fact trigger labels render in user vocabulary (EN/ES)", () => {
  assert.equal(
    translateTriggerReason("Business Type = Beverage Manufacturing", "Guaynabo", "en"),
    "Business type: Beverage Manufacturing",
  );
  assert.equal(
    translateTriggerReason("Business Type = Beverage Manufacturing", "Guaynabo", "es"),
    "Tipo de negocio: Beverage Manufacturing",
  );
  assert.equal(
    translateTriggerReason("Project fact: project_type = renovation", "Guaynabo", "en"),
    "Project: Renovation",
  );
  assert.equal(
    translateTriggerReason("Project fact: project_type = renovation", "Guaynabo", "es"),
    "Proyecto: Remodelación",
  );
  assert.equal(
    translateTriggerReason("Project fact: project_type = new_construction", "Dorado", "en"),
    "Project: New construction",
  );
  assert.equal(
    translateTriggerReason("Project fact: structural_work = true", "Dorado", "es"),
    "Trabajo estructural",
  );
  assert.equal(
    translateTriggerReason("Project fact: property_tenure = leased", "Dorado", "en"),
    "Leased property",
  );
  // Flag behavior is preserved through the general helper.
  assert.equal(
    translateTriggerReason("Municipality Flag = metro + Business Type = Auto Repair Shop", "Carolina", "en"),
    "Municipality: Carolina · Business type: Auto Repair Shop",
  );
  // Unknown project-fact keys fall through untouched (null).
  assert.equal(translateTriggerReason("Project fact: some_new_key = true", "Dorado", "en"), null);
  // Non-trigger reasons still pass through untouched.
  assert.equal(
    translateTriggerReason("Question: Will alcohol be sold? | Answer: Yes", "Guaynabo", "en"),
    null,
  );
  // No internal vocabulary leaks in any translated label.
  for (const lang of ["en", "es"] as const) {
    for (const reason of [
      "Business Type = Beverage Manufacturing",
      "Project fact: project_type = renovation",
      "Municipality Flag = metro + Business Type = Auto Repair Shop",
      "Municipality selected (Carolina)",
    ]) {
      const label = translateTriggerReason(reason, "Guaynabo", lang)!;
      assert.doesNotMatch(label, /Flag|Bandera/i);
      assert.doesNotMatch(label, /=/);
    }
  }
});

// REG-TRIGGER-LABEL-003 (2026-09-21 18:00 QA): the municipality-baseline
// shape "Municipality selected (<name>)" rendered raw on English cards
// (EIN, Merchant Registration, Patente, Certificate of Organization,
// Annual Report) — the i18n layer only translated it in the Spanish
// branch. It now translates in the shared helper in both languages with
// the same "Municipality: X" / "Municipio: X" vocabulary as the flag
// shape (REG-TRIGGER-LABEL-001).
test("REG-TRIGGER-LABEL-003: municipality-baseline trigger labels render in user vocabulary (EN/ES)", () => {
  assert.equal(
    translateTriggerReason("Municipality selected (Carolina)", "Carolina", "en"),
    "Municipality: Carolina",
  );
  assert.equal(
    translateTriggerReason("Municipality selected (Carolina)", "Carolina", "es"),
    "Municipio: Carolina",
  );
  assert.equal(
    translateTriggerReason("Municipality selected (Arecibo)", "Arecibo", "en"),
    "Municipality: Arecibo",
  );
  // Raw internal phrasing never survives translation in either language.
  for (const lang of ["en", "es"] as const) {
    const label = translateTriggerReason("Municipality selected (Bayamón)", "Bayamón", lang)!;
    assert.doesNotMatch(label, /selected|seleccionado/i);
    assert.doesNotMatch(label, /=/);
  }
});

test("REG-PROVENANCE-SPECIFICITY-002: change_of_use project-fact label renders in user vocabulary (EN/ES)", () => {
  assert.equal(
    translateTriggerReason("Project fact: change_of_use = true", "Guaynabo", "en"),
    "Change of use",
  );
  assert.equal(
    translateTriggerReason("Project fact: change_of_use = true", "Guaynabo", "es"),
    "Cambio de uso",
  );
});
