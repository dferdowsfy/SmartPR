// ============================================================================
// DACOUC01 — Solicitud de Licencia para Urbanizador y/o Constructor,
// Departamento de Asuntos del Consumidor (DACO), Rev. Ene 2019 v2.
//
// 9 pages, no native AcroForm fields — populated by coordinate overlay (see
// DACOUC01_OVERLAY in artifacts/overlayMaps.ts).
//
// What this document is: the license application a builder (constructor)
// and/or developer (urbanizador) files with DACO to get or renew the
// urbanizador/constructor license. SmartPR maps the applicant-facing fields
// on page 1 (identity, contact, addresses, license requested, activity type,
// organization type) — the same key-field scope as LUMAINT01.
//
// FIELD IDS ARE A CONTRACT. `artifacts/formDataPopulation.ts::dacoUc01Values()`
// writes this form's answers into the official PDF by these exact ids —
// applicant_name, applicant_phone, physical_address, postal_address (via
// their mapping rows' canonicalField, generic pass in population.ts),
// license_request, license_class, activity_type, activity_otros_text,
// org_type. Renaming one here silently stops it reaching the PDF.
//
// Deliberately NOT mapped (left blank on purpose, covered by tests):
//   * Questions 8–9 (individual professional licenses, corporation/society
//     details) and questions 10–15 (real-estate broker, engineers/architects,
//     officers and directors, financial standing, projects, annex checklist)
//     — deep conditional applicant data beyond the key-field scope.
//   * Pages 8–9: the DECLARACIÓN JURADA (sworn statement before a notary)
//     and the FORMULARIO DE RESPONSABILIDAD POR PROYECTOS A EJECUTARSE
//     (officer signature + notary affidavit) — ownership "signature"/"notary".
//   * The thin ruled lines above fields 5, 6, 7 and 8 are section dividers,
//     not writable blanks (verified against the rendered page).
//
// The applicant's name, phone and both addresses are `smartpr_derived` in the
// overlay map: populated from the shared canonical profile rather than
// re-asked. They still appear here (with canonicalKey) so the filer can see
// and correct what will be printed.
// ============================================================================

import type { DigitalFormDefinition, LocalizedText } from "../../../engine/types.ts";

function t(en: string, es: string): LocalizedText {
  return { en, es };
}

export const DACOUC01: DigitalFormDefinition = {
  id: "FORM_PR_DACO_URBANIZADOR_CONSTRUCTOR",
  officialFormNumber: "DACOUC01",
  requirementId: "DOC_CONTRACTOR_LICENSE",
  variantKey: "contractor_license",
  title: t(
    "License Application for Developer and/or Builder (DACO)",
    "Solicitud de Licencia para Urbanizador y/o Constructor (DACO)"
  ),
  agency: "Departamento de Asuntos del Consumidor (DACO) — Gobierno de Puerto Rico",
  jurisdiction: "pr",
  version: "1.0.0",
  verificationStatus: "extracted_from_official_pdf",
  sourceDocument: "DACO-Solicitud-Urbanizador-Constructor-v2.pdf",
  resultingDocumentName: t(
    "Prepared DACO developer/builder license application (applicant fields on page 1); sworn and notary pages left blank for hand completion",
    "Solicitud de licencia de urbanizador y/o constructor de DACO preparada (datos del solicitante en la página 1); las páginas juradas y notariales se dejan en blanco para completarlas a mano"
  ),
  submissionMethod: "generated_preparation_pdf",
  officialEvidenceStillRequired: true,
  applicability: [],
  sections: [
    {
      id: "solicitante",
      title: t("Applicant", "Solicitante"),
      description: t(
        "Who is requesting the license — the business or individual DACO will license.",
        "Quién solicita la licencia — el negocio o individuo que DACO va a licenciar."
      ),
      fields: [
        {
          id: "applicant_name",
          label: t("Applicant name", "Nombre del solicitante"),
          type: "text",
          required: true,
          canonicalKey: "business.legalName",
          helpText: t(
            "Printed on the '1. Nombre del Solicitante' line. Prefilled from your SmartPR profile.",
            "Se imprime en la línea '1. Nombre del Solicitante'. Precargado desde tu perfil de SmartPR."
          ),
        },
        {
          id: "applicant_phone",
          label: t("Phone", "Teléfono"),
          type: "phone",
          required: true,
          canonicalKey: "business.phone",
          helpText: t(
            "Printed on the '2. Teléfono' line. Prefilled from your SmartPR profile.",
            "Se imprime en la línea '2. Teléfono'. Precargado desde tu perfil de SmartPR."
          ),
        },
        {
          id: "physical_address",
          label: t("Physical address (street, number, town)", "Dirección física (calle, número, pueblo)"),
          type: "address",
          required: true,
          canonicalKey: "addresses.operatingAddress",
          helpText: t(
            "Printed on the '3. Dirección' line. Prefilled from your SmartPR profile.",
            "Se imprime en la línea '3. Dirección'. Precargado desde tu perfil de SmartPR."
          ),
        },
        {
          id: "postal_address",
          label: t("Mailing address", "Dirección postal"),
          type: "address",
          required: true,
          canonicalKey: "addresses.principalMailing",
          helpText: t(
            "Printed on the '4. Dirección Postal' line. Prefilled from your SmartPR profile.",
            "Se imprime en la línea '4. Dirección Postal'. Precargado desde tu perfil de SmartPR."
          ),
        },
      ],
    },
    {
      id: "licencia",
      title: t("License requested", "Licencia solicitada"),
      description: t(
        "DACO's form groups the request in two rows of checkboxes: what kind of request it is, and which license class. Answer both.",
        "El formulario de DACO agrupa la solicitud en dos filas de encasillados: qué tipo de solicitud es y qué clase de licencia. Contesta ambas."
      ),
      fields: [
        {
          id: "license_request",
          label: t("What kind of request is this?", "¿Qué tipo de solicitud es esta?"),
          type: "radio",
          required: true,
          options: [
            { value: "provisional", label: t("Provisional", "Provisional") },
            { value: "renovacion", label: t("Renewal", "Renovación") },
            { value: "ambos", label: t("Both", "Ambos") },
          ],
          helpText: t(
            "The first checkbox row on the form: provisional, renewal, or both.",
            "La primera fila de encasillados del formulario: provisional, renovación o ambos."
          ),
        },
        {
          id: "license_class",
          label: t("Which license class?", "¿Qué clase de licencia?"),
          type: "radio",
          required: true,
          options: [
            { value: "regular", label: t("Regular", "Regular") },
            { value: "provisional", label: t("Provisional", "Provisional") },
          ],
          helpText: t(
            "The second checkbox row on the form. The regular license costs $75 and the provisional $50, per DACO's annex checklist.",
            "La segunda fila de encasillados del formulario. La licencia regular cuesta $75 y la provisional $50, según la lista de documentos de DACO."
          ),
        },
      ],
    },
    {
      id: "actividad",
      title: t("Activity type", "Tipo de actividad"),
      description: t(
        "What the licensed business does — this is the core of the DACO license.",
        "A qué se dedica el negocio licenciado — esto es el corazón de la licencia de DACO."
      ),
      fields: [
        {
          id: "activity_type",
          label: t("What activity do you do?", "¿A qué actividad te dedicas?"),
          type: "radio",
          required: true,
          options: [
            { value: "constructor", label: t("Builder", "Constructor") },
            { value: "urbanizador", label: t("Developer", "Urbanizador") },
            { value: "ambos", label: t("Both", "Ambos") },
            { value: "otro", label: t("Other", "Otro") },
          ],
        },
        {
          id: "activity_otros_text",
          label: t("Specify the other activity", "Especifica la otra actividad"),
          type: "text",
          helpText: t(
            "Only if you marked 'Other' above — written on the 'Otros ___' line.",
            "Solo si marcaste 'Otro' arriba — se escribe en la línea 'Otros ___'."
          ),
        },
      ],
    },
    {
      id: "organizacion",
      title: t("Organization type", "Tipo de organización"),
      description: t(
        "The legal form of the applicant — the form asks you to pick exactly one.",
        "La forma legal del solicitante — el formulario pide escoger una sola opción."
      ),
      fields: [
        {
          id: "org_type",
          label: t("Organization type", "Tipo de organización"),
          type: "radio",
          required: true,
          options: [
            { value: "individuo", label: t("Individual", "Individuo") },
            { value: "sociedad", label: t("Partnership", "Sociedad") },
            { value: "corporacion", label: t("Corporation", "Corporación") },
            { value: "sociedad_especial", label: t("Special partnership", "Sociedad Especial") },
          ],
        },
      ],
    },
  ],
  notices: [
    t(
      "SmartPR leaves pages 8 and 9 blank on purpose — the sworn declaration (declaración jurada) and the project-responsibility form are signed before a notary, never by software.",
      "SmartPR deja las páginas 8 y 9 en blanco a propósito — la declaración jurada y el formulario de responsabilidad por proyectos se firman ante notario, nunca por un programa."
    ),
    t(
      "Questions 8 through 15 (professional licenses, corporation details, officers and directors, financial standing, projects, and the annex checklist) are not generated yet — complete them on the printed PDF.",
      "Las preguntas 8 a la 15 (licencias profesionales, datos de la corporación, oficiales y directores, situación financiera, proyectos y la lista de documentos anejos) todavía no se generan — complétalas en el PDF impreso."
    ),
  ],
  feeMetadata: {
    source: t(
      "Regular license: $75. Provisional license: $50, per the annex checklist in the official document set (page 6).",
      "Licencia regular: $75. Licencia provisional: $50, según la lista de documentos del paquete oficial (página 6)."
    ),
    requiresPortalVerification: true,
  },
};
