// ============================================================================
// NC001 — Solicitud de Registro de Nombre Comercial (Trade Name / DBA).
//
// PR Department of State, Registro de Marcas y Nombres Comerciales. No native
// AcroForm fields — populated by coordinate overlay (see
// form-mappings/NC001.json). Registration lasts 10 years under Act 75-1992;
// the $150 filing fee (cifra de cuenta 1705) is paid at filing.
//
// FIELD IDS ARE A CONTRACT. `artifacts/formDataPopulation.ts::nc001Values()`
// already writes this form's applicant-owned answers into the official PDF by
// these exact ids — trade_name, entity_kind, state_or_country_or_citizenship,
// used_since, used_since_date, words_claimed, disclaimer_non_registrable,
// application_date. Renaming one here silently stops it reaching the PDF.
//
// The applicant's name, phone and principal address are `smartpr_derived` in
// form-mappings/NC001.json: populated from the shared canonical profile
// rather than re-asked. They still appear here (with canonicalKey) so the
// filer can see and correct what will be printed.
//
// Three things are never written by SmartPR and never collected here:
//   * The JURAMENTO block on page 2 (ownership: "notary")
//   * Both signature lines (ownership: "signature")
//   * The Reg. No. box, assigned by the agency (ownership: "government_only")
// ============================================================================

import type { DigitalFormDefinition } from "../../../engine/types.ts";
import { t } from "./shared.ts";

export const NC001: DigitalFormDefinition = {
  id: "FORM_PR_DOS_DBA",
  officialFormNumber: "NC001",
  requirementId: "DOC_DBA_REGISTRATION",
  variantKey: "dba",
  title: t("Trade Name Application (DBA)", "Solicitud de Registro de Nombre Comercial"),
  agency: "Puerto Rico Department of State — Registro de Marcas y Nombres Comerciales",
  jurisdiction: "pr",
  version: "1.0.0",
  verificationStatus: "extracted_from_official_pdf",
  sourceDocument: "NC001-Solicitud-Registro-Nombre-Comercial.pdf",
  resultingDocumentName: t(
    "Trade name registration certificate issued by the Department of State",
    "Certificado de registro de nombre comercial emitido por el Departamento de Estado"
  ),
  submissionMethod: "generated_preparation_pdf",
  officialEvidenceStillRequired: true,
  applicability: [],
  sections: [
    {
      id: "trade_name",
      title: t("Trade name", "Nombre comercial"),
      description: t(
        "The name you want to register. This is the asset being filed for — it is not something SmartPR already has on file.",
        "El nombre que desea registrar. Este es el activo que se está solicitando — no es algo que SmartPR ya tenga guardado."
      ),
      fields: [
        {
          id: "trade_name",
          label: t("Trade name to register", "Nombre comercial a registrar"),
          type: "text",
          required: true,
          helpText: t(
            "Printed on the 'NOMBRE COMERCIAL / TRADE NAME' line.",
            "Se imprime en la línea 'NOMBRE COMERCIAL / TRADE NAME'."
          ),
        },
        {
          id: "used_since",
          label: t("Has this trade name already been used in commerce in Puerto Rico?", "¿Este nombre comercial ya se ha usado en el comercio de Puerto Rico?"),
          type: "radio",
          required: true,
          options: [
            { value: "yes", label: t("Yes, since a specific date", "Sí, desde una fecha específica") },
            { value: "no", label: t("No, not yet used", "No, aún no se ha usado") },
          ],
        },
        {
          id: "used_since_date",
          label: t("Date first used in commerce", "Fecha de primer uso en el comercio"),
          type: "date",
          visibleWhen: [{ field: "used_since", operator: "eq", value: "yes" }],
          requiredWhen: [{ field: "used_since", operator: "eq", value: "yes" }],
          helpText: t(
            "This is sworn testimony on the official form, distinct from any 'business started operating on' date elsewhere in SmartPR — do not assume they match.",
            "Esto es testimonio jurado en el formulario oficial, distinto de cualquier fecha de 'inicio de operaciones' en otra parte de SmartPR — no asuma que coinciden."
          ),
        },
      ],
    },
    {
      id: "applicant_classification",
      title: t("Applicant classification", "Clasificación del solicitante"),
      description: t(
        "The official form offers only these two boxes and does not map cleanly onto SmartPR's business-type categories — confirm which applies.",
        "El formulario oficial ofrece solo estas dos casillas y no corresponde directamente a las categorías de tipo de negocio de SmartPR — confirme cuál aplica."
      ),
      fields: [
        {
          id: "entity_kind",
          label: t("The applicant is a", "El solicitante es una"),
          type: "radio",
          required: true,
          options: [
            { value: "natural", label: t("Natural person / individual", "Persona natural (individuo)") },
            { value: "juridica", label: t("Juristic entity (corporation, LLC, partnership, etc.)", "Persona jurídica (corporación, LLC, sociedad, etc.)") },
          ],
        },
        {
          id: "state_or_country_or_citizenship",
          label: t(
            "If a juristic entity: state or country of organization. If an individual: citizenship.",
            "Si es persona jurídica: estado o país de organización. Si es individuo: ciudadanía."
          ),
          type: "text",
          required: true,
        },
      ],
    },
    {
      id: "applicant_identification",
      title: t("Applicant identification", "Identificación del solicitante"),
      description: t(
        "Prefilled from your SmartPR profile. Correct anything that is wrong — corrections are saved back to your profile and used on every other form.",
        "Precargado desde su perfil de SmartPR. Corrija lo que esté incorrecto — las correcciones se guardan en su perfil y se usan en los demás formularios."
      ),
      fields: [
        {
          id: "applicant_name",
          label: t("Applicant's name", "Nombre del solicitante"),
          type: "text",
          required: true,
          canonicalKey: "contact.fullName",
        },
        {
          id: "applicant_phone",
          label: t("Applicant's telephone number", "Número de teléfono del solicitante"),
          type: "phone",
          required: true,
          canonicalKey: "business.phone",
        },
      ],
    },
    {
      id: "business_details",
      title: t("Business details", "Detalles del negocio"),
      fields: [
        {
          id: "principal_address",
          label: t("Physical address of the principal place of business", "Dirección física de la oficina principal de negocios"),
          type: "address",
          required: true,
          canonicalKey: "addresses.operatingAddress",
          helpText: t(
            "The form asks for both a physical and a postal address in one combined block. Only the physical address is printed — confirm the postal address separately if it differs.",
            "El formulario pide dirección física y postal en un solo bloque combinado. Solo se imprime la dirección física — confirme la dirección postal por separado si es distinta."
          ),
        },
        {
          id: "principal_phone",
          label: t("Telephone of the principal place of business", "Teléfono de la oficina principal de negocios"),
          type: "phone",
          required: true,
          canonicalKey: "business.phone",
        },
        {
          id: "nature_of_business",
          label: t("Nature of business or purpose of registration", "Actividad empresarial o propósitos del negocio"),
          type: "text",
          required: true,
          canonicalKey: "business.activityDescription",
        },
      ],
    },
    {
      id: "trade_name_description",
      title: t("Trade name description (page 3)", "Descripción del nombre comercial (página 3)"),
      description: t(
        "Optional. The form's own instructions say the applicant does not have to complete any item that does not apply.",
        "Opcional. Las instrucciones del formulario indican que el solicitante no tiene que completar ningún renglón que no aplique."
      ),
      fields: [
        {
          id: "words_claimed",
          label: t("Words claimed as part of the trade name", "Palabras reclamadas como parte del nombre comercial"),
          type: "textarea",
        },
        {
          id: "disclaimer_non_registrable",
          label: t("Disclaimer of non-registrable components", "Renuncia de componentes no registrables"),
          type: "textarea",
          helpText: t(
            "Required only if the trade name includes a word or words that are not, by themselves, capable of being registered.",
            "Solo es necesario si el nombre comercial incluye una palabra o palabras que, por sí solas, no son susceptibles de registro."
          ),
        },
      ],
    },
    {
      id: "filing",
      title: t("Filing", "Presentación"),
      fields: [
        {
          id: "application_date",
          label: t("Application date", "Fecha de la solicitud"),
          type: "date",
          required: true,
          helpText: t(
            "Defaults to today. Printed on the 'Fecha/Date' line at the top of the form.",
            "Por defecto es hoy. Se imprime en la línea 'Fecha/Date' en la parte superior del formulario."
          ),
        },
        {
          id: "notarization_acknowledgement",
          label: t(
            "I understand page 2's sworn declaration must be completed and sworn before a notary or authorized official, and that SmartPR leaves it blank.",
            "Entiendo que la declaración jurada de la página 2 debe completarse y jurarse ante un notario u oficial autorizado, y que SmartPR la deja en blanco."
          ),
          type: "attestation",
          required: true,
        },
      ],
    },
  ],
  notices: [
    t(
      "SmartPR leaves three areas of this form blank on purpose: the page-2 sworn declaration (JURAMENTO / notary block), both signature lines, and the 'Núm. Reg. / Reg. No.' box, which the Department of State assigns when it processes the filing. Complete the declaration and signatures by hand before filing.",
      "SmartPR deja tres áreas de este formulario en blanco a propósito: la declaración jurada de la página 2 (bloque de JURAMENTO), ambas líneas de firma, y la casilla 'Núm. Reg. / Reg. No.', que el Departamento de Estado asigna al procesar la solicitud. Complete la declaración y las firmas a mano antes de presentar."
    ),
    t(
      "Registration lasts 10 years under Act 75-1992. A $150 filing fee (Comprobante de Rentas Internas, cifra de cuenta 1705) is paid at filing.",
      "El registro dura 10 años bajo la Ley 75-1992. Se paga una tarifa de presentación de $150 (Comprobante de Rentas Internas, cifra de cuenta 1705) al momento de presentar."
    ),
  ],
  feeMetadata: {
    source: t(
      "$150 filing fee via Comprobante de Rentas Internas, cifra de cuenta 1705.",
      "Tarifa de presentación de $150 mediante Comprobante de Rentas Internas, cifra de cuenta 1705."
    ),
    requiresPortalVerification: false,
  },
};
