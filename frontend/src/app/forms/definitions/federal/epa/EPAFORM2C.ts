// ============================================================================
// EPAFORM2C — EPA Form 3510-2C, NPDES Application for EXISTING MANUFACTURING,
// COMMERCIAL, MINING, AND SILVICULTURAL DISCHARGERS (Revised 07/2023,
// OMB 2040-0004 exp. 07/31/2026).
//
// Puerto Rico is NOT an NPDES-delegated state: EPA Region 2 (Caribbean
// Environmental Protection Division, Guaynabo) issues NPDES permits in Puerto
// Rico directly, so this federal form is the correct PR artifact. Form 2C is
// the substantive application and must be filed TOGETHER with Form 1
// (General Information) — see EPAFORM1.
//
// FIELD IDS ARE A CONTRACT. `artifacts/formDataPopulation.ts::epaForm2cValues()`
// writes this form's applicant-owned answers into the official PDF's native
// AcroForm fields by these exact ids — epa_id_number, npdes_permit_number,
// outfall_1_number, outfall_1_receiving_water, outfall_2_number,
// outfall_2_receiving_water. Renaming one here silently stops it reaching
// the PDF.
//
// Scope honesty: SmartPR maps only the non-technical applicant fields — the
// running header, EPA/permit numbers, and the Section 1.1 outfall basics for
// the first two outfalls. Everything from Section 7 on (effluent and intake
// characteristics) is quantitative lab-sampling data the applicant's engineer
// completes by hand; the outfall latitude/longitude boxes share one field
// name per row and cannot be written separately; and the yes/no screening
// boxes on pages 16–19 are anonymous widgets the PDF library cannot address.
// `form-mappings/EPAFORM2C.json` records exactly which fields are mapped,
// which are never written, and why.
//
// Deliberately NOT written by SmartPR and never collected here:
//   * The Section 12.2 certification block — printed name, official title,
//     date signed, signature. EPA does not accept electronic signatures on
//     this form.
// ============================================================================

import type { DigitalFormDefinition } from "../../../engine/types.ts";
import { t } from "../../pr/department-of-state/shared.ts";

export const EPAFORM2C: DigitalFormDefinition = {
  id: "FORM_EPA_NPDES_FORM2C",
  officialFormNumber: "EPAFORM2C",
  requirementId: "DOC_NPDES_INDUSTRIAL",
  variantKey: "npdes_existing_discharger",
  title: t(
    "EPA Form 3510-2C — NPDES Application for Existing Industrial Dischargers",
    "Formulario 3510-2C de la EPA — Solicitud NPDES para descargadores industriales existentes"
  ),
  agency: "U.S. Environmental Protection Agency — Region 2 (Caribbean Environmental Protection Division, Guaynabo)",
  jurisdiction: "pr",
  version: "1.0.0",
  verificationStatus: "extracted_from_official_pdf",
  sourceDocument: "EPA-NPDES-Form-2C-2023.pdf",
  officialSourceUrl: "https://www.epa.gov/npdes",
  resultingDocumentName: t(
    "Completed EPA Form 3510-2C for the NPDES permit application package",
    "Formulario 3510-2C de la EPA completado para el paquete de solicitud del permiso NPDES"
  ),
  submissionMethod: "generated_preparation_pdf",
  officialEvidenceStillRequired: true,
  applicability: [],
  sections: [
    {
      id: "facility",
      title: t("Facility", "Instalación"),
      description: t(
        "The discharging facility. Prefilled from your SmartPR profile — correct anything that is wrong.",
        "La instalación que descarga. Precargado desde su perfil de SmartPR — corrija lo que esté mal."
      ),
      fields: [
        {
          id: "facility_name",
          label: t("Facility name", "Nombre de la instalación"),
          type: "text",
          required: true,
          canonicalKey: "business.legalName",
          helpText: t(
            "Printed in the header of every page. Confirm the site name if it trades under a different name.",
            "Se imprime en el encabezado de cada página. Confirme el nombre del lugar si opera con otro nombre."
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
      id: "outfalls",
      title: t("Outfalls", "Puntos de descarga"),
      description: t(
        "Each point where the facility discharges to a receiving water (Section 1.1). A third or further outfall is added by hand on the printed form.",
        "Cada punto donde la instalación descarga a un cuerpo de agua receptor (Sección 1.1). Un tercer punto de descarga o más se añade a mano en el formulario impreso."
      ),
      fields: [
        {
          id: "outfall_1_number",
          label: t("Outfall number — first outfall", "Número del punto de descarga — primer punto"),
          type: "text",
          required: true,
        },
        {
          id: "outfall_1_receiving_water",
          label: t("Receiving water name — first outfall", "Nombre del cuerpo de agua receptor — primer punto"),
          type: "text",
          required: true,
          helpText: t(
            "The river, creek, bay or coastal water the outfall discharges to.",
            "El río, quebrada, bahía o agua costera donde descarga el punto."
          ),
        },
        {
          id: "outfall_2_number",
          label: t("Outfall number — second outfall (optional)", "Número del punto de descarga — segundo punto (opcional)"),
          type: "text",
        },
        {
          id: "outfall_2_receiving_water",
          label: t("Receiving water name — second outfall (optional)", "Nombre del cuerpo de agua receptor — segundo punto (opcional)"),
          type: "text",
        },
      ],
    },
    {
      id: "technical_data",
      title: t("Effluent and technical data", "Datos técnicos y del efluente"),
      description: t(
        "The heart of Form 2C — and the part SmartPR does not fill. Effluent characteristics come from laboratory sampling and are prepared with the facility's environmental engineer.",
        "El corazón del Formulario 2C — y la parte que SmartPR no llena. Las características del efluente salen de muestreos de laboratorio y se preparan con el ingeniero ambiental de la instalación."
      ),
      fields: [
        {
          id: "effluent_data_acknowledgement",
          label: t(
            "I understand the effluent-characteristics tables (Sections 7 and following), the outfall latitude/longitude boxes, and the screening yes/no boxes must be completed by hand with my engineer, and that SmartPR leaves them blank.",
            "Entiendo que las tablas de características del efluente (Secciones 7 en adelante), las casillas de latitud/longitud de los puntos de descarga y las casillas de sí/no deben completarse a mano con mi ingeniero, y que SmartPR las deja en blanco."
          ),
          type: "attestation",
          required: true,
        },
      ],
    },
    {
      id: "certification",
      title: t("Certification", "Certificación"),
      description: t(
        "The certification on the last form page is signed under penalty of law by the responsible official — always by hand on the printed form.",
        "La certificación de la última página del formulario la firma bajo pena de ley el oficial responsable — siempre a mano en el formulario impreso."
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
      "Form 2C must be filed together with EPA Form 3510-1 (General Information) — SmartPR prepares both from the same profile.",
      "El Formulario 2C debe someterse junto al Formulario 3510-1 de la EPA (Información general) — SmartPR prepara ambos con el mismo perfil."
    ),
    t(
      "EPA does not accept electronic signatures on this form. The responsible official prints their name and title, dates, and hand-signs the Section 12 certification on the printed form.",
      "La EPA no acepta firmas electrónicas en este formulario. El oficial responsable escribe su nombre y título en letra de molde, pone la fecha y firma a mano la certificación de la Sección 12 en el formulario impreso."
    ),
    t(
      "Submit the signed package to EPA Region 2 (Caribbean Environmental Protection Division, Guaynabo) as directed in the form instructions — confirm the current submittal channel before sending.",
      "Someta el paquete firmado a la Región 2 de la EPA (División de Protección Ambiental del Caribe, Guaynabo) según indican las instrucciones del formulario — confirme el canal de entrega vigente antes de enviarlo."
    ),
  ],
  feeMetadata: {
    source: t(
      "No application fee is printed on Form 2C itself. Confirm any fee with EPA Region 2 before filing.",
      "El Formulario 2C no imprime un costo de solicitud. Confirme cualquier pago con la Región 2 de la EPA antes de someter."
    ),
    requiresPortalVerification: true,
  },
};
