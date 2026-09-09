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
