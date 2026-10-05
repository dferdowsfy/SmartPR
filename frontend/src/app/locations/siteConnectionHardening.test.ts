// Site-report connection hardening: overall deadline, shared UA, one timeout
// rule per source, honest unknown vs empty (elevation / soils / geocoder).
// Run via: npm run test:locations
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { LAYER_SOURCES, parseTerrain } from "./layers.ts";
import {
  LAYER_TIMEOUTS_MS,
  SMARTPR_USER_AGENT,
  queryDataset,
  queryJson,
  resetEndpointHealth,
  timeoutForSource,
  retryOnTimeoutForSource,
  type FetchLike,
} from "./layerService.ts";
import { parseSoilsPin } from "./parcel.ts";
import { fallbackGeocoder, GeocodingError, type GeocodingProvider, type GeocodeCandidate } from "../../lib/geocoding/index.ts";

beforeEach(() => resetEndpointHealth());

test("shared UA is sent on every queryOnce / queryJson call", async () => {
  const headers: Array<Record<string, string> | undefined> = [];
  const fetchImpl: FetchLike = async (_url, init) => {
    headers.push(init?.headers);
    return { ok: true, status: 200, json: async () => ({ features: [] }) };
  };
  await queryJson(fetchImpl, "https://example.test/query", 200, 0, 0, false);
  assert.equal(headers[0]?.["User-Agent"], SMARTPR_USER_AGENT);
  assert.equal(headers[0]?.Accept, "application/json");
});

test("deadline skips retries and fallbacks instead of stacking timeouts", async () => {
  const calls: string[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push(url);
    return new Promise((_, reject) => {
      init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    });
  };
  const deadlineAt = Date.now() + 80;
  const r = await queryDataset(
    fetchImpl,
    ["https://primary.test/0", "https://fallback.test/0"],
    (ep) => `${ep}/query`,
    { timeoutMs: 50, retries: 1, retryDelayMs: 0, retryOnTimeout: true, deadlineAt }
  );
  assert.equal(typeof r.result, "string");
  // With an 80 ms budget and 50 ms attempts, at most one attempt (maybe two if very fast), never the full 2×(50+50) stack.
  assert.ok(calls.length <= 2, `expected ≤2 attempts under deadline, got ${calls.length}: ${calls.join(",")}`);
  assert.match(String(r.result), /timeout_|deadline_exceeded/);
});

test("parcel/layers share one timeout + retry rule per source", () => {
  assert.equal(timeoutForSource("crim_parcels"), LAYER_TIMEOUTS_MS.crim);
  assert.equal(timeoutForSource("jp_calificacion"), LAYER_TIMEOUTS_MS.jp_calificacion);
  assert.equal(timeoutForSource("fema_flood_zones"), LAYER_TIMEOUTS_MS.fema_zones);
  assert.equal(retryOnTimeoutForSource("crim_parcels"), false, "CRIM must not retry on timeout (was the 48 s pile-up)");
  assert.equal(retryOnTimeoutForSource("fema_flood_zones"), true);
  assert.equal(LAYER_SOURCES.jp_zona_costanera.url.includes("Reglamentario/MapServer/31"), true);
  assert.equal(LAYER_SOURCES.jp_zona_costanera.url.includes("Reglamentario_va2"), false, "dead _va2 path removed");
});

test("elevation failure reason is kept on the terrain result", () => {
  const r = parseTerrain({ rgba: [0, 0, 0, 0] }, { centerM: null, slopePct: null, reason: "timeout_6000ms" }, "2026-10-05T00:00:00.000Z");
  assert.equal(r.attributes.ELEVATION_REASON, "timeout_6000ms");
  assert.equal(r.attributes.ELEVATION_M, null);
});

test("empty soils body is unable/unknown, not no_mapped", () => {
  assert.equal(parseSoilsPin("empty_response").status, "unable");
  assert.equal(parseSoilsPin("empty_response").reason, "empty_response");
  // A real empty table (answered, zero rows) is still no_mapped.
  assert.equal(parseSoilsPin({ Table: [["mukey"],] }).status, "no_mapped");
});

test("geocoder partial outage is an error, not an empty list", async () => {
  const stub = (id: string, search: () => Promise<GeocodeCandidate[]>): GeocodingProvider => ({ id, search, reverse: async () => null });
  await assert.rejects(
    fallbackGeocoder([
      stub("a", async () => []),
      stub("b", async () => { throw new GeocodingError("provider_timeout"); }),
    ]).search("Calle Padial"),
    /provider_timeout/
  );
});
