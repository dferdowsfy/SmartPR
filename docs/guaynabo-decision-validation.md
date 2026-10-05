# Guaynabo 114-042-022-01: project decision validation

Checked 2026-10-05. This is not a legal determination and does not replace an agency determination or professional judgment.

## Regression inputs (observed, not verified)

These were taken from an observed report. They are used as test inputs only and are not hard-coded in production. The synthetic parcel in `frontend/src/app/locations/decisionFixtures.ts` reproduces the shares.

- **Project:** new 3,200 sq ft single-family residence with a pool.
- **Zoning:** R-5-T 98.2%, VIAL 1.5%, D-2-T 0.3%.
- **Overlay:** PA-PACUT 98.5%.
- **Flood:** Zone X 94.9%; shaded Zone X (0.2% annual chance) 5.1%.

## Governing rules: what was verified

### Calificación layer

Source: JP calificación vigente layer (sigejp `calificacion/cali_vige/MapServer/0`), polygons tagged 114-042-022-01.

- R-5-T is described as "Residencial de Apartamentos Tradicional de Alta Densidad, Solar Mínimo 400 m/c".
- Classification SU; resolución JP-PT-16-10; vigencia 05/02/2010.
- `cali_sobre` = PA-PACUT.
- The layer's `cali_2021` field is R-C.

### Municipal plan

Source: JP PT record for Guaynabo.

- First POT approved 15-Dic-1999 (OE-1999-63).
- First revision approved 2-May-2010 (OE-2010-016).
- Status: "POT en proceso de revisión integral (RIPOT)".
- Transfer agreement: jerarquía field 5; agreement revised 26-Dec-2008, perpetual.

### Reglamento Conjunto 2023

Source: https://docs.pr.gov/files/DDEC/OGPe/Reglamentos/RC-2023-E.pdf. The file size matches the copy read. Page numbers are the printed pages.

| Provision | Page | What it says |
|---|---|---|
| Sección 6.1.1.4, Tabla 6.6 (Guaynabo) | 321–322 | R-5-T, R-3-T, R-4-T, C-3-T and PACUT ("Distrito de Uso Mixto") → **R-C**. D-2-T → D-G. Checked against the page image. |
| Sección 6.1.1.3(b); 6.1.1.4(b) | 309, 314 | Equivalences are transitional. |
| **Sección 6.1.1.3(m)** | 314 | Overlay areas from special plans or territorial plans **prevail** over the equivalent district. |
| Sección 6.1.1.1(b), (d), (e) | 308 | Unconverted special-plan provisions prevail; where provisions differ, the most protective one prevails. |
| Regla 6.1.5, Sección 6.1.5.2, Tabla 6.40 | 373–374 | R-C uses: "Unifamiliar" is listed; the principal use is residential. |
| Tabla 6.41 | 375–378 | R-C parameters, in two columns: high-density urban areas and traditional urban centres. |
| Regla 3.2.1, Sección 3.2.1.1(a) | 125 | A construction permit is required for construction, remodelling, demolition, expansion, etc. |
| Sección 3.2.1.2(c) | 125 | A JP flood certification is required for construction works. |
| Sección 3.2.1.2(d) | 126 | Reglamento 13 applies where the property is flood-susceptible per the FIRM. |
| Regla 3.2.2 | 126–127 | Demolition requirements: asbestos/lead certification, DRNA recycling plan, ICP recommendation in traditional urban centres. |
| Sección 2.1.8.7(b)(4) | 24 | An ICP archaeology/historic recommendation is required for projects with earth movement, excavation or construction. |
| Regla 4.3.11 | 238 | The Health recommendation applies to **public** pools. |

### Federal stormwater rule

Source: 40 CFR 122.26(b)(14)(x) and (b)(15)(i) (Cornell LII text). NPDES stormwater coverage applies to construction disturbing one acre or more.

### Municipal RIPOT advance (not adopted)

Source: Guaynabo Avance PT 2024. Tabla 42 shows the same R-5-T → R-C equivalence under RC 2020.

## What SmartPR now concludes

- **Compatibility: Undetermined.**
  - Rule reading, kept separate: R-5-T → R-C (Tabla 6.6) lists single-family dwellings as permitted (Tabla 6.40).
  - It is not a conclusion. PA-PACUT covers 98.5% and prevails over the equivalent district (Sección 6.1.1.3(m)), and its provisions have not been obtained.
- **Not invented:** no meaning or rule is asserted for PACUT beyond RC 2023's own description ("Distrito de Uso Mixto") and its precedence clause.
- **Flood:** the 0.2% annual-chance exposure (shaded X, 5.1%) is listed as a constraint. It is shown separately from the SFHA (none) and the advisory map.
- **VIAL and D-2-T:** explained, but not used for the use determination. Neither is treated as fatal nor dismissed.
- **Placement:** a site plan over a survey is required to show where the footprint sits.
- **Approvals:**

| Approval | Status |
|---|---|
| Construction permit | Required |
| JP flood certification | Required |
| ICP recommendation | Required |
| Demolition | Unresolved, waiting on a project fact |
| Public-pool Health recommendation | Unresolved, waiting on a project fact |
| EPA Construction General Permit | Unresolved, waiting on a project fact |
| Segregation | Asked as a project fact |

- **Completeness:** the approval list is labelled as not complete.

## Sample output (copied summary, decision section)

```

PROJECT DECISION SUMMARY
Proposed use and scope: New construction · single-family dwelling · about 3,200 sq ft (297 m²) · with a pool
Compatibility: Undetermined — No conclusion yet because the PA-PACUT overlay (98.5% of the parcel) may modify or restrict the base zoning and its provisions have not been obtained; the regulation governing uses in Guaynabo has not been confirmed (Reglamento Conjunto 2023 district rules via the Tabla 6.6 equivalence, subject to Guaynabo POT / Plan de Área provisions). Rule reading kept separate (not a conclusion): R-5-T → R-C (RC 2023 Sección 6.1.1.4; Tabla 6.6 — Equivalencias Distritos de Calificación Municipio Autónomo de Guaynabo, p. 321–322): Permitted / as-of-right — RC 2023 Sección 6.1.5.2(b); Tabla 6.40 (Residencial: Unifamiliar), pp. 373–374.
Material constraints & exposure (mapped):
• Flood exposure — 0.2% annual chance: Shaded Zone X (0.2% annual-chance flood hazard) on 5.1% of the parcel (effective FIRM). Outside the Special Flood Hazard Area and no regulatory floodway mapped, but it is mapped flood exposure.
• Overlay PA-PACUT: 98.5% of the parcel. May add to, modify or restrict the base zoning rules on 98.5% of the parcel; where its provisions apply they prevail over the equivalent district.
• Road district VIAL: 1.5% of the parcel is mapped as VIAL. It may reflect a road right-of-way or alignment along the boundary, or a mapping-edge difference; it is neither treated as a fatal obstacle nor dismissed. Parcel-wide percentages cannot show whether the building, yards or access fall in it — a boundary survey and site plan can.
• Minor zoning intersection D-2-T: Small intersection (0.3% of the parcel): could be a real strip or an edge-alignment difference between maps. Not used for the use determination; it matters only if the building footprint, yards or other site work fall there.
Unresolved — evidence gaps and research tasks:
• Evidence gap — PA-PACUT overlay provisions: The PACUT plan's use and design provisions (uses, density, height, yards, design guidelines) and confirmation that they remain in force after the 2010 POT revision. Why: Overlay provisions prevail over the base district (RC 2023 Sección 6.1.1.3(m) (p. 314): overlay areas or zones established by special plans or territorial plans prevail over the zoning districts under the equivalence. Sección 6.1.1.1(b), (d), (e) (p. 308): provisions of special plans not converted to RC districts prevail, and where provisions differ the one that best protects the resource prevails.); they can add, modify or restrict what the base zoning allows. Task: Research task: obtain the adopted Plan de Área del Centro Urbano Tradicional (PACUT) de Guaynabo plan text and maps, and written confirmation that they are in force for this parcel. (Municipio Autónomo de Guaynabo — Oficina de Planificación y Ordenación Territorial (and the JP record of the plan's adoption)) Blocks: Compatibility conclusion and the development-standards check.
• Evidence gap — governing regulation: Whether the Guaynabo POT (2010) reglamentación or the PA-PACUT plan modifies the R-C rules for this parcel; amendments to RC 2023 after June 2023 have not been checked. Why: A use conclusion is only as good as the regulation it applies; publication of a regulation does not establish that it governs this parcel. Task: Research task: confirm the governing plan and regulation (with effective date) with the municipal planning office or the Junta de Planificación, and check RC 2023 amendments. (Guaynabo municipal planning office / Junta de Planificación) Blocks: Compatibility conclusion.
• Evidence gap — permit-issuing office: Guaynabo is an autonomous municipality with a transfer agreement recorded by the JP (jerarquía field 5; agreement revised 26-Dec-2008, perpetual). RC 2023 lets Municipios Autónomos con Jerarquía I–III issue determinations; SmartPR has not confirmed which office issues this construction permit. Why: Autonomous municipalities with transferred powers issue some permits themselves; the filing office sets the procedure and sequence. Task: Research task: confirm the filing office for this permit type and parcel (transfer agreement / jerarquía). (Municipio Autónomo de Guaynabo — Oficina de Permisos; OGPe) Blocks: Filing route and sequencing of the construction permit.
• Evidence gap — which design-parameter column applies: Tabla 6.41 has two columns — 'Áreas urbanas de alta densidad' and 'Centros urbanos tradicionales'. Which column applies to a parcel is not determined by SmartPR. Why: Lot size, occupancy, density and yard requirements differ between the columns. Task: Research task: confirm with the planning office whether the parcel is treated as a high-density urban area or a traditional urban centre (and whether the overlay sets its own parameters). (Guaynabo municipal planning office) Blocks: Development-standards check for the proposed building and pool.
• Evidence gap — where the building sits: The location of the building footprint, pool, yards and access relative to: Flood exposure — 0.2% annual chance; Overlay PA-PACUT; Road district VIAL; Minor zoning intersection D-2-T. Why: Parcel-wide percentages cannot establish whether the proposed footprint intersects a constraint that covers only part of the parcel. Task: Research task: site plan by the architect or engineer drawn over a boundary and topographic survey by a licensed surveyor, overlaid with the effective FIRM and the calificación map. (Project architect / engineer; licensed surveyor) Blocks: Whether the partial constraints affect the building, and any floodplain review that depends on placement.
• Missing project fact — demolition: Whether existing structures on the parcel will be demolished. Why: It decides whether "Demolition of existing structures" is required (Regla 3.2.2(a)–(b) (pp. 126–127): demolition is filed through a construction permit; asbestos/lead-free certification; DRNA permits if present; DRNA recycling plan; written ICP recommendation in historic zones, traditional urban centres and archaeological sites). Task: Answer the question in the Proposed activity panel. (Client / project team) Blocks: Status of: Demolition of existing structures.
• Missing project fact — pool use (private or public): Whether the pool will be open to the public or shared. Why: It decides whether "Health recommendation for a public pool" is required (Regla 4.3.11, Sección 4.3.11.1(a) (p. 238): to build, modify or remodel a public pool, plans are submitted for a Health recommendation before the construction permit). Task: Answer the question in the Proposed activity panel. (Client / project team) Blocks: Status of: Health recommendation for a public pool.
• Missing project fact — land-disturbance area: Whether clearing, grading and excavation will disturb one acre or more. Why: It decides whether "EPA NPDES Construction General Permit" is required (40 CFR 122.26(b)(14)(x) and (b)(15)(i): construction disturbing one acre or more (or part of a larger common plan) needs NPDES stormwater permit coverage). Task: Answer the question in the Proposed activity panel. (Client / project team) Blocks: Status of: EPA NPDES Construction General Permit.
• Missing project fact — segregation / subdivision: Whether the parcel will be segregated or subdivided. Why: A segregation is a separate approval with its own requirements; SmartPR has no verified rule for it yet. Task: Answer the question in the Proposed activity panel. (Client / project team) Blocks: Whether a segregation approval belongs in the pathway.
Potential approvals:
• Construction permit — Required. Trigger: New construction of a single-family dwelling, about 3,200 sq ft (297 m²), including the pool (stated). Authority: OGPe, or the autonomous municipality's permits office where permit powers were transferred. Provision: Regla 3.2.1, Sección 3.2.1.1(a) (p. 125): a construction permit application is required for construction, reconstruction, remodelling, demolition, rehabilitation, expansion or alteration
• JP flood certification (certificación de inundabilidad) — Required. Trigger: Construction works: new construction (stated). Authority: Junta de Planificación. Provision: Regla 3.2.1, Sección 3.2.1.2(c) (p. 125): a JP flood certification must be submitted for construction works
• ICP archaeology and historic-conservation recommendation — Required. Trigger: The project involves construction with excavation / earth movement (foundations, pool excavation). Authority: Instituto de Cultura Puertorriqueña (ICP), requested through OGPe, the autonomous municipality or an Authorized Professional. Provision: Sección 2.1.8.7(b)(4) (p. 24): every public or private project involving earth movement, excavation or construction must request the ICP recommendation on archaeology and historic conservation
• Demolition of existing structures — Unresolved — fact needed. Trigger: unknown — depends on whether existing structures on the parcel will be demolished. Authority: OGPe or the autonomous municipality's permits office; DRNA (asbestos/lead, recycling plan); ICP in traditional urban centres. Provision: Regla 3.2.2(a)–(b) (pp. 126–127): demolition is filed through a construction permit; asbestos/lead-free certification; DRNA permits if present; DRNA recycling plan; written ICP recommendation in historic zones, traditional urban centres and archaeological sites
• Health recommendation for a public pool — Unresolved — fact needed. Trigger: unknown — depends on whether the pool will be open to the public or shared. Authority: Departamento de Salud, through OGPe or an autonomous municipality. Provision: Regla 4.3.11, Sección 4.3.11.1(a) (p. 238): to build, modify or remodel a public pool, plans are submitted for a Health recommendation before the construction permit
• EPA NPDES Construction General Permit — Unresolved — fact needed. Trigger: unknown — depends on whether clearing, grading and excavation will disturb one acre or more. Authority: U.S. EPA Region 2 (NPDES). Provision: 40 CFR 122.26(b)(14)(x) and (b)(15)(i): construction disturbing one acre or more (or part of a larger common plan) needs NPDES stormwater permit coverage
Likely pathway: A construction permit for new construction (RC 2023 Regla 3.2.1), with JP flood certification (certificación de inundabilidad), ICP archaeology and historic-conservation recommendation, after the zoning question is resolved. Not a complete approval pathway: it lists the 6 approvals SmartPR has rules for. Utility endorsements, municipal requirements and agency-specific conditions are not encoded.
Immediate next action: Research task: obtain the adopted Plan de Área del Centro Urbano Tradicional (PACUT) de Guaynabo plan text and maps, and written confirmation that they are in force for this parcel. (Municipio Autónomo de Guaynabo — Oficina de Planificación y Ordenación Territorial (and the JP record of the plan's adoption))
```

## Remaining knowledge gaps

1. **PA-PACUT provisions.**
   - Missing: the adopted plan text and maps, and whether they survived the 2010 revision.
   - Obtain from: Guaynabo Oficina de Planificación.
   - Until then, compatibility in PACUT stays undetermined.
2. **Guaynabo POT (2010) reglamentación.** Not obtained, so it is unknown whether it modifies R-C for this area.
3. **Permit-issuing office for Guaynabo.**
   - Unknown whether the permit goes to OGPe or the municipal office.
   - The meaning of the JP "jerarquía 5" field was not confirmed.
4. **RC 2023 amendments after June 2023.** Not checked.
5. **Tabla 6.41 column.** Unknown whether the high-density urban area or traditional urban centre column applies.
6. **R-C parking and height rules.** Not encoded. The D-G district use table is not encoded.
7. **Segregation and lotificación.** No verified rule.
8. **Use or occupancy authorization after construction** (RC 2023 Sección 3.2.1.1(f)). Not encoded.
9. **Utility endorsements and municipal arbitrios procedures.** Not encoded.
10. **Other municipalities.** The governing regulation has been researched only for Arroyo and Guaynabo, so elsewhere compatibility stays undetermined by design.
11. **Permiso Único citations.** The scenario-graph Permiso Único mappings still lack their exact RC section. These now appear as labelled evidence gaps rather than "Regla to confirm".
