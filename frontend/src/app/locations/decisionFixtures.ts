// Synthetic parcels for the project-decision regression tests. Shares come
// from rectangles inside a unit square, run through the real coverage code.
// The Guaynabo case reproduces OBSERVED report inputs (not verified legal facts).
import { parseFloodZones, parseParcelBoundary, parseZoningDistricts, applyCoverage, type ParcelFindings } from "./parcel.ts";
import { computeCoverage } from "./coverage.ts";
import { LAYER_SOURCES, type SiteLayers } from "./layers.ts";
import type { IntakeSite } from "./intakeLocation.ts";

export const AT = "2026-10-05T12:00:00.000Z";
const LAT = 18.36, LNG = -66.11, D = 0.0015;
const rect = (x0: number, x1: number): number[][][] => [[[LNG + x0 * D, LAT], [LNG + x0 * D, LAT + D], [LNG + x1 * D, LAT + D], [LNG + x1 * D, LAT], [LNG + x0 * D, LAT]]];
const src = (k: keyof typeof LAYER_SOURCES) => ({ id: LAYER_SOURCES[k].id, name: LAYER_SOURCES[k].name, url: LAYER_SOURCES[k].url, layer: LAYER_SOURCES[k].layer, dataset_date: LAYER_SOURCES[k].dataset_date, version: null });
const base = { tags: [] as string[], attributes: {}, retrieval: "live" as const, approximate: false, reason: null, retrieved_at: AT };

export interface SynthSpec {
  catastro: string;
  pinX: number;
  zoning: Array<{ cali: string; x0: number; x1: number; overlay?: string }>;
  overlays?: Array<{ code: string; x0: number; x1: number }>;
  flood: Array<{ zone: string; subtype?: string | null; x0: number; x1: number }>;
  /** Mark these parcel extras as "source did not answer". */
  unavailable?: Array<"wetlands" | "protected_area" | "natural_reserve" | "historic_zone" | "historic_site" | "archaeology">;
}

export function synthParcel(spec: SynthSpec): ParcelFindings {
  const lat = LAT + D / 2, lng = LNG + spec.pinX * D;
  const boundary = parseParcelBoundary({ features: [{ attributes: { NUM_CATASTRO: spec.catastro }, geometry: { rings: rect(0, 1) } }] } as never, lng, lat);
  const g = boundary.value!.geometry;
  const pin = { latitude: lat, longitude: lng };
  const z = parseZoningDistricts({ features: spec.zoning.map((x) => ({ attributes: { cali: x.cali, descrip: x.cali, cali_sobre: x.overlay ?? null } })) } as never, "parcel");
  z.coverage = computeCoverage(g, spec.zoning.map((x) => ({ key: x.cali, rings: rect(x.x0, x.x1) })), { exclusive: true, pin });
  applyCoverage(z.districts, (d) => d.code, z.coverage);
  if (spec.overlays?.length) z.overlay_coverage = computeCoverage(g, spec.overlays.map((o) => ({ key: o.code, rings: rect(o.x0, o.x1) })), { exclusive: false, pin });
  const fl = parseFloodZones({ features: spec.flood.map((x) => ({ attributes: { FLD_ZONE: x.zone, ZONE_SUBTY: x.subtype ?? null, SFHA_TF: /^(A|V)/.test(x.zone) ? "T" : "F" } })) } as never, "parcel");
  fl.coverage = computeCoverage(g, spec.flood.map((x) => ({ key: `${x.zone}|${x.subtype ?? ""}`, rings: rect(x.x0, x.x1) })), { exclusive: true, pin });
  applyCoverage(fl.zones, (q) => `${q.zone}|${q.subtype ?? ""}`, fl.coverage);
  const ref = { id: "x", name: "test source", url: "https://example.invalid", dataset_date: null };
  const extras: ParcelFindings["extras"] = {};
  for (const id of ["wetlands", "protected_area", "natural_reserve", "historic_zone", "historic_site", "archaeology"] as const) {
    extras[id] = spec.unavailable?.includes(id)
      ? { status: "unable", value: null, items: [], attributes: {}, reason: "timeout_9000ms", source: ref, retrieved_at: AT, scope: "parcel" } as never
      : { status: "none_mapped", value: null, items: [], attributes: {}, reason: null, source: ref, retrieved_at: AT, scope: "parcel" } as never;
  }
  return { latitude: lat, longitude: lng, retrieved_at: AT, boundary, zoning: z, flood: fl, areas_reliable: { zoning: true, flood: true }, extras };
}

export function synthSite(p: ParcelFindings, municipality: string, pinZoning: string, pinFlood = "X"): IntakeSite {
  const layers = {
    latitude: p.latitude, longitude: p.longitude, resolved_at: AT,
    results: [
      { ...base, layer: "flood_zone", status: "resolved", code: pinFlood, name: `Zone ${pinFlood}`, tags: /^(A|V)/.test(pinFlood) ? ["SFHA"] : [], source: src("fema_flood_zones") },
      { ...base, layer: "flood_advisory", status: "none", code: null, name: null, source: src("jp_advisory_flood") },
      { ...base, layer: "zoning", status: "resolved", code: pinZoning, name: pinZoning, source: src("jp_calificacion") },
      { ...base, layer: "coastal_zone", status: "none", code: null, name: null, source: src("jp_zona_costanera") },
      { ...base, layer: "terrain", status: "resolved", code: "Low", name: "Low", tags: ["LANDSLIDE_LOW"], source: src("usgs_landslide") },
    ],
  } as unknown as SiteLayers;
  return {
    latitude: p.latitude, longitude: p.longitude, coordinate_source: "MAP_PIN", formatted_address: null,
    municipality: { name: municipality, fips: "72061" }, barrio: { name: "Pueblo", geoid: null }, near_boundary: false,
    designations: [], boundary_source: null, location_id: null, confirmed_at: AT, layers,
  } as unknown as IntakeSite;
}

/** Guaynabo 114-042-022-01 as observed: R-5-T 98.2%, VIAL 1.5%, D-2-T 0.3%; PA-PACUT 98.5%; Zone X 94.9%, shaded X 5.1%. */
export const GUAYNABO: SynthSpec = {
  catastro: "114-042-022-01", pinX: 0.4,
  zoning: [{ cali: "R-5-T", x0: 0, x1: 0.982, overlay: "PA-PACUT" }, { cali: "VIAL", x0: 0.982, x1: 0.997 }, { cali: "D-2-T", x0: 0.997, x1: 1 }],
  overlays: [{ code: "PA-PACUT", x0: 0, x1: 0.985 }],
  flood: [{ zone: "X", subtype: "AREA OF MINIMAL FLOOD HAZARD", x0: 0, x1: 0.949 }, { zone: "X", subtype: "0.2 PCT ANNUAL CHANCE FLOOD HAZARD", x0: 0.949, x1: 1 }],
};
