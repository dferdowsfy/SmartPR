/** Upper bound for each network step behind "Preparing requirements…". */
export const PREPARE_STEP_TIMEOUT_MS = 8_000;

/**
 * Resolve when `work` settles or after `ms`, whichever comes first. Never
 * rejects: the caller continues either way and the work keeps running in
 * the background. Used so a slow API never holds an intake spinner open.
 */
export function settleWithin<T>(work: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(undefined);
      }
    );
  });
}
