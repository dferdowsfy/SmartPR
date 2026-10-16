// ============================================================================
// Geocoding — provider abstraction (server side only).
//
// SmartPR's domain model never depends on a geocoder: coordinates the user
// confirms on the map are the authoritative fact, and anything a provider
// returns is labeled provider-derived metadata.
//
// Default: OSMF's public Nominatim, used within its usage policy
// (https://operations.osmfoundation.org/policies/nominatim/): an identifying
// User-Agent, at most one upstream request per second from this process, and
// results cached. That suits low-volume interactive use; for higher traffic
// point MAP_GEOCODING_BASE_URL at a self-hosted or commercial
// Nominatim-compatible API (LocationIQ, etc.).
//
// Configuration (all server-side; nothing here is exposed to the browser):
//   MAP_GEOCODING_PROVIDER      "nominatim" (default) or "off" to disable.
//   MAP_GEOCODING_BASE_URL      API root (default https://nominatim.openstreetmap.org)
//   MAP_GEOCODING_API_KEY       Optional key, sent as `key=` (LocationIQ-style).
//   MAP_GEOCODING_USER_AGENT    Identifying User-Agent (required by OSMF policy).
//   MAP_GEOCODING_EMAIL         Optional contact email passed as `email=`.
//   MAP_GEOCODING_FALLBACK      "photon" (default) or "off". Photon (komoot's
//                               public OSM geocoder) answers when Nominatim
//                               errors, is rate limited, or finds nothing.
//   MAP_GEOCODING_PHOTON_URL    Photon API root (default https://photon.komoot.io).
//
// Provider chain (fallbackGeocoder): CRIM catastro-number lookup (exact,
// authoritative for "225-044-031-13"-style queries) → Nominatim → Photon.
// Every candidate carries its own place_source; attributionFor() gives the
// credit line the UI must show for OSM-derived results (ODbL).
//
// Adding another provider = implement GeocodingProvider and register it in
// geocoderFromEnv(); callers and the stored data model do not change.
// ============================================================================

import { PUERTO_RICO_BOUNDS, validateCoordinates } from "../../app/locations/geo.ts";
import { queryDataset, sourceEndpoints } from "../../app/locations/layerService.ts";
import { interiorPoint } from "../../app/locations/snap.ts";
import { addressMunicipio, sameMunicipio } from "../../app/locations/municipios.ts";

/** A normalized geocoder result. Coordinates are WGS84. */
export interface GeocodeCandidate {
  latitude: number;
  longitude: number;
  formatted_address: string | null;
  address_line_1: string | null;
  city: string | null;
  municipality: string | null;
  state_or_region: string | null;
  postal_code: string | null;
  country_code: string | null;
  /** Provider id, persisted as locations.place_source. */
  place_source: string;
  /** Provider's own id for the place, persisted as locations.place_source_id. */
  place_source_id: string | null;
}

/** Credit line required by the data licence of a candidate's provider. */
export function attributionFor(placeSource: string | null | undefined): string | null {
  if (placeSource === "nominatim" || placeSource === "photon") return "© OpenStreetMap contributors (ODbL)";
  if (placeSource === "crim_catastro") return "CRIM — Catastro digital (vía JP SIGE)";
  return null;
}

export interface GeocodingProvider {
  id: string;
  search(query: string, opts?: { limit?: number; lang?: string }): Promise<GeocodeCandidate[]>;
  reverse(latitude: number, longitude: number, opts?: { lang?: string }): Promise<GeocodeCandidate | null>;
}

export class GeocodingError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "GeocodingError";
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

// ---------------------------------------------------------------------------
// Nominatim-compatible adapter
// ---------------------------------------------------------------------------

interface NominatimAddress {
  house_number?: string;
  road?: string;
  neighbourhood?: string;
  suburb?: string;
  hamlet?: string;
  village?: string;
  town?: string;
  city?: string;
  municipality?: string;
  county?: string;
  state?: string;
  postcode?: string;
  country_code?: string;
  "ISO3166-2-lvl4"?: string;
}

interface NominatimPlace {
  place_id?: number | string;
  osm_type?: string;
  osm_id?: number | string;
  lat?: string;
  lon?: string;
  display_name?: string;
  address?: NominatimAddress;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** "Guaynabo Municipio" / "Municipio de Guaynabo" → "Guaynabo". */
export function stripMunicipioSuffix(name: string | null): string | null {
  if (!name) return null;
  const cleaned = name
    .replace(/^municipio\s+(autónomo\s+)?de\s+/i, "")
    .replace(/\s+(municipio|municipality)$/i, "")
    .trim();
  return cleaned || null;
}

/**
 * Normalize one Nominatim place. Puerto Rico is reported by OSM as part of
 * the US (country_code "us", ISO3166-2 "US-PR"); it is normalized to its own
 * ISO 3166-1 code "PR" so the stored country is unambiguous.
 */
export function normalizeNominatimPlace(place: NominatimPlace, providerId: string): GeocodeCandidate | null {
  const coords = validateCoordinates(place.lat, place.lon);
  if (!coords.ok) return null;
  const a = place.address ?? {};
  const isPR = a["ISO3166-2-lvl4"] === "US-PR" || /^puerto rico$/i.test(a.state ?? "");
  const street = [text(a.house_number), text(a.road)].filter(Boolean).join(" ") || null;
  const city = text(a.city) ?? text(a.town) ?? text(a.village) ?? text(a.hamlet);
  // In PR, OSM's county level (admin_level 6) is the municipio.
  const municipality = stripMunicipioSuffix(text(a.county) ?? text(a.municipality) ?? (isPR ? city : null));
  const countryCode = isPR ? "PR" : text(a.country_code)?.toUpperCase() ?? null;
  const osmRef = place.osm_type && place.osm_id != null ? `${place.osm_type}/${place.osm_id}` : null;
  return {
    latitude: coords.latitude,
    longitude: coords.longitude,
    formatted_address: text(place.display_name),
    address_line_1: street,
    city,
    municipality,
    state_or_region: isPR ? "PR" : text(a.state),
    postal_code: text(a.postcode),
    country_code: countryCode && /^[A-Z]{2}$/.test(countryCode) ? countryCode : null,
    place_source: providerId,
    place_source_id: osmRef ?? (place.place_id != null ? String(place.place_id) : null),
  };
}

export interface NominatimConfig {
  baseUrl: string;
  apiKey?: string | null;
  userAgent: string;
  email?: string | null;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
}

export function nominatimProvider(config: NominatimConfig): GeocodingProvider {
  const base = config.baseUrl.replace(/\/+$/, "");
  const doFetch: FetchLike = config.fetchImpl ?? ((input, init) => fetch(input, init));
  const providerId = "nominatim";

  async function call(path: string, params: Record<string, string>, lang?: string): Promise<unknown> {
    const url = new URL(`${base}/${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("addressdetails", "1");
    if (config.apiKey) url.searchParams.set("key", config.apiKey);
    if (config.email) url.searchParams.set("email", config.email);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs ?? 6000);
    try {
      const res = await doFetch(url.toString(), {
        headers: {
          "User-Agent": config.userAgent,
          Accept: "application/json",
          ...(lang ? { "Accept-Language": lang } : {}),
        },
        signal: controller.signal,
        cache: "no-store",
      });
      if (!res.ok) throw new GeocodingError(`provider_http_${res.status}`, res.status);
      return await res.json();
    } catch (err) {
      if (err instanceof GeocodingError) throw err;
      throw new GeocodingError((err as Error).name === "AbortError" ? "provider_timeout" : "provider_unreachable");
    } finally {
      clearTimeout(timer);
    }
  }

  const b = PUERTO_RICO_BOUNDS;
  return {
    id: providerId,
    async search(query, opts = {}) {
      const body = await call(
        "search",
        {
          q: query,
          limit: String(Math.min(Math.max(opts.limit ?? 5, 1), 10)),
          // Strongly bias to Puerto Rico (SmartPR's current jurisdiction).
          viewbox: `${b.west},${b.north},${b.east},${b.south}`,
          bounded: "1",
        },
        opts.lang
      );
      if (!Array.isArray(body)) return [];
      return body
        .map((p) => normalizeNominatimPlace(p as NominatimPlace, providerId))
        .filter((c): c is GeocodeCandidate => c !== null);
    },
    async reverse(latitude, longitude, opts = {}) {
      const body = (await call(
        "reverse",
        { lat: String(latitude), lon: String(longitude), zoom: "18" },
        opts.lang
      )) as NominatimPlace & { error?: string };
      if (!body || typeof body !== "object" || body.error) return null;
      return normalizeNominatimPlace(body, providerId);
    },
  };
}

// ---------------------------------------------------------------------------
// Photon adapter (komoot's public OSM geocoder) — fallback
// ---------------------------------------------------------------------------

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    osm_type?: string; osm_id?: number | string; name?: string; housenumber?: string; street?: string;
    locality?: string; district?: string; city?: string; county?: string; state?: string; postcode?: string; countrycode?: string;
  };
}

export function normalizePhotonFeature(f: PhotonFeature): GeocodeCandidate | null {
  const c = f.geometry?.coordinates;
  if (!Array.isArray(c)) return null;
  const coords = validateCoordinates(c[1], c[0]);
  if (!coords.ok) return null;
  const p = f.properties ?? {};
  const isPR = /^puerto rico$/i.test(p.state ?? "");
  const street = [text(p.housenumber), text(p.street)].filter(Boolean).join(" ") || null;
  const name = text(p.name);
  const city = text(p.city) ?? text(p.locality);
  const municipality = stripMunicipioSuffix(text(p.county) ?? (isPR ? city : null));
  const parts = [name, street && street !== name ? street : null, text(p.district), city, isPR ? "Puerto Rico" : text(p.state), text(p.postcode)].filter(Boolean);
  const countryCode = isPR ? "PR" : text(p.countrycode)?.toUpperCase() ?? null;
  return {
    latitude: coords.latitude,
    longitude: coords.longitude,
    formatted_address: parts.length ? [...new Set(parts)].join(", ") : null,
    address_line_1: street ?? name,
    city,
    municipality,
    state_or_region: isPR ? "PR" : text(p.state),
    postal_code: text(p.postcode),
    country_code: countryCode && /^[A-Z]{2}$/.test(countryCode) ? countryCode : null,
    place_source: "photon",
    place_source_id: p.osm_type && p.osm_id != null ? `${({ N: "node", W: "way", R: "relation" } as Record<string, string>)[p.osm_type] ?? p.osm_type}/${p.osm_id}` : null,
  };
}

export function photonProvider(config: { baseUrl: string; userAgent: string; timeoutMs?: number; fetchImpl?: FetchLike }): GeocodingProvider {
  const base = config.baseUrl.replace(/\/+$/, "");
  const doFetch: FetchLike = config.fetchImpl ?? ((input, init) => fetch(input, init));
  async function call(path: string, params: Record<string, string>): Promise<PhotonFeature[]> {
    const url = new URL(`${base}/${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs ?? 6000);
    try {
      const res = await doFetch(url.toString(), { headers: { "User-Agent": config.userAgent, Accept: "application/json" }, signal: controller.signal, cache: "no-store" });
      if (!res.ok) throw new GeocodingError(`provider_http_${res.status}`, res.status);
      const body = (await res.json()) as { features?: PhotonFeature[] };
      return Array.isArray(body?.features) ? body.features : [];
    } catch (err) {
      if (err instanceof GeocodingError) throw err;
      throw new GeocodingError((err as Error).name === "AbortError" ? "provider_timeout" : "provider_unreachable");
    } finally {
      clearTimeout(timer);
    }
  }
  const b = PUERTO_RICO_BOUNDS;
  // Photon supports default/en/de/fr only: Spanish uses the default (local) names.
  const langParam = (lang?: string): Record<string, string> => (lang === "en" ? { lang: "en" } : {});
  return {
    id: "photon",
    async search(query, opts = {}) {
      const features = await call("api/", { q: query, limit: String(Math.min(Math.max(opts.limit ?? 5, 1), 10)), bbox: `${b.west},${b.south},${b.east},${b.north}`, ...langParam(opts.lang) });
      return features.map(normalizePhotonFeature).filter((c): c is GeocodeCandidate => c !== null && c.country_code === "PR");
    },
    async reverse(latitude, longitude, opts = {}) {
      const features = await call("reverse", { lat: String(latitude), lon: String(longitude), ...langParam(opts.lang) });
      const first = features.map(normalizePhotonFeature).find((c) => c !== null) ?? null;
      return first;
    },
  };
}

// ---------------------------------------------------------------------------
// CRIM catastro-number lookup ("225-044-031-13") — exact, authoritative
// ---------------------------------------------------------------------------

/** "225-044-031-13", "225 044 031 13", "22504403113" → "225-044-031-13". */
export function normalizeCatastroQuery(q: string): string | null {
  const t = q.trim().toUpperCase().replace(/^(CATASTRO|N[UÚ]M(ERO)?\.?\s*DE\s*CATASTRO)[:#\s]*/i, "");
  const m = /^(\d{3})[-\s.]?(\d{3})[-\s.]?(\d{3})[-\s.]?([0-9A-Z]{2,3})$/.exec(t);
  return m ? `${m[1]}-${m[2]}-${m[3]}-${m[4]}` : null;
}

/** Shared CRIM parcel endpoints (same list as LAYER_SOURCES.crim_parcels / layers + snap). */
export const CRIM_PARCEL_ENDPOINTS: readonly string[] = sourceEndpoints("crim_parcels");

/** A point guaranteed inside the parcel (not the centroid, which can fall outside an L-shaped lot). */
function ringCentre(rings: Array<Array<[number, number]>>): [number, number] | null {
  return interiorPoint(rings);
}

export function crimCatastroProvider(config: { endpoints?: readonly string[]; timeoutMs?: number; fetchImpl?: FetchLike } = {}): GeocodingProvider {
  const doFetch: FetchLike = config.fetchImpl ?? ((input, init) => fetch(input, init));
  const endpoints = config.endpoints ?? sourceEndpoints("crim_parcels");
  return {
    id: "crim_catastro",
    async search(query) {
      const num = normalizeCatastroQuery(query);
      if (!num) return [];
      // Same shared client as layers / parcel (UA, circuit breaker, timeouts).
      const { result } = await queryDataset(
        doFetch as Parameters<typeof queryDataset>[0],
        endpoints,
        (ep) =>
          `${ep}/query?${new URLSearchParams({
            where: `NUM_CATASTRO='${num}'`,
            outFields: "NUM_CATASTRO,TIPO",
            returnGeometry: "true",
            outSR: "4326",
            geometryPrecision: "7",
            f: "json",
          }).toString()}`,
        {
          timeoutMs: config.timeoutMs ?? 6000,
          retries: 0,
          retryDelayMs: 0,
          retryOnTimeout: false,
        }
      );
      if (typeof result === "string") {
        if (result.startsWith("timeout_")) throw new GeocodingError("provider_timeout");
        if (result.startsWith("http_")) {
          const code = Number(result.slice(5));
          throw new GeocodingError(`provider_http_${code}`, Number.isFinite(code) ? code : undefined);
        }
        throw new GeocodingError("provider_unreachable");
      }
      const body = result as { error?: unknown; features?: Array<{ geometry?: { rings?: Array<Array<[number, number]>> } }> };
      if (body.error || !Array.isArray(body.features)) throw new GeocodingError("provider_error");
      const f = body.features.find((x) => Array.isArray(x.geometry?.rings));
      const c = f?.geometry?.rings ? ringCentre(f.geometry.rings) : null;
      if (!c) return [];
      const coords = validateCoordinates(c[1], c[0]);
      if (!coords.ok) return [];
      return [{
        latitude: coords.latitude, longitude: coords.longitude,
        formatted_address: `Catastro ${num}`, address_line_1: null, city: null, municipality: null,
        state_or_region: "PR", postal_code: null, country_code: "PR",
        place_source: "crim_catastro", place_source_id: num,
      }];
    },
    async reverse() {
      return null;
    },
  };
}

// ---------------------------------------------------------------------------
// Fallback chain
// ---------------------------------------------------------------------------

/**
 * Ask providers in order; the first non-empty answer wins. A provider that
 * errors (down, rate limited, timeout) or finds nothing passes to the next.
 * Throws when ANY provider errored and none returned results — a partial
 * outage must not look like "address not found".
 */
export function fallbackGeocoder(providers: GeocodingProvider[]): GeocodingProvider {
  const run = async <T>(call: (p: GeocodingProvider) => Promise<T>, empty: (v: T) => boolean, none: T): Promise<T> => {
    let firstErr: unknown = null;
    let errors = 0;
    for (const p of providers) {
      try {
        const v = await call(p);
        if (!empty(v)) return v;
      } catch (err) {
        errors++;
        firstErr ??= err;
        console.warn(`[geocode] ${p.id} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    // Partial outage (some errored, others empty) ≠ "nothing found".
    if (errors > 0 && firstErr) throw firstErr instanceof GeocodingError ? firstErr : new GeocodingError("provider_partial_outage");
    return none;
  };
  return {
    id: providers.map((p) => p.id).join("+"),
    search: (query, opts) => run((p) => p.search(query, opts), (v) => v.length === 0, [] as GeocodeCandidate[]),
    reverse: (lat, lng, opts) => run((p) => p.reverse(lat, lng, opts), (v) => v === null, null as GeocodeCandidate | null),
  };
}

// ---------------------------------------------------------------------------
// Named-municipio preference
// ---------------------------------------------------------------------------

/** The municipio a candidate sits in (its field, else the one its address names). */
function candidateMunicipio(c: GeocodeCandidate): string | null {
  return c.municipality ?? addressMunicipio(c.formatted_address);
}

/**
 * Search, keeping the municipio the query names. A query such as "Calle
 * Comercio, Peñuelas, Puerto Rico" names Peñuelas in its trailing segments;
 * fuzzy providers (Photon) can rank "Calle Peñuelas, Caguas" first, and the
 * picker pins the first result — so the whole report moved to Caguas (live
 * Run 12). Candidates in the named municipio move to the front (stable). When
 * none is in it, the municipio itself is searched once and its in-municipio
 * match leads, so the pin lands in the place the user named (they can still
 * drag it or pick another match). Queries that name no municipio are untouched.
 */
export async function searchInNamedMunicipio(
  geocoder: Pick<GeocodingProvider, "search">,
  query: string,
  opts: {
    limit?: number;
    lang?: string;
    /**
     * Official municipio for a point (Census TIGER boundaries). When given,
     * the coordinates decide, not the provider's label: OSM can label a
     * road point "Utuado" while it sits on the Utuado–Lares line and the
     * official map (which drives the report) puts it in Lares (live Run 14).
     */
    locate?: (latitude: number, longitude: number) => string | null;
  } = {}
): Promise<GeocodeCandidate[]> {
  const { locate, ...searchOpts } = opts;
  const results = await geocoder.search(query, searchOpts);
  const named = addressMunicipio(query);
  if (!named) return results;
  const inNamed = (c: GeocodeCandidate) => {
    const official = locate ? locate(c.latitude, c.longitude) : null;
    const m = official ?? candidateMunicipio(c);
    return !!m && sameMunicipio(m, named);
  };
  const inside = results.filter(inNamed);
  const outside = results.filter((c) => !inNamed(c));
  if (inside.length) return [...inside, ...outside];
  const plain = `${named}, Puerto Rico`;
  if (query.trim().toLowerCase() === plain.toLowerCase()) return results;
  const fallback = await geocoder.search(plain, { ...searchOpts, limit: 3 }).catch(() => [] as GeocodeCandidate[]);
  const lead = fallback.find(inNamed);
  return lead ? [lead, ...outside].slice(0, Math.max(opts.limit ?? 5, 1)) : results;
}

// ---------------------------------------------------------------------------
// Throttle + cache (process-wide)
// ---------------------------------------------------------------------------

/**
 * Reserves the next upstream request slot and returns how long (ms) the
 * caller must wait before sending. Shared reservers (see slots.ts) coordinate
 * every server instance; returning null or throwing falls back to the
 * per-process reservation.
 */
export type SlotReserver = () => Promise<number | null>;

export interface PoliteOptions {
  /** Minimum spacing between upstream requests (ms). */
  minIntervalMs: number;
  /** Cross-instance slot reservation (e.g. Postgres). Optional. */
  reserve?: SlotReserver;
  /** Give up (error) instead of queueing longer than this (ms). */
  maxWaitMs?: number;
  cacheTtlMs?: number;
  cacheMax?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Wrap a provider so upstream calls are spaced at least `minIntervalMs`
 * apart — across all instances when a shared `reserve` is given, otherwise
 * within this process — and identical queries (reverse lookups rounded to
 * ~1 m) are answered from an in-memory cache. Failures are not cached. A
 * call that would queue longer than `maxWaitMs` fails fast with
 * `GeocodingError("rate_limited")` instead of hanging the request.
 */
export function politeProvider(inner: GeocodingProvider, opts: PoliteOptions): GeocodingProvider {
  const now = opts.now ?? (() => Date.now());
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const ttl = opts.cacheTtlMs ?? 24 * 60 * 60 * 1000;
  const max = opts.cacheMax ?? 1000;
  const cache = new Map<string, { at: number; value: unknown }>();
  const maxWait = opts.maxWaitMs ?? 10_000;
  let nextLocalSlot = -Infinity;

  /** Per-process reservation: claim the next free slot synchronously. */
  function reserveLocal(): number {
    const slot = Math.max(nextLocalSlot, now());
    nextLocalSlot = slot + opts.minIntervalMs;
    return slot - now();
  }

  async function reserve(): Promise<number> {
    if (opts.reserve) {
      try {
        const wait = await opts.reserve();
        if (wait !== null && Number.isFinite(wait)) {
          // Keep the local schedule at least as strict as the shared one.
          nextLocalSlot = Math.max(nextLocalSlot, now() + Math.max(wait, 0) + opts.minIntervalMs);
          return wait;
        }
      } catch {
        // Shared limiter unavailable: fall back to this process's schedule.
      }
    }
    return reserveLocal();
  }

  function cached<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
    const hit = cache.get(key);
    if (hit && now() - hit.at < ttl) return Promise.resolve(hit.value as T);
    const run = (async () => {
      const wait = await reserve();
      if (wait > maxWait) throw new GeocodingError("rate_limited");
      if (wait > 0) await sleep(wait);
      return fetcher();
    })();
    return run.then((value) => {
      cache.delete(key);
      cache.set(key, { at: now(), value });
      while (cache.size > max) cache.delete(cache.keys().next().value as string);
      return value;
    });
  }

  return {
    id: inner.id,
    search(query, o = {}) {
      const key = `s|${o.lang ?? ""}|${o.limit ?? ""}|${query.trim().toLowerCase().replace(/\s+/g, " ")}`;
      return cached(key, () => inner.search(query, o));
    },
    reverse(latitude, longitude, o = {}) {
      const key = `r|${o.lang ?? ""}|${latitude.toFixed(5)},${longitude.toFixed(5)}`;
      return cached(key, () => inner.reverse(latitude, longitude, o));
    },
  };
}

const OSMF_PUBLIC = "https://nominatim.openstreetmap.org";
let singleton: { key: string; provider: GeocodingProvider } | null = null;

/**
 * The configured provider (Nominatim by default), or null when explicitly
 * disabled with MAP_GEOCODING_PROVIDER=off. Returns a process-wide instance
 * so the throttle and cache are shared by every request.
 */
export function geocoderFromEnv(
  env: Record<string, string | undefined> = process.env,
  opts: { reserve?: SlotReserver } = {}
): GeocodingProvider | null {
  const provider = (env.MAP_GEOCODING_PROVIDER || "nominatim").trim().toLowerCase();
  if (provider !== "nominatim") return null;
  const baseUrl = env.MAP_GEOCODING_BASE_URL?.trim() || OSMF_PUBLIC;
  const config: NominatimConfig = {
    baseUrl,
    apiKey: env.MAP_GEOCODING_API_KEY?.trim() || null,
    userAgent: env.MAP_GEOCODING_USER_AGENT?.trim() || "SmartPR/1.0 (+https://www.getsmartpr.com)",
    email: env.MAP_GEOCODING_EMAIL?.trim() || null,
  };
  const key = JSON.stringify(config) + (opts.reserve ? "|shared" : "") + `|fb=${env.MAP_GEOCODING_FALLBACK ?? ""}|${env.MAP_GEOCODING_PHOTON_URL ?? ""}`;
  if (singleton?.key === key) return singleton.provider;
  // The public OSMF instance allows at most 1 request/second for the whole
  // application, so its slots are reserved through the shared reserver (all
  // instances) when one is provided. Own or commercial endpoints get a
  // lighter per-process spacing.
  const isPublic = baseUrl.replace(/\/+$/, "") === OSMF_PUBLIC;
  const wrapped = politeProvider(nominatimProvider(config), {
    minIntervalMs: isPublic ? 1100 : 100,
    reserve: isPublic ? opts.reserve : undefined,
  });
  const chain: GeocodingProvider[] = [crimCatastroProvider(), wrapped];
  if ((env.MAP_GEOCODING_FALLBACK || "photon").trim().toLowerCase() === "photon") {
    // komoot's public Photon asks for fair use: identify ourselves, space
    // requests (1/s per process), cache, and fail fast instead of queueing.
    chain.push(politeProvider(photonProvider({ baseUrl: env.MAP_GEOCODING_PHOTON_URL?.trim() || "https://photon.komoot.io", userAgent: config.userAgent }), { minIntervalMs: 1000, maxWaitMs: 4000 }));
  }
  const chained = fallbackGeocoder(chain);
  singleton = { key, provider: chained };
  return chained;
}
