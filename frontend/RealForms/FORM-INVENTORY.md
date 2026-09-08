# SmartPR government form inventory

What SmartPR can and cannot produce today, per official form, with the evidence
behind each claim. **A form appears under "Implemented" only when a user can
complete it in Requirements AND SmartPR emits the populated official artifact.**
Anything short of that is stated plainly rather than rounded up.

Last researched: 2026-09-08.

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

---

## Ready to implement

### NC001 — Solicitud de Registro de Nombre Comercial (Trade Name / DBA)

* **Agency:** PR Department of State, Registro de Marcas y Nombres Comerciales
* **Requirement:** `DOC_DBA_REGISTRATION` (registry placeholder `FORM_PR_DOS_DBA`)
* **Official source:** <http://app.estado.gobierno.pr/formularios/marcas/nc001.pdf>
  — retained at `RealForms/NC001-Solicitud-Registro-Nombre-Comercial.pdf`
* **Statutory basis:** Act 75-1992 (trade names); registration lasts 10 years.
* **Fee:** $150 Comprobante de Rentas Internas, cifra de cuenta **1705**.
* **Structure:** 6 pages — p1 application, p2 sworn declaration (notary),
  p3 trade-name description, p4–6 instructions (not fillable).
  **0 AcroForm fields** → requires coordinate overlay.

Every applicant data element is identified and the page geometry is clean
(612×792, unambiguous label anchors):

p1 — trade name; applicant name + phone; natural-person vs juristic-entity
selection; state/country of organization *or* citizenship (conditional on that
selection); principal place of business (physical + postal); principal business
phone; nature of business; used-in-commerce **since date** *or* not-yet-used
selection; two-specimen enclosure; applicant signature line (signature — never
auto-filled). p3 — words claimed; disclaimer of non-registrable components.

**Blocker (specific and shared):** `populateArtifact()`'s `pdf_overlay` branch
reads **only** the canonical profile — unlike the AcroForm branch, it never
consults `formData`. NC001 needs several genuinely applicant-only values that
do not belong in the reusable business profile (first-use-in-commerce date, the
disclaimer text, the application date). Implementing NC001 therefore requires
first adding form-data support to the overlay branch — a `directOverlayValues`
analogue of the existing `directAcroValues`.

That single engine change also unblocks SC2309 below, so it is the highest-
leverage next step in this area.

> Do **not** conflate the first-use-in-commerce date with `business.start_date`.
> They are different legal facts and the registry treats the use date as sworn
> testimony.

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

**Two blockers:** ~30 new hand-measured overlay coordinates, **and** the same
overlay/`formData` engine gap described under NC001.

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

Add `formData` support to the overlay branch of `populateArtifact()`, mirroring
`directAcroValues`. It is a contained change that converts NC001 from "ready"
to implementable and removes one of SC2309's two blockers — more leverage than
starting any new form from scratch.
