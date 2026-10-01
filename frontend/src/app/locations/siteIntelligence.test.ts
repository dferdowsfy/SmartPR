// Site intelligence: coordinate ordering across every adapter, the FEMA
// advisory flood and USGS terrain signals, provider independence, unknown vs
// none, the presentation model, and municipio placement of known PR points.
// Run: npx tsx --test src/app/locations/siteIntelligence.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  LAYER_SOURCES,
  buildArcgisPointQuery,
  buildFemaMscQuery,
  checkSitePoint,
  landslideClassFromRgba,
  parseAdvisoryFlood,
  parseTerrain,
  slopePercent,
  webMercatorTilePixel,
} from "./layers.ts";
import { LayerCache, resolveSiteLayers, type FetchLike, type PngDecoder } from "./layerService.ts";
import { buildSiteIntelligence, providerStatus } from "./siteIntelligence.ts";
import { locateInPuertoRico } from "./boundaries.ts";

const CATANO = { latitude: 18.431198, longitude: -66.146143 };
const AT = "2026-10-01T12:00:00.000Z";

// ---------------------------------------------------------------------------
// Coordinates
// ---------------------------------------------------------------------------

test("a Puerto Rico point stays in Puerto Rico across every adapter", () => {
  assert.deepEqual(checkSitePoint(CATANO), { ok: true });
  // ArcGIS: x,y = longitude,latitude.
  assert.equal(new URL(buildArcgisPointQuery(LAYER_SOURCES.fema_flood_zones.url, CATANO)).searchParams.get("geometry"), "-66.146143,18.431198");
  // FEMA MSC: "longitude, latitude".
  assert.equal(new URL(buildFemaMscQuery(CATANO)).searchParams.get("AddressQuery"), "-66.146143, 18.431198");
  // USGS landslide tile (web-mercator z14) lands on the PR tile.
  const t = webMercatorTilePixel({ latitude: 18.265, longitude: -66.7 }, 14);
  assert.equal(t.row, 7346);
  assert.equal(t.col, 5156);
  assert.ok(t.x >= 0 && t.x < 256 && t.y >= 0 && t.y < 256);
});

test("an obviously swapped pair is rejected before any government request", async () => {
  assert.deepEqual(checkSitePoint({ latitude: -66.146143, longitude: 18.431198 }), { ok: false, reason: "coordinates_look_swapped" });
  assert.deepEqual(checkSitePoint({ latitude: -66.9, longitude: 18.0 }), { ok: false, reason: "coordinates_look_swapped" }, "the Antarctica point from the MSC bug");
  assert.equal(checkSitePoint({ latitude: 40.7, longitude: -74 }).ok, false);
  const calls: string[] = [];
  const l = await resolveSiteLayers(-66.146143, 18.431198, { fetchImpl: async (u) => { calls.push(u); return { ok: true, status: 200, json: async () => ({ features: [] }) }; }, cache: new LayerCache() });
  assert.equal(calls.length, 0, "nothing is sent");
  assert.ok(l.results.every((r) => r.status === "unknown" && r.reason === "coordinates_look_swapped"));
  assert.ok(l.results.every((r) => providerStatus(r) === "error"), "a rejected point is an error, never 'nothing mapped'");
});

// ---------------------------------------------------------------------------
// FEMA advisory flood (ABFE) — a separate signal from the effective FIRM
// ---------------------------------------------------------------------------

test("advisory flood: zones, BFE, the 0.2% area, and no polygon = outside (answered)", () => {
  const ve = parseAdvisoryFlood({ features: [{ attributes: { FLD_ZONE: "VE", ST_BFE_m: 3, V_DATUM: "PRVD02", Depth_m: -9999 } }] }, null, AT);
  assert.equal(ve.status, "resolved");
  assert.equal(ve.code, "VE");
  assert.deepEqual(ve.tags, ["SFHA", "COASTAL_HIGH_HAZARD"]);
  assert.equal(ve.attributes.ADV_BFE_M, 3);
  assert.equal(ve.attributes.ADV_DEPTH_M, null, "FEMA's -9999 placeholder is not a depth");
  const ao = parseAdvisoryFlood({ features: [{ attributes: { FLD_ZONE: "AO", Depth_m: 0.7 } }] }, null, AT);
  assert.equal(ao.attributes.ADV_DEPTH_M, 0.7);
  const x02 = parseAdvisoryFlood({ features: [{ attributes: { FLD_ZONE: "X (0.2% ACF)", ZONE_SUBTY: "0.2% Annual Chance Flood" } }] }, null, AT);
  assert.deepEqual(x02.tags, ["MODERATE"]);
  const twoOnly = parseAdvisoryFlood({ features: [] }, { features: [{ attributes: { FLD_ZONE: "A" } }] }, AT);
  assert.equal(twoOnly.status, "resolved");
  assert.deepEqual(twoOnly.tags, ["MODERATE"]);
  const outside = parseAdvisoryFlood({ features: [] }, { features: [] }, AT);
  assert.equal(outside.status, "none");
  assert.equal(providerStatus(outside), "not_found");
  const down = parseAdvisoryFlood("timeout_8000ms", null, AT);
  assert.equal(down.status, "unknown");
  assert.equal(providerStatus(down), "unavailable", "a failed advisory lookup is never 'outside the advisory areas'");
});

// ---------------------------------------------------------------------------
// Terrain: USGS landslide susceptibility + 3DEP elevation / slope
// ---------------------------------------------------------------------------

test("terrain: legend colors → class; a color off the legend is unknown, never guessed", () => {
  assert.equal(landslideClassFromRgba([0, 0, 0, 0]), "Low");
  assert.equal(landslideClassFromRgba([255, 255, 116, 128]), "Moderate");
  assert.equal(landslideClassFromRgba([255, 169, 0, 128]), "High");
  assert.equal(landslideClassFromRgba([229, 0, 0, 128]), "Very High");
  assert.equal(landslideClassFromRgba([0, 78, 221, 128]), "Extremely High");
  assert.equal(landslideClassFromRgba([10, 200, 10, 255]), null);
  const vh = parseTerrain({ rgba: [229, 0, 0, 128] }, { centerM: 1316.8, slopePct: 56.4 }, AT);
  assert.equal(vh.code, "Very High");
  assert.deepEqual(vh.tags, ["LANDSLIDE_HIGH", "LANDSLIDE_VERY_HIGH"]);
  assert.equal(vh.attributes.ELEVATION_M, 1316.8);
  const odd = parseTerrain({ rgba: [10, 200, 10, 255] }, null, AT);
  assert.equal(odd.status, "unknown");
  assert.match(String(odd.reason), /legend_mismatch/);
  assert.equal(slopePercent({ east: 110, west: 100, north: 100, south: 100 }, 15), 33.3);
});

// ---------------------------------------------------------------------------
// The service: provider independence, unknown vs none
// ---------------------------------------------------------------------------

type Mode = "ok" | "down";
function siteFetch(modes: Partial<Record<"fema" | "advisory" | "landslide" | "elevation", Mode>> = {}, urls: string[] = []): FetchLike {
  const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
  const down = { ok: false, status: 503, json: async () => ({}) };
  return async (url) => {
    urls.push(url);
    if (url.startsWith(LAYER_SOURCES.fema_flood_zones.url)) return modes.fema === "down" ? down : json({ features: [{ attributes: { FLD_ZONE: "X", ZONE_SUBTY: "AREA OF MINIMAL FLOOD HAZARD", SFHA_TF: "F" } }] });
    if (url.startsWith(LAYER_SOURCES.fema_firm_panels.url)) return json({ features: [{ attributes: { FIRM_PAN: "72000C0345J", EFF_DATE: 1258502400000 } }] });
    if (url.startsWith(LAYER_SOURCES.jp_advisory_flood.url)) return modes.advisory === "down" ? down : json({ features: [{ attributes: { FLD_ZONE: "AE", ST_BFE_m: 2.1 } }] });
    if (url.startsWith(LAYER_SOURCES.usgs_landslide.url)) return modes.landslide === "down" ? down : { ok: true, status: 200, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(8) };
    if (url.startsWith(LAYER_SOURCES.usgs_elevation.url)) return modes.elevation === "down" ? down : json({ value: "5.4" });
    return json({ features: [] });
  };
}
const decodeAs = (rgba: number[]): PngDecoder => async () => {
  const data = new Uint8Array(256 * 256 * 4);
  for (let i = 0; i < data.length; i += 4) data.set(rgba, i);
  return { width: 256, height: 256, channels: 4, data };
};
const run = (fetchImpl: FetchLike, rgba = [255, 255, 116, 128]) =>
  resolveSiteLayers(CATANO.latitude, CATANO.longitude, { fetchImpl, cache: new LayerCache(), decodePng: decodeAs(rgba), isOnLand: () => true, retryDelayMs: 0, now: () => new Date(AT) });
const at = (l: Awaited<ReturnType<typeof run>>, id: string) => l.results.find((r) => r.layer === id)!;

test("every outbound request keeps the point in Puerto Rico (ArcGIS x,y; 3DEP x=lng y=lat)", async () => {
  const urls: string[] = [];
  await run(siteFetch({}, urls));
  for (const u of urls.filter((x) => x.includes("/query?"))) {
    const [x, y] = new URL(u).searchParams.get("geometry")!.split(",").map(Number);
    assert.ok(x < -65 && x > -68.1 && y > 17.8 && y < 18.7, u);
  }
  const ep = urls.filter((u) => u.startsWith(LAYER_SOURCES.usgs_elevation.url));
  assert.equal(ep.length, 5, "center + four slope samples");
  for (const u of ep) {
    const p = new URL(u).searchParams;
    assert.ok(Number(p.get("x")) < -66 && Number(p.get("y")) > 18, u);
  }
  const tile = urls.find((u) => u.startsWith(LAYER_SOURCES.usgs_landslide.url))!;
  assert.match(tile, /\/tile\/14\/\d+\/\d+$/);
});

test("provider independence: USGS down → FEMA still answers; advisory down → effective FIRM still answers", async () => {
  const noUsgs = await run(siteFetch({ landslide: "down", elevation: "down" }));
  assert.equal(at(noUsgs, "flood_zone").code, "X");
  assert.equal(at(noUsgs, "flood_advisory").code, "AE");
  assert.equal(providerStatus(at(noUsgs, "terrain")), "unavailable");
  const noAdvisory = await run(siteFetch({ advisory: "down" }));
  assert.equal(at(noAdvisory, "flood_zone").code, "X");
  assert.equal(providerStatus(at(noAdvisory, "flood_advisory")), "unavailable", "never 'none' / 'no hazard'");
  assert.equal(at(noAdvisory, "terrain").code, "Moderate");
  const noFema = await run(siteFetch({ fema: "down" }));
  assert.equal(providerStatus(at(noFema, "flood_zone")), "unavailable");
  assert.equal(at(noFema, "flood_advisory").code, "AE");
  // Elevation down: the landslide class still resolves, elevation/slope are absent (not zero).
  const noElev = await run(siteFetch({ elevation: "down" }), [229, 0, 0, 128]);
  assert.equal(at(noElev, "terrain").code, "Very High");
  assert.equal(at(noElev, "terrain").attributes.ELEVATION_M, null);
  assert.equal(at(noElev, "terrain").attributes.SLOPE_PCT, null);
  // Off land: a transparent pixel is not "Low".
  const sea = await resolveSiteLayers(CATANO.latitude, CATANO.longitude, { fetchImpl: siteFetch(), cache: new LayerCache(), decodePng: decodeAs([0, 0, 0, 0]), isOnLand: () => false, now: () => new Date(AT) });
  assert.equal(at(sea, "terrain").status, "unknown");
});

// ---------------------------------------------------------------------------
// Presentation + rules context
// ---------------------------------------------------------------------------

test("site intelligence: grouped pills, advisory vs effective surfaced, unavailable never positive, provenance kept", async () => {
  const l = await run(siteFetch({}), [229, 0, 0, 128]);
  const si = buildSiteIntelligence(l, { municipality: "Cataño", address: "Calle 19, Cucharillas, Palmas" });
  assert.deepEqual(si.groups.map((g) => g.id), ["flood", "land", "site", "environment"]);
  const flood = si.groups[0].pills;
  assert.equal(flood[0].label.en, "Effective FIRM · Zone X");
  assert.equal(flood[0].tone, "ok");
  assert.equal(flood[1].label.en, "Advisory · Zone AE (1% area)");
  assert.equal(flood[1].tone, "hazard");
  const adv = si.considerations.find((c) => c.layer === "flood_advisory")!;
  assert.match(adv.text.en, /advisory mapping shows a 1% flood area here \(advisory Zone AE\), beyond the effective FIRM designation \(Zone X\)/);
  assert.equal(si.considerations[0].tone, "hazard", "hazards are listed first");
  const terrainPill = si.groups[2].pills.find((p) => p.layer === "terrain")!;
  assert.equal(terrainPill.tone, "hazard");
  // Unavailable layers read as unavailable, in gray.
  const down = buildSiteIntelligence(await run(siteFetch({ advisory: "down" })));
  const advDown = down.groups[0].pills[1];
  assert.equal(advDown.status, "unavailable");
  assert.equal(advDown.tone, "unknown");
  assert.match(advDown.label.en, /temporarily unavailable/);
  assert.ok(!down.considerations.some((c) => c.layer === "flood_advisory"));
  // Structured context with provenance.
  const ctx = si.context;
  assert.deepEqual(ctx.coordinates, CATANO);
  assert.equal(ctx.effectiveFirm.value?.zone, "X");
  assert.equal(ctx.effectiveFirm.value?.panel, "72000C0345J");
  assert.equal(ctx.effectiveFirm.sourceAgency, "FEMA");
  assert.equal(ctx.effectiveFirm.status, "confirmed");
  assert.equal(ctx.advisoryFlood.value?.inSfha, true);
  assert.equal(ctx.advisoryFlood.value?.advisoryBfeMeters, 2.1);
  assert.match(ctx.advisoryFlood.sourceDataset, /Advisory Flood Maps/);
  assert.equal(ctx.terrain.value?.landslideSusceptibility, "Very High");
  assert.equal(ctx.terrain.value?.elevationMeters, 5.4);
  assert.equal(ctx.wetlands, null, "not queried yet — never 'no wetlands'");
  assert.equal(down.context.advisoryFlood.status, "unavailable");
  assert.equal(down.context.advisoryFlood.value, null);
  assert.ok(si.sources.every((s) => s.retrievedAt && s.url.startsWith("https://")));
  assert.equal(new Set(si.sources.map((s) => s.url)).size, si.sources.length, "one source entry per dataset");
  // Sources carry the agency (for its icon) and what the dataset said for the pin.
  const fema = si.sources.find((x) => x.layer === "flood_zone")!;
  assert.equal(fema.agencyKey, "fema");
  assert.match(fema.answer!.en, /Zone: X · Panel: 72000C0345J/);
  assert.equal(si.sources.find((x) => x.layer === "flood_advisory")!.agencyKey, "fema", "advisory maps are FEMA's (hosted by JP)");
  assert.equal(si.sources.find((x) => x.layer === "terrain")!.agencyKey, "usgs");
  // Inland pin: NOAA's CZMA boundary answered "outside" — a real no, shown as such.
  const coastal = si.sources.find((x) => x.layer === "coastal_zone")!;
  assert.equal(coastal.agencyKey, "noaa");
  assert.equal(coastal.status, "not_found");
  const czPill = si.groups[3].pills.find((p) => p.layer === "coastal_zone")!;
  assert.equal(czPill.label.en, "Coastal · not identified");
  assert.equal(czPill.tone, "ok");
});

test("new layers become rule facts (location.flood_advisory.sfha, location.terrain.landslide_high)", async () => {
  const { layerDeterminations } = await import("./layers.ts");
  const l = await run(siteFetch({}), [229, 0, 0, 128]);
  const codes = layerDeterminations(l).map((d) => `${d.geography_type}:${d.geography_code}`);
  assert.ok(codes.includes("flood_advisory:SFHA"), codes.join(","));
  assert.ok(codes.includes("terrain:LANDSLIDE_HIGH"));
  assert.ok(codes.includes("terrain:LANDSLIDE_VERY_HIGH"));
});

// ---------------------------------------------------------------------------
// Spatial correctness: known points resolve to the right municipio (Census)
// ---------------------------------------------------------------------------

test("known Puerto Rico points land in the right municipio", () => {
  const cases: Array<[string, number, number]> = [
    ["San Juan", 18.4655, -66.1057],
    ["Bayamón", 18.3986, -66.1557],
    ["Cataño", 18.431198, -66.146143],
    ["Guaynabo", 18.3577, -66.1108],
    ["Ponce", 18.0111, -66.6141],
    ["Jayuya", 18.2186, -66.5916],
  ];
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  for (const [name, lat, lng] of cases) {
    const p = locateInPuertoRico(lat, lng);
    assert.ok(p, `${name} resolves`);
    assert.equal(norm(p!.municipio.name), norm(name), `${name} → ${p!.municipio.name}`);
    assert.deepEqual(checkSitePoint({ latitude: lat, longitude: lng }), { ok: true });
  }
});

