# Semantic intake

The intake reads the free-text description as **one scenario**: who is doing what, where, to which property, and how those facts relate. It no longer treats the text as a list of keywords. The model builds a factual model; the knowledge graph decides what applies.

```
description
  → ScenarioContext            (ai/intake/scenario/interpret.ts + the model's reading, checked by normalize.ts)
  → merge Business Passport    (scenario/passport.ts — existing business only)
  → KB applicability           (scenario/graph.ts — rules.json documents, likely vs potential)
  → controlling unknowns       (scenario/graph.ts)
  → next question              (one at a time, in dependency order)
  → answer → graph again → requirements (unchanged rules engine)
```

## ScenarioContext

Sections are `business`, `property`, `project` and `operations` (see `scenario/types.ts`). Every fact is `{ value, source, confidence, evidenceText }`:

| source | meaning | shown as |
| --- | --- | --- |
| `explicit` | the user said it (or answered a question) | **We understood** |
| `inferred` | strongly implied by the whole scenario | **Needs confirmation**, never a confirmed chip |
| `existing_passport` | on file in the linked Business Passport | "Already known from your Business Passport" |

An absent fact is unknown. Nothing is defaulted. `possibleChangeOfUse` separates a confirmed change of use ("converting a warehouse into a daycare") from a possible one ("modifications to the existing use").

## Reading rules that matter

- A word counts only in the role the sentence gives it. "warehouse" after *leased* is the existing property; after *into* it is the proposed use.
- "A new commercial operation / location / operation" is **not** a new business. `business.status = new` needs entity-formation wording ("creating a new LLC", "starting a business"). "I want to open a restaurant" is at most an inference.
- The model's reading is checked against the text. Every quote must appear in the description. Guarded conclusions (new business, confirmed change of use) need the right wording, or they are dropped or downgraded to inferences. The deterministic reading wins guarded facts.
- If the AI is unavailable, the deterministic reading still produces the scenario.

## Graph applicability

`evaluateScenario` returns only KB rule documents (name and agency from `documents.json`):

- **Likely involved**: the rule's trigger is met by stated or on-file facts.
- **Potential — more information required**: the rule is reachable but hinges on an unknown or an unconfirmed inference. The path names what it needs.

The branches it evaluates:

- **Project-fact rules** (construction permit, lease or deed) from project scope and tenure.
- **Question-trigger rules** the scenario establishes (e.g. a daycare means children on site).
- **Business-type rules** for the resolved activity. A broad activity that matches many business types makes the exact activity controlling.
- **Business-wide obligations**, by business status:
  - new business: formation, EIN, merchant registration, municipal license (patente);
  - existing business: none, except a patente when the project is in another municipality;
  - unknown status: none listed, and "existing or new" becomes a controlling fact.

## Questions

Questions are generated only from controlling unknowns of reachable branches:

1. The activity comes first, because it selects the business-type branch.
2. Once the activity is known: the current authorized use and whether the use or occupancy changes, the physical property location, structural or exterior work, footprint change, and site circulation (only for outward changes or a new occupancy). The environmental question is asked only when the KB has air, water or hazardous-waste rules for that activity.

## Existing business

Selecting **Existing business** loads the Passport. It is auto-linked when the account has one business. Identity fields the Passport answers (name, entity type, industry, business type, municipality) are hidden. The description becomes a **new project** of that business. A project location that differs from the Passport address is a new location, not a Passport correction.

## Ask once, reuse forever, only ask when needed

Every intake fact has one tier (`ai/intake/infoNeeds.ts`):

| tier | what | when it is asked |
| --- | --- | --- |
| **Required now** | municipality; for a business: business type and location type | before requirements — the only facts that block "See my requirements" |
| **Useful later** | business name, headcount (industry is derived from the business type) | optional, collapsed; saved to the Business Passport as provided |
| **Filing specific** | entity type, EIN, authorized representative, contact, … | only when a filing needs it — Clara checks the Passport and the project first |

Guided KB questions still gate requirements: the engine reads an unanswered KB question as "No", so generating before they are answered would be wrong. Only the questions the facts do not already answer are asked.

Never the same fact twice:

- The description fills the form: municipality, business type (when the activity resolves to exactly one KB type), location type (when the scenario places the operation in physical premises), and industry (derived from the business type). Fields the user set by hand are never overwritten.
- Stated scenario facts answer the matching guided questions (`scenarioStatedAnswers`): lease/ownership, renovation, employees, manufacturing, children on site, food preparation.
- A business type picked in the form (or on file in the Passport) answers the scenario's activity question (`withFormFacts`).
- The scenario is saved with the workflow snapshot and restored on resume (`restoreScenario` validates it).

By branch:

- **Existing business**: Passport identity fields are hidden and never block. The project municipality is shown prefilled; a project in another municipality never overwrites the Passport — autosave only fills Passport gaps.
- **New business**: only the three required-now facts; anything else entered autosaves to the new business record.
- **Property / project only**: municipality is enough; no business fields are shown.

Clara (`lib/agency-runs/filingFacts.ts`): the Passport snapshot a run uses carries this project's confirmed facts under `project_facts` (municipality, property address, parcel, square footage, uses, tenure). They fill Passport gaps only — the Passport wins for business identity — and inferences are never carried into a form.

## From narrative to filing (the Caribe demo path)

Regression: `src/app/ai/intake/caribeDemo.test.ts` (no demo-specific code anywhere).

1. **Reading.** Identity (legal name + entity type from a suffix, "in the X industry"), a mixed proposed use ("used for furniture manufacturing, warehousing, and administrative offices" → `manufacturing_and_warehouse_and_office`), `project.officeBuildout`. Existing vs. proposed use never establishes a change of use; the model's inferred change of use is dropped and its use values are canonicalized.
2. **Passport.** A named existing business is linked when exactly one of the account's Passports matches (`matchBusinessByName`); otherwise the picker shows. Registered location and project location stay separate.
3. **Questions.** Only the scenario's controlling facts are asked (authorized use → address/catastro → structural/exterior → environmental when the KB has rules). After the authorized use is answered, the graph compares it with the proposed use itself. The business type's discovery questions are deferred: the engine reruns each with "Yes" (`deferredQuestions`) and lists only the documents a Yes would add, as *needs more information* with the question inline. Model-suggested (unstated) answers never reach the checklist.
4. **Requirements.** An existing business at new premises files location-bound obligations (`LOCATION_SCOPED_DOCUMENTS`; the patente when the municipality differs) instead of verifying them. The page groups the path — Required now · Conditional / needs information · Waiting on prerequisites (KB `depends_on_document_ids`) · Supporting documents · Registrations / licenses · Completed — and each card shows source, evidence, readiness, prerequisites, filing and Clara support.
5. **Clara.** "File with Clara" (launchable flow) / "Prepare with Clara" + agency site (flow not launchable yet) / "View filing instructions" + agency site. The link opens `/businesses/<id>/agency-run?requirement=<DOC>`; Clara loads that filing's pre-flight (Passport + project facts), asks only for what is missing, and nothing starts until the user confirms. Intake uploads also go to the Evidence Locker, tagged with the requirement, so Clara's readiness sees them.

## Compatibility

The legacy flat `projectContext` still feeds `project_fact` rules through `scenario/adapter.ts`:

- stated facts are sent at 0.90 or higher confidence;
- inferences are sent in the 0.60–0.84 needs-confirmation band, which the engine keeps inert;
- a *possible* change of use is never sent as a change of use.

Tests: `npm run test:intake:scenario` (includes `infoNeeds.test.ts`) and `src/lib/agency-runs/filingFacts.test.ts` (in `npm run test:agency`).
