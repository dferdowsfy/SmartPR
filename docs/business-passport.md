# Business Passport (enter-once autofill)

SmartPR’s **Business Passport** is the durable, business-scoped slice of
`CanonicalApplicationData`. Users and gestores enter core entity facts once;
those fields stamp every applicable government artifact, worksheet, checklist,
and package deliverable.

This is **not** a parallel profile system. Forms already declare
`canonicalField` ids; population reads those ids from the passport-backed
canonical object via `readCanonicalField` (empty → unanswered, never invented).

## Source of truth

| Surface | Role |
| --- | --- |
| `/businesses/[id]` → Business Passport panel | Edit + save `businesses.passport_json` |
| Intake → Core Application Details (`passportMode`) | Same field set; autosave writes passport |
| `POST /api/forms/artifacts/[formCode]/populate` | Prefers passport when `businessId` is set |
| Sample worksheets (SAM, Hacienda prep, etc.) | Prefill via `worksheetPrefillFromPassport` |

Denormalized columns (`legal_name`, `municipality`, `physical_address`,
`business_structure`, `entity_number`) stay in sync for list views.

## Autofilled now (from passport when mapped)

- **Estado:** CORPREG01 / CORPLLC02 / NC001 — legal name, DBA, entity type, addresses, contact, registry pointers
- **IRS:** SS-4 — legal/trade name, entity type, addresses, start date, employees, owner
- **Municipal patente family:** PA01–PA04 — legal/trade name, EIN, addresses, municipality, owner, employees
- **Hacienda SC 2309:** identity + address + activity flags when present
- **DACOUC01:** identity/address fields present in the overlay map
- **SAM / DACO worksheets & admin letter:** legal name, DBA, EIN, NAICS, addresses, contact, entity type

## Still manual (by design)

- Sensitive personal tax IDs (`owner.tax_id` / SSN) — never stored or autofilled
- Per-filing answers (capital stock, members lists, attestations, filing year, patente type, licence checkboxes beyond profile activities)
- Agency portal submission (SmartPR does not auto-submit)
- OGPe / Salud / Bomberos official PDFs (follow-up #3) — worksheets may prefill identity only
- Evidence locker / issued certificates — see `docs/evidence-locker.md` (SmartPR build #2)

## Refresh path

Working copies are generated on demand from the **current** passport. After
saving the passport, regenerate/download artifacts to pick up new values.
Prepared intake forms that referenced changed canonical keys are flagged
**Needs refresh** (existing write-back behavior).

## Schema

`businesses.passport_json JSONB` — added idempotently by `ensureSchema()` /
`COMPLIANCE_SCHEMA_SQL`. Railway needs no special one-off migration beyond a
normal deploy that boots the app (schema bootstrap runs on first DB touch).
