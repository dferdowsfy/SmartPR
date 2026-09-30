// Census boundary lookup + "what this location means" evaluation (pure).
// Run: npx tsx --test src/app/locations/requirements.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { KB } from "../kb.ts";
import { boundaryDeterminations, locateInPuertoRico, BOUNDARY_SOURCE } from "./boundaries.ts";
import type { LocationGeography, PassportLocationWithGeographies } from "./geo.ts";
import { evaluateLocationRequirements, normalizeMunicipio, type BusinessFacts } from "./requirements.ts";

test("Census boundaries place known points in the right municipio and barrio", () => {
  const cases: [number, number, string, string | null][] = [
    [18.4655, -66.1057, "San Juan", "San Juan Antiguo"],
    [18.39123, -66.11784, "Guaynabo", "Pueblo Viejo"],
    [18.3985, -66.1557, "Bayamón", "Bayamón"], // barrio-pueblo
    [18.1263, -65.4401, "Vieques", "Puerto Ferro"],
    [18.3031, -65.3007, "Culebra", "Culebra"],
  ];
  for (const [lat, lng, municipio, barrio] of cases) {
    const p = locateInPuertoRico(lat, lng);
    assert.equal(p?.municipio.name, municipio, `${lat},${lng}`);
    assert.equal(p?.barrio?.name ?? null, barrio, `${lat},${lng}`);
  }
  assert.equal(locateInPuertoRico(18.3985, -66.1557)?.barrio?.barrioPueblo, true);
});

test("points outside Puerto Rico's land/municipal areas are not placed (nothing invented)", () => {
  assert.equal(locateInPuertoRico(18.75, -66.5), null); // open Atlantic
  assert.equal(locateInPuertoRico(18.4861, -69.9312), null); // Santo Domingo
  assert.deepEqual(boundaryDeterminations(40.7128, -74.006), []);
});

test("points close to a boundary are flagged for verification", () => {
  const ponce = locateInPuertoRico(18.0111, -66.6141);
  assert.equal(ponce?.municipio.name, "Ponce");
  assert.equal(ponce?.nearBoundary, true);
  assert.equal(locateInPuertoRico(18.4655, -66.1057)?.nearBoundary, false);
});

test("determinations carry full provenance", () => {
  const [muni, barrio] = boundaryDeterminations(18.39123, -66.11784);
  assert.equal(muni.geography_type, "municipality");
  assert.equal(muni.geography_code, "061");
  assert.equal(muni.determination_method, "SPATIAL_INTERSECTION");
  assert.equal(muni.source_id, BOUNDARY_SOURCE.id);
  assert.equal(muni.source_version, "TIGER2024");
  assert.match(muni.source_url, /census\.gov/);
  assert.equal(barrio.geography_name, "Pueblo Viejo");
});

function locationAt(lat: number, lng: number, over: Partial<PassportLocationWithGeographies> = {}): PassportLocationWithGeographies {
  const id = "11111111-1111-4111-8111-111111111111";
  const geographies: LocationGeography[] = boundaryDeterminations(lat, lng).map((d, i) => ({
    ...d,
    id: `g${i}`,
    location_id: id,
    determined_at: "2026-09-30T00:00:00.000Z",
  }));
  return {
    id,
    business_id: "22222222-2222-4222-8222-222222222222",
    name: "Site",
    is_primary: true,
    latitude: lat,
    longitude: lng,
    coordinate_system: "EPSG:4326",
    coordinate_source: "MAP_PIN",
    address_line_1: null,
    address_line_2: null,
    city: null,
    municipality: null,
    state_or_region: null,
    postal_code: null,
    country_code: null,
    formatted_address: null,
    address_source: "NONE",
    place_source: null,
    place_source_id: null,
    confirmed_at: "2026-09-30T00:00:00.000Z",
    created_at: "2026-09-30T00:00:00.000Z",
    updated_at: "2026-09-30T00:00:00.000Z",
    geographies,
    ...over,
  };
}

const hotel = (over: Partial<BusinessFacts> = {}): BusinessFacts => ({
  business_type: "Hotel",
  onboarding_mode: "NEW",
  passport_municipality: null,
  tracked_requirement_ids: new Set(),
  ...over,
});

test("a hotel pinned in Vieques gets the island and tourism rules from the KB, with citations", () => {
  const view = evaluateLocationRequirements(KB, locationAt(18.1263, -65.4401), hotel(), "BUNDLED_KB");
  assert.equal(view.municipality?.name, "Vieques");
  assert.deepEqual([...view.designations].sort(), ["coastal", "island", "tourism"]);
  const ids = view.triggered_by_location.map((r) => r.document_id).sort();
  assert.deepEqual(ids, ["DOC_ISLAND_FERRY_MANIFEST", "DOC_TOURISM_REGISTRATION"]);
  const rules = new Map(KB.rules.map((r) => [r.id, r as typeof r & { citation_url?: string }]));
  for (const r of view.triggered_by_location) {
    assert.equal(r.basis, "municipality_flag");
    // Citations are passed through exactly as the KB rule has them — never invented.
    const kbRule = KB.rules.find(
      (x) => x.rule_type === "municipality_flag" && x.requires_document_id === r.document_id && x.business_type_id === "BT_HOTEL"
    );
    assert.equal(r.citation_url, rules.get(kbRule!.id)?.citation_url ?? null);
  }
  assert.ok(view.triggered_by_location.find((r) => r.document_id === "DOC_TOURISM_REGISTRATION")?.citation_url);
});

test("the same hotel pinned in Guaynabo triggers neither (the pin, not the text, decides)", () => {
  const view = evaluateLocationRequirements(KB, locationAt(18.39123, -66.11784), hotel(), "BUNDLED_KB");
  assert.equal(view.municipality?.name, "Guaynabo");
  assert.deepEqual(view.designations, ["metro"]);
  assert.deepEqual(view.triggered_by_location.map((r) => r.document_id), []);
});

test("site-scoped obligations (premises permits, patente) are listed for the pinned municipio", () => {
  const view = evaluateLocationRequirements(KB, locationAt(18.39123, -66.11784), hotel(), "BUNDLED_KB");
  const patente = view.site_scoped.find((r) => r.document_id === "DOC_PATENTE_MUNICIPAL");
  assert.ok(patente, JSON.stringify(view.site_scoped.map((r) => r.document_id)));
  assert.match(patente.reason, /Municipio de Guaynabo/);
});

test("tracked obligations are marked, and the Passport municipality is compared to the pin", () => {
  const view = evaluateLocationRequirements(
    KB,
    locationAt(18.1263, -65.4401),
    hotel({ passport_municipality: "San Juan", tracked_requirement_ids: new Set(["DOC_TOURISM_REGISTRATION"]) }),
    "BUNDLED_KB"
  );
  assert.equal(view.passport_matches, false);
  assert.equal(view.triggered_by_location.find((r) => r.document_id === "DOC_TOURISM_REGISTRATION")?.tracked, true);
  assert.equal(view.triggered_by_location.find((r) => r.document_id === "DOC_ISLAND_FERRY_MANIFEST")?.tracked, false);
  const same = evaluateLocationRequirements(KB, locationAt(18.1263, -65.4401), hotel({ passport_municipality: "vieques" }), "BUNDLED_KB");
  assert.equal(same.passport_matches, true);
});

test("without an authoritative municipality nothing is evaluated (address text never substitutes)", () => {
  const offshore = locationAt(18.75, -66.5, { municipality: "San Juan", address_source: "USER_PROVIDED" });
  const view = evaluateLocationRequirements(KB, offshore, hotel(), "BUNDLED_KB");
  assert.equal(view.municipality, null);
  assert.deepEqual(view.triggered_by_location, []);
  assert.deepEqual(view.site_scoped, []);
});

test("unknown business type: designations still shown, type-specific rules stay silent", () => {
  const view = evaluateLocationRequirements(KB, locationAt(18.1263, -65.4401), hotel({ business_type: null }), "BUNDLED_KB");
  assert.ok(view.designations.includes("island"));
  assert.deepEqual(view.triggered_by_location, []);
});

test("municipio names compare accent- and suffix-insensitively", () => {
  assert.equal(normalizeMunicipio("Bayamón Municipio"), normalizeMunicipio("bayamon"));
});
