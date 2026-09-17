// Automated tests for the SmartPR rules engine.
// Run: node --experimental-strip-types --test src/app/rulesEngine.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runRulesEngine, type KnowledgeBase, type EngineInput } from "./rulesEngine.ts";

const here = dirname(fileURLToPath(import.meta.url));
const kbDir = join(here, "..", "kb");
const load = (f: string) => JSON.parse(readFileSync(join(kbDir, f), "utf8"));
const KB: KnowledgeBase = {
  municipalities: load("municipalities.json"),
  businessTypes: load("business_types.json"),
  questions: load("questions.json"),
  documents: load("documents.json"),
  rules: load("rules.json"),
};

const run = (businessTypeName: string, answers: Record<string, boolean> = {}, municipalityName = "San Juan") => {
  const input: EngineInput = { municipalityName, businessTypeName, answers };
  return runRulesEngine(KB, input).debug.documentsGenerated;
};

// Validated review 2026-09-16: municipal registration and municipal tax
// compliance are NOT universal requirements — deleted from KB.
const UNIVERSAL = ["DOC_CERT_INCORPORATION", "DOC_EIN", "DOC_MERCHANT_REGISTRATION", "DOC_PATENTE_MUNICIPAL"];
const has = (docs: string[], ...ids: string[]) => ids.every((id) => docs.includes(id));
const lacks = (docs: string[], ...ids: string[]) => ids.every((id) => !docs.includes(id));

test("universal baseline applies to every business", () => {
  const docs = run("Software Company");
  assert.ok(has(docs, ...UNIVERSAL), "missing universal docs: " + docs.join(","));
});

test("Restaurant requires health permit, fire cert, CFPM", () => {
  const docs = run("Restaurant", { Q_PHYSICAL_LOCATION: true });
  assert.ok(has(docs, "DOC_HEALTH_PERMIT", "DOC_FIRE_CERT", "DOC_CFPM", "DOC_PERMISO_UNICO"));
  assert.ok(has(docs, ...UNIVERSAL));
});

test("Restaurant + Alcohol adds alcohol license", () => {
  const docs = run("Restaurant", { Q_ALCOHOL_SOLD: true });
  assert.ok(has(docs, "DOC_ALCOHOL_LICENSE"));
});

test("Restaurant + Outdoor Seating adds outdoor seating authorization", () => {
  const docs = run("Restaurant", { Q_OUTDOOR_SEATING: true });
  assert.ok(has(docs, "DOC_OUTDOOR_SEATING_AUTH"));
});

test("Software Company has baseline but NO health/fire/alcohol", () => {
  const docs = run("Software Company");
  assert.ok(has(docs, ...UNIVERSAL));
  assert.ok(lacks(docs, "DOC_HEALTH_PERMIT", "DOC_FIRE_CERT", "DOC_ALCOHOL_LICENSE", "DOC_CFPM"));
});

test("Medical Office requires professional license + health + biomedical waste (via question)", () => {
  const docs = run("Medical Office", { Q_MEDICAL_WASTE: true });
  // Validated review 2026-09-16: generic medical waste permit deleted;
  // program-specific biomedical waste generator ID via Q_MEDICAL_WASTE.
  assert.ok(has(docs, "DOC_PROFESSIONAL_LICENSE", "DOC_HEALTH_PERMIT", "DOC_BIOMEDICAL_WASTE_GENERATOR_ID"));
});

test("Airbnb requires tourism registration and patente municipal", () => {
  const docs = run("Airbnb / Short-Term Rental");
  assert.ok(has(docs, "DOC_TOURISM_REGISTRATION", "DOC_PATENTE_MUNICIPAL"));
});

// Ordinary short-term rentals have a residential kitchen, not a commercial
// one — Fire Cert / Health Permit must never be manufactured from the
// business type alone (they were previously attached unconditionally; see
// requirementGuidance.ts / jurisdictions/pr/index.ts for the corrected copy).
test("Airbnb does NOT get Fire Cert or Health Permit from business type alone", () => {
  const docs = run("Airbnb / Short-Term Rental");
  assert.ok(lacks(docs, "DOC_FIRE_CERT", "DOC_HEALTH_PERMIT"));
});

test("Airbnb + confirmed short-term rental adds the recurring Room Tax return", () => {
  const docs = run("Airbnb / Short-Term Rental", { Q_SHORT_TERM_RENTAL: true });
  assert.ok(has(docs, "DOC_TOURISM_REGISTRATION", "DOC_ROOM_TAX_RETURN"));
});

test("Room Tax return is NOT asked of unrelated business types", () => {
  const docs = run("Software Company");
  assert.ok(lacks(docs, "DOC_ROOM_TAX_RETURN", "DOC_TOURISM_REGISTRATION"));
});

test("HOA/condo authorization only appears when the user confirms it applies", () => {
  const withHoa = run("Airbnb / Short-Term Rental", { Q_HOA_CONDO: true });
  const withoutHoa = run("Airbnb / Short-Term Rental", { Q_HOA_CONDO: false });
  assert.ok(has(withHoa, "DOC_HOA_AUTHORIZATION"));
  assert.ok(lacks(withoutHoa, "DOC_HOA_AUTHORIZATION"));
});

// Acceptance fixture: Airbnb apartment in Bayamón, stays under 90 days,
// condo/HOA property, no employees — matches the product's own STR fixture.
// SmartPR must generate the STR-specific regulatory domains (Tourism/Room
// Tax, HOA authorization, municipal Patente) and must NEVER manufacture
// restaurant-only requirements (Fire Cert, Health Permit, CFPM, Alcohol
// License, Outdoor Seating) — none of which were triggered by any answer.
test("Bayamón Airbnb apartment acceptance fixture", () => {
  const docs = run("Airbnb / Short-Term Rental", { Q_SHORT_TERM_RENTAL: true, Q_HOA_CONDO: true }, "Bayamón");
  assert.ok(has(docs, "DOC_TOURISM_REGISTRATION", "DOC_ROOM_TAX_RETURN", "DOC_HOA_AUTHORIZATION", "DOC_PATENTE_MUNICIPAL"));
  assert.ok(has(docs, ...UNIVERSAL));
  assert.ok(
    lacks(docs, "DOC_FIRE_CERT", "DOC_HEALTH_PERMIT", "DOC_CFPM", "DOC_ALCOHOL_LICENSE", "DOC_OUTDOOR_SEATING_AUTH"),
    "restaurant-only requirements leaked onto an STR fixture: " + docs.join(",")
  );
});

test("Contractor requires contractor license + workers comp", () => {
  const docs = run("General Contractor");
  assert.ok(has(docs, "DOC_CONTRACTOR_LICENSE", "DOC_WORKERS_COMP"));
});

test("Food Truck requires health permit, fire cert, CFPM", () => {
  const docs = run("Food Truck");
  assert.ok(has(docs, "DOC_HEALTH_PERMIT", "DOC_FIRE_CERT", "DOC_CFPM"));
});

test("Retail (Clothing Store) gets baseline, no health permit by default", () => {
  const docs = run("Clothing Store");
  assert.ok(has(docs, ...UNIVERSAL));
  assert.ok(lacks(docs, "DOC_HEALTH_PERMIT"));
});

test("Salon requires health/sanitary permit", () => {
  const docs = run("Beauty Salon");
  assert.ok(has(docs, "DOC_HEALTH_PERMIT"));
});

test("municipality flag (tourism) + Airbnb yields tourism registration via flag rule", () => {
  const sj = runRulesEngine(KB, { municipalityName: "San Juan", businessTypeName: "Airbnb / Short-Term Rental", answers: {} });
  const flagRule = sj.debug.rulesMatched.find((r) => r.rule_type === "municipality_flag" && r.document_id === "DOC_TOURISM_REGISTRATION");
  assert.ok(flagRule, "expected a tourism municipality_flag rule to match");
});

test("no municipality selected yields no universal municipality docs", () => {
  const docs = runRulesEngine(KB, { municipalityName: null, businessTypeName: "Restaurant", answers: {} }).debug.documentsGenerated;
  assert.ok(lacks(docs, "DOC_PATENTE_MUNICIPAL"));
});

// ============================================================================
// municipality_flag composite coverage (phases 1-3). These lock in the per-BT
// rules so future KB edits can't silently drop a town's requirements.
// ============================================================================

test("Restaurant in Bayamón (metro) does NOT get deleted universal triad/traffic docs", () => {
  const docs = run("Restaurant", {}, "Bayamón");
  // Validated review 2026-09-16: stormwater, waste contract, parking,
  // and traffic study are NOT universal requirements — deleted.
  assert.ok(lacks(docs, "DOC_STORMWATER_PLAN", "DOC_WASTE_COLLECTION_CONTRACT", "DOC_PARKING_COMPLIANCE",
    "metro universal triad deleted: " + docs.join(",")));
  assert.ok(lacks(docs, "DOC_TRAFFIC_IMPACT_STUDY"), "metro+restaurant traffic study deleted");
});

test("Software Company in San Juan stays at universal baseline (no traffic/loading/noise)", () => {
  const docs = run("Software Company");
  // Validated review 2026-09-16: the "metro universal triad" was deleted —
  // office uses do not get stormwater/waste/parking.
  assert.ok(lacks(docs, "DOC_STORMWATER_PLAN", "DOC_WASTE_COLLECTION_CONTRACT", "DOC_PARKING_COMPLIANCE"),
    "deleted metro triad should not fire for office uses");
  assert.ok(lacks(docs, "DOC_TRAFFIC_IMPACT_STUDY", "DOC_LOADING_ZONE_PERMIT", "DOC_NOISE_VARIANCE"),
    "office-only BT must not pick up per-BT metro composites");
});

test("Hotel in San Juan does NOT get deleted historic/capital composites", () => {
  const docs = run("Hotel");
  // Validated review 2026-09-16: facade preservation, historic district
  // review, historic sign variance, and SJ use permit were deleted.
  assert.ok(lacks(docs, "DOC_FACADE_PRESERVATION"), "deleted historic facade preservation should not fire");
  assert.ok(lacks(docs, "DOC_HISTORIC_DISTRICT_REVIEW", "DOC_SIGN_VARIANCE_HISTORIC"),
    "deleted historic composites should not fire");
  assert.ok(lacks(docs, "DOC_SAN_JUAN_USE_PERMIT"), "deleted capital use permit should not fire");
});

test("Restaurant in Ponce does NOT get deleted historic/metro composites", () => {
  const docs = run("Restaurant", {}, "Ponce");
  assert.ok(lacks(docs, "DOC_HISTORIC_DISTRICT_REVIEW", "DOC_SIGN_VARIANCE_HISTORIC"),
    "deleted historic composites should not fire in Ponce");
  assert.ok(lacks(docs, "DOC_PARKING_COMPLIANCE", "DOC_STORMWATER_PLAN"), "deleted metro baseline should not fire in Ponce");
});

test("Art Gallery in San Germán does NOT get deleted historic sign variance", () => {
  const docs = run("Art Gallery", {}, "San Germán");
  assert.ok(lacks(docs, "DOC_SIGN_VARIANCE_HISTORIC", "DOC_FACADE_PRESERVATION"));
  // San Germán is historic but not metro — metro triad should NOT fire.
  assert.ok(lacks(docs, "DOC_STORMWATER_PLAN", "DOC_WASTE_COLLECTION_CONTRACT"),
    "non-metro historic town shouldn't pick up metro baseline");
});

test("Hotel in Vieques gets island ferry manifest + tourism (no deleted waste contract)", () => {
  const docs = run("Hotel", {}, "Vieques");
  assert.ok(has(docs, "DOC_ISLAND_FERRY_MANIFEST"), "island+hotel ferry manifest missing");
  // Validated review 2026-09-16: waste collection contract deleted.
  assert.ok(lacks(docs, "DOC_WASTE_COLLECTION_CONTRACT"), "deleted waste contract should not fire");
  assert.ok(has(docs, "DOC_TOURISM_REGISTRATION"), "tourism+hotel registration missing");
});

test("Restaurant in Culebra picks up island ferry logistics (no deleted waste contract)", () => {
  const docs = run("Restaurant", {}, "Culebra");
  assert.ok(has(docs, "DOC_ISLAND_FERRY_MANIFEST"), "island+restaurant ferry manifest missing");
  assert.ok(lacks(docs, "DOC_WASTE_COLLECTION_CONTRACT"));
});

test("Architecture Firm in San Juan does NOT get deleted traffic/loading docs", () => {
  const docs = run("Architecture Firm");
  assert.ok(lacks(docs, "DOC_TRAFFIC_IMPACT_STUDY", "DOC_LOADING_ZONE_PERMIT"),
    "deleted architecture firm metro docs should not fire");
});

test("Tutoring Center in metro town does NOT get deleted traffic study", () => {
  const docs = run("Tutoring Center", {}, "Caguas");
  assert.ok(lacks(docs, "DOC_TRAFFIC_IMPACT_STUDY"),
    "deleted tutoring center traffic study should not fire");
});

test("Restaurant in Adjuntas (no flags) gets none of the flag-driven docs", () => {
  const docs = run("Restaurant", {}, "Adjuntas");
  assert.ok(lacks(docs,
    "DOC_TRAFFIC_IMPACT_STUDY", "DOC_LOADING_ZONE_PERMIT", "DOC_NOISE_VARIANCE",
    "DOC_STORMWATER_PLAN", "DOC_HISTORIC_DISTRICT_REVIEW", "DOC_ISLAND_FERRY_MANIFEST",
    "DOC_FACADE_PRESERVATION", "DOC_SAN_JUAN_USE_PERMIT"),
    "Adjuntas has no flags — no flag-driven docs should fire");
});

// ----- Phase 4: popular non-metro beach + north-coast + SJ-corridor coverage -----

test("Hotel in Fajardo (tourism+coastal) does NOT get deleted generic env permit", () => {
  const docs = run("Hotel", {}, "Fajardo");
  // Validated review 2026-09-16: generic environmental permit rejected;
  // use program-specific obligations instead.
  assert.ok(lacks(docs, "DOC_ENVIRONMENTAL_PERMIT"), "deleted generic env permit should not fire");
  assert.ok(has(docs, "DOC_TOURISM_REGISTRATION"), "tourism+hotel registration missing");
});

test("Gift Shop in Fajardo (tourism+coastal) does NOT get deleted docs", () => {
  const docs = run("Gift Shop", {}, "Fajardo");
  // Validated review 2026-09-16: non-lodging businesses do not get tourism
  // registration; generic env permit deleted.
  assert.ok(lacks(docs, "DOC_TOURISM_REGISTRATION"),
    "non-lodging tourism registration should not fire");
  assert.ok(lacks(docs, "DOC_ENVIRONMENTAL_PERMIT"),
    "deleted generic env permit should not fire");
  // DOC_SIGN_PERMIT via tourism flag (RULE_0535) is a separate scoped rule;
  // not asserting here.
});

test("Food Truck in Aguadilla (tourism+coastal) does NOT get tourism reg (lodging-only)", () => {
  const docs = run("Food Truck", {}, "Aguadilla");
  // Validated review 2026-09-16: Tourism Registration is lodging-only;
  // non-lodging businesses (food trucks) do not register.
  assert.ok(lacks(docs, "DOC_TOURISM_REGISTRATION"));
});

test("Arecibo gains tourism flag → Hotel gets tourism registration", () => {
  const docs = run("Hotel", {}, "Arecibo");
  assert.ok(has(docs, "DOC_TOURISM_REGISTRATION"),
    "Arecibo Observatory / karst eco-tourism: hotel should register with Compañía de Turismo");
});

test("Toa Alta gains metro flag → Restaurant does NOT get deleted metro baseline", () => {
  const docs = run("Restaurant", {}, "Toa Alta");
  // Validated review 2026-09-16: metro baseline docs deleted.
  assert.ok(lacks(docs, "DOC_STORMWATER_PLAN", "DOC_WASTE_COLLECTION_CONTRACT",
    "DOC_PARKING_COMPLIANCE", "DOC_TRAFFIC_IMPACT_STUDY"),
    "deleted metro composites should not fire even though Toa Alta is metro");
});

test("Trujillo Alto (metro) — Dental Office does NOT get deleted metro/env docs", () => {
  const docs = run("Dental Office", {}, "Trujillo Alto");
  assert.ok(lacks(docs, "DOC_STORMWATER_PLAN", "DOC_TRAFFIC_IMPACT_STUDY",
    "DOC_ENVIRONMENTAL_PERMIT"));
});

// ----- Phase 5: industrial_port flag (Ponce/Cataño/Guayanilla/Salinas/Yabucoa) ---

test("Chemical Mfg in Ponce (industrial_port) gets all heavy-industry docs", () => {
  const docs = run("Chemical Manufacturing", {}, "Ponce");
  assert.ok(has(docs,
    "DOC_NPDES_INDUSTRIAL", "DOC_HAZMAT_HANDLER", "DOC_AIR_EMISSION_PERMIT"),
    "industrial_port + chem mfg should fire NPDES + RCRA + Title V");
});

test("Pharmaceutical Mfg in Guayanilla gets the full industrial heavy triad", () => {
  const docs = run("Pharmaceutical Manufacturing", {}, "Guayanilla");
  assert.ok(has(docs,
    "DOC_NPDES_INDUSTRIAL", "DOC_HAZMAT_HANDLER", "DOC_AIR_EMISSION_PERMIT"));
});

test("Freight Forwarding in Cataño gets port facility permit", () => {
  const docs = run("Freight Forwarding Company", {}, "Cataño");
  assert.ok(has(docs, "DOC_PORT_FACILITY_PERMIT"));
});

test("Body Shop in Salinas picks up RCRA hazmat handler (solvent / paint waste)", () => {
  const docs = run("Body Shop", {}, "Salinas");
  assert.ok(has(docs, "DOC_HAZMAT_HANDLER"));
});

test("Restaurant in Ponce does NOT pick up industrial-port docs", () => {
  // Negative control: industrial_port composites are per-BT, not universal —
  // a restaurant in an industrial-port town must NOT get NPDES/Title V/etc.
  const docs = run("Restaurant", {}, "Ponce");
  assert.ok(lacks(docs,
    "DOC_NPDES_INDUSTRIAL", "DOC_HAZMAT_HANDLER",
    "DOC_AIR_EMISSION_PERMIT", "DOC_PORT_FACILITY_PERMIT"),
    "non-industrial BT in industrial_port town must not pick up heavy docs");
});

test("Chemical Mfg in San Juan does NOT get industrial-port docs (SJ lacks flag)", () => {
  // Negative control: the heavy-industry rules only fire on the industrial_port
  // flag, NOT just because a chem facility is in a metro town.
  const docs = run("Chemical Manufacturing", {}, "San Juan");
  assert.ok(lacks(docs,
    "DOC_NPDES_INDUSTRIAL", "DOC_AIR_EMISSION_PERMIT", "DOC_PORT_FACILITY_PERMIT"),
    "industrial_port composites must not fire in San Juan");
});

// ----- Phase 6: airport_host flag (Carolina LMM, Aguadilla BQN, Ponce Mercedita) ---

test("Freight Forwarding in Carolina (LMM) gets CBP bond + TSA known shipper", () => {
  const docs = run("Freight Forwarding Company", {}, "Carolina");
  assert.ok(has(docs, "DOC_CUSTOMS_BROKER_BOND", "DOC_TSA_KNOWN_SHIPPER"),
    "airport_host + freight forwarder federal compliance missing");
});

test("Car Rental in Aguadilla (BQN) gets airport concession agreement", () => {
  const docs = run("Car Rental Business", {}, "Aguadilla");
  assert.ok(has(docs, "DOC_AIRPORT_CONCESSION"),
    "airport_host + car rental concession missing");
});

test("Import/Export in Ponce (Mercedita) gets CBP customs broker bond", () => {
  const docs = run("Import / Export Business", {}, "Ponce");
  assert.ok(has(docs, "DOC_CUSTOMS_BROKER_BOND"));
});

test("Restaurant in Carolina does NOT pick up airport-host federal docs", () => {
  // Negative control: airport_host composites are per-BT — restaurants don't
  // need a customs bond just because they're in an airport-host town.
  const docs = run("Restaurant", {}, "Carolina");
  assert.ok(lacks(docs,
    "DOC_CUSTOMS_BROKER_BOND", "DOC_TSA_KNOWN_SHIPPER", "DOC_AIRPORT_CONCESSION"),
    "non-aviation BT in airport_host town must not pick up federal aviation docs");
});

test("Freight Forwarding in San Juan (no airport flag) gets no airport docs", () => {
  // Negative control: the rules fire on the flag, not on proximity guesses.
  const docs = run("Freight Forwarding Company");  // default municipality = San Juan
  assert.ok(lacks(docs, "DOC_CUSTOMS_BROKER_BOND", "DOC_TSA_KNOWN_SHIPPER", "DOC_AIRPORT_CONCESSION"),
    "airport_host composites must NOT fire in San Juan (no flag)");
});
