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
import type { Coverage } from "./coverage.ts";

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
  /** Every overlay district on the polygon (cali_sobre, cali_sobre2), e.g. APE-ZC karst zone. */
  overlays?: Array<{ code: string; name: string | null; resolution: string | null; effective: string | null }>;
  effective: string | null;
  resolution: string | null;
  /** Area of the parcel inside this district (m², unrounded) and share of the parcel (0..1) — from `coverage`. */
  area_m2?: number | null;
  share?: number | null;
  /** Below coverage.SMALL_SHARE of the parcel: a small intersection (kept, flagged — not assumed to be an error). */
  small?: boolean;
  /** The (clipped) district polygon contains the pin. */
  contains_pin?: boolean;
}

export interface FloodZonePart {
  zone: string;
  subtype: string | null;
  sfha: boolean;
  floodway: boolean;
  area_m2?: number | null;
  share?: number | null;
  small?: boolean;
  contains_pin?: boolean;
}

/**
 * Additional parcel checks from authoritative layers (JP, MIPR, USDA).
 *   verified    the source answered and something is mapped
 *   no_mapped   the source answered: nothing mapped (never "no restriction")
 *   unable      the source did not answer or could not be read
 */
export type ExtraId = "put" | "plan_territorial" | "historic_zone" | "historic_site" | "archaeology" | "protected_area" | "natural_reserve" | "wetlands" | "soils";
export interface ExtraFinding {
  id: ExtraId;
  status: "verified" | "no_mapped" | "unable";
  /** Short value ("SU — Suelo Urbano", "Urban land"). */
  value: string | null;
  /** Feature names / ids found. */
  items: string[];
  attributes: Record<string, string | number | null>;
  source: { name: string; url: string; layer: string; dataset_date: string | null };
  scope: "parcel" | "point" | "municipality";
  reason: string | null;
  retrieved_at: string;
  /** Raw source fields behind the value, by official field name (provenance). */
  raw?: Record<string, string | null>;
  /** Official-source ambiguities found while reading the record (never resolved by guessing). */
  ambiguities?: string[];
  /** Parcel coverage by category (PUT classes, soil map units), when geometry was available. */
  coverage?: Coverage | null;
  /** Descriptive data for each coverage key (e.g. soil map-unit name, drainage). */
  part_info?: Record<string, { label: string; attributes: Record<string, string | number | null> }>;
  /** The answer at the pin, kept separately from the parcel-wide answer. */
  pin?: { status: "verified" | "no_mapped" | "unable"; key: string | null; value: string | null; attributes: Record<string, string | number | null>; reason: string | null } | null;
  /** Why the parcel-wide answer is missing when only a point answer exists. */
  parcel_limitation?: string | null;
}

export interface ParcelFindings {
  latitude: number;
  longitude: number;
  retrieved_at: string;
  boundary: { status: FindingStatus; value: ParcelBoundary | null; reason: string | null; source: ParcelSourceRef };
  zoning: { status: FindingStatus; districts: ZoningDistrict[]; reason: string | null; source: ParcelSourceRef; scope: "parcel" | "point"; coverage?: Coverage | null; overlay_coverage?: Coverage | null };
  flood: { status: FindingStatus; zones: FloodZonePart[]; reason: string | null; source: ParcelSourceRef; scope: "parcel" | "point"; coverage?: Coverage | null };
  /** True when per-district / per-zone coverage was computed completely (every feature intersected). */
  areas_reliable?: { zoning: boolean; flood: boolean };
  extras?: Partial<Record<ExtraId, ExtraFinding>>;
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
    const overlays = [
      overlayCode ? { code: overlayCode, name: str(a.des_sobre), resolution: str(a.r_sobre), effective: str(a.v_sobre) } : null,
      str(a.cali_sobre2) ? { code: str(a.cali_sobre2)!, name: str(a.des_sobre2), resolution: str(a.r_sobre2), effective: str(a.v_sobre2) } : null,
    ].filter((o): o is NonNullable<typeof o> => !!o);
    const key = code;
    const prev = seen.get(key);
    if (prev) {
      for (const o of overlays) if (!prev.overlays!.some((x) => x.code === o.code)) prev.overlays!.push(o);
      if (!prev.overlay && overlays[0]) prev.overlay = { code: overlays[0].code, name: overlays[0].name };
      continue;
    }
    seen.set(key, {
      code,
      name: str(a.descrip),
      family: zoningFamily(code, str(a.descrip)),
      overlay: overlays[0] ? { code: overlays[0].code, name: overlays[0].name } : null,
      overlays,
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


// ---------------------------------------------------------------------------
// Coverage → items (see coverage.ts for the method)
// ---------------------------------------------------------------------------

/**
 * Copy each category's coverage onto the matching items (area, share, small,
 * contains_pin). Items that only touch the parcel get 0; items whose geometry
 * could not be measured get null. Returns true when the coverage is complete.
 */
export function applyCoverage<T extends { area_m2?: number | null; share?: number | null; small?: boolean; contains_pin?: boolean }>(items: T[], keyOf: (t: T) => string, c: Coverage): boolean {
  const failed = new Set(c.warnings.flatMap((w) => (w.code === "intersection_failed" ? w.keys : [])));
  for (const t of items) {
    const k = keyOf(t);
    const part = c.parts.find((p) => p.key === k);
    // Unknown stays unknown: an item whose geometry could not be measured gets null, never 0.
    const unknown = !part && failed.has(k);
    t.area_m2 = part ? part.area_m2 : unknown ? null : 0;
    t.share = part ? part.share : unknown ? null : 0;
    t.small = part ? part.small : false;
    t.contains_pin = c.pin_key === k;
  }
  return c.complete;
}


// ---------------------------------------------------------------------------
// Extra findings (pure parsers)
// ---------------------------------------------------------------------------

const EXTRA_FIELDS: Record<Exclude<ExtraId, "soils" | "plan_territorial" | "put">, string[]> = {
  historic_zone: ["NOMBRE", "Nombre", "nombre", "ZONA", "Zona", "DESCRIPCIO", "Descripcion"],
  historic_site: ["NOMBRE", "Nombre", "nombre", "SITIO", "Sitio"],
  archaeology: ["NOMBRE", "Nombre", "nombre", "TIPO", "Tipo", "DESCRIP"],
  protected_area: ["NOMBRE", "Nombre", "nombre", "Name", "AREA", "DESIGNACIO", "Designacion"],
  natural_reserve: ["NOMBRE", "Nombre", "nombre", "Name", "RESERVA"],
  wetlands: ["Humedales", "WETLAND_TY", "ATTRIBUTE", "TIPO", "Tipo", "NOMBRE", "Nombre"],
};

type SrcRef = ExtraFinding["source"];
const unable = (id: ExtraId, source: SrcRef, reason: string, at: string, scope: ExtraFinding["scope"]): ExtraFinding =>
  ({ id, status: "unable", value: null, items: [], attributes: {}, source, scope, reason, retrieved_at: at });

/** Presence layers (historic, archaeology, protected, reserves, wetlands). */
export function parsePresenceExtra(id: keyof typeof EXTRA_FIELDS, resp: ArcGisQueryResponse | string, source: SrcRef, at: string, scope: "parcel" | "point"): ExtraFinding {
  if (typeof resp === "string" || arcgisError(resp)) return unable(id, source, typeof resp === "string" ? resp : arcgisError(resp)!, at, scope);
  const feats = features(resp);
  if (!feats.length) return { id, status: "no_mapped", value: null, items: [], attributes: {}, source, scope, reason: null, retrieved_at: at };
  const names = [...new Set(feats.map((f) => { const a = f.attributes ?? {}; for (const k of EXTRA_FIELDS[id]) { const v = str(a[k]); if (v) return v; } return null; }).filter((x): x is string => !!x))];
  return { id, status: "verified", value: names[0] ?? null, items: names.slice(0, 10), attributes: { count: feats.length }, source, scope, reason: null, retrieved_at: at };
}

/** PUT classification (CLASIPUT / DESCRIPPUT, R_PUT, V_PUT). */
export function parsePutExtra(resp: ArcGisQueryResponse | string, source: SrcRef, at: string, scope: "parcel" | "point"): ExtraFinding {
  if (typeof resp === "string" || arcgisError(resp)) return unable("put", source, typeof resp === "string" ? resp : arcgisError(resp)!, at, scope);
  const feats = features(resp);
  if (!feats.length) return { id: "put", status: "no_mapped", value: null, items: [], attributes: {}, source, scope, reason: "no_put_polygon", retrieved_at: at };
  const classes = [...new Set(feats.map((f) => { const a = f.attributes ?? {}; const c = str(a.CLASIPUT); const d = str(a.DESCRIPPUT); return c ? `${c}${d ? ` — ${d}` : ""}` : null; }).filter((x): x is string => !!x))];
  const a = feats[0]!.attributes ?? {};
  return { id: "put", status: classes.length ? "verified" : "unable", value: classes.join(" · ") || null, items: classes, attributes: { resolution: str(a.R_PUT), effective: str(a.V_PUT) }, source: { ...source, dataset_date: str(a.V_PUT) ?? source.dataset_date }, scope, reason: classes.length ? null : "put_attribute_missing", retrieved_at: at };
}

// ---------------------------------------------------------------------------
// Municipal Plan Territorial — date fields and their official meanings
// ---------------------------------------------------------------------------
//
// Layer "Municipios Informacion de PT" (JP, Planes_territoriales /
// Analisis_PT_Municipios/MapServer/1). Field aliases published by the service:
//   pt_aprobado             "Fecha Aprobada PT"                   → plan approved
//   pt_revision_1           "Toca Primera Revision"               → 1st revision DUE (a deadline, not a revision)
//   pt_revision_1_aprobada  "Fecha Aprobacion Primera Revision"   → 1st revision APPROVED
//   pt_revision_2           "Toca Segunda Revision PT"            → 2nd revision DUE
//   pt_revision_2_aprobada  "Fecha Aprobacion Segunda Revision"   → 2nd revision APPROVED
// A due date is never shown as "revised". Values are free text in the source
// ("27-dic-2024", "27_Dic-2020", "10-Sept-2026"); unreadable ones are shown
// as recorded and listed as ambiguities.

export const PT_FIELDS = {
  approved: { field: "pt_aprobado", alias: "Fecha Aprobada PT", meaning: "plan approved" },
  revision_1_due: { field: "pt_revision_1", alias: "Toca Primera Revision", meaning: "first revision due" },
  revision_1_approved: { field: "pt_revision_1_aprobada", alias: "Fecha Aprobacion Primera Revision", meaning: "first revision approved" },
  revision_2_due: { field: "pt_revision_2", alias: "Toca Segunda Revision PT", meaning: "second revision due" },
  revision_2_approved: { field: "pt_revision_2_aprobada", alias: "Fecha Aprobacion Segunda Revision", meaning: "second revision approved" },
} as const;
export type PtDateKey = keyof typeof PT_FIELDS;

const MONTHS: Record<string, number> = {
  ene: 1, jan: 1, feb: 2, mar: 3, abr: 4, apr: 4, may: 5, jun: 6, jul: 7, ago: 8, aug: 8,
  sep: 9, sept: 9, set: 9, oct: 10, nov: 11, dic: 12, dec: 12,
};
const MONTH_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** "27-dic-2024" / "27_Dic-2020" / "10-Sept-2026" → ISO date; null when it cannot be read unambiguously. */
export function parsePtDate(raw: string | null): string | null {
  if (!raw) return null;
  const m = /^\s*(\d{1,2})\s*[-_/. ]\s*([A-Za-zÁÉÍÓÚáéíóú]{3,4})\.?\s*[-_/. ]\s*(\d{4})\s*$/.exec(raw);
  if (!m) return null;
  const d = Number(m[1]);
  const mon = MONTHS[m[2]!.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")];
  const y = Number(m[3]);
  if (!mon || y < 1950 || y > 2100 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mon - 1, d));
  if (dt.getUTCMonth() !== mon - 1) return null;
  return dt.toISOString().slice(0, 10);
}
/** ISO date → "27-Dec-2024" / "27-dic-2024". */
export function ptDateText(iso: string, lang: "en" | "es" = "en"): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d}-${(lang === "es" ? MONTH_ES : MONTH_EN)[m! - 1]}-${y}`;
}

export interface PlanTerritorialDates {
  municipio: string | null;
  /** Each official date field: raw text, parsed ISO (null when unreadable). */
  dates: Record<PtDateKey, { raw: string | null; iso: string | null }>;
  /** Most recent completed approval action (plan or revision), from approval fields only. */
  latest_approval: { key: "approved" | "revision_1_approved" | "revision_2_approved"; iso: string } | null;
  /** The first revision whose due date has no matching approval date in the record. */
  pending_revision: { n: 1 | 2; due_iso: string; due_passed: boolean } | null;
}

/** Read the PT date fields with their official meanings (pure). `asOf` is the lookup date. */
export function readPlanTerritorialDates(a: Record<string, unknown>, asOf: string): { dates: PlanTerritorialDates; ambiguities: string[] } {
  const ambiguities: string[] = [];
  const dates = {} as PlanTerritorialDates["dates"];
  for (const k of Object.keys(PT_FIELDS) as PtDateKey[]) {
    const raw = str(a[PT_FIELDS[k].field]);
    const iso = parsePtDate(raw);
    if (raw && !iso) ambiguities.push(`${PT_FIELDS[k].field} ("${PT_FIELDS[k].alias}") reads "${raw}", which is not a readable date — shown as recorded.`);
    dates[k] = { raw, iso };
  }
  const today = asOf.slice(0, 10);
  for (const k of ["approved", "revision_1_approved", "revision_2_approved"] as const) {
    const iso = dates[k].iso;
    if (iso && iso > today) ambiguities.push(`${PT_FIELDS[k].field} ("${PT_FIELDS[k].alias}") is ${iso}, later than the lookup date ${today} — an approval cannot be in the future; confirm with the Junta de Planificación.`);
  }
  if (dates.revision_2_approved.iso && !dates.revision_1_approved.raw) ambiguities.push("A second-revision approval is recorded without a first-revision approval.");
  const approvals = (["approved", "revision_1_approved", "revision_2_approved"] as const)
    .map((k) => ({ key: k, iso: dates[k].iso }))
    .filter((x): x is { key: typeof x.key; iso: string } => !!x.iso && x.iso <= today)
    .sort((x, y) => (x.iso < y.iso ? 1 : -1));
  let pending: PlanTerritorialDates["pending_revision"] = null;
  for (const n of [1, 2] as const) {
    const due = dates[`revision_${n}_due`];
    const appr = dates[`revision_${n}_approved`];
    if (appr.raw) continue;
    if (due.iso) { pending = { n, due_iso: due.iso, due_passed: due.iso <= today }; break; }
  }
  return { dates: { municipio: str(a.MUNICIPIO) ?? str(a.municipio_1) ?? str(a.Nombre), dates, latest_approval: approvals[0] ?? null, pending_revision: pending }, ambiguities };
}

/** Municipal Plan Territorial record: approval, revisions approved and revision deadlines — kept apart. */
export function parsePlanTerritorialExtra(resp: ArcGisQueryResponse | string, source: SrcRef, at: string): ExtraFinding {
  if (typeof resp === "string" || arcgisError(resp)) return unable("plan_territorial", source, typeof resp === "string" ? resp : arcgisError(resp)!, at, "municipality");
  const a = features(resp)[0]?.attributes;
  if (!a) return { id: "plan_territorial", status: "no_mapped", value: null, items: [], attributes: {}, source, scope: "municipality", reason: "no_municipal_record", retrieved_at: at };
  const { dates: d, ambiguities } = readPlanTerritorialDates(a, at);
  const approvedIso = d.dates.approved.iso;
  const approvedRaw = d.dates.approved.raw;
  const parts: string[] = [];
  if (approvedRaw) parts.push(`approved ${approvedIso ? ptDateText(approvedIso) : `"${approvedRaw}" (as recorded)`}`);
  for (const n of [1, 2] as const) {
    const ap = d.dates[`revision_${n}_approved`];
    if (ap.raw) parts.push(`${n === 1 ? "first" : "second"} revision approved ${ap.iso ? ptDateText(ap.iso) : `"${ap.raw}" (as recorded)`}`);
  }
  if (d.pending_revision) parts.push(`${d.pending_revision.n === 1 ? "first" : "second"} revision ${d.pending_revision.due_passed ? "was due" : "due"} ${ptDateText(d.pending_revision.due_iso)}${d.pending_revision.due_passed ? " — no revision approval recorded" : ""}`);
  const raw: Record<string, string | null> = {};
  for (const k of [...Object.values(PT_FIELDS).map((f) => f.field), "Estatus_ripot", "Estatus_ripot2", "orden_ejecutiva", "orde_ejecutiva_1rev", "en_proceso_primera_rev", "en_proceso_segunda_rev", "MUNICIPIO"]) raw[k] = str(a[k]);
  return {
    id: "plan_territorial",
    status: approvedRaw ? "verified" : "no_mapped",
    value: approvedRaw ? `${d.municipio ?? ""} Plan Territorial — ${parts.join("; ")}` : null,
    items: [],
    attributes: {
      municipio: d.municipio,
      approved: approvedIso,
      revision_1_due: d.dates.revision_1_due.iso,
      revision_1_approved: d.dates.revision_1_approved.iso,
      revision_2_due: d.dates.revision_2_due.iso,
      revision_2_approved: d.dates.revision_2_approved.iso,
      latest_approval: d.latest_approval?.iso ?? null,
      latest_approval_kind: d.latest_approval?.key ?? null,
      pending_revision: d.pending_revision ? d.pending_revision.n : null,
      pending_revision_due: d.pending_revision?.due_iso ?? null,
      pending_revision_due_passed: d.pending_revision ? (d.pending_revision.due_passed ? "yes" : "no") : null,
      hierarchy: str(a.jerarquia),
      review_status: str(a.Estatus_ripot2) ?? str(a.Estatus_ripot),
      term_status: str(a.Estatus_ripot),
      executive_order: str(a.orden_ejecutiva),
    },
    raw,
    ambiguities,
    source, scope: "municipality", reason: approvedRaw ? null : "no_approved_plan_recorded", retrieved_at: at,
  };
}

// ---------------------------------------------------------------------------
// USDA NRCS soils (SSURGO via Soil Data Access)
// ---------------------------------------------------------------------------

type SdaTable = { Table?: unknown[][] } | null;
/** SDA "JSON+COLUMNNAME" table → row objects (first row = column names). */
export function sdaRows(resp: unknown): Array<Record<string, string | null>> | null {
  const t = (resp as SdaTable)?.Table;
  if (!Array.isArray(t)) return resp && typeof resp === "object" ? [] : null;
  const cols = (t[0] ?? []).map((c) => String(c));
  return t.slice(1).map((r) => Object.fromEntries(cols.map((c, i) => [c, r[i] === null || r[i] === undefined || r[i] === "" ? null : String(r[i])])));
}

const soilAttrs = (r: Record<string, string | null>): Record<string, string | number | null> => ({
  musym: r.musym ?? null,
  muname: r.muname ?? null,
  drainage_class: r.drclassdcd ?? r.drainagecl ?? null,
  flooding_frequency: r.flodfreqdcd ?? null,
  hydric_percent: r.hydclprs !== null && r.hydclprs !== undefined && r.hydclprs !== "" && Number.isFinite(Number(r.hydclprs)) ? Number(r.hydclprs) : null,
  hydric_rating: r.hydricrating ?? null,
  survey_area: r.areasymbol ? `${r.areasymbol}${r.areaname ? ` — ${r.areaname}` : ""}` : null,
  survey_version: r.saverest ?? null,
});

/** Soil map unit at the pin (SDA point query). */
export function parseSoilsPin(resp: unknown): NonNullable<ExtraFinding["pin"]> {
  if (typeof resp === "string") return { status: "unable", key: null, value: null, attributes: {}, reason: resp };
  const rows = sdaRows(resp);
  if (rows === null) return { status: "unable", key: null, value: null, attributes: {}, reason: "unreadable_response" };
  const r = rows[0];
  if (!r) return { status: "no_mapped", key: null, value: null, attributes: {}, reason: "no_soil_map_unit" };
  return { status: "verified", key: r.mukey ?? r.musym ?? null, value: `${r.muname ?? ""}${r.musym ? ` (${r.musym})` : ""}`, attributes: soilAttrs(r), reason: null };
}

/** WKT POLYGON / MULTIPOLYGON / GEOMETRYCOLLECTION → lon/lat polygons (lines and points have no area and are skipped). */
export function wktPolygons(wkt: string | null): number[][][][] {
  if (!wkt) return [];
  const out: number[][][][] = [];
  const re = /(MULTIPOLYGON|POLYGON)\s*(\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\))/gi;
  for (const m of wkt.matchAll(re)) {
    const body = m[2]!;
    const polyTexts = m[1]!.toUpperCase() === "POLYGON" ? [body.slice(1, -1)] : [...body.slice(1, -1).matchAll(/\(((?:\([^()]*\)\s*,?\s*)+)\)/g)].map((x) => x[1]!);
    for (const pt of polyTexts) {
      const rings = [...pt.matchAll(/\(([^()]*)\)/g)].map((r) => r[1]!.split(",").map((pair) => pair.trim().split(/\s+/).map(Number)).filter((p) => p.length >= 2 && p.every(Number.isFinite)));
      if (rings.length && rings[0]!.length >= 4) out.push(rings);
    }
  }
  return out;
}

/**
 * Parcel-wide soils: SDA rows of (mukey, musym, muname, …, wkt) clipped to the
 * parcel. Returns the per-unit polygons (for coverage) and descriptive info.
 */
export function parseSoilsParcel(resp: unknown): { status: "verified" | "no_mapped" | "unable"; reason: string | null; features: Array<{ key: string; polygons: number[][][][] }>; info: NonNullable<ExtraFinding["part_info"]>; survey: { area: string | null; version: string | null } } {
  if (typeof resp === "string") return { status: "unable", reason: resp, features: [], info: {}, survey: { area: null, version: null } };
  const rows = sdaRows(resp);
  if (rows === null) return { status: "unable", reason: "unreadable_response", features: [], info: {}, survey: { area: null, version: null } };
  if (!rows.length) return { status: "no_mapped", reason: "no_soil_map_unit", features: [], info: {}, survey: { area: null, version: null } };
  const info: NonNullable<ExtraFinding["part_info"]> = {};
  const feats: Array<{ key: string; polygons: number[][][][] }> = [];
  for (const r of rows) {
    const key = r.musym ?? r.mukey ?? "";
    if (!key) continue;
    info[key] ??= { label: r.muname ?? key, attributes: soilAttrs(r) };
    const polys = wktPolygons(r.wkt ?? null);
    if (polys.length) feats.push({ key, polygons: polys });
  }
  const a = soilAttrs(rows[0]!);
  return { status: "verified", reason: null, features: feats, info, survey: { area: (a.survey_area as string | null) ?? null, version: (a.survey_version as string | null) ?? null } };
}

/**
 * Soils finding. Parcel-wide coverage when available; the pin answer is
 * always kept separately. Only a point answer → scope "point" with the
 * limitation stated.
 */
export function buildSoilsExtra(input: { pin: unknown; parcel: ReturnType<typeof parseSoilsParcel> | null; coverage: Coverage | null; parcelLimitation: string | null }, source: SrcRef, at: string): ExtraFinding {
  const pin = parseSoilsPin(input.pin);
  const p = input.parcel;
  if (p && p.status === "verified" && input.coverage && input.coverage.parts.length) {
    const c = input.coverage;
    const label = (k: string) => `${k} — ${p.info[k]?.label ?? k}`;
    return {
      id: "soils", status: "verified",
      value: c.parts.map((x) => x.key).join(" · "),
      items: c.parts.map((x) => label(x.key)),
      attributes: { survey_area: p.survey.area, survey_version: p.survey.version, map_units: c.parts.length },
      source: { ...source, dataset_date: p.survey.version ?? source.dataset_date },
      scope: "parcel", reason: null, retrieved_at: at,
      coverage: c, part_info: p.info, pin, parcel_limitation: null,
    };
  }
  const limitation = input.parcelLimitation ?? (p ? (p.status === "unable" ? `parcel-wide soil query failed (${p.reason})` : p.status === "no_mapped" ? "no soil map unit intersects the parcel" : "parcel-wide soil areas could not be computed") : "no parcel boundary — point lookup only");
  if (pin.status === "verified") {
    return {
      id: "soils", status: "verified", value: pin.value, items: pin.value ? [pin.value] : [], attributes: pin.attributes,
      source: { ...source, dataset_date: (pin.attributes.survey_version as string | null) ?? source.dataset_date },
      scope: "point", reason: null, retrieved_at: at, coverage: null, pin, parcel_limitation: limitation,
    };
  }
  if (pin.status === "no_mapped") return { id: "soils", status: "no_mapped", value: null, items: [], attributes: {}, source, scope: "point", reason: "no_soil_map_unit", retrieved_at: at, pin, parcel_limitation: limitation };
  return { ...unable("soils", source, pin.reason ?? "error", at, "point"), pin, parcel_limitation: limitation };
}

/** @deprecated point-only parser kept for older callers; use buildSoilsExtra. */
export function parseSoilsExtra(resp: unknown, source: SrcRef, at: string): ExtraFinding {
  return buildSoilsExtra({ pin: resp, parcel: null, coverage: null, parcelLimitation: "point lookup only" }, source, at);
}
