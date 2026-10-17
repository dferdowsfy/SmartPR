// Geocoding provider abstraction (no network: fetch is injected).
// Run: npx tsx --test src/lib/geocoding/geocoding.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  GeocodingError,
  attributionFor,
  crimCatastroProvider,
  fallbackGeocoder,
  normalizeCatastroQuery,
  normalizePhotonFeature,
  photonProvider,
  type GeocodeCandidate,
  type GeocodingProvider,
  geocoderFromEnv,
  nominatimProvider,
  normalizeNominatimPlace,
  politeProvider,
  searchInNamedMunicipio,
  isAreaCentroid,
  routeRefQuery,
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
  assert.equal(geocoderFromEnv({})?.id, "crim_catastro+nominatim+photon");
  assert.equal(geocoderFromEnv({ MAP_GEOCODING_PROVIDER: "nominatim" })?.id, "crim_catastro+nominatim+photon");
  assert.equal(geocoderFromEnv({ MAP_GEOCODING_FALLBACK: "off" })?.id, "crim_catastro+nominatim");
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


// ---------------------------------------------------------------------------
// Fallback chain, Photon, CRIM catastro lookup
// ---------------------------------------------------------------------------

const cand = (src: string): GeocodeCandidate => ({ latitude: 18.23, longitude: -66.03, formatted_address: src, address_line_1: null, city: null, municipality: null, state_or_region: "PR", postal_code: null, country_code: "PR", place_source: src, place_source_id: null });
const stub = (id: string, search: () => Promise<GeocodeCandidate[]>): GeocodingProvider => ({ id, search, reverse: async () => null });

test("fallback: the first non-empty provider wins; empty and failing ones pass through", async () => {
  const calls: string[] = [];
  const g = fallbackGeocoder([
    stub("a", async () => { calls.push("a"); return []; }),
    stub("b", async () => { calls.push("b"); throw new GeocodingError("rate_limited"); }),
    stub("c", async () => { calls.push("c"); return [cand("c")]; }),
    stub("d", async () => { calls.push("d"); return [cand("d")]; }),
  ]);
  const r = await g.search("Calle Padial Caguas");
  assert.equal(r[0]!.place_source, "c");
  assert.deepEqual(calls, ["a", "b", "c"]);
});

test("fallback: nothing found is [] (not an error); any provider error with no results is an error", async () => {
  // All empty, no errors → genuine "nothing found".
  assert.deepEqual(await fallbackGeocoder([stub("a", async () => []), stub("b", async () => [])]).search("x"), []);
  // Partial outage (one empty, one error) must NOT look like "address not found".
  await assert.rejects(
    fallbackGeocoder([stub("a", async () => []), stub("b", async () => { throw new GeocodingError("provider_http_503", 503); })]).search("x"),
    /provider_http_503/
  );
  await assert.rejects(
    fallbackGeocoder([stub("a", async () => { throw new GeocodingError("provider_timeout"); }), stub("b", async () => { throw new GeocodingError("provider_http_503", 503); })]).search("x"),
    /provider_timeout/
  );
});

test("photon: PR street normalizes with municipio, PR country and OSM ref; non-PR results dropped", async () => {
  const f = { type: "Feature", properties: { osm_type: "W", osm_id: 298307589, name: "Calle Padial", district: "Sector El Campito", city: "Caguas", county: "Caguas", state: "Puerto Rico", postcode: "00725", countrycode: "US" }, geometry: { coordinates: [-66.0371333, 18.2323106] as [number, number] } };
  const c = normalizePhotonFeature(f)!;
  assert.equal(c.municipality, "Caguas");
  assert.equal(c.country_code, "PR");
  assert.equal(c.place_source_id, "way/298307589");
  assert.match(c.formatted_address!, /Calle Padial, Sector El Campito, Caguas, Puerto Rico, 00725/);
  let seen = "";
  const p = photonProvider({ baseUrl: "https://photon.test", userAgent: "UA", fetchImpl: async (u) => { seen = u; return new Response(JSON.stringify({ features: [f, { ...f, properties: { ...f.properties, state: "Florida" } }] }), { status: 200 }); } });
  const r = await p.search("Calle Padial Caguas", { lang: "es" });
  assert.equal(r.length, 1, "only Puerto Rico results");
  assert.doesNotMatch(seen, /lang=/, "Photon has no Spanish: never send lang=es (it 400s)");
  assert.match(seen, /bbox=/);
});

test("catastro: query normalization and CRIM lookup → a pin on the parcel", async () => {
  assert.equal(normalizeCatastroQuery("225-044-031-13"), "225-044-031-13");
  assert.equal(normalizeCatastroQuery("catastro 225 044 031 13"), "225-044-031-13");
  assert.equal(normalizeCatastroQuery("22504403113"), "225-044-031-13");
  assert.equal(normalizeCatastroQuery("Calle Padial 12"), null);
  const urls: string[] = [];
  const ring: Array<[number, number]> = [[-66.04, 18.23], [-66.039, 18.23], [-66.039, 18.231], [-66.04, 18.231], [-66.04, 18.23]];
  const p = crimCatastroProvider({
    endpoints: ["https://crim.down/0", "https://crim.up/0"],
    fetchImpl: async (u) => {
      urls.push(u);
      if (u.startsWith("https://crim.down")) return new Response("bad gateway", { status: 502 });
      return new Response(JSON.stringify({ features: [{ attributes: { NUM_CATASTRO: "225-044-031-13" }, geometry: { rings: [ring] } }] }), { status: 200 });
    },
  });
  const r = await p.search("225-044-031-13");
  assert.equal(urls.length, 2, "falls back to the second CRIM endpoint");
  assert.match(decodeURIComponent(urls[1]!), /NUM_CATASTRO='225-044-031-13'/);
  assert.equal(r[0]!.place_source, "crim_catastro");
  assert.ok(Math.abs(r[0]!.latitude - 18.2305) < 5e-5 && Math.abs(r[0]!.longitude + 66.0395) < 5e-5, "pin inside the parcel, near its middle");
  assert.deepEqual(await p.search("not a catastro"), [], "non-catastro text never hits CRIM");
  assert.equal(urls.length, 2);
});

test("attribution: OSM-derived results carry the ODbL credit", () => {
  assert.match(attributionFor("nominatim")!, /OpenStreetMap/);
  assert.match(attributionFor("photon")!, /OpenStreetMap/);
  assert.match(attributionFor("crim_catastro")!, /CRIM/);
  assert.equal(attributionFor("manual"), null);
});

test("named municipio: candidates in the municipio the query names lead (Run 12)", async () => {
  const cand = (formatted: string, municipality: string | null, lat = 18.2): GeocodeCandidate => ({
    latitude: lat, longitude: -66.5, formatted_address: formatted, address_line_1: null, city: null, municipality,
    state_or_region: "PR", postal_code: null, country_code: "PR", place_source: "photon", place_source_id: null,
  });
  const calls: string[] = [];
  const answers: Record<string, GeocodeCandidate[]> = {
    "Calle Comercio, Peñuelas, Puerto Rico": [
      cand("Calle Peñuelas, Cañaboncito, Caguas, Puerto Rico, 00727", "Caguas"),
      cand("Calle Comercio, Santurce, San Juan, Puerto Rico, 00907", "San Juan"),
      cand("Plaza Pública de Peñuelas, Calle Luis Muñoz Rivera, Barrio Pueblo, Peñuelas, Puerto Rico, 00624", "Peñuelas", 18.057),
    ],
    "Calle Inexistente, Peñuelas, Puerto Rico": [cand("Calle Peñuelas, Hato Rey Sur, San Juan, Puerto Rico", "San Juan")],
    "Peñuelas, Puerto Rico": [cand("Peñuelas, Puerto Rico", "Peñuelas", 18.056)],
    "Calle Peñuelas, Caguas": [cand("Calle Peñuelas, Cañaboncito, Caguas, Puerto Rico, 00727", "Caguas")],
    "Calle Sin Pueblo": [cand("Calle Sin Pueblo, Caguas, Puerto Rico", "Caguas"), cand("Calle Sin Pueblo, Ponce, Puerto Rico", "Ponce")],
  };
  const g = { search: async (q: string) => { calls.push(q); return answers[q] ?? []; } };

  const a = await searchInNamedMunicipio(g, "Calle Comercio, Peñuelas, Puerto Rico");
  assert.equal(a[0]!.municipality, "Peñuelas", "the Peñuelas match leads, not Calle Peñuelas in Caguas");
  assert.equal(a.length, 3, "other matches stay as alternatives");
  assert.deepEqual(calls, ["Calle Comercio, Peñuelas, Puerto Rico"], "no extra lookup when one is already in the municipio");

  calls.length = 0;
  const b = await searchInNamedMunicipio(g, "Calle Inexistente, Peñuelas, Puerto Rico");
  assert.equal(b[0]!.municipality, "Peñuelas", "falls back to the named municipio itself");
  assert.equal(b[1]!.municipality, "San Juan");
  assert.deepEqual(calls, ["Calle Inexistente, Peñuelas, Puerto Rico", "Peñuelas, Puerto Rico"]);

  // A street named after another municipio, in the municipio the query names.
  assert.equal((await searchInNamedMunicipio(g, "Calle Peñuelas, Caguas"))[0]!.municipality, "Caguas");
  // No municipio named: provider order untouched.
  assert.deepEqual((await searchInNamedMunicipio(g, "Calle Sin Pueblo")).map((c) => c.municipality), ["Caguas", "Ponce"]);
});

test("named municipio fallback: the town's place node leads, not the boundary centroid (Run 18)", async () => {
  // Live Run 18: "Calle Matienzo Cintrón, Las Marías" has no OSM match, so the
  // municipio itself was searched. Nominatim ranks the boundary relation
  // first, and its point (the polygon centroid) sits in barrio Palma Escrita,
  // ~1.8 km from the pueblo. The town node must lead.
  const mk = (lat: number, lon: number, id: string): GeocodeCandidate => ({
    latitude: lat, longitude: lon, formatted_address: "Las Marías, Puerto Rico, 00670, United States", address_line_1: null,
    city: null, municipality: "Las Marías", state_or_region: "PR", postal_code: "00670", country_code: "PR",
    place_source: "nominatim", place_source_id: id,
  });
  const centroid = mk(18.2388706, -66.9825882, "relation/1898390");
  const town = mk(18.2522446, -66.9918133, "node/151507693");
  const answers: Record<string, GeocodeCandidate[]> = {
    "Calle Matienzo Cintrón, Las Marías, Puerto Rico": [],
    "Las Marías, Puerto Rico": [centroid, town],
  };
  const g = { search: async (q: string) => answers[q] ?? [] };
  const r = await searchInNamedMunicipio(g, "Calle Matienzo Cintrón, Las Marías, Puerto Rico");
  assert.equal(r[0]!.place_source_id, "node/151507693", "the pueblo's place node leads");
  assert.equal(r.length, 1);
  // When only the boundary is offered (e.g. San Juan), it is still used.
  const onlyArea = { search: async (q: string) => (q === "Las Marías, Puerto Rico" ? [centroid] : []) };
  assert.equal((await searchInNamedMunicipio(onlyArea, "Calle X, Las Marías, Puerto Rico"))[0]!.place_source_id, "relation/1898390");
  assert.equal(isAreaCentroid(centroid), true);
  assert.equal(isAreaCentroid(town), false);
  assert.equal(isAreaCentroid({ place_source_id: "way/1" }), false);
  assert.equal(isAreaCentroid({ place_source_id: null }), false);
});

test("searchInNamedMunicipio: official boundaries decide when the provider label disagrees (Run 14)", async () => {
  const calls: string[] = [];
  const mk = (municipality: string, latitude: number, longitude: number): GeocodeCandidate => ({
    latitude, longitude, formatted_address: `Somewhere, ${municipality}, Puerto Rico`, address_line_1: null, city: null,
    municipality, state_or_region: "PR", postal_code: null, country_code: "PR", place_source: "nominatim", place_source_id: null,
  });
  const g = {
    async search(q: string) {
      calls.push(q);
      if (q === "Utuado, Puerto Rico") return [mk("Utuado", 18.26, -66.7)];
      return [mk("Utuado", 18.2949, -66.825)];
    },
  };
  // The road point is labeled Utuado but officially sits in Lares.
  const locate = (lat: number, lng: number) => (lng < -66.8 ? "Lares" : "Utuado");
  const r = await searchInNamedMunicipio(g, "Carretera 111, Utuado, Puerto Rico", { locate });
  assert.equal(r[0]!.longitude, -66.7, "a point officially inside Utuado leads");
  assert.equal(r[1]!.longitude, -66.825, "the boundary road match stays as an alternative");
  assert.deepEqual(calls, ["PR-111, Utuado, Puerto Rico", "Utuado, Puerto Rico"]);
  // Without a locator the provider label still decides (unchanged behavior).
  calls.length = 0;
  const plain = await searchInNamedMunicipio(g, "Carretera 111, Utuado, Puerto Rico");
  assert.equal(plain[0]!.longitude, -66.825);
  assert.deepEqual(calls, ["PR-111, Utuado, Puerto Rico"]);
});

test("routeRefQuery: Puerto Rico road numbers become route refs, not house numbers (Run 15)", () => {
  assert.equal(routeRefQuery("Carretera 333, Guánica, Puerto Rico"), "PR-333, Guánica, Puerto Rico");
  assert.equal(routeRefQuery("Carr. 2 Km 45.3, Vega Alta, PR"), "PR-2, Vega Alta, PR");
  assert.equal(routeRefQuery("Road 116 km 4, Lajas"), "PR-116, Lajas");
  assert.equal(routeRefQuery("Ruta 52, Cayey"), "PR-52, Cayey");
  assert.equal(routeRefQuery("PR 3, Humacao"), "PR-3, Humacao");
  assert.equal(routeRefQuery("PR-333, Guánica"), null, "already a route ref");
  assert.equal(routeRefQuery("Calle 3, Bayamón, Puerto Rico"), null, "a numbered street is not a state road");
  assert.equal(routeRefQuery("Carretera Militar, Vega Alta"), null);
  assert.equal(routeRefQuery("Calle Luna 12, San Juan, PR 00901"), null, "a ZIP after PR is not a road");
});

test("searchInNamedMunicipio: a Carretera query searches the route ref first, the original wording only as fallback (Run 15)", async () => {
  const calls: string[] = [];
  const mk = (formatted: string, latitude: number, longitude: number): GeocodeCandidate => ({
    latitude, longitude, formatted_address: formatted, address_line_1: null, city: null,
    municipality: "Guánica", state_or_region: "PR", postal_code: null, country_code: "PR", place_source: "nominatim", place_source_id: null,
  });
  const answers: Record<string, GeocodeCandidate[]> = {
    "PR-333, Guánica, Puerto Rico": [mk("Carretera Caña Gorda, Carenero, Guánica", 17.9577, -66.8675)],
    "Carretera 333, Guánica, Puerto Rico": [mk("333, Carretera Ciénagas, Fuig, Guánica", 17.9863, -66.9208)],
    "Carretera 999, Guánica, Puerto Rico": [mk("999, Calle Algo, Guánica", 17.97, -66.9)],
  };
  const g = { search: async (q: string) => { calls.push(q); return answers[q] ?? []; } };
  const r = await searchInNamedMunicipio(g, "Carretera 333, Guánica, Puerto Rico");
  assert.equal(r[0]!.formatted_address, "Carretera Caña Gorda, Carenero, Guánica", "the road itself, not house 333 elsewhere");
  assert.deepEqual(calls, ["PR-333, Guánica, Puerto Rico"]);
  calls.length = 0;
  const f = await searchInNamedMunicipio(g, "Carretera 999, Guánica, Puerto Rico");
  assert.equal(f[0]!.formatted_address, "999, Calle Algo, Guánica", "no route match falls back to the original wording");
  assert.deepEqual(calls, ["PR-999, Guánica, Puerto Rico", "Carretera 999, Guánica, Puerto Rico"]);
});
