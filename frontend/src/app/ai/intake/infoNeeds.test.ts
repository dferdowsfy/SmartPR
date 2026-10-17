/**
 * Ask once, reuse forever, only ask when needed.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { KB } from "../../kb.ts";
import type { KnowledgeBase } from "../../rulesEngine.ts";
import { interpretScenario } from "./scenario/interpret.ts";
import { locationTypeSettled, staleLocationConfirmation } from "../../locationTypes.ts";
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

  // Run 16 (live): once the user confirmed an address, a coffee hacienda with
  // guest cabins (Jayuya) and a boat-repair yard (Arroyo) — business types with
  // no location list of their own — were silently filled as "Commercial
  // Office", the generic list's first physical option, and never asked.
  it("asks instead of defaulting to the generic list's first option", () => {
    const withAddress = (text: string) => {
      const c = interpretScenario(text);
      c.property.address = { value: "Carretera 144, Jayuya", source: "explicit", confidence: 0.95, evidenceText: "Carretera 144" };
      return c;
    };
    const hacienda = withAddress(
      "Opening an agrotourism coffee hacienda in Jayuya with coffee farm tours and four rental guest cabins for overnight visitors",
    );
    assert.equal(locationTypeFromScenario(hacienda, ALL_LOCATIONS, { pickFirst: false }), null);
    const boatyard = withAddress("Opening a boat repair and dry-storage yard for small fishing and recreational boats by the shore in Arroyo");
    assert.equal(locationTypeFromScenario(boatyard, ALL_LOCATIONS, { pickFirst: false }), null);
    // A use the description names still answers it from the generic list.
    assert.equal(locationTypeFromScenario(ctx, ALL_LOCATIONS, { pickFirst: false }), "Industrial Facility");
    // A business type's own list keeps its first option as the default.
    assert.equal(locationTypeFromScenario(hacienda, ["Agricultural Property", "Retail Storefront"]), "Agricultural Property");
  });
});

// Run 16 follow-through / Run 17 (live): "dry-storage yard" (boats kept on
// land) and "vehicle storage yard" (a tow yard) read as a warehouse building:
// Location Type became "Warehouse" right after "Use this location" and the
// business type resolved to the Warehouse Operator / Distributor pair. An
// open-air storage yard is not a warehouse; the user is asked instead.
describe("storage yards are not warehouses", () => {
  const withAddress = (text: string) => {
    const c = interpretScenario(text);
    c.property.address = { value: "Carretera 3, Arroyo", source: "explicit", confidence: 0.95, evidenceText: "Carretera 3" };
    return c;
  };
  it("a boat dry-storage yard or a tow yard leaves Location Type and Business Type to the user", () => {
    for (const text of [
      "Opening a boat repair and dry-storage yard for small fishing and recreational boats by the shore in Arroyo",
      "Starting a tow truck (grúa) service with two flatbed trucks and a fenced vehicle storage yard on Carretera 2 in Barceloneta",
      "Opening an outdoor storage lot for trailers and containers in Cataño",
    ]) {
      const c = withAddress(text);
      assert.notEqual(c.property.proposedUse?.value, "warehouse", text);
      assert.equal(locationTypeFromScenario(c, ALL_LOCATIONS, { pickFirst: false }), null, text);
      assert.equal(businessTypeFromScenario(c, kb), null, text);
    }
  });
  it("a storage building still reads as a warehouse", () => {
    for (const text of [
      "Opening a distribution warehouse in Guaynabo",
      "Opening a self-storage facility with 80 units in Ceiba",
      "Opening a cold storage facility for produce in Santa Isabel",
    ]) {
      const c = withAddress(text);
      assert.equal(c.property.proposedUse?.value, "warehouse", text);
      assert.equal(locationTypeFromScenario(c, ALL_LOCATIONS, { pickFirst: false }), "Warehouse", text);
    }
  });
});

// Run 20 (live, Cayey): "a welding and metal fabrication shop that makes iron
// gates, window bars (rejas) and railings" got Location Type "Retail
// Storefront" right after "Use this location" (with and without the
// interpreter), because the bare word "shop" read as the retail use. A shop
// where things are made is not a store; the user is asked instead.
describe("trade shops are not storefronts", () => {
  const withAddress = (text: string) => {
    const c = interpretScenario(text);
    c.property.address = { value: "Carretera 1, Cayey", source: "explicit", confidence: 0.95, evidenceText: "Carretera 1" };
    return c;
  };
  it("a welding, machine, sheet-metal or woodworking shop leaves Location Type to the user", () => {
    for (const text of [
      "Opening a welding and metal fabrication shop that makes iron gates, window bars (rejas) and railings on Carretera 1 in Cayey",
      "Opening a machine shop in Bayamón",
      "Opening a sheet metal shop for HVAC ducts in Carolina",
      "Opening a cabinet and woodworking shop in Caguas",
    ]) {
      const c = withAddress(text);
      assert.notEqual(c.property.proposedUse?.value, "retail", text);
      assert.equal(locationTypeFromScenario(c, ALL_LOCATIONS, { pickFirst: false }), null, text);
    }
  });
  it("a store-like shop still reads as retail", () => {
    for (const text of ["Opening a gift shop in Culebra", "Opening a tire shop in Villalba", "Opening a retail store in Ponce"]) {
      const c = withAddress(text);
      assert.equal(c.property.proposedUse?.value, "retail", text);
      assert.equal(locationTypeFromScenario(c, ALL_LOCATIONS, { pickFirst: false }), "Retail Storefront", text);
    }
  });
});

// Run 17 (live, Morovis solar installer): the interpreter suggested "Mixed
// Use Property" (not offered for Solar Installer), so Location Type was
// flagged "Needs confirmation". The description's own read then filled
// "Commercial Office", but the flag stayed, the field stayed inert for the
// engine, and Permiso Único silently dropped from the report.
describe("a stale location confirmation flag does not outlive its value", () => {
  const SOLAR = ["Commercial Office", "Warehouse", "Agricultural Property", "Vacant Land", "Outdoor / Open Land"];
  it("clears when the visible value is the description's own settled read", () => {
    assert.equal(
      staleLocationConfirmation({ locationType: "Commercial Office", flagged: true, userEdited: false, descriptionValue: "Commercial Office", allowed: SOLAR }),
      true,
    );
  });
  it("keeps the flag when the value is the interpreter's own suggestion, the user edited it, or G9 would badge it", () => {
    // The interpreter's suggestion is still showing (the description read differs).
    assert.equal(staleLocationConfirmation({ locationType: "Vacant Land", flagged: true, userEdited: false, descriptionValue: "Commercial Office", allowed: SOLAR }), false);
    // No description read at all.
    assert.equal(staleLocationConfirmation({ locationType: "Commercial Office", flagged: true, userEdited: false, descriptionValue: null, allowed: SOLAR }), false);
    // The user touched the field: their choice is never second-guessed.
    assert.equal(staleLocationConfirmation({ locationType: "Commercial Office", flagged: true, userEdited: true, descriptionValue: "Commercial Office", allowed: SOLAR }), false);
    // A value G9 would still badge (not first, not an ordinary premises).
    assert.equal(staleLocationConfirmation({ locationType: "Outdoor / Open Land", flagged: true, userEdited: false, descriptionValue: "Outdoor / Open Land", allowed: SOLAR }), false);
    // Not flagged: nothing to clear.
    assert.equal(staleLocationConfirmation({ locationType: "Commercial Office", flagged: false, userEdited: false, descriptionValue: "Commercial Office", allowed: SOLAR }), false);
  });
  it("G9 settles the list's first option and ordinary premises only when the list offers them", () => {
    assert.equal(locationTypeSettled("Commercial Office", SOLAR), true);
    assert.equal(locationTypeSettled("Warehouse", SOLAR), true);
    assert.equal(locationTypeSettled("Vacant Land", SOLAR), false);
    assert.equal(locationTypeSettled("Mixed Use Property", SOLAR), false);
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

  it("Opening a juice bar and smoothie shop resolves to Juice Bar (Run 9 L1)", () => {
    const ctx = interpretScenario("Opening a juice bar and smoothie shop in downtown Vega Baja");
    assert.equal(businessTypeFromScenario(ctx, kb), "Juice Bar");
    assert.equal(scenarioStatedAnswers(ctx).alcohol_sold, undefined);
  });

  it("Opening a dive shop with snorkel rentals resolves to Water Sports rental (Run 9 L2)", () => {
    const ctx = interpretScenario(
      "Opening a small dive shop with snorkel and scuba gear rentals near the coast in Loíza"
    );
    assert.equal(businessTypeFromScenario(ctx, kb), "Water Sports & Watercraft Rental");
  });

  it("Opening a gas station resolves to the Convenience Store proxy (Run 11 N1)", () => {
    for (const d of [
      "Opening a gas station with 6 fuel pumps and a convenience store in Mayagüez",
      "Opening a gas station in Mayagüez",
      "I want to open a gasolinera in Ponce",
    ]) {
      assert.equal(businessTypeFromScenario(interpretScenario(d), kb), "Convenience Store", d);
    }
  });

  it("Opening a craft microbrewery resolves to Beverage Manufacturing (Run 12)", () => {
    for (const d of [
      "Opening a craft microbrewery with a taproom in downtown Peñuelas",
      "Opening a brewery and bar in Ponce",
      "Starting a nano-brewery in Cayey",
      "Opening a brewpub in Caguas",
      "Opening a cervecería artesanal in Rincón",
    ]) {
      assert.equal(businessTypeFromScenario(interpretScenario(d), kb), "Beverage Manufacturing", d);
    }
    // A plain bar stays a Bar.
    assert.equal(businessTypeFromScenario(interpretScenario("Opening a bar in downtown Ponce"), kb), "Bar");
  });

  it("Opening a bakery resolves to Bakery, not Restaurant (Run 9 L1)", () => {
    const ctx = interpretScenario("Opening a bakery with a small café counter in downtown Mayagüez");
    assert.equal(businessTypeFromScenario(ctx, kb), "Bakery");
  });

  it("Opening a men's barbershop resolves to Barbershop (Run 9 L1)", () => {
    const ctx = interpretScenario("Opening a men's barbershop and beard spa in Canóvanas");
    assert.equal(businessTypeFromScenario(ctx, kb), "Barbershop");
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
