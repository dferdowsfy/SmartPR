# Regulatory remediation tracker

Updated 2026-09-12. Audit and fetched implementation base: `db8e748aeb7f71dc5ef49bfc2e178dae62bf0653`.

**Fixed** means the bounded first-PR failure was reproduced and corrected locally, not production-remediated or legally certified. **Deferred** means intentionally outside this first diff. **Blocked** is reserved for an external assurance prerequisite. **Disproved: none of the five requested failure families.** Other findings below remain audit hypotheses unless this tracker explicitly records current reproduction.

The first diff fixes F01, F05, F06, the monthly-cadence portion of F07, and F09. The individual findings contain broader follow-ups; none are erased by these code fixes. See `first-pr.md` for failures, root causes, tests, sources and migration implications.

## All numbered audit findings

| ID | Priority | Status | Audit hypothesis | Remediation / remaining acceptance |
| --- | --- | --- | --- | --- |
| F01 | P0 | Fixed (bounded scope) | Any selected municipality triggers incorporation; sole proprietorship survives both formation filters as mandatory. | Fixed for known sole/ordinary partnership forms in UI and persisted obligation mapping. Raw matcher remains a predicate evaluator; full formation lifecycle/consumer unification is F10. |
| F02 | P0 | Deferred | Universal federal EIN necessity exceeds the IRS criteria; single-owner LLC exception is not represented. | Source-review EIN federal criteria separately from locally evidenced application prerequisites; test single-owner LLC exceptions before changing baseline. |
| F03 | P0 | Deferred | CFSE is modeled but separate DTRH employer registration is absent from checklist catalog. | Independently verify employer roles, employment exclusions, DTRH/CFSE distinctions and recurring payroll filings; add positive/negative scenarios. |
| F04 | P0 | Deferred | Hacienda lists prerequisites not generated in tested restaurant/alcohol scenario; CRIM exists but no rule generates it. | Identify alcohol-license subtypes and applicant roles; source each certificate, alternative and prerequisite. |
| F05 | P0 | Fixed (bounded scope) | Document-level flag mapping downgrades an explicit hazardous-material trigger to conditional even in inland Adjuntas; not_applies can suppress it. | Independent matched environmental bases preserved; legal breadth of the existing hazard predicates still needs review under F15/F16. |
| F06 | P0 | Fixed (bounded scope) | Industry-only inputs produce likely_eligible with 100 confidence for 23 programs; legal criteria are missing. | Industry-only confidence fixed; statutory completeness for every program, including programs with some criteria, remains unverified. |
| F07 | P1 | Fixed (bounded scope) | Golden parity excludes renewals, industries and full UI behavior; monthly room-tax renewal disappears on seed compilation. | Monthly seed/compile/cadence loss fixed. Published industries, full extension parity and source-complete snapshot behavior remain deferred. |
| F08 | P1 | Deferred | Synthetic invalid references and invalid rule type are accepted; publication does not gate on full integrity. | SECOND PR: shared validation of the final proposed graph inside the publication transaction; see acceptance contract below. |
| F09 | P1 | Fixed (bounded scope) | Unchanged seed publication changes UI keys/stages; select options are dropped by snapshotDiscoveryQuestions. | Renderer/seed metadata parity fixed; saved legacy answers and explicit snapshot fallback policy remain F11/F24 follow-ups. |
| F10 | P1 | Deferred | Server uses raw engine output without intake resolver, formation augmentation/exclusivity or flag classifier; same facts can yield different obligations. | NEXT after publication integrity: one evaluator for checklist, obligation persistence and reminders, including resolver/classifier/formation semantics. |
| F11 | P1 | Deferred | Fallback and static overrides can revive outdated content; same-ID static incentives win over graph edits. | Define explicit snapshot authority and fallback policy; graph corrections/archive must replace static incentive IDs; do not revive withdrawn content. |
| F12 | P0 | Deferred | Children-presence Boolean triggers childcare licensing without a childcare-provider activity. | Verify licensed care activity, provider/applicant, ages and exemptions; children merely present is not a sufficient care predicate. |
| F13 | P0 | Deferred | Contractor registration agency and applicant role are wrong for DACO contractor registration; renovation customer need not be contractor. | Verify DACO contractor applicant scope versus renovation customer/owner, agency and prerequisite evidence. |
| F14 | P2 | Deferred | Legacy agency nomenclature persists without DRNA succession relationships; composite names are separate nodes. | Version DRNA succession and JCA/ADS aliases without claiming repeal of underlying duties. |
| F15 | P1 | Deferred | Flags are strings without source-backed geography edges. Metro/port/airport flags cannot establish site-specific thresholds alone. | Replace coarse locality inference only with source-backed site/activity/threshold tests; retain uncertain applicability for review. |
| F16 | P2 | Deferred | No direct rule-level citation/source; 173 merely inherit a document with guidance, which does not verify the trigger. | Build clause-level actor/activity/jurisdiction/exception/prerequisite/effective-date evidence for all predicates; do not bulk mark validated. |
| F17 | P2 | Deferred | 539 row differences, including 349 added and 2 removed rules; no automatic synchronization from future bundle edits into a populated graph. | Generate or explicitly retire divergent legacy JSON/SQL/Python sources; design populated-graph update policy. |
| F18 | P3 | Deferred | Four conditional entity-form dependencies collapse into four identical unconditional-looking edges; edge data does not retain conditions. | SECOND PR dependency contract: retain conditional/alternative groups; identical projected endpoints do not imply duplicate legal conditions. |
| F19 | P1 | Deferred | Registry can author mandatoriness, conditions and exemption nodes; permit matcher does not evaluate them. | SECOND PR: gate unsupported active executable semantics; retain review/draft authoring without implying execution. |
| F20 | P2 | Deferred | RULE_0612/0613/0614 compare select labels but reason always reports Yes. | All matched rule IDs/reasons now survive engine deduplication for F05; select explanation still says Yes and remains deferred. |
| F21 | P1 | Deferred | Compiler receives entity/type/data only; valid_from/valid_to and source-row provenance do not survive ordinary compile. Batch scheduling is not row validity. | Enforce temporal validity/source lifecycle; separately fix exact predecessor rollback lineage, republish version allocation and concurrency. |
| F22 | P2 | Deferred | Seed splits display strings, including private actors and composite organizations; canonical agency field is ignored. Referential resolution is not legal identity accuracy. | Separate government issuer, filing authority, preparer, insurer and applicant; canonical agency identity must drive display. |
| F23 | P1 | Deferred | Null jurisdiction/activity input broadens to all matching rows; case-sensitive names and a separate active publication path are not reconciled with RK. | Reconcile required-forms resolver with canonical scope; missing jurisdiction/activity must not broaden matches. |
| F24 | P2 | Deferred | buildEngineInput blocks direct known-question values where a default false exists; main resolver can compensate, but other callers differ. | Define explicit answer precedence for raw Q IDs, canonical keys, aliases and derived facts; test every consumer. |

## Unnumbered findings and assurance gaps

These supplementary tracker IDs are local identifiers, not IDs invented for the audit.

| Tracker ID | Audit location / evidence | Status | Required follow-up |
| --- | --- | --- | --- |
| S01 | Architecture / publishing; rollback predecessor and retained-version collisions | Deferred, second publication/temporal work | Persist exact prior active snapshot and row lineage; test publish→rollback→branch→rollback, republish and concurrent proposals against disposable Postgres. |
| S02 | D, strict enum consistency; `schema-enum-warnings.json` | Deferred, second PR | Reconcile the 40 existing document-category mismatches explicitly; validate real field types/enums instead of accepting seed shape as truth. |
| S03 | E warning 1 / F22: issuer vs preparer | Deferred | Model role distinctions and canonical agency display; do not equate name similarity with legal identity. |
| S04 | E warning 2: healthcare facility/professional scope | Deferred, source review | Verify institution/laboratory/professional/CNC scopes independently and test actors/exemptions. |
| S05 | E warning 3 / F15: municipality vs parcel | Deferred, source review | No historical district, discharge or industrial threshold inferred solely from town flags. |
| S06 | E warning 4: globally recommended permits | Deferred, source review | Verify activity-specific sign/seating duties and ordinance exceptions before changing mandatoriness. |
| S07 | E warning 5: documentation vs obligation | Deferred | Model SURI, merchant registration, zoning/occupancy/PU components with conditional prerequisites and alternatives; do not delete assumed duplicates. |
| S08 | E warning 6: business type vs activity answers | Deferred | Review 223 business-type predicates against activity definitions; preserve legitimate inherent activities, honor evidenced negative cases. |
| S09 | E warning 7: temporal/renewal/inspection/exemption coverage | Partly fixed / deferred | One monthly renewal now round-trips; statutory deadlines and other recurring duties require independent evidence. No invented rows for coverage. |
| S10 | E warning 8, D relationships; 84 disconnected nodes, 13 unasked questions, 6 no-rule documents | Deferred, trace review | Retain all 104 entity-level anomaly rows in `relationship-review.csv`; missing edges are not automatically legal omissions (e.g. LLC augmentation). |
| S11 | G: ignored industries / current guidance merged into old snapshots | Deferred, F07/F11 | Version-complete payloads and explicit fallback; test old snapshots, intentional empty arrays, withdrawals and disconnected/offline operation. |
| S12 | H: requirementGuidance wording assertion | Deferred | Audit reports one existing wording failure; not rerun/fixed by this bounded suite. Review desired uncertainty wording separately. |
| S13 | B/I: split source stores, implicit inference, rule-only evaluation, non-enforced graph semantics | Deferred, F10/F11/F16/F19 | Explicit authority and source/version identity; retire independent demo/requirement sources or document their limits. No graph traversal claims from resolved references alone. |
| S14 | D/H/J: actual production graph, transactions, active snapshot, deployed identity | Blocked for live assurance | Requires a transactionally consistent read-only export and deployed commit evidence supplied through a safe path. Existing mutation-prone routes are forbidden. No production result is claimed. |
| S15 | Current verification: full TypeScript baseline error | Blocked for clean full typecheck / unrelated repair deferred | Baseline and changed checkout have the same `lumaint01.e2e.test.ts:112` TS2345. Focused tests/lint pass; do not call full typecheck clean. |

`relationship-review.csv` preserves the full audit entity-level relationship list, with deferred status and owner finding. It is an inherited hypothesis queue, not a current live export. Per-rule legal assessments and source-assessment evidence remain in the original audit archive, indexed below; their classifications are not promoted to verified by this diff.

## Second PR: publication integrity acceptance contract

Status: **Deferred to a separate PR, not implemented in the first bounded diff.** Owner findings F08/F18/F19 and S02, coordinated with F21/S01.

1. One shared validator must examine the complete resulting graph, not proposals independently. Apply proposals under the publication transaction, validate before inserting/activating a snapshot or committing, and rollback the entire transaction on failure. All publish entry points must use it; impact previews are advisory.
2. Reject missing and wrong-type targets, mismatched `entity_id`/`data.id`, unsupported rule types, invalid scalar/list/enum values, and malformed executable fields. Test removal of a referenced target, same-batch creation of a valid target, and superseding a version without duplicating its logical entity.
3. Detect duplicate authored relationships with a semantic key including predicates/alternative groups. Preserve distinct conditional EIN formation dependencies and their conditions; do not reject the legitimate seed merely because four conditional dependencies project to identical unqualified edges.
4. Reject impossible mandatory prerequisite cycles. Preserve source↔document support cycles, compatibility cycles, and satisfiable conditional/alternative dependency paths. Do not apply a blanket DAG rule to the whole graph. Define the dependency semantics before cycle validation.
5. Enforce consistent supersession direction, identity, and lineage; reject contradictory or cyclic supersession. One-sided compatibility/conflict is not automatically invalid because the current model does not mandate reciprocity.
6. Unsupported mandatoriness/conditions/exemptions/inspection semantics must not be published as active executable requirements. Preserve explicit draft/needs-review outcomes; avoid silently dropping legal claims or pretending the matcher supports them.
7. Test rollback and atomicity using an isolated disposable database with no production credentials. A pure validator test alone does not establish that publication is transactionally gated. Do not call existing schema/seed/scheduled-publish helpers against any live database.

## Subsequent ordering

After the separate publication gate, prioritize F10 shared evaluation; F11 snapshot/fallback/incentive authority; F21/S01 temporal validity/rollback lineage. In parallel only when separately assigned, source-review F02/F03/F04/F12/F13/F14/F22. Then review the remaining predicates/municipal scope and retire/generate legacy datasets (F15/F16/F17/F23/F24). Every new obligation needs exact official provisions, actor/activity/jurisdiction/exceptions/prerequisites/effective dates, and independent positive/negative scenarios. Unknown legal outcomes remain needs review.

## Evidence lineage

The supplied Markdown report was read in full. Supporting artifacts examined include priority findings, adversarial probes, regulatory counterexamples, seed/compiler evidence, discovery drift, incentive probes/catalog and the relationship anomaly list. The code was independently inspected and new regressions were run on the fetched base; the original audit's dated judgments are not a legal oracle.

Original evidence location: `/Users/dariusferdows/Documents/Codex/2026-09-12/perform-a-rigorous-evidence-based-audit/outputs/`. `audit-evidence-index.json` records SHA-256 hashes of the supplied report and relevant evidence files for reproducible retrieval. No original evidence files were modified.
