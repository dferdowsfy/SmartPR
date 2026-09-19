// Regression: QA 2026-09-19 09:00 cycle (live audit S58/S59).
//
// "Which professional licenses apply?" (Q_LICENSE_TYPES) is the follow-up to
// "Will professional licenses be required for staff?"
// (professional_licenses_required). The intake asked it unconditionally —
// including right after an explicit No — forcing the user to invent an
// answer (the 9-option list has no "none" and the wizard offers no skip),
// and REL_LICENSE_TYPES_IMPLY_PROFESSIONAL_LICENSES would then derive
// Q_PROFESSIONAL_LICENSES=true, contradicting the user's explicit answer.
// The follow-up must be suppressed once the parent answer is No; flipping
// the parent back to Yes re-arms it.
// Run: npx tsx --test src/app/licenseTypesSuppression.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { isQuestionSuppressedByAnswers } from "./SmartPRIntake.tsx";

test("Q_LICENSE_TYPES is suppressed after an explicit No on professional licenses", () => {
  assert.equal(
    isQuestionSuppressedByAnswers("Q_LICENSE_TYPES", { professional_licenses_required: false }),
    true,
    "a No answer must suppress the 'which licenses' follow-up"
  );
});

test("Q_LICENSE_TYPES stays eligible after Yes or while the parent is unanswered", () => {
  assert.equal(
    isQuestionSuppressedByAnswers("Q_LICENSE_TYPES", { professional_licenses_required: true }),
    false,
    "a Yes answer keeps the follow-up"
  );
  assert.equal(
    isQuestionSuppressedByAnswers("Q_LICENSE_TYPES", {}),
    false,
    "an unanswered parent keeps the follow-up"
  );
});

test("no other question is suppressed by the professional-licenses answer", () => {
  assert.equal(
    isQuestionSuppressedByAnswers("Q_PHYSICAL_LOCATION", { professional_licenses_required: false }),
    false
  );
  assert.equal(
    isQuestionSuppressedByAnswers("professional_licenses_required", { professional_licenses_required: false }),
    false
  );
});
