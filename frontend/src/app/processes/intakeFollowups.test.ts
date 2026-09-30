// Unit coverage for the PR #109 follow-up fixes (new-construction guard,
// context-aware questions, option labels, "Other checks" collapsing, Act 60
// decree-holder gating). Run: npx tsx --test src/app/processes/intakeFollowups.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { newConstructionStated } from "../ai/intake/scenario/interpret.ts";
import { validateProjectContext } from "../ai/intake/projectContext.ts";
import { loadEnergyProcessGraph } from "./kb.ts";
import { optionLabel, questionFor } from "./engine.ts";
import { splitOtherChecks } from "../components/filing/requirementGroups.ts";
import { PR_ACT60_CATALOG } from "../incentives/prCatalog.ts";
import { evaluateIncentives } from "../incentives/engine.ts";

test("new-construction language detection (EN/ES, negation-aware)", () => {
  assert.equal(newConstructionStated("We will build a new warehouse in Caguas"), true);
  assert.equal(newConstructionStated("Vamos a construir un edificio nuevo"), true);
  assert.equal(newConstructionStated("We run a warehouse and want to install a 400 kW rooftop solar system"), false);
  assert.equal(newConstructionStated("This is not new construction, just rooftop panels"), false);
});

test("validator drops a model new_construction claim only when the text never says so", () => {
  const raw = { project_type: { value: "new_construction", confidence: 0.8, evidence: "install rooftop solar" } };
  const solar = validateProjectContext(raw, "We run a distribution warehouse and want to install rooftop solar.");
  assert.equal(solar.context.project_type, undefined);
  assert.ok(solar.discarded.some((d) => /new construction claim dropped/.test(d.reason)));
  const build = validateProjectContext(
    { project_type: { value: "new_construction", confidence: 0.9, evidence: "build a new warehouse" } },
    "We plan to build a new warehouse in Caguas."
  );
  assert.equal(build.context.project_type?.value, "new_construction");
});

test("fact questions use stated context; enum options have plain-English labels", () => {
  const kb = loadEnergyProcessGraph().kb;
  const def = (k: string) => kb.facts.find((f) => f.key === k)!;
  assert.match(questionFor(def("microgrid_configuration"), { properties_served: 3 }), /Will the 3 buildings share power/);
  assert.equal(questionFor(def("microgrid_configuration"), {}), def("microgrid_configuration").question);
  assert.match(questionFor(def("sells_energy_to_third_parties"), { common_ownership: true }), /buildings you own is not a sale/);
  const role = def("energy_applicant_role");
  for (const o of role.options ?? []) {
    const l = optionLabel(role, o);
    assert.ok(!l.includes("_") && l[0] === l[0].toUpperCase(), `${o} -> ${l}`);
  }
  assert.equal(optionLabel(undefined, "end_use_customer"), "End use customer");
});

test("splitOtherChecks: existing business only, one entry per question, project-scope questions stay", () => {
  const cards = [
    { id: "ein", group: "conditional" as const, triggerQuestionId: "Q_EMPLOYEES_HIRED" },
    { id: "cfse", group: "conditional" as const, triggerQuestionId: "Q_EMPLOYEES_HIRED" },
    { id: "reno", group: "conditional" as const, triggerQuestionId: "Q_RENOVATIONS" },
    { id: "luma", group: "required_now" as const, triggerQuestionId: null },
  ];
  const nb = splitOtherChecks(cards as never[], { projectIntent: "new_business" });
  assert.equal(nb.otherChecks.length, 0);
  const eb = splitOtherChecks(cards as never[], { projectIntent: "existing_business" });
  assert.deepEqual(eb.otherChecks.map((q) => [q.questionId, q.cards.length]), [["Q_EMPLOYEES_HIRED", 2]]);
  assert.deepEqual(eb.main.map((c: { id: string }) => c.id), ["reno", "luma"]);
});

test("Act 60 green-energy equipment benefit requires a decree (Ley 60-2019 §§2072.05–2072.06)", () => {
  const p = PR_ACT60_CATALOG.find((x) => x.id === "PR_ACT60_RENEWABLE_INVESTMENT")!;
  assert.match(p.description, /holding an Act 60 Green Energy decree/);
  assert.doesNotMatch(p.description, /^Any business/);
  assert.ok(p.benefits.every((b) => /Decree holders only \(Section 2072\.0[56]/.test(b.description)));
  assert.ok(p.criteria.some((c) => c.factKey === "green_energy_decree"));
  const noDecree = evaluateIncentives({ renewable_energy_investment: true, green_energy_decree: false }, [p]).results[0];
  assert.equal(noDecree.eligibility === "likely_eligible" || noDecree.eligibility === "potentially_eligible", false);
  const unknown = evaluateIncentives({ renewable_energy_investment: true }, [p]).results[0];
  assert.notEqual(unknown.eligibility, "likely_eligible");
  const decree = evaluateIncentives({ renewable_energy_investment: true, green_energy_decree: true }, [p]).results[0];
  assert.equal(decree.eligibility, "likely_eligible");
});
