# Intake Parser: Confidence-Aware Inference + Project Context Extraction

Author: Darius Ferdows — 2026-09-16
Status: spec'd, build in progress

## Problem

Given a rich description like:

> "We were planning to renovate an existing commercial building in Guaynabo to add a new 12,000-square-foot warehouse and office area. The project included interior demolition, new walls, electrical and plumbing work, and some changes to the building layout. The property was already operating commercially. We needed construction and related approvals, but the permitting process became a major issue and the project eventually fell through."

the parser extracted only `Municipality = Guaynabo`. Everything else was discarded
because it did not exactly match a visible intake field.

A rich description must NEVER collapse into a single field because the schema is narrow.

## Requirements

### 1. Existing field inference (confidence-aware)

For each current intake field — Business Name, Municipality, Industry, Business Type,
Business Location Type, Business Structure, Number of Employees — infer a value when
the description provides enough evidence. Do NOT restrict to exact field-name matches.

For the example above:
- Municipality: Guaynabo
- Business Location Type: Warehouse (or Industrial Facility, whichever the evidence best supports)
- Industry: infer only when justified. A commercial property undergoing renovation
  suggests Real Estate; a business performing construction services suggests Construction.
  Do NOT classify as Construction merely because construction work is occurring.
  If industry cannot be determined confidently, leave unresolved and ask later.
- Business Name / Business Structure / Number of Employees: Unknown. Do not invent.

Every inferred field carries:
- `value`
- `confidence`
- `evidence` (quote from the user's statement)
- `requires_confirmation`

Example:
```yaml
business_location_type:
  value: Warehouse
  confidence: 0.90
  evidence: "warehouse and office area"
  requires_confirmation: false
industry:
  value: Real Estate
  confidence: 0.55
  requires_confirmation: true
```

Thresholds: ≥0.85 auto-fill; 0.60–0.85 fill but flag "Needs confirmation";
<0.60 omit (becomes a follow-up question candidate). Never present low-confidence
values as certain.

### 2. Project Context extraction

Alongside visible fields, extract project facts into a structured Project Context object.
Minimum schema:

`project_type, existing_building, new_construction, renovation, expansion,
change_of_use, municipality, property_type, existing_use, proposed_use,
square_footage, scope_of_work, structural_work, electrical_work, plumbing_work,
mechanical_work, interior_demolition, exterior_work, site_work, occupancy_change,
business_activity, employee_count, estimated_project_value, known_permitting_issue,
historical_project_status`

For the example:
```yaml
project_type: Renovation / expansion
existing_building: true
municipality: Guaynabo
property_type: Commercial building
existing_use: Commercial
proposed_use: Warehouse + office
square_footage: 12000
interior_demolition: true
new_walls: true
electrical_work: true
plumbing_work: true
layout_changes: true
construction_approvals_required: true
historical_project_status: Project fell through due to permitting difficulties
```
Unknown fields remain unknown. Each fact carries confidence + evidence.

### 3. Do not throw away extra information

Information that maps to no visible field is preserved in Project Context. The intake
UI may still show only existing fields, but SmartPR retains the facts for:
regulatory-domain determination, follow-up question selection, requirements
calculation, permit determination, agency identification, Agency Assist briefs,
and the Project Passport.

### 4. Question generation

After extraction, ask ONLY questions necessary to resolve meaningful unknowns.
Never ask the user to repeat stated information. For the example, useful follow-ups:
- What company or entity owns or operates the project?
- Is the primary facility use warehouse, industrial, commercial office, or mixed use?
- Will the renovation change the property's occupancy or permitted use?
- Does the work affect structural components?
- Will exterior or site work be included?

### 5. Business vs project distinction (critical)

Distinguish the business itself from the construction project performed for it.
"We own a warehouse and are renovating it" does NOT mean Industry = Construction.
It may mean Industry = Manufacturing / Wholesale Distribution / Real Estate, with
Project Type = Renovation. Construction is a regulatory domain, not necessarily the
user's industry.

### 6. Intake behavior

First intake screen unchanged for now. The parser populates existing fields where
justified and constructs Project Context behind the scenes. User sees e.g.:

- Municipality: Guaynabo
- Business Location Type: Warehouse
- Industry: Needs confirmation

SmartPR retains (12,000 sq ft, existing commercial building, renovation, interior
demolition, new walls, electrical/plumbing work, layout modifications) for later
regulatory reasoning.

## Guardrails

- The model extracts FACTS ONLY. It never determines permits, licenses, agencies,
  or requirements — the deterministic rules engine remains the sole authority.
- Unknown means unknown. Never invent values, names, dates, or numbers.
- Bilingual EN + authentic Puerto Rican Spanish throughout.

## 7. Project-first intake: no new business required (added 2026-09-16)

SmartPR must support projects with NO new business formation: an existing company
building/renovating/expanding, changing use, adding equipment, or opening a new
facility. "New business" cannot be a prerequisite for entering the workflow.

### Intent determination

Early intake determines project intent — explicitly asked or inferred with
confidence/evidence/requires_confirmation:

> "Is this for an existing business, a new business, or a property/project that
> is not tied to a business yet?"

- `project_intent = existing_business` → reuse the Business Passport when available;
  skip formation questions the passport already answers.
- `project_intent = new_business` → collect business formation fields (current flow).
- `project_intent = project_only` → skip business formation requirements AND
  questions entirely; build a Project Passport (project context + property facts).

Examples:
- Existing company building a new warehouse → construction permitting workflow.
- Existing hotel renovating rooms → renovation permitting workflow.
- Existing manufacturer adding a production line → facility modification workflow.
- Property owner building commercial structure pre-tenant → construction permitting.
- New entrepreneur opening a restaurant → business setup + licensing + use permits.

### Rules engine gating (the key rule)

A requirement is generated ONLY when its triggering conditions are satisfied.

- Formation requirements ("form LLC", entity steps) require
  `business_status = new AND entity_not_formed = true`. They must NEVER fire for
  `project_only` or for an existing business that already has an entity.
- Construction/renovation permits trigger from project facts, e.g.
  `project_type = new_construction OR project_type = renovation OR structural_work = true`.
- Audit all existing rules for "new business assumed" triggers and gate them.
  Business data becomes one profile dimension, not the root every project depends on.

This moves SmartPR from a "business setup product" to a "regulatory project platform".
The architecture supports it; the rules engine must stop assuming every project
begins with a new company.
