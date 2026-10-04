// Geo resilience: pin placement (road / water / no parcel), off-lot fact
// suppression and rule mapping, the CRIM ↔ JP catastro fallback,
// "couldn't check" vs "nothing mapped", fallback endpoints, the circuit
// breaker, the transient FEMA 400 retry, and pin snapping.
// Run: npx tsx --test src/app/locations/geoResilience.test.ts
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runRulesEngine, type KnowledgeBase, type FactMeta } from "../rulesEngine.ts";
import { LAYER_SOURCES, layerAnswered, layerReasonText, parseCrimParcel, parseJpCalificacion, pinPlacement, zoningFamily, type ArcGisQueryResponse, type SiteLayerResult, type SiteLayers } from "./layers.ts";
import { LayerCache, endpointHealthSnapshot, findNearbyLots, resetEndpointHealth, resolveSiteLayers, type FetchLike } from "./layerService.ts";
import { siteEngineFacts, type IntakeSite } from "./intakeLocation.ts";
import { providerStatus } from "./siteIntelligence.ts";
import { distanceToPolygonM, interiorPoint, nearestLots, pointInRings, type Ring } from "./snap.ts";

beforeEach(() => resetEndpointHealth());

const here = dirname(fileURLToPath(import.meta.url));
const load = (f: string) => JSON.parse(readFileSync(join(here, "..", "..", "kb", f), "utf8"));
const KB: KnowledgeBase = {
  municipalities: load("municipalities.json"),
  businessTypes: load("business_types.json"),
  questions: load("questions.json"),
  documents: load("documents.json"),
  rules: load("rules.json"),
};
const AT = "2026-10-04T04:30:00.000Z";

// --- A tiny ArcGIS fake: answers by layer URL prefix -------------------------

type Answer = ArcGisQueryResponse | { _http: number } | { _hang: true };
function fakeArcgis(answers: Record<string, Answer | Answer[]>, calls: string[] = []): FetchLike {
  const served: Record<string, number> = {};
  return async (url, init) => {
    calls.push(url);
    const prefix = Object.keys(answers).find((u) => url.startsWith(`${u}/query?`));
    if (!prefix) return { ok: true, status: 200, json: async () => ({ features: [] }) };
    const list = answers[prefix];
    const i = served[prefix] = (served[prefix] ?? -1) + 1;
    const a = Array.isArray(list) ? list[Math.min(i, list.length - 1)] : list;
    if ("_hang" in a) return new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
    if ("_http" in a) return { ok: false, status: a._http, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => a };
  };
}
const feat = (attributes: Record<string, unknown>) => ({ features: [{ attributes }] });
const S = LAYER_SOURCES;
const FAST = { fema_zones: 300, fema_panels: 300, fema_community: 300, fema_lomas: 300, fema_lomrs: 300, jp_calificacion: 300, crim: 300, czm_official: 100, coastline: 300, historic: 50, protected: 50 };
const resolve = (lat: number, lng: number, fetchImpl: FetchLike) =>
  resolveSiteLayers(lat, lng, { fetchImpl, cache: new LayerCache(), timeoutMs: FAST, now: () => new Date(AT), retryDelayMs: 1, skipOptional: true });
const layer = (l: SiteLayers, id: string) => l.results.find((x) => x.layer === id)!;

// Live shapes recorded 2026-10-04 (see docs in the PR).
const LOIZA: [number, number] = [18.443338, -65.972185];
const loizaAnswers = {
  [S.fema_flood_zones.url]: feat({ FLD_ZONE: "AE", ZONE_SUBTY: "FLOODWAY", SFHA_TF: "T", STATIC_BFE: -9999, DFIRM_ID: "72000C" }),
  [S.jp_calificacion.url]: feat({ num_catast: null, cali: "AGUA", descrip: "Cuerpo de agua", clasi: "AGUA", descrip1: "Cuerpo de agua", municipio: "Loíza" }),
  [S.crim_parcels.url]: feat({ NUM_CATASTRO: null, TIPO: "A" }),
};
const CAGUAS: [number, number] = [18.232565, -66.037436];
const caguasAnswers = {
  [S.fema_flood_zones.url]: feat({ FLD_ZONE: "X", ZONE_SUBTY: "AREA OF MINIMAL FLOOD HAZARD", SFHA_TF: "F", DFIRM_ID: "72000C" }),
  [S.jp_calificacion.url]: feat({ num_catast: null, cali: "VIAL", descrip: "Sistema vial", clasi: "VIAL", descrip1: "Sistema vial", municipio: "Caguas" }),
  [S.crim_parcels.url]: feat({ NUM_CATASTRO: null, TIPO: "V" }),
};
const PINONES: [number, number] = [18.444, -65.974];
const pinonesAnswers = {
  [S.fema_flood_zones.url]: feat({ FLD_ZONE: "AE", ZONE_SUBTY: null, SFHA_TF: "T", DFIRM_ID: "72000C" }),
  [S.jp_calificacion.url]: feat({ num_catast: "042-000-008-01", cali: "P-R", descrip: "Preservación de Recursos", clasi: "SREP-E", descrip1: "Suelo Rústico Especialmente Protegido-Ecológico", vigencia: "27-DIC-2024", municipio: "Loíza" }),
  // CRIM's polygon here is a numbered-less TIPO P: the JP catastro stands in.
  [S.crim_parcels.url]: feat({ NUM_CATASTRO: null, TIPO: "P" }),
};

const site = (lat: number, lng: number, layers: SiteLayers, muni = "Loíza"): IntakeSite => ({
  latitude: lat, longitude: lng, coordinate_source: "MAP_PIN", formatted_address: null,
  municipality: { name: muni, fips: "72087" }, barrio: null, near_boundary: false, designations: [],
  boundary_source: { id: "census-tiger-2023", name: "Census", version: "2023", url: null }, location_id: null, confirmed_at: AT, layers,
});
function evaluate(s: IntakeSite, project: Record<string, unknown>) {
  const f = siteEngineFacts(s);
  const meta: Record<string, FactMeta> = { ...f.factMeta };
  for (const k of Object.keys(project)) meta[k] = { source: "user_intake", scope: "project", sessionId: "s", confirmedInCurrentIntake: true };
  const out = runRulesEngine(KB, { businessTypeId: null, municipality: s.municipality.name, answers: {}, sessionId: "s", locationId: f.locationId, projectFacts: { ...f.projectFacts, ...project }, factMeta: meta } as never);
  return { facts: f.projectFacts, reqs: out.requirements };
}
const ruleIds = (reqs: ReturnType<typeof evaluate>["reqs"]) => new Set(reqs.flatMap((r) => [r.source_rule_id, ...(r.matched_rules ?? []).map((m) => m.rule_id)]));

// --- Placement + rule mapping -----------------------------------------------

test("water pin (Loíza live case): flood rules fire, lot rules never do; land class is answered, not 'unavailable'", async () => {
  const l = await resolve(...LOIZA, fakeArcgis(loizaAnswers));
  assert.equal(pinPlacement(l).state, "on_water");
  const lc = layer(l, "land_class");
  assert.ok(layerAnswered(lc), "JP answered AGUA");
  assert.notEqual(providerStatus(lc), "unavailable", "the live bug: AGUA read as 'temporarily unavailable'");
  assert.equal(zoningFamily("AGUA", "Cuerpo de agua"), "water", "a water body is not a conservation district");
  const { facts, reqs } = evaluate(site(...LOIZA, l), { project_type: "renovation", change_of_use: true, structural_work: true });
  assert.equal(facts["location.placement"], "on_water");
  assert.equal(facts["location.placement.off_lot"], true);
  assert.equal(facts["location.flood_zone.sfha"], true);
  assert.equal(facts["location.flood_zone.floodway"], true);
  for (const k of Object.keys(facts)) assert.ok(!/^location\.(zoning|land_class|parcel)/.test(k), `off-lot pin leaked lot fact ${k}`);
  const ids = ruleIds(reqs);
  assert.ok(ids.has("RULE_0706") && ids.has("RULE_0707"), "flood + floodway still apply to the pin");
  for (const id of ["RULE_0709", "RULE_0710", "RULE_0711", "RULE_0712"]) assert.ok(!ids.has(id), `${id} must not fire on water`);
});

test("road pin (Caguas live case): on_road, no zoning / consulta facts", async () => {
  const l = await resolve(...CAGUAS, fakeArcgis(caguasAnswers));
  assert.equal(pinPlacement(l).state, "on_road");
  const { facts, reqs } = evaluate(site(...CAGUAS, l, "Caguas"), { change_of_use: true });
  assert.equal(facts["location.placement"], "on_road");
  assert.equal(facts["location.zoning"], undefined);
  assert.equal(facts["location.zoning.road"], undefined);
  assert.ok(!reqs.some((r) => r.document_id === "DOC_CONSULTA_UBICACION"));
});

test("lot pin (Piñones): CRIM polygon without a number takes the JP catastro; SREP drives RULE_0709", async () => {
  const l = await resolve(...PINONES, fakeArcgis(pinonesAnswers));
  const parcel = layer(l, "parcel");
  assert.equal(parcel.status, "resolved");
  assert.equal(parcel.code, "042-000-008-01");
  assert.equal(parcel.retrieval, "derived");
  assert.deepEqual(pinPlacement(l), { state: "on_lot", basis: "jp" });
  const { facts, reqs } = evaluate(site(...PINONES, l), { structural_work: true });
  assert.equal(facts["location.placement"], "on_lot");
  assert.equal(facts["location.land_class.srep"], true);
  assert.ok(ruleIds(reqs).has("RULE_0709"), "rustic protected land → consulta de ubicación");
});

test("parsers: TIPO V / A never borrow a JP catastro; numbered CRIM parcels win over JP", () => {
  assert.equal(parseCrimParcel(feat({ NUM_CATASTRO: null, TIPO: "V" }), AT, "225-054-079-11").status, "none");
  assert.equal(parseCrimParcel(feat({ NUM_CATASTRO: null, TIPO: "A" }), AT, "042-000-008-01").status, "none");
  assert.equal(parseCrimParcel(feat({ NUM_CATASTRO: "225-044-031-13", TIPO: "P" }), AT, "999-999-999-99").code, "225-044-031-13");
  const v = parseJpCalificacion(feat({ cali: "VIAL", descrip: "Sistema vial", clasi: "VIAL", descrip1: "Sistema vial" }), AT);
  assert.equal(v.land_class.status, "resolved");
  assert.ok(v.land_class.tags.includes("NOT_A_LOT"));
});

test("CRIM gap under a real JP lot is still on the lot (no false negative); nothing at all is no_parcel", async () => {
  const gap = await resolve(...PINONES, fakeArcgis({ ...pinonesAnswers, [S.crim_parcels.url]: { features: [] } }));
  assert.equal(pinPlacement(gap).state, "on_lot");
  assert.equal(siteEngineFacts(site(...PINONES, gap)).projectFacts["location.land_class.srep"], true, "SREP restriction kept");
  const none = await resolve(...PINONES, fakeArcgis({ [S.crim_parcels.url]: { features: [] }, [S.jp_calificacion.url]: { features: [] } }));
  assert.equal(pinPlacement(none).state, "no_parcel");
});

// --- "Couldn't check" vs "nothing mapped" -----------------------------------

test("providerStatus: a down service is 'unavailable'; an answered-but-empty layer is 'not_found'", () => {
  const down: SiteLayerResult = { layer: "land_class", status: "unknown", code: null, name: null, tags: [], attributes: {}, source: { id: "jp", name: "", url: "", layer: "0", dataset_date: null, version: null }, retrieval: "none", approximate: false, reason: "timeout_6000ms", retrieved_at: AT };
  assert.equal(providerStatus(down), "unavailable");
  assert.equal(providerStatus({ ...down, retrieval: "live", reason: "not_a_land_classification (AGUA)" }), "not_found");
  assert.equal(layerReasonText("not_a_land_classification (AGUA)").retryable, false);
  assert.equal(layerReasonText("timeout_50ms (circuit_open)").retryable, true);
});

// --- Provider abstraction: fallback endpoints, breaker, transient 400 --------

test("fallback endpoint: JP calificación down → MIPR/Calificacion answers with the same schema", async () => {
  const fb = S.jp_calificacion.fallback_urls![0]!;
  const calls: string[] = [];
  const l = await resolve(...PINONES, fakeArcgis({ ...pinonesAnswers, [S.jp_calificacion.url]: { _http: 502 }, [fb]: pinonesAnswers[S.jp_calificacion.url]! }, calls));
  assert.equal(layer(l, "zoning").code, "P-R");
  assert.ok(calls.some((u) => u.startsWith(fb)), "fallback queried");
  const h = endpointHealthSnapshot().find((e) => e.url === S.jp_calificacion.url);
  assert.ok(h && h.consecutiveFailures >= 1 && /http_502/.test(h.lastFailure ?? ""), "primary failure recorded");
});

test("circuit breaker: after repeated failures the primary is skipped (no 8 s waits per request)", async () => {
  const calls: string[] = [];
  const f = fakeArcgis({ ...caguasAnswers, [S.crim_parcels.url]: { _http: 503 }, [S.crim_parcels.fallback_urls![0]!]: { _http: 503 } }, calls);
  for (let i = 0; i < 3; i++) await resolve(...CAGUAS, f);
  const before = calls.filter((u) => u.startsWith(S.crim_parcels.url)).length;
  const l = await resolve(...CAGUAS, f);
  assert.equal(calls.filter((u) => u.startsWith(S.crim_parcels.url)).length, before, "open circuit: primary not called");
  assert.match(layer(l, "parcel").reason ?? "", /circuit_open/);
  assert.equal(providerStatus(layer(l, "parcel")), "unavailable", "still 'couldn't check', never 'nothing mapped'");
});

test("FEMA's HTTP-200 'Failed to execute query' is transient: retried, then resolves", async () => {
  const calls: string[] = [];
  const l = await resolve(...LOIZA, fakeArcgis({ ...loizaAnswers, [S.fema_flood_zones.url]: [{ error: { code: 400, message: "Failed to execute query." } }, loizaAnswers[S.fema_flood_zones.url]!] }, calls));
  assert.equal(layer(l, "flood_zone").code, "AE");
  assert.equal(calls.filter((u) => u.startsWith(`${S.fema_flood_zones.url}/query?`)).length, 2);
});

// --- Snapping ---------------------------------------------------------------

type CrimFeature = { attributes: Record<string, unknown>; geometry: { rings: Ring[] } };
const CAGUAS_CRIM = JSON.parse(readFileSync(join(here, "fixtures", "crimSnapCaguas.json"), "utf8")) as ArcGisQueryResponse;
const CAGUAS_FEATURES = CAGUAS_CRIM.features as unknown as CrimFeature[];

test("snap geometry: point-in-polygon, distance, and an interior point even for an L-shaped lot", () => {
  const sq: Ring[] = [[[0, 0], [0.001, 0], [0.001, 0.001], [0, 0.001], [0, 0]]];
  assert.ok(pointInRings([0.0005, 0.0005], sq));
  assert.equal(distanceToPolygonM([0.0005, 0.0005], sq), 0);
  assert.ok(Math.abs(distanceToPolygonM([0.0015, 0.0005], sq) - 0.0005 * 111_320) < 1, "≈55.7 m east of the lot");
  const L: Ring[] = [[[0, 0], [0.002, 0], [0.002, 0.0005], [0.0005, 0.0005], [0.0005, 0.002], [0, 0.002], [0, 0]]];
  const ip = interiorPoint(L)!;
  assert.ok(pointInRings(ip, L), "interior point is inside the L (its centroid is not)");
  assert.ok(!pointInRings([0.00083, 0.00083], L), "sanity: the bbox centre is outside the L");
});

test("nearestLots (Caguas live CRIM shapes): street pin → nearest numbered lots, roads excluded", () => {
  const c = nearestLots(CAGUAS_CRIM, CAGUAS[0], CAGUAS[1], { max: 3 });
  assert.equal(c.length, 3);
  assert.equal(c[0]!.catastro, "225-044-063-10");
  assert.ok(c[0]!.distance_m > 0 && c[0]!.distance_m < 5, `≈2 m from the curb, got ${c[0]!.distance_m}`);
  assert.ok(c.every((x, i) => i === 0 || x.distance_m >= c[i - 1]!.distance_m), "sorted by distance");
  const poly = CAGUAS_FEATURES.find((f) => f.attributes.NUM_CATASTRO === c[0]!.catastro)!.geometry.rings;
  assert.ok(pointInRings([c[0]!.longitude, c[0]!.latitude], poly), "the snap point is inside that lot");
  assert.ok(c.every((x) => /^\d{3}-\d{3}-\d{3}-\d{2}$/.test(x.catastro)), "only numbered TIPO P parcels");
  assert.deepEqual(nearestLots("timeout_6000ms", 18, -66), []);
});

test("findNearbyLots: queries CRIM with a radius; a failure is reported, not hidden as 'no lots'", async () => {
  const calls: string[] = [];
  const ok = await findNearbyLots(...CAGUAS, { fetchImpl: fakeArcgis({ [S.crim_parcels.url]: CAGUAS_CRIM }, calls) });
  assert.equal(ok.reason, null);
  assert.equal(ok.candidates[0]!.catastro, "225-044-063-10");
  const q = new URL(calls[0]!).searchParams;
  assert.equal(q.get("distance"), "60");
  assert.equal(q.get("returnGeometry"), "true");
  const down = await findNearbyLots(...CAGUAS, { fetchImpl: fakeArcgis({ [S.crim_parcels.url]: { _http: 503 }, [S.crim_parcels.fallback_urls![0]!]: { _http: 503 } }) });
  assert.equal(down.candidates.length, 0);
  assert.match(down.reason ?? "", /http_503/);
});
