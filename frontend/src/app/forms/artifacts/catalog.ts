// ============================================================================
// SmartPR template library.
//
// One entry per government artifact SmartPR knows about. An entry exists even
// when SmartPR has no file yet (`sourceStatus: "pending_source"`) — the catalog
// is how the product stays honest about what it does and does not have.
//
// Rules encoded here rather than in prose:
//   * `official_pdf_form` means the bytes came from the issuing agency.
//   * `genericized_municipal_template` means the layout is real but the
//     municipality-specific wording was removed. It NEVER represents an
//     official filing form for any municipality — see municipalities.ts for how
//     a municipality gets a verified implementation.
// ============================================================================

import type { TemplateDescriptor } from "./types.ts";

/** Repository-root-relative directory holding the untouched originals. */
export const REAL_FORMS_DIR = "RealForms";

/** Supabase Storage buckets (private). Canonical originals are never overwritten. */
export const OFFICIAL_TEMPLATE_BUCKET = "official-form-templates";
export const MUNICIPAL_TEMPLATE_BUCKET = "municipal-form-templates";
export const GENERATED_FILINGS_BUCKET = "generated-filings";
/** Archived readiness reports / submission packages, private, per-user. */
export const DELIVERABLES_BUCKET = "deliverables";

const GENERIC_MUNICIPAL_NOTES = [
  "Layout originated from a Municipio de Bayamón form; municipality-specific wording was removed locally.",
  "Classified genericized_municipal_template: usable for field mapping, UI demonstration and data-population testing only.",
  "Must not be presented to a user as the official filing form for any municipality until that municipality's acceptance is separately verified.",
];

export const TEMPLATE_LIBRARY: TemplateDescriptor[] = [
  {
    formCode: "CORPREG01",
    title: "Certificate of Incorporation — Stock Corporation",
    agency: "Puerto Rico Department of State",
    scope: "statewide",
    artifactType: "official_pdf_form",
    populationMethod: "pdf_overlay",
    submissionChannel: "agency_portal",
    sourceStatus: "official_source",
    sourceFile: `${REAL_FORMS_DIR}/1-CORPREG01.pdf`,
    storagePath: `${OFFICIAL_TEMPLATE_BUCKET}/pr/estado/CORPREG01/current/original.pdf`,
    requirementCode: "DOC_CERT_INCORPORATION",
    usageNotes: [
      "No native AcroForm fields — populated by coordinate overlay over the untouched background.",
      "Overlay coordinates are version-bound; a new agency revision requires re-measuring before reuse.",
    ],
  },
  {
    formCode: "CORPLLC02",
    title: "Certificate of Organization — Limited Liability Company",
    agency: "Puerto Rico Department of State",
    scope: "statewide",
    artifactType: "official_pdf_form",
    populationMethod: "pdf_overlay",
    submissionChannel: "agency_portal",
    sourceStatus: "official_source",
    sourceFile: `${REAL_FORMS_DIR}/34-CORPLLC02.pdf`,
    storagePath: `${OFFICIAL_TEMPLATE_BUCKET}/pr/estado/CORPLLC02/current/original.pdf`,
    requirementCode: "DOC_ARTICLES_ORGANIZATION",
    usageNotes: [
      "No native AcroForm fields — populated by coordinate overlay over the untouched background.",
      "Overlay coordinates are version-bound; a new agency revision requires re-measuring before reuse.",
      "Applies when business.entity_type is a limited liability company.",
    ],
  },
  {
    formCode: "SS4",
    title: "Form SS-4 — Application for Employer Identification Number",
    agency: "Internal Revenue Service",
    scope: "federal",
    artifactType: "official_pdf_form",
    populationMethod: "acroform",
    submissionChannel: "agency_portal",
    sourceStatus: "official_source",
    sourceFile: `${REAL_FORMS_DIR}/fss4.pdf`,
    storagePath: `${OFFICIAL_TEMPLATE_BUCKET}/federal/irs/SS4/current/original.pdf`,
    requirementCode: "DOC_EIN",
    usageNotes: [
      "89 native AcroForm fields carrying XFA-derived names (f1_N) that convey no meaning — mappings are hand-written against the IRS line numbers, not inferred from labels.",
      "This is the EIN APPLICATION. The IRS CP 575 notice the agency issues back is separate evidence the applicant still uploads.",
      "Signature, title and phone on the third-party/designee block are left blank: they require the filer's own act.",
    ],
  },
  {
    formCode: "SC2309",
    title: "Modelo SC 2309 — Solicitud de Licencias",
    agency: "Departamento de Hacienda",
    scope: "statewide",
    artifactType: "official_pdf_form",
    populationMethod: "pdf_overlay",
    submissionChannel: "agency_portal",
    sourceStatus: "official_source",
    revision: "Rev. 28 ago 14 (Rep. 26 jun 17)",
    sourceFile: `${REAL_FORMS_DIR}/sc_2309_0.pdf`,
    storagePath: `${OFFICIAL_TEMPLATE_BUCKET}/pr/hacienda/SC2309/current/original.pdf`,
    requirementCode: "DOC_HACIENDA_LICENSE",
    usageNotes: [
      "Conditional: applies only when an activity requires a Hacienda internal-revenue license.",
      "Never attach to every food-service business — see applicability.ts for the trigger set.",
    ],
  },
  {
    formCode: "NC001",
    title: "Solicitud de Registro de Nombre Comercial (Trade Name / DBA)",
    agency: "Puerto Rico Department of State — Registro de Marcas y Nombres Comerciales",
    scope: "statewide",
    artifactType: "official_pdf_form",
    populationMethod: "pdf_overlay",
    submissionChannel: "agency_portal",
    sourceStatus: "official_source",
    sourceFile: `${REAL_FORMS_DIR}/NC001-Solicitud-Registro-Nombre-Comercial.pdf`,
    storagePath: `${OFFICIAL_TEMPLATE_BUCKET}/pr/estado/NC001/current/original.pdf`,
    requirementCode: "DOC_DBA_REGISTRATION",
    usageNotes: [
      "No native AcroForm fields — populated by coordinate overlay over the untouched background.",
      "6 pages: page 1 is the application, page 2 the sworn declaration (notary block), page 3 the trade-name description; pages 4-6 are instructions only and carry no mapped fields.",
      "The JURAMENTO/notary block and both signature lines are never written by SmartPR — see NC001_OVERLAY in overlayMaps.ts for field ownership.",
      "Registration lasts 10 years under Act 75-1992. The $150 filing fee (Comprobante de Rentas Internas, cifra de cuenta 1705) is paid at filing, not printed on the form.",
      "Coordinates were not read off ruled-line glyphs alone: every x/y was taken from the PDF's own text-content layer, then the populated PDF was re-rendered to an image and visually checked page by page — four placements printed on top of a ruled line on the first pass and were nudged clear. Still reviewed: false, same standard the rest of overlayMaps.ts uses.",
    ],
  },
  {
    formCode: "LUMAINT01",
    title: "Confirmación de Orientación al Cliente — Interconexión de Generación Distribuida (Rev. 10-2021)",
    agency: "LUMA Energy Servco, LLC (agent of the Puerto Rico Electric Power Authority)",
    scope: "statewide",
    artifactType: "official_pdf_form",
    populationMethod: "pdf_overlay",
    submissionChannel: "agency_portal",
    sourceStatus: "official_source",
    revision: "Rev 10-2021",
    sourceFile: `${REAL_FORMS_DIR}/LUMA-Confirmacion-Orientacion-Cliente-Rev10-2021.pdf`,
    storagePath: `${OFFICIAL_TEMPLATE_BUCKET}/pr/luma/LUMAINT01/current/original.pdf`,
    requirementCode: "DOC_LUMA_INTERCONNECTION",
    usageNotes: [
      "One-page customer attestation in LUMA's distributed-generation interconnection registration package: the customer certifies a certified installer (or company representative) oriented them on the interconnection process and net-metering programs.",
      "No native AcroForm fields — populated by coordinate overlay over the untouched background.",
      "Fillable blanks: customer name, LUMA account number, installer name, installer company, applicable regulation checkboxes (distribution vs. transmission/subtransmission), project name, project number, capacity (kW), project physical address.",
      "Both signature blocks (customer and installer representative) are never written by SmartPR — sign by hand. See LUMAINT01_OVERLAY in overlayMaps.ts for field ownership.",
      "Source: official LUMA document 'Confirmación de Orientación al Cliente', Rev 10-2021, published at lumapr.com (Nov 2023 document set).",
    ],
  },
  {
    formCode: "DACOUC01",
    title: "Solicitud de Licencia para Urbanizador y/o Constructor (DACO, Rev. Ene 2019 v2)",
    agency: "Departamento de Asuntos del Consumidor (DACO) — Gobierno de Puerto Rico",
    scope: "statewide",
    artifactType: "official_pdf_form",
    populationMethod: "pdf_overlay",
    submissionChannel: "agency_portal",
    sourceStatus: "official_source",
    revision: "Rev. Ene 2019 v2",
    sourceFile: `${REAL_FORMS_DIR}/DACO-Solicitud-Urbanizador-Constructor-v2.pdf`,
    storagePath: `${OFFICIAL_TEMPLATE_BUCKET}/pr/daco/DACOUC01/current/original.pdf`,
    requirementCode: "DOC_CONTRACTOR_LICENSE",
    usageNotes: [
      "9-page DACO license application for developers (urbanizadores) and builders (constructores). SmartPR maps the key applicant fields on page 1 only: name, phone, physical and mailing addresses, the two license-request checkbox rows, activity type (constructor / urbanizador / ambos / otros), and organization type.",
      "No native AcroForm fields — populated by coordinate overlay over the untouched background. 18 overlay rows, every x/y taken from the PDF's own text-content layer (the two long address blanks are vector ruled lines found by dark-run scan) and checked against a rendered populated copy.",
      "Questions 8–15 (professional licenses, corporation details, officers/directors, financial standing, projects, annex checklist) are not mapped — the filer completes them on the printed PDF.",
      "Pages 8–9 (declaración jurada before a notary, and the corporate project-responsibility form with officer signature + notary affidavit) are never written by SmartPR — see DACOUC01_OVERLAY in overlayMaps.ts for field ownership.",
      "The thin ruled lines above fields 5, 6, 7 and 8 are section dividers, not writable blanks (verified against the render).",
      "Fees per the annex checklist in the official document set (page 6): regular license $75, provisional license $50.",
      "KB discrepancy (do not change the KB without review): documents.json lists DOC_CONTRACTOR_LICENSE's agency as 'Department of State', but the official application is issued by DACO.",
    ],
  },
  {
    formCode: "PA02",
    title: "Solicitud de Patente Provisional (OCAM PA02)",
    agency: "Municipal finance office (OCAM statewide form)",
    scope: "statewide",
    artifactType: "official_pdf_form",
    populationMethod: "acroform",
    submissionChannel: "municipal_office",
    sourceStatus: "official_source",
    lastVerifiedAt: "2026-09-03T00:00:00.000Z",
    revision: "OCAM PA02 - Rev. Mayo 2009",
    sourceFile: `${REAL_FORMS_DIR}/PA02-Solicitud-de-Patente-Provisional.pdf`,
    storagePath: `${MUNICIPAL_TEMPLATE_BUCKET}/generic/PA02/current/original.pdf`,
    requirementCode: "DOC_PATENTE_MUNICIPAL",
    usageNotes: [
      "OCAM (Oficina del Comisionado de Asuntos Municipales) publishes PA02 as one standardized statewide intake form — the printed layout does not vary by municipality; `Municipio` is a blank field the applicant fills in, same as every other applicant field.",
      "Source confirmed directly against the official form by the SmartPR product owner (2026-09-03). Previously carried as `genericized_municipal_template`/`genericized_working_copy` out of caution about provenance; that caution is resolved for this revision.",
      "45 native AcroForm fields. The bottom 'USO OFICIAL SOLAMENTE' box and the 'JURAMENTO' (sworn statement / notarization) block are never populated by SmartPR — see form-mappings/PA02.json field ownership.",
      "Two fields in the original auto-generated mapping ('Tipo de Negocio (Sección Uso Oficial)' and 'Nombre Corto') had been semantically matched to business fields by the inspection tool despite sitting inside the USO OFICIAL box; corrected to government_only during human review. Recorded here because a re-run of `forms:inspect` overwrites this mapping's own notes with exactly this list.",
    ],
  },
  {
    formCode: "PA01",
    title: "Declaración de Volumen de Negocios (OGP PA01 – REV FEBRERO 2025)",
    agency: "Municipal finance office (OGP PA01 statewide form)",
    scope: "statewide",
    artifactType: "official_pdf_form",
    populationMethod: "acroform",
    submissionChannel: "municipal_office",
    sourceStatus: "official_source",
    lastVerifiedAt: "2026-09-10T00:00:00.000Z",
    revision: "OGP PA01 – REV FEBRERO 2025",
    sourceFile: `${REAL_FORMS_DIR}/PA01-Declaracion-Volumen-Negocios-Rev-Feb-2025.pdf`,
    storagePath: `${MUNICIPAL_TEMPLATE_BUCKET}/generic/PA01/current/original.pdf`,
    requirementCode: "DOC_PATENTE_MUNICIPAL",
    usageNotes: [
      "The ANNUAL municipal patente declaration every Puerto Rico business files — distinct from PA02, the one-time provisional application for new businesses. Both live under DOC_PATENTE_MUNICIPAL; routing.ts sends already-operating businesses to PA01 and new businesses to PA02.",
      "Provenance: genuine OGP-issued REV FEBRERO 2025 — the header «GOBIERNO DE PUERTO RICO / OGP PA01 – REV FEBRERO 2025» was verified inside the PDF. The only accessible copy is third-party-hosted (Colegio de CPA); no OGP/OCAM direct host was found.",
      "36 native AcroForm fields mapped on pages 1–2 (the filing header). The tipo-de-patente and tipo-de-negocio choices are independent checkboxes in the PDF, not a radio group — the population layer checks exactly one of each set and unchecks the rest.",
      "Deliberately NOT mapped: the Encasillado 1 computation summary, the pages 2–4 financial schedules, the «¿Nueva Dirección?» checkboxes and the certification-paragraph date blanks. Those are the taxpayer's (or their CPA's) computation from the books — SmartPR leaves them blank for completion by hand; see form-mappings/PA01.json field ownership.",
      "The «Número de Seguro Social o Número de Identificación Patronal» blank is shared: SmartPR prints the business EIN into it ONLY for Corporación/Sociedad; for Individuo/Entidad Ignorada it stays blank so the filer hand-writes their own SSN. Never auto-filled from the profile.",
      "The CERTIFICACION signature line and its date are never written by SmartPR — signed by hand at filing.",
    ],
  },
  {
    formCode: "AGRIIND01",
    title: "Solicitud Agricultor Bona Fide (Para Individuos) — DA-OCAB-05, Rev. ABRIL 2021",
    agency: "Departamento de Agricultura (Gobierno de Puerto Rico)",
    scope: "statewide",
    artifactType: "official_pdf_form",
    populationMethod: "acroform",
    submissionChannel: "in_person",
    sourceStatus: "official_source",
    revision: "Rev. ABRIL 2021",
    sourceFile: `${REAL_FORMS_DIR}/AGRI-Bonafide-Individuo.pdf`,
    storagePath: `${OFFICIAL_TEMPLATE_BUCKET}/pr/agricultura/AGRIIND01/current/original.pdf`,
    requirementCode: "DOC_AGRICULTURE_REGISTRATION",
    usageNotes: [
      "Official form: 'SOLICITUD AGRICULTOR BONA FIDE (PARA INDIVIDUOS) POR LA LEY NÚM. 60 DE 1 DE JULIO DE 2019', Modelo DA-OCAB-05, Rev. ABRIL 2021 — the natural-person variant of the Bona Fide Farmer certification. (The juridical-entity variant is AGRICORP01.)",
      "6 pages, 136 native AcroForm text fields, all human-reviewed against the PDF's text layer — see form-mappings/AGRIIND01.json field ownership.",
      "Never written by SmartPR: the three SSN boxes (personal, patronal, spouse — personal government identifiers the filer writes by hand, PA02 precedent), the 'Firma del Agricultor o Representante Autorizado' signature line, the entire section 23 (agronomist: 14a/14b income computation, RECOMENDACIÓN, Cumple/No Cumple, numbered 1-10 evaluation, agronomist signature), section 24 (regional director observations and signature), and the 'Para Uso Interno' header (OFICINA REGIONAL, MUNICIPIO, Núm. Solicitud).",
      "The Km. blanks (19a and 19b) have no AcroForm widgets at all — they can only be completed by hand on the printed form.",
      "No fee is printed on the form; confirm any filing cost with the Department of Agriculture's regional office.",
    ],
  },
  {
    formCode: "AGRICORP01",
    title: "Solicitud Agricultor Bona Fide (Corporaciones, Sociedades Especiales o Sucesiones) — DA-OCAB-05 (Corporaciones), Rev. ABRIL 2021",
    agency: "Departamento de Agricultura (Gobierno de Puerto Rico)",
    scope: "statewide",
    artifactType: "official_pdf_form",
    populationMethod: "pdf_overlay",
    submissionChannel: "in_person",
    sourceStatus: "official_source",
    revision: "Rev. ABRIL 2021",
    sourceFile: `${REAL_FORMS_DIR}/AGRI-Bonafide-Corporacion-2021.pdf`,
    storagePath: `${OFFICIAL_TEMPLATE_BUCKET}/pr/agricultura/AGRICORP01/current/original.pdf`,
    requirementCode: "DOC_AGRICULTURE_REGISTRATION",
    usageNotes: [
      "Official form: 'SOLICITUD AGRICULTOR BONA FIDE (CORPORACIONES, SOCIEDADES ESPECIALES O SUCESIONES) POR LA LEY NÚM. 60 DE 1 DE JULIO DE 2019', Modelo DA-OCAB-05 (Corporaciones), Rev. ABRIL 2021 — the juridical-entity variant of the Bona Fide Farmer certification. (The natural-person variant is AGRIIND01.)",
      "7 pages, flat PDF with no AcroForm fields — populated by coordinate overlay: 167 overlay rows, all human-reviewed against populated renders (form-mappings/AGRICORP01.json).",
      "Unlike the individuo variant, the employer identifier (2. Seguro Social Patronal) and the section-6 member SSNs ARE written to the PDF — passed as sensitive: true so population metadata records only [provided], never the raw number (SS-4 precedent).",
      "Never written by SmartPR: the 'Para Uso Interno' header (OFICINA REGIONAL, MUNICIPIO, Núm. Solicitud), the 'Firma del Agricultor o Representante Autorizado' signature line (hand-signed), the entire section 14 (agronomist: income computation, RECOMENDACIÓN, Cumple/No Cumple, agronomist signature) and section 15 (regional director observations, date, signature).",
      "The Sucesión entity-kind box has no canonical mapping — the filer marks it by hand on the printed form when it applies.",
      "No fee is printed on the form; confirm any filing cost with the Department of Agriculture's regional office.",
    ],
  },
  {
    formCode: "EPAFORM1",
    title: "EPA Form 3510-1 — NPDES Application for Permit to Discharge Wastewater: General Information (Revised 07/2023)",
    agency: "U.S. Environmental Protection Agency — Region 2 (Caribbean Environmental Protection Division, Guaynabo)",
    scope: "federal",
    artifactType: "official_pdf_form",
    populationMethod: "acroform",
    submissionChannel: "agency_portal",
    sourceStatus: "official_source",
    lastVerifiedAt: "2026-09-10T00:00:00.000Z",
    revision: "Revised 07/2023 (OMB No. 2040-0004, expires 07/31/2026)",
    sourceFile: `${REAL_FORMS_DIR}/EPA-NPDES-Form-1-2023.pdf`,
    storagePath: `${OFFICIAL_TEMPLATE_BUCKET}/federal/epa/EPAFORM1/current/original.pdf`,
    requirementCode: "DOC_NPDES_INDUSTRIAL",
    usageNotes: [
      "Puerto Rico is NOT an NPDES-delegated state: EPA Region 2 issues NPDES permits in Puerto Rico directly, so this federal form is the correct PR artifact. Puerto Rico's Junta de Calidad Ambiental handles the separate state water-quality certification, not the NPDES permit itself.",
      "Form 1 is the general-information cover every NPDES applicant files. For existing manufacturing, commercial, mining, or silvicultural dischargers it must accompany Form 2C — see EPAFORM2C.",
      "The printed form is 4 pages (Sections 1–11). Pages 1–19 of the PDF are instructions only and carry no mapped fields.",
      "SmartPR writes the applicant-owned text fields via the native AcroForm: EPA ID and NPDES permit numbers, SIC/NAICS codes, the split facility/operator address boxes, cooling-water source, and any existing-permit numbers (which check the matching Section 6 box automatically). The facility/contact/operator identity blocks resolve from the canonical profile.",
      "Deliberately NOT written: every Yes/No and multi-option radio (Section 1 screening, 4.2, 4.3 operator status, 5.1 Indian land, 7.1 map, 9.1 cooling water) — the Yes/No pairs share one field name per pair in a checkbox construct the PDF library cannot address separately, so the filer marks them by hand on the printed form. Also not written: Section 10 variance requests, the Section 11.1 checklist of completed sections, and the entire Section 11.2 certification block — printed name, official title, date signed and signature — which the responsible official completes by hand. EPA does not accept electronic signatures on this form.",
    ],
  },
  {
    formCode: "EPAFORM2C",
    title: "EPA Form 3510-2C — NPDES Application for Existing Manufacturing, Commercial, Mining, and Silvicultural Dischargers (Revised 07/2023)",
    agency: "U.S. Environmental Protection Agency — Region 2 (Caribbean Environmental Protection Division, Guaynabo)",
    scope: "federal",
    artifactType: "official_pdf_form",
    populationMethod: "acroform",
    submissionChannel: "agency_portal",
    sourceStatus: "official_source",
    lastVerifiedAt: "2026-09-10T00:00:00.000Z",
    revision: "Revised 07/2023 (OMB No. 2040-0004, expires 07/31/2026)",
    sourceFile: `${REAL_FORMS_DIR}/EPA-NPDES-Form-2C-2023.pdf`,
    storagePath: `${OFFICIAL_TEMPLATE_BUCKET}/federal/epa/EPAFORM2C/current/original.pdf`,
    requirementCode: "DOC_NPDES_INDUSTRIAL",
    usageNotes: [
      "The substantive application for existing industrial dischargers — filed TOGETHER with Form 1 (General Information). Puerto Rico is not NPDES-delegated: EPA Region 2 (Guaynabo) is the permitting authority.",
      "SmartPR maps only the non-technical applicant fields: the running header (facility name, EPA ID and NPDES permit numbers) and the Section 1.1 outfall basics for the first two outfalls (outfall number and receiving-water name). Every effluent-characteristics table (Sections 7+, pollutant concentrations from lab sampling) is the applicant's engineer's data and stays blank for completion by hand.",
      "Deliberately NOT written: the outfall latitude/longitude boxes (both boxes share one field name per row, so they cannot be written separately), the Section 1 screening yes/no boxes (anonymous widgets the PDF library cannot address), any third or further outfall row, and the Section 12.2 certification block on the final form page — printed name, title, date and signature — which the responsible official completes by hand. EPA does not accept electronic signatures on this form.",
    ],
  },
  {
    formCode: "CBP301",
    title: "CBP Form 301 — Customs Bond (04/24)",
    agency: "U.S. Customs and Border Protection (CBP), Department of Homeland Security",
    scope: "federal",
    artifactType: "official_pdf_form",
    populationMethod: "acroform",
    submissionChannel: "agency_portal",
    sourceStatus: "official_source",
    revision: "CBP Form 301 (04/24); OMB No. 1651-0050, expiration 08/31/2025",
    sourceFile: `${REAL_FORMS_DIR}/CBP-Form-301.pdf`,
    storagePath: `${OFFICIAL_TEMPLATE_BUCKET}/federal/cbp/CBP301/current/original.pdf`,
    requirementCode: "DOC_CUSTOMS_BROKER_BOND",
    usageNotes: [
      "Official CBP Form 301 'CUSTOMS BOND' under 19 CFR Part 113, posted by CBP (cbp.gov) 04/30/2024. 5 pages, 114 fillable AcroForm widgets.",
      "OMB caveat (do not hide): CBP's own page notes the OMB approval (No. 1651-0050, expired 08/31/2025) is expired, but the form remains valid for use while under OMB review for a new expiration date.",
      "Modern-path caveat (do not present paper as the normal route): in practice continuous bonds are filed electronically through CBP's eBond process in ACE, arranged by the importer's customs broker and surety — the paper Form 301 is the legacy path. The form's notices advise confirming with the broker/surety before filing paper.",
      "Key-field scope only: page-1 bond terms (Section I single/continuous + dates), one Section II activity checkbox + its limit of liability (the form says 'Check one box only'; population enforces it and clears stale amounts on unselected activities), principal identity, and surety identity basics. Checkbox↔liability pairings verified by widget-rect proximity against the PDF's text layer — see form-mappings/CBP301.json.",
      "Never written by SmartPR: both signature lines, the CBP-assigned bond number ('BOND NUMBER (Assigned by CBP)' in the CBP USE ONLY box), the seal-declaration checkboxes, the surety-requested mailing address, and the page-2 co-principal / co-surety / Section III trade-name blocks — the filer, broker or surety completes those by hand.",
      "No fee is printed on the form — the bond premium is set by the surety, not by CBP.",
    ],
  },
  {
    formCode: "PA03",
    title: "Solicitud de Prórroga de Declaración (generic municipal layout)",
    agency: "Municipal finance office",
    scope: "municipality_specific",
    artifactType: "genericized_municipal_template",
    populationMethod: "acroform",
    submissionChannel: "municipal_office",
    sourceStatus: "genericized_working_copy",
    sourceFile: `${REAL_FORMS_DIR}/PA03-Solicitud-de-Prorroga-de-Declaracion.pdf`,
    storagePath: `${MUNICIPAL_TEMPLATE_BUCKET}/generic/PA03/current/original.pdf`,
    requirementCode: "DOC_PATENTE_DECLARATION_EXTENSION",
    usageNotes: [
      ...GENERIC_MUNICIPAL_NOTES,
      "Ongoing compliance / renewal artifact — never part of a new-business formation package.",
    ],
  },
  {
    formCode: "PA04",
    title: "Mantenimiento de Contribuyente / Deudor (generic municipal layout)",
    agency: "Municipal finance office",
    scope: "municipality_specific",
    artifactType: "genericized_municipal_template",
    populationMethod: "acroform",
    submissionChannel: "municipal_office",
    sourceStatus: "genericized_working_copy",
    sourceFile: `${REAL_FORMS_DIR}/PA04-Mant-Contribuyente-Deudor.pdf`,
    storagePath: `${MUNICIPAL_TEMPLATE_BUCKET}/generic/PA04/current/original.pdf`,
    requirementCode: "DOC_MUNICIPAL_TAXPAYER_MAINTENANCE",
    usageNotes: [
      ...GENERIC_MUNICIPAL_NOTES,
      "Taxpayer-record maintenance; not every municipality uses a document of this kind.",
    ],
  },
];

export const TEMPLATES_BY_CODE: Record<string, TemplateDescriptor> = Object.fromEntries(
  TEMPLATE_LIBRARY.map((t) => [t.formCode, t])
);

export function getTemplate(formCode: string): TemplateDescriptor | undefined {
  return TEMPLATES_BY_CODE[formCode];
}

/** Templates whose original file is present locally (inspectable / populatable). */
export function availableTemplates(): TemplateDescriptor[] {
  return TEMPLATE_LIBRARY.filter((t) => t.sourceStatus !== "pending_source" && Boolean(t.sourceFile));
}

/** Templates SmartPR knows about but has no file for yet. */
export function pendingTemplates(): TemplateDescriptor[] {
  return TEMPLATE_LIBRARY.filter((t) => t.sourceStatus === "pending_source");
}

/**
 * True when the artifact may be shown to a user as an official government form.
 * Genericized municipal layouts always return false.
 */
export function isOfficialArtifact(template: TemplateDescriptor): boolean {
  return (
    (template.artifactType === "official_pdf_form" || template.artifactType === "official_docx_form") &&
    template.sourceStatus === "official_source"
  );
}
