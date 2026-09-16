# SmartPR rigorous correctness framework (`src/app/qa/`)

Darius's core worry: "do the rules output the CORRECT requirements?" This
directory is the oracle.

## Pieces

| File | Purpose |
|---|---|
| `scenarioDefs.ts` | The 25 hand-authored scenario INPUTS (profile + direct answers). The meaningful part — edit here when adding scenarios. |
| `goldens/G##.json` | Committed expected requirement sets. `status: "draft"` = snapshot of current behavior, awaiting Darius's review. `status: "validated"` = Darius-reviewed ground truth; the suite asserts EXACT set equality. |
| `goldenHarness.ts` | Loader, `runGolden()` (full engine pipeline + rules-fired capture), drift diffing, `computeCoverage()`. |
| `goldenScenarios.test.ts` | Per-golden assertions. `expectedAbsent` invariants assert hard for every golden. Validated goldens fail on any drift. Draft drift is reported, never fails. |
| `ruleCoverage.test.ts` | Unions `debug.rulesMatched` across goldens; asserts coverage never drops below `coverage-baseline.json`. Prints the never-fired rule list for the QA loop to target. |
| `requirementProperties.test.ts` | Oracle-free bug-class invariants: rule-order independence, no cross-municipality leakage in user-facing text, no placeholder text, determinism. |
| `snapshotGoldens.ts` | `npm run qa:snapshot-goldens` — re-snapshots DRAFT goldens only. Validated goldens are never overwritten. |
| `updateCoverageBaseline.ts` | `npm run qa:update-coverage-baseline` — refresh the ratchet deliberately. |

## Workflow

1. Add scenario inputs to `scenarioDefs.ts`.
2. `npm run qa:snapshot-goldens` → new JSON appears as `draft`.
3. Darius reviews the draft's expected set (see the review doc in the
   knowledge-graph-accuracy-push goal `files/`), corrects it by hand.
4. Set `"status": "validated"` in the JSON. It is now ground truth.

## For the autonomous QA loop

- Run `npm run test:goldens` every cycle (it is also inside `test:regulatory-correctness`).
- Draft drift in the output = behavior changed somewhere: route the
  scenario for review, do not "fix" the golden to match.
- The `[coverage]` uncovered-rule list = where the next false negatives are
  hiding: design adversarial scenarios that should fire those rules.
- Coverage baseline (2026-09-16): 136/643 rules (21.2%).
