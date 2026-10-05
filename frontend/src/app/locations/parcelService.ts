// ============================================================================
// Whole-parcel lookups (server): CRIM parcel boundary at the pin, then every
// JP calificación district and FEMA flood zone that intersects that boundary.
// When no parcel boundary is available, zoning and flood fall back to the
// point and say so (scope "point") — a point answer is never presented as
// covering the whole lot. Never throws.
// ============================================================================

import { checkSitePoint, LAYER_SOURCES, USDA_SOILS_SOURCE, type ArcGisQueryResponse, type LayerSourceKey } from "./layers.ts";
import {
  PARCEL_DEADLINE_MS,
  SMARTPR_USER_AGENT,
  queryDataset,
  retryOnTimeoutForSource,
  sourceEndpoints,
  timeoutForSource,
  type FetchLike,
} from "./layerService.ts";
import {
  applyCoverage, buildSoilsExtra, parseFloodZones, parseParcelBoundary, parsePlanTerritorialExtra, parsePresenceExtra, parsePutExtra, parseSoilsParcel, parseZoningDistricts,
  type ExtraFinding, type ExtraId, type ParcelBoundary, type ParcelFindings,
} from "./parcel.ts";
import { computeCoverage, parcelPlanarArea, type CoverageFeature } from "./coverage.ts";
import polygonClipping from "polygon-clipping";
import { ringsToGeoJson } from "./parcel.ts";

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
 * Pull a ring ~`m` metres toward its centroid. Used ONLY for the presence
 * layers (historic, archaeology, protected areas, reserves, wetlands), which
 * return no geometry: without it a polygon that merely shares the parcel's
 * edge would read as "on the parcel". The report states this edge tolerance.
 * Zoning, flood, PUT and soils query the full boundary and measure every
 * intersection instead (see coverage.ts). Exported for tests.
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

/**
 * Total vertex budget for one GET query geometry. Large rural lots are often
 * multi-ring (e.g. Patillas 374-000-004-33: 8 rings, 649 vertices); thinning
 * each ring to 240 still produced ~22 KB URLs that every server answered with
 * HTTP 414, so all parcel layers read "couldn't check". The budget is shared
 * across rings (each keeps ≥ 4 vertices) and coordinates are rounded to 1e-7°.
 */
export const MAX_QUERY_TOTAL_VERTICES = 200;
const r7 = (n: number) => Math.round(n * 1e7) / 1e7;
export function thinRings(rings: number[][][], budget = MAX_QUERY_TOTAL_VERTICES): number[][][] {
  const total = rings.reduce((n, r) => n + r.length, 0);
  return rings.map((r) => {
    const cap = Math.max(4, Math.floor((budget * r.length) / Math.max(total, 1)));
    if (r.length <= cap) return r;
    const step = Math.ceil(r.length / (cap - 1));
    const out = r.filter((_, i) => i % step === 0);
    out.push(r[r.length - 1]!);
    return out;
  });
}

export function esriPolygon(g: ParcelBoundary["geometry"], insetM = 0): string {
  const rings = thinRings(g.type === "Polygon" ? g.coordinates : g.coordinates.flat());
  return JSON.stringify({ rings: rings.map((r) => (insetM ? insetRing(r, insetM) : r).map(([x, y]) => [r7(x!), r7(y!)])), spatialReference: { wkid: 4326 } });
}

function wktPolygon(g: ParcelBoundary["geometry"]): string {
  const ring = (r: number[][]) => `(${thin(r).map(([x, y]) => `${x!.toFixed(7)} ${y!.toFixed(7)}`).join(", ")})`;
  return g.type === "Polygon"
    ? `POLYGON(${g.coordinates.map(ring).join(", ")})`
    : `MULTIPOLYGON(${g.coordinates.map((p) => `(${p.map(ring).join(", ")})`).join(", ")})`;
}

export type PostJson = (url: string, body: unknown, timeoutMs: number) => Promise<unknown>;

function url(layerUrl: string, params: Record<string, string>): string {
  return `${layerUrl}/query?${new URLSearchParams({ inSR: "4326", spatialRel: "esriSpatialRelIntersects", f: "json", ...params }).toString()}`;
}

export async function resolveParcelFindings(latitude: number, longitude: number, opts: { fetchImpl?: FetchLike; postJson?: PostJson; now?: () => Date; refresh?: boolean; deadlineMs?: number } = {}): Promise<ParcelFindings> {
  const fetchImpl: FetchLike = opts.fetchImpl ?? ((u, init) => fetch(u, { ...init, cache: "no-store" }) as ReturnType<FetchLike>);
  const postJson = opts.postJson ?? defaultPostJson;
  const now = opts.now ?? (() => new Date());
  const deadlineAt = Date.now() + (opts.deadlineMs ?? PARCEL_DEADLINE_MS);
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
  // Same provider path AND the same per-source timeout / retry rule as the
  // point layers (LAYER_TIMEOUTS_MS / LAYER_QUERIES). An overall deadline
  // caps the whole resolve so CRIM + fallbacks cannot pile up past the route.
  const q = async (src: LayerSourceKey, params: Record<string, string>): Promise<ArcGisQueryResponse | string> =>
    (await queryDataset(fetchImpl, sourceEndpoints(src), (ep) => url(ep, params), {
      timeoutMs: timeoutForSource(src),
      retries: 1,
      retryDelayMs: 250,
      retryOnTimeout: retryOnTimeoutForSource(src),
      deadlineAt,
    })).result;

  // CRIM is needed for the boundary, but it no longer uses a 12 s + timeout-retry
  // alone-first path (that stacked to ~48 s). Same 6 s / no-timeout-retry as layers.
  const parcelResp = await q("crim_parcels", { geometry: point, geometryType: "esriGeometryPoint", outFields: "NUM_CATASTRO,TIPO", returnGeometry: "true", outSR: "4326", geometryPrecision: "7" });
  const boundary = parseParcelBoundary(parcelResp, longitude, latitude);
  const scope: "parcel" | "point" = boundary.value ? "parcel" : "point";
  const pin = { latitude, longitude };
  // Zoning, flood and PUT: the full boundary, with geometry, so every
  // intersection is measured (small ones included and flagged).
  const fullParams = boundary.value
    ? { geometry: esriPolygon(boundary.value.geometry), geometryType: "esriGeometryPolygon" }
    : { geometry: point, geometryType: "esriGeometryPoint" };
  // Presence layers (no geometry returned): boundary pulled in by EDGE_TOLERANCE_M.
  const presenceParams = boundary.value
    ? { geometry: esriPolygon(boundary.value.geometry, EDGE_TOLERANCE_M), geometryType: "esriGeometryPolygon" }
    : { geometry: point, geometryType: "esriGeometryPoint" };
  // Geometry is requested (simplified to ~0.5 m) for the coverage computation.
  const geomOut: Record<string, string> = boundary.value ? { returnGeometry: "true", outSR: "4326", geometryPrecision: "7", maxAllowableOffset: "0.000005" } : { returnGeometry: "false" };
  const jp = limiter(JP_CONCURRENCY);
  const qJp = (src: LayerSourceKey, params: Record<string, string>) => jp(() => q(src, params));
  const presence = (key: LayerSourceKey) => qJp(key, { ...presenceParams, outFields: "*", returnGeometry: "false" });
  const [zoningResp, floodResp, putResp, ptResp, histZ, histS, arch, prot, resv, wet, soilsPinResp, soilsParcelResp] = await Promise.all([
    qJp("jp_calificacion", { ...fullParams, outFields: "cali,descrip,vigencia,resolucion,cali_sobre,des_sobre,r_sobre,v_sobre,cali_sobre2,des_sobre2,r_sobre2,v_sobre2", ...geomOut }),
    q("fema_flood_zones", { ...fullParams, outFields: "FLD_ZONE,ZONE_SUBTY,SFHA_TF", ...geomOut }),
    qJp("jp_put", { ...fullParams, outFields: "*", ...geomOut }),
    // The municipal Plan Territorial record is per municipio: the pin is enough.
    qJp("jp_plan_territorial", { geometry: point, geometryType: "esriGeometryPoint", outFields: "*", returnGeometry: "false" }),
    presence("mipr_zona_historica"),
    presence("mipr_sitios_historicos"),
    presence("mipr_arqueologia"),
    presence("jp_areas_protegidas"),
    presence("jp_reservas_naturales"),
    presence("mipr_humedales"),
    postJson(USDA_SOILS_SOURCE.url, { format: "JSON+COLUMNNAME", query: soilsPinSql(latitude, longitude) }, 8000),
    boundary.value ? postJson(USDA_SOILS_SOURCE.url, { format: "JSON+COLUMNNAME", query: soilsParcelSql(wktPolygon(boundary.value.geometry)) }, 8000) : Promise.resolve(null),
  ]);
  const ref = (k: LayerSourceKey): ExtraFinding["source"] => ({ name: LAYER_SOURCES[k].name, url: LAYER_SOURCES[k].url, layer: LAYER_SOURCES[k].layer, dataset_date: LAYER_SOURCES[k].dataset_date });
  const g = boundary.value?.geometry ?? null;
  if (boundary.value) boundary.value.area_m2 = parcelPlanarArea(boundary.value.geometry);
  const allFeats = (r: ArcGisQueryResponse | string, keysOf: (a: Record<string, unknown>) => string[]) =>
    typeof r === "string" ? [] : ((r as { features?: Array<{ attributes?: Record<string, unknown>; geometry?: { rings?: number[][][] } }> }).features ?? [])
      .flatMap((f) => keysOf(f.attributes ?? {}).map((key) => ({ key, rings: f.geometry?.rings ?? [] })))
      .filter((f) => f.key);
  const feats = (r: ArcGisQueryResponse | string, keysOf: (a: Record<string, unknown>) => string[]): CoverageFeature[] => allFeats(r, keysOf).filter((f) => f.rings.length);
  /** Categories returned without geometry (area unknown — never treated as "none"). */
  const noGeom = (r: ArcGisQueryResponse | string, keysOf: (a: Record<string, unknown>) => string[]) => {
    const all = allFeats(r, keysOf);
    const withGeom = new Set(all.filter((f) => f.rings.length).map((f) => f.key));
    return [...new Set(all.filter((f) => !f.rings.length && !withGeom.has(f.key)).map((f) => f.key))];
  };
  const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

  // PUT polygons can be island-scale; if the geometry request fails (but was
  // not refused), ask again for the classes only (3 m edge tolerance) and say
  // that their areas were not computed.
  let putClassesOnly = false;
  let putAnswer = putResp;
  if (boundary.value && typeof putResp === "string" && !/^http_40[13]/.test(putResp)) {
    const retry = await qJp("jp_put", { ...presenceParams, outFields: "*", returnGeometry: "false" });
    if (typeof retry !== "string") { putAnswer = retry; putClassesOnly = true; }
  }
  const put = parsePutExtra(putAnswer, ref("jp_put"), at, scope);
  if (putClassesOnly) put.parcel_limitation = `areas not computed — the geometry request failed (${putResp as string}); classes checked with a ${EDGE_TOLERANCE_M} m edge tolerance`;
  if (g && put.status === "verified") {
    const pf = feats(putResp, (a) => (s(a.CLASIPUT) ? [s(a.CLASIPUT)!] : []));
    if (pf.length) {
      put.coverage = computeCoverage(g, pf, { exclusive: true, pin, missingGeometry: noGeom(putResp, (a) => (s(a.CLASIPUT) ? [s(a.CLASIPUT)!] : [])) });
      put.pin = { status: put.coverage.pin_key ? "verified" : "no_mapped", key: put.coverage.pin_key, value: put.coverage.pin_key, attributes: {}, reason: null };
    }
  }
  const soilsParcel = soilsParcelResp === null ? null : parseSoilsParcel(soilsParcelResp);
  const soilsCoverage = g && soilsParcel?.status === "verified" && soilsParcel.features.length ? computeCoverage(g, soilsParcel.features, { exclusive: true, pin }) : null;
  const extras: Partial<Record<ExtraId, ExtraFinding>> = {
    put,
    plan_territorial: parsePlanTerritorialExtra(ptResp, ref("jp_plan_territorial"), at),
    historic_zone: parsePresenceExtra("historic_zone", histZ, ref("mipr_zona_historica"), at, scope),
    historic_site: parsePresenceExtra("historic_site", histS, ref("mipr_sitios_historicos"), at, scope),
    archaeology: parsePresenceExtra("archaeology", arch, ref("mipr_arqueologia"), at, scope),
    protected_area: parsePresenceExtra("protected_area", prot, ref("jp_areas_protegidas"), at, scope),
    natural_reserve: parsePresenceExtra("natural_reserve", resv, ref("jp_reservas_naturales"), at, scope),
    wetlands: parsePresenceExtra("wetlands", wet, ref("mipr_humedales"), at, scope),
    soils: buildSoilsExtra({ pin: soilsPinResp, parcel: soilsParcel, coverage: soilsCoverage, parcelLimitation: g ? null : "no parcel boundary — point lookup only" }, { ...USDA_SOILS_SOURCE }, at),
  };
  const zoning = parseZoningDistricts(zoningResp, scope);
  const flood = parseFloodZones(floodResp, scope);
  // Coverage of the parcel by each district / zone (coverage.ts).
  const areas_reliable = { zoning: false, flood: false };
  if (g) {
    const zf = feats(zoningResp, (a) => (s(a.cali) ? [s(a.cali)!] : []));
    if (zoning.status === "sourced" && zf.length) {
      zoning.coverage = computeCoverage(g, zf, { exclusive: true, pin, missingGeometry: noGeom(zoningResp, (a) => (s(a.cali) ? [s(a.cali)!] : [])) });
      areas_reliable.zoning = applyCoverage(zoning.districts, (d) => d.code, zoning.coverage);
      // A district that only touches the boundary (no area inside) is not on the parcel.
      const zc = zoning.coverage.contacts;
      zoning.districts = zoning.districts.filter((d) => !zc.includes(d.code));
      zoning.districts.sort((a, b) => (b.area_m2 ?? 0) - (a.area_m2 ?? 0));
      const of = feats(zoningResp, (a) => [s(a.cali_sobre), s(a.cali_sobre2)].filter((x): x is string => !!x));
      zoning.overlay_coverage = of.length ? computeCoverage(g, of, { exclusive: false, pin }) : null;
    }
    const ff = feats(floodResp, (a) => (s(a.FLD_ZONE) ? [`${s(a.FLD_ZONE)}|${s(a.ZONE_SUBTY) ?? ""}`] : []));
    if (flood.status === "sourced" && ff.length) {
      flood.coverage = computeCoverage(g, ff, { exclusive: true, pin, missingGeometry: noGeom(floodResp, (a) => (s(a.FLD_ZONE) ? [`${s(a.FLD_ZONE)}|${s(a.ZONE_SUBTY) ?? ""}`] : [])) });
      areas_reliable.flood = applyCoverage(flood.zones, (z) => `${z.zone}|${z.subtype ?? ""}`, flood.coverage);
      const fc = flood.coverage.contacts;
      flood.zones = flood.zones.filter((z) => !fc.includes(`${z.zone}|${z.subtype ?? ""}`));
      flood.zones.sort((a, b) => (b.area_m2 ?? 0) - (a.area_m2 ?? 0));
    }
  }
  // ---- Map context: neighbouring parcels + partial-coverage shapes -----------
  let neighbors: ParcelFindings["neighbors"] = undefined;
  let partials: ParcelFindings["partials"] = undefined;
  if (g && boundary.value) {
    const [x0, y0, x1, y1] = boundary.value.bbox;
    const pad = 0.0006; // ~60 m
    const env = JSON.stringify({ xmin: x0 - pad, ymin: y0 - pad, xmax: x1 + pad, ymax: y1 + pad, spatialReference: { wkid: 4326 } });
    const nResp = await q("crim_parcels", { geometry: env, geometryType: "esriGeometryEnvelope", outFields: "NUM_CATASTRO", returnGeometry: "true", outSR: "4326", geometryPrecision: "6", maxAllowableOffset: "0.00001", resultRecordCount: "80" });
    if (typeof nResp !== "string") {
      neighbors = (((nResp as { features?: Array<{ attributes?: Record<string, unknown>; geometry?: { rings?: number[][][] } }> }).features) ?? [])
        .map((f) => ({ catastro: s(f.attributes?.NUM_CATASTRO), geo: f.geometry?.rings ? ringsToGeoJson(f.geometry.rings) : null }))
        .filter((f) => f.geo && f.catastro !== boundary.value!.catastro)
        .slice(0, 60)
        .map((f) => ({ catastro: f.catastro, geometry: f.geo!.geometry }));
    }
    partials = [];
    const addPartials = (layer: "zoning" | "flood" | "put", resp: ArcGisQueryResponse | string, keyOf: (a: Record<string, unknown>) => string | null, cov: { parts: Array<{ key: string; share: number }> } | null | undefined) => {
      if (!cov || cov.parts.length < 2) return;
      for (const part of cov.parts) {
        if (part.share >= 0.999) continue;
        const shape = displayShape(g, feats(resp, (a) => { const k = keyOf(a); return k === part.key ? [k] : []; }));
        if (shape) partials!.push({ layer, key: part.key, share: part.share, geometry: shape });
      }
    };
    addPartials("zoning", zoningResp, (a) => s(a.cali), zoning.coverage);
    addPartials("flood", floodResp, (a) => (s(a.FLD_ZONE) ? `${s(a.FLD_ZONE)}|${s(a.ZONE_SUBTY) ?? ""}` : null), flood.coverage);
    addPartials("put", putAnswer, (a) => s(a.CLASIPUT), put.coverage);
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
    ...(neighbors ? { neighbors } : {}),
    ...(partials?.length ? { partials } : {}),
  };
  // Only cache complete answers: a failed source is asked again next time.
  if (value.boundary.status !== "unavailable" && value.zoning.status !== "unavailable" && value.flood.status !== "unavailable") {
    if (cache.size > 1000) cache.delete(cache.keys().next().value!);
    cache.set(key, { at: now().getTime(), value });
  }
  return value;
}


/** SDA: soil map unit at the pin, with map-unit aggregate attributes and survey version. */
export function soilsPinSql(latitude: number, longitude: number): string {
  return `SELECT M.mukey, M.musym, M.muname, A.drclassdcd, A.flodfreqdcd, A.hydclprs, L.areasymbol, L.areaname, S.saverest
FROM mapunit M LEFT JOIN muaggatt A ON A.mukey = M.mukey JOIN legend L ON L.lkey = M.lkey LEFT JOIN sacatalog S ON S.areasymbol = L.areasymbol
WHERE M.mukey IN (SELECT * FROM SDA_Get_Mukey_from_intersection_with_WktWgs84('point(${longitude.toFixed(6)} ${latitude.toFixed(6)})'))`;
}

/** SDA: every soil polygon intersecting the parcel, clipped to it (WKT), with attributes. */
export function soilsParcelSql(parcelWkt: string): string {
  const aoi = `geometry::STGeomFromText('${parcelWkt}', 4326).MakeValid()`;
  // Clipped server-side to the parcel grown by ~20 m (keeps the answer small
  // and covers any vertex thinning); the exact clip is done in coverage.ts.
  return `SELECT P.mukey, M.musym, M.muname, A.drclassdcd, A.flodfreqdcd, A.hydclprs, L.areasymbol, L.areaname, S.saverest, P.mupolygongeo.STIntersection(${aoi}.STBuffer(0.0002)).STAsText() AS wkt
FROM mupolygon P JOIN mapunit M ON M.mukey = P.mukey LEFT JOIN muaggatt A ON A.mukey = P.mukey JOIN legend L ON L.lkey = M.lkey LEFT JOIN sacatalog S ON S.areasymbol = L.areasymbol
WHERE P.mupolygongeo.STIntersects(${aoi}) = 1`;
}

/** POST JSON (USDA SDA is POST-only); a string on failure, never throws. Empty body = empty_response (unknown), not "{}". */
const defaultPostJson: PostJson = async (url, body, timeoutMs) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": SMARTPR_USER_AGENT },
      body: JSON.stringify(body),
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (!res.ok) return `http_${res.status}`;
    const text = await res.text();
    if (!text.trim()) return "empty_response";
    return JSON.parse(text);
  } catch (err) {
    return (err as Error)?.name === "AbortError" ? `timeout_${timeoutMs}ms` : `network_error: ${(err as Error)?.message ?? "error"}`;
  } finally {
    clearTimeout(timer);
  }
};


/** Display-only shape (lon/lat) of features clipped to the parcel; null when it cannot be built. */
function displayShape(parcel: ParcelBoundary["geometry"], features: CoverageFeature[]): { type: "MultiPolygon"; coordinates: number[][][][] } | null {
  try {
    const subj = (parcel.type === "Polygon" ? [parcel.coordinates] : parcel.coordinates) as unknown as Parameters<typeof polygonClipping.intersection>[0];
    let acc: ReturnType<typeof polygonClipping.union> = [];
    for (const f of features) {
      if (!("rings" in f)) continue;
      let shape: ReturnType<typeof polygonClipping.union> = [];
      for (const r of f.rings) if (r.length >= 4) shape = polygonClipping.xor(shape, [[r as [number, number][]]]);
      acc = polygonClipping.union(acc, polygonClipping.intersection(subj, shape));
    }
    return acc.length ? { type: "MultiPolygon", coordinates: acc as unknown as number[][][][] } : null;
  } catch {
    return null;
  }
}
