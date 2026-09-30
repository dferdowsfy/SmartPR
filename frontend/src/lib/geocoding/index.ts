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
//
// Adding another provider = implement GeocodingProvider and register it in
// geocoderFromEnv(); callers and the stored data model do not change.
// ============================================================================

import { PUERTO_RICO_BOUNDS, validateCoordinates } from "../../app/locations/geo.ts";

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
  const key = JSON.stringify(config) + (opts.reserve ? "|shared" : "");
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
  singleton = { key, provider: wrapped };
  return wrapped;
}
