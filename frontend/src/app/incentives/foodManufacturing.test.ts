// Act 60 Food & Beverage Export decree: manufacturing AND export, never food service.
// Run: npx tsx --test src/app/incentives/foodManufacturing.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { evaluateIncentives } from "./engine.ts";
import { normalizeProjectProfileForIncentives } from "./profile.ts";
import { relevantIncentiveOpportunities } from "./relevance.ts";
import { PR_ACT60_CATALOG } from "./prCatalog.ts";

const ID = "PR_ACT60_FOOD_MANUFACTURING";
const shown = (profile: Parameters<typeof normalizeProjectProfileForIncentives>[0], facts: Record<string, boolean> = {}) => {
  const assessment = evaluateIncentives(normalizeProjectProfileForIncentives(profile, facts), PR_ACT60_CATALOG);
  return {
    opportunity: assessment.opportunities.find((o) => o.programId === ID) ?? null,
    onPage: relevantIncentiveOpportunities(assessment.opportunities).some((o) => o.programId === ID),
  };
};

test("a San Juan restaurant (dine-in, alcohol) is not matched with the F&B export decree", () => {
  const r = shown({ business_stage: "new", industry: "Food & Beverage", business_type: "Restaurant", municipality: "San Juan", location_type: "Commercial Space", number_of_employees: 8 });
  assert.equal(r.opportunity, null);
  assert.equal(r.onPage, false);
});

test("cafes, bars and food trucks are not matched either, even when they say they export", () => {
  for (const business_type of ["Cafe", "Bar", "Food Truck", "Fast Food Restaurant"]) {
    assert.equal(shown({ industry: "Food & Beverage", business_type, import_export: true }).opportunity, null, business_type);
  }
});

test("the decree is scoped to the Manufacturing industry: Food & Beverage (retail food service) never matches on industry, even when it also manufactures", () => {
  assert.equal(shown({ industry: "Food & Beverage", business_type: "Restaurant", products_manufactured: true, import_export: true }, { exports_outside_pr: true }).opportunity, null);
});

test("a Bayamón hot sauce & beverage exporter (food manufacturing, exports) matches", () => {
  const r = shown({ business_stage: "new", industry: "Manufacturing", business_type: "Food Manufacturing", municipality: "Bayamón", business_structure: "corporation", import_export: true }, { exports_outside_pr: true });
  assert.ok(r.opportunity, "surfaced");
  assert.equal(r.opportunity!.eligibility, "likely_eligible");
  assert.ok(r.onPage);
});

test("import/export = Yes is not proof of exports: an import-only manufacturer is asked, never 'likely eligible'", () => {
  const r = shown({ industry: "Manufacturing", business_type: "Food Manufacturing", import_export: true });
  assert.equal(r.opportunity?.eligibility, "potentially_eligible");
  assert.ok(r.opportunity!.missingInformation.some((m) => m.factKey === "exports_outside_pr"));
  assert.equal(shown({ industry: "Manufacturing", business_type: "Food Manufacturing", import_export: true }, { exports_outside_pr: false }).opportunity, null, "imports only: not eligible");
  assert.equal(shown({ industry: "Manufacturing", business_type: "Food Manufacturing", import_export: false }).opportunity, null, "no import/export at all: not eligible");
});

test("a food manufacturer that has not said whether it exports is asked, not assumed", () => {
  const r = shown({ industry: "Manufacturing", business_type: "Beverage Manufacturing" });
  assert.equal(r.opportunity?.eligibility, "potentially_eligible");
  assert.ok(r.opportunity!.missingInformation.some((m) => m.factKey === "exports_outside_pr"));
});

test("a non-food manufacturer (furniture exporter) is not matched with the food decree", () => {
  assert.equal(shown({ industry: "Manufacturing", business_type: "Furniture Manufacturing", import_export: true }).opportunity, null);
});

test("the knowledge-graph copy of the program (authoritative when the graph store is on) carries the same two criteria", async () => {
  const programs = (await import("../../kb/incentive_programs.json", { with: { type: "json" } })).default as Array<{ id: string; industry_ids: string[]; criterion_ids: string[] }>;
  const criteria = (await import("../../kb/eligibility_criteria.json", { with: { type: "json" } })).default as Array<{ id: string; fact_key: string; required: boolean }>;
  const p = programs.find((x) => x.id === ID)!;
  assert.deepEqual(p.industry_ids, ["IND_MANUFACTURING"], "Manufacturing only — never matched on the Food & Beverage tag");
  const keys = p.criterion_ids.map((id) => criteria.find((c) => c.id === id));
  assert.ok(keys.every((c) => c && c.required), "every criterion id resolves and is required");
  assert.deepEqual(new Set(keys.map((c) => c!.fact_key)), new Set(["food_beverage_manufacturing", "exports_outside_pr"]));
});
