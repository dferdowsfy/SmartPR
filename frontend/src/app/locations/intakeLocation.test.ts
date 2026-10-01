// Intake location step: location-need detection + site → engine facts.
// Run: npx tsx --test src/app/locations/intakeLocation.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runRulesEngine, type KnowledgeBase } from "../rulesEngine.ts";
import {
  detectLocationNeed,
  locationDependentRules,
  mentionedAddress,
  mentionedMunicipality,
  restoreIntakeSite,
  siteEngineFacts,
  siteLabel,
  siteLocationId,
  type IntakeSite,
  type LocationNeedInput,
} from "./intakeLocation.ts";

const here = dirname(fileURLToPath(import.meta.url));
const load = (f: string) => JSON.parse(readFileSync(join(here, "..", "..", "kb", f), "utf8"));
const KB: KnowledgeBase = {
  municipalities: load("municipalities.json"),
  businessTypes: load("business_types.json"),
  questions: load("questions.json"),
  documents: load("documents.json"),
  rules: load("rules.json"),
};
const NAMES = KB.municipalities.map((m) => m.name);
const bt = (name: string) => KB.businessTypes.find((b) => b.name === name)?.id ?? null;
const base = (over: Partial<LocationNeedInput> = {}): LocationNeedInput => ({ municipalityNames: NAMES, rules: KB.rules, ...over });

const GUAYNABO_SITE: IntakeSite = {
  latitude: 18.3574,
  longitude: -66.111,
  coordinate_source: "MAP_PIN",
  formatted_address: "Calle José Martí, Guaynabo, PR 00969",
  municipality: { name: "Guaynabo", fips: "061" },
  barrio: { name: "Pueblo", geoid: "7206131000" },
  near_boundary: false,
  designations: ["metro"],
  boundary_source: { id: "census-tiger-2024", name: "TIGER/Line", version: "2024", url: "https://www.census.gov" },
  location_id: null,
  confirmed_at: "2026-09-30T22:00:00.000Z",
};

// --- mention detection ------------------------------------------------------

test("municipio mentions: accent-insensitive, whole words, longest name first", () => {
  assert.equal(mentionedMunicipality("Quiero abrir un taller en Guaynabo", NAMES), "Guaynabo");
  assert.equal(mentionedMunicipality("A cafe in bayamon near the plaza", NAMES), "Bayamón");
  assert.equal(mentionedMunicipality("warehouse in San Juan", NAMES), "San Juan");
  assert.equal(mentionedMunicipality("office in Sabana Grande", NAMES), "Sabana Grande");
  assert.equal(mentionedMunicipality("an online store selling shirts", NAMES), null);
  // Substrings of other words never match.
  assert.equal(mentionedMunicipality("Guaynabonian food", NAMES), null);
});

test("address mentions (PR conventions)", () => {
  assert.match(mentionedAddress("Solar farm at Carr. 2 km 14.2 in Manatí") ?? "", /Carr\. 2 km 14\.2/);
  assert.match(mentionedAddress("Local en Calle Luna 12, Viejo San Juan") ?? "", /^Calle Luna 12/);
  assert.match(mentionedAddress("site on PR-165 km 3") ?? "", /PR-165 km 3/);
  assert.match(mentionedAddress("our shop at 123 Main Street") ?? "", /123 Main Street/);
  assert.equal(mentionedAddress("I sell handmade soap online"), null);
});

// --- need detection ---------------------------------------------------------

test("prompt that names Guaynabo needs a site and prefills Guaynabo", () => {
  const need = detectLocationNeed(base({ description: "I want to open an auto repair shop in Guaynabo", businessTypeId: bt("Auto Repair Shop") }));
  assert.equal(need.needed, true);
  assert.ok(need.reasons.includes("municipality_mentioned"));
  assert.equal(need.prefill.municipality, "Guaynabo");
  assert.equal(need.prefill.query, "Guaynabo, Puerto Rico");
});

test("an address in the prompt prefills the search with address + municipio", () => {
  const need = detectLocationNeed(base({ description: "Restaurant at Calle Loíza 1800 in San Juan" }));
  assert.ok(need.reasons.includes("address_mentioned"));
  assert.equal(need.prefill.address, "Calle Loíza 1800");
  assert.equal(need.prefill.municipality, "San Juan");
  assert.equal(need.prefill.query, "Calle Loíza 1800, San Juan");
});

test("physical site, construction, energy, food service and property projects need a site", () => {
  assert.ok(detectLocationNeed(base({ locationType: "Commercial Storefront" })).reasons.includes("physical_site"));
  assert.ok(detectLocationNeed(base({ customersVisit: true })).reasons.includes("physical_site"));
  assert.ok(detectLocationNeed(base({ projectFacts: { renovation: true } })).reasons.includes("construction"));
  assert.ok(detectLocationNeed(base({ scenario: { projectTypes: ["new_construction"] } })).reasons.includes("construction"));
  assert.ok(detectLocationNeed(base({ energyProject: true })).reasons.includes("energy_project"));
  assert.ok(detectLocationNeed(base({ projectFacts: { generation_capacity_kw: 250 } })).reasons.includes("energy_project"));
  assert.ok(detectLocationNeed(base({ foodPreparedOrSold: true, locationType: "Restaurant" })).reasons.includes("food_service"));
  assert.ok(detectLocationNeed(base({ projectIntent: "project_only" })).reasons.includes("property_project"));
});

test("location-dependent rules pending when no municipio is known", () => {
  const need = detectLocationNeed(base({ businessTypeId: bt("Auto Repair Shop"), projectIntent: "new_business" }));
  assert.equal(need.needed, true);
  assert.ok(need.reasons.includes("location_rules_pending"));
  assert.ok(need.locationRuleCount > 0);
  // Once a municipio is set, the rules are no longer pending (but other reasons may remain).
  const withMuni = detectLocationNeed(base({ businessTypeId: bt("Auto Repair Shop"), projectIntent: "new_business", municipality: "Guaynabo" }));
  assert.ok(!withMuni.reasons.includes("location_rules_pending"));
  assert.equal(withMuni.prefill.municipality, "Guaynabo");
});

test("location-dependent rules: municipio baseline, business-type flags, location.* facts", () => {
  const auto = bt("Auto Repair Shop");
  const deps = locationDependentRules(KB.rules, auto);
  assert.ok(deps.some((r) => r.rule_type === "municipality"));
  assert.ok(deps.some((r) => r.rule_type === "municipality_flag" && r.business_type_id === auto));
  assert.ok(!deps.some((r) => r.rule_type === "municipality_flag" && r.business_type_id && r.business_type_id !== auto));
  const synthetic = locationDependentRules([{ rule_type: "project_fact", business_type_id: null, fact_key: "location.flood_zone.ae" }, { rule_type: "project_fact", business_type_id: null, fact_key: "renovation" }], null);
  assert.equal(synthetic.length, 1);
});

test("nothing site-like: no card (empty intake, online-only business)", () => {
  assert.equal(detectLocationNeed(base()).needed, false);
  const online = detectLocationNeed(base({ locationType: "Online Only", description: "an online store based in Guaynabo", businessTypeId: bt("E-commerce Business") }));
  assert.equal(online.needed, false, online.reasons.join(","));
  // …unless the request is about a physical project.
  assert.equal(detectLocationNeed(base({ locationType: "Online Only", projectFacts: { renovation: true } })).needed, true);
});

// --- site → engine facts ----------------------------------------------------

test("site engine facts mirror Passport location facts, bound to the site id", () => {
  const facts = siteEngineFacts(GUAYNABO_SITE, "biz-1");
  assert.equal(facts.locationId, siteLocationId(GUAYNABO_SITE));
  assert.equal(facts.projectFacts["location.latitude"], 18.3574);
  assert.equal(facts.projectFacts["location.municipality"], "061");
  assert.equal(facts.projectFacts["location.municipality.guaynabo"], true);
  assert.equal(facts.projectFacts["location.barrio.pueblo"], true);
  assert.equal(facts.projectFacts["location.designation.metro"], true);
  for (const meta of Object.values(facts.factMeta)) {
    assert.equal(meta.source, "location");
    assert.equal(meta.locationId, facts.locationId);
  }
  assert.equal(siteEngineFacts({ ...GUAYNABO_SITE, location_id: "loc-9" }).locationId, "loc-9");
});

test("a location.* project rule fires from a confirmed intake site (and only for that site)", () => {
  const rule = {
    id: "RULE_TEST_LOC",
    rule_type: "project_fact" as const,
    business_type_id: null,
    question_id: null,
    expected_answer: "true",
    municipality_flag: null,
    fact_key: "location.municipality.guaynabo",
    requires_document_id: KB.documents[0].id,
  };
  const kb: KnowledgeBase = { ...KB, rules: [rule as never] };
  const facts = siteEngineFacts(GUAYNABO_SITE);
  const input = {
    municipalityName: "Guaynabo",
    businessTypeName: null,
    answers: {},
    businessStatus: "project_only" as const,
    sessionId: "session-1",
    locationId: facts.locationId,
    projectFacts: facts.projectFacts,
    factMeta: facts.factMeta,
  };
  const fired = runRulesEngine(kb, input as never).requirements.map((r) => r.document_id);
  assert.ok(fired.includes(KB.documents[0].id), "rule fires for the bound site");
  const other = runRulesEngine(kb, { ...input, locationId: "some-other-site" } as never).requirements.map((r) => r.document_id);
  assert.ok(!other.includes(KB.documents[0].id), "facts bound to another site are not admitted");
});

test("labels and restore", () => {
  assert.equal(siteLabel(GUAYNABO_SITE), "Calle José Martí, Guaynabo, PR 00969");
  assert.equal(siteLabel({ ...GUAYNABO_SITE, formatted_address: "Calle Luna 5" }), "Calle Luna 5, Guaynabo");
  assert.match(siteLabel({ ...GUAYNABO_SITE, formatted_address: null }), /^Pueblo, Guaynabo \(18\.35740, -66\.11100\)$/);
  assert.deepEqual(restoreIntakeSite(JSON.parse(JSON.stringify(GUAYNABO_SITE))), GUAYNABO_SITE);
  assert.equal(restoreIntakeSite({ latitude: 200, longitude: 0, municipality: { name: "X" } }), null);
  assert.equal(restoreIntakeSite({ latitude: 18, longitude: -66 }), null);
  assert.equal(restoreIntakeSite(null), null);
});

test("another evaluator waiting on the site's location (scenario graph) makes the card show", () => {
  const need = detectLocationNeed(base({ municipality: "Guaynabo", locationFactsPending: true }));
  assert.equal(need.needed, true);
  assert.ok(need.reasons.includes("location_rules_pending"));
});
