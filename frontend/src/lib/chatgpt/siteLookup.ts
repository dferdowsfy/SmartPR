// Site details for a ChatGPT map pin — street + the portal's official-map
// layer answers (JP zoning, FEMA flood zone, USGS landslide, JP/NOAA coastal
// zone, CRIM parcel), computed server-side with the SAME code the portal
// intake uses (layerService.resolveSiteLayers + lib/geocoding reverse).
//
// Bounded and honest: one short wall-clock budget for everything; a layer
// that doesn't answer in time (or a lookup that isn't configured) becomes a
// chip with value null that the widget shows as "See full report". Nothing is
// ever inferred. Nothing is persisted (in-memory caches only — no database).

import type { SiteLayers, SiteLayerResult } from "../../app/locations/layers";
import { resolveSiteLayers } from "../../app/locations/layerService";
import { locateInPuertoRico } from "../../app/locations/boundaries";
import { attributionFor, geocoderFromEnv, type GeocodeCandidate } from "../geocoding";

export type SiteChipId = "zoning" | "flood" | "landslide" | "coastal";

export interface SiteChip {
  id: SiteChipId;
  label: string;
  /** Short answer ("C-L", "Zone X", "Low", "Outside coastal zone"); null → "See full report". */
  value: string | null;
  /** Longer text for a tooltip ("C-L — Comercial Liviano"). */
  detail: string | null;
  status: "resolved" | "none" | "unavailable";
  source: string | null;
}

export interface SiteDetails {
  latitude: number;
  longitude: number;
  resolved_at: string;
  street: string | null;
  address: string | null;
  postal_code: string | null;
  /** Licence credit the UI must show for the street/address (ODbL for OSM). */
  address_attribution: string | null;
  parcel: string | null;
  chips: SiteChip[];
  /** True when every chip has an answer. */
  complete: boolean;
  /** Lookups still running server-side; call refine_scenario again shortly for the final chips. */
  pending: boolean;
}

export interface SiteLookups {
  layers?: (latitude: number, longitude: number, budgetMs: number) => Promise<SiteLayers | null>;
  reverse?: (latitude: number, longitude: number) => Promise<GeocodeCandidate | null>;
}

/** Full lookup budget (JP calificación alone often needs ~5–6 s). */
export const SITE_LOOKUP_BUDGET_MS = 8000;
/** How long one tool call waits before answering with `pending` chips. */
export const SITE_LOOKUP_WAIT_MS = 3000;

const CHIP_LABEL: Record<SiteChipId, string> = { zoning: "Zoning", flood: "FEMA flood", landslide: "Landslide", coastal: "Coastal zone" };

function chip(id: SiteChipId, r: SiteLayerResult | undefined, value: string | null, detail: string | null, status: SiteChip["status"]): SiteChip {
  return { id, label: CHIP_LABEL[id], value, detail, status: value ? status : "unavailable", source: value && r ? r.source?.name ?? null : null };
}

/** Chips from the portal's layer answers. Only answered layers get a value. */
export function chipsFromLayers(layers: SiteLayers | null | undefined): { chips: SiteChip[]; parcel: string | null } {
  const by = new Map((layers?.results ?? []).map((r) => [r.layer, r]));
  const z = by.get("zoning");
  const zoning = z?.status === "resolved" && z.code
    ? chip("zoning", z, String(z.code), `${z.code}${z.name ? ` — ${z.name}` : ""}`, "resolved")
    : chip("zoning", z, null, null, "unavailable");
  const f = by.get("flood_zone");
  const flood = f?.status === "resolved" && f.code
    ? chip("flood", f, `Zone ${f.code}${f.tags.includes("FLOODWAY") ? " · floodway" : ""}`, f.tags.includes("SFHA") ? "Special Flood Hazard Area (1% annual chance)" : null, "resolved")
    : chip("flood", f, null, null, "unavailable");
  const t = by.get("terrain");
  const landslide = t?.status === "resolved" && t.code
    ? chip("landslide", t, String(t.code), t.name ?? null, "resolved")
    : chip("landslide", t, null, null, "unavailable");
  const c = by.get("coastal_zone");
  const coastal = c?.status === "resolved"
    ? chip("coastal", c, c.approximate ? "Within ~1 km of coast" : "Inside coastal zone", c.name ?? null, "resolved")
    : c?.status === "none"
      ? chip("coastal", c, "Outside coastal zone", null, "none")
      : chip("coastal", c, null, null, "unavailable");
  const p = by.get("parcel");
  return { chips: [zoning, flood, landslide, coastal], parcel: p?.status === "resolved" && p.code ? String(p.code) : null };
}

function within<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); resolve(null); });
  });
}

/** Never throws; resolves within ~budgetMs. */
export async function lookupSiteDetails(latitude: number, longitude: number, lookups: SiteLookups, budgetMs = SITE_LOOKUP_BUDGET_MS, now = () => new Date()): Promise<SiteDetails> {
  const [layers, place] = await Promise.all([
    lookups.layers ? within(lookups.layers(latitude, longitude, Math.max(500, budgetMs - 300)), budgetMs) : Promise.resolve(null),
    lookups.reverse ? within(lookups.reverse(latitude, longitude), Math.min(budgetMs, 3500)) : Promise.resolve(null),
  ]);
  const { chips, parcel } = chipsFromLayers(layers);
  const street = place?.address_line_1?.trim() || null;
  return {
    latitude, longitude, resolved_at: now().toISOString(),
    street,
    address: place?.formatted_address?.trim() || null,
    postal_code: place?.postal_code?.trim() || null,
    address_attribution: place ? attributionFor(place.place_source) : null,
    parcel,
    chips,
    complete: chips.every((c) => c.value !== null),
    pending: false,
  };
}

// In-flight / recent lookups per point, so a quick tool answer can say
// "pending" and the follow-up call picks up the SAME lookup instead of
// starting another one. Process memory only; bounded; 10-minute TTL.
const recent = new Map<string, { at: number; done: SiteDetails | null; p: Promise<SiteDetails> }>();
const RECENT_TTL_MS = 10 * 60_000;
const RECENT_MAX = 300;

/**
 * Site details within `waitMs`: the finished lookup when it is done in time,
 * otherwise the same shape with every chip null and `pending: true` (the
 * lookup keeps running for the next call). Never throws.
 */
export async function siteDetailsFor(latitude: number, longitude: number, lookups: SiteLookups, opts: { waitMs?: number; budgetMs?: number; now?: () => Date } = {}): Promise<SiteDetails> {
  const key = `${latitude.toFixed(6)},${longitude.toFixed(6)}`;
  const t = Date.now();
  for (const [k, v] of recent) if (t - v.at > RECENT_TTL_MS) recent.delete(k);
  let e = recent.get(key);
  if (!e) {
    const entry: { at: number; done: SiteDetails | null; p: Promise<SiteDetails> } = { at: t, done: null, p: Promise.resolve(null as unknown as SiteDetails) };
    entry.p = lookupSiteDetails(latitude, longitude, lookups, opts.budgetMs ?? SITE_LOOKUP_BUDGET_MS, opts.now).then((d) => { entry.done = d; return d; });
    recent.set(key, entry);
    while (recent.size > RECENT_MAX) recent.delete(recent.keys().next().value as string);
    e = entry;
  }
  if (e.done) return e.done;
  const got = await within(e.p, opts.waitMs ?? SITE_LOOKUP_WAIT_MS);
  if (got) return got;
  const { chips } = chipsFromLayers(null);
  return { latitude, longitude, resolved_at: (opts.now ?? (() => new Date()))().toISOString(), street: null, address: null, postal_code: null, address_attribution: null, parcel: null, chips, complete: false, pending: true };
}

/** Tests only. */
export function _resetSiteDetailsCache() { recent.clear(); }

/** Production lookups: the portal's layer service + reverse geocoder (no database). */
export function defaultSiteLookups(env: Record<string, string | undefined> = process.env): SiteLookups {
  if (env.CHATGPT_SITE_LOOKUPS === "false") return {};
  return {
    layers: async (lat, lng, budgetMs) => {
      return resolveSiteLayers(lat, lng, { deadlineMs: budgetMs, skipOptional: true, isOnLand: (p) => locateInPuertoRico(p.latitude, p.longitude) !== null });
    },
    reverse: async (lat, lng) => {
      const g = geocoderFromEnv(env);
      return g ? g.reverse(lat, lng, { lang: "en" }) : null;
    },
  };
}
