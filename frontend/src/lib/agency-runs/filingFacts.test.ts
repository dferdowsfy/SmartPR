import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { interpretScenario } from "../../app/ai/intake/scenario/interpret.ts";
import { applyScenarioAnswer } from "../../app/ai/intake/scenario/graph.ts";
import { scenarioToProjectContext } from "../../app/ai/intake/scenario/adapter.ts";
import { validateProjectContext } from "../../app/ai/intake/projectContext.ts";
import { projectFilingFacts, projectFilingFactsFromState, withProjectFacts } from "./filingFacts.ts";
import { prefillFromPassport } from "./prefillFromPassport.ts";
import type { AgencyPendingField } from "./types.ts";

const field = (id: string, label: string): AgencyPendingField => ({ id, label, type: "text", sensitive: false }) as AgencyPendingField;

const scenario = applyScenarioAnswer(
  interpretScenario("We leased a 12,000-square-foot warehouse in Guaynabo and will renovate it for furniture manufacturing."),
  "sq_location",
  "123 Calle Principal, Guaynabo"
);
const facts = projectFilingFacts(scenarioToProjectContext(scenario), scenario);

describe("Clara checks the Passport and the project before asking", () => {
  it("collects confirmed project facts", () => {
    assert.equal(facts.municipality, "Guaynabo");
    assert.equal(facts.square_footage, "12000");
    assert.equal(facts.property_address, "123 Calle Principal, Guaynabo");
    assert.equal(facts.property_tenure, "leased");
  });

  it("never carries an inference into a form", () => {
    const vague = interpretScenario("A client leased a building and may repurpose part of it.");
    const f = projectFilingFacts(scenarioToProjectContext(vague), vague);
    assert.equal(f.proposed_use, undefined);
    assert.equal(f.existing_use, undefined);
  });

  it("project facts fill Passport gaps: municipality, square footage, property address", () => {
    const passport = { business: { legalName: "Muebles Isla LLC", ein: "66-1234567" } };
    const merged = withProjectFacts(passport, facts);
    const out = prefillFromPassport(
      [field("municipality", "Municipality"), field("square_footage", "Square footage"), field("property_address", "Property address"), field("ein", "EIN"), field("legal_name", "Legal name")],
      merged
    );
    assert.equal(out.municipality, "Guaynabo");
    assert.equal(out.square_footage, "12000");
    assert.equal(out.property_address, "123 Calle Principal, Guaynabo");
    assert.equal(out.ein, "66-1234567");
    assert.equal(out.legal_name, "Muebles Isla LLC");
  });

  it("the Passport wins over the project: a project elsewhere never overwrites the business address", () => {
    const passport = { _denormalized: { municipality: "Bayamón", physical_address: "Carr. 2 km 10, Bayamón" } };
    const out = prefillFromPassport([field("municipality", "Municipality"), field("physical_address", "Physical address")], withProjectFacts(passport, facts));
    assert.equal(out.municipality, "Bayamón");
    assert.equal(out.physical_address, "Carr. 2 km 10, Bayamón");
  });

  it("no access stays no access", () => {
    assert.equal(withProjectFacts(null, facts), null);
  });

  it("reads a saved intake snapshot, ignoring malformed parts", () => {
    const state = JSON.parse(JSON.stringify({ projectContext: scenarioToProjectContext(scenario), scenario }));
    state.scenario.property.address.source = "admin";
    const f = projectFilingFactsFromState(state, validateProjectContext);
    assert.equal(f.municipality, "Guaynabo");
    assert.equal(f.property_address, undefined);
  });
});
