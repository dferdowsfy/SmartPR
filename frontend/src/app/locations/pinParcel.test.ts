// E7 (live loop 2026-10-14, Rincón beachfront guesthouse): the intake said
// "no cadastral parcel / roadway" while Requirements showed Parcel
// 095-000-005-01. Both surfaces now read ONE parcel answer (pinParcel.ts).
// Run: npx tsx --test src/app/locations/pinParcel.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPropertyReport, type PropertyReportContext } from "./propertyReport.ts";
import { parseFloodZones, parseParcelBoundary, parseZoningDistricts, type ParcelFindings } from "./parcel.ts";
import { LAYER_SOURCES, parseCrimParcel, type SiteLayerResult, type SiteLayers } from "./layers.ts";
import { buildSiteIntelligence } from "./siteIntelligence.ts";
import { resolvePinParcel } from "./pinParcel.ts";
import type { IntakeSite } from "./intakeLocation.ts";

const at = "2026-10-14T17:44:00.000Z";
const ctx: PropertyReportContext = { activity: null, businessType: null, projectTypes: [], locationRequirements: [] };
const src = (k: keyof typeof LAYER_SOURCES) => ({ id: LAYER_SOURCES[k].id, name: LAYER_SOURCES[k].name, url: LAYER_SOURCES[k].url, layer: LAYER_SOURCES[k].layer, dataset_date: LAYER_SOURCES[k].dataset_date, version: null });
const base = { tags: [] as string[], attributes: {}, retrieval: "live" as const, approximate: false, reason: null, retrieved_at: at };
// Rincón · Puntas: the JP polygon here is "RE — Ruta Escénica", labelled 095-000-005-01 (checked live 2026-10-14).
const R = { lat: 18.3685, lng: -67.26165 };
const LABEL = "095-000-005-01";
const ring = (lng: number, lat: number, d = 0.0003) => [[[lng - d, lat - d], [lng + d, lat - d], [lng + d, lat + d], [lng - d, lat + d], [lng - d, lat - d]]];
const crimAnswer = (attrs: Record<string, unknown>) => ({ features: [{ attributes: attrs, geometry: { rings: ring(R.lng, R.lat) } }] });

function layers(parcel: SiteLayerResult, zoning: { code: string; name: string; family: string | null } = { code: "RE", name: "Ruta Escénica", family: null }): SiteLayers {
  return {
    latitude: R.lat, longitude: R.lng, resolved_at: at,
    results: [
      { ...base, layer: "flood_zone", status: "resolved", code: "X", name: "Zone X", attributes: { ZONE_SUBTY: "AREA OF MINIMAL FLOOD HAZARD" }, source: src("fema_flood_zones") },
      { ...base, layer: "zoning", status: "resolved", code: zoning.code, name: zoning.name, tags: zoning.family ? [zoning.family] : [], attributes: { cali: zoning.code, descrip: zoning.name, num_catast: LABEL }, source: src("jp_calificacion") },
      { ...base, layer: "coastal_zone", status: "resolved", code: "CZ", name: "Zona costanera", source: src("jp_zona_costanera") },
      parcel,
    ],
  } as unknown as SiteLayers;
}
function site(l: SiteLayers): IntakeSite {
  return { latitude: R.lat, longitude: R.lng, coordinate_source: "MAP_PIN", formatted_address: null, municipality: { name: "Rincón", fips: null }, barrio: { name: "Puntas", geoid: null }, near_boundary: false, designations: [], boundary_source: null, location_id: null, confirmed_at: at, layers: l } as unknown as IntakeSite;
}
function findings(crim: unknown): ParcelFindings {
  return {
    latitude: R.lat, longitude: R.lng, retrieved_at: at,
    boundary: parseParcelBoundary(crim as never, R.lng, R.lat),
    zoning: parseZoningDistricts({ features: [{ attributes: { cali: "RE", descrip: "Ruta Escénica" } }] } as never, "point"),
    flood: parseFloodZones({ features: [{ attributes: { FLD_ZONE: "X", ZONE_SUBTY: "AREA OF MINIMAL FLOOD HAZARD", SFHA_TF: "F" } }] } as never, "point"),
  };
}
const report = (l: SiteLayers, p: ParcelFindings) => buildPropertyReport({ site: site(l), parcel: p, revision: 1, context: ctx, now: new Date(at) });
const pill = (l: SiteLayers, p?: ParcelFindings | null) => buildSiteIntelligence(l, { parcel: p }).groups.flatMap((g) => g.pills).find((x) => x.layer === "parcel")!;
const notices = (r: ReturnType<typeof report>) => (r.property.location?.notices ?? []).map((n) => n.en).join(" ");

test("whole-parcel lookup reads CRIM's TIPO like the point layer: only V is a right-of-way", () => {
  assert.equal(parseParcelBoundary(crimAnswer({ NUM_CATASTRO: null, TIPO: "V" }) as never, R.lng, R.lat).reason, "only_right_of_way_polygon_at_point");
  assert.equal(parseParcelBoundary(crimAnswer({ NUM_CATASTRO: null, TIPO: "A" }) as never, R.lng, R.lat).reason, "only_water_polygon_at_point");
  assert.match(parseParcelBoundary(crimAnswer({ NUM_CATASTRO: null, TIPO: "P" }) as never, R.lng, R.lat).reason!, /^parcel_without_catastro_number \(TIPO P\)/);
  assert.equal(parseParcelBoundary({ features: [] } as never, R.lng, R.lat).reason, "no_parcel_polygon_at_point");
});

test("Rincón, CRIM lot polygon without a number: intake and Requirements both show the JP-labelled parcel, no roadway", () => {
  const crim = crimAnswer({ NUM_CATASTRO: null, TIPO: "P" });
  const l = layers(parseCrimParcel(crim as never, at, LABEL));
  const p = findings(crim);
  const r = report(l, p);
  assert.equal(r.property.location?.roadway, false, "a numberless lot is not a roadway");
  assert.doesNotMatch(notices(r), /No cadastral parcel was identified|roadway/);
  assert.match(notices(r), new RegExp(`JP zoning map labels it parcel ${LABEL}`));
  assert.match(r.property.catastro.text!.en, new RegExp(`${LABEL} \\(JP zoning-map label at the point; not confirmed by CRIM\\)`));
  for (const pp of [pill(l), pill(l, p)]) assert.equal(pp.label.en, `Parcel · ${LABEL} (JP zoning map)`);
  assert.equal(resolvePinParcel(l, p).state, "zoning_map_label");
});

test("Rincón, pin on a CRIM right-of-way while the point lookup fell back to JP: both say roadway, and neither shows a parcel number", () => {
  // The point lookup's CRIM call timed out (cold server) → JP catastro borrowed;
  // the whole-parcel lookup got CRIM's answer: a TIPO V street polygon.
  const l = layers(parseCrimParcel("timeout_6000ms", at, LABEL));
  const p = findings(crimAnswer({ NUM_CATASTRO: null, TIPO: "V" }));
  const r = report(l, p);
  assert.equal(r.property.location?.roadway, true);
  assert.match(notices(r), /may be on a roadway/);
  assert.equal(r.property.catastro.value, null, "no parcel number for a roadway pin");
  assert.doesNotMatch(r.property.catastro.text!.en, new RegExp(LABEL));
  // Requirements (pills receive the same whole-parcel findings): the same answer.
  assert.equal(pill(l, p).label.en, "Parcel · pin on a roadway");
  assert.equal(pill(l, p).status, "not_found");
  assert.doesNotMatch(pill(l, p).label.en + pill(l, p).title.en, new RegExp(LABEL), "never the borrowed JP number for a roadway pin");
});

test("a numbered CRIM parcel reads the same everywhere", () => {
  const crim = crimAnswer({ NUM_CATASTRO: "095-000-005-01", TIPO: "P" });
  const l = layers(parseCrimParcel(crim as never, at, LABEL), { code: "RT-I", name: "Residencial Turístico Intermedio", family: "tourism" });
  const p = findings(crim);
  const r = report(l, p);
  assert.equal(r.property.catastro.value, LABEL);
  assert.equal(r.property.location?.roadway, false);
  assert.equal(pill(l, p).label.en, `Parcel · ${LABEL}`);
  assert.equal(resolvePinParcel(l, p).state, "parcel");
});

test("JP VIAL at the pin with no CRIM number is a roadway on both surfaces", () => {
  const l = layers({ ...base, layer: "parcel", status: "none", code: null, name: null, attributes: { TIPO: "V" }, source: src("crim_parcels") } as unknown as SiteLayerResult, { code: "VIAL", name: "Sistema vial", family: "road" });
  const p = findings(crimAnswer({ NUM_CATASTRO: null, TIPO: "V" }));
  assert.equal(report(l, p).property.location?.roadway, true);
  assert.match(pill(l, p).label.en, /pin on a roadway/);
  assert.match(pill(l).label.en, /pin on a roadway/, "the point layers alone agree");
});

test("pills ignore whole-parcel findings for a different point", () => {
  const crim = crimAnswer({ NUM_CATASTRO: null, TIPO: "P" });
  const l = layers(parseCrimParcel(crim as never, at, LABEL));
  const other = { ...findings(crimAnswer({ NUM_CATASTRO: null, TIPO: "V" })), latitude: R.lat + 0.01 };
  assert.equal(pill(l, other).label.en, `Parcel · ${LABEL} (JP zoning map)`);
});

test("the JP placeholder catastro 000-000-000-00 is never presented as a parcel", () => {
  const l = layers({ ...base, layer: "parcel", status: "unknown", code: null, name: null, reason: "timeout_6000ms", retrieval: "none", source: src("crim_parcels") } as unknown as SiteLayerResult);
  (l.results.find((x) => x.layer === "zoning")!.attributes as Record<string, unknown>).num_catast = "000-000-000-00";
  assert.equal(resolvePinParcel(l, null).catastro, null);
});
