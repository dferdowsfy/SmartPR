// ============================================================================
// Parcel (whole-lot) findings — pure helpers.
//
// The point layers (layers.ts) answer "what is at the pin". This module adds
// what applies to the WHOLE parcel the pin falls in:
//   - the CRIM parcel boundary (GeoJSON) and its approximate area,
//   - EVERY JP calificación district the parcel touches (never just the first
//     polygon), with overlay districts kept separately,
//   - EVERY FEMA flood zone the parcel touches.
// It also converts the pin to NAD83 / Puerto Rico & Virgin Is. State Plane
// (EPSG:32161) for the report's technical section.
//
// Status vocabulary (shared with the report):
//   sourced          the service answered and something is mapped
//   none_mapped      the service answered: nothing mapped (NOT "no restriction")
//   unavailable      the service did not answer — unknown, never "none"
// ============================================================================

import { arcgisError, LAYER_SOURCES, zoningFamily, type ArcGisQueryResponse } from "./layers.ts";

export type FindingStatus = "sourced" | "none_mapped" | "unavailable";

export interface ParcelSourceRef {
  id: string;
  name: string;
  url: string;
  dataset_date: string | null;
}

export interface ParcelBoundary {
  catastro: string | null;
  /** GeoJSON Polygon / MultiPolygon in EPSG:4326. */
  geometry: { type: "Polygon"; coordinates: number[][][] } | { type: "MultiPolygon"; coordinates: number[][][][] };
  /** Geodesic area of the polygon, m² — computed from the mapped boundary, not a survey. */
  area_m2: number;
  bbox: [number, number, number, number];
}

export interface ZoningDistrict {
  code: string;
  name: string | null;
  family: string | null;
  /** Overlay district (cali_sobre) on top of the base district, when mapped. */
  overlay: { code: string; name: string | null } | null;
  effective: string | null;
  resolution: string | null;
}

export interface FloodZonePart {
  zone: string;
  subtype: string | null;
  sfha: boolean;
  floodway: boolean;
}

export interface ParcelFindings {
  latitude: number;
  longitude: number;
  retrieved_at: string;
  boundary: { status: FindingStatus; value: ParcelBoundary | null; reason: string | null; source: ParcelSourceRef };
  zoning: { status: FindingStatus; districts: ZoningDistrict[]; reason: string | null; source: ParcelSourceRef; scope: "parcel" | "point" };
  flood: { status: FindingStatus; zones: FloodZonePart[]; reason: string | null; source: ParcelSourceRef; scope: "parcel" | "point" };
}

const src = (k: keyof typeof LAYER_SOURCES): ParcelSourceRef => {
  const s = LAYER_SOURCES[k];
  return { id: s.id, name: s.name, url: s.url, dataset_date: s.dataset_date };
};

const str = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
};

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** Signed ring area (shoelace) of lon/lat ring on a sphere — m², positive = CW in ArcGIS. */
function ringAreaM2(ring: number[][]): number {
  // Spherical excess approximation (Chamberlain & Duquette 2007), accurate
  // to well under 1% at parcel scale.
  const R = 6378137;
  const rad = Math.PI / 180;
  let total = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i]!;
    const [x2, y2] = ring[i + 1]!;
    total += (x2! - x1!) * rad * (2 + Math.sin(y1! * rad) + Math.sin(y2! * rad));
  }
  return (total * R * R) / 2;
}

/**
 * ArcGIS rings → GeoJSON. ArcGIS outer rings are clockwise, holes
 * counter-clockwise; each outer ring starts a polygon.
 */
export function ringsToGeoJson(rings: number[][][]): { geometry: ParcelBoundary["geometry"]; area_m2: number; bbox: ParcelBoundary["bbox"] } | null {
  const clean = rings.filter((r) => Array.isArray(r) && r.length >= 4 && r.every((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])));
  if (!clean.length) return null;
  const polys: number[][][][] = [];
  let area = 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of clean) {
    for (const [x, y] of r) {
      minX = Math.min(minX, x!); maxX = Math.max(maxX, x!);
      minY = Math.min(minY, y!); maxY = Math.max(maxY, y!);
    }
    const a = ringAreaM2(r);
    // Shoelace in lon/lat: clockwise rings give a negative sum here.
    const outer = a < 0 || polys.length === 0;
    if (outer) polys.push([r]);
    else polys[polys.length - 1]!.push(r);
    area += outer ? Math.abs(a) : -Math.abs(a);
  }
  const geometry: ParcelBoundary["geometry"] = polys.length === 1 ? { type: "Polygon", coordinates: polys[0]! } : { type: "MultiPolygon", coordinates: polys };
  return { geometry, area_m2: Math.max(0, area), bbox: [minX, minY, maxX, maxY] };
}

/** True when the point lies inside the (multi)polygon (ray casting, holes respected). */
export function pointInGeometry(lng: number, lat: number, g: ParcelBoundary["geometry"]): boolean {
  const inRing = (ring: number[][]) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]!; const [xj, yj] = ring[j]!;
      if (yi! > lat !== yj! > lat && lng < ((xj! - xi!) * (lat - yi!)) / (yj! - yi!) + xi!) inside = !inside;
    }
    return inside;
  };
  const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  return polys.some((p) => inRing(p[0]!) && !p.slice(1).some(inRing));
}

/**
 * NAD83 / Puerto Rico & Virgin Is. (EPSG:32161), metres. Lambert Conformal
 * Conic 2SP on GRS80. Input is WGS84; WGS84 and NAD83(2011) differ by about
 * a metre in Puerto Rico, which the report states.
 */
export function toPrStatePlane(latitude: number, longitude: number): { x: number; y: number } {
  const a = 6378137;
  const f = 1 / 298.257222101;
  const e = Math.sqrt(2 * f - f * f);
  const rad = Math.PI / 180;
  const phi1 = (18 + 26 / 60) * rad;
  const phi2 = (18 + 2 / 60) * rad;
  const phi0 = (17 + 50 / 60) * rad;
  const lam0 = -(66 + 26 / 60) * rad;
  const FE = 200000;
  const FN = 200000;
  const m = (p: number) => Math.cos(p) / Math.sqrt(1 - e * e * Math.sin(p) ** 2);
  const t = (p: number) => Math.tan(Math.PI / 4 - p / 2) / ((1 - e * Math.sin(p)) / (1 + e * Math.sin(p))) ** (e / 2);
  const n = (Math.log(m(phi1)) - Math.log(m(phi2))) / (Math.log(t(phi1)) - Math.log(t(phi2)));
  const F = m(phi1) / (n * t(phi1) ** n);
  const r = (p: number) => a * F * t(p) ** n;
  const phi = latitude * rad;
  const theta = n * (longitude * rad - lam0);
  return { x: FE + r(phi) * Math.sin(theta), y: FN + r(phi0) - r(phi) * Math.cos(theta) };
}

// ---------------------------------------------------------------------------
// Parsing ArcGIS answers
// ---------------------------------------------------------------------------

type Feature = { attributes?: Record<string, unknown>; geometry?: { rings?: number[][][] } };
const features = (r: ArcGisQueryResponse): Feature[] => ((r as { features?: Feature[] }).features ?? []);

/** CRIM parcel at the point, with its boundary. */
export function parseParcelBoundary(resp: ArcGisQueryResponse | string, lng: number, lat: number): ParcelFindings["boundary"] {
  const source = src("crim_parcels");
  if (typeof resp === "string" || arcgisError(resp)) return { status: "unavailable", value: null, reason: typeof resp === "string" ? resp : arcgisError(resp), source };
  // Prefer a real parcel (with a catastro number) that contains the point.
  const candidates = features(resp)
    .map((f) => ({ cat: str(f.attributes?.NUM_CATASTRO), geo: f.geometry?.rings ? ringsToGeoJson(f.geometry.rings) : null }))
    .filter((c) => c.geo);
  const pick = candidates.find((c) => c.cat && pointInGeometry(lng, lat, c.geo!.geometry)) ?? candidates.find((c) => c.cat) ?? null;
  if (!pick) return { status: "none_mapped", value: null, reason: candidates.length ? "only_right_of_way_polygon_at_point" : "no_parcel_polygon_at_point", source };
  return { status: "sourced", value: { catastro: pick.cat, geometry: pick.geo!.geometry, area_m2: pick.geo!.area_m2, bbox: pick.geo!.bbox }, reason: null, source };
}

/** All calificación districts in the answer (deduped), base and overlay kept apart. */
export function parseZoningDistricts(resp: ArcGisQueryResponse | string, scope: "parcel" | "point"): ParcelFindings["zoning"] {
  const source = src("jp_calificacion");
  if (typeof resp === "string" || arcgisError(resp)) return { status: "unavailable", districts: [], reason: typeof resp === "string" ? resp : arcgisError(resp), source, scope };
  const seen = new Map<string, ZoningDistrict>();
  for (const f of features(resp)) {
    const a = f.attributes ?? {};
    const code = str(a.cali);
    if (!code) continue;
    const overlayCode = str(a.cali_sobre);
    const key = `${code}|${overlayCode ?? ""}`;
    if (seen.has(key)) continue;
    seen.set(key, {
      code,
      name: str(a.descrip),
      family: zoningFamily(code, str(a.descrip)),
      overlay: overlayCode ? { code: overlayCode, name: str(a.des_sobre) } : null,
      effective: str(a.vigencia),
      resolution: str(a.resolucion),
    });
  }
  const districts = [...seen.values()];
  // An area with no polygon (special-plan areas, unmapped) is NOT "unzoned".
  return { status: districts.length ? "sourced" : "none_mapped", districts, reason: districts.length ? null : "no_calificacion_polygon (special-plan area or unmapped)", source, scope };
}

/** All FEMA flood zones in the answer (deduped). */
export function parseFloodZones(resp: ArcGisQueryResponse | string, scope: "parcel" | "point"): ParcelFindings["flood"] {
  const source = src("fema_flood_zones");
  if (typeof resp === "string" || arcgisError(resp)) return { status: "unavailable", zones: [], reason: typeof resp === "string" ? resp : arcgisError(resp), source, scope };
  const seen = new Map<string, FloodZonePart>();
  for (const f of features(resp)) {
    const a = f.attributes ?? {};
    const zone = str(a.FLD_ZONE);
    if (!zone) continue;
    const subtype = str(a.ZONE_SUBTY);
    const key = `${zone}|${subtype ?? ""}`;
    if (seen.has(key)) continue;
    seen.set(key, { zone, subtype, sfha: str(a.SFHA_TF) === "T", floodway: /FLOODWAY/i.test(subtype ?? "") });
  }
  const zones = [...seen.values()];
  return { status: zones.length ? "sourced" : "none_mapped", zones, reason: zones.length ? null : "no_flood_polygon (unmapped area)", source, scope };
}

/** Restore a persisted ParcelFindings defensively (snapshots); null when malformed or for another point. */
export function restoreParcelFindings(raw: unknown, latitude: number, longitude: number): ParcelFindings | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as ParcelFindings;
  if (typeof p.latitude !== "number" || typeof p.longitude !== "number") return null;
  if (Math.abs(p.latitude - latitude) > 1e-7 || Math.abs(p.longitude - longitude) > 1e-7) return null;
  if (!p.boundary || !p.zoning || !p.flood || typeof p.retrieved_at !== "string") return null;
  return p;
}
