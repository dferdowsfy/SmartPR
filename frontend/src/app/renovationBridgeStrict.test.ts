// Regression: REG-LIVE-STALE-PROJECT-FACTS-001 (QA 2026-10-06 00:00, S453).
//
// Live S453 (Ponce existing 15y supermarket adding a bakery department via
// hired-contractor interior renovation) rendered NO Construction Permit card,
// while the engine fires RULE_0644 -> DOC_OGPE_CONSTRUCTION_PERMIT REQUIRED
// for the same facts. Diagnosis proved the engine correct in strict mode:
// the deterministic renovation bridge (projectContextAnswerToFacts,
// "renovations" Yes -> project_type=renovation @ confidence 1) survives the
// provenance gate. The live failure is in the intake->engine handoff
// (carried as a live-layer item); this test locks the engine-side contract
// the live flow depends on, so a future engine change can never silently
// drop the renovation -> OGPe link.
//
// Run: npx tsx --test src/app/renovationBridgeStrict.test.ts
import test from "node:test";
import assert from "node:assert/strict";

import { buildEngineInput, KB } from "./kb.ts";
import { runRulesEngine } from "./rulesEngine.ts";
import { projectContextAnswerToFacts } from "./ai/intake/projectContext.ts";

const SID = "sess-s453-repro";

function engineResult(projectContext: any, confirmedKeys: string[]) {
  const profile = {
    business_type: "Bakery",
    municipality: "Ponce",
    location_type: "Commercial Facility",
    number_of_employees: 20,
    industry: "Food & Beverage",
  };
  const answers = {
    Q_EMPLOYEES_HIRED: true,
    Q_EMPLOYEE_COUNT: 20,
    Q_OWNS_PROPERTY: true,
    renovations: true,
    Q_FOOD_SERVED: true,
    Q_FOOD_SOLD: true,
    Q_FOOD_PREPARED: true,
    Q_PHYSICAL_LOCATION: true,
    Q_OFFERS_CONSTRUCTION_SERVICES: false,
  };
  const input = buildEngineInput(profile as never, answers as never, {}, {
    projectIntent: "existing_business",
    projectContext,
    sessionId: SID,
    businessId: null,
    confirmedKeys,
    passportKeys: [],
  } as never);
  return runRulesEngine(KB, input);
}

function hasOgpe(res: { requirements: Array<{ document_id: string }> }) {
  return res.requirements.some((r) => r.document_id === "DOC_OGPE_CONSTRUCTION_PERMIT");
}

test("REG-LIVE-STALE-PROJECT-FACTS-001: renovation bridge facts fire OGPe in strict mode (S453 contract)", () => {
  // Exactly what the deterministic bridge writes when the user answers
  // "renovations" Yes in the guided intake.
  const bridge = projectContextAnswerToFacts("renovations", true, "en");
  const pc: Record<string, unknown> = {};
  for (const { key, fact } of bridge) pc[key] = fact;
  assert.equal((pc["project_type"] as any)?.value, "renovation");
  assert.ok(((pc["project_type"] as any)?.confidence ?? 0) >= 0.85);

  const res = engineResult(pc, [
    "business_type", "municipality", "Q_EMPLOYEES_HIRED", "renovations", "Q_OWNS_PROPERTY",
  ]);
  assert.ok(
    hasOgpe(res),
    "existing-business interior renovation (bridge-confirmed) must require the OGPe construction permit in strict mode"
  );
});

test("REG-LIVE-STALE-PROJECT-FACTS-001: unconfirmed AI-derived renovation stays inert in strict mode (by design)", () => {
  // The needs-confirmation band: present in state, must never trigger.
  const pc = { project_type: { value: "renovation", confidence: 0.72, evidence: "model interpretation" } };
  const res = engineResult(pc, ["business_type", "municipality", "Q_EMPLOYEES_HIRED", "Q_OWNS_PROPERTY"]);
  assert.ok(
    !hasOgpe(res),
    "a suggested-but-unconfirmed renovation fact must not fire the OGPe permit in strict mode"
  );
});
