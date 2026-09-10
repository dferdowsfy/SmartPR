// ============================================================================
// EPAFORM1 — EPA Form 3510-1, NPDES Application for Permit to Discharge
// Wastewater: GENERAL INFORMATION (Revised 07/2023, OMB 2040-0004 exp. 07/31/2026).
//
// Puerto Rico is NOT an NPDES-delegated state: EPA Region 2 (Caribbean
// Environmental Protection Division, Guaynabo) issues NPDES permits in Puerto
// Rico directly, so this federal form is the correct PR artifact. Form 1 is
// the general-information cover every NPDES applicant files; for existing
// manufacturing, commercial, mining, or silvicultural dischargers it must
// accompany Form 2C (see EPAFORM2C).
//
// FIELD IDS ARE A CONTRACT. `artifacts/formDataPopulation.ts::epaForm1Values()`
// writes this form's applicant-owned answers into the official PDF's native
// AcroForm fields by these exact ids — epa_id_number, npdes_permit_number,
// sic_code_1/2, sic_desc_1/2, naics_code_1/2, naics_desc_2/2,
// cooling_water_source, the eight existing_*_number ids, and the split
// address ids mailing_address / location_address / operator_address (each
// split into street/city/state/zip boxes by epaForm1Values). Renaming one
// here silently stops it reaching the PDF.
//
// `form-mappings/EPAFORM1.json` carries the field-level review: every native
// field is marked reviewed, with ownership smartpr_derived (canonical
// profile), applicant (written here via directAcroValues), or signature
// (Section 11.2 certification block — never written).
//
// Deliberately NOT written by SmartPR and never collected here:
//   * Every Yes/No and multi-option radio on the form (Section 1 screening,
//     4.2, 4.3 operator status, 5.1 Indian land, 7.1 map, 9.1 cooling water).
//     The Yes/No pairs share one field name per pair in a checkbox construct
//     the PDF library cannot address separately — the filer marks them by
//     hand on the printed form.
//   * Section 10 variance requests (a specialist determination with the
//     permit writer) and the Section 11.1 checklist of completed sections.
//   * The Section 11.2 certification block — printed name, official title,
//     date signed, signature. EPA does not accept electronic signatures on
//     this form.
// ============================================================================

import type { DigitalFormDefinition } from "../../../engine/types.ts";
import { t } from "../../pr/department-of-state/shared.ts";

export const EPAFORM1: DigitalFormDefinition = {
  id: "FORM_EPA_NPDES_FORM1",
  officialFormNumber: "EPAFORM1",
  requirementId: "DOC_NPDES_INDUSTRIAL",
  variantKey: "npdes_general_information",
  title: t(
    "EPA Form 3510-1 — NPDES Permit Application: General Information",
    "Formulario 3510-1 de la EPA — Solicitud de permiso NPDES: Información general"
  ),
  agency: "U.S. Environmental Protection Agency — Region 2 (Caribbean Environmental Protection Division, Guaynabo)",
  jurisdiction: "pr",
  version: "1.0.0",
  verificationStatus: "extracted_from_official_pdf",
  sourceDocument: "EPA-NPDES-Form-1-2023.pdf",
  officialSourceUrl: "https://www.epa.gov/npdes",
  resultingDocumentName: t(
    "Completed EPA Form 3510-1 (General Information) for the NPDES permit application package",
    "Formulario 3510-1 de la EPA (Información general) completado para el paquete de solicitud del permiso NPDES"
  ),
  submissionMethod: "generated_preparation_pdf",
  officialEvidenceStillRequired: true,
  applicability: [],
  sections: [
    {
      id: "facility",
      title: t("Facility", "Instalación"),
      description: t(
        "The site that will discharge wastewater. Prefilled from your SmartPR profile — correct anything that is wrong.",
        "El lugar donde se descargará el agua usada. Precargado desde su perfil de SmartPR — corrija lo que esté mal."
      ),
      fields: [
        {
          id: "facility_name",
          label: t("Facility name", "Nombre de la instalación"),
          type: "text",
          required: true,
          canonicalKey: "business.legalName",
          helpText: t(
            "Printed in the form header and in Section 2.1. Confirm the site name if it trades under a different name.",
            "Se imprime en el encabezado del formulario y en la Sección 2.1. Confirme el nombre del lugar si opera con otro nombre."
          ),
        },
        {
          id: "mailing_address",
          label: t("Facility mailing address", "Dirección postal de la instalación"),
          type: "address",
          required: true,
          canonicalKey: "addresses.principalMailing",
        },
        {
          id: "location_address",
          label: t("Facility physical location", "Ubicación física de la instalación"),
          type: "address",
          required: true,
          canonicalKey: "addresses.operatingAddress",
        },
        {
          id: "county",
          label: t("County / Municipio", "Condado / Municipio"),
          type: "text",
          required: true,
          canonicalKey: "addresses.municipality",
          helpText: t(
            "Puerto Rico has municipios, not counties — your municipio goes here.",
            "Puerto Rico tiene municipios, no condados — aquí va su municipio."
          ),
        },
      ],
    },
    {
      id: "identifiers",
      title: t("EPA and permit numbers", "Números de EPA y del permiso"),
      description: t(
        "Leave both blank if this is a first-time application — EPA assigns the identification number.",
        "Déjelos en blanco si es una solicitud nueva — la EPA asigna el número de identificación."
      ),
      fields: [
        {
          id: "epa_id_number",
          label: t("EPA Identification Number (if already assigned)", "Número de identificación de la EPA (si ya fue asignado)"),
          type: "text",
        },
        {
          id: "npdes_permit_number",
          label: t("Existing NPDES permit number (if renewing)", "Número del permiso NPDES vigente (si está renovando)"),
          type: "text",
        },
      ],
    },
    {
      id: "facility_contact",
      title: t("Facility contact", "Persona contacto de la instalación"),
      description: t(
        "Who EPA calls about this application. Prefilled from your SmartPR profile.",
        "A quién llama la EPA sobre esta solicitud. Precargado desde su perfil de SmartPR."
      ),
      fields: [
        {
          id: "contact_name",
          label: t("Name (first and last)", "Nombre y apellidos"),
          type: "text",
          required: true,
          canonicalKey: "contact.fullName",
        },
        {
          id: "contact_title",
          label: t("Title", "Título o puesto"),
          type: "text",
          required: true,
          canonicalKey: "contact.role",
        },
        {
          id: "contact_phone",
          label: t("Phone number", "Número de teléfono"),
          type: "phone",
          required: true,
          canonicalKey: "contact.phone",
        },
        {
          id: "contact_email",
          label: t("Email address", "Correo electrónico"),
          type: "email",
          required: true,
          canonicalKey: "contact.email",
        },
      ],
    },
    {
      id: "sic_naics",
      title: t("SIC and NAICS codes", "Códigos SIC y NAICS"),
      description: t(
        "The industry classification codes for what this facility does. Your CPA or environmental consultant will know them.",
        "Los códigos de clasificación industrial de lo que hace esta instalación. Su CPA o consultor ambiental los sabrá."
      ),
      fields: [
        {
          id: "sic_code_1",
          label: t("Primary SIC code", "Código SIC principal"),
          type: "text",
          required: true,
        },
        {
          id: "sic_desc_1",
          label: t("SIC description (optional)", "Descripción del SIC (opcional)"),
          type: "text",
        },
        {
          id: "sic_code_2",
          label: t("Additional SIC code (optional)", "Código SIC adicional (opcional)"),
          type: "text",
        },
        {
          id: "sic_desc_2",
          label: t("SIC description (optional)", "Descripción del SIC (opcional)"),
          type: "text",
        },
        {
          id: "naics_code_1",
          label: t("Primary NAICS code", "Código NAICS principal"),
          type: "text",
          required: true,
        },
        {
          id: "naics_desc_1",
          label: t("NAICS description (optional)", "Descripción del NAICS (opcional)"),
          type: "text",
        },
        {
          id: "naics_code_2",
          label: t("Additional NAICS code (optional)", "Código NAICS adicional (opcional)"),
          type: "text",
        },
        {
          id: "naics_desc_2",
          label: t("NAICS description (optional)", "Descripción del NAICS (opcional)"),
          type: "text",
        },
      ],
    },
    {
      id: "operator",
      title: t("Operator", "Operador"),
      description: t(
        "The party operating the facility — in the standard case, your business itself.",
        "Quién opera la instalación — en el caso normal, su propio negocio."
      ),
      fields: [
        {
          id: "operator_name",
          label: t("Name of operator", "Nombre del operador"),
          type: "text",
          required: true,
          canonicalKey: "business.legalName",
        },
        {
          id: "operator_phone",
          label: t("Operator phone number", "Teléfono del operador"),
          type: "phone",
          required: true,
          canonicalKey: "business.phone",
        },
        {
          id: "operator_email",
          label: t("Operator email address", "Correo electrónico del operador"),
          type: "email",
          required: true,
          canonicalKey: "contact.email",
        },
        {
          id: "operator_address",
          label: t("Operator address", "Dirección del operador"),
          type: "address",
          required: true,
          canonicalKey: "addresses.principalMailing",
        },
      ],
    },
    {
      id: "existing_permits",
      title: t("Existing environmental permits", "Permisos ambientales vigentes"),
      description: t(
        "Other environmental permits this facility already holds. Enter the permit number where one exists — SmartPR checks the matching box on the form automatically.",
        "Otros permisos ambientales que esta instalación ya tiene. Escriba el número del permiso donde aplique — SmartPR marca la casilla correspondiente en el formulario automáticamente."
      ),
      fields: [
        {
          id: "existing_npdes_number",
          label: t("NPDES (surface-water discharges) permit number", "Número de permiso NPDES (descargas a aguas superficiales)"),
          type: "text",
        },
        {
          id: "existing_rcra_number",
          label: t("RCRA (hazardous wastes) permit number", "Número de permiso RCRA (desperdicios peligrosos)"),
          type: "text",
        },
        {
          id: "existing_uic_number",
          label: t("UIC (underground injection) permit number", "Número de permiso UIC (inyección subterránea)"),
          type: "text",
        },
        {
          id: "existing_psd_number",
          label: t("PSD (air emissions) permit number", "Número de permiso PSD (emisiones al aire)"),
          type: "text",
        },
        {
          id: "existing_nonattainment_number",
          label: t("Nonattainment program (CAA) permit number", "Número de permiso del programa de no cumplimiento (CAA)"),
          type: "text",
        },
        {
          id: "existing_neshaps_number",
          label: t("NESHAPs (CAA) permit number", "Número de permiso NESHAPs (CAA)"),
          type: "text",
        },
        {
          id: "existing_ocean_dumping_number",
          label: t("Ocean dumping (MPRSA) permit number", "Número de permiso de vertido al océano (MPRSA)"),
          type: "text",
        },
        {
          id: "existing_dredge_number",
          label: t("Dredge or fill (CWA Section 404) permit number", "Número de permiso de dragado o relleno (Sección 404 de la CWA)"),
          type: "text",
        },
      ],
    },
    {
      id: "business_description",
      title: t("Nature of business", "Naturaleza del negocio"),
      fields: [
        {
          id: "nature_of_business",
          label: t("Describe the nature of your business", "Describa la naturaleza de su negocio"),
          type: "textarea",
          required: true,
          canonicalKey: "business.activityDescription",
        },
      ],
    },
    {
      id: "cooling_water",
      title: t("Cooling water", "Agua de enfriamiento"),
      fields: [
        {
          id: "cooling_water_source",
          label: t("Source of cooling water (only if the facility uses cooling water)", "Fuente del agua de enfriamiento (solo si la instalación usa agua de enfriamiento)"),
          type: "text",
          helpText: t(
            "Leave blank when the facility does not use cooling water. The yes/no question itself is marked by hand on the printed form.",
            "Déjelo en blanco si la instalación no usa agua de enfriamiento. La pregunta de sí/no se marca a mano en el formulario impreso."
          ),
        },
      ],
    },
    {
      id: "certification",
      title: t("Certification", "Certificación"),
      description: t(
        "The certification on the last page is signed under penalty of law by the responsible official — always by hand on the printed form.",
        "La certificación de la última página la firma bajo pena de ley el oficial responsable — siempre a mano en el formulario impreso."
      ),
      fields: [
        {
          id: "signature_acknowledgement",
          label: t(
            "I understand the certification block (printed name, title, date and signature) must be completed by hand on the printed form and that SmartPR leaves it blank.",
            "Entiendo que el bloque de certificación (nombre en letra de molde, título, fecha y firma) debe completarse a mano en el formulario impreso y que SmartPR lo deja en blanco."
          ),
          type: "attestation",
          required: true,
        },
      ],
    },
  ],
  notices: [
    t(
      "Form 1 is the general-information cover of the NPDES application. For an existing industrial discharger it must be filed together with EPA Form 3510-2C — SmartPR prepares both from the same profile.",
      "El Formulario 1 es la portada de información general de la solicitud NPDES. Para un descargador industrial existente debe someterse junto al Formulario 3510-2C de la EPA — SmartPR prepara ambos con el mismo perfil."
    ),
    t(
      "Several boxes on the printed form are marked by hand: the Section 1 screening yes/no answers, the operator-status radio (Section 4.3), the Indian-land, map and cooling-water yes/no answers, any variance requests (Section 10), and the Section 11 checklist of completed sections.",
      "Varias casillas del formulario impreso se marcan a mano: las respuestas de sí/no de la Sección 1, el tipo de operador (Sección 4.3), las preguntas de sí/no sobre terreno indígena, mapa y agua de enfriamiento, cualquier solicitud de varianza (Sección 10) y la lista de cotejo de la Sección 11."
    ),
    t(
      "EPA does not accept electronic signatures on this form. The responsible official prints their name and title, dates, and hand-signs the certification on the last page.",
      "La EPA no acepta firmas electrónicas en este formulario. El oficial responsable escribe su nombre y título en letra de molde, pone la fecha y firma a mano la certificación de la última página."
    ),
    t(
      "Submit the signed package to EPA Region 2 (Caribbean Environmental Protection Division, Guaynabo) as directed in the form instructions — confirm the current submittal channel before sending.",
      "Someta el paquete firmado a la Región 2 de la EPA (División de Protección Ambiental del Caribe, Guaynabo) según indican las instrucciones del formulario — confirme el canal de entrega vigente antes de enviarlo."
    ),
  ],
  feeMetadata: {
    source: t(
      "No application fee is printed on Form 1 itself. Confirm any fee with EPA Region 2 before filing.",
      "El Formulario 1 no imprime un costo de solicitud. Confirme cualquier pago con la Región 2 de la EPA antes de someter."
    ),
    requiresPortalVerification: true,
  },
};
