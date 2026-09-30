// Passport Locations — coordinate validation and request parsing.
// Run: npx tsx --test src/app/locations/geo.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  COORDINATE_DECIMALS,
  currentGeography,
  formatCoordinate,
  isWithinPuertoRico,
  parseLocationInput,
  roundCoordinate,
  validateCoordinates,
  type LocationGeography,
} from "./geo.ts";

test("valid Puerto Rico coordinates are accepted and rounded to stored precision", () => {
  const v = validateCoordinates(18.391230123456, -66.11784049999);
  assert.equal(v.ok, true);
  if (!v.ok) return;
  assert.equal(v.latitude, 18.3912301);
  assert.equal(v.longitude, -66.1178405);
  assert.equal(COORDINATE_DECIMALS, 7);
});

test("manual entry strings are accepted when they are plain decimals", () => {
  const v = validateCoordinates(" 18.39123 ", "-66.11784");
  assert.deepEqual(v, { ok: true, latitude: 18.39123, longitude: -66.11784 });
});

test("invalid latitude is rejected", () => {
  for (const bad of [90.0001, -90.5, 1000]) {
    const v = validateCoordinates(bad, -66.1);
    assert.equal(v.ok, false);
    if (!v.ok) assert.deepEqual(v.errors, ["latitude_out_of_range"]);
  }
  for (const bad of ["18.4abc", "0x12", "1e2", NaN, Infinity, {}, true]) {
    const v = validateCoordinates(bad, -66.1);
    assert.equal(v.ok, false, `accepted ${String(bad)}`);
    if (!v.ok) assert.deepEqual(v.errors, ["latitude_invalid"]);
  }
  const missing = validateCoordinates("", -66.1);
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.deepEqual(missing.errors, ["latitude_required"]);
});

test("invalid longitude is rejected", () => {
  for (const bad of [180.01, -181, 360]) {
    const v = validateCoordinates(18.4, bad);
    assert.equal(v.ok, false);
    if (!v.ok) assert.deepEqual(v.errors, ["longitude_out_of_range"]);
  }
  const junk = validateCoordinates(18.4, "west");
  assert.equal(junk.ok, false);
  if (!junk.ok) assert.deepEqual(junk.errors, ["longitude_invalid"]);
  const missing = validateCoordinates(18.4, null);
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.deepEqual(missing.errors, ["longitude_required"]);
});

test("boundary values are valid (the database is not Puerto-Rico-only)", () => {
  assert.equal(validateCoordinates(90, 180).ok, true);
  assert.equal(validateCoordinates(-90, -180).ok, true);
  assert.equal(validateCoordinates(40.7128, -74.006).ok, true);
});

test("Puerto Rico bounds cover the main island and municipal islands, and flag the rest", () => {
  assert.ok(isWithinPuertoRico(18.4655, -66.1057)); // San Juan
  assert.ok(isWithinPuertoRico(18.0111, -66.6141)); // Ponce
  assert.ok(isWithinPuertoRico(18.1263, -65.4401)); // Vieques
  assert.ok(isWithinPuertoRico(18.3031, -65.3007)); // Culebra
  assert.ok(isWithinPuertoRico(18.0833, -67.9));    // Mona
  assert.ok(!isWithinPuertoRico(18.4861, -69.9312)); // Santo Domingo
  assert.ok(!isWithinPuertoRico(40.7128, -74.006));  // New York
});

test("formatting never renders -0 and keeps fixed precision", () => {
  assert.equal(roundCoordinate(-0.00000001), 0);
  assert.equal(formatCoordinate(18.39123), "18.391230");
  assert.equal(formatCoordinate(-66.11784, 7), "-66.1178400");
});

test("parseLocationInput ignores tenant/ownership fields supplied by the browser", () => {
  const r = parseLocationInput({
    latitude: 18.39123,
    longitude: -66.11784,
    business_id: "00000000-0000-4000-8000-000000000000",
    workspace_id: "00000000-0000-4000-8000-000000000001",
    created_by_user_id: "attacker",
    id: "chosen-id",
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  for (const key of ["business_id", "workspace_id", "created_by_user_id", "id"]) {
    assert.equal(key in r.value, false, `${key} leaked into the write payload`);
  }
});

test("coordinates alone are a complete location (reverse-geocoding failure never blocks saving)", () => {
  const r = parseLocationInput({ latitude: 18.2, longitude: -66.5 });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.address_source, "NONE");
  assert.equal(r.value.coordinate_source, "MAP_PIN");
  assert.equal(r.value.formatted_address, null);
});

test("address provenance is normalized: text without a source is user-provided; a source without text is dropped", () => {
  const typed = parseLocationInput({ latitude: 18.2, longitude: -66.5, formatted_address: "Carr. 2 km 14.2" });
  assert.equal(typed.ok && typed.value.address_source, "USER_PROVIDED");
  const empty = parseLocationInput({ latitude: 18.2, longitude: -66.5, address_source: "PROVIDER_REVERSE_GEOCODE" });
  assert.equal(empty.ok && empty.value.address_source, "NONE");
  const provider = parseLocationInput({
    latitude: 18.2,
    longitude: -66.5,
    formatted_address: "Guaynabo, PR",
    municipality: "Guaynabo",
    address_source: "PROVIDER_REVERSE_GEOCODE",
    country_code: "pr",
  });
  assert.equal(provider.ok, true);
  if (provider.ok) {
    assert.equal(provider.value.address_source, "PROVIDER_REVERSE_GEOCODE");
    assert.equal(provider.value.country_code, "PR");
  }
});

test("parseLocationInput rejects bad enums, types and bodies with readable error codes", () => {
  const r = parseLocationInput({
    latitude: 91,
    longitude: -66,
    coordinate_source: "GUESS",
    address_source: "LLM",
    is_primary: "yes",
    name: 42,
    country_code: "PRI",
  });
  assert.equal(r.ok, false);
  if (r.ok) return;
  for (const code of [
    "latitude_out_of_range",
    "invalid_coordinate_source",
    "invalid_address_source",
    "invalid_is_primary",
    "invalid_name",
    "invalid_country_code",
  ]) {
    assert.ok(r.errors.includes(code as never), `missing ${code}: ${r.errors.join(",")}`);
  }
  assert.deepEqual(parseLocationInput(null), { ok: false, errors: ["invalid_body"] });
  assert.deepEqual(parseLocationInput([1, 2]), { ok: false, errors: ["invalid_body"] });
});

test("text fields are trimmed, control characters stripped, and capped", () => {
  const r = parseLocationInput({ latitude: 18.2, longitude: -66.5, name: "  Main\n\tOffice  ", address_line_1: "x".repeat(500) });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.name, "Main Office");
  assert.equal(r.value.address_line_1?.length, 200);
});

test("currentGeography prefers spatial determinations over provider text", () => {
  const base = {
    location_id: "L",
    geography_type: "municipality",
    geography_code: null,
    source_name: null,
    source_version: null,
    source_url: null,
    metadata: {},
  };
  const geos: LocationGeography[] = [
    { ...base, id: "1", geography_name: "Guaynabo?", determination_method: "PROVIDER_GEOCODE", source_id: "nominatim", determined_at: "2026-09-30T00:00:00Z" },
    { ...base, id: "2", geography_name: "Guaynabo", determination_method: "SPATIAL_INTERSECTION", source_id: "census", determined_at: "2026-01-01T00:00:00Z" },
  ];
  assert.equal(currentGeography(geos, "municipality")?.id, "2");
  assert.equal(currentGeography(geos, "barrio"), null);
});
