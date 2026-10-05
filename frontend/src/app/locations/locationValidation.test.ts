// Location validation & evidence-based spatial scope — regression tests.
//
// Guayama / Machete: reconstructed from the reported failure (no CRIM parcel
// boundary at the pin, VIAL / Sistema vial at the pin, yet the old report said
// "Checked across parcel" and claimed polygons were clipped and dissolved).
// Aguas Buenas: real recorded parcel (fixtures/parcelRaw.json).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPropertyReport, reportSummaryText, restorePropertyReport, type PropertyReport, type PropertyReportContext } from "./propertyReport.ts";
import { parseFloodZones, parseParcelBoundary, parseZoningDistricts, type ExtraFinding, type ParcelFindings } from "./parcel.ts";
import { resolveParcelFindings } from "./parcelService.ts";
import { LAYER_SOURCES, type SiteLayers } from "./layers.ts";
import type { IntakeSite } from "./intakeLocation.ts";
import type { LandUseAnalysis } from "./landUse.ts";

const here = dirname(fileURLToPath(import.meta.url));
const RAW = JSON.parse(readFileSync(join(here, "fixtures/parcelRaw.json"), "utf8"));
const at = "2026-10-05T14:00:00.000Z";
const ctx: PropertyReportContext = { activity: null, businessType: null, projectTypes: [], locationRequirements: [] };
const src = (k: keyof typeof LAYER_SOURCES, version: string | null = null) => ({ id: LAYER_SOURCES[k].id, name: LAYER_SOURCES[k].name, url: LAYER_SOURCES[k].url, layer: LAYER_SOURCES[k].layer, dataset_date: LAYER_SOURCES[k].dataset_date, version });
const base = { tags: [] as string[], attributes: {}, retrieval: "live" as const, approximate: false, reason: null, retrieved_at: at };

function site(lat: number, lng: number, layers: SiteLayers | null, muni: string, barrio: string): IntakeSite {
  return { latitude: lat, longitude: lng, coordinate_source: "MAP_PIN", formatted_address: null, municipality: { name: muni, fips: null }, barrio: { name: barrio, geoid: null }, near_boundary: false, designations: [], boundary_source: null, location_id: null, confirmed_at: at, layers } as unknown as IntakeSite;
}
function layers(lat: number, lng: number, zoning: { code: string; name: string; family: string }, extra: Array<Record<string, unknown>> = []): SiteLayers {
  return {
    latitude: lat, longitude: lng, resolved_at: at,
    results: [
      { ...base, layer: "flood_zone", status: "resolved", code: "X", name: "Zone X", attributes: { FIRM_PAN: "72000C1425J", EFF_DATE: "2009-11-18", ZONE_SUBTY: "AREA OF MINIMAL FLOOD HAZARD" }, source: src("fema_flood_zones") },
      { ...base, layer: "flood_advisory", status: "unknown", code: null, name: null, reason: "timeout_9000ms", retrieval: "none", source: src("jp_advisory_flood") },
      { ...base, layer: "zoning", status: "resolved", code: zoning.code, name: zoning.name, tags: [zoning.family], source: src("jp_calificacion") },
      { ...base, layer: "terrain", status: "resolved", code: "Low", name: "Low", tags: ["LANDSLIDE_LOW"], source: src("usgs_landslide") },
      { ...base, layer: "coastal_zone", status: "none", code: null, name: null, source: src("jp_zona_costanera") },
      ...extra,
    ],
  } as unknown as SiteLayers;
}
const pointExtra = (id: ExtraFinding["id"], status: ExtraFinding["status"], value: string | null): ExtraFinding =>
  ({ id, status, value, items: value ? [value] : [], attributes: {}, source: { name: `JP ${id}`, url: "https://sigejp.pr.gov/", layer: id, dataset_date: null }, scope: "point", reason: status === "unable" ? "timeout_12000ms" : null, retrieved_at: at });

/** No CRIM parcel at the pin: the service fell back to point queries everywhere. */
function noParcel(lat: number, lng: number, zoning: { code: string; name: string }): ParcelFindings {
  return {
    latitude: lat, longitude: lng, retrieved_at: at,
    boundary: parseParcelBoundary({ features: [] } as never, lng, lat),
    zoning: parseZoningDistricts({ features: [{ attributes: { cali: zoning.code, descrip: zoning.name } }] } as never, "point"),
    flood: parseFloodZones({ features: [{ attributes: { FLD_ZONE: "X", ZONE_SUBTY: "AREA OF MINIMAL FLOOD HAZARD", SFHA_TF: "F" } }] } as never, "point"),
    areas_reliable: { zoning: false, flood: false },
    extras: { put: pointExtra("put", "verified", "SRC — Suelo Rústico Común"), historic_zone: pointExtra("historic_zone", "no_mapped", null), wetlands: pointExtra("wetlands", "unable", null), soils: pointExtra("soils", "verified", "Amelia gravelly clay loam, 5 to 12 percent slopes, eroded") },
  };
}
const fakeLandUse = { activity: { use: "LU_RETAIL", useName: "Retail store", raw: "store" }, compatibility: { outcome: "permitted", reasons: [], confidence: "high", baseOutcome: "permitted", path: [] }, approvals: [], evidence: [], unresolved: [], districts: [], standards: [], questions: [], coverageGaps: [], rulesEvaluated: [], complexity: { level: "low", score: 0, factors: [] } } as unknown as LandUseAnalysis;
const F = (r: PropertyReport, id: string) => r.findings.find((f) => f.id === id)!;
const NO_PARCEL = "No cadastral parcel was identified. Findings describe the selected point only; parcel-wide checks have not been performed.";
const ROADWAY = "This point may be on a roadway rather than your intended property. Move or confirm the pin before evaluating site-specific requirements.";

const G = { lat: 17.9851, lng: -66.1418 }; // Guayama · Machete (reconstructed case)
function guayamaMachete(opts: { confirmed?: boolean; landUse?: LandUseAnalysis | null } = {}) {
  const vial = { code: "VIAL", name: "Sistema vial", family: "road" };
  return buildPropertyReport({ site: site(G.lat, G.lng, layers(G.lat, G.lng, vial), "Guayama", "Machete"), parcel: noParcel(G.lat, G.lng, vial), revision: 2, context: ctx, landUse: opts.landUse ?? null, pointConfirmed: opts.confirmed, now: new Date(at) });
}

test("Guayama/Machete: no parcel + VIAL at the pin → point-only, roadway warning, nothing labelled parcel-wide", () => {
  const r = guayamaMachete({ landUse: fakeLandUse });
  const loc = r.property.location!;
  assert.equal(loc.parcel, "not_identified");
  assert.equal(loc.roadway, true);
  assert.equal(loc.preliminary, true);
  assert.deepEqual(loc.notices.map((n) => n.en), [NO_PARCEL, ROADWAY]);
  for (const f of r.findings) assert.notEqual(f.scope, "parcel", `${f.id} must not claim parcel scope`);
  const txt = reportSummaryText(r, "en");
  assert.doesNotMatch(txt, /Checked across (verified )?parcel/i);
  assert.doesNotMatch(txt + JSON.stringify(r.versions), /clipped to the CRIM parcel and dissolved/);
  assert.match(r.versions!.coverage_method, /^Parcel calculations not performed/);
  assert.equal(r.property.area!.text.en, "Not available");
  assert.equal(r.property.catastro.text!.en, "No cadastral parcel identified at the selected point");
  assert.doesNotMatch(r.property.catastro.text!.en, /constraint|ground/i, "catastro never reuses environmental disclaimer text");
  assert.doesNotMatch(r.property.technical.nad83_state_plane.note.en + r.property.technical.nad83_state_plane.datum_note!.en, /about 1 m|differ by/);
  // VIAL is not a developable district: no permitted uses inferred, even with an activity described.
  assert.equal(r.land_use, null);
  assert.equal(F(r, "permitted_uses").state, "not_evaluated");
  assert.equal(F(r, "permitted_uses").scope, "not_evaluated");
  assert.match(F(r, "permitted_uses").detail!.en, /roadway \(VIAL \/ Sistema vial\), which is not a developable zoning district/);
  assert.equal(F(r, "zoning").pill!.en, "Roadway at the pin (VIAL)");
  assert.equal(F(r, "zoning").scope, "point");
  // Exact-property confirmation comes before anything about use.
  const a = r.assessment!;
  assert.equal(a.actions[0]!.id, "location");
  assert.match(a.actions[0]!.action.en, /^This point may be on a roadway/);
  assert.ok(a.still_needed.some((x) => x.id === "pin"));
  assert.match(a.conclusion.en, /^Preliminary, point-only review\. /);
  assert.match(a.review.find((x) => x.id === "compatibility")!.value.en, /^Not evaluated — the selected point is mapped as a roadway/);
  // FEMA zone named with its sourced description, not an unqualified "Low flood risk".
  assert.equal(F(r, "flood_zone").pill!.en, "FEMA Zone X");
  assert.match(F(r, "flood_zone").plain!.en, /^FEMA Zone X — Area of Minimal Flood Hazard \(FEMA NFHL zone subtype\)/);
  assert.equal(F(r, "flood_zone").scope, "point");
  const fl = a.mapped.find((x) => x.id === "flood_zone")!;
  assert.match(fl.value.en, /^FEMA Zone X — Area of Minimal Flood Hazard/);
  assert.equal(fl.scope, "point");
  assert.doesNotMatch(JSON.stringify(a), /Low flood risk/);
  // Clear → "No mapped intersection identified", with scope + dataset.
  const cz = a.clear.find((x) => x.id === "coastal_zone")!;
  assert.equal(cz.scope, "point");
  assert.ok(cz.dataset?.name);
  // A source that did not answer is not evaluated (never parcel-wide), with its attempted scope recorded.
  assert.equal(F(r, "wetlands").scope, "not_evaluated");
  assert.equal(F(r, "wetlands").retrieval, "no_response");
  assert.equal(F(r, "put").scope, "point");
  assert.equal(r.schema, "smartpr.property-report/v3");
});

test("Guayama/Machete after 'Confirm this point': confirmation recorded, parcel still not identified, parcel checks still not performed", () => {
  const r = guayamaMachete({ confirmed: true });
  const loc = r.property.location!;
  assert.equal(loc.point_confirmed, true);
  assert.equal(loc.parcel, "not_identified", "confirmation is not a parcel verification");
  assert.ok(loc.notices.some((n) => /You confirmed this point as your property\. That confirms the location you intend, not a parcel boundary/.test(n.en)));
  assert.ok(!r.findings.some((f) => f.scope === "parcel"));
  assert.ok(!r.assessment!.still_needed.some((x) => x.id === "pin"));
  assert.match(r.assessment!.actions[0]!.action.en, /^You confirmed this point\. No cadastral parcel boundary was identified, so parcel-wide checks remain not performed/);
});

test("missing parcel without VIAL: point-only notice (no roadway text); preliminary, pending use analysis on the selected point", () => {
  const rg = { code: "R-G", name: "Rural General", family: "rural" };
  const r = buildPropertyReport({ site: site(18.1, -66.2, layers(18.1, -66.2, rg), "Barranquitas", "Helechal"), parcel: noParcel(18.1, -66.2, rg), revision: 1, context: ctx, landUse: fakeLandUse, now: new Date(at) });
  assert.deepEqual(r.property.location!.notices.map((n) => n.en), [NO_PARCEL]);
  assert.equal(r.property.location!.roadway, false);
  const pu = F(r, "permitted_uses");
  assert.equal(pu.scope, "point");
  assert.equal(pu.value!.en, "Pending — governing regulation not verified");
  assert.match(pu.detail!.en, /based on the selected point only/);
  assert.deepEqual(r.assessment!.actions.slice(0, 2).map((x) => x.id), ["location", "compatibility"], "exact-property confirmation before use");
});

async function abParcel(): Promise<ParcelFindings> {
  const s = RAW.sites.aguas_buenas;
  return resolveParcelFindings(s.latitude, s.longitude, {
    fetchImpl: (async (u: string) => ({ ok: s.gets[u]?.ok ?? false, status: s.gets[u]?.status ?? 599, json: async () => s.gets[u]?.body ?? null })) as never,
    postJson: async (_u, b) => s.posts.find((x: { query: string }) => x.query === (b as { query: string }).query)?.response ?? "not_recorded",
    refresh: true,
  });
}
const AB = RAW.sites.aguas_buenas as { latitude: number; longitude: number };
const rgLayer = { code: "R-G", name: "Rural General", family: "rural" };

test("valid parcel with successful parcel-wide checks: verified, parcel scope, coverage method stated", async () => {
  const r = buildPropertyReport({ site: site(AB.latitude, AB.longitude, layers(AB.latitude, AB.longitude, rgLayer), "Aguas Buenas", "Sumidero"), parcel: await abParcel(), revision: 1, context: ctx, now: new Date(at) });
  assert.equal(r.property.location!.parcel, "verified");
  assert.equal(r.property.location!.notices.length, 0);
  assert.equal(r.property.location!.preliminary, false);
  for (const id of ["zoning", "flood_zone", "soils"]) assert.equal(F(r, id).scope, "parcel", id);
  assert.match(r.versions!.coverage_method, /clipped to the CRIM parcel and dissolved by category/);
  assert.equal(r.property.catastro.text!.en, "224-000-006-78");
  assert.equal(r.assessment!.actions.find((x) => x.id === "location"), undefined);
});

test("valid parcel with one failed parcel check: falls back to the pin layer and says 'at selected point only'", async () => {
  // The JP historic-zone parcel query was refused (HTTP 403, recorded); the pin layer answered "none".
  const extra = [{ ...base, layer: "historic_zone", status: "none", code: null, name: null, source: src("jp_zonas_historicas") }];
  const r = buildPropertyReport({ site: site(AB.latitude, AB.longitude, layers(AB.latitude, AB.longitude, rgLayer, extra), "Aguas Buenas", "Sumidero"), parcel: await abParcel(), revision: 1, context: ctx, now: new Date(at) });
  const hz = F(r, "historic_zone");
  assert.equal(hz.state, "none_mapped");
  assert.equal(hz.scope, "point");
  assert.match(hz.notes![0]!.en, /^Parcel-wide check failed \(the source refused the request \(HTTP 403\)\); this result is from the selected point only\.$/);
  const wl = F(r, "wetlands"); // no pin layer to fall back to
  assert.equal(wl.scope, "not_evaluated");
  assert.equal(wl.attempted_scope, "parcel");
  assert.equal(wl.retrieval, "no_response");
  assert.match(reportSummaryText(r, "en"), /• Historic zone: None mapped at the pin — At selected point only; Official map finding; Source answered/);
});

test("roadway selection, then the pin moved onto the property: new revision, no stale findings, warnings gone", async () => {
  const vial = { code: "VIAL", name: "Sistema vial", family: "road" };
  const first = buildPropertyReport({ site: site(G.lat, G.lng, layers(G.lat, G.lng, vial), "Guayama", "Machete"), parcel: noParcel(G.lat, G.lng, vial), revision: 1, context: ctx, now: new Date(at) });
  assert.equal(first.property.location!.roadway, true);
  const parcel = await abParcel();
  const moved = buildPropertyReport({ site: site(AB.latitude, AB.longitude, layers(AB.latitude, AB.longitude, rgLayer), "Aguas Buenas", "Sumidero"), parcel, revision: 2, context: ctx, now: new Date(at) });
  assert.equal(moved.location_revision, 2);
  assert.equal(moved.property.location!.roadway, false);
  assert.equal(moved.property.location!.notices.length, 0);
  assert.notEqual(moved.fingerprint, first.fingerprint);
  assert.ok(moved.findings.every((f) => !f.point || (f.point.latitude === AB.latitude && f.point.longitude === AB.longitude)));
});

test("rapid pin changes / late responses: findings answered for another point are never used", async () => {
  // Pin moved to Guayama while the Aguas Buenas parcel answer arrives late.
  const late = await abParcel();
  const vial = { code: "VIAL", name: "Sistema vial", family: "road" };
  const staleLayers = layers(AB.latitude, AB.longitude, rgLayer); // layers for the OLD pin
  const r = buildPropertyReport({ site: site(G.lat, G.lng, staleLayers, "Guayama", "Machete"), parcel: late, revision: 3, context: ctx, now: new Date(at) });
  assert.equal(r.property.boundary.state, "stale");
  assert.notEqual(r.property.location!.parcel, "verified");
  assert.ok(r.findings.every((f) => f.state !== "sourced"), "nothing sourced from another point");
  assert.ok(r.findings.every((f) => f.scope !== "parcel"));
  void vial;
  // While the new answer is pending: loading, never a verified parcel.
  const pending = buildPropertyReport({ site: site(G.lat, G.lng, null, "Guayama", "Machete"), parcel: null, parcelLoading: true, revision: 4, context: ctx, now: new Date(at) });
  assert.equal(pending.property.location!.parcel, "loading");
  assert.equal(pending.property.location!.notices.length, 0);
  assert.ok(pending.findings.every((f) => f.scope === "not_evaluated" || f.scope === "municipality"));
});

test("exports agree: copy summary, JSON and assessment carry the same location status, scope and evidence", () => {
  const r = guayamaMachete();
  const txt = reportSummaryText(r, "en");
  assert.ok(txt.includes("PRELIMINARY — SELECTED POINT ONLY"));
  for (const n of r.property.location!.notices) assert.ok(txt.includes(n.en), n.en);
  assert.ok(txt.includes("Catastro: No cadastral parcel identified at the selected point"));
  assert.ok(txt.includes(r.assessment!.conclusion.en));
  assert.match(txt, /No mapped intersection identified \(checked; not a clearance\):\n• Regulatory floodway: No mapped intersection identified \(at selected point only; FEMA National Flood Hazard Layer/);
  assert.match(txt, /• FEMA flood zone \(effective FIRM\): Zone X — At selected point only; Official map finding; Source answered \[FEMA National Flood Hazard Layer[^\]]*https:\/\/hazards\.fema\.gov/);
  assert.match(txt, /Regulation for use rules: Reglamento Conjunto .* \(publication date 2023-06-16\) — applicability to this site: not verified/);
  const json = JSON.parse(JSON.stringify(r)) as PropertyReport;
  assert.deepEqual(json.property.location, r.property.location);
  assert.deepEqual(json.findings.map((f) => [f.id, f.scope, f.retrieval]), r.findings.map((f) => [f.id, f.scope, f.retrieval]));
  assert.deepEqual(json.assessment, r.assessment);
  // A newly saved version keeps v3; an older saved report restores as saved (not rewritten).
  assert.equal(restorePropertyReport(json)!.schema, "smartpr.property-report/v3");
  const v2 = { ...json, schema: "smartpr.property-report/v2" as const };
  assert.equal(restorePropertyReport(JSON.parse(JSON.stringify(v2)))!.schema, "smartpr.property-report/v2");
});

// ---------------------------------------------------------------------------
// The supplied pre-fix report (Guayama · Machete, 17.954768, -66.118912,
// generated 2026-10-05T02:22:14Z as v2): no CRIM parcel, VIAL zoning, VIAL
// land class and PUT at the pin, coastal zone inside. Every defect it had
// must be gone.
// ---------------------------------------------------------------------------
test("supplied Guayama/Machete report: every defect of the pre-fix version is gone", () => {
  const lat = 17.954768, lng = -66.118912, when = "2026-10-05T02:22:14.577Z";
  const vial = { code: "VIAL", name: "Sistema vial", family: "road" };
  const L = layers(lat, lng, vial, [
    { ...base, layer: "land_class", status: "resolved", code: "VIAL", name: "Sistema vial", tags: ["VIAL", "NOT_A_LOT"], source: { ...src("jp_calificacion"), dataset_date: "03/19/2008" } },
  ]);
  L.results = L.results.map((x) => (x.layer === "coastal_zone" ? { ...x, status: "resolved", code: "CZM", name: "Coastal zone" } : x.layer === "zoning" ? { ...x, source: { ...x.source, dataset_date: "03/19/2008" } } : x)) as typeof L.results;
  const parcel = noParcel(lat, lng, vial);
  parcel.extras = {
    put: { ...pointExtra("put", "verified", "VIAL — Vial"), attributes: { resolution: "PUT-2014", effective: "30-nov-2015" } },
    historic_zone: pointExtra("historic_zone", "no_mapped", null), historic_site: pointExtra("historic_site", "no_mapped", null), archaeology: pointExtra("archaeology", "no_mapped", null),
    protected_area: pointExtra("protected_area", "no_mapped", null), natural_reserve: pointExtra("natural_reserve", "no_mapped", null), wetlands: pointExtra("wetlands", "no_mapped", null),
    soils: pointExtra("soils", "verified", "Vives clay, 0 to 2 percent slopes (VvA)"),
  };
  const r = buildPropertyReport({ site: site(lat, lng, L, "Guayama", "Machete"), parcel, revision: 1, context: ctx, now: new Date(when) });
  const txt = reportSummaryText(r, "en");
  // Old: "Catastro: None mapped — not the same as no constraint on the ground"
  assert.match(txt, /Catastro: No cadastral parcel identified at the selected point/);
  assert.doesNotMatch(txt, /Catastro: None mapped/);
  // Old: no location warning; activity asked for a VIAL "zoning district".
  assert.ok(txt.includes(NO_PARCEL) && txt.includes(ROADWAY));
  assert.doesNotMatch(txt, /compatibility with the VIAL zoning district/);
  assert.equal(r.assessment!.actions[0]!.id, "location");
  assert.ok(!r.assessment!.still_needed.some((x) => x.id === "activity"), "no use evaluation asked for on a roadway point");
  assert.match(txt, /• Permitted-use analysis: Not evaluated — selected point is a roadway \(VIAL\) — Not evaluated; Check not performed/);
  // Old: "Clear" list incl. "Land classification: VIAL…" and "PUT classification: VIAL…", "Low flood risk".
  assert.doesNotMatch(txt, /Clear \(checked/);
  const clearIds = r.assessment!.clear.map((x) => x.id);
  assert.ok(!clearIds.includes("land_class") && !clearIds.includes("put"), "roadway classifications are not cleared checks");
  assert.match(r.assessment!.review.find((x) => x.id === "location")!.value.en, /land classification at the pin is also VIAL; PUT classification at the pin is VIAL/);
  assert.doesNotMatch(txt, /Low flood risk/);
  assert.match(txt, /FEMA Zone X — Area of Minimal Flood Hazard/);
  // Coastal zone (a real finding) is kept.
  assert.ok(r.assessment!.review.some((x) => x.id === "coastal_zone"));
  // Old: "Checked across parcel" on permitted uses / FEMA / floodway; clipping claim; "about 1 m".
  assert.doesNotMatch(txt, /Checked across (verified )?parcel/i);
  assert.doesNotMatch(txt, /clipped to the CRIM parcel/);
  assert.match(txt, /Area method: Parcel calculations not performed/);
  assert.doesNotMatch(txt, /about 1 m/);
  // Old: duplicate calificación source in two date formats; "data" label; v2.
  assert.equal((txt.match(/Calificación vigente \(Mapas de Calificación de Suelos\) \(dataset date/g) ?? []).length, 1);
  assert.doesNotMatch(txt, /03\/19\/2008|\(data /);
  assert.match(txt, /smartpr\.property-report\/v3/);
  // Conclusion reads cleanly.
  assert.equal(r.assessment!.conclusion.en, "Preliminary, point-only review. Based on available official map sources, site review found 3 items requiring attention: the selected point appears to be on a roadway (VIAL), with no cadastral parcel identified; land-use compatibility was not evaluated on the roadway point; the site is inside the mapped coastal zone. One check could not be verified because the source did not respond or was not checked.");
});
