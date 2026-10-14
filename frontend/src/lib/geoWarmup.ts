/**
 * Post-start warm-up of the geo routes (E2, live loop 2026-10-14).
 *
 * The first request after a deploy used to pay for everything at once: route
 * modules loading, the Census boundary file parsing, the first TLS
 * connections to the government map servers. The first real user's parcel
 * lookup then ran ~44 s. A few seconds after the server starts, this asks the
 * three geo routes about ONE fixed, known-good pin (Caguas pueblo, the
 * site-report golden case), one after another, so that cost is paid before
 * users arrive.
 *
 * Safe by construction: read-only GETs to this same server, sequential (never
 * a burst against the government services), each bounded by a timeout, every
 * error swallowed and logged, the timer unref'd so it never holds the process
 * open. Off outside production and with SMARTPR_GEO_WARMUP=0.
 */
export const WARMUP_PIN = { latitude: 18.2341, longitude: -66.0391 } as const;
export const WARMUP_DELAY_MS = 5_000;
export const WARMUP_REQUEST_TIMEOUT_MS = 30_000;

export function geoWarmupEnabled(env: Record<string, string | undefined>): boolean {
  if (env.NEXT_RUNTIME && env.NEXT_RUNTIME !== "nodejs") return false;
  if (env.SMARTPR_GEO_WARMUP === "0") return false;
  return env.NODE_ENV === "production" || env.SMARTPR_GEO_WARMUP === "1";
}

/** The warm-up requests, in order (resolve is local; layers and parcel reach the official maps). */
export function geoWarmupUrls(port: string | number = 3000, pin: { latitude: number; longitude: number } = WARMUP_PIN): string[] {
  const q = `lat=${pin.latitude}&lng=${pin.longitude}`;
  const base = `http://127.0.0.1:${port}`;
  return [`${base}/api/locations/resolve?${q}`, `${base}/api/locations/layers?${q}`, `${base}/api/locations/parcel?${q}`];
}

type Fetch = (url: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<{ status: number; text: () => Promise<string> }>;

export interface WarmupResult { url: string; status: number | null; ms: number; error?: string }

export async function runGeoWarmup(urls: string[], fetchImpl: Fetch = fetch as unknown as Fetch, log: (line: string) => void = (l) => console.log(l)): Promise<WarmupResult[]> {
  const results: WarmupResult[] = [];
  for (const url of urls) {
    const started = Date.now();
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(WARMUP_REQUEST_TIMEOUT_MS), headers: { "user-agent": "SmartPR-warmup/1" } });
      await res.text().catch(() => "");
      results.push({ url, status: res.status, ms: Date.now() - started });
    } catch (err) {
      results.push({ url, status: null, ms: Date.now() - started, error: String((err as Error)?.message ?? err).slice(0, 120) });
    }
  }
  log(`[warmup] geo routes: ${results.map((r) => `${new URL(r.url).pathname.split("/").pop()} ${r.status ?? r.error} ${r.ms}ms`).join(" · ")}`);
  return results;
}

/** Schedule the warm-up once, WARMUP_DELAY_MS after start. Never throws. */
export function scheduleGeoWarmup(env: Record<string, string | undefined> = process.env): boolean {
  if (!geoWarmupEnabled(env)) return false;
  const timer = setTimeout(() => {
    void runGeoWarmup(geoWarmupUrls(env.PORT || 3000)).catch(() => undefined);
  }, WARMUP_DELAY_MS);
  (timer as { unref?: () => void }).unref?.();
  return true;
}
