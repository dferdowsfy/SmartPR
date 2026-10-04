// Property & Site Report hardening — regression tests.
// Real parcel: Aguas Buenas 224-000-006-78 (fixtures/parcelRaw.json, recorded
// live 2026-10-04, replayed through resolveParcelFindings). Pin layers mirror
// the report the user pasted for that parcel. Synthetic parcels cover the
// pin-in-X / parcel-in-A case, overlaps and missing boundaries.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { basisOf, buildPropertyReport, reportArea, reportLeadSummary, reportSummaryText, restorePropertyReport, type PropertyReport, type PropertyReportContext } from "./propertyReport.ts";
import { parseFloodZones, parseParcelBoundary, parseZoningDistricts, applyCoverage, type ParcelFindings } from "./parcel.ts";
import { computeCoverage } from "./coverage.ts";
import { resolveParcelFindings } from "./parcelService.ts";
import { LAYER_SOURCES, type SiteLayers } from "./layers.ts";
import type { IntakeSite } from "./intakeLocation.ts";

const here = dirname(fileURLToPath(import.meta.url));
const RAW = JSON.parse(readFileSync(join(here, "fixtures/parcelRaw.json"), "utf8"));
const at = "2026-10-04T21:18:46.000Z";
const noActivity: PropertyReportContext = { activity: null, businessType: null, projectTypes: [], locationRequirements: [] };

const src = (k: keyof typeof LAYER_SOURCES, version: string | null = null, date: string | null = null) => ({ id: LAYER_SOURCES[k].id, name: LAYER_SOURCES[k].name, url: LAYER_SOURCES[k].url, layer: LAYER_SOURCES[k].layer, dataset_date: date ?? LAYER_SOURCES[k].dataset_date, version });
const base = { tags: [] as string[], attributes: {}, retrieval: "live" as const, approximate: false, reason: null, retrieved_at: at };

function site(lat: number, lng: number, layers: SiteLayers | null, muni = "Aguas Buenas"): IntakeSite {
  return {
    latitude: lat, longitude: lng, coordinate_source: "MAP_PIN", formatted_address: null,
    municipality: { name: muni, fips: "72007" }, barrio: { name: "Sumidero", geoid: null }, near_boundary: false,
    designations: [], boundary_source: null, location_id: null, confirmed_at: at, layers,
  } as unknown as IntakeSite;
}
/** Pin layers as in the pasted Aguas Buenas report. */
function abLayers(lat: number, lng: number, flood = "X"): SiteLayers {
  return {
    latitude: lat, longitude: lng, resolved_at: at,
    results: [
      { ...base, layer: "flood_zone", status: "resolved", code: flood, name: `Zone ${flood}`, tags: flood.startsWith("A") ? ["SFHA"] : [], attributes: { FIRM_PAN: "72000C1185H", EFF_DATE: "2005-04-19" }, source: src("fema_flood_zones") },
      { ...base, layer: "flood_advisory", status: "unknown", code: null, name: null, reason: "timeout_9000ms", retrieval: "none", source: src("jp_advisory_flood") },
      { ...base, layer: "zoning", status: "resolved", code: "R-G", name: "Rural General", tags: ["rural"], source: src("jp_calificacion", "JP-PT-45 · 15-SEP-2011", "2011-09-15") },
      { ...base, layer: "land_class", status: "resolved", code: "SRC", name: "Suelo Rústico Común", tags: ["SRC", "RUSTICO"], source: src("jp_calificacion", "JP-PT-45 · 15-SEP-2011", "2011-09-15") },
      { ...base, layer: "terrain", status: "resolved", code: "Moderate", name: "Moderate", tags: ["LANDSLIDE_MODERATE"], source: src("usgs_landslide") },
      { ...base, layer: "coastal_zone", status: "none", code: null, name: null, source: src("jp_zona_costanera") },
    ],
  } as SiteLayers;
}
async function abParcel(): Promise<ParcelFindings> {
  const s = RAW.sites.aguas_buenas;
  return resolveParcelFindings(s.latitude, s.longitude, {
    fetchImpl: (async (u: string) => ({ ok: s.gets[u]?.ok ?? false, status: s.gets[u]?.status ?? 599, json: async () => s.gets[u]?.body ?? null })) as never,
    postJson: async (_u, b) => s.posts.find((x: { query: string }) => x.query === (b as { query: string }).query)?.response ?? "not_recorded",
    refresh: true, now: () => new Date(at),
  });
}
async function abReport(): Promise<PropertyReport> {
  const s = RAW.sites.aguas_buenas;
  return buildPropertyReport({ site: site(s.latitude, s.longitude, abLayers(s.latitude, s.longitude)), parcel: await abParcel(), revision: 1, context: noActivity, now: new Date(at) });
}
const F = (r: PropertyReport, id: string) => r.findings.find((f) => f.id === id)!;

// ---------------------------------------------------------------------------

test("Aguas Buenas: whole-parcel zoning replaces the pin-only answer; pin kept separately; edge contacts named", async () => {
  const r = await abReport();
  const z = F(r, "zoning");
  assert.equal(z.scope, "parcel");
  assert.equal(z.value!.en, "R-G 86.1% · R-I 13.9%");
  assert.equal(z.pin!.value.en, "R-G — Rural General");
  assert.match(z.detail!.en, /R-G \(Rural General\): 13,053 m² — 86\.1% of the parcel · contains the pin/);
  assert.match(z.detail!.en, /C-I, VIAL: touches the parcel's edge only \(no area inside\)/);
  assert.equal(z.tone, "attention", "two principal districts");
  assert.equal(r.discrepancies!.length, 0, "pin and parcel geometry agree at the pin");
});

test("Aguas Buenas: parcel-wide soils with shares and attributes; pin answer separate", async () => {
  const r = await abReport();
  const s = F(r, "soils");
  assert.equal(s.scope, "parcel");
  assert.equal(s.value!.en, "HtF 75.3% · MxF 23.9% · HtE 0.8% (small)");
  assert.match(s.detail!.en, /HtF — Humatas clay, 40 to 60 percent slopes: 11,407 m² \(75\.3%\) · contains the pin · Well drained · flooding: None · hydric components: 0%/);
  assert.match(s.pin!.value.en, /^Humatas clay, 40 to 60 percent slopes \(HtF\)$/);
  assert.match(s.sources[0]!.version!, /^survey area PR686 — San Juan Area, Puerto Rico/);
  assert.match(s.sources[0]!.dataset_date!, /2026/, "SSURGO survey version date kept as the data date");
  assert.ok(r.summary!.unverified.some((u) => /Soils.*small intersection.*HtE/.test(u.en)));
});

test("Aguas Buenas: Plan Territorial due date is never 'revised'; PT classification labelled apart from PUT", async () => {
  const r = await abReport();
  const pt = F(r, "municipal_plan");
  assert.equal(pt.value!.en, "Approved 15-Sep-2011 · first revision was due 15-Sep-2019; no approval recorded");
  assert.match(pt.detail!.en, /pt_revision_1 \("Toca Primera Revision"\) = 15-Sep-2019/);
  assert.match(pt.detail!.en, /is a revision deadline, not a completed revision/);
  assert.equal(pt.scope, "municipality");
  assert.equal(pt.raw!.pt_aprobado, "15-Sep-2011");
  assert.match(F(r, "land_class").detail!.en, /JP-PT-45 — a municipal Plan Territorial resolution/);
  assert.match(F(r, "put").title.en, /island-wide/);
});

test("Aguas Buenas: refused / timed-out sources are 'unable to verify' with the reason — never official, never 'none'", async () => {
  const r = await abReport();
  for (const id of ["put", "historic_zone", "historic_site", "archaeology", "wetlands"]) {
    const f = F(r, id);
    assert.equal(f.state, "unavailable", id);
    assert.equal(f.basis, "source_unavailable", id);
    assert.equal(f.value, null, id);
    assert.match(f.detail!.en, /refused the request \(HTTP 403\)/, id);
  }
  assert.equal(F(r, "flood_advisory").state, "unavailable");
  for (const f of r.findings) if (f.state !== "sourced" && f.state !== "none_mapped") assert.notEqual(f.basis, "official", f.id);
});

test("no activity: 'Not evaluated', no complexity score, nothing prescribed", async () => {
  const r = await abReport();
  assert.equal(F(r, "permitted_uses").state, "not_evaluated");
  assert.equal(F(r, "permitted_uses").basis, "not_performed");
  assert.equal(r.flags!.find((f) => f.id === "compatibility")!.status, "not_evaluated");
  assert.equal(r.complexity, null);
  assert.ok(!r.flags!.some((f) => f.id === "complexity"));
  assert.match(r.summary!.may_affect[0]!.en, /^Not evaluated — describe the proposed activity/);
  const said = [...r.next_steps.steps.map((s) => s.text.en), ...r.flags!.map((f) => f.value.en), ...r.findings.map((f) => `${f.plain?.en ?? ""} ${f.detail?.en ?? ""}`)].join(" ");
  assert.doesNotMatch(said, /elevation certificate|plan a geotechnical|budget for|expect coastal|review required|permit is required/i);
  assert.match(F(r, "permitted_uses").notes![0]!.en, /Reglamento Conjunto .* version 2023 .* not confirmed whether later amendments apply/);
  assert.match(F(r, "permitted_uses").notes![0]!.en, /Aguas Buenas has an approved Plan Territorial/);
});

test("summary leads with mapped → may affect → unverified → next; copy/JSON carry it; area is a number with units", async () => {
  const r = await abReport();
  assert.ok(r.summary!.mapped.some((m) => /^Calificación \(zoning\): R-G 86\.1% · R-I 13\.9% \(across the parcel; at the pin: R-G — Rural General\)\.$/.test(m.en)));
  assert.ok(r.summary!.mapped.some((m) => /None mapped in: .*not the same as no constraint/.test(m.en)));
  assert.ok(r.summary!.next.some((n) => /Describe the proposed activity/.test(n.en)));
  assert.equal(r.property.area!.text.en, "15,152 m² (3.86 cuerdas)");
  const txt = reportSummaryText(r, "en");
  const order = ["WHAT IS MAPPED ON THIS PROPERTY", "WHAT MAY AFFECT THE PROPOSED PROJECT", "WHAT REMAINS UNVERIFIED", "WHAT TO PROVIDE OR INVESTIGATE NEXT", "FINDINGS", "TECHNICAL"];
  const idx = order.map((h) => txt.indexOf(h));
  assert.ok(idx.every((i, k) => i > 0 && (k === 0 || i > idx[k - 1]!)), JSON.stringify(idx));
  assert.match(txt, /Approximate area: 15,152 m² \(3\.86 cuerdas\) — From the mapped CRIM boundary/);
  assert.match(txt, /NAD83 \/ Puerto Rico & Virgin Is\. \(EPSG:32161\): X [\d,.]+ m, Y [\d,.]+ m \(units: metres\)/);
  assert.match(txt, /Historic zone: Unable to verify — source did not answer — Source unavailable, across the parcel/);
  assert.doesNotMatch(txt, /(^|\s)0(\s|$)/m, "no stray 0");
  assert.equal(r.schema, "smartpr.property-report/v2");
  assert.ok(r.versions!.coverage_method.includes("EPSG:32161"));
  const json = JSON.parse(JSON.stringify(r)) as PropertyReport;
  assert.deepEqual(json.summary, r.summary);
  assert.equal(json.findings.find((f) => f.id === "zoning")!.coverage!.parts[0]!.share, F(r, "zoning").coverage!.parts[0]!.share, "precise shares preserved");
});

// ---------------------------------------------------------------------------
// Synthetic parcels
// ---------------------------------------------------------------------------
const LAT = 18.3, LNG = -66.0, D = 0.001;
/** ArcGIS ring for [x0..x1] fractions of a D × D square. */
const rect = (x0: number, x1: number): number[][][] => [[[LNG + x0 * D, LAT], [LNG + x0 * D, LAT + D], [LNG + x1 * D, LAT + D], [LNG + x1 * D, LAT], [LNG + x0 * D, LAT]]];
function synthParcel(pinX: number, flood: Array<{ zone: string; x0: number; x1: number }>, zoning: Array<{ cali: string; x0: number; x1: number }> = [{ cali: "R-G", x0: 0, x1: 1 }]): ParcelFindings {
  const lat = LAT + D / 2, lng = LNG + pinX * D;
  const boundary = parseParcelBoundary({ features: [{ attributes: { NUM_CATASTRO: "000-000-000-00" }, geometry: { rings: rect(0, 1) } }] } as never, lng, lat);
  const g = boundary.value!.geometry;
  const z = parseZoningDistricts({ features: zoning.map((x) => ({ attributes: { cali: x.cali, descrip: x.cali } })) } as never, "parcel");
  z.coverage = computeCoverage(g, zoning.map((x) => ({ key: x.cali, rings: rect(x.x0, x.x1) })), { exclusive: true, pin: { latitude: lat, longitude: lng } });
  applyCoverage(z.districts, (d) => d.code, z.coverage);
  const fl = parseFloodZones({ features: flood.map((x) => ({ attributes: { FLD_ZONE: x.zone, ZONE_SUBTY: null, SFHA_TF: /^(A|V)/.test(x.zone) ? "T" : "F" } })) } as never, "parcel");
  fl.coverage = computeCoverage(g, flood.map((x) => ({ key: `${x.zone}|`, rings: rect(x.x0, x.x1) })), { exclusive: true, pin: { latitude: lat, longitude: lng } });
  applyCoverage(fl.zones, (q) => `${q.zone}|${q.subtype ?? ""}`, fl.coverage);
  return { latitude: lat, longitude: lng, retrieved_at: at, boundary, zoning: z, flood: fl, areas_reliable: { zoning: true, flood: true }, extras: {} };
}

test("FEMA Zone X at the pin + Zone AE on part of the parcel: both shown, explained, no false discrepancy, nothing prescribed", () => {
  const p = synthParcel(0.2, [{ zone: "X", x0: 0, x1: 0.7 }, { zone: "AE", x0: 0.7, x1: 1 }]);
  const r = buildPropertyReport({ site: site(p.latitude, p.longitude, abLayers(p.latitude, p.longitude, "X")), parcel: p, revision: 1, context: noActivity, now: new Date(at) });
  const f = F(r, "flood_zone");
  assert.equal(f.value!.en, "Zone X 70.0% · AE 30.0%");
  assert.equal(f.pin!.value.en, "Zone X");
  assert.ok(f.notes!.some((n) => /^The pin is in Zone X, and the parcel also has AE on 30\.0% of its area in a Special Flood Hazard Area\. Both are true/.test(n.en)));
  assert.equal(f.tone, "hazard");
  assert.equal(f.pill!.en, "High flood risk on part of the parcel");
  assert.equal(r.flags!.find((x) => x.id === "flood")!.value.en, "High-risk area on 30.0% of the parcel");
  assert.equal(r.discrepancies!.length, 0, "different scopes are not a discrepancy");
  const step = r.next_steps.steps.find((s) => s.id === "flood_mapped")!;
  assert.equal(step.kind, "mapped_constraint");
  assert.match(step.text.en, /mapped on 30\.0% of this parcel\. Whether any review, study or permit applies depends on the proposed work/);
});

test("same-scope discrepancy: the pin layer and the parcel geometry disagree AT THE PIN", () => {
  const p = synthParcel(0.9, [{ zone: "X", x0: 0, x1: 0.7 }, { zone: "AE", x0: 0.7, x1: 1 }]);
  const r = buildPropertyReport({ site: site(p.latitude, p.longitude, abLayers(p.latitude, p.longitude, "X")), parcel: p, revision: 1, context: noActivity, now: new Date(at) });
  assert.ok(r.discrepancies!.some((d) => /^Flood zone at the pin differs between two FEMA answers: the point lookup says Zone X, the parcel geometry puts the pin in Zone AE\.$/.test(d.en)));
  assert.ok(r.summary!.unverified.some((d) => /Flood zone at the pin differs/.test(d.en)));
});

test("overlapping polygons in an exclusive layer are a visible warning; a gap is shown as unmapped; no 100% beside another part", () => {
  const p = synthParcel(0.1, [{ zone: "X", x0: 0, x1: 1 }], [{ cali: "R-G", x0: 0, x1: 0.6 }, { cali: "R-I", x0: 0.5, x1: 0.9 }]);
  const r = buildPropertyReport({ site: site(p.latitude, p.longitude, abLayers(p.latitude, p.longitude)), parcel: p, revision: 1, context: noActivity, now: new Date(at) });
  const z = F(r, "zoning");
  assert.equal(z.value!.en, "R-G 60.0% · R-I 40.0%");
  assert.ok(z.notes!.some((n) => /overlap on .* They should not overlap; shares add up to more than 100%/.test(n.en)));
  assert.ok(z.notes!.some((n) => /No polygon in this layer covers 10\.0% of the parcel .* unmapped, not "none"/.test(n.en)));
  assert.ok(r.summary!.unverified.some((u) => /should not overlap/.test(u.en)));
  // 99.99% beside a real 0.01% strip reads ">99.9%", never "100%".
  const p2 = synthParcel(0.1, [{ zone: "X", x0: 0, x1: 0.9999 }, { zone: "AE", x0: 0.9999, x1: 1 }]);
  const r2 = buildPropertyReport({ site: site(p2.latitude, p2.longitude, abLayers(p2.latitude, p2.longitude)), parcel: p2, revision: 1, context: noActivity, now: new Date(at) });
  assert.equal(F(r2, "flood_zone").value!.en, "Zone X >99.9% · AE <0.1% (small)");
  assert.doesNotMatch(F(r2, "flood_zone").value!.en + F(r2, "flood_zone").detail!.en, /100(\.0)?%/);
  assert.equal(F(r2, "zoning").value!.en, "R-G 100%", "a sole category covering the whole parcel may read 100%");
});

test("no parcel boundary: area is 'Not available' with the reason, never a status label; soils point-only stated", () => {
  const lat = 18.31, lng = -66.01;
  const parcel: ParcelFindings = {
    latitude: lat, longitude: lng, retrieved_at: at,
    boundary: parseParcelBoundary({ features: [] } as never, lng, lat),
    zoning: parseZoningDistricts("timeout_12000ms", "point"),
    flood: parseFloodZones({ features: [] } as never, "point"),
    extras: { soils: { id: "soils", status: "verified", value: "Humatas clay, 40 to 60 percent slopes (HtF)", items: [], attributes: {}, source: { name: "USDA", url: "https://sdmdataaccess.sc.egov.usda.gov/", layer: "mapunit", dataset_date: null }, scope: "point", reason: null, retrieved_at: at, coverage: null, pin: { status: "verified", key: "HtF", value: "Humatas clay, 40 to 60 percent slopes (HtF)", attributes: {}, reason: null }, parcel_limitation: "no parcel boundary — point lookup only" } },
  };
  const r = buildPropertyReport({ site: site(lat, lng, abLayers(lat, lng)), parcel, revision: 1, context: noActivity, now: new Date(at) });
  assert.equal(r.property.area!.text.en, "Not available");
  assert.equal(r.property.area!.note.en, "no CRIM parcel boundary at the pin");
  assert.match(reportSummaryText(r, "en"), /Approximate area: Not available — no CRIM parcel boundary at the pin/);
  const z = F(r, "zoning");
  assert.equal(z.scope, "point");
  assert.match(z.detail!.en, /Whole-parcel districts not determined \(timed out after 12 s\); other districts may cover part of the lot/);
  const s = F(r, "soils");
  assert.equal(s.scope, "point");
  assert.match(s.detail!.en, /^Point lookup only — parcel-wide soil coverage not available \(no parcel boundary — point lookup only\)\.$/);
});

test("saved v1 reports still open: area, lead summary and basis are derived, never re-labelled 'official'", () => {
  const v1 = {
    schema: "smartpr.property-report/v1", fingerprint: "x", location_revision: 1, generated_at: at,
    property: { title: "T", address: { primary: "A", secondary: "B", formatted: null }, municipality: "M", barrio: null, latitude: 18, longitude: -66, coordinate_source: "MAP_PIN", precision: "point", near_boundary: false,
      catastro: { value: null, state: "unavailable", source: null }, boundary: { state: "unavailable", geometry: null, area_m2: null, source: null },
      technical: { nad83_state_plane: { x: 1, y: 2, epsg: 32161, note: { en: "n", es: "n" } }, municipality_fips: null, barrio_geoid: null, location_id: null } },
    findings: [{ id: "historic_zone", group: "environment", title: { en: "Historic zone", es: "Zona histórica" }, value: null, detail: null, state: "unavailable", tone: "unknown", scope: "parcel", sources: [], looked_up_at: null, point: null, key: false, basis: "official", constraint: "information" }],
    next_steps: { activity: { en: "a", es: "a" }, missing: [], unresolved: [{ en: "u", es: "u" }], steps: [], location_requirements: [] },
    sources: [], ai_explanations: [], disclaimer: { en: "d", es: "d" },
  };
  const r = restorePropertyReport(JSON.parse(JSON.stringify(v1)))!;
  assert.ok(r);
  assert.equal(reportArea(r).text.en, "Not available");
  assert.equal(basisOf(r.findings[0]!), "source_unavailable");
  assert.equal(reportLeadSummary(r).may_affect[0]!.en, "Not evaluated — describe the proposed activity");
  assert.match(reportSummaryText(r, "en"), /Historic zone: Unable to verify — source did not answer — Source unavailable/);
});
