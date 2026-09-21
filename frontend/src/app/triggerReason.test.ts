import { test } from "node:test";
import assert from "node:assert/strict";
import { translateFlagTriggerReason } from "./triggerReason";

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
