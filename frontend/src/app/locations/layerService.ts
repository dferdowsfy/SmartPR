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

import {
  LAYER_SOURCES,
  CZM_BAND_M,
  arcgisError,
  arcgisPointQueryUrl,
  parseCoastalZone,
  parseCrimParcel,
  parseFemaFlood,
  LOMC_SEARCH_RADIUS_M,
  parseJpCalificacion,
  parsePresence,
  type ArcGisQueryResponse,
  type SiteLayerId,
  type SiteLayerResult,
  type SiteLayers,
} from "./layers.ts";

export type FetchLike = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

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
  retryDelayMs?: number;
  /** Per-query timeout override (ms). */
  timeoutMs?: Partial<Record<QueryKey, number>>;
  now?: () => Date;
  cache?: LayerCache;
  /** Skip the optional layers (historic zones, protected areas). */
  skipOptional?: boolean;
}

type QueryKey = "fema_zones" | "fema_panels" | "fema_community" | "fema_lomas" | "fema_lomrs" | "jp_calificacion" | "crim" | "czm_official" | "coastline" | "historic" | "protected";

/** Default timeouts (ms), sized from the latencies observed 2026-09-30 (JP ≈ 2.5–3 s, FEMA < 1 s). */
export const LAYER_TIMEOUTS_MS: Record<QueryKey, number> = {
  fema_zones: 4500,
  fema_panels: 4500,
  fema_community: 6000,
  fema_lomas: 6000,
  fema_lomrs: 6000,
  jp_calificacion: 8000,
  crim: 6000,
  czm_official: 3500,
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
  typeof r === "string" && (r.startsWith("network_error") || /^http_(5\d\d|429)$/.test(r) || (onTimeout && r.startsWith("timeout_")));

async function queryJson(fetchImpl: FetchLike, url: string, timeoutMs: number, retries: number, retryDelayMs: number, retryOnTimeout = false): Promise<ArcGisQueryResponse | string> {
  let result = await queryOnce(fetchImpl, url, timeoutMs);
  for (let i = 0; i < retries && retryable(result, retryOnTimeout); i++) {
    if (retryDelayMs > 0) await new Promise((r) => setTimeout(r, retryDelayMs));
    result = await queryOnce(fetchImpl, url, timeoutMs);
  }
  return result;
}

/**
 * Query every layer for a WGS84 point. Never throws; total latency is
 * bounded by the slowest timeout (queries run in parallel).
 */
export async function resolveSiteLayers(latitude: number, longitude: number, opts: ResolveLayersOptions = {}): Promise<SiteLayers> {
  const fetchImpl: FetchLike = opts.fetchImpl ?? ((url, init) => fetch(url, { ...init, cache: "no-store" }) as ReturnType<FetchLike>);
  const cache = opts.cache ?? sharedCache;
  const now = opts.now ?? (() => new Date());
  const t = (k: QueryKey) => opts.timeoutMs?.[k] ?? LAYER_TIMEOUTS_MS[k];
  const at = now().toISOString();
  const retries = opts.retries ?? 1;
  const retryDelayMs = opts.retryDelayMs ?? 250;
  const q = (k: QueryKey, url: string, extra?: Record<string, string>) =>
    queryJson(fetchImpl, arcgisPointQueryUrl(url, latitude, longitude, extra), t(k), retries, retryDelayMs, k === "fema_zones" || k === "fema_panels");

  // Seed the in-memory cache from the shared store: a pin resolved before a
  // restart (or on another instance) is still served fresh / stale-on-failure.
  if (opts.store) {
    const layers: SiteLayerId[] = ["flood_zone", "coastal_zone", "zoning", "land_class", "parcel", ...(opts.skipOptional ? [] : (["historic_zone", "protected_area"] as SiteLayerId[]))];
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
  const [zones, panels, community, lomas, lomrs, cali, crim, czmOff, coast, hist, prot] = await Promise.all([
    want(["flood_zone"]) ? q("fema_zones", LAYER_SOURCES.fema_flood_zones.url) : null,
    want(["flood_zone"]) ? q("fema_panels", LAYER_SOURCES.fema_firm_panels.url) : null,
    // MSC extras are best-effort: a miss never degrades the flood zone itself.
    want(["flood_zone"]) ? q("fema_community", LAYER_SOURCES.fema_communities.url) : null,
    want(["flood_zone"]) ? q("fema_lomas", LAYER_SOURCES.fema_lomas.url, near) : null,
    want(["flood_zone"]) ? q("fema_lomrs", LAYER_SOURCES.fema_lomrs.url, near) : null,
    want(["zoning", "land_class", "parcel"]) ? q("jp_calificacion", LAYER_SOURCES.jp_calificacion.url) : null,
    want(["parcel"]) ? q("crim", LAYER_SOURCES.crim_parcels.url) : null,
    want(["coastal_zone"]) ? q("czm_official", LAYER_SOURCES.jp_zona_costanera.url) : null,
    want(["coastal_zone"])
      ? q("coastline", LAYER_SOURCES.jp_linea_costa.url, { distance: String(CZM_BAND_M), units: "esriSRUnit_Meter", returnCountOnly: "true" })
      : null,
    opts.skipOptional || !want(["historic_zone"]) ? null : q("historic", LAYER_SOURCES.jp_zonas_historicas.url),
    opts.skipOptional || !want(["protected_area"]) ? null : q("protected", LAYER_SOURCES.jp_areas_naturales.url),
  ]);

  const computed: Partial<Record<SiteLayerId, SiteLayerResult>> = {};
  if (zones !== null) {
    computed.flood_zone = parseFemaFlood(zones, panels, at, { community, lomas, lomrs });
  }
  let jpCatastro: string | null = null;
  if (cali !== null) {
    const jp = parseJpCalificacion(cali, at);
    computed.zoning = jp.zoning;
    computed.land_class = jp.land_class;
    jpCatastro = jp.catastro;
  }
  if (crim !== null) computed.parcel = parseCrimParcel(crim, at, jpCatastro);
  if (czmOff !== null || coast !== null) computed.coastal_zone = parseCoastalZone(czmOff, coast, at);
  if (hist !== null) computed.historic_zone = parsePresence("historic_zone", LAYER_SOURCES.jp_zonas_historicas, hist, at, ["NOMBRE", "Nombre", "nombre", "ZONA", "Zona"]);
  if (prot !== null) computed.protected_area = parsePresence("protected_area", LAYER_SOURCES.jp_areas_naturales, prot, at, ["NOMBRE", "Nombre", "nombre", "AREA", "Name"]);

  const order: SiteLayerId[] = ["flood_zone", "coastal_zone", "zoning", "land_class", "parcel", ...(opts.skipOptional ? [] : (["historic_zone", "protected_area"] as SiteLayerId[]))];
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
