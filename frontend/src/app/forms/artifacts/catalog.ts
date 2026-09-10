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
