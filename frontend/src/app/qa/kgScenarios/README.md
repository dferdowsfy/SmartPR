# Knowledge-graph scenario matrix (KG01–KG64)

The scenario matrix tests the regulatory knowledge graph and requirements engine end to end. Each scenario
goes through the same steps the intake uses (`SmartPRIntake.tsx` `computeRequirements`):

1. The description is read by `interpretScenario`. A simulated model reading (`modelProjectContext`) is checked by
   `validateProjectContext` and then passed through `reconcileProjectContext`.
2. Geo facts come from fixtures (`geoContexts.json`). The layer parsers used in production
   (`locations/layers.ts`: FEMA, advisory, JP calificación, CRIM, NOAA CZMA, historic, protected) turn them into a
   `SiteLayers` object. `siteEngineFacts` then produces the `location.*` facts. Road and water pins go through the
   same off-lot handling as in the app.
3. `computeRequirementsFromKB` builds the requirement list, and `normalizeEntityFormationRequirements` adjusts the
   formation steps.
4. The energy process graph runs next: `computeEnergyAssessment`, then `supersededLegacyCards`, then `processChecklist`.
5. `groupRequirements` and `splitOtherChecks` put the cards in the order the checklist shows them.

The suite makes no network calls. To check the live geo services, run `npm run geo:health`.

## Files

- `scenarios/KG##_<business>__<project>__<location>.json`: one scenario per file. Each file has:
  - `mustInclude` / `mustNotInclude`: stable keys. These are KB document ids, `process:<energy process id>`, or
    `gap:<name>` for an obligation the KB does not model yet.
  - `ordering`: `before` / `after` pairs, compared by position in the checklist as rendered.
  - Every expectation carries a `confidence` (`verified-in-code` or `needs-expert-review`) and a one-line
    `rationale`.
  - Options: `applicabilityIn` limits which applicabilities count, `agencyMatches` checks the agency with a regex,
    and `cardOnly` applies to duplicate-card checks.
- `geoContexts.json`: raw layer attributes for each location context, such as flood AE, floodway, advisory-only AO,
  coastal, historic, SREP, road pin, water pin, or layers unavailable.
- `harness.ts`: runs a scenario, evaluates it, and lints it. The evaluator also checks:
  - at most 3 questions;
  - no internal codes (DOC_/RULE_/Q_/PT_/PR_/LS_/BT_) in text the user sees;
  - no duplicate cards, such as a legacy card shown next to the energy process that absorbs it.
- `triage.json`: the hand-assigned likely cause for each known finding.
- `kgScenarios.test.ts`: one `node:test` per scenario. It is part of `npm run test:regulatory-correctness`.
- `runKgScenarios.ts`: `npm run test:scenarios` writes `frontend/test-reports/kg-scenarios.{md,json}`.

## CI

The scenarios run in the existing `regulatory` job, through `test:regulatory-correctness`. Scenarios that fail on
main are listed by exact test name in `ci/regulatory-known-failures.json`, the same way G13, G20 and G21 are.

- A new failure is a regression.
- A listed scenario that starts passing has to be removed from that file in the same PR.

Engine and rule code was **not** changed to make scenarios pass.

## Expert sign-off

Expectations marked `needs-expert-review` are proposals from Puerto Rico regulation, such as Ley 161-2009, RC-2023,
Reg. 13, CZMA and Ley 107-2020. Rosa or a land-use attorney still needs to confirm them.

- If an expectation is wrong, fix the scenario file and say why in `notes`.
- If the engine is wrong, leave the expectation as it is and fix the engine in a separate PR.
