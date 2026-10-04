// ============================================================================
// Whole-parcel lookups (server): CRIM parcel boundary at the pin, then every
// JP calificación district and FEMA flood zone that intersects that boundary.
// When no parcel boundary is available, zoning and flood fall back to the
// point and say so (scope "point") — a point answer is never presented as
// covering the whole lot. Never throws.
// ============================================================================

import { LAYER_SOURCES, checkSitePoint, type ArcGisQueryResponse } from "./layers.ts";
import { queryJson, type FetchLike } from "./layerService.ts";
import { parseFloodZones, parseParcelBoundary, parseZoningDistricts, type ParcelBoundary, type ParcelFindings } from "./parcel.ts";

const TIMEOUT_MS = 9000;
const MAX_QUERY_VERTICES = 240;
const FRESH_MS = 24 * 3600_000;
const cache = new Map<string, { at: number; value: ParcelFindings }>();

/** Thin a ring for the intersect query (keeps first/last); the stored boundary is never thinned. */
function thin(ring: number[][]): number[][] {
  if (ring.length <= MAX_QUERY_VERTICES) return ring;
  const step = Math.ceil(ring.length / MAX_QUERY_VERTICES);
  const out = ring.filter((_, i) => i % step === 0);
  out.push(ring[ring.length - 1]!);
  return out;
}

/**
 * Pull a ring ~`m` metres toward its centroid. CRIM parcels and JP districts
 * are digitized separately, so their shared edges overlap by slivers; without
 * this, every neighbouring district (often the road, VIAL) "intersects" the
 * parcel. Exported for tests.
 */
export function insetRing(ring: number[][], m: number): number[][] {
  const n = ring.length - 1;
  if (n < 3) return ring;
  let cx = 0, cy = 0;
  for (let i = 0; i < n; i++) { cx += ring[i]![0]!; cy += ring[i]![1]!; }
  cx /= n; cy /= n;
  const mPerDegLat = 110_574;
  const mPerDegLng = 111_320 * Math.cos((cy * Math.PI) / 180);
  const out = ring.map(([x, y]) => {
    const dx = (x! - cx) * mPerDegLng, dy = (y! - cy) * mPerDegLat;
    const d = Math.hypot(dx, dy);
    if (d <= m * 2) return [x!, y!];
    const k = (d - m) / d;
    return [cx + (dx * k) / mPerDegLng, cy + (dy * k) / mPerDegLat];
  });
  out[out.length - 1] = out[0]!;
  return out;
}

export const EDGE_TOLERANCE_M = 3;

function esriPolygon(g: ParcelBoundary["geometry"]): string {
  const rings = g.type === "Polygon" ? g.coordinates : g.coordinates.flat();
  return JSON.stringify({ rings: rings.map((r) => insetRing(thin(r), EDGE_TOLERANCE_M)), spatialReference: { wkid: 4326 } });
}

function url(layerUrl: string, params: Record<string, string>): string {
  return `${layerUrl}/query?${new URLSearchParams({ inSR: "4326", spatialRel: "esriSpatialRelIntersects", f: "json", ...params }).toString()}`;
}

export async function resolveParcelFindings(latitude: number, longitude: number, opts: { fetchImpl?: FetchLike; now?: () => Date; refresh?: boolean } = {}): Promise<ParcelFindings> {
  const fetchImpl: FetchLike = opts.fetchImpl ?? ((u, init) => fetch(u, { ...init, cache: "no-store" }) as ReturnType<FetchLike>);
  const now = opts.now ?? (() => new Date());
  const key = `${latitude.toFixed(6)},${longitude.toFixed(6)}`;
  const hit = cache.get(key);
  if (hit && !opts.refresh && now().getTime() - hit.at < FRESH_MS) return hit.value;
  const at = now().toISOString();
  const point = `${longitude},${latitude}`;
  const check = checkSitePoint({ latitude, longitude });
  if (!check.ok) {
    const b = parseParcelBoundary(check.reason, longitude, latitude);
    return { latitude, longitude, retrieved_at: at, boundary: b, zoning: parseZoningDistricts(check.reason, "point"), flood: parseFloodZones(check.reason, "point") };
  }
  const q = (u: string) => queryJson(fetchImpl, u, TIMEOUT_MS, 1, 250, true) as Promise<ArcGisQueryResponse | string>;

  const parcelResp = await q(url(LAYER_SOURCES.crim_parcels.url, { geometry: point, geometryType: "esriGeometryPoint", outFields: "NUM_CATASTRO,TIPO", returnGeometry: "true", outSR: "4326", geometryPrecision: "7" }));
  const boundary = parseParcelBoundary(parcelResp, longitude, latitude);
  const scope: "parcel" | "point" = boundary.value ? "parcel" : "point";
  const geomParams = boundary.value
    ? { geometry: esriPolygon(boundary.value.geometry), geometryType: "esriGeometryPolygon" }
    : { geometry: point, geometryType: "esriGeometryPoint" };
  const [zoningResp, floodResp] = await Promise.all([
    q(url(LAYER_SOURCES.jp_calificacion.url, { ...geomParams, outFields: "cali,descrip,vigencia,resolucion,cali_sobre,des_sobre", returnGeometry: "false" })),
    q(url(LAYER_SOURCES.fema_flood_zones.url, { ...geomParams, outFields: "FLD_ZONE,ZONE_SUBTY,SFHA_TF", returnGeometry: "false" })),
  ]);
  const value: ParcelFindings = {
    latitude,
    longitude,
    retrieved_at: at,
    boundary,
    zoning: parseZoningDistricts(zoningResp, scope),
    flood: parseFloodZones(floodResp, scope),
  };
  // Only cache complete answers: a failed source is asked again next time.
  if (value.boundary.status !== "unavailable" && value.zoning.status !== "unavailable" && value.flood.status !== "unavailable") {
    if (cache.size > 1000) cache.delete(cache.keys().next().value!);
    cache.set(key, { at: now().getTime(), value });
  }
  return value;
}
