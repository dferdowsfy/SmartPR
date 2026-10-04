import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPropertyReport, belongsToSite, reportSummaryText, restorePropertyReport, type PropertyReportContext } from "./propertyReport.ts";
import { parseFloodZones, parseParcelBoundary, parseZoningDistricts, ringsToGeoJson, toPrStatePlane, type ParcelFindings } from "./parcel.ts";
import { LAYER_SOURCES, unavailableSiteLayers, type SiteLayers } from "./layers.ts";
import type { IntakeSite } from "./intakeLocation.ts";

const LAT = 18.29585, LNG = -65.99355;
const RING = [[-65.996, 18.294], [-65.996, 18.298], [-65.991, 18.298], [-65.991, 18.294], [-65.996, 18.294]];
const at = "2026-10-04T12:00:00.000Z";
const ctx: PropertyReportContext = { activity: "Agro-tourism lodge", businessType: "Lodging", projectTypes: [], locationRequirements: [] };

function site(lat = LAT, lng = LNG, layers: SiteLayers | null = null): IntakeSite {
  return {
    latitude: lat, longitude: lng, coordinate_source: "MAP_PIN", formatted_address: "60, Calle Los Ramos, Quebrada Infierno, Gurabo, PR 00778",
    municipality: { name: "Gurabo", fips: "72063" }, barrio: { name: "Quebrada Infierno", geoid: "7206300000" }, near_boundary: false,
    designations: [], boundary_source: null, location_id: null, confirmed_at: at, layers,
  };
}
function layersAt(lat: number, lng: number): SiteLayers {
  const src = (k: keyof typeof LAYER_SOURCES) => ({ id: LAYER_SOURCES[k].id, name: LAYER_SOURCES[k].name, url: LAYER_SOURCES[k].url, layer: LAYER_SOURCES[k].layer, dataset_date: LAYER_SOURCES[k].dataset_date, version: null });
  const base = { tags: [] as string[], attributes: {}, retrieval: "live" as const, approximate: false, reason: null, retrieved_at: at };
  return {
    latitude: lat, longitude: lng, resolved_at: at,
    results: [
      { ...base, layer: "flood_zone", status: "resolved", code: "X", name: "Zone X", attributes: { FIRM_PAN: "72000C0765J", EFF_DATE: "2009-11-18" }, source: src("fema_flood_zones") },
      { ...base, layer: "flood_advisory", status: "none", code: null, name: null, source: src("jp_advisory_flood") },
      { ...base, layer: "zoning", status: "resolved", code: "R-G", name: "Rural General", source: src("jp_calificacion") },
      { ...base, layer: "terrain", status: "resolved", code: "Moderate", name: "Moderate", tags: ["LANDSLIDE_MODERATE"], source: src("usgs_landslide") },
      { ...base, layer: "coastal_zone", status: "none", code: null, name: null, source: src("jp_zona_costanera") },
      { ...base, layer: "historic_zone", status: "unknown", code: null, name: null, reason: "timeout_3500ms", retrieval: "none", source: src("jp_zonas_historicas") },
    ],
  } as SiteLayers;
}
function parcelAt(lat: number, lng: number): ParcelFindings {
  return {
    latitude: lat, longitude: lng, retrieved_at: at,
    boundary: parseParcelBoundary({ features: [{ attributes: { NUM_CATASTRO: "173-000-001-39" }, geometry: { rings: [RING] } }] } as never, lng, lat),
    zoning: parseZoningDistricts({ features: [{ attributes: { cali: "R-G", descrip: "Rural General", vigencia: "01-JUN-2023" } }, { attributes: { cali: "A-B", descrip: "Área de Bosques" } }, { attributes: { cali: "R-G", descrip: "Rural General" } }] } as never, "parcel"),
    flood: parseFloodZones({ features: [{ attributes: { FLD_ZONE: "X", ZONE_SUBTY: "AREA OF MINIMAL FLOOD HAZARD", SFHA_TF: "F" } }] } as never, "parcel"),
  };
}

test("parcel parsing keeps every district (deduped) and the boundary/area", () => {
  const p = parcelAt(LAT, LNG);
  assert.equal(p.boundary.status, "sourced");
  assert.equal(p.boundary.value?.catastro, "173-000-001-39");
  assert.ok(p.boundary.value!.area_m2 > 200_000 && p.boundary.value!.area_m2 < 260_000, String(p.boundary.value!.area_m2));
  assert.deepEqual(p.zoning.districts.map((d) => d.code), ["R-G", "A-B"]);
});

test("no polygon ≠ no restriction; service failure = unavailable", () => {
  assert.equal(parseZoningDistricts({ features: [] } as never, "parcel").status, "none_mapped");
  assert.equal(parseZoningDistricts("timeout_9000ms", "parcel").status, "unavailable");
  assert.equal(parseParcelBoundary("http_503", LNG, LAT).status, "unavailable");
});

test("NAD83 State Plane origin and orientation", () => {
  const o = toPrStatePlane(17 + 50 / 60, -(66 + 26 / 60));
  assert.ok(Math.abs(o.x - 200000) < 0.01 && Math.abs(o.y - 200000) < 0.01);
  const sj = toPrStatePlane(18.4655, -66.1057);
  assert.ok(sj.x > 230000 && sj.x < 240000 && sj.y > 265000 && sj.y < 275000);
  assert.ok(ringsToGeoJson([[[0, 0], [1, 0]]]) === null);
});

test("full report: parcel scope, multiple districts flagged, sources and timestamps", () => {
  const r = buildPropertyReport({ site: site(LAT, LNG, layersAt(LAT, LNG)), parcel: parcelAt(LAT, LNG), revision: 3, context: ctx, now: new Date(at) });
  const z = r.findings.find((f) => f.id === "zoning")!;
  assert.equal(z.scope, "parcel");
  assert.equal(z.value?.en, "R-G · A-B");
  assert.equal(z.tone, "hazard"); // includes a conservation district (A-B) → protection
  assert.equal(z.constraint, "protection");
  assert.equal(r.property.catastro.value, "173-000-001-39");
  assert.ok(r.property.boundary.area_m2! > 0);
  assert.equal(r.findings.find((f) => f.id === "flood_zone")!.value?.en, "Zone X");
  assert.equal(r.findings.find((f) => f.id === "historic_zone")!.state, "unavailable");
  // No PUT answer for this synthetic parcel → "unable to verify", never "not performed" / "no".
  assert.equal(r.findings.find((f) => f.id === "put")!.state, "unavailable");
  // No proposed activity yet → permitted uses are not applicable until one is described.
  assert.equal(r.findings.find((f) => f.id === "permitted_uses")!.state, "not_applicable");
  for (const f of r.findings.filter((f) => f.state === "sourced")) assert.ok(f.sources.length && f.looked_up_at, f.id);
  assert.ok(belongsToSite(r));
  assert.equal(r.location_revision, 3);
  assert.match(r.next_steps.activity.en, /Agro-tourism lodge/);
  assert.ok(r.next_steps.steps.some((s) => s.id === "verify_use" && s.sources.length));
});

test("layers for another point are never shown (stale/loading only)", () => {
  const r = buildPropertyReport({ site: site(LAT, LNG, layersAt(18.4, -66.1)), parcel: parcelAt(18.4, -66.1), revision: 4, context: ctx });
  for (const f of r.findings) assert.ok(f.state !== "sourced" || f.id === "never", `${f.id} ${f.state}`);
  assert.equal(r.findings.find((f) => f.id === "flood_zone")!.value, null);
  assert.equal(r.property.catastro.value, null);
  assert.equal(r.property.boundary.state, "stale");
  const loading = buildPropertyReport({ site: site(), parcel: null, parcelLoading: true, revision: 5, context: ctx });
  assert.equal(loading.findings.find((f) => f.id === "flood_zone")!.state, "loading");
  assert.equal(loading.property.boundary.state, "loading");
});

test("source outage → unavailable, never 'none'", () => {
  const r = buildPropertyReport({ site: site(LAT, LNG, unavailableSiteLayers(LAT, LNG, "layers_service_unreachable")), parcel: null, revision: 1, context: ctx });
  for (const id of ["zoning", "flood_zone", "terrain", "coastal_zone"]) assert.equal(r.findings.find((f) => f.id === id)!.state, "unavailable", id);
  assert.ok(r.next_steps.unresolved.length >= 4);
  assert.ok(r.next_steps.steps.some((s) => s.id === "resolve_zoning"));
});

test("summary + restore round trip; fingerprint stable for same data", () => {
  const a = buildPropertyReport({ site: site(LAT, LNG, layersAt(LAT, LNG)), parcel: parcelAt(LAT, LNG), revision: 1, context: ctx, now: new Date(at) });
  const b = buildPropertyReport({ site: site(LAT, LNG, layersAt(LAT, LNG)), parcel: parcelAt(LAT, LNG), revision: 1, context: ctx, now: new Date("2026-10-05T00:00:00Z") });
  assert.equal(a.fingerprint, b.fingerprint);
  const txt = reportSummaryText(a, "es");
  assert.match(txt, /Catastro: 173-000-001-39/);
  assert.match(txt, /toda la parcela/);
  assert.deepEqual(restorePropertyReport(JSON.parse(JSON.stringify(a))), a);
  assert.equal(restorePropertyReport({ schema: "other" }), null);
});
