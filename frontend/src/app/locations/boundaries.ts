// ============================================================================
// Bundled Puerto Rico boundaries — deterministic municipio + barrio lookup.
//
// Data: U.S. Census Bureau TIGER/Line 2024 County Subdivisions for Puerto
// Rico (public domain), built by scripts/build-pr-boundaries.py. In Puerto
// Rico a county subdivision is a barrio (or barrio-pueblo) and carries its
// county FIPS code, which is the municipio — so one point-in-polygon test
// yields both. No PostGIS, network, or LLM involved: the geometry decides.
//
// SERVER ONLY (1.6 MB of geometry): import from API routes / store code,
// never from client components.
// ============================================================================

import boundaryData from "../../kb/geo/pr_boundaries_tiger2024.json";
import type { DeterminationMethod } from "./geo";

interface RawFeature {
  g: string;
  b: string | null;
  l: string;
  c: string;
  bb: [number, number, number, number];
  r: number[][];
}

interface RawDataset {
  source: { id: string; name: string; publisher: string; version: string; url: string; license: string; simplification_m: number };
  municipios: Record<string, string>;
  features: RawFeature[];
}

interface Feature {
  geoid: string;
  barrio: string | null;
  lsad: string;
  countyFips: string;
  bbox: [number, number, number, number];
  /** Rings as flat [lng, lat, lng, lat, ...] arrays in degrees. */
  rings: Float64Array[];
}

const RAW = boundaryData as unknown as RawDataset;
export const BOUNDARY_SOURCE = RAW.source;

let decoded: Feature[] | null = null;

function features(): Feature[] {
  if (decoded) return decoded;
  decoded = RAW.features.map((f) => ({
    geoid: f.g,
    barrio: f.b,
    lsad: f.l,
    countyFips: f.c,
    bbox: f.bb,
    rings: f.r.map((deltas) => {
      const out = new Float64Array(deltas.length);
      let x = 0;
      let y = 0;
      for (let i = 0; i < deltas.length; i += 2) {
        x += deltas[i];
        y += deltas[i + 1];
        out[i] = x / 1e5;
        out[i + 1] = y / 1e5;
      }
      return out;
    }),
  }));
  return decoded;
}

/** Even-odd ray casting across all rings (handles holes and multipolygons). */
function contains(feature: Feature, lng: number, lat: number): boolean {
  const [minX, minY, maxX, maxY] = feature.bbox;
  if (lng < minX || lng > maxX || lat < minY || lat > maxY) return false;
  let inside = false;
  for (const ring of feature.rings) {
    const n = ring.length;
    for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
      const xi = ring[i];
      const yi = ring[i + 1];
      const xj = ring[j];
      const yj = ring[j + 1];
      if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/** Approximate distance (meters) from the point to the feature's boundary. */
function distanceToBoundaryM(feature: Feature, lng: number, lat: number): number {
  const mPerDegLat = 111_320;
  const mPerDegLng = 111_320 * Math.cos((lat * Math.PI) / 180);
  let best = Infinity;
  for (const ring of feature.rings) {
    for (let i = 0; i + 3 < ring.length; i += 2) {
      const ax = (ring[i] - lng) * mPerDegLng;
      const ay = (ring[i + 1] - lat) * mPerDegLat;
      const bx = (ring[i + 2] - lng) * mPerDegLng;
      const by = (ring[i + 3] - lat) * mPerDegLat;
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
      const d = Math.hypot(ax + t * dx, ay + t * dy);
      if (d < best) best = d;
    }
  }
  return best;
}

/**
 * Within this distance of a boundary the bundled (≈2 m simplified) geometry
 * cannot be trusted to have placed the point on the right side; the
 * determination is still recorded but flagged for the user to verify.
 */
export const NEAR_BOUNDARY_M = 25;

export interface PuertoRicoPlacement {
  municipio: { fips: string; name: string };
  /** Null for water areas without a defined barrio. */
  barrio: { geoid: string; name: string; barrioPueblo: boolean } | null;
  /** Meters to the nearest boundary of the containing subdivision. */
  boundaryDistanceM: number;
  nearBoundary: boolean;
}

/** Where a WGS84 point falls in Puerto Rico's municipios/barrios, or null. */
export function locateInPuertoRico(latitude: number, longitude: number): PuertoRicoPlacement | null {
  for (const f of features()) {
    if (!contains(f, longitude, latitude)) continue;
    const name = RAW.municipios[f.countyFips];
    if (!name) return null;
    const distance = distanceToBoundaryM(f, longitude, latitude);
    return {
      municipio: { fips: f.countyFips, name },
      barrio: f.barrio ? { geoid: f.geoid, name: f.barrio, barrioPueblo: f.lsad === "41" } : null,
      boundaryDistanceM: Math.round(distance),
      nearBoundary: distance < NEAR_BOUNDARY_M,
    };
  }
  return null;
}

/** A geography record ready to persist (location_geographies row minus ids). */
export interface GeographyDetermination {
  geography_type: "municipality" | "barrio";
  geography_code: string;
  geography_name: string;
  determination_method: DeterminationMethod;
  source_id: string;
  source_name: string;
  source_version: string;
  source_url: string;
  metadata: Record<string, unknown>;
}

/** Municipality (+ barrio) determinations for a point, with provenance. */
export function boundaryDeterminations(latitude: number, longitude: number): GeographyDetermination[] {
  const placement = locateInPuertoRico(latitude, longitude);
  if (!placement) return [];
  const common = {
    determination_method: "SPATIAL_INTERSECTION" as const,
    source_id: BOUNDARY_SOURCE.id,
    source_name: BOUNDARY_SOURCE.name,
    source_version: BOUNDARY_SOURCE.version,
    source_url: BOUNDARY_SOURCE.url,
  };
  const metadata = {
    predicate: "point-in-polygon",
    boundary_distance_m: placement.boundaryDistanceM,
    near_boundary: placement.nearBoundary,
    simplification_m: BOUNDARY_SOURCE.simplification_m,
  };
  const out: GeographyDetermination[] = [
    {
      ...common,
      geography_type: "municipality",
      geography_code: placement.municipio.fips,
      geography_name: placement.municipio.name,
      metadata,
    },
  ];
  if (placement.barrio) {
    out.push({
      ...common,
      geography_type: "barrio",
      geography_code: placement.barrio.geoid,
      geography_name: placement.barrio.name,
      metadata: { ...metadata, barrio_pueblo: placement.barrio.barrioPueblo },
    });
  }
  return out;
}
