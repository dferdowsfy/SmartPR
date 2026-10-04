// ============================================================================
// Site regulatory layers — server-side point queries (FEMA NFHL, JP
// calificación, CRIM parcels, JP coastal zone / coastline, JP historic zones,
// protected natural areas) with per-layer timeouts, an in-memory cache and
// graceful degradation.
//
//   resolveSiteLayers(lat, lng)  never throws and never waits longer than the
//   slowest layer's timeout: a layer that is down becomes `unknown` with a
//   reason, served from the last good answer for the same point when one is
//   cached (retrieval "stale_cache").
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
  now?: () => Date;
  cache?: LayerCache;
  /** Skip the optional layers (historic zones, protected areas). */
  skipOptional?: boolean;
}

export type QueryKey = "fema_zones" | "fema_panels" | "fema_community" | "fema_lomas" | "fema_lomrs" | "advisory_1pct" | "advisory_02pct" | "landslide" | "elevation" | "jp_calificacion" | "crim" | "czm_official" | "czm_noaa" | "coastline" | "historic" | "protected";

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
  historic: { source: "jp_zonas_historicas", retryOnTimeout: false, optional: true },
  protected: { source: "jp_areas_naturales", retryOnTimeout: false, optional: true },
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
};

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
export class LayerCache {
  private map = new Map<string, CacheEntry>();
  key(layer: SiteLayerId, lat: number, lng: number): string {
    return `${layer}:${lat.toFixed(5)},${lng.toFixed(5)}`;
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

async function queryOnce(fetchImpl: FetchLike, url: string, timeoutMs: number): Promise<ArcGisQueryResponse | string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
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

export async function queryJson(fetchImpl: FetchLike, url: string, timeoutMs: number, retries: number, retryDelayMs: number, retryOnTimeout = false): Promise<ArcGisQueryResponse | string> {
  let result = await queryOnce(fetchImpl, url, timeoutMs);
  for (let i = 0; i < retries && retryable(result, retryOnTimeout); i++) {
    if (retryDelayMs > 0) await new Promise((r) => setTimeout(r, retryDelayMs));
    result = await queryOnce(fetchImpl, url, timeoutMs);
  }
  return result;
}

/**
 * Point query against a dataset: the primary endpoint, then each same-schema
 * fallback, until one ANSWERS (any JSON body, including "no features").
 * Endpoints whose circuit is open are skipped. Returns the answer plus the
 * endpoint that gave it, or the last failure reason.
 */
export async function queryDataset(
  fetchImpl: FetchLike,
  endpoints: readonly string[],
  buildUrl: (layerUrl: string) => string,
  opts: { timeoutMs: number; retries: number; retryDelayMs: number; retryOnTimeout: boolean; now?: () => number }
): Promise<{ result: ArcGisQueryResponse | string; endpoint: string | null }> {
  const now = opts.now ?? Date.now;
  // Report the PRIMARY endpoint's failure: it is the authoritative source
  // and the most useful reason for "couldn't check" (a fallback's 404 is noise).
  let first: string | null = null;
  for (const ep of endpoints) {
    if (circuitOpen(ep, now())) {
      first ??= `${healthOf(ep).lastFailure ?? "repeated_failures"} (circuit_open)`;
      continue;
    }
    const t0 = now();
    const r = await queryJson(fetchImpl, buildUrl(ep), opts.timeoutMs, opts.retries, opts.retryDelayMs, opts.retryOnTimeout);
    recordEndpoint(ep, typeof r === "string" ? r : null, now() - t0, now());
    if (typeof r !== "string") return { result: r, endpoint: ep };
    first ??= r;
  }
  const last: string = first ?? "no_endpoint";
  return { result: last, endpoint: null };
}

/**
 * Query every layer for a WGS84 point. Never throws; total latency is
 * bounded by the slowest timeout (queries run in parallel).
 */
export async function resolveSiteLayers(latitude: number, longitude: number, opts: ResolveLayersOptions = {}): Promise<SiteLayers> {
  const fetchImpl: FetchLike = opts.fetchImpl ?? ((url, init) => fetch(url, { ...init, cache: "no-store" }) as ReturnType<FetchLike>);
  const point = { latitude, longitude };
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
  const q = async (k: keyof typeof LAYER_QUERIES, extra?: Record<string, string>) => {
    const spec = LAYER_QUERIES[k];
    const { result } = await queryDataset(fetchImpl, sourceEndpoints(spec.source), (ep) => buildArcgisPointQuery(ep, point, extra), {
      timeoutMs: t(k),
      retries,
      retryDelayMs,
      retryOnTimeout: spec.retryOnTimeout,
    });
    return result;
  };

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
  const [czmNoaa, advOne, landslide, elevation, zones, panels, community, lomas, lomrs, cali, crim, czmOff, coast, hist, prot] = await Promise.all([
    want(["coastal_zone"]) ? q("czm_noaa") : null,
    want(["flood_advisory"]) ? q("advisory_1pct") : null,
    want(["terrain"]) ? readLandslidePixel(fetchImpl, point, t("landslide"), retries, retryDelayMs, opts.decodePng ?? sharpDecoder, opts.isOnLand) : null,
    want(["terrain"]) ? readElevation(fetchImpl, point, t("elevation")) : null,
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
    opts.skipOptional || !want(["historic_zone"]) ? null : q("historic"),
    opts.skipOptional || !want(["protected_area"]) ? null : q("protected"),
  ]);

  const computed: Partial<Record<SiteLayerId, SiteLayerResult>> = {};
  if (zones !== null) {
    computed.flood_zone = parseFemaFlood(zones, panels, at, { community, lomas, lomrs });
  }
  if (advOne !== null) {
    // The 0.2% layer only matters where the 1% layer has no polygon: ask it then, sparing the JP host.
    const outsideOnePct = typeof advOne !== "string" && !arcgisError(advOne) && (advOne.features ?? []).length === 0;
    const advTwo = outsideOnePct ? await q("advisory_02pct") : null;
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
  if (hist !== null) computed.historic_zone = parsePresence("historic_zone", LAYER_SOURCES.jp_zonas_historicas, hist, at, ["NOMBRE", "Nombre", "nombre", "ZONA", "Zona"]);
  if (prot !== null) computed.protected_area = parsePresence("protected_area", LAYER_SOURCES.jp_areas_naturales, prot, at, ["NOMBRE", "Nombre", "nombre", "AREA", "Name"]);

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
  isOnLand?: (p: { latitude: number; longitude: number }) => boolean
): Promise<{ rgba: number[] } | string> {
  if (isOnLand && !isOnLand(point)) return "not_on_land";
  const { row, col, x, y } = webMercatorTilePixel(point, LANDSLIDE_TILE_ZOOM);
  const url = `${LAYER_SOURCES.usgs_landslide.url}/tile/${LANDSLIDE_TILE_ZOOM}/${row}/${col}`;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let failure: string;
    try {
      const res = await fetchImpl(url, { signal: ctrl.signal });
      if (res.status === 404) return "landslide_tile_not_published";
      if (!res.ok || !res.arrayBuffer) failure = `http_${res.status}`;
      else {
        const img = await decode(await res.arrayBuffer());
        const i = (y * img.width + x) * img.channels;
        const px = Array.from(img.data.slice(i, i + img.channels));
        return { rgba: img.channels >= 4 ? px.slice(0, 4) : [...px.slice(0, 3), 255] };
      }
    } catch (err) {
      const e = err as Error;
      failure = e?.name === "AbortError" ? `timeout_${timeoutMs}ms` : `network_error: ${e?.message ?? String(err)}`.slice(0, 160);
    } finally {
      clearTimeout(timer);
    }
    if (!/^network_error|^http_5\d\d$|^http_429$|^timeout_/.test(failure) || attempt === retries) return failure;
    if (retryDelayMs > 0) await new Promise((r) => setTimeout(r, retryDelayMs));
  }
  return "landslide_unavailable";
}

const ELEVATION_SPACING_M = 15;

/**
 * USGS 3DEP elevation at the point, and slope from four samples 15 m away.
 * Best-effort: null when the service doesn't answer; slope only when all four
 * neighbours answered. Never estimated.
 */
async function readElevation(fetchImpl: FetchLike, point: { latitude: number; longitude: number }, timeoutMs: number): Promise<{ centerM: number | null; slopePct: number | null } | null> {
  const dLat = ELEVATION_SPACING_M / 111_320;
  const dLng = ELEVATION_SPACING_M / (111_320 * Math.cos((point.latitude * Math.PI) / 180));
  const at = async (lat: number, lng: number): Promise<number | null> => {
    const u = `${LAYER_SOURCES.usgs_elevation.url}?${new URLSearchParams({ x: String(lng), y: String(lat), wkid: "4326", units: "Meters", includeDate: "false" })}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(u, { signal: ctrl.signal, headers: { Accept: "application/json" } });
      if (!res.ok) return null;
      const v = Number((await res.json() as { value?: unknown })?.value);
      return Number.isFinite(v) && v > -1000 ? v : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };
  const [c, e, w, n, s] = await Promise.all([
    at(point.latitude, point.longitude),
    at(point.latitude, point.longitude + dLng),
    at(point.latitude, point.longitude - dLng),
    at(point.latitude + dLat, point.longitude),
    at(point.latitude - dLat, point.longitude),
  ]);
  if (c === null && [e, w, n, s].every((v) => v === null)) return null;
  const slope = e !== null && w !== null && n !== null && s !== null ? slopePercent({ east: e, west: w, north: n, south: s }, ELEVATION_SPACING_M) : null;
  return { centerM: c === null ? null : Math.round(c * 10) / 10, slopePct: slope };
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

export async function findNearbyLots(latitude: number, longitude: number, opts: { fetchImpl?: FetchLike; radiusM?: number; max?: number; timeoutMs?: number } = {}): Promise<SnapResult> {
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
    { timeoutMs: opts.timeoutMs ?? 6000, retries: 1, retryDelayMs: 250, retryOnTimeout: true }
  );
  if (typeof result === "string") return { latitude, longitude, candidates: [], reason: result };
  if (result.error) return { latitude, longitude, candidates: [], reason: `arcgis_error_${result.error.code ?? "unknown"}` };
  return { latitude, longitude, candidates: nearestLots(result, latitude, longitude, { max: opts.max ?? 3, maxDistanceM: radius }), reason: null };
}
