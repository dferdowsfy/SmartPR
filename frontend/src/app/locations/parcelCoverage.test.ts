// Coverage math, parcel-wide soils and Plan Territorial dates.
//   - Real answers: fixtures/parcelRaw.json (CRIM, JP, FEMA, USDA SDA recorded
//     live, replayed through resolveParcelFindings) and
//     fixtures/planTerritorial.json (JP "Municipios Informacion de PT").
//   - Synthetic squares for the edge cases (duplicates, small parts, gaps,
//     overlaps, overlays, edge contacts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { computeCoverage, coverageParts, formatShare, parcelPlanarArea } from "./coverage.ts";
import { applyCoverage, parsePlanTerritorialExtra, parsePtDate, readPlanTerritorialDates, wktPolygons, type ParcelBoundary } from "./parcel.ts";
import { resolveParcelFindings } from "./parcelService.ts";
import { resetEndpointHealth } from "./layerService.ts";

const here = dirname(fileURLToPath(import.meta.url));
const RAW = JSON.parse(readFileSync(join(here, "fixtures/parcelRaw.json"), "utf8"));
const PT = JSON.parse(readFileSync(join(here, "fixtures/planTerritorial.json"), "utf8"));

async function replay(name: "santurce" | "aguas_buenas") {
  const site = RAW.sites[name];
  const fetchImpl = async (u: string) => {
    const r = site.gets[u];
    if (!r) return { ok: false, status: 599, json: async () => null };
    return { ok: r.ok, status: r.status, json: async () => r.body };
  };
  const postJson = async (_url: string, body: unknown) => site.posts.find((p: { query: string }) => p.query === (body as { query: string }).query)?.response ?? "not_recorded";
  return resolveParcelFindings(site.latitude, site.longitude, { fetchImpl: fetchImpl as never, postJson, refresh: true, now: () => new Date(site.recorded_at) });
}

// ---------------------------------------------------------------------------
// Synthetic geometry: a ~100 m × 100 m parcel in San Juan.
// ---------------------------------------------------------------------------
const LAT0 = 18.45, LNG0 = -66.07;
const DLAT = 100 / 110_574;              // 100 m north–south
const DLNG = 100 / (111_320 * Math.cos((LAT0 * Math.PI) / 180)); // 100 m east–west
/** ArcGIS ring (clockwise) for the box [fx0..fx1] × [fy0..fy1] in parcel fractions. */
const box = (fx0: number, fx1: number, fy0 = 0, fy1 = 1): number[][][] => {
  const x0 = LNG0 + fx0 * DLNG, x1 = LNG0 + fx1 * DLNG, y0 = LAT0 + fy0 * DLAT, y1 = LAT0 + fy1 * DLAT;
  return [[[x0, y0], [x0, y1], [x1, y1], [x1, y0], [x0, y0]]];
};
const PARCEL: ParcelBoundary["geometry"] = { type: "Polygon", coordinates: [box(0, 1)[0]!.slice().reverse()] };
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

test("areas are planar m² in EPSG:32161 (a 100 m square ≈ 10,000 m²)", () => {
  const a = parcelPlanarArea(PARCEL);
  assert.ok(near(a, 10_000, 30), `area ${a}`);
});

test("duplicate polygons of one category are dissolved, not double-counted", () => {
  const c = computeCoverage(PARCEL, [{ key: "A", rings: box(0, 0.5) }, { key: "A", rings: box(0, 0.5) }, { key: "B", rings: box(0.5, 1) }], { exclusive: true });
  const a = c.parts.find((p) => p.key === "A")!;
  assert.ok(near(a.share, 0.5, 0.002), `A ${a.share}`);
  assert.equal(a.features, 2);
  assert.ok(near(c.covered_share, 1, 0.001));
  assert.ok(c.overlap_share < 0.001, "no overlap between A and B");
  assert.ok(c.warnings.some((w) => w.code === "duplicates_dissolved" && w.keys.includes("A")));
});

test("small intersections are kept and flagged, never dropped", () => {
  const c = computeCoverage(PARCEL, [{ key: "MAIN", rings: box(0, 0.995) }, { key: "STRIP", rings: box(0.995, 1.2) }], { exclusive: true });
  const strip = c.parts.find((p) => p.key === "STRIP");
  assert.ok(strip, "the strip is a part");
  assert.equal(strip.small, true);
  assert.ok(near(strip.share, 0.005, 0.001), `strip ${strip.share}`);
  assert.ok(near(strip.area_m2, 50, 2));
  assert.ok(c.warnings.some((w) => w.code === "small_parts" && w.keys.includes("STRIP")));
  // Display: the main part never reads "100%" while the strip exists.
  const txt = coverageParts(c).map((p) => p.text);
  assert.deepEqual(txt, ["MAIN 99.5%", "STRIP 0.5%"]);
});

test("gaps: unmapped coverage is reported, shares are of the whole parcel", () => {
  const c = computeCoverage(PARCEL, [{ key: "A", rings: box(0, 0.6) }], { exclusive: true });
  assert.ok(near(c.parts[0]!.share, 0.6, 0.002));
  assert.ok(near(c.unmapped_share, 0.4, 0.002));
  assert.ok(c.warnings.some((w) => w.code === "unmapped"));
  // The only category must not read 100% when 40% is unmapped.
  assert.equal(coverageParts(c)[0]!.text, "A 60.0%");
});

test("overlaps: a warning in a mutually exclusive layer, legitimate in an overlay layer", () => {
  const feats = [{ key: "A", rings: box(0, 0.6) }, { key: "B", rings: box(0.5, 1) }];
  const ex = computeCoverage(PARCEL, feats, { exclusive: true });
  assert.ok(near(ex.overlap_share, 0.1, 0.002), `overlap ${ex.overlap_share}`);
  assert.ok(near(ex.covered_share, 1, 0.001));
  assert.ok(ex.warnings.some((w) => w.code === "overlap"));
  const ov = computeCoverage(PARCEL, feats, { exclusive: false });
  assert.ok(near(ov.overlap_share, 0.1, 0.002));
  assert.ok(!ov.warnings.some((w) => w.code === "overlap"), "overlays may stack");
});

test("a polygon that only shares the boundary is a contact, not a part", () => {
  const c = computeCoverage(PARCEL, [{ key: "A", rings: box(0, 1) }, { key: "ROAD", rings: box(1, 1.3) }], { exclusive: true });
  assert.deepEqual(c.parts.map((p) => p.key), ["A"]);
  assert.deepEqual(c.contacts, ["ROAD"]);
  assert.equal(coverageParts(c)[0]!.text, "A 100%");
});

test("the category under the pin is identified (same-scope comparisons)", () => {
  const c = computeCoverage(PARCEL, [{ key: "X", rings: box(0, 0.7) }, { key: "A", rings: box(0.7, 1) }], { exclusive: true, pin: { latitude: LAT0 + 0.5 * DLAT, longitude: LNG0 + 0.2 * DLNG } });
  assert.equal(c.pin_key, "X");
});

test("share formatting never rounds a part to 100% or 0%", () => {
  assert.equal(formatShare(0.99999, true), ">99.9%");
  assert.equal(formatShare(1, false), "100%");
  assert.equal(formatShare(0.0004, true), "<0.1%");
  assert.equal(formatShare(0.0029, true), "0.3%");
  assert.equal(formatShare(0.8615, true), "86.2%");
});

test("WKT from SDA (POLYGON, MULTIPOLYGON, GEOMETRYCOLLECTION with lines)", () => {
  assert.equal(wktPolygons("POLYGON ((0 0, 1 0, 1 1, 0 0))").length, 1);
  assert.equal(wktPolygons("MULTIPOLYGON (((0 0, 1 0, 1 1, 0 0)), ((2 2, 3 2, 3 3, 2 2), (2.1 2.1, 2.2 2.1, 2.2 2.2, 2.1 2.1)))").length, 2);
  assert.equal(wktPolygons("MULTIPOLYGON (((0 0, 1 0, 1 1, 0 0)), ((2 2, 3 2, 3 3, 2 2), (2.1 2.1, 2.2 2.1, 2.2 2.2, 2.1 2.1)))")[1]!.length, 2, "hole kept");
  assert.equal(wktPolygons("GEOMETRYCOLLECTION (LINESTRING (0 0, 1 1), POLYGON ((0 0, 1 0, 1 1, 0 0)))").length, 1);
  assert.equal(wktPolygons("LINESTRING (0 0, 1 1)").length, 0);
});

// ---------------------------------------------------------------------------
// Real parcels (recorded)
// ---------------------------------------------------------------------------

test("Santurce 040-028-001-24: CT + a small P intersection; VE on part of the parcel, X at the pin", async () => {
  const p = await replay("santurce");
  assert.equal(p.boundary.status, "sourced");
  const z = p.zoning.coverage!;
  assert.equal(z.complete, true);
  assert.deepEqual(z.parts.map((x) => x.key), ["CT", "P"]);
  assert.ok(near(z.parts[0]!.share, 0.9968, 0.0005), `CT ${z.parts[0]!.share}`);
  assert.equal(z.parts[1]!.small, true, "P is a small intersection");
  assert.ok(near(z.parts[1]!.area_m2, 22.6, 0.5), `P ${z.parts[1]!.area_m2} m²`);
  assert.equal(z.pin_key, "CT");
  assert.ok(z.parts.length === 2 && p.zoning.districts.every((d) => d.share !== null && d.area_m2 !== null));
  assert.ok(near(p.boundary.value!.area_m2, z.parcel_area_m2, 0.01), "boundary area = coverage parcel area");
  const f = p.flood.coverage!;
  assert.deepEqual(f.parts.map((x) => x.key.split("|")[0]), ["X", "VE"]);
  assert.ok(near(f.parts[1]!.share, 0.1947, 0.0005), `VE ${f.parts[1]!.share}`);
  assert.equal(f.pin_key?.split("|")[0], "X", "the pin is in X even though VE covers part of the parcel");
  assert.equal(p.flood.zones.find((x) => x.zone === "X")!.contains_pin, true);
  assert.ok(!f.warnings.some((w) => w.code === "overlap"), "FEMA overlap below threshold");
});

test("Aguas Buenas 224-000-006-78: whole parcel is R-G 86% + R-I 14% (the pin alone said R-G); C-I and VIAL only touch", async () => {
  const p = await replay("aguas_buenas");
  const z = p.zoning.coverage!;
  assert.deepEqual(z.parts.map((x) => x.key), ["R-G", "R-I"]);
  assert.ok(near(z.parts[0]!.share, 0.8615, 0.001));
  assert.ok(near(z.parts[1]!.share, 0.1385, 0.001));
  assert.equal(z.pin_key, "R-G");
  assert.deepEqual([...z.contacts].sort(), ["C-I", "VIAL"]);
  assert.deepEqual(p.zoning.districts.map((d) => d.code), ["R-G", "R-I"], "contact-only districts are not on the parcel");
  assert.equal(coverageParts(p.flood.coverage!)[0]!.text, "X|AREA OF MINIMAL FLOOD HAZARD 100%");
});

test("parcel-wide soils (Aguas Buenas): three map units with shares; the pin answer is kept separately", async () => {
  const p = await replay("aguas_buenas");
  const s = p.extras!.soils!;
  assert.equal(s.scope, "parcel");
  assert.equal(s.parcel_limitation, null);
  assert.deepEqual(s.coverage!.parts.map((x) => x.key), ["HtF", "MxF", "HtE"]);
  assert.ok(near(s.coverage!.parts[0]!.share, 0.7528, 0.001));
  assert.equal(s.coverage!.parts[2]!.small, true, "HtE 0.8% is a small intersection, kept");
  assert.equal(s.part_info!.HtF!.label, "Humatas clay, 40 to 60 percent slopes");
  assert.equal(s.part_info!.HtF!.attributes.drainage_class, "Well drained");
  assert.equal(s.part_info!.HtF!.attributes.flooding_frequency, "None");
  assert.match(String(s.attributes.survey_area), /^PR686/);
  assert.ok(s.attributes.survey_version, "SSURGO survey version recorded");
  assert.equal(s.pin!.status, "verified");
  assert.match(s.pin!.value!, /Humatas clay, 40 to 60 percent slopes \(HtF\)/);
  assert.equal(s.coverage!.pin_key, "HtF", "pin query and parcel coverage agree at the pin");
});

test("soils without a parcel boundary: point lookup, limitation stated", async () => {
  const site = RAW.sites.santurce;
  const fetchImpl = async (u: string) => (u.includes("crim_") ? { ok: true, status: 200, json: async () => ({ features: [] }) } : { ok: site.gets[u]?.ok ?? false, status: site.gets[u]?.status ?? 599, json: async () => site.gets[u]?.body ?? null });
  const postJson = async (_u: string, body: unknown) => site.posts.find((x: { query: string }) => x.query === (body as { query: string }).query)?.response ?? "not_recorded";
  const p = await resolveParcelFindings(site.latitude, site.longitude, { fetchImpl: fetchImpl as never, postJson, refresh: true });
  const s = p.extras!.soils!;
  assert.equal(s.scope, "point");
  assert.match(s.parcel_limitation!, /point lookup only/);
  assert.equal(s.pin!.status, "verified");
});

// ---------------------------------------------------------------------------
// Plan Territorial dates
// ---------------------------------------------------------------------------

const pt = (muni: string) => parsePlanTerritorialExtra(PT.responses[muni], { name: "JP PT", url: "https://sigejp.pr.gov/", layer: "Municipios Informacion de PT", dataset_date: null }, "2026-10-04T12:00:00Z");

test("Patillas regression: approved 27-Dec-2024, revision DUE 27-Dec-2032 — never 'revised'", () => {
  const e = pt("Patillas");
  assert.equal(e.status, "verified");
  assert.equal(e.attributes.approved, "2024-12-27");
  assert.equal(e.attributes.revision_1_due, "2032-12-27");
  assert.equal(e.attributes.revision_1_approved, null);
  assert.equal(e.attributes.latest_approval, "2024-12-27");
  assert.match(e.value!, /approved 27-Dec-2024/);
  assert.match(e.value!, /first revision due 27-Dec-2032/);
  assert.doesNotMatch(e.value!, /revised/i);
  // Raw fields + provenance preserved.
  assert.equal(e.raw!.pt_aprobado, "27-dic-2024");
  assert.equal(e.raw!.pt_revision_1, "27-dic-2032");
  assert.deepEqual(e.ambiguities, []);
});

test("Plan Territorial: completed revisions, past-due revisions and messy source dates", () => {
  const ag = pt("Aguadilla");
  assert.equal(ag.attributes.revision_1_approved, "2012-01-11");
  assert.equal(ag.attributes.revision_2_approved, "2026-03-09");
  assert.equal(ag.attributes.latest_approval, "2026-03-09");
  assert.equal(ag.attributes.pending_revision, null);
  assert.match(ag.value!, /first revision approved 11-Jan-2012; second revision approved 9-Mar-2026/);
  const ab = pt("Aguas Buenas");
  assert.match(ab.value!, /first revision was due 15-Sep-2019 — no revision approval recorded/);
  assert.equal(ab.attributes.pending_revision_due_passed, "yes");
  const aguada = pt("Aguada");
  assert.equal(aguada.attributes.revision_1_due, "2020-12-27", "'27_Dic-2020' is read");
  assert.equal(aguada.attributes.revision_1_approved, "2024-12-27");
  assert.equal(parsePtDate("10-Sept-2026"), "2026-09-10");
  assert.equal(parsePtDate("3-Sep-1004"), null, "an impossible year is not guessed");
  assert.equal(parsePtDate("31-Feb-2020"), null);
});

test("Plan Territorial: an approval later than the lookup date, or an unreadable date, is an ambiguity", () => {
  const { ambiguities } = readPlanTerritorialDates({ MUNICIPIO: "X", pt_aprobado: "1-Ene-2010", pt_revision_1_aprobada: "1-Ene-2030", pt_revision_2: "pronto" }, "2026-10-04T00:00:00Z");
  assert.ok(ambiguities.some((a) => /later than the lookup date/.test(a)));
  assert.ok(ambiguities.some((a) => /"pronto"/.test(a)));
});

test("a category returned WITHOUT geometry is unknown — never dropped, never 0%", () => {
  const c = computeCoverage(PARCEL, [{ key: "A", rings: box(0, 1) }], { exclusive: true, missingGeometry: ["B"] });
  assert.equal(c.complete, false);
  assert.ok(c.warnings.some((w) => w.code === "intersection_failed" && w.keys.includes("B")));
  const items = [{ code: "A" } as { code: string; area_m2?: number | null; share?: number | null; small?: boolean; contains_pin?: boolean }, { code: "B" } as { code: string; area_m2?: number | null; share?: number | null }];
  applyCoverage(items, (d) => d.code, c);
  assert.ok(near(items[0]!.share!, 1, 0.001));
  assert.equal(items[1]!.share, null, "unknown, not 0");
  assert.equal(items[1]!.area_m2, null);
});

test("PUT geometry request fails (not refused) → classes still checked, areas stated as not computed", async () => {
  // Earlier replays recorded the PUT host refusing (403), which opens the process-wide circuit breaker.
  resetEndpointHealth();
  const site = RAW.sites.santurce;
  const fetchImpl = async (u: string) => {
    if (u.includes("PUT_v10")) {
      if (u.includes("returnGeometry=true")) return { ok: false, status: 504, json: async () => null };
      return { ok: true, status: 200, json: async () => ({ features: [{ attributes: { CLASIPUT: "SU", DESCRIPPUT: "Suelo Urbano", R_PUT: "PUT-2014", V_PUT: "30-nov-2015" } }] }) };
    }
    const r = site.gets[u];
    return r ? { ok: r.ok, status: r.status, json: async () => r.body } : { ok: false, status: 599, json: async () => null };
  };
  const postJson = async (_u: string, body: unknown) => site.posts.find((p: { query: string }) => p.query === (body as { query: string }).query)?.response ?? "not_recorded";
  const p = await resolveParcelFindings(site.latitude, site.longitude, { fetchImpl: fetchImpl as never, postJson, refresh: true });
  const put = p.extras!.put!;
  assert.equal(put.status, "verified");
  assert.equal(put.coverage ?? null, null);
  assert.match(put.parcel_limitation!, /areas not computed — the geometry request failed \(http_504\); classes checked with a 3 m edge tolerance/);
});
