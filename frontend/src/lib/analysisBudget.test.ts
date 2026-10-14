import test from "node:test";
import assert from "node:assert/strict";
import { INTERPRET_TIMEOUT_MS, analysisElapsedSeconds, remainingInterpretBudget } from "./analysisBudget.ts";

const t0 = 1_800_000_000_000;

test("the whole analysis shares one ~35 s budget", () => {
  assert.equal(INTERPRET_TIMEOUT_MS, 35_000);
  assert.equal(remainingInterpretBudget(t0, t0), 35_000);
  assert.equal(remainingInterpretBudget(t0, t0 + 20_000), 15_000);
  // A reload at 40 s resumes with nothing left: straight to the fallback,
  // never another full 35 s wait (live 2026-10-14, E1).
  assert.equal(remainingInterpretBudget(t0, t0 + 40_000), 0);
  // Clock skew (start in the future) never grants extra time.
  assert.equal(remainingInterpretBudget(t0 + 5_000, t0), 35_000);
});

test("the elapsed counter is monotonic from the analysis start", () => {
  assert.equal(analysisElapsedSeconds(t0, t0 + 11_400), 11);
  assert.equal(analysisElapsedSeconds(t0, t0 + 12_100), 12);
  // A re-render or resumed analysis reads the same start, so it never drops back to 0.
  assert.equal(analysisElapsedSeconds(t0 - 20_000, t0), 20);
  assert.equal(analysisElapsedSeconds(null, t0), 0);
});
