// Live loop 2026-10-14: after the last question the hint said SmartPR may also
// need "existing business or a new one being formed" although Project = New
// business. The Project choice now answers it on every "still needed" surface.
// Run: npx tsx --test src/app/ai/intake/scenario/openFacts.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { KB } from "../../../kb.ts";
import type { KnowledgeBase } from "../../../rulesEngine.ts";
import { interpretScenario } from "./interpret.ts";
import { evaluateScenario } from "./graph.ts";
import { businessStatus } from "./types.ts";
import { evaluationAsShown, openControllingFacts } from "./openFacts.ts";
import { ScenarioQuestions } from "../../../components/intake/ScenarioPanel.tsx";

const kb = KB as unknown as KnowledgeBase;
// Mirrors Run 1's Rincón case: the description never says new vs existing.
const c = interpretScenario("Beachfront guesthouse with kayak rentals in Rincón.");
const ev = evaluateScenario(c, kb);

test("the description alone leaves 'existing or new?' open in the graph", () => {
  assert.equal(businessStatus(c), "unknown");
  assert.ok(ev.controlling.some((x) => x.id === "business_status"));
});

test("Project = New business (or Existing / Project only) answers it", () => {
  for (const projectIntent of ["new_business", "existing_business", "project_only"] as const) {
    assert.ok(!openControllingFacts(ev.controlling, { projectIntent }).some((x) => x.id === "business_status"), projectIntent);
  }
  assert.ok(openControllingFacts(ev.controlling, { projectIntent: null }).some((x) => x.id === "business_status"), "still asked when no Project choice exists");
});

test("display only: paths, questions and the other open facts are unchanged", () => {
  const shown = evaluationAsShown(ev, { projectIntent: "new_business" });
  assert.deepEqual(shown.likely, ev.likely);
  assert.deepEqual(shown.potential, ev.potential);
  assert.deepEqual(shown.questions, ev.questions);
  assert.deepEqual(shown.controlling.map((x) => x.id), ev.controlling.map((x) => x.id).filter((id) => id !== "business_status"));
  assert.equal(evaluationAsShown(null, { projectIntent: "new_business" }), null);
});

test("the 'may also need' hint no longer asks what the Project choice answered", () => {
  const html = (e: typeof ev) => renderToStaticMarkup(createElement(ScenarioQuestions, { evaluation: { ...e, questions: [] }, lang: "en", onAnswer: () => {}, onSkip: () => {} }));
  assert.match(html(ev), /existing business or a new one being formed/);
  assert.doesNotMatch(html(evaluationAsShown(ev, { projectIntent: "new_business" })), /existing business or a new one being formed/);
});

test("the intake wires the shown evaluation into the hint and the sidebar", async () => {
  const { readFileSync } = await import("node:fs");
  const intake = readFileSync(new URL("../../../SmartPRIntake.tsx", import.meta.url), "utf8");
  assert.match(intake, /<ScenarioQuestions\s+evaluation=\{scenarioEvalShown\}/);
  assert.match(intake, /stillNeeds: \(scenarioEvalShown\?\.controlling/);
  assert.doesNotMatch(intake, /scenarioEval\.controlling\.length/);
});
