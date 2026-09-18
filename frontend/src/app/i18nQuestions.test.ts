// ============================================================================
// Spanish question-text coverage (2026-09-18 15:00 QA cycle, live S41).
//
// A Spanish filing rendered English question headings ("Short-term rental
// or tourism activity") and English trigger labels ("Question: Will the
// business operate from a physical location? | Respuesta derivada: Yes")
// because 62 of 90 KB question texts and 6 hardcoded flow question texts
// had no entry in the i18n ES dictionary — L() falls back to the English
// input when no ES entry exists.
//
// This test pins the invariant: every question text the intake can surface
// (every KB question + every hardcoded flow question in SmartPRIntake.tsx)
// must have a Puerto Rican Spanish entry in the ES dictionary. The trigger
// reason path (trReqReason) localizes embedded question text through L(),
// so this test guards both surfaces at once.
// ============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ES, L } from "./i18n.ts";

const here = dirname(fileURLToPath(import.meta.url));
const kbDir = join(here, "..", "kb");
const questions: Array<{ id: string; question: string }> = JSON.parse(
  readFileSync(join(kbDir, "questions.json"), "utf8")
);

// Hardcoded flow question texts in SmartPRIntake.tsx:
// { id: "...", text: "..." } entries.
const intakeSrc = readFileSync(join(here, "SmartPRIntake.tsx"), "utf8");
const hardcoded: string[] = Array.from(
  intakeSrc.matchAll(/\{\s*id:\s*"[^"]+",\s*text:\s*"((?:[^"\\]|\\.)*)"/g),
  (m) => m[1].replace(/\\"/g, '"')
);

test("every KB question text has a Puerto Rican Spanish i18n entry", () => {
  const missing = questions
    .map((q) => q.question)
    .filter((text) => !(text in ES));
  assert.deepEqual(
    missing,
    [],
    `KB question texts without an ES dictionary entry (they render English inside Spanish filings):\n${missing.join("\n")}`
  );
  // The entries must actually translate, not echo the English.
  for (const q of questions) {
    assert.notEqual(ES[q.question], q.question, `${q.id}: ES entry echoes English`);
    assert.ok(ES[q.question].length > 0, `${q.id}: empty ES entry`);
  }
});

test("every hardcoded intake question text has a Puerto Rican Spanish i18n entry", () => {
  const missing = hardcoded.filter((text) => !(text in ES));
  assert.deepEqual(
    missing,
    [],
    `hardcoded flow question texts without an ES dictionary entry:\n${missing.join("\n")}`
  );
});

test("L() renders every surfaced question in Spanish, never English fallback", () => {
  const all = [...questions.map((q) => q.question), ...hardcoded];
  for (const text of all) {
    assert.notEqual(L(text, "es"), text, `L() falls back to English for: ${text}`);
    assert.equal(L(text, "en"), text);
  }
});
