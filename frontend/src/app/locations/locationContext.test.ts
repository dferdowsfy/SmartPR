// Passport location → requirements-engine context.
// Run: npx tsx --test src/app/locations/locationContext.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runRulesEngine, type EngineInput, type KnowledgeBase, type KBRule } from "../rulesEngine.ts";
import type { LocationGeography, PassportLocation } from "./geo.ts";
import {
  buildLocationContext,
  factToken,
  locationEngineFacts,
  locationGraphEdges,
  withLocationContext,
} from "./locationContext.ts";

const here = dirname(fileURLToPath(import.meta.url));
const load = (f: string) => JSON.parse(readFileSync(join(here, "..", "..", "kb", f), "utf8"));
const KB: KnowledgeBase = {
  municipalities: load("municipalities.json"),
  businessTypes: load("business_types.json"),
  questions: load("questions.json"),
  documents: load("documents.json"),
  rules: load("rules.json"),
};

const LOCATION: PassportLocation = {
  id: "8f7c1a52-5a1e-4a4e-9d55-3f1f3d0c9b11",
  business_id: "0b2d7d8e-2f4b-4c5a-8c11-6b8a4c1f2e33",
  name: "Guaynabo Manufacturing Facility",
  is_primary: true,
  latitude: 18.39123,
  longitude: -66.11784,
  coordinate_system: "EPSG:4326",
  coordinate_source: "MAP_PIN",
  address_line_1: "123 Example Street",
  address_line_2: null,
  city: "Guaynabo",
  municipality: "Guaynabo",
  state_or_region: "PR",
  postal_code: "00968",
  country_code: "PR",
  formatted_address: "123 Example Street, Guaynabo, PR 00968",
  address_source: "PROVIDER_REVERSE_GEOCODE",
  place_source: "nominatim",
  place_source_id: "way/1",
  confirmed_at: "2026-09-30T12:00:00.000Z",
  created_at: "2026-09-30T12:00:00.000Z",
  updated_at: "2026-09-30T12:00:00.000Z",
};

const geo = (over: Partial<LocationGeography>): LocationGeography => ({
  id: over.id ?? `g-${Math.random()}`,
  location_id: LOCATION.id,
  geography_type: "flood_zone",
  geography_code: null,
  geography_name: null,
  determination_method: "SPATIAL_INTERSECTION",
  source_id: "test-dataset",
  source_name: "Test dataset",
  source_version: "2026-01",
  source_url: null,
  determined_at: "2026-09-30T12:00:00.000Z",
  metadata: {},
  ...over,
});

test("provider-derived address municipality is context metadata, never an engine fact", () => {
  const ctx = buildLocationContext(LOCATION, []);
  assert.equal(ctx.address.municipality, "Guaynabo");
  assert.equal(ctx.address.source, "PROVIDER_REVERSE_GEOCODE");
  assert.equal(ctx.municipality, null, "no authoritative municipality exists yet");
  const { projectFacts } = locationEngineFacts(ctx);
  assert.equal(projectFacts["location.municipality"], undefined);
  assert.deepEqual(Object.keys(projectFacts).sort(), [
    "location.id",
    "location.latitude",
    "location.longitude",
    "location.within_puerto_rico_bounds",
  ]);
  assert.equal(projectFacts["location.latitude"], 18.39123);
  assert.equal(projectFacts["location.within_puerto_rico_bounds"], true);
});

test("authoritative geographies become namespaced facts; provider guesses do not", () => {
  const ctx = buildLocationContext(LOCATION, [
    geo({ geography_type: "municipality", geography_code: "061", geography_name: "Guaynabo" }),
    geo({ geography_type: "flood_zone", geography_code: "AE", geography_name: "Zone AE" }),
    geo({ geography_type: "barrio", geography_name: "Pueblo Viejo", determination_method: "PROVIDER_GEOCODE" }),
    geo({ geography_type: "flood_zone", geography_code: "X", location_id: "some-other-location" }),
  ]);
  assert.equal(ctx.municipality?.name, "Guaynabo");
  const { projectFacts, factMeta } = locationEngineFacts(ctx);
  assert.equal(projectFacts["location.municipality"], "061");
  assert.equal(projectFacts["location.municipality.guaynabo"], true);
  assert.equal(projectFacts["location.flood_zone"], "AE");
  assert.equal(projectFacts["location.flood_zone.ae"], true);
  assert.equal(projectFacts["location.flood_zone.x"], undefined, "another location's geography leaked");
  assert.equal(projectFacts["location.barrio"], undefined, "a geocoder guess became a fact");
  for (const meta of Object.values(factMeta)) {
    assert.equal(meta.source, "location");
    assert.equal(meta.scope, "property");
    assert.equal(meta.locationId, LOCATION.id);
  }
});

test("fact tokens are stable across accents and punctuation", () => {
  assert.equal(factToken("Bayamón"), "bayamon");
  assert.equal(factToken("Zone A-E (1%)"), "zone_a_e_1");
});

// A rule shaped like the future geographic rules. It exists only in this
// test's KB copy — the map/location code carries no permitting rules.
const FLOOD_RULE: KBRule = {
  id: "TEST_RULE_FLOOD_AE",
  rule_type: "project_fact",
  business_type_id: null,
  question_id: null,
  fact_key: "location.flood_zone.ae",
  expected_answer: "true",
  municipality_flag: null,
  requires_document_id: "TEST_DOC_FLOOD",
} as KBRule;
const KB_WITH_FLOOD: KnowledgeBase = {
  ...KB,
  documents: [...KB.documents, { id: "TEST_DOC_FLOOD", name: "Test flood document", agency: "Test", category: "test" }],
  rules: [...KB.rules, FLOOD_RULE],
};

const floodCtx = buildLocationContext(LOCATION, [geo({ geography_type: "flood_zone", geography_code: "AE" })]);
const docs = (kb: KnowledgeBase, input: EngineInput) => runRulesEngine(kb, input).debug.documentsGenerated;

test("location context reaches the rules engine and a project_fact rule can use it", () => {
  const base: EngineInput = { municipalityName: "Guaynabo", businessTypeName: "Restaurant", answers: {} };
  assert.ok(!docs(KB_WITH_FLOOD, base).includes("TEST_DOC_FLOOD"));
  const withLoc = withLocationContext(base, floodCtx);
  assert.equal(withLoc.locationId, LOCATION.id);
  assert.ok(docs(KB_WITH_FLOOD, withLoc).includes("TEST_DOC_FLOOD"));
  const req = runRulesEngine(KB_WITH_FLOOD, withLoc).requirements.find((r) => r.document_id === "TEST_DOC_FLOOD");
  assert.equal(req?.triggerFactProvenance?.[0].source, "location");
  assert.equal(req?.triggerFactProvenance?.[0].locationId, LOCATION.id);
});

test("strict mode admits location facts only for the location bound to the evaluation", () => {
  const strict: EngineInput = {
    municipalityName: "Guaynabo",
    businessTypeName: "Restaurant",
    answers: {},
    sessionId: "session-1",
  };
  const bound = withLocationContext(strict, floodCtx);
  assert.ok(docs(KB_WITH_FLOOD, bound).includes("TEST_DOC_FLOOD"));

  // Same facts, but the evaluation is bound to a different location: blocked, and recorded.
  const mismatched = { ...bound, locationId: "another-location" };
  const result = runRulesEngine(KB_WITH_FLOOD, mismatched);
  assert.ok(!result.debug.documentsGenerated.includes("TEST_DOC_FLOOD"));
  assert.ok(result.debug.provenanceBlocked?.some((b) => b.fact_key === "location.flood_zone.ae"));

  // No location bound at all: blocked (fail closed).
  const unbound = { ...bound, locationId: null };
  assert.ok(!docs(KB_WITH_FLOOD, unbound).includes("TEST_DOC_FLOOD"));
});

test("the production KB has no location rules yet, so adding location context changes no requirement", () => {
  for (const businessTypeName of ["Restaurant", "Software Company", "Construction Contractor", "Retail Store"]) {
    const base: EngineInput = { municipalityName: "Guaynabo", businessTypeName, answers: { Q_PHYSICAL_LOCATION: true } };
    const ctx = buildLocationContext(LOCATION, [geo({ geography_type: "flood_zone", geography_code: "AE" })]);
    assert.deepEqual(docs(KB, withLocationContext(base, ctx)), docs(KB, base), businessTypeName);
  }
});

test("intake project facts win over location facts on key collision", () => {
  const input = withLocationContext(
    { answers: {}, projectFacts: { "location.latitude": 1 } },
    buildLocationContext(LOCATION, [])
  );
  assert.equal(input.projectFacts?.["location.latitude"], 1);
});

test("graph edges carry provenance and only come from authoritative determinations", () => {
  const ctx = buildLocationContext(LOCATION, [
    geo({ geography_type: "municipality", geography_name: "Guaynabo", source_id: "census-2020" }),
    geo({ geography_type: "flood_zone", geography_code: "AE", source_id: "fema-nfhl" }),
    geo({ geography_type: "barrio", geography_name: "Guess", determination_method: "PROVIDER_GEOCODE" }),
  ]);
  const edges = locationGraphEdges(ctx);
  assert.deepEqual(
    edges.map((e) => `${e.from.type}-${e.relation}->${e.to.id}`),
    [
      `Business-located_at->${LOCATION.id}`,
      "Location-within->municipality:census-2020:Guaynabo",
      "Location-intersects->flood_zone:fema-nfhl:AE",
    ]
  );
  assert.equal(edges[2].evidence?.source_version, "2026-01");
});
