# Mita agency rollout — working inventory

_Last updated 2026-09-25. This is a working inventory, **not** proof that any government filing
works. Source of truth: `verification`, `payment`, `launch` and `entry` on each config in
`frontend/src/lib/agency-runs/filingTypes.ts`, enforced by `verification.test.ts`._

## 1. Principles

- One flow = one agency × one filing variant, reached only from its own **rule-emitted** requirement.
- A mapped requirement is not a working workflow.
- **Verified** = an authorized human completed an actual filing through Mita and the portal
  confirmation is recorded on the config. No flow is verified today.
- Real flows ship behind a launch switch; non-launchable variants stay visible as
  "Not yet available". Requirements with no flow stay visible as "Not yet supported".
- Login, MFA, CAPTCHA, certification, signature, payment, final review and submission stay with
  the human (Take over). SmartPR chat never collects government passwords or MFA codes.

Status vocabulary: **mapped** (routing only) · **documented** (official guides, nothing seen) ·
**partially observed** (some live screens walked read-only) · **rehearsed** (observed screens
cloned into a fixture + browser test proving every request matches the visible step) ·
**verified** (real filing + recorded confirmation).

## 2. Corrections to the previous plan (2026-09-25 audit)

| Previous claim | What the code/KB actually shows |
| --- | --- |
| "Dept. of State LLC formation is reachable via `DOC_CERT_INCORPORATION`" | **Wrong.** `RULE_0001` emits `DOC_CERT_INCORPORATION` and *excludes* LLCs — it is the corporation requirement. LLCs get `DOC_CERT_ORGANIZATION` from `RULE_0651`, which no filing mapped, so LLC owners were never routed anywhere (and the run page hid unsupported requirements). |
| "The 2026-09-24 walkthrough is an LLC/new-entity flow" | It is a **corporation** flow: Incorporators, Officers, Capital Stock, $150 corporation fee. No LLC screen has been observed. |
| `DOC_CERT_INCORPORATION` "2 rules" | 1 rule (`RULE_0001`); the earlier count included an inherited citation. |
| `DOC_MERCHANT_REGISTRATION` "2 rules" | 1 rule (`RULE_0003`). |
| `DOC_ANNUAL_REPORT` "no rule" | `RULE_0636` emits it. It had no filing, and the router's annual-report branch was dead code. |
| `DOC_DBA_REGISTRATION` → "create a new entity" | Wrong — a trade name is not an entity formation. Removed; DBA stays "Not yet supported". |
| One config = "new entity (corp or LLC) **or** annual report", split by passport heuristics | Replaced by one config per variant. The heuristic could send an LLC through corporation screens. |
| Unsupported requirements hidden on the run page | Now visible (non-launchable). |

## 3. Classification of every filing variant

| Variant | Requirement → rule | Status | Launch | Payment feasibility |
| --- | --- | --- | --- | --- |
| **Dept. of State — Form a corporation** (`DEPT_STATE_CORPORATE_FILING`) | `DOC_CERT_INCORPORATION` ← `RULE_0001` | **rehearsed** | `MITA_FLOW_DEPT_STATE_CORPORATION`, **off by default** | Gov fee yes (~$150); card entered only in the registry's own step; no integration → human pays in portal |
| Dept. of State — Form an LLC (`DEPT_STATE_LLC_FORMATION`) | `DOC_CERT_ORGANIZATION` ← `RULE_0651`; `DOC_ARTICLES_ORGANIZATION` (no rule) | **mapped** | disabled | Same registry module; not observed for LLCs |
| Dept. of State — Annual report / fee (`DEPT_STATE_ANNUAL_REPORT`) | `DOC_ANNUAL_REPORT` ← `RULE_0636` | **mapped** | disabled | LLC annual fee $150 (Estado services page); registry module; prepay/voucher APIs agency-internal |
| OGPe — Permiso Único (`OGPE_PERMISO_UNICO`) | `DOC_PERMISO_UNICO` ← 33 rules | **partially observed** (pre-login only) | `MITA_FLOW_OGPE_PERMISO_UNICO`, on by default (preserves today; recommend off) | Non-refundable fees, card/ACH in portal per manual; no integration known |
| SURI — Register taxpayer (`SURI_REGISTER_TAXPAYER`) | `DOC_SURI_REGISTRATION` ← **no rule** (unreachable) | **documented** | `MITA_FLOW_SURI_REGISTER_TAXPAYER`, on by default (unreachable anyway) | No fee |
| SURI — Merchant registration (`SURI_MERCHANT_REGISTRATION`) | `DOC_MERCHANT_REGISTRATION` ← `RULE_0003` | **mapped** | disabled | Not researched |
| Demo rehearsal portal | synthetic | **rehearsed** (fictional) | admin / `?demo=1` | fictional |

Requirements marked `filing_portal` in the catalog with **no flow** (visible as "Not yet
supported"), by emitting-rule count: Health permit (68), Fire certificate (60), Professional
license (59), Background check (21), Workers' comp (18), Tourism registration (18), Hazmat handler
(18), OGPe construction permit (12), TSA known shipper / SAM.gov / Alcohol license (10 each),
Room tax, CRIM clearance, Import/export, IRS EIN, DTRH employer, Occupancy (≤5 each).

## 4. Selected flow — Dept. of State corporation formation

Chosen because it is the only real flow where the official entry point, the portal's own app
routes, and a recorded live walkthrough agree, and it is reachable from the correct rule.

### Entry point
- Official pages: statedepartment.pr.gov/registration-of-legal-entities names
  `rceweb.estado.pr.gov/en/law-entity`; estado.pr.gov/en/services/services-corporations names
  `rceweb.f1hst.com` (vendor host).
- `rceweb.estado.pr.gov` returned HTTP 503 to SmartPR's network (2026-09-25).
- `rcp.estado.pr.gov` serves the live registry app ("Puerto Rico Online"): its public bundle
  routes `/en/creationfilings/wizard` and `/en/creationfilings/thank-you`, calls
  `rceapi.estado.pr.gov`, and sends maintenance to `maint.f1hst.com` (same vendor).
- Config: `startUrl https://rcp.estado.pr.gov/en`, `domains [rcp.estado.pr.gov, rceapi.estado.pr.gov]`.
- **Unknown:** whether `rceweb` is a legacy alias or still the canonical creation host. Confirm with
  the Dept. of State (registropersonasjuridicas@estado.pr.gov, 787-722-2121 ext. 3702) before the pilot.

### What is implemented (`flows/deptStateCorporation.ts`, `flows/index.ts`)
- **Step catalog** (14 screens): login · Name Availability · General Information · Filer ·
  Designated Office · Resident Agent · Incorporators · Officers · Capital Stock · Supporting
  Documentation · Review Filing · Signatures · Payment · Thank You — each with heading patterns
  (EN/ES), route/hash when known, one distinctive control, and step kind.
- **Reconciliation:** every pause is checked against the catalog. Unrecognised screen →
  `unknown`; reported kind contradicting the screen (e.g. login fields on Signatures) → the
  catalog's human step or `unknown`; a requested field not on that screen → `unknown`.
- **Passport field map** with normalizers (entity class, profit type, name designation from the
  legal-name suffix, 10-digit phone, lowercase email, `Domestic` jurisdiction). Anything the
  passport cannot fill (purposes, incorporators, officers, capital stock, filer type) is asked,
  never invented. An LLC entity type never maps to "Corporation".
- **Recovery:** name unavailable (ask for a new name), PO box / unverifiable address (use physical
  street or ask), confirm-email mismatch, office phone re-entry, ≥2 officers, file-type limits,
  session expiry (login takeover), portal error page (`unknown`). A field the portal rejected is
  never re-seeded with the rejected passport value.
- **Launch switch** `MITA_FLOW_DEPT_STATE_CORPORATION` (off by default), enforced in filing
  resolution, the run API and `createRun`.

### Evidence vs unknowns
| Observed (read-only, 2026-09-24) | Not observed |
| --- | --- |
| Name Availability → Review Filing screens, fields, fee panel ($140 + $10 = $150), PO-box rejection, flaky confirm-email, officer-count discrepancy | Login screen, every validation message text (patterns are best-effort), Spanish headings, Signatures, Payment, Thank You / confirmation format, LLC and annual-report screens |
| Registry bundle (2026-09-25): wizard components in the same order, routes, payment API | Whether the live host accepts Browser Use traffic |

No screenshots or DOM captures of the walkthrough are in the repo — the playbook is the only record.

### Tests
- `flows/deptStateCorporation.test.ts` — catalog, detection, reconciliation, field map, recovery, prompt (16).
- `tests/dept-state-corporation.e2e.mts` (`npm run test:dos:e2e`) — real routing and real pause
  resolution against the fixture `/rehearsal-portal/dept-state`: switch off/on, login takeover and
  return, PO-box validation and recovery, data request, contradictory report on Signatures,
  changed screen → unknown, payment handoff (payee + portal amount), human submission →
  confirmation. 40/40 at 1440×860 and 390×844.

### Pilot (next, requires people)
1. Confirm the entry host with the Dept. of State.
2. Read-only re-walk from the Browser Use network: capture the login screen, real validation
   texts, Spanish headings, Signatures and Payment layout (stop before signing); update the
   catalog and fixture.
3. Internal dry run to Review Filing with a test entity (never sign/pay).
4. Supervised pilot with 1–3 consenting customers forming a corporation: set the switch on for
   them only, the human signs, pays and submits; record the confirmation on the config.
5. Only then set `verification.status = "verified"` with `confirmation {reference, recordedAt, recordedBy}`.

## 5. Payment feasibility

Two SmartPR-side instruments exist or could exist, and neither can pay a government fee today:

- **Stripe (integrated today for SmartPR subscriptions only):** `lib/billing/stripe.ts`,
  `/api/billing/checkout` (Checkout for plan prices), `/api/billing/webhook` (subscription and
  invoice events). It does not store reusable payment methods for other charges and holds no
  SmartPR credit balance.
- **SmartPR credit:** does not exist yet. If built, it is a SmartPR-side balance that can only
  pay SmartPR's own fees.

A saved Stripe payment method or SmartPR credit can pay **SmartPR's** fees (e.g. a per-filing
service fee, SmartPR as merchant of record, Stripe receipt/refund/reconciliation). It cannot be
entered into a government checkout.

| Agency | Who collects | Where the card goes | Authorized integration? | SmartPR path |
| --- | --- | --- | --- | --- |
| Dept. of State registry | PR Dept. of State | Registry's own Payments step → `rceapi.estado.pr.gov/api/transaction/submit/creationfiling` (card number / expiry / CVV in the portal's form) | **None found**: no hosted third-party checkout, no public or partner payment API; vouchers and payment plans are agency-internal | Human pays in the portal |
| OGPe | OGPe portal | In-portal checkout (card/ACH per manual) | None found; host returned 503 | Human pays in the portal |
| Hacienda / SURI | — | Taxpayer registration has no fee; merchant registration not researched | Unknown | — |

**Paying government fees through SmartPR would require**, per agency: a written agreement or
published program authorizing third-party payment initiation; a decision on who is merchant of
record (the agency, or SmartPR acting as payment agent, which raises money-transmission and
licensing questions); fee separation (government fee vs SmartPR fee as separate line items and
receipts); refund rules (e.g. OGPe fees are non-refundable); daily reconciliation against agency
receipts; and PCI scope review. Until an agreement exists, the only supported path is: pause at
the agency's payment screen, show payee and portal amount, and let the human pay directly. Mita
never improvises a payment route and never charges.

If an integration is ever authorized, the payment step must show the payee, amount, government fee,
SmartPR fee, funding source (a Stripe payment method reference or SmartPR credit), and require
explicit confirmation before any charge. Only Stripe IDs and non-sensitive display data (brand,
last 4) may be stored in payment settings — never card numbers, CVV, or portal credentials, and
nothing payment-related in the Business Passport.

## 6. Next filing variants (priority order)

1. **Dept. of State corporation — live pilot** (phases 1–5 above; human participation required).
2. **Dept. of State LLC formation** — read-only walk of the LLC path of the same wizard
   (step list is served per entity class); new catalog + fixture + test. Highest leverage:
   `RULE_0651` fires for every new LLC.
3. **OGPe Permiso Único** — 33 rules; needs a post-login walkthrough, uploads and payment
   handoff. Recommend flipping its launch default to off until its fixture/test exist.
4. **Dept. of State annual report / LLC annual fee** — two sub-variants; routes known
   (`/en/annualfiling/wizard`), nothing walked.
5. **SURI merchant registration** — rule-emitted; host unreachable from our network; needs
   payment research and a playbook.
6. **Health permit, Fire certificate, Professional licenses** — highest demand but each must
   first be checked for whether an online filing exists at all.

Federal filings (IRS EIN, SAM.gov, TSA) need a separate policy review before any automation.
