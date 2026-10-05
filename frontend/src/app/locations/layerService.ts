// ============================================================================
// Site regulatory layers — server-side point queries (FEMA NFHL, JP
// calificación, CRIM parcels, JP coastal zone / coastline, JP historic zones,
// protected natural areas) with per-layer timeouts, an in-memory cache and
// graceful degradation.
//
//   resolveSiteLayers(lat, lng)  never throws. Per-layer timeouts and an
//   overall deadline (default ~13 s) bound how long we wait: a layer that is
//   down or out of budget becomes `unknown` with a reason, served from the
//   last good answer for the same point when one is cached (retrieval
//   "stale_cache").
//
// Parsing and the meaning of each answer live in layers.ts (pure).
// ============================================================================

import { nearestLots, type SnapCandidate } from "./snap.ts";
import {
  LAYER_SOURCES,
  type LayerSource,
  type LayerSourceKey,
  CZM_BAND_M,
  arcgisError,
  parseCoastalZone,
  parseCrimParcel,
  parseFemaFlood,
  parseNoaaCoastalZone,
  parseAdvisoryFlood,
  parseTerrain,
  checkSitePoint,
  buildArcgisPointQuery,
  webMercatorTilePixel,
  slopePercent,
  unknownLayer,
  LANDSLIDE_TILE_ZOOM,
  LOMC_SEARCH_RADIUS_M,
  parseJpCalificacion,
  parsePresence,
  parseProtectedArea,
  PRESENCE_NAME_FIELDS,
  sourceForEndpoint,
  type ArcGisQueryResponse,
  type SiteLayerId,
  type SiteLayerResult,
  type SiteLayers,
} from "./layers.ts";

export type FetchLike = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; arrayBuffer?(): Promise<ArrayBuffer> }>;

/** Raw RGBA(ish) pixels of a decoded PNG. */
export type DecodedImage = { width: number; height: number; channels: number; data: Uint8Array };
export type PngDecoder = (png: ArrayBuffer) => Promise<DecodedImage>;

/** Server default: sharp (already a dependency), loaded only when a tile is read. */
const sharpDecoder: PngDecoder = async (png) => {
  const sharp = (await import("sharp")).default;
  const { data, info } = await sharp(Buffer.from(png)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, channels: info.channels, data: new Uint8Array(data) };
};

/** Shared (database) second level of the cache; every method is best-effort and never throws. */
export interface LayerStore {
  load(keys: string[]): Promise<Array<{ key: string; at: number; result: SiteLayerResult }>>;
  save(entries: Array<{ key: string; at: number; latitude: number; longitude: number; result: SiteLayerResult }>): Promise<void>;
}

export interface ResolveLayersOptions {
  fetchImpl?: FetchLike;
  /** Persistent cache shared across restarts / instances (optional). */
  store?: LayerStore | null;
  /** Retries after a dropped connection or 5xx (default 1). Timeouts are retried only for the core flood queries. */
  retries?: number;
  /** "Retry" from the UI: ignore remembered failures and ask the services again. */
  refresh?: boolean;
  /** PNG decoder for the USGS landslide map tile (tests inject one). */
  decodePng?: PngDecoder;
  /** Point on land (municipio polygon)? A transparent landslide pixel means "Low" only on land. */
  isOnLand?: (p: { latitude: number; longitude: number }) => boolean;
  retryDelayMs?: number;
  /** Per-query timeout override (ms). */
  timeoutMs?: Partial<Record<QueryKey, number>>;
  /**
   * Overall wall-clock budget (ms) for the whole resolve. Retries and
   * fallbacks are skipped when the remaining budget is below the next
   * attempt's timeout. Default 13_000 (under the layers route maxDuration).
   */
  deadlineMs?: number;
  now?: () => Date;
  cache?: LayerCache;
  /** Skip the optional layers (historic zones, protected areas). */
  skipOptional?: boolean;
  /** When false, do not record into the process-wide circuit breaker (geo-health probes). */
  recordHealth?: boolean;
}

export type QueryKey = "fema_zones" | "fema_panels" | "fema_community" | "fema_lomas" | "fema_lomrs" | "advisory_1pct" | "advisory_02pct" | "landslide" | "elevation" | "jp_calificacion" | "crim" | "czm_official" | "czm_noaa" | "coastline" | "historic" | "protected" | "reserves";

/**
 * Provider registry: every ArcGIS point query SmartPR makes, declared once —
 * which dataset (and therefore which primary + same-schema fallback
 * endpoints), the per-query timeout and whether a timeout is retried. The
 * health check (scripts/geo-health.mts) and the admin page read this same
 * table, so a new layer is monitored the moment it is added here.
 */
export interface LayerQuerySpec {
  source: LayerSourceKey;
  /** Retry a timeout (core, normally-fast queries only). */
  retryOnTimeout: boolean;
  /** Best-effort: a miss never degrades a core layer. */
  optional: boolean;
  /**
   * Fields to ask the PRIMARY endpoint for (keeps the answer small); backups
   * publish a different schema and get "*".
   */
  outFields?: string;
}

export const LAYER_QUERIES: Record<Exclude<QueryKey, "landslide" | "elevation">, LayerQuerySpec> = {
  fema_zones: { source: "fema_flood_zones", retryOnTimeout: true, optional: false },
  fema_panels: { source: "fema_firm_panels", retryOnTimeout: true, optional: false },
  fema_community: { source: "fema_communities", retryOnTimeout: false, optional: true },
  fema_lomas: { source: "fema_lomas", retryOnTimeout: false, optional: true },
  fema_lomrs: { source: "fema_lomrs", retryOnTimeout: false, optional: true },
  advisory_1pct: { source: "jp_advisory_flood", retryOnTimeout: true, optional: false },
  advisory_02pct: { source: "jp_advisory_flood_02", retryOnTimeout: false, optional: false },
  jp_calificacion: { source: "jp_calificacion", retryOnTimeout: false, optional: false },
  crim: { source: "crim_parcels", retryOnTimeout: false, optional: false },
  czm_official: { source: "jp_zona_costanera", retryOnTimeout: false, optional: true },
  czm_noaa: { source: "noaa_czma", retryOnTimeout: false, optional: false },
  coastline: { source: "jp_linea_costa", retryOnTimeout: false, optional: true },
  // 2026-10-05: the old JP layers (jp_zonas_historicas / jp_areas_naturales)
  // hang > 25 s on point queries; the MIPR / Hosted copies answer < 1 s. The
  // old ones stay as backups (fallback_urls in layers.ts).
  historic: { source: "mipr_zona_historica", retryOnTimeout: false, optional: true, outFields: "ZONA,Resolucion" },
  protected: { source: "jp_areas_protegidas", retryOnTimeout: false, optional: true, outFields: "name,loc_desig,mgmt" },
  reserves: { source: "jp_reservas_naturales", retryOnTimeout: false, optional: true, outFields: "nombre_reserv,resolucion" },
};

/** Every endpoint of a dataset, primary first. */
export function sourceEndpoints(key: LayerSourceKey): string[] {
  const src: LayerSource = LAYER_SOURCES[key];
  return [src.url, ...(src.fallback_urls ?? [])];
}

// ---------------------------------------------------------------------------
// Endpoint health + circuit breaker (process-wide). A government host that
// keeps hanging (JP historic zones / protected areas hang > 30 s on point
// queries) is skipped for a cool-down instead of costing every pin its full
// timeout; the next request after the cool-down probes it again.
// ---------------------------------------------------------------------------

export interface EndpointHealth {
  url: string;
  ok: number;
  failed: number;
  consecutiveFailures: number;
  lastOkAt: number | null;
  lastFailureAt: number | null;
  lastFailure: string | null;
  lastLatencyMs: number | null;
}

const CIRCUIT_THRESHOLD = 3;
const CIRCUIT_COOLDOWN_MS = 120_000;
const endpointHealth = new Map<string, EndpointHealth>();

function healthOf(url: string): EndpointHealth {
  let h = endpointHealth.get(url);
  if (!h) {
    h = { url, ok: 0, failed: 0, consecutiveFailures: 0, lastOkAt: null, lastFailureAt: null, lastFailure: null, lastLatencyMs: null };
    endpointHealth.set(url, h);
  }
  return h;
}

function recordEndpoint(url: string, failure: string | null, latencyMs: number, at: number): void {
  const h = healthOf(url);
  h.lastLatencyMs = latencyMs;
  if (failure) {
    h.failed++;
    h.consecutiveFailures++;
    h.lastFailureAt = at;
    h.lastFailure = failure;
  } else {
    h.ok++;
    h.consecutiveFailures = 0;
    h.lastOkAt = at;
  }
}

function circuitOpen(url: string, at: number): boolean {
  const h = endpointHealth.get(url);
  return !!h && h.consecutiveFailures >= CIRCUIT_THRESHOLD && h.lastFailureAt !== null && at - h.lastFailureAt < CIRCUIT_COOLDOWN_MS;
}

/** Snapshot of every endpoint this process has called (admin page). */
export function endpointHealthSnapshot(): EndpointHealth[] {
  return [...endpointHealth.values()].map((h) => ({ ...h }));
}

/** Tests only. */
export function resetEndpointHealth(): void {
  endpointHealth.clear();
}

/** The service could not be reached / did not answer usefully (vs. it answered). */
export function isTransportFailure(r: ArcGisQueryResponse | string): r is string {
  return typeof r === "string";
}

/** Default timeouts (ms), sized from the latencies observed 2026-09-30 (JP ≈ 2.5–3 s, FEMA < 1 s). */
export const LAYER_TIMEOUTS_MS: Record<QueryKey, number> = {
  fema_zones: 4500,
  fema_panels: 4500,
  fema_community: 6000,
  fema_lomas: 6000,
  fema_lomrs: 6000,
  advisory_1pct: 8000,
  advisory_02pct: 8000,
  landslide: 6000,
  elevation: 6000,
  jp_calificacion: 8000,
  crim: 6000,
  czm_official: 3500,
  czm_noaa: 5000,
  coastline: 6000,
  historic: 3500,
  protected: 3500,
  reserves: 3500,
};

/** Identifying User-Agent for every government ArcGIS / USGS / USDA call. */
export const SMARTPR_USER_AGENT = "SmartPR/1.0 (+https://www.getsmartpr.com)";

/** Default overall budget for resolveSiteLayers (2 s under the layers route maxDuration of 15 s). */
export const LAYERS_DEADLINE_MS = 13_000;
/** Default overall budget for resolveParcelFindings (2 s under the parcel route maxDuration of 25 s). */
export const PARCEL_DEADLINE_MS = 23_000;

/**
 * Per-dataset timeout used by layers, parcel and snap so the same source
 * never gets a longer budget on one route than on another.
 */
export const SOURCE_TIMEOUTS_MS: Partial<Record<LayerSourceKey, number>> = {
  fema_flood_zones: LAYER_TIMEOUTS_MS.fema_zones,
  fema_firm_panels: LAYER_TIMEOUTS_MS.fema_panels,
  fema_communities: LAYER_TIMEOUTS_MS.fema_community,
  fema_lomas: LAYER_TIMEOUTS_MS.fema_lomas,
  fema_lomrs: LAYER_TIMEOUTS_MS.fema_lomrs,
  jp_advisory_flood: LAYER_TIMEOUTS_MS.advisory_1pct,
  jp_advisory_flood_02: LAYER_TIMEOUTS_MS.advisory_02pct,
  jp_calificacion: LAYER_TIMEOUTS_MS.jp_calificacion,
  crim_parcels: LAYER_TIMEOUTS_MS.crim,
  jp_zona_costanera: LAYER_TIMEOUTS_MS.czm_official,
  noaa_czma: LAYER_TIMEOUTS_MS.czm_noaa,
  jp_linea_costa: LAYER_TIMEOUTS_MS.coastline,
  mipr_zona_historica: LAYER_TIMEOUTS_MS.historic,
  jp_areas_protegidas: LAYER_TIMEOUTS_MS.protected,
  jp_reservas_naturales: LAYER_TIMEOUTS_MS.reserves,
  // Parcel-only JP layers: same ballpark as calificación.
  jp_put: 8000,
  jp_plan_territorial: 8000,
  mipr_sitios_historicos: 6000,
  mipr_arqueologia: 6000,
  mipr_humedales: 6000,
};

export function timeoutForSource(key: LayerSourceKey): number {
  return SOURCE_TIMEOUTS_MS[key] ?? 6000;
}

/** Whether a timeout is retried for this dataset (mirrors LAYER_QUERIES). */
export function retryOnTimeoutForSource(key: LayerSourceKey): boolean {
  for (const spec of Object.values(LAYER_QUERIES)) {
    if (spec.source === key) return spec.retryOnTimeout;
  }
  return false;
}

const FRESH_MS = 24 * 3600_000;
const STALE_MS = 30 * 24 * 3600_000;
const FAILURE_MS = 60_000;
const MAX_ENTRIES = 2000;

interface CacheEntry {
  at: number;
  ok: boolean;
  result: SiteLayerResult;
}

/** Point-keyed (≈1 m) cache of layer answers: fresh for 24 h, served stale on failure for 30 days. */
/**
 * Version of the parsed-result semantics. The caches (in memory and the
 * Postgres site_layer_cache) hold PARSED SiteLayerResults, so a parser change
 * (e.g. VIAL/AGUA → resolved NOT_A_LOT, water ≠ conservation, JP catastro
 * stand-in) would otherwise keep serving the old interpretation for up to
 * 24 h fresh / 30 days stale. Bump this whenever a parser's output for the
 * same upstream answer changes; old rows are simply never read again.
 */
// p3 (2026-10-05): historic / protected read the MIPR / Hosted layers (+ reserves).
export const LAYER_PARSER_VERSION = "p3";

export class LayerCache {
  private map = new Map<string, CacheEntry>();
  key(layer: SiteLayerId, lat: number, lng: number): string {
    return `${LAYER_PARSER_VERSION}:${layer}:${lat.toFixed(5)},${lng.toFixed(5)}`;
  }
  get(k: string): CacheEntry | undefined {
    return this.map.get(k);
  }
  set(k: string, e: CacheEntry): void {
    if (this.map.size >= MAX_ENTRIES) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.delete(k);
    this.map.set(k, e);
  }
  clear(): void {
    this.map.clear();
  }
}

const sharedCache = new LayerCache();

function remainingMs(deadlineAt: number | undefined, now: () => number): number {
  if (deadlineAt === undefined) return Number.POSITIVE_INFINITY;
  return Math.max(0, deadlineAt - now());
}

async function queryOnce(fetchImpl: FetchLike, url: string, timeoutMs: number, extraHeaders?: Record<string, string>): Promise<ArcGisQueryResponse | string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      signal: ctrl.signal,
      headers: { Accept: "application/json", "User-Agent": SMARTPR_USER_AGENT, ...extraHeaders },
    });
    if (!res.ok) return `http_${res.status}`;
    const body = (await res.json()) as ArcGisQueryResponse;
    return arcgisError(body) ?? body;
  } catch (err) {
    const e = err as Error;
    return e?.name === "AbortError" ? `timeout_${timeoutMs}ms` : `network_error: ${e?.message ?? String(err)}`.slice(0, 160);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Shared fetch with SmartPR UA, per-attempt timeout and optional circuit-breaker
 * recording. Used by landslide tiles, elevation, and other ad-hoc GETs that
 * are not ArcGIS query JSON.
 */
export async function fetchWithPolicy(
  fetchImpl: FetchLike,
  url: string,
  opts: {
    timeoutMs: number;
    headers?: Record<string, string>;
    recordUrl?: string;
    now?: () => number;
    recordHealth?: boolean;
    /** Default JSON; pass "arrayBuffer" for map tiles. */
    body?: "json" | "arrayBuffer";
  }
): Promise<{ ok: boolean; status: number; failure: string | null; json?: unknown; arrayBuffer?: ArrayBuffer }> {
  const now = opts.now ?? Date.now;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
  const t0 = now();
  const record = (failure: string | null) => {
    if (opts.recordHealth !== false && opts.recordUrl) recordEndpoint(opts.recordUrl, failure, now() - t0, now());
  };
  try {
    const res = await fetchImpl(url, {
      signal: ctrl.signal,
      headers: { Accept: "application/json", "User-Agent": SMARTPR_USER_AGENT, ...opts.headers },
    });
    if (!res.ok) {
      const failure = `http_${res.status}`;
      record(failure);
      return { ok: false, status: res.status, failure };
    }
    if (opts.body === "arrayBuffer") {
      if (!res.arrayBuffer) {
        record("no_array_buffer");
        return { ok: false, status: res.status, failure: "no_array_buffer" };
      }
      const ab = await res.arrayBuffer();
      record(null);
      return { ok: true, status: res.status, failure: null, arrayBuffer: ab };
    }
    try {
      const json = await res.json();
      record(null);
      return { ok: true, status: res.status, failure: null, json };
    } catch {
      record("unreadable_response");
      return { ok: false, status: res.status, failure: "unreadable_response" };
    }
  } catch (err) {
    const e = err as Error;
    const failure = e?.name === "AbortError" ? `timeout_${opts.timeoutMs}ms` : `network_error: ${e?.message ?? String(err)}`.slice(0, 160);
    record(failure);
    return { ok: false, status: 0, failure };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Government GIS hosts drop connections at random and sometimes stall: retry
 * those and 5xx/429. A timeout is retried only for queries that opt in (the
 * core flood zone / FIRM panel — FEMA answers in < 1 s when it answers at all,
 * so a stalled first attempt is better abandoned and re-asked).
 */
const retryable = (r: ArcGisQueryResponse | string, onTimeout: boolean) =>
  typeof r === "string" &&
  (r.startsWith("network_error") ||
    /^http_(5\d\d|429)$/.test(r) ||
    // ArcGIS reports transient server faults as HTTP 200 + error body:
    // FEMA NFHL answers "400 Failed to execute query." intermittently for
    // points it answers a second later (seen 2026-10-04); 5xx bodies too.
    /^arcgis_error_(5\d\d|400: Failed to execute query)/.test(r) ||
    (onTimeout && r.startsWith("timeout_")));

export type QueryJsonOptions = {
  deadlineAt?: number;
  now?: () => number;
};

export async function queryJson(
  fetchImpl: FetchLike,
  url: string,
  timeoutMs: number,
  retries: number,
  retryDelayMs: number,
  retryOnTimeout = false,
  opts: QueryJsonOptions = {}
): Promise<ArcGisQueryResponse | string> {
  const now = opts.now ?? Date.now;
  const budget = remainingMs(opts.deadlineAt, now);
  if (budget <= 0) return "deadline_exceeded";
  const attemptTimeout = Math.min(timeoutMs, budget);
  let result = await queryOnce(fetchImpl, url, attemptTimeout);
  for (let i = 0; i < retries && retryable(result, retryOnTimeout); i++) {
    const left = remainingMs(opts.deadlineAt, now);
    // Skip a retry when the remaining budget cannot cover another full attempt.
    if (left < Math.min(timeoutMs, 250)) break;
    if (retryDelayMs > 0) await new Promise((r) => setTimeout(r, Math.min(retryDelayMs, left)));
    const nextBudget = remainingMs(opts.deadlineAt, now);
    if (nextBudget <= 0) { result = "deadline_exceeded"; break; }
    result = await queryOnce(fetchImpl, url, Math.min(timeoutMs, nextBudget));
  }
  return result;
}

/**
 * Point query against a dataset: the primary endpoint, then each same-schema
 * fallback, until one ANSWERS (any JSON body, including "no features").
 * Endpoints whose circuit is open are skipped. Retries / fallbacks are skipped
 * when the remaining overall deadline cannot cover the next attempt.
 * Returns the answer plus the endpoint that gave it, or the last failure reason.
 */
export async function queryDataset(
  fetchImpl: FetchLike,
  endpoints: readonly string[],
  buildUrl: (layerUrl: string) => string,
  opts: {
    timeoutMs: number;
    retries: number;
    retryDelayMs: number;
    retryOnTimeout: boolean;
    now?: () => number;
    deadlineAt?: number;
    recordHealth?: boolean;
  }
): Promise<{ result: ArcGisQueryResponse | string; endpoint: string | null }> {
  const now = opts.now ?? Date.now;
  // Report the PRIMARY endpoint's failure: it is the authoritative source
  // and the most useful reason for "couldn't check" (a fallback's 404 is noise).
  let first: string | null = null;
  for (const ep of endpoints) {
    const left = remainingMs(opts.deadlineAt, now);
    if (left <= 0) {
      first ??= "deadline_exceeded";
      break;
    }
    // Not enough budget for a meaningful attempt: skip without burning the circuit.
    if (left < Math.min(opts.timeoutMs, 500)) {
      first ??= "deadline_exceeded";
      break;
    }
    if (circuitOpen(ep, now())) {
      first ??= `${healthOf(ep).lastFailure ?? "repeated_failures"} (circuit_open)`;
      continue;
    }
    const t0 = now();
    const r = await queryJson(fetchImpl, buildUrl(ep), opts.timeoutMs, opts.retries, opts.retryDelayMs, opts.retryOnTimeout, {
      deadlineAt: opts.deadlineAt,
      now,
    });
    if (opts.recordHealth !== false) recordEndpoint(ep, typeof r === "string" ? r : null, now() - t0, now());
    if (typeof r !== "string") return { result: r, endpoint: ep };
    first ??= r;
  }
  const last: string = first ?? "no_endpoint";
  return { result: last, endpoint: null };
}

/**
 * Query every layer for a WGS84 point. Never throws. Total latency is bounded
 * by `deadlineMs` (default LAYERS_DEADLINE_MS); within that budget each query
 * has its own timeout and optional retry. Queries run in parallel.
 */
export async function resolveSiteLayers(latitude: number, longitude: number, opts: ResolveLayersOptions = {}): Promise<SiteLayers> {
  const fetchImpl: FetchLike = opts.fetchImpl ?? ((url, init) => fetch(url, { ...init, cache: "no-store" }) as ReturnType<FetchLike>);
  const point = { latitude, longitude };
  const deadlineAt = Date.now() + (opts.deadlineMs ?? LAYERS_DEADLINE_MS);
  // Never send a swapped / non-Puerto-Rico pair to a government service.
  const pointCheck = checkSitePoint(point);
  if (!pointCheck.ok) {
    if (pointCheck.reason === "coordinates_look_swapped") console.warn(`[layers] rejected swapped coordinates lat=${latitude} lng=${longitude}`);
    const at0 = (opts.now ?? (() => new Date()))().toISOString();
    const ids: SiteLayerId[] = ["flood_zone", "flood_advisory", "coastal_zone", "zoning", "land_class", "parcel", "terrain"];
    return { latitude, longitude, resolved_at: at0, results: ids.map((l) => unknownLayer(l, LAYER_SOURCES.fema_flood_zones, pointCheck.reason, at0)) };
  }
  const cache = opts.cache ?? sharedCache;
  const now = opts.now ?? (() => new Date());
  const t = (k: QueryKey) => opts.timeoutMs?.[k] ?? LAYER_TIMEOUTS_MS[k];
  const at = now().toISOString();
  const retries = opts.retries ?? 1;
  const retryDelayMs = opts.retryDelayMs ?? 250;
  const qe = (k: keyof typeof LAYER_QUERIES, extra?: Record<string, string>) => {
    const spec = LAYER_QUERIES[k];
    const primary = LAYER_SOURCES[spec.source].url;
    const fields = (ep: string): Record<string, string> => (spec.outFields && ep === primary ? { outFields: spec.outFields } : {});
    return queryDataset(fetchImpl, sourceEndpoints(spec.source), (ep) => buildArcgisPointQuery(ep, point, { ...fields(ep), ...extra }), {
      timeoutMs: t(k),
      retries,
      retryDelayMs,
      retryOnTimeout: spec.retryOnTimeout,
      deadlineAt,
      recordHealth: opts.recordHealth,
    });
  };
  const q = async (k: keyof typeof LAYER_QUERIES, extra?: Record<string, string>) => (await qe(k, extra)).result;

  // Seed the in-memory cache from the shared store: a pin resolved before a
  // restart (or on another instance) is still served fresh / stale-on-failure.
  if (opts.store) {
    const layers: SiteLayerId[] = ["flood_zone", "flood_advisory", "coastal_zone", "zoning", "land_class", "parcel", "terrain", ...(opts.skipOptional ? [] : (["historic_zone", "protected_area"] as SiteLayerId[]))];
    const missing = layers.filter((l) => !cache.get(cache.key(l, latitude, longitude)));
    if (missing.length) {
      try {
        const rows = await opts.store.load(missing.map((l) => cache.key(l, latitude, longitude)));
        for (const r of rows) if (!cache.get(r.key)) cache.set(r.key, { at: r.at, ok: true, result: r.result });
      } catch {
        // best-effort
      }
    }
  }

  // Fresh cache hits skip the network entirely.
  const fresh = (layer: SiteLayerId): SiteLayerResult | null => {
    const e = cache.get(cache.key(layer, latitude, longitude));
    if (!e) return null;
    const age = now().getTime() - e.at;
    if (e.ok && age < FRESH_MS) return { ...e.result, retrieval: e.result.retrieval === "live" ? "cached" : e.result.retrieval };
    if (!e.ok && age < FAILURE_MS && !opts.refresh) return e.result;
    return null;
  };
  const want = (layers: SiteLayerId[]) => layers.some((l) => !fresh(l));

  const near = { distance: String(LOMC_SEARCH_RADIUS_M), units: "esriSRUnit_Meter" };
  const [czmNoaa, advOne, landslide, elevation, zones, panels, community, lomas, lomrs, cali, crim, czmOff, coast, hist, prot, resv] = await Promise.all([
    want(["coastal_zone"]) ? q("czm_noaa") : null,
    want(["flood_advisory"]) ? q("advisory_1pct") : null,
    want(["terrain"]) ? readLandslidePixel(fetchImpl, point, t("landslide"), retries, retryDelayMs, opts.decodePng ?? sharpDecoder, opts.isOnLand, deadlineAt, opts.recordHealth) : null,
    want(["terrain"]) ? readElevation(fetchImpl, point, t("elevation"), deadlineAt, opts.recordHealth) : null,
    want(["flood_zone"]) ? q("fema_zones") : null,
    want(["flood_zone"]) ? q("fema_panels") : null,
    // MSC extras are best-effort: a miss never degrades the flood zone itself.
    want(["flood_zone"]) ? q("fema_community") : null,
    want(["flood_zone"]) ? q("fema_lomas", near) : null,
    want(["flood_zone"]) ? q("fema_lomrs", near) : null,
    want(["zoning", "land_class", "parcel"]) ? q("jp_calificacion") : null,
    want(["parcel"]) ? q("crim") : null,
    want(["coastal_zone"]) ? q("czm_official") : null,
    want(["coastal_zone"])
      ? q("coastline", { distance: String(CZM_BAND_M), units: "esriSRUnit_Meter", returnCountOnly: "true" })
      : null,
    opts.skipOptional || !want(["historic_zone"]) ? null : qe("historic"),
    opts.skipOptional || !want(["protected_area"]) ? null : qe("protected"),
    opts.skipOptional || !want(["protected_area"]) ? null : qe("reserves"),
  ]);

  const computed: Partial<Record<SiteLayerId, SiteLayerResult>> = {};
  if (zones !== null) {
    computed.flood_zone = parseFemaFlood(zones, panels, at, { community, lomas, lomrs });
  }
  if (advOne !== null) {
    // The 0.2% layer only matters where the 1% layer has no polygon: ask it then, sparing the JP host.
    // Still honour the overall deadline so this second query cannot push us past the route budget.
    const outsideOnePct = typeof advOne !== "string" && !arcgisError(advOne) && (advOne.features ?? []).length === 0;
    const left = remainingMs(deadlineAt, Date.now);
    const advTwo = outsideOnePct && left >= Math.min(t("advisory_02pct"), 500) ? await q("advisory_02pct") : null;
    computed.flood_advisory = parseAdvisoryFlood(advOne, advTwo, at);
  }
  if (landslide !== null) computed.terrain = parseTerrain(landslide, elevation, at);
  let jpCatastro: string | null = null;
  if (cali !== null) {
    const jp = parseJpCalificacion(cali, at);
    computed.zoning = jp.zoning;
    computed.land_class = jp.land_class;
    jpCatastro = jp.catastro;
  }
  if (crim !== null) computed.parcel = parseCrimParcel(crim, at, jpCatastro);
  // NOAA's official CZMA boundary leads; the JP layer / coastline band are the fallback.
  const noaaCoastal = czmNoaa !== null ? parseNoaaCoastalZone(czmNoaa, at) : null;
  if (noaaCoastal) computed.coastal_zone = noaaCoastal;
  else if (czmOff !== null || coast !== null) computed.coastal_zone = parseCoastalZone(czmOff, coast, at);
  if (hist !== null) {
    const src = sourceForEndpoint(LAYER_SOURCES.mipr_zona_historica, hist.endpoint);
    computed.historic_zone = parsePresence("historic_zone", src, hist.result, at, [...PRESENCE_NAME_FIELDS.historic]);
  }
  if (prot !== null) {
    const protSrc = sourceForEndpoint(LAYER_SOURCES.jp_areas_protegidas, prot.endpoint);
    const resSrc = sourceForEndpoint(LAYER_SOURCES.jp_reservas_naturales, resv?.endpoint ?? null);
    computed.protected_area = parseProtectedArea(prot.result, protSrc, resv?.result ?? null, resSrc, at);
  }

  const order: SiteLayerId[] = ["flood_zone", "flood_advisory", "coastal_zone", "zoning", "land_class", "parcel", "terrain", ...(opts.skipOptional ? [] : (["historic_zone", "protected_area"] as SiteLayerId[]))];
  const results: SiteLayerResult[] = [];
  const toPersist: Array<{ key: string; at: number; latitude: number; longitude: number; result: SiteLayerResult }> = [];
  for (const layer of order) {
    const k = cache.key(layer, latitude, longitude);
    const c = computed[layer];
    if (!c) {
      const hit = fresh(layer);
      if (hit) results.push(hit);
      continue;
    }
    // A live "unknown" is a failure only when the service did not answer;
    // answered-but-unknown (no polygon) is cached like any answer.
    const failed = c.status === "unknown" && c.retrieval === "none";
    if (!failed) {
      cache.set(k, { at: now().getTime(), ok: true, result: c });
      toPersist.push({ key: k, at: now().getTime(), latitude, longitude, result: c });
      results.push(c);
      continue;
    }
    const prev = cache.get(k);
    if (prev?.ok && now().getTime() - prev.at < STALE_MS) {
      results.push({ ...prev.result, retrieval: "stale_cache", reason: `live query failed (${c.reason}); last answer from ${new Date(prev.at).toISOString()}` });
      continue;
    }
    cache.set(k, { at: now().getTime(), ok: false, result: c });
    results.push(c);
  }
  if (opts.store && toPersist.length) {
    try {
      await opts.store.save(toPersist);
    } catch {
      // best-effort
    }
  }
  return { latitude, longitude, resolved_at: at, results };
}

/**
 * USGS landslide susceptibility at the point: the official map is published
 * only as cached tiles, so read the pixel at the point (zoom 14, ≈ 9 m) and
 * match it to the map's legend. Returns the RGBA or a failure reason.
 */
async function readLandslidePixel(
  fetchImpl: FetchLike,
  point: { latitude: number; longitude: number },
  timeoutMs: number,
  retries: number,
  retryDelayMs: number,
  decode: PngDecoder,
  isOnLand?: (p: { latitude: number; longitude: number }) => boolean,
  deadlineAt?: number,
  recordHealth?: boolean
): Promise<{ rgba: number[] } | string> {
  if (isOnLand && !isOnLand(point)) return "not_on_land";
  const { row, col, x, y } = webMercatorTilePixel(point, LANDSLIDE_TILE_ZOOM);
  const url = `${LAYER_SOURCES.usgs_landslide.url}/tile/${LANDSLIDE_TILE_ZOOM}/${row}/${col}`;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const left = remainingMs(deadlineAt, Date.now);
    if (left < Math.min(timeoutMs, 500)) return "deadline_exceeded";
    const attemptTimeout = Math.min(timeoutMs, left);
    const got = await fetchWithPolicy(fetchImpl, url, { timeoutMs: attemptTimeout, recordUrl: LAYER_SOURCES.usgs_landslide.url, body: "arrayBuffer", recordHealth });
    if (got.status === 404) return "landslide_tile_not_published";
    if (got.ok && got.arrayBuffer) {
      const img = await decode(got.arrayBuffer);
      const i = (y * img.width + x) * img.channels;
      const px = Array.from(img.data.slice(i, i + img.channels));
      return { rgba: img.channels >= 4 ? px.slice(0, 4) : [...px.slice(0, 3), 255] };
    }
    const failure = got.failure ?? `http_${got.status}`;
    if (!/^network_error|^http_5\d\d$|^http_429$|^timeout_/.test(failure) || attempt === retries) return failure;
    if (retryDelayMs > 0) await new Promise((r) => setTimeout(r, Math.min(retryDelayMs, remainingMs(deadlineAt, Date.now))));
  }
  return "landslide_unavailable";
}

const ELEVATION_SPACING_M = 15;

/**
 * USGS 3DEP elevation at the point, and slope from four samples 15 m away.
 * Always returns a reason when elevation could not be read (never silently
 * vanishes). Slope only when all four neighbours answered. Never estimated.
 */
async function readElevation(
  fetchImpl: FetchLike,
  point: { latitude: number; longitude: number },
  timeoutMs: number,
  deadlineAt?: number,
  recordHealth?: boolean
): Promise<{ centerM: number | null; slopePct: number | null; reason: string | null }> {
  const dLat = ELEVATION_SPACING_M / 111_320;
  const dLng = ELEVATION_SPACING_M / (111_320 * Math.cos((point.latitude * Math.PI) / 180));
  type Sample = { value: number | null; reason: string | null };
  const at = async (lat: number, lng: number): Promise<Sample> => {
    const left = remainingMs(deadlineAt, Date.now);
    if (left < Math.min(timeoutMs, 500)) return { value: null, reason: "deadline_exceeded" };
    const u = `${LAYER_SOURCES.usgs_elevation.url}?${new URLSearchParams({ x: String(lng), y: String(lat), wkid: "4326", units: "Meters", includeDate: "false" })}`;
    const got = await fetchWithPolicy(fetchImpl, u, {
      timeoutMs: Math.min(timeoutMs, left),
      recordUrl: LAYER_SOURCES.usgs_elevation.url,
      recordHealth,
    });
    if (!got.ok) return { value: null, reason: got.failure ?? `http_${got.status}` };
    const v = Number((got.json as { value?: unknown } | undefined)?.value);
    if (!Number.isFinite(v) || v <= -1000) return { value: null, reason: "invalid_elevation_value" };
    return { value: v, reason: null };
  };
  const [c, e, w, n, s] = await Promise.all([
    at(point.latitude, point.longitude),
    at(point.latitude, point.longitude + dLng),
    at(point.latitude, point.longitude - dLng),
    at(point.latitude + dLat, point.longitude),
    at(point.latitude - dLat, point.longitude),
  ]);
  if (c.value === null && [e, w, n, s].every((v) => v.value === null)) {
    return { centerM: null, slopePct: null, reason: c.reason ?? e.reason ?? "elevation_unavailable" };
  }
  const slope =
    e.value !== null && w.value !== null && n.value !== null && s.value !== null
      ? slopePercent({ east: e.value, west: w.value, north: n.value, south: s.value }, ELEVATION_SPACING_M)
      : null;
  return {
    centerM: c.value === null ? null : Math.round(c.value * 10) / 10,
    slopePct: slope,
    reason: c.value === null ? c.reason : null,
  };
}

// ---------------------------------------------------------------------------
// Pin snapping: numbered CRIM lots near an off-lot pin
// ---------------------------------------------------------------------------

/** Search radius for "move the pin onto your lot" suggestions. */
export const SNAP_RADIUS_M = 60;

export interface SnapResult {
  latitude: number;
  longitude: number;
  candidates: SnapCandidate[];
  /** Why there are no candidates: a failure reason, or null when CRIM answered. */
  reason: string | null;
}

export async function findNearbyLots(latitude: number, longitude: number, opts: { fetchImpl?: FetchLike; radiusM?: number; max?: number; timeoutMs?: number; deadlineAt?: number } = {}): Promise<SnapResult> {
  const check = checkSitePoint({ latitude, longitude });
  if (!check.ok) return { latitude, longitude, candidates: [], reason: check.reason };
  const fetchImpl: FetchLike = opts.fetchImpl ?? ((url, init) => fetch(url, { ...init, cache: "no-store" }) as ReturnType<FetchLike>);
  const radius = Math.min(Math.max(opts.radiusM ?? SNAP_RADIUS_M, 5), 150);
  const { result } = await queryDataset(
    fetchImpl,
    sourceEndpoints("crim_parcels"),
    (ep) =>
      buildArcgisPointQuery(ep, { latitude, longitude }, {
        outFields: "NUM_CATASTRO,TIPO",
        distance: String(radius),
        units: "esriSRUnit_Meter",
        returnGeometry: "true",
        outSR: "4326",
        geometryPrecision: "7",
      }),
    {
      timeoutMs: opts.timeoutMs ?? timeoutForSource("crim_parcels"),
      retries: 1,
      retryDelayMs: 250,
      retryOnTimeout: retryOnTimeoutForSource("crim_parcels"),
      deadlineAt: opts.deadlineAt,
    }
  );
  if (typeof result === "string") return { latitude, longitude, candidates: [], reason: result };
  if (result.error) return { latitude, longitude, candidates: [], reason: `arcgis_error_${result.error.code ?? "unknown"}` };
  return { latitude, longitude, candidates: nearestLots(result, latitude, longitude, { max: opts.max ?? 3, maxDistanceM: radius }), reason: null };
}
