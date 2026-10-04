// ============================================================================
// Whole-parcel lookups (server): CRIM parcel boundary at the pin, then every
// JP calificación district and FEMA flood zone that intersects that boundary.
// When no parcel boundary is available, zoning and flood fall back to the
// point and say so (scope "point") — a point answer is never presented as
// covering the whole lot. Never throws.
// ============================================================================

import { checkSitePoint, LAYER_SOURCES, USDA_SOILS_SOURCE, type ArcGisQueryResponse, type LayerSourceKey } from "./layers.ts";
import { queryDataset, sourceEndpoints, type FetchLike } from "./layerService.ts";
import {
  applyAreas, areasByKey, parseFloodZones, parseParcelBoundary, parsePlanTerritorialExtra, parsePresenceExtra, parsePutExtra, parseSoilsExtra, parseZoningDistricts,
  type ExtraFinding, type ExtraId, type ParcelBoundary, type ParcelFindings,
} from "./parcel.ts";

const TIMEOUT_MS = 12000;
/** The JP / MIPR ArcGIS servers time out when hit with ~10 parallel queries. */
const JP_CONCURRENCY = 3;

function limiter(max: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T,>(fn: () => Promise<T>): Promise<T> => {
    if (active >= max) await new Promise<void>((r) => waiting.push(r));
    active++;
    try { return await fn(); } finally { active--; waiting.shift()?.(); }
  };
}
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
  // Same provider path as the point layers: primary, then same-schema
  // fallbacks, with retries and the shared circuit breaker.
  const q = async (src: LayerSourceKey, params: Record<string, string>): Promise<ArcGisQueryResponse | string> =>
    (await queryDataset(fetchImpl, sourceEndpoints(src), (ep) => url(ep, params), { timeoutMs: TIMEOUT_MS, retries: 1, retryDelayMs: 250, retryOnTimeout: true })).result;

  const parcelResp = await q("crim_parcels", { geometry: point, geometryType: "esriGeometryPoint", outFields: "NUM_CATASTRO,TIPO", returnGeometry: "true", outSR: "4326", geometryPrecision: "7" });
  const boundary = parseParcelBoundary(parcelResp, longitude, latitude);
  const scope: "parcel" | "point" = boundary.value ? "parcel" : "point";
  const geomParams = boundary.value
    ? { geometry: esriPolygon(boundary.value.geometry), geometryType: "esriGeometryPolygon" }
    : { geometry: point, geometryType: "esriGeometryPoint" };
  // Geometry is requested (simplified to ~0.5 m) so the share of the parcel
  // in each district / flood zone can be computed by polygon intersection.
  const geomOut: Record<string, string> = boundary.value ? { returnGeometry: "true", outSR: "4326", geometryPrecision: "7", maxAllowableOffset: "0.000005" } : { returnGeometry: "false" };
  const jp = limiter(JP_CONCURRENCY);
  const qJp = (src: LayerSourceKey, params: Record<string, string>) => jp(() => q(src, params));
  const presence = (key: LayerSourceKey) => qJp(key, { ...geomParams, outFields: "*", returnGeometry: "false" });
  const [zoningResp, floodResp, putResp, ptResp, histZ, histS, arch, prot, resv, wet, soilsResp] = await Promise.all([
    qJp("jp_calificacion", { ...geomParams, outFields: "cali,descrip,vigencia,resolucion,cali_sobre,des_sobre,r_sobre,v_sobre,cali_sobre2,des_sobre2,r_sobre2,v_sobre2", ...geomOut }),
    q("fema_flood_zones", { ...geomParams, outFields: "FLD_ZONE,ZONE_SUBTY,SFHA_TF", ...geomOut }),
    presence("jp_put"),
    // The municipal Plan Territorial record is per municipio: the pin is enough.
    qJp("jp_plan_territorial", { geometry: point, geometryType: "esriGeometryPoint", outFields: "*", returnGeometry: "false" }),
    presence("mipr_zona_historica"),
    presence("mipr_sitios_historicos"),
    presence("mipr_arqueologia"),
    presence("jp_areas_protegidas"),
    presence("jp_reservas_naturales"),
    presence("mipr_humedales"),
    querySoils(fetchImpl, latitude, longitude),
  ]);
  const ref = (k: LayerSourceKey): ExtraFinding["source"] => ({ name: LAYER_SOURCES[k].name, url: LAYER_SOURCES[k].url, layer: LAYER_SOURCES[k].layer, dataset_date: LAYER_SOURCES[k].dataset_date });
  const extras: Partial<Record<ExtraId, ExtraFinding>> = {
    put: parsePutExtra(putResp, ref("jp_put"), at, scope),
    plan_territorial: parsePlanTerritorialExtra(ptResp, ref("jp_plan_territorial"), at),
    historic_zone: parsePresenceExtra("historic_zone", histZ, ref("mipr_zona_historica"), at, scope),
    historic_site: parsePresenceExtra("historic_site", histS, ref("mipr_sitios_historicos"), at, scope),
    archaeology: parsePresenceExtra("archaeology", arch, ref("mipr_arqueologia"), at, scope),
    protected_area: parsePresenceExtra("protected_area", prot, ref("jp_areas_protegidas"), at, scope),
    natural_reserve: parsePresenceExtra("natural_reserve", resv, ref("jp_reservas_naturales"), at, scope),
    wetlands: parsePresenceExtra("wetlands", wet, ref("mipr_humedales"), at, scope),
    soils: parseSoilsExtra(soilsResp, { ...USDA_SOILS_SOURCE }, at),
  };
  const zoning = parseZoningDistricts(zoningResp, scope);
  const flood = parseFloodZones(floodResp, scope);
  // Per-district / per-zone areas (only when they add up to the parcel).
  const areas_reliable = { zoning: false, flood: false };
  if (boundary.value) {
    const feats = (r: ArcGisQueryResponse | string, keyOf: (a: Record<string, unknown>) => string | null) =>
      typeof r === "string" ? [] : ((r as { features?: Array<{ attributes?: Record<string, unknown>; geometry?: { rings?: number[][][] } }> }).features ?? [])
        .map((f) => ({ key: keyOf(f.attributes ?? {}) ?? "", rings: f.geometry?.rings ?? [] }))
        .filter((f) => f.key && f.rings.length);
    const zf = feats(zoningResp, (a) => (typeof a.cali === "string" ? a.cali.trim() : null));
    if (zf.length) areas_reliable.zoning = applyAreas(zoning.districts, (d) => d.code, areasByKey(boundary.value.geometry, zf), boundary.value.area_m2);
    const ff = feats(floodResp, (a) => (typeof a.FLD_ZONE === "string" ? `${a.FLD_ZONE.trim()}|${typeof a.ZONE_SUBTY === "string" ? a.ZONE_SUBTY.trim() : ""}` : null));
    if (ff.length) areas_reliable.flood = applyAreas(flood.zones, (z) => `${z.zone}|${z.subtype ?? ""}`, areasByKey(boundary.value.geometry, ff), boundary.value.area_m2);
  }
  const value: ParcelFindings = {
    latitude,
    longitude,
    retrieved_at: at,
    boundary,
    zoning,
    flood,
    areas_reliable,
    extras,
  };
  // Only cache complete answers: a failed source is asked again next time.
  if (value.boundary.status !== "unavailable" && value.zoning.status !== "unavailable" && value.flood.status !== "unavailable") {
    if (cache.size > 1000) cache.delete(cache.keys().next().value!);
    cache.set(key, { at: now().getTime(), value });
  }
  return value;
}


/** USDA NRCS Soil Data Access: map unit at the point (name, symbol, hydric rating, drainage). */
async function querySoils(fetchImpl: FetchLike, latitude: number, longitude: number): Promise<unknown> {
  const sql = `SELECT mu.musym, mu.muname, mu.mukey, c.hydricrating, c.drainagecl FROM mapunit mu LEFT JOIN component c ON c.mukey = mu.mukey AND c.majcompflag = 'Yes' WHERE mu.mukey IN (SELECT * FROM SDA_Get_Mukey_from_intersection_with_WktWgs84('point(${longitude.toFixed(6)} ${latitude.toFixed(6)})'))`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    // FetchLike has no body/method; use global fetch for this POST-only service.
    void fetchImpl;
    const res = await fetch(USDA_SOILS_SOURCE.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ format: "JSON+COLUMNNAME", query: sql }), signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) return `http_${res.status}`;
    const text = await res.text();
    return text.trim() ? JSON.parse(text) : {};
  } catch (err) {
    return (err as Error)?.name === "AbortError" ? `timeout_${TIMEOUT_MS}ms` : `network_error: ${(err as Error)?.message ?? "error"}`;
  } finally {
    clearTimeout(timer);
  }
}
