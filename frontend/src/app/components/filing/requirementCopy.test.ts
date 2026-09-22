import { test } from "node:test";
import assert from "node:assert/strict";
import { primaryStartLabelFor, secondaryUploadCopy } from "./requirementCopy";

// REG-COPY-DTRH-001 (2026-09-22 18:00 QA, live S139): the DTRH Employer
// Registration card ("DTRH Employer Registration (Unemployment &
// Disability Insurance)") matched the generic insurance name pattern via
// the word "Insurance" and rendered "Upload proof of insurance" as its
// upload CTA. DTRH employer registration is not a commercial insurance
// policy — the copy must say registration, never insurance.
test("DTRH employer registration copy says registration, not insurance", () => {
  const name = "DTRH Employer Registration (Unemployment & Disability Insurance)";
  assert.equal(primaryStartLabelFor(name), "Complete employer registration");
  const secondary = secondaryUploadCopy(name, false);
  assert.equal(secondary.label, "Upload registration confirmation");
  assert.doesNotMatch(secondary.label + secondary.prompt, /insurance/i);
});

// The genuine insurance pattern still matches the CFSE card.
test("workers compensation insurance copy still says insurance", () => {
  const name = "Workers Compensation Insurance (CFSE)";
  const secondary = secondaryUploadCopy(name, false);
  assert.match(secondary.label, /insurance/i);
});
