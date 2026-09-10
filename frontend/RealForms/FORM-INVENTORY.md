# SmartPR government form inventory

What SmartPR can and cannot produce today, per official form, with the evidence
behind each claim. **A form appears under "Implemented" only when a user can
complete it in Requirements AND SmartPR emits the populated official artifact.**
Anything short of that is stated plainly rather than rounded up.

Last researched: 2026-09-09.

Statuses used here:

| Status | Meaning |
| --- | --- |
| **Implemented** | Capture UI + official artifact generation, both tested end to end. |
| **Ready to implement** | Authoritative source retained; a specific, named blocker remains. |
| **Needs additional research** | Source held but field coverage is provably incomplete. |
| **Cannot currently be generated digitally** | No fillable artifact exists to produce. |
| **Requires external agency workflow** | The agency accepts no standalone form; filing happens in its portal. |

---

## Implemented

| Form | Agency | Requirement | Artifact | Evidence |
| --- | --- | --- | --- | --- |
| CORPREG01 — Certificate of Incorporation (Stock) | PR Dept. of State | `DOC_CERT_INCORPORATION` | Official PDF (overlay) | `deliverableOutput.e2e.test.ts` |
| CORPREG02–CORPREG06 — corporation / LLP variants | PR Dept. of State | per variant | Schema-driven | `formEngine.test.ts` |
| CORPLLC02 — Certificate of Formation (LLC) | PR Dept. of State | `DOC_ARTICLES_ORGANIZATION` | Official PDF (overlay) | `deliverableOutput.e2e.test.ts` |
| SS-4 — Application for EIN | IRS (federal) | `DOC_EIN` | Official PDF (AcroForm) | `deliverableOutput.e2e.test.ts` |
| **PA02 — Solicitud de Patente Provisional** | OCAM (statewide municipal) | `DOC_PATENTE_MUNICIPAL` | Official PDF (AcroForm) | `pa02.e2e.test.ts` |
| **NC001 — Solicitud de Registro de Nombre Comercial (Trade Name / DBA)** | PR Dept. of State | `DOC_DBA_REGISTRATION` | Official PDF (overlay) | `nc001.e2e.test.ts` |
| **DACOUC01 — Solicitud de Licencia para Urbanizador y/o Constructor (DACO, Rev. Ene 2019 v2)** | DACO (Dept. de Asuntos del Consumidor) | `DOC_CONTRACTOR_LICENSE` | Official PDF (overlay) | `dacouc01.e2e.test.ts` |
| **PA01 — Declaración de Volumen de Negocios (OGP PA01 – REV FEBRERO 2025)** | Municipal finance office (OGP statewide form) | `DOC_PATENTE_MUNICIPAL` | Official PDF (AcroForm) | `pa01.e2e.test.ts` |
| **AGRIIND01 — Solicitud Agricultor Bona Fide (Para Individuos), DA-OCAB-05 Rev. ABRIL 2021** | Departamento de Agricultura (Gobierno de Puerto Rico) | `DOC_AGRICULTURE_REGISTRATION` | Official PDF (AcroForm) | `agriind01.e2e.test.ts` |
| **AGRICORP01 — Solicitud Agricultor Bona Fide (Corporaciones, Sociedades Especiales o Sucesiones), DA-OCAB-05 (Corporaciones) Rev. ABRIL 2021** | Departamento de Agricultura (Gobierno de Puerto Rico) | `DOC_AGRICULTURE_REGISTRATION` | Official PDF (overlay) | `agricorp01.e2e.test.ts` |
| **CBP301 — CBP Form 301, Customs Bond (04/24)** | U.S. Customs and Border Protection (CBP), Dept. of Homeland Security (federal) | `DOC_CUSTOMS_BROKER_BOND` | Official PDF (AcroForm) | `cbp301.e2e.test.ts` |
| **EPAFORM1 — EPA Form 3510-1, NPDES Application: General Information (Rev. 07/2023)** | U.S. EPA Region 2 — Caribbean Environmental Protection Division, Guaynabo (federal) | `DOC_NPDES_INDUSTRIAL` | Official PDF (AcroForm) | `epaform1.e2e.test.ts` |
| **EPAFORM2C — EPA Form 3510-2C, NPDES Application for Existing Industrial Dischargers (Rev. 07/2023)** | U.S. EPA Region 2 — Caribbean Environmental Protection Division, Guaynabo (federal) | `DOC_NPDES_INDUSTRIAL` | Official PDF (AcroForm) | `epaform2c.e2e.test.ts` |

### PA02 notes (added 2026-09-08)

OCAM publishes PA02 as **one standardized statewide form** — the printed layout
is identical in every municipality and `Municipio` is a blank applicant field,
not a per-municipality variant. It therefore does not route through the
municipality adapter, which exists for artifacts that genuinely differ by
municipality (PA03/PA04). The form is statewide; the rates and the filing
counter are not, and that caveat travels with the artifact.

Three regions are left blank **on purpose**, each covered by a test:

* **JURAMENTO** — sworn before a notary or authorized municipal official.
* **USO OFICIAL SOLAMENTE** — municipal staff only.
* **Owner's social security number** — a personal government identifier
  SmartPR does not store. The filer writes it on the printed form.

There is deliberately no `owner_address` field in the capture UI: that line is
derived canonical data with no single settable path, so a UI field would either
write the owner's home address back into the *business's* address or collect a
value that never reaches the PDF. Population fills the line without one.

### NC001 notes (added 2026-09-09)

Implementing NC001 required a real engine change, not just a new mapping:
`populateArtifact()`'s `pdf_overlay` branch used to read **only** the
canonical profile, unlike the AcroForm branch — it never consulted
`formData`. `directOverlayValues()` (mirroring the existing `directAcroValues`)
now supplies that, resolving each direct value's placement from the SAME
mapping row the canonical pass uses (matched by `pdfField`) rather than a
second, duplicated coordinate table. That change also removes one of
SC2309's two blockers below.

NC001's 24 overlay coordinates were not eyeballed: every x/y was read from the
PDF's own text-content layer (pdfjs-dist `getTextContent`), then the populated
PDF was re-rendered to an image and visually checked page by page — four
placements printed on top of a ruled line on the first pass and were nudged
clear. `reviewed: false` throughout, same standard `overlayMaps.ts` uses
elsewhere — a stronger basis than a pure visual estimate, still not a human
sign-off against the live agency form.

Four things are left blank **on purpose**, each covered by a test:

* **Page 2's sworn declaration (JURAMENTO / notary block)** and **both
  signature lines** — never SmartPR's to complete.
* **`Núm. Reg. / Reg. No.`** — assigned by the Department of State when it
  registers the filing.

> Do **not** conflate the first-use-in-commerce date with `business.start_date`.
> They are different legal facts and the registry treats the use date as sworn
> testimony.

### DACOUC01 notes (added 2026-09-10)

The contractor-license application is issued by **DACO (Departamento de
Asuntos del Consumidor)**, Rev. Ene 2019 v2, sourced from docs.pr.gov (the
Gobierno de PR document repository). **KB discrepancy — flagged, not changed:**
`documents.json` lists `DOC_CONTRACTOR_LICENSE`'s agency as "Department of
State"; the official form is DACO's. Do not change the KB entry without
review.

Same key-field scope as LUMAINT01: 18 overlay coordinates on page 1 only
(applicant name, phone, physical and mailing addresses, the two
license-request checkbox rows, activity type, organization type). Every x/y
was read from the PDF's own text-content layer (the two long address blanks
are vector ruled lines found by dark-run scan at 150 dpi), then the
populated PDF was re-rendered and visually checked — `reviewed: true`
throughout. The thin ruled lines above fields 5, 6, 7 and 8 are section
dividers, not writable blanks (verified against the render).

Three things are left blank **on purpose**, each covered by a test:

* **Pages 8–9** — the DECLARACIÓN JURADA (sworn before a notary) and the
  FORMULARIO DE RESPONSABILIDAD POR PROYECTOS A EJECUTARSE (officer
  signature + notary affidavit).
* **Questions 8–15** — individual professional licenses, corporation/society
  details, officers and directors, financial standing, projects, and the
  annex checklist: deep conditional applicant data beyond the key-field
  scope. The filer completes them on the printed PDF.
* **The form has no official-use box** — nothing to wall off there.

Fees per the annex checklist in the official document set (page 6):
regular license $75, provisional license $50. `requiresPortalVerification`
is true — fees change and the paper revision is from 2019.

### PA01 notes (added 2026-09-10)

PA01 is the **annual** municipal patente declaration — the Declaración de
Volumen de Negocios every Puerto Rico business files each contributive year.
It is a different filing from PA02 (the one-time provisional application for
new businesses); both live under `DOC_PATENTE_MUNICIPAL`, and routing sends
already-operating businesses to PA01 and new businesses to PA02.

**Provenance caveat:** the file is a genuine OGP-issued REV FEBRERO 2025 —
the header "GOBIERNO DE PUERTO RICO / OGP PA01 – REV FEBRERO 2025" was
verified inside the PDF — but the only accessible copy is third-party-hosted
(Colegio de CPA); no OGP/OCAM direct host was found.

SmartPR maps the 36 native AcroForm fields of the page-1 filing header (plus
the page-2 certification signature block, marked never-write). The
tipo-de-patente and tipo-de-negocio choices are independent checkboxes in the
PDF, not a radio group — population checks exactly one of each set and
explicitly unchecks the rest.

Left blank **on purpose**, each covered by a test:

* **Encasillado 1 and the pages 2–4 computation schedules** — the taxpayer's
  (or their CPA's) computation from the business's books. Not mapped at all;
  the filer completes them by hand.
* **CERTIFICACION signature line and date** — signed by hand at filing.
* **The filer's social security number** — the identifier blank is shared, so
  SmartPR prints the business EIN into it only for Corporación/Sociedad. For
  Individuo/Entidad Ignorada it stays blank for the filer to hand-write their
  own SSN; SmartPR never stores or prints a person's identifier.

---

### AGRIIND01 notes (added 2026-09-10)

AGRIIND01 is the **natural-person** variant of the Bona Fide Farmer
certification: "SOLICITUD AGRICULTOR BONA FIDE (PARA INDIVIDUOS) POR LA LEY NÚM.
60 DE 1 DE JULIO DE 2019", Modelo DA-OCAB-05, Rev. ABRIL 2021. The
juridical-entity (corporación) variant is implemented as AGRICORP01 (below).
Routing sends `sole_proprietorship` here explicitly, and an
ungated row is the honest catch-all for `other`/unmatched entity types.

6 pages, 136 native AcroForm text fields, all human-reviewed against the PDF's
text layer (`form-mappings/AGRIIND01.json`: 136/136 reviewed, 84 applicant, 8
smartpr_derived, 41 government_only, 3 signature). The mapping notes record
every field literally named `undefined` in the raw inventory (the section-23
14a income-table dollar boxes and the agronomist date line on page 5), and
confirm the 19(a)/19(b) Km. blanks have **no AcroForm widgets** — they can
only be completed by hand on the printed form.

Left blank **on purpose**, each covered by a test:

* **The three SSN boxes** (personal, patronal, spouse) — personal government
  identifiers SmartPR does not store (PA02 precedent). The filer writes them by
  hand; an acknowledgement checkbox gates the form instead.
* **"Firma del Agricultor o Representante Autorizado" and the date line** —
  signed by hand at filing.
* **Section 23** (the agronomist's 14a/14b income computation, RECOMENDACIÓN,
  the numbered 1–10 evaluation, Cumple/No Cumple, agronomist signature) and
  **section 24** (regional director observations and signature) — the agency's
  evaluation, never SmartPR's to complete.
* **The "Para Uso Interno" header** (OFICINA REGIONAL, MUNICIPIO, Núm.
  Solicitud) — internal agency fields.

Deliberate UI simplifications (each still maps the PDF's available fields):

* Fishing (20) and the processing plant (21) use one or two free-text rows
  each instead of multi-column business tables.
* The finca "negocios en la finca" tables use two free-text rows plus a third
  row split across the form's four columns.
* There is deliberately no `owner_address` field: the canonical owner's
  address is derived data with no single settable path, so a UI field would
  collect a value that never reaches the PDF (PA02 precedent). Population
  fills it without one.

No fee is printed on the form; the notices advise confirming any cost with
the Department of Agriculture's regional office.

### AGRICORP01 notes (added 2026-09-10)

AGRICORP01 is the **juridical-entity** variant of the Bona Fide Farmer
certification: "SOLICITUD AGRICULTOR BONA FIDE (CORPORACIONES, SOCIEDADES
ESPECIALES O SUCESIONES) POR LA LEY NÚM. 60 DE 1 DE JULIO DE 2019", Modelo
DA-OCAB-05 (Corporaciones), Rev. ABRIL 2021. Routing sends the eight
corporation/partnership entity types here explicitly, above the individuo
fallback rows (first match wins).

7 pages, flat PDF with no AcroForm fields — populated by coordinate overlay
(`form-mappings/AGRICORP01.json`: 167/167 reviewed, 153 applicant, 7
smartpr_derived, 4 government_only, 3 signature). Every placement was
measured from the PDF's text layer and visually verified against a populated
render at 150 DPI; no nudges were needed.

Unlike AGRIIND01, the employer identifier (2. Seguro Social Patronal) and the
section-6 member SSNs ARE written to the PDF, passed as `sensitive: true` —
population metadata records only `[provided]`, never the raw number (SS-4
precedent). The individuo variant's personal SSN boxes stay blank instead.

Left blank **on purpose**, each covered by a test:

* **"Firma del Agricultor o Representante Autorizado"** — hand-signed at
  filing; an acknowledgement checkbox gates the form instead.
* **The "Para Uso Interno" header** (OFICINA REGIONAL, MUNICIPIO, Núm.
  Solicitud) — internal agency fields.
* **Section 14** (the agronomist's income computation, RECOMENDACIÓN,
  Cumple/No Cumple, agronomist signature) and **section 15** (regional
  director observations, date, signature) — the agency's evaluation, never
  SmartPR's to complete.
* **The Sucesión entity-kind box** has no canonical mapping — the filer marks
  it by hand on the printed form when it applies.

Deliberate UI simplifications: section 13's 15 ruled lines are one multi-line
narrative; section 6 is 6 member rows (name + SSN); the signature date is
split into the form's numeric Día/Mes/Año blanks.

No fee is printed on the form; the notices advise confirming any cost with
the Department of Agriculture's regional office.

### CBP301 notes (added 2026-09-10)

CBP301 is the **federal** CBP Form 301 "CUSTOMS BOND" under 19 CFR Part 113 —
"CBP Form 301 (04/24)" on the form face, posted by CBP (cbp.gov) 04/30/2024.
It is the first federal (non-PR) form in the library and routes from
`DOC_CUSTOMS_BROKER_BOND` (import/export, freight forwarding, logistics,
wholesale distribution) with no entity-type gate. 5 pages, 114 fillable
AcroForm widgets, all inventoried in `form-mappings/CBP301.json`; the
checkbox↔limit-of-liability pairings were verified by widget-rect proximity
against the PDF's own text layer (activity 15/16/17 pair with
LimitofLiability16/17/18 — there is no LimitofLiability15), and the ambiguous
`nameaddress[0]`/`namephysical[0]` widgets were placed by rect (principal
block vs. surety block).

Two caveats travel with this artifact and are **not** hidden — they are in the
catalog usage notes and the form's own notices:

* **OMB approval expired-but-valid:** CBP's own page notes "The OMB Date is
  expired, however this form is still valid for use and is under review by OMB
  awaiting a new expiration date" (OMB No. 1651-0050, expired 08/31/2025).
* **Paper is the legacy path:** in practice continuous bonds are filed
  electronically through CBP's eBond process in ACE, arranged by the
  importer's customs broker and surety. The form is presented as a preparation
  copy for the broker/surety, and the notices advise confirming with them
  which path they use before filing paper.

Key-field scope only: page-1 Section I (single-transaction vs. continuous +
dates), one Section II activity + its limit of liability (the form says
"Check one box only" — population enforces exactly one checked box and
clears stale amounts on unselected activities), principal identity, and the
surety identity basics.

Left blank **on purpose**, each covered by a test:

* **Both signature lines** (principal and surety) — signed by hand.
* **BOND NUMBER (Assigned by CBP)** — the CBP USE ONLY box; assigned by CBP.
* **The seal-declaration checkboxes** ("affix seal … 19 CFR 113.25"), the
  **surety-requested mailing address**, and **page 2** (co-principal,
  co-surety, Section III trade names) — the filer, broker or surety completes
  these by hand.

No fee is printed on the form — the bond premium is set by the surety, not by
CBP.

### EPAFORM1 notes (added 2026-09-10)

EPAFORM1 is **EPA Form 3510-1, "Application for Permit to Discharge Wastewater:
General Information"**, Revised 07/31/2023, OMB No. 2040-0004 (expires
07/31/2026). It is the general-information cover **every** NPDES applicant
files; for an existing manufacturing, commercial, mining, or silvicultural
discharger it must accompany Form 2C — the two forms are one package under
`DOC_NPDES_INDUSTRIAL`, and routing exposes both (the requirement card opens a
package picker, never just one form).

**Jurisdiction note:** Puerto Rico is NOT an NPDES-delegated state. EPA Region
2's Caribbean Environmental Protection Division (Guaynabo) issues NPDES permits
in Puerto Rico directly, so this federal form is the correct PR artifact. (The
Junta de Calidad Ambiental handles the separate state water-quality
certification, not the NPDES permit itself.)

23 PDF pages, 112 native AcroForm fields, all human-reviewed
(`form-mappings/EPAFORM1.json`). Pages 1–19 are instructions; the application
itself is PDF pages 20–23 (Sections 1–11). SmartPR writes the applicant-owned
text fields via the native AcroForm — EPA ID and NPDES permit numbers,
SIC/NAICS codes, the split facility/mailing/operator address boxes (the PDF
has separate street/city/state/ZIP boxes, so population splits the canonical
address instead of stuffing a multiline string), the cooling-water source, and
any existing-permit numbers, which check the matching Section 6 box
automatically. Facility/contact/operator identity and the nature-of-business
text resolve from the canonical profile.

Left blank **on purpose**, each covered by a test:

* **Every Yes/No and multi-option radio** (Section 1 screening, 4.2, 4.3
  operator status, 5.1 Indian land, 7.1 topographic map, 9.1 cooling water) —
  the Yes/No pairs share one field name per pair in a checkbox construct the
  PDF library cannot address separately. The filer marks them by hand on the
  printed form.
* **Section 10 variance requests** and the **Section 11.1 checklist** of
  completed sections — marked by hand from the finished package.
* **The Section 11.2 certification block** (printed name, official title,
  date signed, signature) — the responsible official completes and hand-signs
  it. EPA does not accept electronic signatures on this form.

### EPAFORM2C notes (added 2026-09-10)

EPAFORM2C is **EPA Form 3510-2C, "Application for an NPDES Permit to Discharge
Wastewater: Existing Manufacturing, Commercial, Mining, and Silvicultural
Dischargers"**, Revised 07/31/2023, OMB No. 2040-0004 (expires 07/31/2026).
It is the substantive application, filed **together with Form 1** — same
package, same Region 2 permitting authority as above.

48 PDF pages, 3,067 native AcroForm fields — the largest form in the library.
Scope is deliberately narrow and honest: SmartPR maps only the non-technical
applicant fields — the running header (facility name from the canonical
profile; EPA ID and NPDES permit numbers) and the Section 1.1 outfall basics
for the **first two outfalls** (outfall number and receiving-water name). The
mapping JSON reviews exactly those fields plus the never-write fields; the
remaining ~3,050 engineering/lab widgets keep the inspector defaults and are
never written.

Left blank **on purpose**, each covered by a test:

* **All effluent-characteristics tables (Sections 7+)** — quantitative lab
  sampling data prepared with the facility's environmental engineer.
* **The outfall latitude/longitude boxes** — both boxes share one field name
  per row, so they cannot be written separately.
* **The Section 1 screening yes/no boxes** — anonymous widgets the PDF
  library cannot address.
* **Any third or further outfall row** — added by hand when it applies.
* **The Section 12.2 certification block** (printed name, official title,
  date signed, signature) — hand-signed under penalty of law. EPA does not
  accept electronic signatures on this form.

No application fee is printed on either form; the notices advise confirming
any fee and the current submittal channel with EPA Region 2 before filing.

---

## Needs additional research

### SC 2309 — Solicitud de Licencias (Internal Revenue Licenses)

* **Agency:** Departamento de Hacienda, Negociado de Impuesto al Consumo
* **Requirement:** `DOC_HACIENDA_LICENSE`
* **Source:** held — `RealForms/sc_2309_0.pdf` (Rev. 28 ago 14, Rep. 26 jun 17)
* **Coverage: ~20 of 50+ applicant data elements on page 1.** Generating it
  today would emit a materially incomplete government document.

Mapped: Parte I taxpayer identity (9 fields), 7 of ~15 Parte III activity
checkboxes, and the comments line.

**Not mapped:**

* **Parte II** — *período corto* vs *período largo* (drives fee proration).
* **8 activity checkboxes** — cemento, vehículos, operador de máquinas de
  pasatiempo, importador/manufacturero de aceite lubricante, tienda en zona de
  puerto libre, portador aéreo/marítimo/terrestre, otras (detalle).
* **Información Adicional — Individuos** (11 fields): código postal, fecha and
  lugar de nacimiento, número de dependientes, estado civil, nombre and SSN del
  cónyuge, tarjeta de residencia, certificado de naturalización, fecha de
  expedido, puerto de entrada.
* **Información Adicional — Sociedades y Corporaciones**: repeating owners /
  officers table (nombre, título, SSN).
* Equipment counts (billar, máquinas de entretenimiento, vellonera, otros).
* School/church proximity: within 100 m yes/no, distance, and the dependent
  detail blocks (students, average age, grades, class hours / congregants,
  service days, service hours).

**Remaining blocker:** ~30 new hand-measured overlay coordinates. The
overlay/`formData` engine gap that used to block this alongside NC001 is
resolved — `directOverlayValues()` now exists and reads placements from
SC2309's own mapping rows the same way it does for NC001.

> Also verify currency before investing: Hacienda has moved license
> **application and renewal** into SURI (see below). This paper revision may
> now be legacy. Confirm with the agency before mapping ~30 coordinates.

### PA03 / PA04 — municipal declaration extension, taxpayer maintenance

Genericized working copies, **not** official forms for any municipality. Usable
for field mapping and UI demonstration only. Guardrails prevent them from being
delivered as filing artifacts (`artifacts.test.ts`, `deliverableOutput.e2e.test.ts`).
Promoting either requires verifying a specific municipality accepts it and
registering it in `MUNICIPAL_IMPLEMENTATIONS`.

---

## Requires external agency workflow

These are **not** gaps to close with a form. The agency accepts no standalone
document, so the honest product behavior is to prepare and reuse the data,
route the user to the portal, and collect the resulting evidence.

| Item | Agency | Finding |
| --- | --- | --- |
| **Registro de Comerciante** (Merchant Registration) — `DOC_MERCHANT_REGISTRATION` | Hacienda | Administered **solely through SURI** since 10 Dec 2018. No downloadable application PDF. Registration is free. The issued *Certificado de Registro de Comerciante* is uploadable evidence. |
| **Internal Revenue Licenses** — `DOC_HACIENDA_LICENSE` | Hacienda | Application **and renewal** moved into SURI on the same date. See the SC 2309 currency caveat above. |

Sources: [Registro de Comerciante](https://hacienda.pr.gov/ivu/registro-de-comerciante),
[Comerciantes](https://hacienda.pr.gov/comerciantes).

---

## Still to research

Registry placeholders that remain deliberately non-rendering (`needs_source`),
listed in rough order of how often they occur in SmartPR business-entry flows:

| Placeholder | Requirement | Agency to research |
| --- | --- | --- |
| `FORM_PR_PERMISO_UNICO` | `DOC_PERMISO_UNICO` | OGPe — Permiso Único (high frequency; likely portal-based) |
| `FORM_PR_HEALTH_PERMIT` | `DOC_HEALTH_PERMIT` | Departamento de Salud |
| `FORM_PR_ALCOHOL_LICENSE` | `DOC_ALCOHOL_LICENSE` | Hacienda (likely SURI — see above) |
| `FORM_PR_SIGN_PERMIT` | `DOC_SIGN_PERMIT` | OGPe / municipality |
| `FORM_PR_OUTDOOR_SEATING` | `DOC_OUTDOOR_SEATING_AUTH` | Municipality |
| `FORM_PR_ENTERTAINMENT_PERMIT` | `DOC_ENTERTAINMENT_PERMIT` | Municipality / Hacienda |
| `FORM_PR_HOME_DECLARATION` | `DOC_HOME_DECLARATION` | Municipality |
| `FORM_PR_TOURISM_REGISTRATION` | `DOC_TOURISM_REGISTRATION` | Compañía de Turismo |
| `FORM_PR_CHILDCARE_LICENSE` | `DOC_CHILDCARE_LICENSE` | Departamento de la Familia |
| `FORM_PR_TRANSPORT_PERMIT` | `DOC_TRANSPORT_PERMIT` | DTOP / Negociado de Transporte |
| `FORM_PR_PESTICIDE_LICENSE` | `DOC_PESTICIDE_LICENSE` | Departamento de Agricultura |
| `FORM_PR_AGRICULTURE_REGISTRATION` | `DOC_AGRICULTURE_REGISTRATION` | Departamento de Agricultura |
| `FORM_PR_NOISE_VARIANCE` | `DOC_NOISE_VARIANCE` | Junta de Calidad Ambiental / DRNA |
| `FORM_PR_SAN_JUAN_USE_PERMIT` | `DOC_SAN_JUAN_USE_PERMIT` | Municipio de San Juan |

**Not yet researched here:** Negociado del Cuerpo de Bomberos (fire
inspection/certificate) and Departamento del Trabajo registrations, both named
in the original brief. Neither has a registry placeholder yet.

---

## Recommended next step

SC 2309's field coverage is the largest remaining gap on an already-sourced,
already-unblocked-at-the-engine-level form: ~30 overlay coordinates using the
same measure-then-visually-verify method NC001 used, plus confirming with
Hacienda that the paper form is still current (see the SURI caveat above)
before investing that effort. After that, the next highest-value target is
researching one of the "still to research" placeholders below —
`FORM_PR_PERMISO_UNICO` is the highest-frequency one with no source held yet.
