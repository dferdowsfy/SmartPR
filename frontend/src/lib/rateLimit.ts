// Best-effort, single-process rate limiting for upload-style routes. This is
// an in-memory sliding window: it resets on deploy/restart and does not
// coordinate across multiple server instances. It exists to blunt obvious
// abuse (a runaway client hammering an upload endpoint), not as a substitute
// for a real distributed limiter (e.g. Upstash/Redis) if this app scales to
// multiple instances — swap the implementation, keep the call sites.

interface Bucket {
  count: number;
  windowStart: number;
}

const buckets = new Map<string, Bucket>();

// Periodic sweep so long-lived processes don't accumulate one entry per
// distinct key forever, plus a hard cap: a flood of distinct keys (spoofed
// IPs) inside one sweep interval must not grow the map without bound.
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;
const MAX_BUCKETS = 5_000;
let lastSweep = Date.now();

function sweep(now: number, windowMs: number) {
  if (now - lastSweep < SWEEP_INTERVAL_MS && buckets.size < MAX_BUCKETS) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    if (now - bucket.windowStart > windowMs) buckets.delete(key);
  }
  // Still full of live windows: evict the oldest (Map keeps insertion order).
  while (buckets.size >= MAX_BUCKETS) {
    const oldest = buckets.keys().next().value;
    if (oldest === undefined) break;
    buckets.delete(oldest);
  }
}

/**
 * Rate-limit key for the calling client: `${routePrefix}:${ip}`. Prefers the
 * address our hosting proxy sets (Railway, then Vercel), then x-real-ip, then
 * the first hop of x-forwarded-for; capped at 64 characters so a forged header
 * cannot make keys arbitrarily large.
 */
export function getClientIpKey(headers: Headers, routePrefix: string): string {
  const first = (v: string | null) => v?.split(",")[0]?.trim() || "";
  const ip =
    first(headers.get("x-railway-forwarded-for")) ||
    first(headers.get("x-vercel-forwarded-for")) ||
    first(headers.get("x-real-ip")) ||
    first(headers.get("x-forwarded-for")) ||
    "unknown";
  return `${routePrefix}:${ip.slice(0, 64)}`;
}

/** For tests: drop all buckets. */
export function _resetRateLimitForTests() {
  buckets.clear();
  lastSweep = Date.now();
}

/** For tests: current number of tracked keys. */
export function _rateLimitBucketCount(): number {
  return buckets.size;
}

/**
 * Returns true if `key` is still within `limit` calls per `windowMs`.
 * Call once per request; a false result means the caller should be refused.
 */
export function rateLimitAllow(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  sweep(now, windowMs);
  const existing = buckets.get(key);
  if (!existing || now - existing.windowStart > windowMs) {
    buckets.set(key, { count: 1, windowStart: now });
    return true;
  }
  if (existing.count >= limit) return false;
  existing.count += 1;
  return true;
}
