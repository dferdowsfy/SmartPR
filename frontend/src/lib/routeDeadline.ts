/**
 * Hard route-level deadline for the geo routes behind the intake and the
 * Requirements step (/api/locations/layers, /parcel, /snap).
 *
 * Each service already has an internal deadline, but on a cold server process
 * the event loop can be saturated (module loading, boundary parsing, parallel
 * government queries) and work that is not deadline-aware (a database read,
 * coverage geometry, a soils POST) can push one request far past it: the
 * parcel route was seen taking 44 s against a 23 s internal deadline. This
 * race guarantees the route ANSWERS by `ms` with a well-formed fallback
 * ("unable to verify" for every part), never a hang.
 *
 * The work is not cancelled: it keeps running and, when it finishes, its own
 * cache stores the answer, so the next request (the client's retry) is fast.
 * Never rejects: a thrown error also becomes the fallback.
 */
export interface DeadlineOutcome<T> {
  value: T;
  /** "ok", "deadline" (the race fired) or "error" (the work threw). */
  outcome: "ok" | "deadline" | "error";
  elapsedMs: number;
}

export function routeDeadlineReason(ms: number): string {
  return `route_deadline_${ms}ms`;
}

export function raceRouteDeadline<T>(
  work: () => Promise<T>,
  ms: number,
  fallback: (reason: string) => T,
  now: () => number = Date.now
): Promise<DeadlineOutcome<T>> {
  const started = now();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: T, outcome: DeadlineOutcome<T>["outcome"]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ value, outcome, elapsedMs: now() - started });
    };
    const timer = setTimeout(() => finish(fallback(routeDeadlineReason(ms)), "deadline"), ms);
    let pending: Promise<T>;
    try {
      pending = Promise.resolve(work());
    } catch (err) {
      pending = Promise.reject(err);
    }
    pending.then(
      (value) => finish(value, "ok"),
      (err: unknown) => finish(fallback(`route_error: ${String((err as Error)?.message ?? err).slice(0, 120)}`), "error")
    );
  });
}

/** Route deadlines: one second under each route's platform maxDuration. */
export const ROUTE_DEADLINE_MS = {
  /** Internal deadline 23 s (PARCEL_DEADLINE_MS); maxDuration 25 s. */
  parcel: 24_000,
  /** Internal deadline 13 s (LAYERS_DEADLINE_MS); maxDuration 15 s. */
  layers: 14_000,
  /** findNearbyLots internal deadline ~13 s; maxDuration 15 s. */
  snap: 14_000,
} as const;

/**
 * Browser-side ceiling for the intake's layers / parcel fetches: above every
 * route deadline (so the route's own "unable to verify" answer normally
 * arrives first), and only there for a server that cannot answer at all.
 * A timeout shows the "couldn't check" state with Try again, never a spinner.
 */
export const SITE_LOOKUP_CLIENT_TIMEOUT_MS = 30_000;
