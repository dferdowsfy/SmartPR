/**
 * Ask once, reuse forever, only ask when needed.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { KB } from "../../kb.ts";
import type { KnowledgeBase } from "../../rulesEngine.ts";
import { interpretScenario } from "./scenario/interpret.ts";
import { evaluateScenario } from "./scenario/graph.ts";
import { identityFieldsKnown, mergePassportIntoScenario, type PassportSnapshot } from "./scenario/passport.ts";
import {
  businessTypeFromScenario,
  locationTypeFromScenario,
  planIntake,
  scenarioStatedAnswers,
  withFormFacts,
} from "./infoNeeds.ts";

const kb = KB as unknown as KnowledgeBase;
const ALL_LOCATIONS = [
  "Home-Based Business",
  "Commercial Office",
  "Retail Storefront",
  "Industrial Facility",
  "Restaurant / Food Service Location",
  "Mobile Business",
  "Online / Remote Only",
  "Warehouse",
];
const WAREHOUSE =
  "We leased a 12,000-square-foot warehouse in Guaynabo and will renovate it for furniture manufacturing with 12 employees.";

describe("the description answers facts once", () => {
  const ctx = interpretScenario(WAREHOUSE);

  it("municipality, square footage, activity and premises come from the description", () => {
    assert.equal(ctx.property.municipality?.value, "Guaynabo");
    assert.equal(ctx.property.squareFeet?.value, 12000);
    assert.equal(businessTypeFromScenario(ctx, kb), "Furniture Manufacturing");
    assert.equal(locationTypeFromScenario(ctx, ALL_LOCATIONS), "Industrial Facility");
  });

  it("stated facts answer the matching guided questions — never asked again", () => {
    const a = scenarioStatedAnswers(ctx);
    assert.equal(a.existing_lease, true);
    assert.equal(a.owns_property, false);
    assert.equal(a.renovations, true);
    assert.equal(a.employees_hired, true);
    assert.equal(a.products_manufactured, true);
  });

  it("requirements are available with no Passport field filled in", () => {
    const plan = planIntake({
      intent: "new_business",
      profile: {
        municipality: "Guaynabo",
        business_type: businessTypeFromScenario(ctx, kb),
        location_type: locationTypeFromScenario(ctx, ALL_LOCATIONS),
        // A new business's entity type is asked up front ("Not sure yet" counts).
        business_structure: "undecided",
      },
      descriptionKnown: new Set(["municipality", "business_type", "location_type"]),
    });
    assert.equal(plan.ready, true);
    assert.deepEqual(plan.missingRequired, []);
    // Name and headcount are not required to see requirements.
    for (const key of ["name", "number_of_employees"] as const) {
      const f = plan.fields.find((x) => x.key === key);
      assert.ok(f && f.tier !== "required_now", key);
    }
  });

  it("does not invent premises for an online business", () => {
    const online = interpretScenario("I want to start an online store selling t-shirts.");
    assert.equal(locationTypeFromScenario(online, ALL_LOCATIONS), null);
  });

  it("never picks a non-premises option", () => {
    assert.equal(locationTypeFromScenario(ctx, ["Home-Based Business", "Online / Remote Only"]), null);
  });
});

describe("tiers by branch", () => {
  it("new business: municipality, business type, location type and entity type block requirements", () => {
    const plan = planIntake({ intent: "new_business", profile: {} });
    // Entity type decides LLC vs corporation vs no formation filing, so a new
    // business is asked it once ("Not sure yet" is an answer).
    assert.deepEqual(plan.missingRequired.sort(), ["business_structure", "business_type", "location_type", "municipality"]);
    assert.equal(plan.fields.find((f) => f.key === "business_structure")?.tier, "required_now");
    assert.equal(plan.fields.find((f) => f.key === "name")?.tier, "useful_later");
  });

  it("property/project only: no business fields at all, municipality is enough", () => {
    const plan = planIntake({ intent: "project_only", profile: { municipality: "Caguas" } });
    assert.equal(plan.ready, true);
    const keys = plan.fields.map((f) => f.key);
    for (const k of ["business_type", "location_type", "industry", "business_structure", "number_of_employees"]) {
      assert.ok(!keys.includes(k as never), k);
    }
  });

  it("existing business: Passport facts are hidden and never block", () => {
    const snap: PassportSnapshot = {
      businessId: "b1",
      name: "Muebles Isla LLC",
      entityType: "llc",
      businessType: "Furniture Manufacturing",
      industry: "Manufacturing",
      municipality: "Bayamón",
    };
    const plan = planIntake({
      intent: "existing_business",
      profile: { name: "Muebles Isla LLC", business_type: "Furniture Manufacturing", industry: "Manufacturing", municipality: "Guaynabo" },
      passportKnown: identityFieldsKnown(snap),
    });
    const shown = plan.fields.filter((f) => f.show).map((f) => f.key);
    assert.deepEqual(shown.sort(), ["location_type", "number_of_employees"]);
    assert.deepEqual(plan.missingRequired, ["location_type"]);
  });
});

describe("scenario and form never ask the same fact twice", () => {
  it("a business type picked in the form answers the activity question", () => {
    const ctx = interpretScenario("We leased a warehouse in Guaynabo and will renovate it for manufacturing.");
    const before = evaluateScenario(ctx, kb);
    assert.ok(before.questions.some((q) => q.id === "sq_activity"), "broad activity is asked first");
    const after = evaluateScenario(withFormFacts(ctx, { business_type: "Furniture Manufacturing" }, kb), kb);
    assert.ok(!after.questions.some((q) => q.id === "sq_activity"));
  });

  it("a Passport business type resolves the activity for an existing business", () => {
    const ctx = interpretScenario("Our company will renovate a leased warehouse in Guaynabo for manufacturing.");
    const merged = mergePassportIntoScenario(ctx, { businessId: "b1", businessType: "Furniture Manufacturing" });
    const form = withFormFacts(merged, { business_type: "Furniture Manufacturing" }, kb);
    assert.ok(!evaluateScenario(form, kb).questions.some((q) => q.id === "sq_activity"));
  });

  it("a form municipality fills the scenario only when the description had none", () => {
    const stated = interpretScenario(WAREHOUSE);
    assert.equal(withFormFacts(stated, { municipality: "Ponce" }, kb).property.municipality?.value, "Guaynabo");
    const none = interpretScenario("We will renovate a leased warehouse.");
    assert.equal(withFormFacts(none, { municipality: "Ponce" }, kb).property.municipality?.value, "Ponce");
  });
});

describe("reuse forever: a saved scenario survives resume", () => {
  it("round-trips a real scenario and drops malformed facts", async () => {
    const { restoreScenario } = await import("./scenario/types.ts");
    const ctx = interpretScenario(WAREHOUSE);
    const saved = JSON.parse(JSON.stringify(ctx));
    assert.deepEqual(restoreScenario(saved), ctx);
    saved.property.squareFeet.value = "12000; DROP TABLE";
    saved.business.status = { value: "bogus", source: "explicit", confidence: 1, evidenceText: "x" };
    saved.operations.employees.source = "admin";
    const restored = restoreScenario(saved)!;
    assert.equal(restored.property.squareFeet, undefined);
    assert.equal(restored.business.status, undefined);
    assert.equal(restored.operations.employees, undefined);
    assert.equal(restored.property.municipality?.value, "Guaynabo");
    assert.equal(restoreScenario("nope"), null);
  });
});

describe("the description populates fields and answers questions (bar)", () => {
  it("a bare 'bar' keyword is a stated use resolving to the Bar business type", () => {
    const ctx = interpretScenario("bar");
    assert.equal(ctx.property.proposedUse?.value, "bar");
    assert.equal(businessTypeFromScenario(ctx, kb), "Bar");
  });

  it("'I want to open a bar' resolves to Bar, not Restaurant", () => {
    const ctx = interpretScenario("I want to open a bar");
    assert.equal(businessTypeFromScenario(ctx, kb), "Bar");
  });

  it("a bar entails alcohol sold — the question is never asked", () => {
    const a = scenarioStatedAnswers(interpretScenario("I want to open a bar"));
    assert.equal(a.alcohol_sold, true);
  });

  it("a juice bar keeps its own type and does not entail alcohol", () => {
    const ctx = interpretScenario("I want to open a juice bar in Condado");
    assert.equal(businessTypeFromScenario(ctx, kb), "Juice Bar");
    assert.equal(scenarioStatedAnswers(ctx).alcohol_sold, undefined);
  });

  it("amenities in the sentence answer their questions, negations included", () => {
    const yes = scenarioStatedAnswers(
      interpretScenario("I want to open a bar in San Juan with outdoor seating and live music")
    );
    assert.equal(yes.outdoor_seating, true);
    assert.equal(yes.live_entertainment, true);
    const no = scenarioStatedAnswers(interpretScenario("I want to open a bar with no outdoor seating"));
    assert.equal(no.outdoor_seating, false);
  });
});
