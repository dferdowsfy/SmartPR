// ============================================================================
// Site regulatory layers — what an exact point means on the official maps.
//
// Pure (no network, no React): the source registry, parsers for the ArcGIS
// REST responses, and the conversions every caller shares:
//   layerGeographies()   resolved layers → LocationGeography records, so a
//                        saved Passport location and an intake pin produce
//                        the same `location.*` engine facts
//                        (locationContext.locationEngineFacts).
//   layerFactDetails()   "Because your pin is in flood zone AE (FEMA, …)"
//                        explanations for requirement details (EN/ES).
//   layerChips()         compact chips for the "Rules for:" line.
//
// The map determines location facts; the rules engine decides what they mean.
// Nothing here encodes a permitting rule. A layer that could not be read is
// `unknown` with a reason — never "outside" — and produces no fact.
// The network side (timeouts, caching) is layerService.ts (server only).
// ============================================================================

import type { LocationGeography } from "./geo.ts";

export type SiteLayerId = "flood_zone" | "flood_advisory" | "coastal_zone" | "zoning" | "land_class" | "parcel" | "terrain" | "historic_zone" | "protected_area";

export const SITE_LAYER_IDS: readonly SiteLayerId[] = ["flood_zone", "flood_advisory", "coastal_zone", "zoning", "land_class", "parcel", "terrain", "historic_zone", "protected_area"];

// ---------------------------------------------------------------------------
// The canonical site point. SmartPR always carries { latitude, longitude };
// an integration that needs another order (ArcGIS "x,y", the FEMA MSC
// "longitude, latitude") converts inside its own adapter, never globally.
// ---------------------------------------------------------------------------

export interface SitePoint {
  latitude: number;
  longitude: number;
}

/** Puerto Rico's envelope (main island, Vieques, Culebra, Mona, Desecheo). */
export const PR_LATITUDE_RANGE = [17.8, 18.62] as const;
export const PR_LONGITUDE_RANGE = [-68.05, -65.15] as const;

export type SitePointCheck = { ok: true } | { ok: false; reason: "coordinates_look_swapped" | "outside_puerto_rico" | "not_a_number" };

/**
 * Sanity check before any outbound government request. A valid point is never
 * modified; an obviously swapped pair (latitude ≈ -66, longitude ≈ 18) is
 * rejected and logged so it can't resolve to the Southern Hemisphere.
 */
export function checkSitePoint(p: SitePoint): SitePointCheck {
  const { latitude, longitude } = p;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return { ok: false, reason: "not_a_number" };
  const inLat = (v: number) => v >= PR_LATITUDE_RANGE[0] && v <= PR_LATITUDE_RANGE[1];
  const inLng = (v: number) => v >= PR_LONGITUDE_RANGE[0] && v <= PR_LONGITUDE_RANGE[1];
  if (inLat(latitude) && inLng(longitude)) return { ok: true };
  if (inLat(longitude) && inLng(latitude)) return { ok: false, reason: "coordinates_look_swapped" };
  return { ok: false, reason: "outside_puerto_rico" };
}

/** ArcGIS geometry string: x,y = longitude,latitude. */
export function arcgisPointGeometry(p: SitePoint): string {
  return `${p.longitude},${p.latitude}`;
}

/**
 * resolved: the point intersects a feature (code/name set).
 * none:     the layer answered and the point intersects nothing (e.g. no
 *           parcel polygon under a street) — a real "no".
 * unknown:  the layer did not answer (down, timeout, not covered) or only an
 *           approximation was available and it cannot say "no".
 */
export type SiteLayerStatus = "resolved" | "none" | "unknown";

/** How the answer was obtained. */
export type SiteLayerRetrieval = "live" | "cached" | "stale_cache" | "derived" | "none";

export interface LayerSource {
  /** Stable id recorded as location_geographies.source_id. */
  id: string;
  name: string;
  publisher: string;
  /** ArcGIS REST layer URL (…/MapServer/<n>). */
  url: string;
  /** Human-readable layer name on the service. */
  layer: string;
  /** Dataset date when the service publishes one globally (else per feature). */
  dataset_date: string | null;
  /** Description of reliability observed when the source was verified. */
  reliability: "high" | "medium" | "low";
  verified: string;
}

/**
 * Sources verified from the box on 2026-09-30 (ET) against Guaynabo pueblo,
 * Condado, a Guayama rural point and two FEMA AE points (Toa Baja, Río
 * Grande). Dates come from the features themselves where the service has no
 * dataset metadata (editingInfo is empty on all of them).
 */
export const LAYER_SOURCES = {
  fema_flood_zones: {
    id: "fema-nfhl-s_fld_haz_ar",
    name: "FEMA National Flood Hazard Layer — Flood Hazard Zones",
    publisher: "FEMA",
    url: "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28",
    layer: "Flood Hazard Zones (S_FLD_HAZ_AR)",
    dataset_date: null,
    reliability: "high",
    verified: "2026-09-30",
  },
  fema_firm_panels: {
    id: "fema-nfhl-s_firm_pan",
    name: "FEMA National Flood Hazard Layer — FIRM Panels",
    publisher: "FEMA",
    url: "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/3",
    layer: "FIRM Panels (S_FIRM_PAN)",
    dataset_date: null,
    reliability: "high",
    verified: "2026-09-30",
  },
  fema_communities: {
    id: "fema-nfhl-s_pol_ar",
    name: "FEMA National Flood Hazard Layer — Political Jurisdictions (community)",
    publisher: "FEMA",
    url: "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/22",
    layer: "Political Jurisdictions (S_POL_AR)",
    dataset_date: null,
    reliability: "high",
    verified: "2026-10-01",
  },
  fema_lomas: {
    id: "fema-nfhl-lomas",
    name: "FEMA National Flood Hazard Layer — Letters of Map Amendment (LOMA)",
    publisher: "FEMA",
    url: "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/34",
    layer: "LOMAs",
    dataset_date: null,
    reliability: "high",
    verified: "2026-10-01",
  },
  fema_lomrs: {
    id: "fema-nfhl-lomrs",
    name: "FEMA National Flood Hazard Layer — Letters of Map Revision (LOMR)",
    publisher: "FEMA",
    url: "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/1",
    layer: "LOMRs",
    dataset_date: null,
    reliability: "high",
    verified: "2026-10-01",
  },
  jp_advisory_flood: {
    id: "jp-fema-advisory-1pct",
    name: "FEMA / Junta de Planificación — Puerto Rico Advisory Flood Maps (ABFE), 1% annual-chance flood zones",
    publisher: "FEMA; Junta de Planificación de Puerto Rico",
    url: "https://sigejp.pr.gov/server/rest/services/Advisory_Maps/Advisory_Data_07082019/MapServer/9",
    layer: "Zona Inundable (1% advisory)",
    dataset_date: "2019-07-08",
    reliability: "medium",
    verified: "2026-10-01",
  },
  jp_advisory_flood_02: {
    id: "jp-fema-advisory-02pct",
    name: "FEMA / Junta de Planificación — Puerto Rico Advisory Flood Maps (ABFE), 0.2% annual-chance flood hazard area",
    publisher: "FEMA; Junta de Planificación de Puerto Rico",
    url: "https://sigejp.pr.gov/server/rest/services/Advisory_Maps/Advisory_Data_07082019/MapServer/14",
    layer: "0.2 PCT Área de Peligro de Inundación",
    dataset_date: "2019-07-08",
    reliability: "medium",
    verified: "2026-10-01",
  },
  usgs_landslide: {
    id: "usgs-pr-landslide-susceptibility",
    name: "USGS — Puerto Rico Landslide Susceptibility",
    publisher: "U.S. Geological Survey",
    url: "https://tiles.arcgis.com/tiles/v01gqwM5QqNysAAi/arcgis/rest/services/PR_Landslide_Susceptibility/MapServer",
    layer: "Landslide Susceptibility (cached map, zoom 14 ≈ 9 m pixels)",
    dataset_date: null,
    reliability: "medium",
    verified: "2026-10-01",
  },
  usgs_elevation: {
    id: "usgs-3dep-epqs",
    name: "USGS 3DEP — Elevation Point Query Service",
    publisher: "U.S. Geological Survey",
    url: "https://epqs.nationalmap.gov/v1/json",
    layer: "3DEP elevation (meters)",
    dataset_date: null,
    reliability: "medium",
    verified: "2026-10-01",
  },
  jp_calificacion: {
    id: "jp-calificacion-vigente",
    name: "Junta de Planificación — Calificación vigente (Mapas de Calificación de Suelos)",
    publisher: "Junta de Planificación de Puerto Rico",
    url: "https://sigejp.pr.gov/server/rest/services/calificacion/cali_vige/MapServer/0",
    layer: "cali_vige",
    dataset_date: null,
    reliability: "medium",
    verified: "2026-09-30",
  },
  crim_parcels: {
    id: "crim-parcelas-feb-2025",
    name: "CRIM — Parcelas (catastro digital), febrero 2025",
    publisher: "Centro de Recaudación de Ingresos Municipales (vía JP SIGE)",
    url: "https://sigejp.pr.gov/server/rest/services/crim/crim_feb_2025/MapServer/0",
    layer: "Parcelas_feb_2025",
    dataset_date: "2025-02",
    reliability: "high",
    verified: "2026-09-30",
  },
  jp_zona_costanera: {
    id: "jp-mipr-zona-costanera",
    name: "Junta de Planificación (MIPR) — Zona Costanera (PMZC)",
    publisher: "Junta de Planificación de Puerto Rico / DRNA",
    url: "https://sige.pr.gov/server/rest/services/MIPR/Reglamentario_va2/MapServer/31",
    layer: "Zona Costanera",
    dataset_date: null,
    reliability: "low",
    verified: "2026-09-30",
  },
  jp_linea_costa: {
    id: "jp-linea-costa-1km",
    name: "Junta de Planificación — Línea de Costa (1 km inland band, derived coastal-zone approximation)",
    publisher: "Junta de Planificación de Puerto Rico",
    url: "https://sigejp.pr.gov/server/rest/services/Advisory_Maps/Advisory_Data_07082019/MapServer/3",
    layer: "Linea de Costa",
    dataset_date: "2019-07-08",
    reliability: "medium",
    verified: "2026-09-30",
  },
  jp_zonas_historicas: {
    id: "jp-zonas-historicas",
    name: "Junta de Planificación — Zonas Históricas (límites)",
    publisher: "Junta de Planificación de Puerto Rico / ICP",
    url: "https://sigejp.pr.gov/server/rest/services/JP_Reglamentario/Sitios_Historicos_JP/MapServer/1",
    layer: "Zonas Historicas Limites",
    dataset_date: null,
    reliability: "low",
    verified: "2026-09-30",
  },
  jp_areas_naturales: {
    id: "jp-areas-naturales-protegidas",
    name: "Junta de Planificación — Áreas Naturales Protegidas (terrestres)",
    publisher: "Junta de Planificación de Puerto Rico / DRNA",
    url: "https://sigejp.pr.gov/server/rest/services/Advisory_Maps/Datos_Generales/MapServer/5",
    layer: "Áreas Naturales Protegidas",
    dataset_date: "2018-12",
    reliability: "low",
    verified: "2026-09-30",
  },
} as const satisfies Record<string, LayerSource>;

export type LayerSourceKey = keyof typeof LAYER_SOURCES;

export interface SiteLayerSourceRef {
  id: string;
  name: string;
  url: string;
  layer: string;
  /** Date of the data behind THIS answer (FIRM panel effective date, JP vigencia, CRIM edition). */
  dataset_date: string | null;
  /** Panel / resolution / edition identifier. */
  version: string | null;
}

export interface SiteLayerResult {
  layer: SiteLayerId;
  status: SiteLayerStatus;
  /** Primary code (FLD_ZONE, calificación, clasificación, catastro…). */
  code: string | null;
  name: string | null;
  /**
   * Extra codes the point also carries, each becoming a
   * `location.<layer>.<token>` fact: flood_zone → SFHA, FLOODWAY;
   * land_class → SREP, RUSTICO, URBANO; zoning → family (residential…).
   */
  tags: string[];
  /** Raw attributes kept for provenance (small, string/number only). */
  attributes: Record<string, string | number | boolean | null>;
  source: SiteLayerSourceRef;
  retrieval: SiteLayerRetrieval;
  /** True when derived from a proxy dataset (e.g. CZM from the coastline band). */
  approximate: boolean;
  /** Why the layer is unknown / what was approximated. */
  reason: string | null;
  retrieved_at: string;
}

export interface SiteLayers {
  latitude: number;
  longitude: number;
  resolved_at: string;
  results: SiteLayerResult[];
}

// ---------------------------------------------------------------------------
// ArcGIS response helpers
// ---------------------------------------------------------------------------

export interface ArcGisQueryResponse {
  features?: Array<{ attributes?: Record<string, unknown> }>;
  count?: number;
  error?: { code?: number; message?: string };
}

/** Point-intersection query URL for an ArcGIS MapServer layer (WGS84 in). */
export function arcgisPointQueryUrl(layerUrl: string, latitude: number, longitude: number, extra: Record<string, string> = {}): string {
  return buildArcgisPointQuery(layerUrl, { latitude, longitude }, extra);
}

/** Point-intersection query for a site point (ArcGIS order handled here, and only here). */
export function buildArcgisPointQuery(layerUrl: string, point: SitePoint, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams({
    geometry: arcgisPointGeometry(point),
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "*",
    returnGeometry: "false",
    f: "json",
    ...extra,
  });
  return `${layerUrl}/query?${p.toString()}`;
}

/** ArcGIS reports errors with HTTP 200 and an `error` body. */
export function arcgisError(resp: ArcGisQueryResponse | null | undefined): string | null {
  if (!resp || typeof resp !== "object") return "empty_response";
  if (resp.error) return `arcgis_error_${resp.error.code ?? "unknown"}${resp.error.message ? `: ${resp.error.message}` : ""}`;
  if (!Array.isArray(resp.features) && typeof resp.count !== "number") return "unexpected_response";
  return null;
}

function firstAttributes(resp: ArcGisQueryResponse): Record<string, unknown> | null {
  const f = resp.features?.find((x) => x && x.attributes);
  return f?.attributes ?? null;
}

/** Trimmed string, or null for empty / placeholder values (" ", -9999). */
function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s && s !== "-9999" && s !== "-9999.0" ? s : null;
}

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > -9000 ? n : null;
}

/** Epoch-ms → YYYY-MM-DD (UTC, as FEMA publishes effective dates). */
export function epochDate(v: unknown): string | null {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0 || n > 4102444800000) return null;
  return new Date(n).toISOString().slice(0, 10);
}

const ES_MONTHS: Record<string, number> = { ENE: 1, FEB: 2, MAR: 3, ABR: 4, MAY: 5, JUN: 6, JUL: 7, AGO: 8, SEP: 9, SEPT: 9, OCT: 10, NOV: 11, DIC: 12, JAN: 1, APR: 4, AUG: 8, DEC: 12 };

/** JP `vigencia` values ("03/19/2008", "27-DIC-2024", "2012-03-01") → YYYY-MM-DD, else null. */
export function parseVigencia(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) {
    const a = +m[1];
    const b = +m[2];
    // JP publishes MM/DD/YYYY; a first field > 12 can only be a day.
    const [mm, dd] = a > 12 ? [b, a] : [a, b];
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) return `${m[3]}-${pad(mm)}-${pad(dd)}`;
    return null;
  }
  m = /^(\d{1,2})[-\s]([A-Za-z]{3,4})[-\s](\d{4})$/.exec(s);
  if (m) {
    const mm = ES_MONTHS[m[2].toUpperCase()];
    if (mm) return `${m[3]}-${pad(mm)}-${pad(+m[1])}`;
  }
  return null;
}

function ref(src: LayerSource, dataset_date: string | null, version: string | null): SiteLayerSourceRef {
  return { id: src.id, name: src.name, url: src.url, layer: src.layer, dataset_date: dataset_date ?? src.dataset_date, version };
}

export function unknownLayer(layer: SiteLayerId, src: LayerSource, reason: string | null, retrieved_at: string): SiteLayerResult {
  return { layer, status: "unknown", code: null, name: null, tags: [], attributes: {}, source: ref(src, null, null), retrieval: "none", approximate: false, reason, retrieved_at };
}

// ---------------------------------------------------------------------------
// Parsers (one per layer). Each takes already-fetched JSON (or an error
// string) and never throws.
// ---------------------------------------------------------------------------

/** Radius (m) around the pin searched for FEMA letters of map change (LOMA / LOMR). */
export const LOMC_SEARCH_RADIUS_M = 100;

/**
 * Same search as the FEMA Map Service Center, for the same spot. The MSC reads
 * a coordinate pair as "longitude, latitude" (x, y): sending latitude first
 * drops a Puerto Rico pin in Antarctica.
 */
export function femaMscUrl(latitude: number, longitude: number): string {
  return buildFemaMscQuery({ latitude, longitude });
}

/** FEMA MSC search for a site point: the MSC adapter is the only place the pair is written longitude-first. */
export function buildFemaMscQuery(p: SitePoint): string {
  return `https://msc.fema.gov/portal/search?AddressQuery=${encodeURIComponent(`${p.longitude.toFixed(6)}, ${p.latitude.toFixed(6)}`)}`;
}

/** Higher = more hazardous. When flood polygons overlap at a point, the most hazardous governs. */
function floodHazardRank(a: Record<string, unknown>): number {
  const zone = (str(a.FLD_ZONE) ?? "").toUpperCase();
  const sub = (str(a.ZONE_SUBTY) ?? "").toUpperCase();
  if (/FLOODWAY/.test(sub)) return 100;
  if (zone.startsWith("V")) return 90;
  if (zone.startsWith("A")) return 80;
  if (zone === "D") return 30;
  if (zone === "X" && /0\.2|SHADED|MODERATE/.test(sub)) return 20;
  if (zone === "X" || zone === "B" || zone === "C") return 10;
  return 0;
}

function mostHazardous(resp: ArcGisQueryResponse): { attrs: Record<string, unknown> | null; count: number } {
  const all = (resp.features ?? []).map((f) => f?.attributes).filter((a): a is Record<string, unknown> => !!a);
  if (!all.length) return { attrs: null, count: 0 };
  return { attrs: all.reduce((best, a) => (floodHazardRank(a) > floodHazardRank(best) ? a : best), all[0]), count: all.length };
}

/** FEMA preliminary-map date; FEMA stores "none" as year 9999. */
function realEpochDate(v: unknown): string | null {
  const d = epochDate(v);
  return d && Number(d.slice(0, 4)) < 2100 ? d : null;
}

export interface FemaFloodExtras {
  /** Political Jurisdictions at the point (community name + CID). */
  community?: ArcGisQueryResponse | string | null;
  /** Letters of Map Amendment / Revision near the point. */
  lomas?: ArcGisQueryResponse | string | null;
  lomrs?: ArcGisQueryResponse | string | null;
}

function usable(r: ArcGisQueryResponse | string | null | undefined): ArcGisQueryResponse | null {
  return r && typeof r !== "string" && !arcgisError(r) ? r : null;
}

/** Community the pin falls in (the MSC "Community" row): name + CID. */
export function parseFemaCommunity(resp: ArcGisQueryResponse | string | null | undefined): { cid: string | null; name: string | null } | null {
  const ok = usable(resp);
  const a = ok ? firstAttributes(ok) : null;
  if (!a) return null;
  const n1 = str(a.POL_NAME1);
  const n2 = str(a.POL_NAME2);
  // PR is mapped as "Puerto Rico Unincorporated Areas" + the municipio name.
  return { cid: str(a.CID), name: n2 && n1 && /unincorporated/i.test(n1) ? n2 : n1 ?? n2 };
}

/** Letters of map change near the pin; count is null when neither service answered. */
export function parseFemaMapChanges(
  lomas: ArcGisQueryResponse | string | null | undefined,
  lomrs: ArcGisQueryResponse | string | null | undefined
): { count: number | null; cases: string } {
  const sets: Array<[string, ArcGisQueryResponse | null]> = [["LOMA", usable(lomas)], ["LOMR", usable(lomrs)]];
  if (sets.every(([, r]) => !r)) return { count: null, cases: "" };
  const lines: string[] = [];
  let count = 0;
  for (const [kind, r] of sets) {
    for (const f of r?.features ?? []) {
      const a = f?.attributes;
      if (!a) continue;
      count++;
      const id = str(a.CASENUMBER) ?? str(a.CASE_NO) ?? str(a.LOMR_ID) ?? "case n/a";
      const date = epochDate(a.DATEENDED) ?? epochDate(a.EFF_DATE);
      const outcome = str(a.OUTCOME) ?? str(a.DETERMINATIONTYPE);
      lines.push(`${str(a.PROJECTCATEGORY) ?? kind} ${id}${date ? ` (${date})` : ""}${outcome ? ` — ${outcome}` : ""}`);
    }
  }
  return { count, cases: lines.slice(0, 5).join("; ") };
}

/** FEMA NFHL flood hazard zone, dated by the FIRM panel effective date. */
export function parseFemaFlood(
  zones: ArcGisQueryResponse | string,
  panels: ArcGisQueryResponse | string | null,
  retrieved_at: string,
  extras: FemaFloodExtras = {}
): SiteLayerResult {
  const src = LAYER_SOURCES.fema_flood_zones;
  if (typeof zones === "string") return unknownLayer("flood_zone", src, zones, retrieved_at);
  const err = arcgisError(zones);
  if (err) return unknownLayer("flood_zone", src, err, retrieved_at);
  const panel = panels && typeof panels !== "string" && !arcgisError(panels) ? firstAttributes(panels) : null;
  const panelId = panel ? str(panel.FIRM_PAN) : null;
  const effective = panel ? epochDate(panel.EFF_DATE) : null;
  const { attrs: a, count: zoneCount } = mostHazardous(zones);
  if (!a) {
    // NFHL covers all of Puerto Rico: no polygon means the point is off the
    // mapped area (open water / outside), which is not a "no flood zone".
    return { ...unknownLayer("flood_zone", src, "no_flood_hazard_polygon_at_point", retrieved_at), source: ref(src, effective, panelId), retrieval: "live" };
  }
  const zone = str(a.FLD_ZONE);
  if (!zone) return { ...unknownLayer("flood_zone", src, "flood_zone_attribute_missing", retrieved_at), retrieval: "live" };
  const subtype = str(a.ZONE_SUBTY);
  const sfha = str(a.SFHA_TF) === "T";
  const floodway = !!subtype && /FLOODWAY/i.test(subtype);
  const tags: string[] = [];
  if (sfha) tags.push("SFHA");
  if (floodway) tags.push("FLOODWAY");
  const bfe = num(a.STATIC_BFE);
  const community = parseFemaCommunity(extras.community);
  const changes = parseFemaMapChanges(extras.lomas, extras.lomrs);
  // A letter of map change near the pin can revise or remove the SFHA
  // designation: surfaced for review, never applied automatically.
  if (changes.count) tags.push("LOMC");
  return {
    layer: "flood_zone",
    status: "resolved",
    code: zone,
    name: `Zone ${zone}${subtype ? ` (${subtype.toLowerCase()})` : ""}`,
    tags,
    attributes: {
      FLD_ZONE: zone,
      ZONE_SUBTY: subtype,
      SFHA_TF: str(a.SFHA_TF),
      STATIC_BFE: bfe,
      DEPTH: num(a.DEPTH),
      VELOCITY: num(a.VELOCITY),
      LEN_UNIT: str(a.LEN_UNIT),
      FLD_AR_ID: str(a.FLD_AR_ID),
      STUDY_TYP: str(a.STUDY_TYP),
      DFIRM_ID: str(a.DFIRM_ID),
      ZONES_AT_POINT: zoneCount,
      FIRM_PAN: panelId,
      EFF_DATE: effective,
      PRE_DATE: panel ? realEpochDate(panel.PRE_DATE) : null,
      PANEL_TYP: panel ? str(panel.PANEL_TYP) : null,
      FIRM_ID: panel ? str(panel.FIRM_ID) : null,
      PANEL_SCALE: panel ? num(panel.SCALE) : null,
      COMMUNITY_CID: community?.cid ?? null,
      COMMUNITY_NAME: community?.name ?? null,
      LOMC_COUNT: changes.count,
      LOMC_CASES: changes.cases || null,
    },
    source: ref(src, effective, panelId),
    retrieval: "live",
    approximate: false,
    reason: panel ? null : "firm_panel_date_unavailable",
    retrieved_at,
  };
}

// ---------------------------------------------------------------------------
// FEMA Puerto Rico advisory flood (ABFE) — a distinct signal from the
// effective FIRM, never merged into it.
// ---------------------------------------------------------------------------

/**
 * Advisory 1% zone at the point (layer 9, which also carries "X (0.2% ACF)"),
 * plus whether the point falls in the advisory 0.2% hazard area (layer 14).
 * Tags: SFHA (advisory A/AE/AH/AO/V/VE), MODERATE (0.2%-only). No polygon at
 * a point the service answered for = "none" (outside the advisory flood areas).
 */
export function parseAdvisoryFlood(
  onePct: ArcGisQueryResponse | string,
  pointTwoPct: ArcGisQueryResponse | string | null,
  retrieved_at: string
): SiteLayerResult {
  const src = LAYER_SOURCES.jp_advisory_flood;
  if (typeof onePct === "string") return unknownLayer("flood_advisory", src, onePct, retrieved_at);
  const err = arcgisError(onePct);
  if (err) return unknownLayer("flood_advisory", src, err, retrieved_at);
  const two = pointTwoPct && typeof pointTwoPct !== "string" && !arcgisError(pointTwoPct) ? pointTwoPct : null;
  const inTwo = two ? (two.features ?? []).length > 0 : null;
  const { attrs: a } = mostHazardous(onePct);
  const base = { source: ref(src, src.dataset_date, null), retrieval: "live" as const, approximate: false, retrieved_at };
  if (!a) {
    if (inTwo) {
      return { ...base, layer: "flood_advisory", status: "resolved", code: "0.2%", name: "Advisory 0.2% annual-chance flood area", tags: ["MODERATE"], attributes: { ADV_ZONE: null, IN_02PCT_AREA: true }, reason: null };
    }
    return { ...base, layer: "flood_advisory", status: "none", code: null, name: null, tags: [], attributes: { ADV_ZONE: null, IN_02PCT_AREA: inTwo }, reason: null };
  }
  const zone = str(a.FLD_ZONE);
  if (!zone) return { ...unknownLayer("flood_advisory", src, "flood_zone_attribute_missing", retrieved_at), retrieval: "live" };
  const z = zone.toUpperCase();
  const sfha = /^(A|V)/.test(z);
  const tags = sfha ? ["SFHA"] : /0\.2/.test(z) || inTwo ? ["MODERATE"] : [];
  if (/^V/.test(z)) tags.push("COASTAL_HIGH_HAZARD");
  return {
    ...base,
    layer: "flood_advisory",
    status: "resolved",
    code: zone,
    name: sfha ? `Advisory zone ${zone}` : `Advisory ${zone}`,
    tags,
    attributes: {
      ADV_ZONE: zone,
      ADV_ZONE_SUBTY: str(a.ZONE_SUBTY),
      ADV_BFE_M: num(a.ST_BFE_m),
      ADV_DEPTH_M: num(a.Depth_m),
      V_DATUM: str(a.V_DATUM),
      IN_02PCT_AREA: inTwo,
    },
    reason: null,
  };
}

// ---------------------------------------------------------------------------
// Terrain: USGS landslide susceptibility (read from the official cached map)
// and USGS 3DEP elevation / slope. Nothing is estimated from map appearance.
// ---------------------------------------------------------------------------

export type LandslideClass = "Low" | "Moderate" | "High" | "Very High" | "Extremely High";

/**
 * The USGS map's legend colors (RGBA), read from its /legend on 2026-10-01.
 * "Low" is drawn fully transparent; a pixel matching none of these means the
 * map's style changed and the answer is unknown — never guessed.
 */
export const LANDSLIDE_LEGEND: ReadonlyArray<{ cls: LandslideClass; rgba: readonly [number, number, number, number] }> = [
  { cls: "Low", rgba: [0, 0, 0, 0] },
  { cls: "Moderate", rgba: [255, 255, 116, 128] },
  { cls: "High", rgba: [255, 169, 0, 128] },
  { cls: "Very High", rgba: [229, 0, 0, 128] },
  { cls: "Extremely High", rgba: [0, 78, 221, 128] },
];

/** The cached zoom level the USGS map is published at (maxScale 36111.9). */
export const LANDSLIDE_TILE_ZOOM = 14;

/** Web-Mercator tile + pixel for a site point. */
export function webMercatorTilePixel(p: SitePoint, zoom: number): { row: number; col: number; x: number; y: number } {
  const n = 2 ** zoom;
  const fx = ((p.longitude + 180) / 360) * n;
  const lat = (p.latitude * Math.PI) / 180;
  const fy = ((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * n;
  const col = Math.floor(fx);
  const row = Math.floor(fy);
  return { row, col, x: Math.min(255, Math.floor((fx - col) * 256)), y: Math.min(255, Math.floor((fy - row) * 256)) };
}

/** Landslide class from the map pixel at the point; null when the color isn't on the legend. */
export function landslideClassFromRgba(rgba: readonly number[]): LandslideClass | null {
  const [r, g, b, a] = rgba;
  if (a === 0) return "Low";
  const hit = LANDSLIDE_LEGEND.find((e) => e.rgba[3] !== 0 && Math.abs(e.rgba[0] - r) <= 2 && Math.abs(e.rgba[1] - g) <= 2 && Math.abs(e.rgba[2] - b) <= 2);
  return hit?.cls ?? null;
}

/** Slope (%) from four 3DEP elevations sampled `spacingM` east/west/north/south of the point. */
export function slopePercent(e: { east: number; west: number; north: number; south: number }, spacingM: number): number {
  const dzdx = (e.east - e.west) / (2 * spacingM);
  const dzdy = (e.north - e.south) / (2 * spacingM);
  return Math.round(Math.hypot(dzdx, dzdy) * 1000) / 10;
}

/**
 * Terrain result. Landslide susceptibility leads (code/tags); elevation and
 * slope ride along when the 3DEP service answered. Land with a transparent
 * pixel is "Low"; the caller only reads the map for points on land.
 */
export function parseTerrain(
  landslide: { rgba: readonly number[] } | string,
  elevation: { centerM: number | null; slopePct: number | null } | null,
  retrieved_at: string
): SiteLayerResult {
  const src = LAYER_SOURCES.usgs_landslide;
  const elev = { ELEVATION_M: elevation?.centerM ?? null, SLOPE_PCT: elevation?.slopePct ?? null };
  if (typeof landslide === "string") return { ...unknownLayer("terrain", src, landslide, retrieved_at), attributes: elev };
  const cls = landslideClassFromRgba(landslide.rgba);
  if (!cls) return { ...unknownLayer("terrain", src, `landslide_legend_mismatch_${landslide.rgba.join("_")}`, retrieved_at), attributes: elev, retrieval: "live" };
  const tags = cls === "High" || cls === "Very High" || cls === "Extremely High" ? ["LANDSLIDE_HIGH"] : cls === "Moderate" ? ["LANDSLIDE_MODERATE"] : [];
  if (cls === "Very High" || cls === "Extremely High") tags.push("LANDSLIDE_VERY_HIGH");
  return {
    layer: "terrain",
    status: "resolved",
    code: cls,
    name: `${cls} landslide susceptibility`,
    tags,
    attributes: { LANDSLIDE_SUSCEPTIBILITY: cls, ...elev },
    source: ref(src, null, `z${LANDSLIDE_TILE_ZOOM}`),
    retrieval: "live",
    approximate: false,
    reason: null,
    retrieved_at,
  };
}

/** Land-classification family of a JP `clasi` code. */
export function landClassFamily(clasi: string | null): { code: string; name: string } | null {
  const c = (clasi ?? "").toUpperCase().replace(/\s+/g, "");
  if (!c) return null;
  if (c.startsWith("SREP")) return { code: "SREP", name: "Suelo Rústico Especialmente Protegido" };
  if (c.startsWith("SRC")) return { code: "SRC", name: "Suelo Rústico Común" };
  if (c.startsWith("SUNP") || c.startsWith("SUP") || c.startsWith("SURB")) return { code: "SURB", name: "Suelo Urbanizable" };
  if (c.startsWith("SU")) return { code: "SU", name: "Suelo Urbano" };
  return null;
}

/**
 * Zoning family of a JP calificación (Reglamento Conjunto 2023, cap. 6
 * district families), from the district description (codes vary by plan:
 * "C-R" and "CR" are both Conservación de Recursos).
 */
export function zoningFamily(cali: string | null, descrip: string | null): string | null {
  const d = (descrip ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const c = (cali ?? "").toUpperCase();
  if (!d && !c) return null;
  if (/sistema vial|^vial$/.test(d) || c === "VIAL") return "road";
  if (/conservacion|preservacion|ecologic|bosque|cuerpo de agua|playa/.test(d)) return "conservation";
  if (/agricol|agropecuar/.test(d)) return "agricultural";
  if (/industri/.test(d)) return "industrial";
  if (/comercial|comercio|negocios|centro urbano|mixto/.test(d)) return "commercial";
  if (/turistic|hotel/.test(d)) return "tourism";
  if (/residencial|vivienda|urbanizacion/.test(d)) return "residential";
  if (/rural/.test(d)) return "rural";
  if (/dotacional|institucional|publico|educativ|salud/.test(d)) return "public";
  return null;
}

/**
 * JP calificación polygon → zoning + land classification (+ the catastro the
 * JP polygon carries, used when CRIM does not answer).
 */
export function parseJpCalificacion(resp: ArcGisQueryResponse | string, retrieved_at: string): { zoning: SiteLayerResult; land_class: SiteLayerResult; catastro: string | null } {
  const src = LAYER_SOURCES.jp_calificacion;
  if (typeof resp === "string" || arcgisError(resp)) {
    const reason = typeof resp === "string" ? resp : arcgisError(resp)!;
    return { zoning: unknownLayer("zoning", src, reason, retrieved_at), land_class: unknownLayer("land_class", src, reason, retrieved_at), catastro: null };
  }
  const a = firstAttributes(resp);
  if (!a) {
    // Areas under a special plan (e.g. the Condado special zoning) or
    // unmapped areas have no polygon in this layer: unknown, not "unzoned".
    const reason = "no_calificacion_polygon_at_point (special-plan area or unmapped)";
    return {
      zoning: { ...unknownLayer("zoning", src, reason, retrieved_at), retrieval: "live" },
      land_class: { ...unknownLayer("land_class", src, reason, retrieved_at), retrieval: "live" },
      catastro: null,
    };
  }
  const cali = str(a.cali);
  const descrip = str(a.descrip);
  const clasi = str(a.clasi);
  const descrip1 = str(a.descrip1);
  const vigencia = parseVigencia(a.vigencia);
  const resolucion = str(a.resolucion);
  const version = [resolucion, str(a.vigencia)].filter(Boolean).join(" · ") || null;
  const attributes = {
    cali,
    descrip,
    clasi,
    descrip1,
    num_catast: str(a.num_catast),
    municipio: str(a.municipio),
    barrio: str(a.barrio),
    vigencia: str(a.vigencia),
    resolucion,
    cali_sobre: str(a.cali_sobre),
    des_sobre: str(a.des_sobre),
  };
  const family = zoningFamily(cali, descrip);
  const zoning: SiteLayerResult = cali
    ? {
        layer: "zoning",
        status: "resolved",
        code: cali,
        name: descrip,
        tags: family ? [family] : [],
        attributes,
        source: ref(src, vigencia, version),
        retrieval: "live",
        approximate: false,
        reason: null,
        retrieved_at,
      }
    : { ...unknownLayer("zoning", src, "calificacion_attribute_missing", retrieved_at), retrieval: "live" };
  const lcFamily = landClassFamily(clasi);
  const lcTags = lcFamily ? [lcFamily.code, ...(lcFamily.code === "SREP" || lcFamily.code === "SRC" ? ["RUSTICO"] : lcFamily.code === "SU" ? ["URBANO"] : [])] : [];
  const land_class: SiteLayerResult =
    clasi && lcFamily
      ? {
          layer: "land_class",
          status: "resolved",
          code: clasi,
          name: descrip1,
          tags: lcTags,
          attributes,
          source: ref(src, vigencia, version),
          retrieval: "live",
          approximate: false,
          reason: null,
          retrieved_at,
        }
      : {
          ...unknownLayer("land_class", src, clasi ? `not_a_land_classification (${clasi})` : "clasificacion_attribute_missing", retrieved_at),
          retrieval: "live",
          attributes,
        };
  return { zoning, land_class, catastro: str(a.num_catast) };
}

/** CRIM parcel (número de catastro); falls back to the JP polygon's catastro. */
export function parseCrimParcel(resp: ArcGisQueryResponse | string, retrieved_at: string, jpCatastro: string | null = null): SiteLayerResult {
  const src = LAYER_SOURCES.crim_parcels;
  const fromJp = (reason: string): SiteLayerResult =>
    jpCatastro
      ? {
          layer: "parcel",
          status: "resolved",
          code: jpCatastro,
          name: `Catastro ${jpCatastro}`,
          tags: [],
          attributes: { num_catast: jpCatastro },
          source: ref(LAYER_SOURCES.jp_calificacion, null, null),
          retrieval: "derived",
          approximate: false,
          reason: `crim_unavailable (${reason}); catastro from the JP calificación polygon`,
          retrieved_at,
        }
      : unknownLayer("parcel", src, reason, retrieved_at);
  if (typeof resp === "string") return fromJp(resp);
  const err = arcgisError(resp);
  if (err) return fromJp(err);
  const a = firstAttributes(resp);
  if (!a) return { ...unknownLayer("parcel", src, "no_parcel_polygon_at_point", retrieved_at), status: "none", retrieval: "live" };
  const catastro = str(a.NUM_CATASTRO);
  if (!catastro) {
    // CRIM polygons under streets/rights-of-way (TIPO "V") carry no number.
    return { ...unknownLayer("parcel", src, `parcel_without_catastro_number (TIPO ${str(a.TIPO) ?? "?"})`, retrieved_at), status: "none", retrieval: "live", attributes: { TIPO: str(a.TIPO) } };
  }
  return {
    layer: "parcel",
    status: "resolved",
    code: catastro,
    name: `Catastro ${catastro}`,
    tags: [],
    attributes: { NUM_CATASTRO: catastro, OLDPID: str(a.OLDPID), TIPO: str(a.TIPO) },
    source: ref(src, src.dataset_date, "feb_2025"),
    retrieval: "live",
    approximate: false,
    reason: null,
    retrieved_at,
  };
}

/** Distance (m) of the inland coastal-zone band used by the PMZC. */
export const CZM_BAND_M = 1000;

/**
 * Coastal zone. The official JP/MIPR "Zona Costanera" polygon wins; when it
 * is down, the JP coastline layer is queried with a 1 km buffer: inside the
 * band → coastal zone (approximate: the PMZC zone is the 1 km band plus
 * extensions for key natural systems); outside → unknown, because the
 * official zone extends inland in places.
 */
export function parseCoastalZone(
  official: ArcGisQueryResponse | string | null,
  coastlineBand: ArcGisQueryResponse | string | null,
  retrieved_at: string
): SiteLayerResult {
  const off = LAYER_SOURCES.jp_zona_costanera;
  if (official && typeof official !== "string" && !arcgisError(official)) {
    const a = firstAttributes(official);
    if (a) {
      return {
        layer: "coastal_zone",
        status: "resolved",
        code: "CZM",
        name: str(a.DESCRIPCIO) ?? "Zona Costanera",
        tags: [],
        attributes: { DESCRIPCIO: str(a.DESCRIPCIO) },
        source: ref(off, null, null),
        retrieval: "live",
        approximate: false,
        reason: null,
        retrieved_at,
      };
    }
    return { ...unknownLayer("coastal_zone", off, "outside_official_coastal_zone", retrieved_at), status: "none", retrieval: "live" };
  }
  const officialReason = official === null ? "official_layer_not_queried" : typeof official === "string" ? official : arcgisError(official)!;
  const band = LAYER_SOURCES.jp_linea_costa;
  if (coastlineBand && typeof coastlineBand !== "string" && !arcgisError(coastlineBand)) {
    const count = typeof coastlineBand.count === "number" ? coastlineBand.count : (coastlineBand.features?.length ?? 0);
    if (count > 0) {
      return {
        layer: "coastal_zone",
        status: "resolved",
        code: "CZM",
        name: "Zona Costanera (within 1 km of the shoreline)",
        tags: ["BAND_1KM"],
        attributes: { coastline_within_m: CZM_BAND_M },
        source: ref(band, band.dataset_date, null),
        retrieval: "derived",
        approximate: true,
        reason: `official coastal-zone layer unavailable (${officialReason}); derived from the JP coastline (point within ${CZM_BAND_M} m)`,
        retrieved_at,
      };
    }
    return {
      ...unknownLayer("coastal_zone", band, `official coastal-zone layer unavailable (${officialReason}); more than ${CZM_BAND_M} m from the shoreline, but the official zone extends inland in places`, retrieved_at),
      retrieval: "derived",
      approximate: true,
    };
  }
  const bandReason = coastlineBand === null ? "not_queried" : typeof coastlineBand === "string" ? coastlineBand : arcgisError(coastlineBand)!;
  return unknownLayer("coastal_zone", off, `official: ${officialReason}; coastline: ${bandReason}`, retrieved_at);
}

/** Generic presence layer (historic zones, protected natural areas). */
export function parsePresence(
  layer: "historic_zone" | "protected_area",
  src: LayerSource,
  resp: ArcGisQueryResponse | string,
  retrieved_at: string,
  nameFields: string[]
): SiteLayerResult {
  if (typeof resp === "string") return unknownLayer(layer, src, resp, retrieved_at);
  const err = arcgisError(resp);
  if (err) return unknownLayer(layer, src, err, retrieved_at);
  const a = firstAttributes(resp);
  if (!a) return { ...unknownLayer(layer, src, null, retrieved_at), status: "none", retrieval: "live" };
  const name = nameFields.map((f) => str(a[f])).find(Boolean) ?? null;
  return {
    layer,
    status: "resolved",
    code: name ?? layer.toUpperCase(),
    name,
    tags: [],
    attributes: Object.fromEntries(nameFields.map((f) => [f, str(a[f])])),
    source: ref(src, src.dataset_date, null),
    retrieval: "live",
    approximate: false,
    reason: null,
    retrieved_at,
  };
}

// ---------------------------------------------------------------------------
// Layers → geographies / facts / explanations / chips
// ---------------------------------------------------------------------------

/** Geography type each layer is recorded under (location.<type>.* facts). */
export const LAYER_GEOGRAPHY_TYPE: Record<SiteLayerId, string> = {
  flood_zone: "flood_zone",
  flood_advisory: "flood_advisory",
  terrain: "terrain",
  coastal_zone: "coastal_zone",
  zoning: "zoning",
  land_class: "land_class",
  parcel: "parcel",
  historic_zone: "historic_zone",
  protected_area: "protected_area",
};

/** A geography determination (location_geographies row without ids). */
export interface LayerDetermination {
  geography_type: string;
  geography_code: string | null;
  geography_name: string | null;
  determination_method: "SPATIAL_INTERSECTION";
  source_id: string;
  source_name: string | null;
  source_version: string | null;
  source_url: string | null;
  metadata: Record<string, unknown>;
}

/**
 * Resolved layers → geography determinations. The primary code comes first
 * (it becomes `location.<type>`), tags follow (each a `location.<type>.<tag>`
 * fact). Unknown / none layers produce nothing: they never trigger a rule.
 */
export function layerDeterminations(layers: SiteLayers | null | undefined): LayerDetermination[] {
  if (!layers) return [];
  const out: LayerDetermination[] = [];
  for (const r of layers.results) {
    if (r.status !== "resolved" || !r.code) continue;
    const type = LAYER_GEOGRAPHY_TYPE[r.layer];
    const common = {
      geography_type: type,
      determination_method: "SPATIAL_INTERSECTION" as const,
      source_id: r.source.id,
      source_name: r.source.name,
      source_version: [r.source.version, r.source.dataset_date].filter(Boolean).join(" · ") || null,
      source_url: r.source.url,
      metadata: {
        layer: r.layer,
        source_layer: r.source.layer,
        dataset_date: r.source.dataset_date,
        retrieval: r.retrieval,
        approximate: r.approximate,
        reason: r.reason,
        retrieved_at: r.retrieved_at,
        attributes: r.attributes,
        predicate: "esriSpatialRelIntersects",
      },
    };
    out.push({ ...common, geography_code: r.code, geography_name: r.name });
    for (const tag of r.tags) out.push({ ...common, geography_code: tag, geography_name: null, metadata: { ...common.metadata, tag_of: r.code } });
  }
  return out;
}

/** Same determinations as LocationGeography records bound to a location id. */
export function layerGeographies(layers: SiteLayers | null | undefined, locationId: string, determinedAt: string): LocationGeography[] {
  return layerDeterminations(layers).map((d, i) => ({
    id: `${locationId}:layer:${i}`,
    location_id: locationId,
    ...d,
    determined_at: determinedAt,
  }));
}

/** Per-layer status facts (`location.layer_status.<layer>`), for UI and audits — never rule triggers. */
export function layerStatusFacts(layers: SiteLayers | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of layers?.results ?? []) out[`location.layer_status.${r.layer}`] = r.status;
  return out;
}

const FAMILY_LABEL: Record<string, { en: string; es: string }> = {
  SREP: { en: "specially protected rustic land", es: "suelo rústico especialmente protegido" },
  SRC: { en: "common rustic land", es: "suelo rústico común" },
  SU: { en: "urban land", es: "suelo urbano" },
  SURB: { en: "land to be urbanized", es: "suelo urbanizable" },
};

function sourceTag(r: SiteLayerResult): string {
  const who = r.source.id.startsWith("fema") ? "FEMA" : r.source.id.startsWith("crim") ? "CRIM" : "JP";
  const date = r.source.dataset_date;
  return date ? `${who}, ${date}` : who;
}

export interface LayerFactDetail {
  en: string;
  es: string;
}

/**
 * Human explanation of each resolved location fact, keyed by fact key:
 * "Because your pin is in flood zone AE (FEMA, 2009-11-18)". Used for the
 * details of requirements those facts triggered.
 */
export function layerFactDetails(layers: SiteLayers | null | undefined): Record<string, LayerFactDetail> {
  const out: Record<string, LayerFactDetail> = {};
  const tok = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  for (const r of layers?.results ?? []) {
    if (r.status !== "resolved" || !r.code) continue;
    const src = sourceTag(r);
    const approx = r.approximate ? { en: " — approximate", es: " — aproximado" } : { en: "", es: "" };
    const type = LAYER_GEOGRAPHY_TYPE[r.layer];
    const set = (keys: string[], d: LayerFactDetail) => {
      for (const k of keys) out[k] = d;
    };
    const all = [`location.${type}`, `location.${type}.${tok(r.code)}`, ...r.tags.map((t) => `location.${type}.${tok(t)}`)];
    if (r.name) all.push(`location.${type}.${tok(r.name)}`);
    switch (r.layer) {
      case "flood_zone": {
        const fw = r.tags.includes("FLOODWAY");
        set(all, {
          en: `Because your pin is in flood zone ${r.code}${fw ? " (regulatory floodway)" : ""} (${src})`,
          es: `Porque tu pin está en la zona inundable ${r.code}${fw ? " (cauce mayor)" : ""} (${src})`,
        });
        break;
      }
      case "coastal_zone":
        set([...all, "location.czm"], {
          en: `Because your pin is in the coastal zone (${src}${approx.en})`,
          es: `Porque tu pin está en la zona costanera (${src}${approx.es})`,
        });
        break;
      case "zoning":
        set(all, {
          en: `Because your pin is zoned ${r.code}${r.name ? ` — ${r.name}` : ""} (${src})`,
          es: `Porque tu pin tiene calificación ${r.code}${r.name ? ` — ${r.name}` : ""} (${src})`,
        });
        break;
      case "land_class": {
        const fam = r.tags.map((t) => FAMILY_LABEL[t]).find(Boolean);
        set(all, {
          en: `Because your pin is on ${fam?.en ?? "land classified"} ${r.code} (${src})`,
          es: `Porque tu pin está en ${fam?.es ?? "suelo clasificado"} ${r.code} (${src})`,
        });
        break;
      }
      case "parcel":
        set([...all, "location.parcel_id"], { en: `Parcel ${r.code} (${src})`, es: `Parcela ${r.code} (${src})` });
        break;
      case "historic_zone":
        set(all, { en: `Because your pin is in a historic zone${r.name ? ` (${r.name})` : ""} (${src})`, es: `Porque tu pin está en una zona histórica${r.name ? ` (${r.name})` : ""} (${src})` });
        break;
      case "protected_area":
        set(all, { en: `Because your pin is in a protected natural area${r.name ? ` (${r.name})` : ""} (${src})`, es: `Porque tu pin está en un área natural protegida${r.name ? ` (${r.name})` : ""} (${src})` });
        break;
    }
  }
  return out;
}

/**
 * What the FEMA Map Service Center shows for an address, from the same
 * official data: flood zone, FIRM panel, effective date, community, and any
 * letters of map change near the pin — plus the link to the MSC itself.
 */
export interface FloodMapSummary {
  zone: string;
  sfha: boolean;
  floodway: boolean;
  baseFloodElevation: number | null;
  firmPanel: string | null;
  panelType: string | null;
  effectiveDate: string | null;
  preliminaryDate: string | null;
  community: string | null;
  communityId: string | null;
  mapChangeCount: number | null;
  mapChangeCases: string | null;
  mscUrl: string | null;
}

export function floodMapSummary(layers: SiteLayers | null | undefined): FloodMapSummary | null {
  const r = layers?.results.find((x) => x.layer === "flood_zone");
  if (!r || r.status !== "resolved" || !r.code) return null;
  const a = r.attributes;
  const s = (v: unknown) => (typeof v === "string" && v ? v : null);
  const n = (v: unknown) => (typeof v === "number" ? v : null);
  return {
    zone: r.code,
    sfha: r.tags.includes("SFHA"),
    floodway: r.tags.includes("FLOODWAY"),
    baseFloodElevation: n(a.STATIC_BFE),
    firmPanel: s(a.FIRM_PAN),
    panelType: s(a.PANEL_TYP),
    effectiveDate: s(a.EFF_DATE),
    preliminaryDate: s(a.PRE_DATE),
    community: s(a.COMMUNITY_NAME),
    communityId: s(a.COMMUNITY_CID),
    mapChangeCount: n(a.LOMC_COUNT),
    mapChangeCases: s(a.LOMC_CASES),
    // Built from the pin each time: older saved results stored a link with the coordinates swapped.
    mscUrl: femaMscUrl(layers!.latitude, layers!.longitude),
  };
}

export interface LayerChip {
  layer: SiteLayerId;
  status: SiteLayerStatus;
  label: { en: string; es: string };
  /** Tooltip: source, dataset date, reason. */
  title: { en: string; es: string };
}

/**
 * Compact chips for "Rules for: …": "Flood zone AE · Coastal zone · Zoning
 * C-L · Rustic". Unknown core layers get a subtle "unknown" chip; optional
 * layers (historic, protected) only show when the pin is inside one.
 */
export function layerChips(layers: SiteLayers | null | undefined): LayerChip[] {
  const chips: LayerChip[] = [];
  const by = new Map((layers?.results ?? []).map((r) => [r.layer, r]));
  const title = (r: SiteLayerResult) => {
    const date = r.source.dataset_date ? ` · ${r.source.dataset_date}` : "";
    const why = r.reason ? ` · ${r.reason}` : "";
    const t = `${r.source.name}${date}${r.approximate ? " · approximate" : ""}${why}`;
    return { en: t, es: t };
  };
  const unknown = (layer: SiteLayerId, en: string, es: string) => {
    const r = by.get(layer)!;
    chips.push({ layer, status: "unknown", label: { en: `${en} unknown`, es: `${es} desconocida` }, title: title(r) });
  };
  const flood = by.get("flood_zone");
  if (flood) {
    if (flood.status === "resolved") {
      const fw = flood.tags.includes("FLOODWAY");
      const fm = floodMapSummary(layers);
      const extra = fm?.firmPanel ? ` · FIRM ${fm.firmPanel}${fm.effectiveDate ? ` (${fm.effectiveDate})` : ""}${fm.community ? ` · ${fm.community}` : ""}` : "";
      const t = title(flood);
      chips.push({ layer: "flood_zone", status: "resolved", label: { en: `Flood zone ${flood.code}${fw ? " · floodway" : ""}`, es: `Zona inundable ${flood.code}${fw ? " · cauce mayor" : ""}` }, title: { en: t.en + extra, es: t.es + extra } });
    } else unknown("flood_zone", "Flood zone", "Zona inundable");
  }
  const czm = by.get("coastal_zone");
  if (czm) {
    if (czm.status === "resolved") chips.push({ layer: "coastal_zone", status: "resolved", label: { en: czm.approximate ? "Coastal zone (approx.)" : "Coastal zone", es: czm.approximate ? "Zona costanera (aprox.)" : "Zona costanera" }, title: title(czm) });
    else if (czm.status === "unknown") chips.push({ layer: "coastal_zone", status: "unknown", label: { en: "Coastal zone unknown", es: "Zona costanera desconocida" }, title: title(czm) });
  }
  const zoning = by.get("zoning");
  if (zoning) {
    if (zoning.status === "resolved") chips.push({ layer: "zoning", status: "resolved", label: { en: `Zoning ${zoning.code}`, es: `Calificación ${zoning.code}` }, title: { en: `${zoning.name ?? ""} · ${title(zoning).en}`, es: `${zoning.name ?? ""} · ${title(zoning).es}` } });
    else unknown("zoning", "Zoning", "Calificación");
  }
  const lc = by.get("land_class");
  if (lc && lc.status === "resolved") {
    const fam = lc.tags[0];
    const label =
      fam === "SREP"
        ? { en: "Rustic (protected)", es: "Rústico (protegido)" }
        : fam === "SRC"
          ? { en: "Rustic", es: "Rústico" }
          : fam === "SU"
            ? { en: "Urban", es: "Urbano" }
            : { en: lc.code ?? "", es: lc.code ?? "" };
    chips.push({ layer: "land_class", status: "resolved", label, title: { en: `${lc.code} — ${lc.name ?? ""} · ${title(lc).en}`, es: `${lc.code} — ${lc.name ?? ""} · ${title(lc).es}` } });
  }
  const parcel = by.get("parcel");
  if (parcel && parcel.status === "resolved") chips.push({ layer: "parcel", status: "resolved", label: { en: `Parcel ${parcel.code}`, es: `Parcela ${parcel.code}` }, title: title(parcel) });
  for (const [layer, en, es] of [
    ["historic_zone", "Historic zone", "Zona histórica"],
    ["protected_area", "Protected area", "Área protegida"],
  ] as const) {
    const r = by.get(layer);
    if (r && r.status === "resolved") chips.push({ layer, status: "resolved", label: { en, es }, title: title(r) });
  }
  return chips;
}

// ---------------------------------------------------------------------------
// "What the maps say": one plain-language card per layer
// ---------------------------------------------------------------------------

type Bi = { en: string; es: string };

export interface LayerCard {
  layer: SiteLayerId;
  status: SiteLayerStatus;
  /** Layer name ("FEMA flood zone"). */
  title: Bi;
  /** The answer ("Zone AE · floodway"), or why there isn't one. */
  value: Bi;
  /** What it means for permitting — hedged, never a determination. */
  meaning: Bi | null;
  /** Source and dataset date ("FEMA · FIRM 72000C0985J · 2009-11-18"). */
  source: string | null;
  /** Unknown layers only: plain-language reason. */
  reason: Bi | null;
  /** Worth offering "Retry" (the service didn't answer, vs. a real "no"). */
  retryable: boolean;
  /** Where to check it yourself. */
  link: { url: string; label: Bi } | null;
}

/** Plain-language reason a layer is unknown, from the raw machine reason. */
export function layerReasonText(reason: string | null | undefined, service: "FEMA" | "JP" | "CRIM" | "USGS" = "JP"): { text: Bi; retryable: boolean } {
  const r = reason ?? "";
  const who = service === "FEMA" ? "FEMA" : service === "CRIM" ? "CRIM" : service === "USGS" ? "USGS" : "Junta de Planificación";
  if (r === "coordinates_look_swapped") return { text: { en: "The coordinates look reversed (latitude and longitude swapped), so no map was queried.", es: "Las coordenadas parecen invertidas (latitud y longitud intercambiadas); no se consultó ningún mapa." }, retryable: false };
  if (r === "not_on_land") return { text: { en: "The pin isn't on land, so terrain doesn't apply.", es: "El pin no está en tierra; el terreno no aplica." }, retryable: false };
  if (r === "landslide_tile_not_published" || /^landslide_legend_mismatch/.test(r)) return { text: { en: "USGS's landslide map couldn't be read for this point.", es: "No se pudo leer el mapa de deslizamientos del USGS para este punto." }, retryable: false };
  if (/^timeout_/.test(r)) return { text: { en: `${who}'s map service didn't answer in time.`, es: `El servicio de mapas de ${who} no respondió a tiempo.` }, retryable: true };
  if (/^layers_service_unreachable|^no_layers/.test(r)) return { text: { en: "SmartPR couldn't reach the map lookup.", es: "SmartPR no pudo conectar con la consulta de mapas." }, retryable: true };
  if (/^network_error|^http_5\d\d$|^http_429$|unreachable|arcgis_error_5/.test(r)) return { text: { en: `${who}'s map service is temporarily unavailable.`, es: `El servicio de mapas de ${who} no está disponible por el momento.` }, retryable: true };
  if (r === "no_flood_hazard_polygon_at_point") return { text: { en: "FEMA has no mapped flood area at this exact point (open water or outside the mapped area).", es: "FEMA no tiene un área de inundación mapeada en este punto exacto (agua abierta o fuera del área mapeada)." }, retryable: false };
  if (r === "outside_puerto_rico") return { text: { en: "This point is outside Puerto Rico.", es: "Este punto está fuera de Puerto Rico." }, retryable: false };
  if (/^http_4\d\d$|attribute_missing|unexpected_response|empty_response/.test(r)) return { text: { en: `${who} returned an answer SmartPR couldn't read.`, es: `${who} devolvió una respuesta que SmartPR no pudo leer.` }, retryable: true };
  return { text: { en: "The official map couldn't be checked for this point.", es: "No se pudo consultar el mapa oficial para este punto." }, retryable: true };
}

const MEANING: Record<string, Bi> = {
  flood_sfha: {
    en: "Special Flood Hazard Area (1% annual-chance flood). Construction here may need a flood review (JP Regulation 13) and flood insurance may be required.",
    es: "Área Especial de Riesgo de Inundación (1% de probabilidad anual). Construir aquí puede requerir revisión de inundabilidad (Reglamento 13 de la JP) y seguro contra inundaciones.",
  },
  flood_floodway: {
    en: "Regulatory floodway: the channel that must stay clear to carry floodwater. Development is tightly restricted.",
    es: "Cauce mayor regulatorio: el canal que debe mantenerse libre para el paso del agua. El desarrollo está muy restringido.",
  },
  flood_minimal: {
    en: "Minimal flood hazard — outside the 1% annual-chance floodplain. No flood review is triggered by the map alone.",
    es: "Riesgo mínimo de inundación — fuera de la llanura inundable de 1% anual. El mapa por sí solo no activa una revisión de inundabilidad.",
  },
  flood_moderate: {
    en: "Moderate flood hazard (0.2% annual-chance). Outside the regulatory floodplain, but flood insurance is still worth considering.",
    es: "Riesgo moderado de inundación (0.2% anual). Fuera de la llanura regulatoria, pero conviene considerar el seguro contra inundaciones.",
  },
  coastal: {
    en: "Inside the coastal zone management area: a coastal consistency review (Plan de Manejo de la Zona Costanera) may apply.",
    es: "Dentro del área de manejo de la zona costanera: puede aplicar una revisión de consistencia costanera (Plan de Manejo de la Zona Costanera).",
  },
  coastal_approx: {
    en: "Approximate: the pin is within 1 km of the coastline. Confirm the official coastal-zone boundary before relying on this.",
    es: "Aproximado: el pin está a menos de 1 km de la costa. Confirma el límite oficial de la zona costanera antes de depender de esto.",
  },
  zoning: {
    en: "Permitted uses depend on this calificación. A use that doesn't fit it may need a variance or special approval.",
    es: "Los usos permitidos dependen de esta calificación. Un uso que no encaje puede requerir una variación o una aprobación especial.",
  },
  srep: {
    en: "Specially protected rustic land: most development needs a Consulta de Ubicación and is tightly limited.",
    es: "Suelo rústico especialmente protegido: la mayoría del desarrollo requiere una Consulta de Ubicación y está muy limitado.",
  },
  rustic: {
    en: "Rustic land (not urban): non-agricultural uses usually need a Consulta de Ubicación.",
    es: "Suelo rústico (no urbano): los usos no agrícolas suelen requerir una Consulta de Ubicación.",
  },
  urban: {
    en: "Urban land: zoning (calificación) decides what is permitted.",
    es: "Suelo urbano: la calificación decide lo que está permitido.",
  },
  parcel: {
    en: "CRIM cadastral parcel under the pin. Use this number on permit applications.",
    es: "Parcela catastral del CRIM bajo el pin. Usa este número en las solicitudes de permisos.",
  },
  historic: {
    en: "Inside a historic zone: exterior changes, demolition and signage may need Instituto de Cultura Puertorriqueña review.",
    es: "Dentro de una zona histórica: cambios exteriores, demolición y rótulos pueden requerir revisión del Instituto de Cultura Puertorriqueña.",
  },
  protected: {
    en: "Inside a protected natural area: DRNA and Junta de Planificación review may apply.",
    es: "Dentro de un área natural protegida: puede aplicar revisión del DRNA y de la Junta de Planificación.",
  },
};

/**
 * One card per official-map layer for the "What the maps say" panel. Layers
 * that answered "no" are omitted (except the parcel, where "none" usually
 * means the pin is on a street); layers that didn't answer say so plainly.
 */
export function layerCards(layers: SiteLayers | null | undefined): LayerCard[] {
  const by = new Map((layers?.results ?? []).map((r) => [r.layer, r]));
  const out: LayerCard[] = [];
  const dated = (r: SiteLayerResult, who: string, extra?: string | null) => {
    const bits = [who, extra, r.source.dataset_date].filter(Boolean);
    return bits.join(" · ");
  };
  const unknownCard = (r: SiteLayerResult, title: Bi, service: "FEMA" | "JP" | "CRIM" | "USGS", link: LayerCard["link"]) => {
    const why = layerReasonText(r.reason, service);
    out.push({ layer: r.layer, status: "unknown", title, value: { en: "Couldn't be checked", es: "No se pudo verificar" }, meaning: null, source: null, reason: why.text, retryable: why.retryable, link });
  };

  const flood = by.get("flood_zone");
  if (flood) {
    const title = { en: "FEMA flood zone", es: "Zona inundable de FEMA" };
    const fm = floodMapSummary(layers);
    const mscLink = fm?.mscUrl ? { url: fm.mscUrl, label: { en: "Open in FEMA Map Service Center", es: "Abrir en el Centro de Mapas de FEMA" } } : null;
    if (flood.status === "resolved") {
      const sub = flood.attributes.ZONE_SUBTY;
      const fw = flood.tags.includes("FLOODWAY");
      const sfha = flood.tags.includes("SFHA");
      const meaning = fw ? MEANING.flood_floodway : sfha ? MEANING.flood_sfha : /0\.2|SHADED|MODERATE/i.test(String(sub ?? "")) ? MEANING.flood_moderate : MEANING.flood_minimal;
      const bfe = typeof flood.attributes.STATIC_BFE === "number" ? ` · BFE ${flood.attributes.STATIC_BFE}` : "";
      out.push({
        layer: "flood_zone",
        status: "resolved",
        title,
        value: { en: `Zone ${flood.code}${fw ? " · floodway" : ""}${bfe}`, es: `Zona ${flood.code}${fw ? " · cauce mayor" : ""}${bfe}` },
        meaning,
        source: dated(flood, "FEMA", fm?.firmPanel ? `FIRM ${fm.firmPanel}` : null),
        reason: null,
        retryable: false,
        link: mscLink,
      });
    } else if (flood.status === "unknown") {
      // Even without an answer, the person can check the same spot on FEMA's own map.
      const link = mscLink ?? { url: femaMscUrl(layers!.latitude, layers!.longitude), label: { en: "Check on FEMA's Map Service Center", es: "Verificar en el Centro de Mapas de FEMA" } };
      unknownCard(flood, title, "FEMA", link);
    }
  }
  const adv = by.get("flood_advisory");
  if (adv) {
    const title = { en: "FEMA advisory flood (ABFE)", es: "Inundación asesora de FEMA (ABFE)" };
    if (adv.status === "resolved") {
      const sfha = adv.tags.includes("SFHA");
      out.push({
        layer: "flood_advisory",
        status: "resolved",
        title,
        value: sfha ? { en: `Advisory zone ${adv.code}`, es: `Zona asesora ${adv.code}` } : { en: "Advisory 0.2% flood area", es: "Área asesora de inundación 0.2%" },
        meaning: sfha
          ? { en: "FEMA's Puerto Rico advisory maps (post-María) show a 1% annual-chance flood area here. They can show more flood exposure than the effective FIRM and may matter for planning and permitting.", es: "Los mapas asesores de FEMA para Puerto Rico (post-María) muestran un área de inundación de 1% anual aquí. Pueden mostrar más exposición que el FIRM vigente y pueden importar para la planificación y los permisos." }
          : { en: "FEMA's advisory maps show a 0.2% annual-chance (moderate) flood area here.", es: "Los mapas asesores de FEMA muestran un área de inundación de 0.2% anual (moderada) aquí." },
        source: dated(adv, "FEMA / JP"),
        reason: null,
        retryable: false,
        link: null,
      });
    } else if (adv.status === "none") {
      out.push({ layer: "flood_advisory", status: "none", title, value: { en: "Outside the advisory flood areas", es: "Fuera de las áreas inundables asesoras" }, meaning: { en: "Checked against FEMA's Puerto Rico advisory flood maps: no advisory flood area at this point.", es: "Verificado contra los mapas asesores de FEMA: no hay área asesora de inundación en este punto." }, source: dated(adv, "FEMA / JP"), reason: null, retryable: false, link: null });
    } else unknownCard(adv, title, "JP", null);
  }
  const terr = by.get("terrain");
  if (terr) {
    const title = { en: "Terrain & slope", es: "Terreno y pendiente" };
    if (terr.status === "resolved") {
      const high = terr.tags.includes("LANDSLIDE_HIGH");
      out.push({
        layer: "terrain",
        status: "resolved",
        title,
        value: { en: `${terr.code} landslide susceptibility`, es: `Susceptibilidad a deslizamientos: ${terr.code}` },
        meaning: high
          ? { en: "USGS rates this ground as prone to rainfall-triggered landslides. Grading, cuts and foundations may need geotechnical review.", es: "El USGS clasifica este terreno como propenso a deslizamientos por lluvia. El movimiento de tierra, cortes y cimientos pueden requerir revisión geotécnica." }
          : { en: "USGS landslide susceptibility for this ground (rainfall-triggered).", es: "Susceptibilidad a deslizamientos por lluvia del USGS para este terreno." },
        source: "USGS",
        reason: null,
        retryable: false,
        link: null,
      });
    } else unknownCard(terr, title, "USGS", null);
  }
  const czm = by.get("coastal_zone");
  if (czm?.status === "resolved") {
    out.push({
      layer: "coastal_zone",
      status: "resolved",
      title: { en: "Coastal zone", es: "Zona costanera" },
      value: czm.approximate ? { en: "Within ~1 km of the coast", es: "A ~1 km de la costa" } : { en: "Inside the coastal zone", es: "Dentro de la zona costanera" },
      meaning: czm.approximate ? MEANING.coastal_approx : MEANING.coastal,
      source: dated(czm, "Junta de Planificación"),
      reason: null,
      retryable: false,
      link: null,
    });
  } else if (czm?.status === "unknown") unknownCard(czm, { en: "Coastal zone", es: "Zona costanera" }, "JP", null);
  const zoning = by.get("zoning");
  if (zoning?.status === "resolved") {
    out.push({
      layer: "zoning",
      status: "resolved",
      title: { en: "Zoning (calificación)", es: "Calificación" },
      value: { en: `${zoning.code}${zoning.name ? ` — ${zoning.name}` : ""}`, es: `${zoning.code}${zoning.name ? ` — ${zoning.name}` : ""}` },
      meaning: MEANING.zoning,
      source: dated(zoning, "Junta de Planificación"),
      reason: null,
      retryable: false,
      link: null,
    });
  } else if (zoning?.status === "unknown") unknownCard(zoning, { en: "Zoning (calificación)", es: "Calificación" }, "JP", null);
  const lc = by.get("land_class");
  if (lc?.status === "resolved") {
    const fam = lc.tags[0];
    out.push({
      layer: "land_class",
      status: "resolved",
      title: { en: "Land classification", es: "Clasificación del suelo" },
      value: { en: `${lc.code}${lc.name ? ` — ${lc.name}` : ""}`, es: `${lc.code}${lc.name ? ` — ${lc.name}` : ""}` },
      meaning: fam === "SREP" ? MEANING.srep : fam === "SRC" ? MEANING.rustic : MEANING.urban,
      source: dated(lc, "Junta de Planificación"),
      reason: null,
      retryable: false,
      link: null,
    });
  }
  const parcel = by.get("parcel");
  if (parcel?.status === "resolved") {
    out.push({
      layer: "parcel",
      status: "resolved",
      title: { en: "Parcel (catastro)", es: "Parcela (catastro)" },
      value: { en: String(parcel.code), es: String(parcel.code) },
      meaning: MEANING.parcel,
      source: dated(parcel, "CRIM"),
      reason: null,
      retryable: false,
      link: null,
    });
  } else if (parcel?.status === "none") {
    out.push({
      layer: "parcel",
      status: "none",
      title: { en: "Parcel (catastro)", es: "Parcela (catastro)" },
      value: { en: "No parcel at this exact point", es: "Sin parcela en este punto exacto" },
      meaning: { en: "The pin may be on a street or between lots. Move it onto the building to get the parcel number.", es: "El pin puede estar en una calle o entre solares. Muévelo sobre el edificio para obtener el número de parcela." },
      source: null,
      reason: null,
      retryable: false,
      link: null,
    });
  } else if (parcel?.status === "unknown") unknownCard(parcel, { en: "Parcel (catastro)", es: "Parcela (catastro)" }, "CRIM", null);
  for (const [layer, en, es, key] of [
    ["historic_zone", "Historic zone", "Zona histórica", "historic"],
    ["protected_area", "Protected natural area", "Área natural protegida", "protected"],
  ] as const) {
    const r = by.get(layer);
    if (r?.status !== "resolved") continue;
    out.push({ layer, status: "resolved", title: { en, es }, value: { en: r.code ?? "Yes", es: r.code ?? "Sí" }, meaning: MEANING[key], source: dated(r, "Junta de Planificación"), reason: null, retryable: false, link: null });
  }
  return out;
}

/** Defensive restore of persisted layers (snapshots); null when malformed or for another point. */
export function restoreSiteLayers(raw: unknown, latitude: number, longitude: number): SiteLayers | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Partial<SiteLayers>;
  if (typeof s.latitude !== "number" || typeof s.longitude !== "number") return null;
  if (Math.abs(s.latitude - latitude) > 1e-7 || Math.abs(s.longitude - longitude) > 1e-7) return null;
  if (!Array.isArray(s.results)) return null;
  const results = s.results.filter(
    (r): r is SiteLayerResult =>
      !!r &&
      typeof r === "object" &&
      (SITE_LAYER_IDS as readonly string[]).includes((r as SiteLayerResult).layer) &&
      ["resolved", "none", "unknown"].includes((r as SiteLayerResult).status) &&
      !!(r as SiteLayerResult).source &&
      typeof (r as SiteLayerResult).source.id === "string" &&
      Array.isArray((r as SiteLayerResult).tags)
  );
  return { latitude: s.latitude, longitude: s.longitude, resolved_at: typeof s.resolved_at === "string" ? s.resolved_at : new Date().toISOString(), results };
}

/** Every core layer `unknown` (the layers service itself could not be reached). */
export function unavailableSiteLayers(latitude: number, longitude: number, reason: string, at: string = new Date().toISOString()): SiteLayers {
  const src: Record<SiteLayerId, LayerSource> = {
    flood_zone: LAYER_SOURCES.fema_flood_zones,
    flood_advisory: LAYER_SOURCES.jp_advisory_flood,
    terrain: LAYER_SOURCES.usgs_landslide,
    coastal_zone: LAYER_SOURCES.jp_zona_costanera,
    zoning: LAYER_SOURCES.jp_calificacion,
    land_class: LAYER_SOURCES.jp_calificacion,
    parcel: LAYER_SOURCES.crim_parcels,
    historic_zone: LAYER_SOURCES.jp_zonas_historicas,
    protected_area: LAYER_SOURCES.jp_areas_naturales,
  };
  const core: SiteLayerId[] = ["flood_zone", "flood_advisory", "coastal_zone", "zoning", "land_class", "parcel", "terrain"];
  return { latitude, longitude, resolved_at: at, results: core.map((l) => unknownLayer(l, src[l], reason, at)) };
}
