// Geocoding provider abstraction (no network: fetch is injected).
// Run: npx tsx --test src/lib/geocoding/geocoding.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  GeocodingError,
  geocoderFromEnv,
  nominatimProvider,
  normalizeNominatimPlace,
  politeProvider,
  stripMunicipioSuffix,
} from "./index.ts";

const GUAYNABO_PLACE = {
  place_id: 123,
  osm_type: "way",
  osm_id: 456,
  lat: "18.3912301",
  lon: "-66.1178405",
  display_name: "123, Calle Ejemplo, Guaynabo, Puerto Rico, 00968, United States",
  address: {
    house_number: "123",
    road: "Calle Ejemplo",
    city: "Guaynabo",
    county: "Guaynabo Municipio",
    state: "Puerto Rico",
    "ISO3166-2-lvl4": "US-PR",
    postcode: "00968",
    country_code: "us",
  },
};

test("Nominatim places in Puerto Rico normalize to country PR with the municipio", () => {
  const c = normalizeNominatimPlace(GUAYNABO_PLACE, "nominatim");
  assert.ok(c);
  assert.equal(c.country_code, "PR");
  assert.equal(c.state_or_region, "PR");
  assert.equal(c.municipality, "Guaynabo");
  assert.equal(c.address_line_1, "123 Calle Ejemplo");
  assert.equal(c.postal_code, "00968");
  assert.equal(c.latitude, 18.3912301);
  assert.equal(c.place_source_id, "way/456");
});

test("municipio suffix/prefix variants are stripped", () => {
  assert.equal(stripMunicipioSuffix("Bayamón Municipio"), "Bayamón");
  assert.equal(stripMunicipioSuffix("Municipio Autónomo de Ponce"), "Ponce");
  assert.equal(stripMunicipioSuffix("Ponce Municipality"), "Ponce");
  assert.equal(stripMunicipioSuffix(null), null);
});

test("places with invalid coordinates are dropped rather than invented", () => {
  assert.equal(normalizeNominatimPlace({ ...GUAYNABO_PLACE, lat: "not-a-number" }, "nominatim"), null);
});

function fakeFetch(handler: (url: URL) => { status?: number; body?: unknown } | Error) {
  const calls: URL[] = [];
  const impl = async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    calls.push(url);
    assert.ok((init?.headers as Record<string, string>)["User-Agent"], "identifying User-Agent is required");
    const out = handler(url);
    if (out instanceof Error) throw out;
    return new Response(JSON.stringify(out.body ?? null), { status: out.status ?? 200 });
  };
  return { impl, calls };
}

test("search is biased to Puerto Rico and passes the optional key server-side", async () => {
  const { impl, calls } = fakeFetch(() => ({ body: [GUAYNABO_PLACE] }));
  const p = nominatimProvider({ baseUrl: "https://geo.example/", apiKey: "k", userAgent: "SmartPR-test", fetchImpl: impl });
  const results = await p.search("calle ejemplo guaynabo");
  assert.equal(results.length, 1);
  const url = calls[0];
  assert.equal(url.pathname, "/search");
  assert.equal(url.searchParams.get("bounded"), "1");
  assert.ok(url.searchParams.get("viewbox"));
  assert.equal(url.searchParams.get("key"), "k");
});

test("reverse geocoding with no address returns null (the caller still saves the point)", async () => {
  const { impl } = fakeFetch(() => ({ body: { error: "Unable to geocode" } }));
  const p = nominatimProvider({ baseUrl: "https://geo.example", userAgent: "t", fetchImpl: impl });
  assert.equal(await p.reverse(18.2, -66.5), null);
});

test("provider failures surface as typed errors, not fake results", async () => {
  const down = nominatimProvider({ baseUrl: "https://geo.example", userAgent: "t", fetchImpl: fakeFetch(() => ({ status: 503 })).impl });
  await assert.rejects(down.reverse(18.2, -66.5), (e: unknown) => e instanceof GeocodingError && e.message === "provider_http_503");
  const offline = nominatimProvider({
    baseUrl: "https://geo.example",
    userAgent: "t",
    fetchImpl: fakeFetch(() => new TypeError("fetch failed")).impl,
  });
  await assert.rejects(offline.search("x"), (e: unknown) => e instanceof GeocodingError && e.message === "provider_unreachable");
});

test("geocoding defaults to Nominatim and can be switched off", () => {
  assert.equal(geocoderFromEnv({})?.id, "nominatim");
  assert.equal(geocoderFromEnv({ MAP_GEOCODING_PROVIDER: "nominatim" })?.id, "nominatim");
  assert.equal(geocoderFromEnv({ MAP_GEOCODING_PROVIDER: "off" }), null);
  assert.equal(geocoderFromEnv({ MAP_GEOCODING_PROVIDER: "google" }), null);
  // One shared instance per configuration, so the throttle/cache are process-wide.
  assert.equal(geocoderFromEnv({}), geocoderFromEnv({}));
});

test("polite provider spaces upstream calls and caches repeats", async () => {
  const clock = 0;
  const sleeps: number[] = [];
  const calls: string[] = [];
  const inner = {
    id: "fake",
    async search(q: string) {
      calls.push(`s:${q}`);
      return [];
    },
    async reverse(lat: number, lng: number) {
      calls.push(`r:${lat},${lng}`);
      return null;
    },
  };
  const p = politeProvider(inner, { minIntervalMs: 1000, now: () => clock, sleep: async (ms) => void sleeps.push(ms) });
  // Three concurrent calls claim slots 0, 1000 and 2000 ms from now.
  await Promise.all([p.reverse(18.391231, -66.117841), p.reverse(18.2, -66.5), p.search("Guaynabo")]);
  assert.deepEqual(sleeps, [1000, 2000]);
  assert.equal(calls.length, 3);
  // Same point (to ~1 m) and same query: served from cache, no upstream call.
  await p.reverse(18.391232, -66.117842);
  await p.search("  guaynabo ");
  assert.equal(calls.length, 3);
});

test("a shared (cross-instance) reserver decides the wait; it falls back locally when unavailable", async () => {
  const sleeps: number[] = [];
  const inner = { id: "fake", async search() { return []; }, async reverse() { return null; } };
  const shared = politeProvider(inner, { minIntervalMs: 1000, reserve: async () => 750, now: () => 0, sleep: async (ms) => void sleeps.push(ms) });
  await shared.reverse(18.1, -66.1);
  assert.deepEqual(sleeps, [750], "the shared schedule's wait is honored");

  sleeps.length = 0;
  const down = politeProvider(inner, {
    minIntervalMs: 1000,
    reserve: async () => { throw new Error("db down"); },
    now: () => 0,
    sleep: async (ms) => void sleeps.push(ms),
  });
  await Promise.all([down.reverse(18.1, -66.1), down.reverse(18.2, -66.2)]);
  assert.deepEqual(sleeps, [1000], "per-process spacing still applies without the database");
});

test("an overloaded queue fails fast instead of hanging the request", async () => {
  const inner = { id: "fake", async search() { return []; }, async reverse() { return null; } };
  const p = politeProvider(inner, { minIntervalMs: 1000, maxWaitMs: 5000, reserve: async () => 60_000, sleep: async () => {} });
  await assert.rejects(p.reverse(18.1, -66.1), (e: unknown) => e instanceof GeocodingError && e.message === "rate_limited");
});

test("polite provider does not cache failures and keeps serving after one", async () => {
  let fail = true;
  const inner = {
    id: "fake",
    async search() {
      return [];
    },
    async reverse() {
      if (fail) throw new GeocodingError("provider_http_503", 503);
      return null;
    },
  };
  const p = politeProvider(inner, { minIntervalMs: 0 });
  await assert.rejects(p.reverse(18.2, -66.5));
  fail = false;
  assert.equal(await p.reverse(18.2, -66.5), null);
});
