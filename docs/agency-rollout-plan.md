# Mita agency rollout plan

_Last updated 2026-09-25. Source of truth for status: `verification` on each entry in
`frontend/src/lib/agency-runs/filingTypes.ts`, enforced by `verification.test.ts`._

## 1. Principle

A requirement mapped to a filing is **not** evidence that the government workflow works.
A filing is only "verified" after a real filing ran from start to the human's submission and
the portal's confirmation, with the evidence recorded below. Everything else is labelled
"early access" in the filing picker and pauses safely whenever the portal differs from what
Mita expects.

## 2. Safety model every flow inherits (shipped with the rehearsal fix)

| Rule | Where it is enforced |
| --- | --- |
| On every pause the agent reports the visible step: `PORTAL_STEP: kind=…; title=…; missing=…` | `taskPrompt.ts` |
| Chat inputs render only for `form` / `identity` steps; everything else is a "your turn in the browser → Take over" card | `portalStep.ts` → `store.ts` → `AgencyChat.tsx` |
| Unknown or contradictory state (e.g. login fields reported on a certification page) → `unknown` → pause + Take over, never a guessed form | `resolvePauseState` |
| No hard-coded login fallback; SmartPR never collects portal passwords or MFA codes | `pendingFields.ts`, `isCredentialField`, playbook invariant test |
| Human-only: login, MFA, CAPTCHA, certification, signature, payment, final review, submission | prompt HARD RULES; playbook login steps must be `IN_BROWSER` |
| Mita never submits — "File it for me" is disabled server-side (`AGENT_FINAL_SUBMIT_ENABLED = false`, API returns 403 `human_submission_only`) | `store.ts`, `authorize/route.ts` |
| No `type="password"` inputs in chat; sensitive values are masked text with password-manager opt-outs | `AgencyChat.tsx` |

## 3. Audit — what exists today

### 3.1 Browser filings

| Filing | Requirement IDs | Reached by users? | Evidence | Status |
| --- | --- | --- | --- | --- |
| Demo rehearsal portal | `demo:rehearsal-filing` | Admin / `?demo=1` | End-to-end browser test: login takeover → form → SSN → certification takeover → unknown pause → human submit → confirmation (desktop + phone) | **rehearsal (working)** |
| Dept. of State — new entity (`DEPT_STATE_CORPORATE_FILING`) | `DOC_CERT_INCORPORATION` (2 rules), `DOC_ARTICLES_ORGANIZATION` (0 rules) | Yes, via `DOC_CERT_INCORPORATION` | Read-only live walk of the creation wizard 2026-09-24, stopped at Signatures. Never observed: payment, signature, submission, confirmation, validation errors | **partial** |
| OGPe — Permiso Único (`OGPE_PERMISO_UNICO`) | `DOC_PERMISO_UNICO` (33 rules) | Yes — highest demand | Pre-login screens only (2026-09-15); all post-login steps from OGPe's manual | **partial** |
| SURI — Register taxpayer (`SURI_REGISTER_TAXPAYER`) | `DOC_SURI_REGISTRATION` (0 rules) | **No** — no rule emits the requirement | Hacienda's written guide; live host timed out | **documented** |
| SURI — Merchant registration (`SURI_MERCHANT_REGISTRATION`) | `DOC_MERCHANT_REGISTRATION` (2 rules) | Shown as "not yet supported" (disabled, no playbook) | None | **documented** |

**No real government filing is verified end to end.**

### 3.2 Online-filing requirements with no browser flow

The document catalog (`src/kb/documents.json`) has 80 documents; 22 are marked `filing_portal`.
Only 4 of those 22 map to a filing above. By how many engine rules emit them:

| Rules | Requirement | Agency |
| ---: | --- | --- |
| 68 | `DOC_HEALTH_PERMIT` | Departamento de Salud |
| 60 | `DOC_FIRE_CERT` | Cuerpo de Bomberos |
| 59 | `DOC_PROFESSIONAL_LICENSE` | Juntas Examinadoras (Estado) |
| 21 | `DOC_BACKGROUND_CHECK` | Policía de Puerto Rico |
| 18 | `DOC_WORKERS_COMP` | CFSE |
| 18 | `DOC_TOURISM_REGISTRATION` | Compañía de Turismo |
| 18 | `DOC_HAZMAT_HANDLER` | DRNA |
| 12 | `DOC_OGPE_CONSTRUCTION_PERMIT` | OGPe |
| 10 | `DOC_TSA_KNOWN_SHIPPER`, `DOC_SAM_REGISTRATION`, `DOC_ALCOHOL_LICENSE` | TSA, SAM.gov, Hacienda |
| ≤5 | `DOC_ROOM_TAX_RETURN`, `DOC_CRIM_CLEARANCE`, `DOC_IMPORT_EXPORT_REG`, `DOC_EIN`, `DOC_DTRH_EMPLOYER_REG`, `DOC_ANNUAL_REPORT`, `DOC_OCCUPANCY` | various |

These are mapped to agencies, **not implemented**. Several (SAM.gov, TSA, IRS EIN) are federal
and need their own policy review before any automation.

### 3.3 Discrepancies found

1. Dept. of State URL: the header note in `filingTypes.ts` says URLs were verified against
   `rceweb.estado.pr.gov`; the config uses `rcp.estado.pr.gov/en`. From our environment that
   host serves only a JavaScript shell titled "Puerto Rico Online".
2. SURI (`suri.hacienda.pr.gov`) redirect-loops and OGPe (`sbp.ogpe.pr.gov`) returned 503 from
   our environment — reachability depends on network/geo and must be checked from where
   Browser Use runs (US residential proxy).
3. `DOC_CERT_INCORPORATION` is `form_pdf` in the catalog but routed to an online wizard.
4. `filingTypes.ts` says `DOC_ANNUAL_REPORT` has no document entry and no rule; the catalog
   has the document and one rule references it. The annual-report variant has no playbook.
5. `DOC_SURI_REGISTRATION` and `DOC_ARTICLES_ORGANIZATION` are mapped but never emitted.

## 4. What every agency × filing flow must ship (the flow contract)

One flow = one agency + one filing variant (e.g. "Dept. of State — LLC formation", not
"Dept. of State"). Each flow is a separate, independently testable unit:

1. **Official entry point** — start URL + allowed hosts, with the official page that links to
   it and the date checked.
2. **Step catalog** — every screen in order with its detection signals (URL pattern, visible
   heading, one distinctive control) and its step kind (`login | mfa | captcha | form |
   identity | upload | certification | signature | payment | review | submission`).
3. **Field map** — portal label → Business Passport path, format/normalizer, required flag,
   sensitive flag. Credentials never appear.
4. **Human handoffs** — which steps are human-only and what the chat card says for each.
5. **Error recovery** — known validation messages and their fix; timeouts; session expiry;
   "portal changed" → `unknown` → Take over.
6. **Confirmation capture** — where the reference number appears and its format.
7. **Fixture + test** — a rehearsal clone of the recorded screens (as `/rehearsal-portal`
   does, each page declaring `data-smartpr-step`) driven by a browser test like the Mita
   rehearsal test, plus prompt/playbook unit tests.
8. **Kill switch** — `enabled: false` stops new runs immediately.

## 5. Pilot: one real flow

**Candidate: Dept. of State — new-entity (LLC) formation.** It is the only real flow with a
live walkthrough, users reach it today (`DOC_CERT_INCORPORATION`), and its human gates
(signature, payment, submit) are clear.

| Phase | Work | Exit criteria |
| --- | --- | --- |
| 0. Confirm entry point | Resolve `rcp` vs `rceweb`; record the official link and date | URL + source in the config |
| 1. Re-walk read-only | From the Browser Use network, walk the wizard to Signatures; capture each step's detection signals and field labels | Step catalog + field map complete for every screen before Signatures |
| 2. Fixture | Clone those screens into rehearsal fixtures; extend the browser test to them | Test green: every chat request matches the visible step; unknown screens pause |
| 3. Internal dry run | Test entity, stop before signature/payment | Prefill accuracy ≥ 95% of mapped fields; zero wrong-step requests; zero credential requests |
| 4. Live pilot (1–3 consenting customers who are forming an LLC) | Human signs, pays and submits; Mita reports the confirmation | Confirmation captured; no agent-performed human-only action; every run reviewed |
| 5. Promote | Set `verification: { status: "verified", evidence, checkedAt }`; remove the early-access label | Evidence recorded here |

Pilot metrics (per step): unknown-state pauses, takeovers, stuck streaks ≥ 3, validation
errors, time to pre-submit review.

## 6. Expansion order (one flow at a time, each through phases 0–5)

1. **OGPe Permiso Único** — highest demand (33 rules); needs post-login walkthrough, uploads
   and payment handoffs.
2. **SURI merchant registration** — emitted by rules; needs a playbook and a reachable host.
3. **SURI taxpayer registration** — only after an engine rule emits `DOC_SURI_REGISTRATION`.
4. **Dept. of State annual report** — new variant: needs its own playbook, not the formation one.
5. Next by demand from §3.2 (Salud, Bomberos, Juntas Examinadoras…), each assessed first for
   whether an online filing exists at all.

A flow does not start until the previous one reached phase 4.
