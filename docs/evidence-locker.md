# Evidence locker (upload once, reuse)

SmartPR’s **Evidence locker** is the business-scoped reuse layer on top of the
existing `evidence` table and private Supabase `evidence` storage bucket.
Users and gestores upload a file once, tag the `DOC_` / requirement codes it
satisfies, and attach it to multiple agency asks without re-uploading.

This is **not** a second file store. Obligation uploads, import analysis, and
enterprise evidence versions continue to use the same rows and bucket.

## Source of truth

| Surface | Role |
| --- | --- |
| `/businesses/[id]` → Evidence locker panel | Upload, list, tag, download evidence ZIP |
| Requirement card → **Attach from locker** | Link an existing locker file to that obligation (adds its `requirement_id` tag) |
| Requirement card → **Upload** | New upload; auto-tags the obligation’s `requirement_id` when present |
| `POST /api/evidence` | Locker upload (`business_id`) or obligation upload (`obligation_id`) |
| `PATCH /api/evidence/[id]` | Set/replace tags, add tags, or attach to an obligation |
| `POST /api/businesses/[id]/evidence-package` | ZIP of locker files linked/tagged to that business’s requirements |
| Submission package ZIP (`generatePackageZip`) | Includes `evidenceFiles` metadata (+ binaries when supplied) |

## Tagging model

- Column: `evidence.requirement_tags TEXT[]` (GIN-indexed)
- Codes are normalized to uppercase `DOC_*`-style tokens
- A file **satisfies** an obligation when:
  - `evidence.obligation_id = obligation.id`, **or**
  - `obligation.requirement_id` is present in `requirement_tags`
- One file may carry many tags (e.g. `DOC_CONTRACTOR_LICENSE` supporting bond, ID, and insurance asks)

Obligation status derivation on the business profile uses the same link-or-tag
match when computing `evidence_state`.

## Filing package inclusion

`selectPackageEvidence(evidence, obligations)` returns each matching locker
file once, even when it satisfies multiple requirements. The business
**evidence ZIP** embeds those binaries under `evidence/` plus a `manifest.json`
listing `requirementCodes` and `inclusionReason`
(`obligation_link` | `requirement_tag` | `both`).

SmartPR still **does not** auto-submit to agency portals and does not send
locker emails from this feature.

## Schema

`ALTER TABLE evidence ADD COLUMN IF NOT EXISTS requirement_tags TEXT[] NOT NULL DEFAULT '{}'`
— applied idempotently by `ensureSchema()` / `COMPLIANCE_SCHEMA_SQL` (and
mirrored in `data/compliance_workspace_schema.sql`).

## Tests

`frontend/src/app/compliance/evidenceLocker.test.ts` covers tag normalization,
tag → obligation satisfaction, multi-requirement reuse without re-upload, and
package inclusion/manifest.

## Out of scope (follow-ups)

- OGPe / Salud / Bomberos prep packs (#3) — shipped; see `docs/ogpe-salud-bomberos-prep-packs.md` (locker tags + passport identity on checklists)
- Portal auto-submit, email delivery of packages, OCR auto-tagging
