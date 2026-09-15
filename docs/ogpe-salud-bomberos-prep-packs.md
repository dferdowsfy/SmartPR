# OGPe / Salud / Bomberos prep packs (SmartPR build #3)

SmartPR ships **bilingual preparation checklists** for three high-frequency,
portal-first Puerto Rico requirements. Official standalone PDFs are not in
`frontend/RealForms/` — agencies expect electronic filing — so these packs help
users assemble submission-ready evidence even when e-file stays on agency
portals.

SmartPR **does not** auto-submit to portals, send package emails, or store
secrets in these artifacts.

## Packs

| Catalog code | Sample form key | Requirement | Channel |
| --- | --- | --- | --- |
| `OGPEWS01` | `permiso_unico` | `DOC_PERMISO_UNICO` | `agency_portal` (ogpe.pr.gov) |
| `SALUDWS01` | `health_permit` | `DOC_HEALTH_PERMIT` | `agency_portal` (often via OGPe Permiso Único) |
| `BOMBEROSWS01` | `fire_certification` | `DOC_FIRE_CERT` | `agency_portal` (CPI via OGPe; inspection in person) |

Each pack is `artifactType: smartpr_generated` / `sourceStatus: smartpr_generated`
in `frontend/src/app/forms/artifacts/catalog.ts`. Do **not** use the invalid
`agency_office` SubmissionChannel (that broke an earlier build).

## What users get

1. **Requirement card** — existing Prepare-application flow opens the deepened
   bilingual checklist (`getSampleApplication` / legacy codes in
   `jurisdictions/pr`).
2. **Business Passport prefill** — identity, address, and contact fields use
   `profileKey` + `worksheetPrefillFromPassport`.
3. **Evidence locker tags** — checklist rows name `DOC_*` tags
   (`DOC_LEASE_AGREEMENT`, `DOC_FLOOR_PLANS`, `DOC_CFPM`, `DOC_FIRE_CERT`, …)
   so supporting files uploaded once can be reused across obligations.
4. **Deliverables / ZIP** — prepared PDFs land under `Prepared_Applications/`
   in the submission package (same path as SAM / DACO worksheets).

## Gating

- **Salud** — only when existing rules already surface `DOC_HEALTH_PERMIT`
  (and `DOC_CFPM` when food-manager rules apply). No new applicability rules.
- **OGPe / Bomberos** — follow existing Permiso Único / fire-cert document
  rules and annual renewal cadence in `jurisdictions/pr`.

## Framing

Every pack states it is a **SmartPR preparation aid**, never an official
government form. After agency issuance, users upload the real certificate and
tag the matching `DOC_*` code.

## Tests

- `frontend/src/app/sampleApplicationForms.test.ts` — field coverage, EN/ES,
  passport-style prefill, non-empty PDFs
- `frontend/src/app/forms/artifacts/artifacts.test.ts` — catalog channel /
  requirement wiring for `OGPEWS01` / `SALUDWS01` / `BOMBEROSWS01`
