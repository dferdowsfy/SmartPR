// Regression test for REG-LIVE-RESUME-BROKEN-001 (2026-10-05 QA, live S436 follow-up).
// Run: npx tsx --test src/app/entryReset.test.ts
//
// The ?entry=new-business slate reset (authenticated portfolio's “File a New
// Business” action) must not run when ?resume=<id> is present: every resume
// link in the app is /?entry=new-business&resume=<id> (Submission History,
// business pages, filing panel), and the reset was wiping the hydrated draft —
// resume rendered a blank intake or a checklist recomputed from empty answers.
import test from "node:test";
import assert from "node:assert/strict";

import { shouldApplyNewBusinessEntryReset } from "./entryReset.ts";

test("entryReset: plain ?entry=new-business resets the slate", () => {
  assert.equal(shouldApplyNewBusinessEntryReset("?entry=new-business"), true);
});

test("entryReset: resume links never reset (entry + resume)", () => {
  assert.equal(shouldApplyNewBusinessEntryReset("?entry=new-business&resume=50748b96-1ac9-4e0c-aee3-ade8c0a64e30"), false);
  assert.equal(shouldApplyNewBusinessEntryReset("?resume=abc123&entry=new-business"), false);
});

test("entryReset: resume without entry never resets", () => {
  assert.equal(shouldApplyNewBusinessEntryReset("?resume=abc123"), false);
});

test("entryReset: Clara return (?business=) never resets", () => {
  assert.equal(shouldApplyNewBusinessEntryReset("?entry=new-business&business=biz_1"), false);
  assert.equal(shouldApplyNewBusinessEntryReset("?business=biz_1"), false);
});

test("entryReset: no entry param never resets", () => {
  assert.equal(shouldApplyNewBusinessEntryReset(""), false);
  assert.equal(shouldApplyNewBusinessEntryReset("?foo=bar"), false);
});
