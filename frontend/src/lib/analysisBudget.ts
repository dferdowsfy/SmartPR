/**
 * The interpret call must never leave the spinner up indefinitely (live
 * 2026-10-14: "Analyzing your description…" hung for over a minute). Past
 * this deadline the request is aborted and the deterministic reading below
 * takes over, exactly like any other interpret failure.
 */
export const INTERPRET_TIMEOUT_MS = 35_000;

/**
 * Pure: what is left of the ONE analysis budget that started at
 * `startedAt`. The whole analysis (request, response body, and a resume
 * after a reload) shares this single deadline, so the "we'll continue with
 * what we understood" promise holds at ~35 s of wall-clock time — never a
 * fresh 35 s per step (live 2026-10-14, E1).
 */
export function remainingInterpretBudget(startedAt: number, now: number): number {
  if (!Number.isFinite(startedAt)) return INTERPRET_TIMEOUT_MS;
  return Math.max(0, INTERPRET_TIMEOUT_MS - Math.max(0, now - startedAt));
}

/** Pure: seconds shown by the "Analyzing…" counter — monotonic from the start. */
export function analysisElapsedSeconds(startedAt: number | null, now: number): number {
  if (startedAt == null || !Number.isFinite(startedAt)) return 0;
  return Math.max(0, Math.floor((now - startedAt) / 1000));
}


