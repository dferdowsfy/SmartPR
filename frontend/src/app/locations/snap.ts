// ============================================================================
// Pin snapping — pure geometry (no I/O).
//
// A pin dropped from a phone often lands on the street in front of the lot
// (CRIM TIPO V / JP "VIAL"), on water (TIPO A / "AGUA"), or between parcels.
// Running lot-scoped rules (zoning, land class, catastro) on that point gives
// the road's or the sea's answer, not the property's. This module ranks the
// numbered CRIM parcels (TIPO P) near the pin and proposes a point INSIDE
// each one, so the user can confirm "move the pin onto lot X" before any
// rule runs. Nothing is moved silently: the caller shows the choice.
// ============================================================================

import { CATASTRO_RE, type ArcGisQueryResponse } from "./layers.ts";

export type LngLat = [number, number];
export type Ring = LngLat[];

export interface SnapCandidate {
  catastro: string;
  /** Shortest distance from the pin to the parcel (0 = pin is inside). */
  distance_m: number;
  /** A point well inside the parcel, safe to re-run point queries on. */
  latitude: number;
  longitude: number;
}

const M_PER_DEG_LAT = 111_320;

/** Local equirectangular projection around a reference latitude (metres). */
function projector(refLat: number) {
  const kx = M_PER_DEG_LAT * Math.cos((refLat * Math.PI) / 180);
  return (p: LngLat): [number, number] => [p[0] * kx, p[1] * M_PER_DEG_LAT];
}

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Even-odd point-in-polygon over every ring (holes handled). */
export function pointInRings(p: LngLat, rings: readonly Ring[]): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/** Distance in metres from a point to the polygon edge (ignores inside/outside). */
export function distanceToEdgeM(p: LngLat, rings: readonly Ring[]): number {
  const proj = projector(p[1]);
  const [px, py] = proj(p);
  let best = Infinity;
  for (const ring of rings) {
    for (let i = 0; i + 1 < ring.length; i++) {
      const [ax, ay] = proj(ring[i]);
      const [bx, by] = proj(ring[i + 1]);
      best = Math.min(best, segDist(px, py, ax, ay, bx, by));
    }
  }
  return best;
}

/** Distance in metres from the pin to the polygon; 0 when the pin is inside. */
export function distanceToPolygonM(p: LngLat, rings: readonly Ring[]): number {
  return pointInRings(p, rings) ? 0 : distanceToEdgeM(p, rings);
}

/**
 * A point inside the polygon, as far from its edges as a coarse-to-fine grid
 * search finds (an approximate pole of inaccessibility). Unlike the centroid
 * it is always inside, even for L-shaped or concave lots.
 */
export function interiorPoint(rings: readonly Ring[]): LngLat | null {
  const outer = rings[0];
  if (!outer || outer.length < 3) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of outer) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  let best: LngLat | null = null;
  let bestD = -1;
  let cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  let hx = (maxX - minX) / 2, hy = (maxY - minY) / 2;
  for (let round = 0; round < 4; round++) {
    const N = 10;
    for (let i = 0; i <= N; i++) {
      for (let j = 0; j <= N; j++) {
        const p: LngLat = [cx - hx + (2 * hx * i) / N, cy - hy + (2 * hy * j) / N];
        if (!pointInRings(p, rings)) continue;
        const d = distanceToEdgeM(p, rings);
        if (d > bestD) { bestD = d; best = p; }
      }
    }
    if (!best) break;
    [cx, cy] = best;
    hx /= 4; hy /= 4;
  }
  return best;
}

/**
 * Rank the numbered parcels (TIPO P with a valid catastro) in a CRIM
 * response by distance to the pin. Roads (V), water (A) and polygons
 * without a number are never offered as a lot.
 */
export function nearestLots(resp: ArcGisQueryResponse | string, latitude: number, longitude: number, opts: { max?: number; maxDistanceM?: number } = {}): SnapCandidate[] {
  if (typeof resp === "string" || !Array.isArray(resp.features)) return [];
  const pin: LngLat = [longitude, latitude];
  const out = new Map<string, SnapCandidate>();
  for (const f of resp.features) {
    const a = (f.attributes ?? {}) as Record<string, unknown>;
    const num = typeof a.NUM_CATASTRO === "string" ? a.NUM_CATASTRO.trim() : "";
    const tipo = typeof a.TIPO === "string" ? a.TIPO.trim().toUpperCase() : "";
    if (!CATASTRO_RE.test(num) || (tipo && tipo !== "P")) continue;
    const rings = (f as { geometry?: { rings?: Ring[] } }).geometry?.rings;
    if (!Array.isArray(rings) || rings.length === 0) continue;
    const d = distanceToPolygonM(pin, rings);
    if (opts.maxDistanceM != null && d > opts.maxDistanceM) continue;
    const ip = interiorPoint(rings);
    if (!ip) continue;
    const prev = out.get(num);
    if (prev && prev.distance_m <= d) continue;
    out.set(num, { catastro: num, distance_m: Math.round(d * 10) / 10, latitude: Number(ip[1].toFixed(7)), longitude: Number(ip[0].toFixed(7)) });
  }
  return [...out.values()].sort((x, y) => x.distance_m - y.distance_m).slice(0, opts.max ?? 3);
}
