// Site map layers: parsers, service (timeouts, cache, degradation), facts,
// explanations, chips, and the KB rules they drive — all on fixtures recorded
// from the live services on 2026-09-30 (no network).
// Run: npx tsx --test src/app/locations/layers.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runRulesEngine, type KnowledgeBase, type FactMeta } from "../rulesEngine.ts";
import { translateTriggerReason } from "../triggerReason.ts";
import { computeEnergyAssessment } from "../processes/view.ts";
import { validateProjectContext } from "../ai/intake/projectContext.ts";
import {
  LAYER_SOURCES,
  arcgisPointQueryUrl,
  epochDate,
  layerChips,
  layerDeterminations,
  layerFactDetails,
  parseCoastalZone,
  parseCrimParcel,
  parseFemaFlood,
  floodMapSummary,
  layerCards,
  layerReasonText,
  parseJpCalificacion,
  parseVigencia,
  restoreSiteLayers,
  unavailableSiteLayers,
  zoningFamily,
  type ArcGisQueryResponse,
  type SiteLayers,
} from "./layers.ts";
import { LayerCache, resolveSiteLayers, type FetchLike, type LayerStore } from "./layerService.ts";
import { restoreIntakeSite, siteEngineFacts, siteFactDetails, type IntakeSite } from "./intakeLocation.ts";

const here = dirname(fileURLToPath(import.meta.url));
const FX = JSON.parse(readFileSync(join(here, "fixtures", "arcgisLayers.json"), "utf8")) as {
  points: Record<string, [number, number]>;
  responses: Record<string, ArcGisQueryResponse & { _http_status?: number; _timeout?: boolean }>;
};
const load = (f: string) => JSON.parse(readFileSync(join(here, "..", "..", "kb", f), "utf8"));
const KB: KnowledgeBase = {
  municipalities: load("municipalities.json"),
  businessTypes: load("business_types.json"),
  questions: load("questions.json"),
  documents: load("documents.json"),
  rules: load("rules.json"),
};
const AT = "2026-09-30T21:30:00.000Z";
const r = (k: string) => FX.responses[k] as ArcGisQueryResponse;

// Which fixture a query URL is for: layer by URL prefix, point by coordinates.
const URL_LAYER: Array<[string, string]> = [
  [LAYER_SOURCES.fema_flood_zones.url, "fema_zones"],
  [LAYER_SOURCES.fema_firm_panels.url, "fema_panels"],
  [LAYER_SOURCES.fema_communities.url, "fema_community"],
  [LAYER_SOURCES.fema_lomas.url, "fema_lomas"],
  [LAYER_SOURCES.fema_lomrs.url, "fema_lomrs"],
  [LAYER_SOURCES.jp_calificacion.url, "jp_calif"],
  [LAYER_SOURCES.crim_parcels.url, "crim"],
  [LAYER_SOURCES.jp_zona_costanera.url, "czm_official"],
  [LAYER_SOURCES.jp_linea_costa.url, "coastline"],
  [LAYER_SOURCES.jp_zonas_historicas.url, "historic"],
  [LAYER_SOURCES.jp_areas_naturales.url, "protected"],
];
function fixtureFetch(calls: string[] = [], override: Record<string, "down" | "timeout"> = {}): FetchLike {
  return async (url, init) => {
    calls.push(url);
    const layer = URL_LAYER.find(([u]) => url.startsWith(`${u}/query?`))?.[1];
    const geom = new URL(url).searchParams.get("geometry")!;
    const [lng, lat] = geom.split(",").map(Number);
    const pt = Object.entries(FX.points).find(([, [a, b]]) => a === lat && b === lng)?.[0];
    const resp = layer && pt ? FX.responses[`${layer}:${pt}`] : undefined;
    const mode = layer ? override[layer] : undefined;
    if (mode === "timeout" || resp?._timeout) {
      return new Promise((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      });
    }
    if (mode === "down") return { ok: false, status: 503, json: async () => ({}) };
    if (!resp) return { ok: false, status: 404, json: async () => ({}) };
    if (resp._http_status) return { ok: false, status: resp._http_status, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => resp };
  };
}
const FAST = { fema_zones: 200, fema_panels: 200, fema_community: 200, fema_lomas: 200, fema_lomrs: 200, jp_calificacion: 200, crim: 200, czm_official: 50, coastline: 200, historic: 50, protected: 50 };
const resolveAt = (pt: string, opts: Parameters<typeof resolveSiteLayers>[2] = {}) => {
  const [lat, lng] = FX.points[pt];
  return resolveSiteLayers(lat, lng, { fetchImpl: fixtureFetch(), cache: new LayerCache(), timeoutMs: FAST, now: () => new Date(AT), ...opts });
};
const layer = (l: SiteLayers, id: string) => l.results.find((x) => x.layer === id)!;

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

test("query URL: WGS84 point intersection, lng,lat order, no geometry", () => {
  const u = new URL(arcgisPointQueryUrl(LAYER_SOURCES.fema_flood_zones.url, 18.4436, -66.201));
  assert.equal(u.searchParams.get("geometry"), "-66.201,18.4436");
  assert.equal(u.searchParams.get("inSR"), "4326");
  assert.equal(u.searchParams.get("spatialRel"), "esriSpatialRelIntersects");
  assert.equal(u.searchParams.get("returnGeometry"), "false");
});

test("dates: FEMA epoch ms and JP vigencia formats", () => {
  assert.equal(epochDate(1258502400000), "2009-11-18");
  assert.equal(epochDate(1113868800000), "2005-04-19");
  assert.equal(epochDate(253392451200000), null, "FEMA's 9999 placeholder is not a date");
  assert.equal(parseVigencia("03/19/2008"), "2008-03-19");
  assert.equal(parseVigencia("27-DIC-2024"), "2024-12-27");
  assert.equal(parseVigencia("01-MAR-2012"), "2012-03-01");
  assert.equal(parseVigencia(" "), null);
  assert.equal(parseVigencia("JP-PT-71-4"), null);
});

test("FEMA NFHL: AE (Toa Baja), AE floodway (Río Grande), VE (Condado), X (Guaynabo) with FIRM panel dates", () => {
  const ae = parseFemaFlood(r("fema_zones:toa_baja_ae"), r("fema_panels:toa_baja_ae"), AT);
  assert.equal(ae.status, "resolved");
  assert.equal(ae.code, "AE");
  assert.deepEqual(ae.tags, ["SFHA"]);
  assert.equal(ae.source.dataset_date, "2009-11-18");
  assert.equal(ae.source.version, "72000C0330J");
  const fw = parseFemaFlood(r("fema_zones:rio_grande_ae"), r("fema_panels:rio_grande_ae"), AT);
  assert.deepEqual(fw.tags, ["SFHA", "FLOODWAY"]);
  const ve = parseFemaFlood(r("fema_zones:condado"), r("fema_panels:condado"), AT);
  assert.equal(ve.code, "VE");
  assert.equal(ve.attributes.STATIC_BFE, 3.4);
  const x = parseFemaFlood(r("fema_zones:guaynabo_pueblo"), r("fema_panels:guaynabo_pueblo"), AT);
  assert.equal(x.code, "X");
  assert.deepEqual(x.tags, [], "zone X is outside the SFHA");
  assert.equal(x.source.dataset_date, "2005-04-19");
  // Down / error / empty → unknown with a reason, never "zone X".
  assert.equal(parseFemaFlood("timeout_6000ms", null, AT).status, "unknown");
  assert.equal(parseFemaFlood({ error: { code: 500, message: "boom" } }, null, AT).reason, "arcgis_error_500: boom");
  assert.equal(parseFemaFlood({ features: [] }, null, AT).status, "unknown");
  // Panel missing: still resolved, date unknown.
  const noPanel = parseFemaFlood(r("fema_zones:toa_baja_ae"), "http_503", AT);
  assert.equal(noPanel.code, "AE");
  assert.equal(noPanel.source.dataset_date, null);
});

test("FEMA MSC parity: FIRM panel, community and letters of map change come with the zone", () => {
  const extras = { community: r("fema_community:guaynabo_pueblo"), lomas: r("fema_lomas:guaynabo_pueblo"), lomrs: r("fema_lomrs:guaynabo_pueblo") };
  const x = parseFemaFlood(r("fema_zones:guaynabo_pueblo"), r("fema_panels:guaynabo_pueblo"), AT, extras);
  assert.equal(x.attributes.FIRM_PAN, "72000C0730H");
  assert.equal(x.attributes.PANEL_TYP, "Countywide, Panel Printed");
  assert.equal(x.attributes.PRE_DATE, null, "FEMA's year-9999 placeholder means no preliminary map");
  assert.equal(x.attributes.COMMUNITY_NAME, "Municipio de Guaynabo");
  assert.equal(x.attributes.COMMUNITY_CID, "720000");
  assert.equal(x.attributes.LOMC_COUNT, 0);
  assert.deepEqual(x.tags, [], "no letters of map change → no LOMC tag");
  // A LOMA near the pin is flagged, never applied: the zone itself is unchanged.
  const loma = { features: [{ attributes: { CASENUMBER: "00-01-0480A", STATUS: "Completed", PROJECTCATEGORY: "LOMA", DATEENDED: 955584000000, OUTCOME: "Structure removed-Property partially inundated" } }] };
  const withLoma = parseFemaFlood(r("fema_zones:toa_baja_ae"), r("fema_panels:toa_baja_ae"), AT, { ...extras, lomas: loma });
  assert.equal(withLoma.code, "AE");
  assert.deepEqual(withLoma.tags, ["SFHA", "LOMC"]);
  assert.equal(withLoma.attributes.LOMC_COUNT, 1);
  assert.match(String(withLoma.attributes.LOMC_CASES), /LOMA 00-01-0480A \(2000-04-13\)/);
  // The extras are best-effort: a down service leaves the zone intact and the LOMC answer unknown.
  const down = parseFemaFlood(r("fema_zones:toa_baja_ae"), r("fema_panels:toa_baja_ae"), AT, { community: "http_503", lomas: "timeout_6000ms", lomrs: "http_503" });
  assert.equal(down.status, "resolved");
  assert.equal(down.attributes.LOMC_COUNT, null);
  assert.equal(down.attributes.COMMUNITY_NAME, null);
  // Overlapping flood polygons: the most hazardous governs, as on a flood determination.
  const overlap = { features: [{ attributes: { FLD_ZONE: "X", ZONE_SUBTY: "AREA OF MINIMAL FLOOD HAZARD", SFHA_TF: "F" } }, { attributes: { FLD_ZONE: "AE", SFHA_TF: "T" } }] };
  const o = parseFemaFlood(overlap, null, AT);
  assert.equal(o.code, "AE");
  assert.equal(o.attributes.ZONES_AT_POINT, 2);
  const fw = parseFemaFlood({ features: [{ attributes: { FLD_ZONE: "AE", SFHA_TF: "T" } }, { attributes: { FLD_ZONE: "AE", ZONE_SUBTY: "FLOODWAY", SFHA_TF: "T" } }] }, null, AT);
  assert.deepEqual(fw.tags, ["SFHA", "FLOODWAY"]);
});

test("FEMA MSC parity: resolving a pin queries community + LOMA/LOMR and links to the Map Service Center", async () => {
  const calls: string[] = [];
  const [lat, lng] = FX.points.guaynabo_pueblo;
  const l = await resolveSiteLayers(lat, lng, { fetchImpl: fixtureFetch(calls), cache: new LayerCache(), timeoutMs: FAST, now: () => new Date(AT) });
  for (const u of [LAYER_SOURCES.fema_communities.url, LAYER_SOURCES.fema_lomas.url, LAYER_SOURCES.fema_lomrs.url]) assert.ok(calls.some((c) => c.startsWith(`${u}/query?`)), u);
  const near = calls.find((c) => c.startsWith(`${LAYER_SOURCES.fema_lomas.url}/query?`))!;
  assert.equal(new URL(near).searchParams.get("distance"), "100");
  const f = floodMapSummary(l)!;
  assert.equal(f.zone, "X");
  assert.equal(f.firmPanel, "72000C0730H");
  assert.equal(f.effectiveDate, "2005-04-19");
  assert.equal(f.community, "Municipio de Guaynabo");
  assert.equal(f.communityId, "720000");
  assert.equal(f.mapChangeCount, 0);
  assert.match(f.mscUrl ?? "", /^https:\/\/msc\.fema\.gov\/portal\/search\?AddressQuery=18\.\d+%2C%20-66\.\d+$/);
  // The extras failing never degrade the flood zone.
  const degraded = await resolveSiteLayers(lat, lng, { fetchImpl: fixtureFetch([], { fema_community: "down", fema_lomas: "down", fema_lomrs: "timeout" }), cache: new LayerCache(), timeoutMs: FAST, now: () => new Date(AT) });
  assert.equal(layer(degraded, "flood_zone").status, "resolved");
  assert.equal(layer(degraded, "flood_zone").code, "X");
  assert.equal(floodMapSummary(degraded)?.mapChangeCount, null);
  assert.equal(floodMapSummary({ ...degraded, results: [] }), null);
});

test("resilience: a dropped connection is retried once; timeouts and 4xx are not", async () => {
  const [lat, lng] = FX.points.toa_baja_ae;
  const base = fixtureFetch();
  const flaky = (mode: "reset" | "timeout" | "404") => {
    const seen = new Map<string, number>();
    const f: FetchLike = async (url, init) => {
      const k = url.split("?")[0];
      const n = (seen.get(k) ?? 0) + 1;
      seen.set(k, n);
      if (k.startsWith(LAYER_SOURCES.fema_flood_zones.url) && n === 1) {
        if (mode === "reset") throw new Error("SSL_ERROR_SYSCALL");
        if (mode === "404") return { ok: false, status: 404, json: async () => ({}) };
        return new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
      }
      return base(url, init);
    };
    return { f, seen };
  };
  const run = (f: FetchLike) => resolveSiteLayers(lat, lng, { fetchImpl: f, cache: new LayerCache(), timeoutMs: FAST, retryDelayMs: 0, now: () => new Date(AT) });
  const reset = flaky("reset");
  assert.equal(layer(await run(reset.f), "flood_zone").code, "AE", "a connection reset is retried and recovers");
  assert.equal(reset.seen.get(LAYER_SOURCES.fema_flood_zones.url + "/query"), 2);
  const slow = flaky("timeout");
  assert.equal(layer(await run(slow.f), "flood_zone").code, "AE", "a stalled FEMA flood query is abandoned and re-asked once");
  assert.equal(slow.seen.get(LAYER_SOURCES.fema_flood_zones.url + "/query"), 2);
  const alwaysSlow: FetchLike = async (url, init) =>
    url.startsWith(LAYER_SOURCES.fema_flood_zones.url) || url.startsWith(LAYER_SOURCES.crim_parcels.url)
      ? new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))))
      : base(url, init);
  const hits: string[] = [];
  const stalled = await run(async (u, i) => { hits.push(u.split("?")[0]); return alwaysSlow(u, i); });
  assert.equal(layer(stalled, "flood_zone").status, "unknown");
  assert.equal(hits.filter((h) => h === LAYER_SOURCES.fema_flood_zones.url + "/query").length, 2, "FEMA flood: one retry, then unknown");
  assert.equal(hits.filter((h) => h === LAYER_SOURCES.crim_parcels.url + "/query").length, 1, "other layers' timeouts are not retried");
  const notFound = flaky("404");
  assert.equal(layer(await run(notFound.f), "flood_zone").reason, "http_404");
  assert.equal(notFound.seen.get(LAYER_SOURCES.fema_flood_zones.url + "/query"), 1, "a 404 is not retried");
});

function memoryStore(): LayerStore & { rows: Map<string, { at: number; result: unknown }> } {
  const rows = new Map<string, { at: number; result: unknown }>();
  return {
    rows,
    load: async (keys) => keys.filter((k) => rows.has(k)).map((k) => ({ key: k, at: rows.get(k)!.at, result: rows.get(k)!.result as never })),
    save: async (entries) => {
      for (const e of entries) rows.set(e.key, { at: e.at, result: e.result });
    },
  };
}

test("shared store: answers survive a restart, and a FEMA outage serves the stored answer as stale", async () => {
  const store = memoryStore();
  const [lat, lng] = FX.points.toa_baja_ae;
  const t0 = new Date(AT);
  const first = await resolveSiteLayers(lat, lng, { fetchImpl: fixtureFetch(), cache: new LayerCache(), store, timeoutMs: FAST, now: () => t0 });
  assert.equal(layer(first, "flood_zone").code, "AE");
  assert.ok([...store.rows.keys()].some((k) => k.startsWith("flood_zone:")), "answered layers are persisted");
  // New process (empty memory cache), FEMA completely down, 3 days later.
  const later = new Date(t0.getTime() + 3 * 24 * 3600_000);
  const down: FetchLike = async () => ({ ok: false, status: 503, json: async () => ({}) });
  const after = await resolveSiteLayers(lat, lng, { fetchImpl: down, cache: new LayerCache(), store, timeoutMs: FAST, retryDelayMs: 0, now: () => later });
  const flood = layer(after, "flood_zone");
  assert.equal(flood.code, "AE");
  assert.equal(flood.retrieval, "stale_cache");
  // Within 24 h the stored answer is fresh: no FEMA call at all.
  const calls: string[] = [];
  const soon = await resolveSiteLayers(lat, lng, { fetchImpl: fixtureFetch(calls), cache: new LayerCache(), store, timeoutMs: FAST, now: () => new Date(t0.getTime() + 3600_000) });
  assert.equal(layer(soon, "flood_zone").retrieval, "cached");
  assert.equal(calls.filter((c) => c.startsWith(LAYER_SOURCES.fema_flood_zones.url)).length, 0);
  // A broken store never breaks a pin.
  const broken: LayerStore = { load: async () => { throw new Error("db down"); }, save: async () => { throw new Error("db down"); } };
  const ok = await resolveSiteLayers(lat, lng, { fetchImpl: fixtureFetch(), cache: new LayerCache(), store: broken, timeoutMs: FAST, now: () => t0 });
  assert.equal(layer(ok, "flood_zone").code, "AE");
});

test("refresh: 'Try again' bypasses the remembered failure instead of serving it for a minute", async () => {
  const [lat, lng] = FX.points.toa_baja_ae;
  const cache = new LayerCache();
  const down: FetchLike = async () => ({ ok: false, status: 503, json: async () => ({}) });
  const first = await resolveSiteLayers(lat, lng, { fetchImpl: down, cache, timeoutMs: FAST, retryDelayMs: 0, now: () => new Date(AT) });
  assert.equal(layer(first, "flood_zone").status, "unknown");
  const calls: string[] = [];
  const soon = await resolveSiteLayers(lat, lng, { fetchImpl: fixtureFetch(calls), cache, timeoutMs: FAST, now: () => new Date(new Date(AT).getTime() + 5_000) });
  assert.equal(layer(soon, "flood_zone").status, "unknown", "without refresh the failure is remembered for a minute");
  assert.equal(calls.length, 0);
  const again = await resolveSiteLayers(lat, lng, { fetchImpl: fixtureFetch(), cache, refresh: true, timeoutMs: FAST, now: () => new Date(new Date(AT).getTime() + 5_000) });
  assert.equal(layer(again, "flood_zone").code, "AE", "refresh asks the services again");
});

test("map cards: plain-language meaning per layer; unknown layers say why and offer a retry + FEMA's own map", async () => {
  const ae = layerCards(await resolveAt("toa_baja_ae"));
  const flood = ae.find((c) => c.layer === "flood_zone")!;
  assert.equal(flood.status, "resolved");
  assert.match(flood.value.en, /^Zone AE/);
  assert.match(flood.meaning!.en, /Special Flood Hazard Area/);
  assert.match(flood.source ?? "", /FEMA · FIRM 72000C0330J · 2009-11-18/);
  const x = layerCards(await resolveAt("guaynabo_pueblo")).find((c) => c.layer === "flood_zone")!;
  assert.match(x.meaning!.en, /Minimal flood hazard/);
  // Unknown: the reason is human, retry is offered, and the same spot can be checked on FEMA's map.
  const down = await resolveAt("toa_baja_ae", { fetchImpl: fixtureFetch([], { fema_zones: "down" }), retryDelayMs: 0 });
  const unk = layerCards(down).find((c) => c.layer === "flood_zone")!;
  assert.equal(unk.status, "unknown");
  assert.match(unk.reason!.en, /FEMA's map service is temporarily unavailable/);
  assert.equal(unk.retryable, true);
  assert.match(unk.link!.url, /^https:\/\/msc\.fema\.gov\/portal\/search\?AddressQuery=/);
  assert.match(unk.value.es, /No se pudo verificar/);
  // Reason mapping.
  assert.equal(layerReasonText("timeout_4500ms", "FEMA").retryable, true);
  assert.match(layerReasonText("timeout_4500ms", "FEMA").text.en, /didn't answer in time/);
  assert.equal(layerReasonText("no_flood_hazard_polygon_at_point", "FEMA").retryable, false);
  assert.match(layerReasonText("layers_service_unreachable: http_500").text.en, /couldn't reach the map lookup/);
  // A parcel "none" explains itself; a layer that answered "no" (e.g. no coastal zone) adds no card.
  const rural = layerCards(await resolveAt("guayama_rural"));
  assert.ok(rural.every((c) => c.layer !== "historic_zone" && c.layer !== "protected_area" || c.status === "resolved"));
});

test("JP calificación: zoning + land class + catastro; VIAL is not a land class; no polygon is unknown", () => {
  const g = parseJpCalificacion(r("jp_calif:guayama_rural"), AT);
  assert.equal(g.zoning.code, "R-A");
  assert.equal(g.land_class.code, "SREP-A");
  assert.deepEqual(g.land_class.tags, ["SREP", "RUSTICO"]);
  assert.equal(g.land_class.source.dataset_date, "2008-03-19");
  assert.match(g.land_class.source.version!, /JP-PT-71-4/);
  assert.equal(g.catastro, "419-000-005-02");
  const t = parseJpCalificacion(r("jp_calif:toa_baja_ae"), AT);
  assert.equal(t.zoning.code, "C-R");
  assert.deepEqual(t.zoning.tags, ["conservation"]);
  assert.equal(t.land_class.code, "SREP-E");
  assert.equal(t.land_class.source.dataset_date, "2024-12-27");
  const v = parseJpCalificacion(r("jp_calif:guaynabo_pueblo"), AT);
  assert.equal(v.zoning.code, "VIAL");
  assert.deepEqual(v.zoning.tags, ["road"]);
  assert.equal(v.land_class.status, "unknown");
  const c = parseJpCalificacion(r("jp_calif:condado"), AT);
  assert.equal(c.zoning.status, "unknown");
  assert.match(c.zoning.reason!, /no_calificacion_polygon/);
  assert.equal(parseJpCalificacion("timeout_8000ms", AT).zoning.reason, "timeout_8000ms");
});

test("zoning families from the district description", () => {
  assert.equal(zoningFamily("R-A", "Residencial de Alta Densidad"), "residential");
  assert.equal(zoningFamily("CR", "Conservación de Recursos"), "conservation");
  assert.equal(zoningFamily("C-L", "Comercial Liviano"), "commercial");
  assert.equal(zoningFamily("I-L", "Industrial Liviano"), "industrial");
  assert.equal(zoningFamily("A-P", "Agrícola Productivo"), "agricultural");
  assert.equal(zoningFamily("X", "algo raro"), null);
});

test("CRIM parcel: number, street polygon without number, JP fallback when CRIM is down", () => {
  const p = parseCrimParcel(r("crim:toa_baja_ae"), AT);
  assert.equal(p.code, "038-000-010-13");
  assert.equal(p.source.dataset_date, "2025-02");
  const street = parseCrimParcel(r("crim:guaynabo_pueblo"), AT);
  assert.equal(street.status, "none");
  assert.match(street.reason!, /TIPO V/);
  assert.equal(parseCrimParcel(r("crim:condado"), AT).status, "none");
  const fb = parseCrimParcel("http_502", AT, "419-000-005-02");
  assert.equal(fb.status, "resolved");
  assert.equal(fb.retrieval, "derived");
  assert.equal(fb.source.id, LAYER_SOURCES.jp_calificacion.id);
  assert.equal(parseCrimParcel("http_502", AT).status, "unknown");
});

test("coastal zone: official layer wins; derived 1 km band says 'in', never 'out'", () => {
  const off = parseCoastalZone({ features: [{ attributes: { DESCRIPCIO: "Zona Costanera" } }] }, null, AT);
  assert.equal(off.status, "resolved");
  assert.equal(off.approximate, false);
  assert.equal(parseCoastalZone({ features: [] }, null, AT).status, "none");
  const inBand = parseCoastalZone("http_502", r("coastline:condado"), AT);
  assert.equal(inBand.status, "resolved");
  assert.equal(inBand.approximate, true);
  assert.equal(inBand.source.id, LAYER_SOURCES.jp_linea_costa.id);
  const out = parseCoastalZone("http_502", r("coastline:guaynabo_pueblo"), AT);
  assert.equal(out.status, "unknown", "outside the band is not proof of being outside the zone");
  assert.match(out.reason!, /extends inland/);
  assert.equal(parseCoastalZone("http_502", "timeout_6000ms", AT).status, "unknown");
});

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

test("service: every layer for the AE point, optional layers time out → unknown", async () => {
  const l = await resolveAt("toa_baja_ae");
  assert.equal(layer(l, "flood_zone").code, "AE");
  assert.equal(layer(l, "zoning").code, "C-R");
  assert.equal(layer(l, "land_class").code, "SREP-E");
  assert.equal(layer(l, "parcel").code, "038-000-010-13");
  assert.equal(layer(l, "coastal_zone").status, "unknown");
  assert.equal(layer(l, "historic_zone").status, "unknown");
  assert.match(layer(l, "historic_zone").reason!, /^timeout_/);
  assert.equal(layer(l, "protected_area").status, "unknown");
});

test("service: a down layer degrades to unknown; the rest still resolve", async () => {
  const [lat, lng] = FX.points.toa_baja_ae;
  const l = await resolveSiteLayers(lat, lng, { fetchImpl: fixtureFetch([], { fema_zones: "down", jp_calif: "timeout" }), cache: new LayerCache(), timeoutMs: FAST, skipOptional: true });
  assert.equal(layer(l, "flood_zone").status, "unknown");
  assert.equal(layer(l, "flood_zone").reason, "http_503");
  assert.equal(layer(l, "zoning").status, "unknown");
  assert.match(layer(l, "zoning").reason!, /^timeout_200ms/);
  assert.equal(layer(l, "parcel").code, "038-000-010-13", "CRIM still answers");
  assert.equal(layerDeterminations(l).some((d) => d.geography_type === "flood_zone"), false, "unknown layers produce no facts");
});

test("service: fresh cache skips the network; stale cache serves when live fails", async () => {
  const cache = new LayerCache();
  const [lat, lng] = FX.points.toa_baja_ae;
  let now = new Date(AT);
  const calls: string[] = [];
  await resolveSiteLayers(lat, lng, { fetchImpl: fixtureFetch(calls), cache, timeoutMs: FAST, now: () => now, skipOptional: true });
  const first = calls.length;
  const again = await resolveSiteLayers(lat, lng, { fetchImpl: fixtureFetch(calls), cache, timeoutMs: FAST, now: () => now, skipOptional: true });
  assert.equal(layer(again, "flood_zone").retrieval, "cached");
  assert.ok(calls.length - first <= 2, `only the never-cacheable failures retry (${calls.length - first} calls)`);
  now = new Date(new Date(AT).getTime() + 2 * 24 * 3600_000);
  const stale = await resolveSiteLayers(lat, lng, { fetchImpl: fixtureFetch([], { fema_zones: "down" }), cache, timeoutMs: FAST, now: () => now, skipOptional: true });
  assert.equal(layer(stale, "flood_zone").code, "AE");
  assert.equal(layer(stale, "flood_zone").retrieval, "stale_cache");
  assert.match(layer(stale, "flood_zone").reason!, /live query failed \(http_503\)/);
});

// ---------------------------------------------------------------------------
// Facts, explanations, chips
// ---------------------------------------------------------------------------

const site = (lat: number, lng: number, layers?: SiteLayers): IntakeSite => ({
  latitude: lat,
  longitude: lng,
  coordinate_source: "MAP_PIN",
  formatted_address: null,
  municipality: { name: "Toa Baja", fips: "72137" },
  barrio: null,
  near_boundary: false,
  designations: [],
  boundary_source: { id: "census-tiger-2023", name: "Census", version: "2023", url: null },
  location_id: null,
  confirmed_at: AT,
  ...(layers ? { layers } : {}),
});

test("site facts: location.flood_zone.ae / .sfha, zoning, land class, parcel_id — bound to the site", async () => {
  const [lat, lng] = FX.points.toa_baja_ae;
  const l = await resolveAt("toa_baja_ae");
  const f = siteEngineFacts(site(lat, lng, l));
  assert.equal(f.projectFacts["location.flood_zone"], "AE");
  assert.equal(f.projectFacts["location.flood_zone.ae"], true);
  assert.equal(f.projectFacts["location.flood_zone.sfha"], true);
  assert.equal(f.projectFacts["location.zoning"], "C-R");
  assert.equal(f.projectFacts["location.zoning.c_r"], true);
  assert.equal(f.projectFacts["location.zoning.conservation"], true);
  assert.equal(f.projectFacts["location.land_class"], "SREP-E");
  assert.equal(f.projectFacts["location.land_class.srep"], true);
  assert.equal(f.projectFacts["location.land_class.rustico"], true);
  assert.equal(f.projectFacts["location.parcel_id"], "038-000-010-13");
  assert.equal(f.projectFacts["location.czm"], undefined, "coastal zone unknown → no fact");
  assert.equal(f.projectFacts["location.layer_status.coastal_zone"], "unknown");
  assert.equal(f.factMeta["location.flood_zone.sfha"].locationId, f.locationId);
  // Layers for another point are ignored (the pin moved, layers pending).
  const moved = siteEngineFacts(site(lat + 0.01, lng, l));
  assert.equal(moved.projectFacts["location.flood_zone.ae"], undefined);
  // Condado: VE + coastal zone (approximate).
  const [clat, clng] = FX.points.condado;
  const cf = siteEngineFacts(site(clat, clng, await resolveAt("condado")));
  assert.equal(cf.projectFacts["location.flood_zone.ve"], true);
  assert.equal(cf.projectFacts["location.czm"], true);
});

test("explanations and chips: 'Because your pin is in flood zone AE (FEMA, 2009-11-18)'", async () => {
  const l = await resolveAt("toa_baja_ae");
  const d = layerFactDetails(l);
  assert.equal(d["location.flood_zone.sfha"].en, "Because your pin is in flood zone AE (FEMA, 2009-11-18)");
  assert.equal(d["location.flood_zone.sfha"].es, "Porque tu pin está en la zona inundable AE (FEMA, 2009-11-18)");
  assert.match(d["location.land_class.srep"].en, /specially protected rustic land SREP-E \(JP, 2024-12-27\)/);
  const chips = layerChips(l).map((c) => `${c.status}:${c.label.en}`);
  assert.deepEqual(chips, ["resolved:Flood zone AE", "unknown:Coastal zone unknown", "resolved:Zoning C-R", "resolved:Rustic (protected)", "resolved:Parcel 038-000-010-13"]);
  const es = layerChips(l).map((c) => c.label.es);
  assert.deepEqual(es, ["Zona inundable AE", "Zona costanera desconocida", "Calificación C-R", "Rústico (protegido)", "Parcela 038-000-010-13"]);
  const fw = layerChips(await resolveAt("rio_grande_ae"))[0].label.en;
  assert.equal(fw, "Flood zone AE · floodway");
  const down = layerChips(unavailableSiteLayers(18.4, -66.2, "layers_service_unreachable")).map((c) => c.label.en);
  assert.deepEqual(down, ["Flood zone unknown", "Coastal zone unknown", "Zoning unknown"]);
});

test("restore: layers survive a snapshot round-trip only for the same point", async () => {
  const [lat, lng] = FX.points.toa_baja_ae;
  const l = await resolveAt("toa_baja_ae");
  const s = restoreIntakeSite(JSON.parse(JSON.stringify(site(lat, lng, l))));
  assert.equal(s?.layers?.results.length, l.results.length);
  assert.equal(restoreSiteLayers(l, lat + 0.001, lng), null);
  assert.equal(restoreSiteLayers({ latitude: lat, longitude: lng, results: [{ layer: "bogus" }] }, lat, lng)?.results.length, 0);
});

// ---------------------------------------------------------------------------
// Rules (KB)
// ---------------------------------------------------------------------------

const SESSION = "session-geo";
function evaluate(s: IntakeSite, project: Record<string, unknown>) {
  const f = siteEngineFacts(s);
  const meta: Record<string, FactMeta> = { ...f.factMeta };
  for (const k of Object.keys(project)) meta[k] = { source: "user_intake", scope: "project", sessionId: SESSION, confirmedInCurrentIntake: true };
  const out = runRulesEngine(KB, {
    businessTypeId: null,
    municipality: s.municipality.name,
    answers: {},
    sessionId: SESSION,
    locationId: f.locationId,
    projectFacts: { ...f.projectFacts, ...project },
    factMeta: meta,
  } as never);
  return out.requirements;
}
const docs = (reqs: ReturnType<typeof evaluate>) => reqs.map((x) => x.document_id);

test("rules: construction in AE adds the Reg. 13 flood review; zone X or no construction does not", async () => {
  const [lat, lng] = FX.points.toa_baja_ae;
  const ae = site(lat, lng, await resolveAt("toa_baja_ae"));
  const reqs = evaluate(ae, { project_type: "new_construction" });
  const flood = reqs.find((x) => x.document_id === "DOC_JP_FLOOD_REG13");
  assert.ok(flood, "Reg. 13 flood review fires in AE");
  assert.equal(flood!.source_rule_id, "RULE_0706");
  assert.equal(translateTriggerReason(flood!.reason, "Toa Baja", "en", siteFactDetails(ae)), "Because your pin is in flood zone AE (FEMA, 2009-11-18)");
  assert.ok(!docs(evaluate(ae, { business_activity: "office" })).includes("DOC_JP_FLOOD_REG13"), "no construction → no flood review");
  const [glat, glng] = FX.points.guaynabo_pueblo;
  const x = site(glat, glng, await resolveAt("guaynabo_pueblo"));
  assert.ok(!docs(evaluate(x, { project_type: "new_construction" })).includes("DOC_JP_FLOOD_REG13"), "zone X → no flood review");
  // Layers unknown (service down): no fact, no rule — and never a crash.
  const unknown = site(lat, lng, unavailableSiteLayers(lat, lng, "layers_service_unreachable"));
  assert.ok(!docs(evaluate(unknown, { project_type: "new_construction" })).includes("DOC_JP_FLOOD_REG13"));
});

test("rules: floodway, rustic land and the coastal zone", async () => {
  const [rlat, rlng] = FX.points.rio_grande_ae;
  const fw = evaluate(site(rlat, rlng, await resolveAt("rio_grande_ae")), { structural_work: true });
  const flood = fw.find((x) => x.document_id === "DOC_JP_FLOOD_REG13")!;
  assert.deepEqual(flood.matched_rules?.map((m) => m.rule_id).sort(), ["RULE_0706", "RULE_0707"]);
  assert.ok(docs(fw).includes("DOC_CONSULTA_UBICACION"), "construction on SREP-A land → consulta de ubicación");
  const [clat, clng] = FX.points.condado;
  const cz = evaluate(site(clat, clng, await resolveAt("condado")), { project_type: "renovation", exterior_work: true });
  assert.ok(docs(cz).includes("DOC_CZM_COASTAL_REVIEW"), "coastal zone → CZM review");
  assert.ok(docs(cz).includes("DOC_JP_FLOOD_REG13"), "VE is in the SFHA");
  const czm = KB.rules.find((x) => x.id === "RULE_0708")!;
  assert.equal(czm.verification, "heuristic");
  assert.match(czm.trigger_summary!, /^EXPERT VALIDATION NEEDED/);
});

test("rules: a change of use in a residential / conservation district → consulta de ubicación (expert validation)", async () => {
  const [glat, glng] = FX.points.guayama_rural;
  const s = site(glat, glng, await resolveAt("guayama_rural"));
  const reqs = evaluate(s, { change_of_use: true });
  const cu = reqs.find((x) => x.document_id === "DOC_CONSULTA_UBICACION");
  assert.ok(cu);
  assert.ok(cu!.matched_rules!.some((m) => m.rule_id === "RULE_0710"), "residential district rule");
  assert.ok(!docs(evaluate(s, { business_activity: "office" })).includes("DOC_CONSULTA_UBICACION"));
});

test("rules: every geo-layer rule cites a source and names its document", () => {
  const geo = KB.rules.filter((x) => typeof x.fact_key === "string" && /^location\.(flood_zone|czm|land_class|zoning)/.test(x.fact_key));
  assert.ok(geo.length >= 7);
  for (const g of geo) {
    const cited = g as typeof g & { citation?: string; citation_url?: string };
    assert.ok(cited.citation && cited.citation_url, `${g.id} has a citation`);
    assert.ok(KB.documents.some((d) => d.id === g.requires_document_id), `${g.id} document exists`);
    assert.ok(g.any_of_facts && g.any_of_facts.length > 0, `${g.id} needs a project condition`);
  }
});

// ---------------------------------------------------------------------------
// Energy processes (#116): the pin answers the siting questions
// ---------------------------------------------------------------------------

test("energy: a ground solar farm on an AE / SREP pin resolves floodplain and siting from the map", async () => {
  const description = "Develop a 5 MW ground-mounted solar farm selling to LUMA";
  const { context } = validateProjectContext(
    {
      generation_technology: { value: "solar", confidence: 0.95, evidence: "solar farm" },
      generation_capacity_kw: { value: 5000, confidence: 0.95, evidence: "5 MW" },
      mounting_type: { value: "ground", confidence: 0.95, evidence: "ground-mounted" },
      energy_market_segment: { value: "wholesale", confidence: 0.9, evidence: "selling to LUMA" },
    },
    description
  );
  const before = computeEnergyAssessment({ projectContext: context, municipality: "Toa Baja" }).assessment!;
  const st = (a: typeof before, id: string) => a.processes.find((p) => p.process_id === id)?.state ?? "ABSENT";
  assert.notEqual(st(before, "PR_FLOODPLAIN_REG13"), "REQUIRED");
  const [lat, lng] = FX.points.toa_baja_ae;
  const s = site(lat, lng, await resolveAt("toa_baja_ae"));
  const after = computeEnergyAssessment({
    projectContext: context,
    municipality: "Toa Baja",
    location: { facts: siteEngineFacts(s).projectFacts, details: siteFactDetails(s) },
  }).assessment!;
  assert.equal(st(after, "PR_FLOODPLAIN_REG13"), "REQUIRED", "flood zone answered by the pin");
  const fl = after.processes.find((p) => p.process_id === "PR_FLOODPLAIN_REG13")!;
  assert.ok(JSON.stringify(fl.explanation).includes("Because your pin is in flood zone AE (FEMA, 2009-11-18)"), "explanation cites the pin");
  // Map facts never make a non-energy request look like an energy project.
  assert.equal(computeEnergyAssessment({ projectContext: null, location: { facts: siteEngineFacts(s).projectFacts } }).assessment, null);
});
