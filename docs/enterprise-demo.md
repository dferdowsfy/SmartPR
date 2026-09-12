# Enterprise demo

Route: `/demo/enterprise`. No customer account or database is required. This route is part of the existing Next.js app, not a separate prototype.

## Recording sequence (4:45)

| Time | Click / action | Point to make |
| --- | --- | --- |
| 0:00–0:35 | Open the route; show the Guaynabo overview | Existing industrial facility, 120 employees, operational expansion. 60% is three verified requirements out of five supported requirements, not a claim of legal clearance. |
| 0:35–1:05 | Project profile; toggle construction off and back on | Actual structured facts change the real rules engine output. The construction candidate disappears and returns; it remains subject to human review. |
| 1:05–2:00 | Requirements; expand “Why do I need this?” on Permiso Único; open Source & change history | Show project conditions, the specific regulatory explanation, next action, recorded source verification, and version. Mention unsupported matches stay out of active requirements. |
| 2:00–2:45 | Evidence & gaps; Inspect Zoning / Use Certification; Link sample evidence; Verify sample evidence; close | Required → evidence → verification → readiness. Linking earns zero; verification changes readiness from 60% to 80%. These are clearly fictional evidence records. |
| 2:45–3:35 | Government forms; Open government form; enter 2026 in Contributive year; scroll to Business identification; Preview draft | A separate Bayamón Warehouse annual PA01 example uses the real form registry, schema renderer and canonical mapping. Data is reused. Financial schedules and signatures are still the filer’s work. No form is filed. |
| 3:35–4:10 | Regulatory updates; explore proposed, enacted-not-effective and effective states | Explicitly fictional regulatory event. Review, effective date and publication are distinct. Clicking explanatory states changes zero requirements. |
| 4:10–4:45 | Portfolio; open another facility; return to Portfolio | Same engine across five fictional projects; separate evidence state and internal review targets. No invented legal deadlines or live legislative events. |

Before every recording: Reset demo → Reset demo. Refresh also resets the in-memory session. Desktop is the primary recording layout; narrow screens use wrapped cards and horizontally scrollable tables/navigation.

## Reuse and isolation

- Actual `runRulesEngine`, `classifyEngineRequirements`, `buildRequirementGuidance`, `RequirementCard`, `ReadinessControl`, form registry/routing, `GovernmentFormRenderer`, `GovernmentFormPreview`, canonical prefill/writeback and validation.
- `readinessWeightFor` accepts an optional pinned weights map. Existing callers retain current live KB behavior. Demo uses the bundled pack’s equal weights, credits verified evidence only, and excludes applicability reviews.
- Demo clones the bundled Puerto Rico knowledge pack; it does not fetch admin-published snapshots. Each release pins its source data through the repository commit. No real accounts, document extraction, API writes, uploads or storage are involved.
- Exact `/demo/enterprise` skips session refresh. Other routes retain existing middleware. The demo has no production identifiers or customer API calls.
- Evidence records are deliberately fictional. This demonstrates requirement/evidence relationships and human verification, not a successful OCR run on real government certificates.
- Five project fixtures use the same applicability code. A Guaynabo construction toggle demonstrates re-evaluation without making unvalidated construction guidance into law.
- The regulatory panel uses the existing `LegalStatus` vocabulary but does not invoke the production proposal/publication services. No fabricated legal event, history, or effective date is represented as real.

## Coverage limitations

Guaynabo currently has five supported active requirements: EIN confirmation, merchant registration, Permiso Único, zoning/use certification, and CFSE coverage. Broad construction/environmental matches and Bayamón-only municipal source matches are shown as review candidates, excluded from the denominator. Do not present this as complete industrial permitting coverage. The saved verification date is the knowledge pack’s date, not a new legal verification.

PA01 is a separate existing-operation Bayamón example. It does not imply a Guaynabo construction form exists. The real schema intentionally leaves financial computation schedules and handwritten signature work to the filer. Draft data is retained only while the demo is mounted, and never satisfies permit evidence automatically.

## Branding preparation

The demo tenant configuration defines organization name/logo URL, accent, terminology, custom-domain placeholder and client/internal role vocabulary. Organization name/accent are consumed by the screen. This is a presentation configuration seam, not tenant provisioning, role authorization, domain routing, or a claim that white-label deployment is finished. SmartPR remains the underlying product.

## Verification

Run from `frontend`:

```sh
npm ci
node --import tsx --test src/app/demo/enterprise/model.test.ts
npx tsc --noEmit
npm run build
npm run start -- --port 4173
```

Tests cover matched-node provenance, municipality source scope, fact-driven rule changes, score progression, reset determinism, cross-project isolation, existing form routing/prefill/writeback, regulatory non-activation and exact-route auth independence. Browser QA and recording must be performed on a reachable running deployment.

Verified during implementation: all eight focused tests and TypeScript passed; production build passed and the production server returned HTTP 200 with the seeded overview. A mounted React interaction smoke test traversed all seven sections, toggled construction, linked/verified evidence, edited/previewed/validated PA01, explored regulatory states, navigated facilities, and reset state successfully. This does not substitute for desktop/mobile browser visual QA or a live video recording, which remain pending a reachable deployment.
