# First bounded regulatory correctness diff

Base: `db8e748aeb7f71dc5ef49bfc2e178dae62bf0653`, independently fetched from `origin/main` on 2026-09-12. Branch: `fix/regulatory-correctness-first-pr`. The Desktop checkout was behind this base; the separate SmartBusiness checkout contained unresolved user changes. Neither working tree was edited. This branch uses an isolated worktree.

The complete supplied report and supporting evidence were examined as audit hypotheses. All five requested failure families reproduce against the fetched base. No live production data was examined. No routes, schema initializers, database seeders, publishers, scheduled batches, merges or deployments were invoked. `determineObligations` tests use a fake accepting exactly one snapshot SELECT; there is no database connection.

## Completed corrections

| Finding | Reproduced failure / root cause | Correction | Completed regression evidence |
| --- | --- | --- | --- |
| F01 | Municipality baseline emits incorporation; two independent formation filters retain it for a sole proprietor. Persisted obligations bypass the filters entirely. | The existing formation policy excludes both corporate and LLC formation certificates for sole proprietorships and ordinary partnerships. Augmentation delegates to that policy; persisted obligations apply it using the profile's existing entity-type adapter. | Sole-proprietor and partnership exclusions; unchanged EIN; corporation positives for four supported corporate forms; unknown UI entity stays conditional; bundled and compiled-snapshot persisted obligations tested. Existing LLC augmentation tests pass. |
| F05 | A document-wide coastal mapping demotes an inland hazardous-material trigger. A negative coastal decision suppresses it. Deduplication retains only one explanatory basis, making naive fixes order-dependent. | Engine output retains all matched rule IDs/reasons. Classifier evaluates each matched basis and keeps any independent required basis; chooses a surviving explanatory basis. Existing facade capital-to-historic site confirmation is preserved. | Hazard true in Adjuntas and San Juan, four coastal decisions, both rule orders; negative hazard/no independent trigger; coastal-only conditional, affirmative and negative cases. Existing historic review tests pass. |
| F07 (monthly cadence scope) | Seed builder drops the bundled renewal extension; compiled snapshots contain no monthly room-tax renewal. | Seed renewal nodes with stable identity and project existing metadata through the existing compiler. Correct the renewal citation to the independently checked Art. 28(A)-(B). | Seed→compile field parity and fake-snapshot→obligation monthly cadence; tourism registration remains one-time; no room-tax obligation for the negative rental case. |
| F09 | Separate snapshot renderer drops select options, uses stale aliases and repeats employee count. | One renderer for both sources; canonical keys take precedence for known questions; custom keys/raw IDs remain supported; options retain exact values; profile exclusions and duplicate suppression apply to both sources. New seeds also carry canonical keys/stages. | Exact discovery-list parity for all 141 business types, including order/options; older seed metadata and custom select values. |
| F06 | Generated industry/geographic scope evaluations count as complete statutory eligibility; 23 zero-criterion programs yield likely/100. | Without required, material, non-scope criteria, results cannot be likely or guaranteed; eligibility confidence is zero, and the explanation explicitly says “needs review.” Known scope/lifecycle exclusions remain excluded. | All 23 affected programs; empty, scope-only and optional-only definitions; known exclusions; existing fully specified synthetic positive, negative, evidence and missing-fact cases pass. |

“Required” in F05 tests means preservation of an existing deterministic rule result. It is not verification that every hazardous-material activity legally requires this generic permit. F06's minimum substantive-criterion check is not a completeness certification for programs that have one or more criteria.

## Validation

Run from `frontend`: `npm ci --ignore-scripts`, then `npm run test:regulatory-correctness`.

- Final regression file against the untouched baseline implementation: **19 tests, 3 pass, 16 fail**. Failures include each requested finding; no import/setup failures.
- Corrected focused suite: **145 tests, 145 pass, 0 fail** (19 new tests plus 126 existing tests).
- Targeted ESLint: passes.
- `git diff --check`: passes.
- Full `tsc --noEmit`: **not clean**. Both baseline and changed worktrees report the identical pre-existing `src/app/forms/artifacts/lumaint01.e2e.test.ts:112:67` TS2345 (`string | undefined` passed as `string`). No new diagnostics were reported. This diff does not repair that unrelated test.
- No production route checks, browser end-to-end checks, live database tests or production migrations were performed. Passing code tests do not establish regulatory accuracy.

## Regulatory evidence and limits

Checked 2026-09-12 against official government publications. No legal obligation was added to improve coverage.

**F01:** [OGP's Act 164-2009, revised July 31, 2025](https://bvirtualogp.pr.gov/ogp/Bvirtual/leyesreferencia/PDF/Corporaciones%20Privadas/164-2009/164-2009.pdf), Art. 1.01(C), 14 L.P.R.A. §3501 (PDF p.2), addresses persons choosing to form a corporation by filing its certificate; Art. 19.12, §3962 (p.162), separately addresses LLC formation. The general effective date is January 1, 2010, Art. 22.06 (p.199). The fix distinguishes the applicant's legal form from its business activity or municipality: an unincorporated proprietor/ordinary partnership is outside those formation transactions. Existing formed-entity evidence, foreign authorization and other registrations require separate review; no exemption from those duties is asserted. [Estado's current corporate registry explanation](https://www.estado.pr.gov/corporaciones) corroborates the entity distinction. Complete amendment/case-law review beyond the cited provisions remains outside this diff.

**F07:** [OGP's Act 272-2003, revised April 15, 2024](https://bvirtualogp.pr.gov/ogp/Bvirtual/leyesreferencia/PDF/Turismo/272-2003/272-2003.pdf), Art. 28(A)-(B), 13 L.P.R.A. §2271s (p.16), requires monthly remittance/declaration by the following month's tenth day for covered innkeepers. Art. 26 concerns identification/registration; Art. 27 collection responsibilities. Art. 69 makes the act effective 180 days after approval, except Art. 31. [Tourism's current room-tax instructions](https://tourism.pr.gov/room-tax/) corroborate monthly filing for the described short-term rental activity. The PR innkeeper/activity scope is distinct from all property owners; statutory exclusions, intermediary collection and individual exemption claims need separate review. This change preserves cadence, not a complete deadline engine: day-ten scheduling, exemptions and prerequisites are not newly implemented.

**F05:** No new environmental predicate or exemption is asserted. Applicant/activity/permit subtype, discharge/material thresholds, site jurisdiction, exceptions and effective dates for the broad existing environmental rule remain **needs review** under F15/F16. An unrelated coastal decision supplies no evidence to negate a separately matched basis.

**F06:** No program-specific eligibility law is added or certified. [DDEC's official program guidance](https://www.desarrollo.pr.gov/ayudas-e-incentivos) supplies program-specific conditions rather than a general industry-only entitlement. Exact provisions, applicant/project scope, exclusions, prerequisites and effective dates for each static program remain **needs review**. Synthetic positive tests establish engine behavior only.

**F09:** A data-contract/UI correctness change; no regulatory content change.

## Future production implications — not executed

- F01/F05: corrected runtime results do not retroactively reconcile saved checklists, obligations or reminders. A future reviewed migration must identify the original facts, retain user evidence/history, and recompute safely. The raw matcher is still a predicate evaluator; complete UI/server parity is F10.
- F07: `seedRkGraphIfEmpty` does not update an already populated graph. Existing graphs need a reviewed renewal-node proposal and a new validated snapshot, never a forced reseed. Existing obligations need separate cadence reconciliation. This diff includes no migration or publication.
- F09: new snapshots get corrected seed metadata; the renderer also handles old seeded aliases. Already saved answers under old aliases need compatibility review before any rewrite. Snapshot-empty fallback and published industry authority remain F11/F07 follow-ups.
- F06: new evaluations become conservative immediately when this code is eventually deployed. Saved incentive assessments must be invalidated/recomputed in a future approved rollout. Programs with some criteria still need independent completeness review; static override authority remains F11.

Publication-integrity work belongs in a separate second PR; it is not bundled here. See `tracker.md` for all audit findings and the required transaction/semantic acceptance cases.
