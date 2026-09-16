# Requirements Engine Audit — 2026-09-16

**Trigger:** Darius reported over-triggering on a Guaynabo commercial renovation
("renovate an existing commercial building… 12,000 sq ft warehouse and office…
interior demolition, new walls, electrical and plumbing… already operating
commercially"). SmartPR emitted Merchant Registration, Permiso Único, Zoning,
Patente Municipal, Municipal Registration, Tax Compliance, Professional
License, DACO Contractor License, SAM.gov, Lease Agreement, Stormwater Plan,
Solid Waste Contract, Parking Certificate, Loading Permit, Noise Variance,
Environmental Permit, Annual Report, and the OGPe Construction Permit — several
marked **Required** on weak or unrelated triggers.

**Directive:** audit and patch the backend graph/rules — do not rewrite it.

## 1. Root causes found

1. **Universal municipality triggers.** Five rules (`municipality` rule type)
   fired for *any* municipality + *any* business: Merchant Registration,
   Patente Municipal, Municipal Registration, Municipal Tax Compliance
   Certificate, Annual Report. Selecting "Guaynabo" alone produced five
   "Required" filings. The rule literally read
   `IF municipality = X THEN requirement = Merchant Registration`.
2. **Bare municipality-flag triggers.** Seven rules fired on a flag alone with
   no business type and no project fact: metro → Stormwater Plan, Solid Waste
   Contract, Parking Certificate; historic → Zoning/Use Certification, Facade
   Plan; capital → San Juan Use Permit; island → Solid Waste Contract.
   "Metro municipality → Stormwater Plan required" was a real rule (RULE_0269).
3. **~216 business-type + flag heuristic combos treated as requirements.**
   Rules like `Real Estate Developer + metro → Noise Variance / Environmental
   Permit / Loading Zone Permit` (RULE_0431–0433) are planning-level
   associations, not regulatory triggers. They could never be *confirmed* (the
   classifier already held undecided flags at conditional), but they were
   presented as checklist requirements without any project fact supporting
   them.
4. **No compliance posture.** Existing-business obligations (merchant
   registration, patente, annual report) rendered as "complete a new
   application" even for already-operating businesses. No VERIFY_EXISTING
   concept existed.
5. **No negative facts.** `site_work = false` could not suppress the
   stormwater heuristic; the graph had no way to say "this affirmatively does
   not apply."
6. **Binary-ish status vocabulary.** `required / conditional / recommended /
   not_applicable / completed` could not express "verify existing compliance",
   "needs more information", "supporting evidence", or "likely but unverified".
7. **Fact namespaces existed structurally but without audit metadata.**
   `buildEngineInput` already separated business answers from project facts
   (and quarantines business facts for `project_only`), but nothing recorded
   source/scope per fact.

**Not root causes** (verified clean): DACO Contractor License fires only on
contractor business types (RULE_0123–0137) and on
`Q_OFFERS_CONSTRUCTION_SERVICES` (RULE_0642) — never on bare construction
activity. SAM.gov fires only on government-contractor business types
(RULE_0637–0640) and on explicit federal-contract intent (RULE_0641). The
contamination in Darius's run came from the inferred business type
("Real Estate Developer") combined with causes 1–3, not from these rules.

## 2. Files changed

| File | Change |
|---|---|
| `frontend/src/app/rulesEngine.ts` | `KBRule`: `compliance_mode`, `verification`, `missing_fact_keys`, `negated_fact_keys`, `trigger_summary`, `reviewed_at`, `change_log`. `EngineInput.factMeta` (source/scope per fact). Numeric project-fact matching (`>=1`). Negative-fact suppression with `debug.rulesSuppressed`. `GeneratedRequirement` carries rule metadata through. |
| `frontend/src/app/requirementApplicability.ts` | `Applicability` extended: `likely_required`, `verify_existing`, `needs_more_information`, `supporting_evidence`, `blocked` (+ existing). **Per-basis verification:** a document can aggregate several independent bases (verified hazard trigger + heuristic coastal-flag association); each basis is judged on its own rule's verification, so a verified basis stays `required` regardless of rule evaluation order while a heuristic basis caps at `likely_required`. Compliance posture (`verify_existing` / `supporting_evidence`) follows the winning basis. Heuristic bases carry a `heuristic:requires_regulatory_review` trigger fact. `verify_existing` mapping by `businessStatus` (existing → verify; new → required as new filing; unknown → required with posture-neutral reason). `missingFacts`, `confidence`, `triggerSummary` on every classified requirement. `bucketForApplicability()` + `labelForApplicability()`. |
| `frontend/src/app/kb.ts` | `buildEngineInput` emits `factMeta` (business vs project scope). Classifier receives `businessStatus`. `UIRequirement` carries `missingFacts`, `confidence`, `triggerSummary`. |
| `frontend/src/kb/rules.json` | 229 rules retuned (see §4), 3 rules added (RULE_0647–0649). 641 → 644 rules. |
| `frontend/src/app/ai/intake/projectContext.ts` | New keys: `land_disturbance_acres` (numeric), `grading`, `excavation`, `part_of_larger_common_plan`, `parking_changes`, `loading_changes`, `property_tenure`. |
| `frontend/src/app/api/intake/interpret/route.ts` | Prompt teaches the 7 new fact keys (incl. "interior floor area is NOT land disturbance", "never infer tenure"). |
| `frontend/src/app/SmartPRIntake.tsx` | Badges for new statuses; counts/agencies/mandatory use `bucketForApplicability`; non-confirmed items get no filing action. |
| `frontend/src/app/i18n.ts` | ES (PR) labels: Probablemente requerido, Verifica tu registro actual, Se necesita más información, Documento de apoyo. |
| `frontend/src/app/requirementsAudit.test.ts` | Regression tests CASE A–G (new). |

## 3. Graph relationships changed

- No nodes or edges removed. `rule_type` semantics unchanged; the five
  `municipality` rules keep firing on municipality selection, but their
  *meaning* is now compliance-mode-aware (verify vs. file-new).
- 216 `municipality_flag` + `business_type` edges annotated
  `verification: "heuristic"` — they remain in the graph as planning
  associations, but the classifier refuses to present them as confirmed.
- 3 new `project_fact` edges: land disturbance → stormwater (verified),
  tenure=leased → lease (supporting evidence), tenure=owned → deed
  (supporting evidence).
- Suppression edges: `negated_fact_keys` (e.g. `site_work=false` suppresses
  the stormwater heuristic).

## 4. Rules removed / added

- **Removed: 0.** Nothing was deleted; unverified rules were demoted to
  heuristic, never silently dropped (auditability).
- **Added: 3** — RULE_0647 (land_disturbance_acres ≥ 1 → Stormwater Plan,
  verified against the EPA CGP 1-acre threshold), RULE_0648
  (property_tenure=leased → Lease Agreement, supporting evidence), RULE_0649
  (property_tenure=owned → Property Deed, supporting evidence).
- **Retuned: 229** — 5 universal rules → `verify_existing`; 1 lease rule →
  `supporting_evidence`; 7 bare-flag rules → `heuristic` + missing/negated
  facts; 216 flag+type combos → `heuristic` + missing facts. Every retuned
  rule carries `reviewed_at: 2026-09-16`, a `change_log` entry preserving the
  previous behavior, and a `trigger_summary`.

Per-rule detail (rule / document / trigger / change / reason / basis):
`specs/requirements-engine-audit-2026-09-16-rules.md` (232 entries).

## 5. Requirement status semantics (new)

`REQUIRED` · `LIKELY_REQUIRED` · `VERIFY_EXISTING` · `CONDITIONAL` ·
`NEEDS_MORE_INFORMATION` · `SUPPORTING_EVIDENCE` · `NOT_APPLICABLE` ·
`BLOCKED`. Every requirement also carries `triggering_facts` (with rule id),
`missing_facts`, `confidence` (0.9 verified winning basis / 0.5 heuristic
winning basis / 0.4 unresolved), and a `trigger_summary`. A requirement whose
only explanation would be "Municipality selected" now renders as
VERIFY_EXISTING for an existing business, or REQUIRED with a posture-neutral
reason ("verify your existing registration; file if not yet registered") when
business status is unknown — the obligation is certain, only the posture is
not. It never tells an existing business to file a new application.

## 6. Migration requirements

- **Snapshot republish.** If a KB snapshot is published in production
  (`/api/kb`), `rules.json` changes do not take effect until the snapshot is
  regenerated/republished from the seed (the `rk` compile path). Bundled
  fallback picks the new rules up on next deploy.
- **No DB migration.** Rule metadata lives in the JSON seed / snapshot.
- **No breaking API changes.** New fields are additive; UI handles unknown
  statuses via `bucketForApplicability`.

## 7. Regression tests added

`frontend/src/app/requirementsAudit.test.ts` — CASE A (Guaynabo renovation:
no required SAM.gov/contractor/lease/stormwater/noise; merchant = verify
existing; construction permit = required; RULE_0269 suppressed), CASE B
(contractor BT → license required), CASE C (1.5 ac → stormwater required via
RULE_0647), CASE D (leased → lease as supporting evidence), CASE E (owned →
deed, no lease), CASE F (federal=false → no SAM.gov), CASE G (existing →
merchant verify_existing; new → required), plus numeric-matcher unit tests.

## 8. Expected output for the Guaynabo example (now emergent, not hardcoded)

- **REQUIRED:** OGPe Construction Permit (project_type=renovation/expansion,
  interior_demolition, electrical/plumbing work — verified project_fact rules).
- **VERIFY_EXISTING:** Merchant Registration, Patente Municipal, Municipal
  Registration, Tax Compliance Certificate, Annual Report.
- **CONDITIONAL / NEEDS_MORE_INFORMATION:** Permiso Único / Zoning (use
  authorization depends on occupancy/use change), stormwater (needs
  land_disturbance_acres — suppressed as a requirement while site_work=false),
  parking/loading/noise (heuristic, needs evaluation).
- **NOT TRIGGERED:** SAM.gov, DACO Contractor License, generic Professional
  License, Lease Agreement (tenure unknown → ask, not require).

## 9. Remaining rules requiring legal/regulatory review

All 223 heuristic rules (`verification: "heuristic"`) are flagged in-graph
and need verification against the actual municipal ordinances / agency
sources before any can be promoted to verified. Priority order:

1. The 7 bare-flag rules (RULE_0267/0269/0270/0271/0287/0299/0507) — these
   were the direct over-triggers.
2. The ~216 flag+type combos — spot-check the highest-frequency business
   types first (restaurants, bars, contractors, auto repair).
3. The 1-acre stormwater threshold (RULE_0647) encodes the EPA CGP threshold;
   confirm Puerto Rico's authorized program (PR EQB/DNER) applies the same
   threshold before treating as settled law.
4. Annual Report rule (RULE_0636) in light of Law 65-2025 — verify current
   Dept. of State annual obligations.
5. San Juan autonomous-municipality rules (RULE_0287 + SAN_JUAN review
   conditions) — verify against the Municipio Autónomo's current permitting
   regulations.

## 10. What was deliberately NOT done

- No rules deleted (demote, don't destroy — auditability).
- No invented regulatory logic: every new trigger cites its basis; anything
  unverifiable is marked heuristic.
- No change to the `municipality` rule_type's firing semantics — the fix is
  in what the firing *means* (compliance posture), which preserves the
  "every PR business has a municipality" baseline without lying about it.
