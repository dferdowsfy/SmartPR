// ============================================================================
// Parcel coverage — how much of a parcel each mapped category covers.
//
// Method (deterministic, documented in every result):
//   1. Project every vertex to NAD83 / Puerto Rico & Virgin Is. State Plane
//      (EPSG:32161, metres) so areas are planar m², not degrees.
//   2. Clip each feature to the parcel.
//   3. Dissolve (union) the clipped pieces of the same category, so duplicate
//      or overlapping polygons of one category are counted once.
//   4. Union all categories → covered area; parcel − covered → unmapped;
//      Σ categories − covered → overlap between categories.
//
// Mutually exclusive layers (base zoning districts, FEMA flood zones, soil
// map units, PUT classes) should not overlap: an overlap there is a warning.
// Overlay layers (cali_sobre overlays) legitimately stack on base districts
// and are computed separately, with exclusive = false.
//
// Small intersections are kept and flagged (`small`), never dropped or
// labelled as mapping errors: the maps alone cannot tell an edge-alignment
// difference from a real strip. Only zero-area contacts (shared edges /
// corners) are not parts.
// ============================================================================

import polygonClipping, { type MultiPolygon as PcMulti, type Polygon as PcPoly } from "polygon-clipping";
import type { ParcelBoundary } from "./parcel.ts";
import { toPrStatePlane } from "./parcel.ts";

/** A part smaller than this share of the parcel is flagged as a small intersection. */
export const SMALL_SHARE = 0.01;
/** Unmapped share above which the report warns. */
export const UNMAPPED_WARN_SHARE = 0.005;
/** Overlap share (in an exclusive layer) above which the report warns. */
export const OVERLAP_WARN_SHARE = 0.001;
/** Below this many m² a clipped piece is a contact along a shared edge, not an area. */
const CONTACT_M2 = 0.01;

export const COVERAGE_METHOD = "Planar areas in NAD83 / Puerto Rico & Virgin Is. State Plane (EPSG:32161, metres); source polygons (requested generalized to about 0.5 m) clipped to the CRIM parcel and dissolved by category.";

export interface CoveragePart {
  key: string;
  /** m², unrounded. */
  area_m2: number;
  /** Fraction of the parcel (0..1), unrounded. */
  share: number;
  /** Below SMALL_SHARE of the parcel. */
  small: boolean;
  /** Source features merged into this part. */
  features: number;
}

export type CoverageWarning =
  | { code: "unmapped"; share: number; area_m2: number }
  | { code: "overlap"; share: number; area_m2: number }
  | { code: "duplicates_dissolved"; keys: string[]; area_m2: number }
  | { code: "small_parts"; keys: string[] }
  | { code: "intersection_failed"; keys: string[] }
  | { code: "snapped"; keys: string[]; grid_m: number };

export interface Coverage {
  method: string;
  exclusive: boolean;
  parcel_area_m2: number;
  /** Parts with real area, largest first. */
  parts: CoveragePart[];
  covered_m2: number;
  covered_share: number;
  unmapped_m2: number;
  unmapped_share: number;
  /** Σ part areas − covered area (area counted in more than one category). */
  overlap_m2: number;
  overlap_share: number;
  /** Category whose (clipped) geometry contains the pin, when the pin is inside the parcel. */
  pin_key: string | null;
  /** Categories returned by the source that only touch the parcel (shared edge / corner, no area). */
  contacts: string[];
  /** False when any feature could not be intersected: shares are then incomplete. */
  complete: boolean;
  warnings: CoverageWarning[];
}

// ---------------------------------------------------------------------------

const project = (p: number[]): [number, number] => {
  const { x, y } = toPrStatePlane(p[1]!, p[0]!);
  return [x, y];
};
const projectMulti = (mp: number[][][][]): PcMulti => mp.map((poly) => poly.map((ring) => ring.map(project))) as PcMulti;

function ringArea(r: Array<[number, number]> | number[][]): number {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j]![0]! + r[i]![0]!) * (r[j]![1]! - r[i]![1]!);
  return Math.abs(a) / 2;
}
/** Planar area of a polygon-clipping MultiPolygon (outer ring first, holes after). */
export function planarArea(mp: PcMulti): number {
  let a = 0;
  for (const poly of mp) poly.forEach((ring, i) => { a += i === 0 ? ringArea(ring) : -ringArea(ring); });
  return Math.max(0, a);
}

function inRing(x: number, y: number, ring: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!; const [xj, yj] = ring[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const inMulti = (x: number, y: number, mp: PcMulti) => mp.some((poly) => inRing(x, y, poly[0]!) && !poly.slice(1).some((h) => inRing(x, y, h)));

/** Parcel (lon/lat GeoJSON) → projected, normalized MultiPolygon. */
export function projectParcel(g: ParcelBoundary["geometry"]): PcMulti {
  const mp = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  return polygonClipping.union(projectMulti(mp));
}

/** Planar (EPSG:32161) area of a lon/lat parcel geometry, m². */
export function parcelPlanarArea(g: ParcelBoundary["geometry"]): number {
  return planarArea(projectParcel(g));
}

export type CoverageFeature =
  /** ArcGIS rings in lon/lat (outer clockwise, holes counter-clockwise). */
  | { key: string; rings: number[][][] }
  /** GeoJSON-style polygons in lon/lat. */
  | { key: string; polygons: number[][][][] };

/**
 * Compute coverage of `parcel` by `features`. `pin` (lon/lat) is optional.
 * Pure; never throws (a feature that cannot be intersected is reported).
 */
export function computeCoverage(
  parcel: ParcelBoundary["geometry"],
  features: CoverageFeature[],
  opts: { exclusive: boolean; pin?: { latitude: number; longitude: number } | null; /** Categories the source returned without geometry: area unknown. */ missingGeometry?: string[] }
): Coverage {
  const subject = projectParcel(parcel);
  const parcelArea = planarArea(subject);
  const byKey = new Map<string, { pieces: PcMulti[]; raw: number; features: number }>();
  const failed = new Set<string>(opts.missingGeometry ?? []);
  const seen = new Set<string>();
  // polygon-clipping can throw on near-degenerate vertices; retry on a 1 cm,
  // then 10 cm grid (projected metres) before reporting the area unknown.
  const snappedSubjects = new Map<number, PcMulti>();
  const subjectAt = (grid: number) => {
    if (!grid) return subject;
    if (!snappedSubjects.has(grid)) snappedSubjects.set(grid, polygonClipping.union(snapMulti(subject, grid)));
    return snappedSubjects.get(grid)!;
  };
  const snapped = new Map<string, number>();
  for (const f of features) {
    seen.add(f.key);
    let clipped: PcMulti | null = null;
    for (const grid of [0, 0.01, 0.1]) {
      try {
        const raw = "rings" in f ? evenOdd(f.rings, grid) : f.polygons.length ? polygonClipping.union(snapMulti(projectMulti(f.polygons), grid)) : [];
        if (!raw.length) { clipped = []; break; }
        clipped = polygonClipping.intersection(subjectAt(grid), raw);
        if (grid) snapped.set(f.key, Math.max(grid, snapped.get(f.key) ?? 0));
        break;
      } catch { /* try a coarser grid */ }
    }
    if (clipped === null) { failed.add(f.key); continue; }
    if (!clipped.length) continue;
    const a = planarArea(clipped);
    if (a < CONTACT_M2) continue;
    const e = byKey.get(f.key) ?? { pieces: [], raw: 0, features: 0 };
    e.pieces.push(clipped);
    e.raw += a;
    e.features += 1;
    byKey.set(f.key, e);
  }
  const dissolved: Array<{ key: string; geom: PcMulti; area: number; raw: number; features: number }> = [];
  for (const [key, e] of byKey) {
    // Dissolve; on a clipping-library failure retry on a 1 cm then 10 cm grid,
    // then piece by piece, before reporting the area unknown.
    let geom: PcMulti | null = null;
    if (e.pieces.length === 1) geom = e.pieces[0]!;
    for (const grid of [0, 0.01, 0.1]) {
      if (geom) break;
      try {
        const ps = e.pieces.map((x) => snapMulti(x, grid));
        geom = polygonClipping.union(ps[0]!, ...ps.slice(1));
        if (grid) snapped.set(key, Math.max(grid, snapped.get(key) ?? 0));
      } catch { /* coarser grid */ }
    }
    if (!geom) {
      try {
        let acc: PcMulti = [];
        for (const x of e.pieces) {
          try { acc = polygonClipping.union(acc, snapMulti(x, 0.01)); }
          catch { acc = polygonClipping.union(snapMulti(acc, 0.1), snapMulti(x, 0.1)); }
        }
        geom = acc;
        snapped.set(key, 0.1);
      } catch { geom = null; }
    }
    if (geom) dissolved.push({ key, geom, area: planarArea(geom), raw: e.raw, features: e.features });
    else failed.add(key);
  }
  let covered = 0;
  let coveredGeom: PcMulti = [];
  try {
    coveredGeom = dissolved.length ? polygonClipping.union(dissolved[0]!.geom, ...dissolved.slice(1).map((d) => d.geom)) : [];
    covered = planarArea(coveredGeom);
  } catch {
    covered = Math.min(parcelArea, dissolved.reduce((s, d) => s + d.area, 0));
    for (const d of dissolved) failed.add(d.key);
  }
  const sum = dissolved.reduce((s, d) => s + d.area, 0);
  const share = (a: number) => (parcelArea > 0 ? a / parcelArea : 0);
  const parts: CoveragePart[] = dissolved
    .map((d) => ({ key: d.key, area_m2: d.area, share: share(d.area), small: share(d.area) < SMALL_SHARE, features: d.features }))
    .sort((a, b) => b.area_m2 - a.area_m2);
  const unmapped = Math.max(0, parcelArea - covered);
  const overlap = Math.max(0, sum - covered);
  let pinKey: string | null = null;
  if (opts.pin) {
    const [px, py] = project([opts.pin.longitude, opts.pin.latitude]);
    pinKey = dissolved.find((d) => inMulti(px, py, d.geom))?.key ?? null;
  }
  const warnings: CoverageWarning[] = [];
  if (share(unmapped) > UNMAPPED_WARN_SHARE) warnings.push({ code: "unmapped", share: share(unmapped), area_m2: unmapped });
  if (opts.exclusive && share(overlap) > OVERLAP_WARN_SHARE) warnings.push({ code: "overlap", share: share(overlap), area_m2: overlap });
  const dup = dissolved.filter((d) => d.raw - d.area > CONTACT_M2 * 100);
  if (dup.length) warnings.push({ code: "duplicates_dissolved", keys: dup.map((d) => d.key), area_m2: dup.reduce((s, d) => s + (d.raw - d.area), 0) });
  const small = parts.filter((p) => p.small);
  if (small.length) warnings.push({ code: "small_parts", keys: small.map((p) => p.key) });
  if (failed.size) warnings.push({ code: "intersection_failed", keys: [...failed] });
  if (snapped.size) warnings.push({ code: "snapped", keys: [...snapped.keys()], grid_m: Math.max(...snapped.values()) });
  return {
    method: COVERAGE_METHOD,
    exclusive: opts.exclusive,
    parcel_area_m2: parcelArea,
    parts,
    covered_m2: covered,
    covered_share: share(covered),
    unmapped_m2: unmapped,
    unmapped_share: share(unmapped),
    overlap_m2: overlap,
    overlap_share: share(overlap),
    pin_key: pinKey,
    contacts: [...seen].filter((k) => !byKey.has(k) && !failed.has(k)),
    complete: failed.size === 0,
    warnings,
  };
}

/**
 * ArcGIS rings → projected MultiPolygon by the even-odd rule (XOR of rings).
 * Independent of ring orientation, which varies between services and after
 * any clipping; for valid ArcGIS polygons it equals outer-minus-holes.
 */
function evenOdd(rings: number[][][], grid = 0): PcMulti {
  let acc: PcMulti = [];
  for (const r of rings) {
    if (!Array.isArray(r) || r.length < 4 || !r.every((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))) continue;
    acc = polygonClipping.xor(acc, snapMulti([[r.map(project)]] as PcMulti, grid));
  }
  return acc;
}
/** Snap projected coordinates to a grid (metres); drops repeated vertices. 0 = unchanged. */
function snapMulti(mp: PcMulti, grid: number): PcMulti {
  if (!grid) return mp;
  const s = (v: number) => Math.round(v / grid) * grid;
  return mp.map((poly) => poly.map((ring) => ring.map(([x, y]) => [s(x), s(y)] as [number, number]).filter((p, i, a) => i === 0 || p[0] !== a[i - 1]![0] || p[1] !== a[i - 1]![1]))) as PcMulti;
}

// ---------------------------------------------------------------------------
// Display helpers (precise values stay in the data; rounding is display-only)
// ---------------------------------------------------------------------------

/**
 * Share as text. Never "100%" while another category has area, never "0%"
 * for a real part: ">99.9%" / "<0.1%" instead.
 */
export function formatShare(share: number, othersNonZero: boolean): string {
  if (share >= 0.9995) return othersNonZero ? ">99.9%" : "100%";
  if (share > 0 && share < 0.001) return "<0.1%";
  const v = Math.round(share * 1000) / 10;
  if (v >= 100) return othersNonZero ? ">99.9%" : "100%";
  return `${v.toFixed(1)}%`;
}

/** m² as text: one decimal below 10 m², whole metres above. */
export function formatArea(m2: number): string {
  return m2 < 10 ? `${(Math.round(m2 * 10) / 10).toLocaleString("en-US")} m²` : `${Math.round(m2).toLocaleString("en-US")} m²`;
}

/** Text for each part: "CT 99.7%", with small parts marked. */
export function coverageParts(c: Coverage): Array<{ key: string; text: string; small: boolean; area: string; share: string }> {
  const nonZero = c.parts.length + (c.unmapped_share > UNMAPPED_WARN_SHARE ? 1 : 0);
  return c.parts.map((p) => ({ key: p.key, text: `${p.key} ${formatShare(p.share, nonZero > 1)}`, small: p.small, area: formatArea(p.area_m2), share: formatShare(p.share, nonZero > 1) }));
}

/** Wire format for parcel findings (keeps unrounded numbers; strips nothing). */
export type { PcMulti as ProjectedMultiPolygon, PcPoly as ProjectedPolygon };
