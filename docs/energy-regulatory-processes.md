# Energy-sector regulatory processes (Puerto Rico)

SmartPR's knowledge model was document/permit-centric (`kb/rules.json` maps a
trigger to a required document). This extension adds a general
**RegulatoryProcess** layer so any regulated domain (energy first; telecom,
environmental, healthcare, utilities later) is pure KB data.

## Model

| Entity | Where |
|---|---|
| `RegulatoryProcess` (`process_type` ∈ permit, license, registration, certification, interconnection, incentive, inspection, filing, approval) | `frontend/src/kb/regulatory_processes.json` → `processes` |
| `ProjectType` (classifier + signals) | `project_types` |
| `Requirement` (evidence ids, `applies_when`, source citation) | `requirements` |
| `EvidenceType` (`DOC_*`, same tag vocabulary as the evidence locker) | `evidence_types` |
| `IncentiveLink` (never a requirement) | `incentives` |
| `RegulatorySource` (URL, authority, citation, dates, confidence, status) | `frontend/src/kb/regulatory_sources.json` |

Edges built by `src/app/processes/graph.ts`: `has_project_type`, `may_require`,
`administered_by`, `requires`, `satisfied_by`, `derived_from`,
`prerequisite_for`, `may_qualify_for`, `has_eligibility_requirement`, and
`aliases_document` (legacy permit documents such as `DOC_LUMA_INTERCONNECTION`
map to the process that owns them, so existing rules/cards keep working).

## Reasoning (`src/app/processes/engine.ts`)

Facts come from the existing xAI intake (`projectContext`, validated against
the user's own words) or from inline answers. Conditions are three-valued:
an unknown controlling fact yields `NEEDS_FACT` plus a clarifying question.
Per process: gate → exceptions → source-backed trigger rules → `REQUIRED` /
`POTENTIALLY_REQUIRED` / `NEEDS_FACT` / `NOT_REQUIRED`. Requirements are
`SATISFIED` / `MISSING` against uploaded `DOC_*` evidence; readiness and gaps
follow. Each process carries an explanation path: fact → trigger →
classification → process → source → agency (+ municipality/jurisdiction).

Incentives are evaluated separately as `POTENTIALLY_ELIGIBLE` / `NEEDS_FACT` /
`NOT_ELIGIBLE`.

## Adding a domain

Add facts, evidence types, requirements, processes, project types (and
sources) to a KB file; no engine or UI change is needed. Every rule needs a
`source_id`, `locator`, `controlling_language`, `confidence`, `status`.

## Known limits / expert validation

See the PR description. Notably: Regulation 9028 and PREPA Regulation 8915
adopted PDFs are scans; OGPe and fire-review triggers are inherited from the
existing KB (low confidence); municipal delegated-permitting data is absent;
the DB-versioned RK graph (`src/app/rk`) is not yet synced with this KB.
