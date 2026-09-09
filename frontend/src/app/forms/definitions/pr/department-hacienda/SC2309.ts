// ============================================================================
// SC2309 — Modelo SC 2309: Solicitud de Licencias (Internal Revenue Licenses).
//
// Departamento de Hacienda, Negociado de Impuesto al Consumo. No native
// AcroForm fields — populated by coordinate overlay (see
// form-mappings/SC2309.json). Only 20 of 50+ fields are currently mapped;
// the remaining Información Adicional sections are not yet captured in this UI.
//
// Conditional: applies only when an activity requires a Hacienda internal-revenue
// license. Not every food-service business requires this form — see
// applicability.ts for the trigger set.
// ============================================================================

import type { DigitalFormDefinition } from "../../../engine/types.ts";

function t(en: string, es: string) {
  return { en, es };
}

export const SC2309: DigitalFormDefinition = {
  id: "FORM_PR_HACIENDA_LICENSE",
  officialFormNumber: "SC2309",
  requirementId: "DOC_HACIENDA_LICENSE",
  variantKey: "internal_revenue_license",
  title: t("Internal Revenue License Application", "Solicitud de Licencias de Impuestos Internos"),
  agency: "Departamento de Hacienda, Negociado de Impuesto al Consumo",
  jurisdiction: "pr",
  version: "1.0.0",
  verificationStatus: "extracted_from_official_pdf",
  sourceDocument: "sc_2309_0.pdf",
  resultingDocumentName: t(
    "Internal revenue license certificate issued by Departamento de Hacienda",
    "Certificado de licencia de impuestos internos emitido por el Departamento de Hacienda"
  ),
  submissionMethod: "generated_preparation_pdf",
  officialEvidenceStillRequired: true,
  applicability: [],
  sections: [
    {
      id: "parte_i_identity",
      title: t("Part I: Taxpayer identity", "Parte I: Identidad del contribuyente"),
      description: t(
        "Business registration and contact information. Prefilled from your SmartPR profile; correct anything that is wrong.",
        "Información de registro y contacto del negocio. Precargado desde su perfil de SmartPR; corrija lo que esté incorrecto."
      ),
      fields: [
        {
          id: "parte1_nombre",
          label: t("Legal business name", "Nombre legal del negocio"),
          type: "text",
          required: true,
          canonicalKey: "business.legal_name",
        },
        {
          id: "parte1_nombre_comercial",
          label: t("Trade name (if applicable)", "Nombre comercial (si aplica)"),
          type: "text",
          canonicalKey: "business.trade_name",
        },
        {
          id: "parte1_numero_identificacion_patronal",
          label: t("Federal Employer ID Number (EIN)", "Número de identificación patronal federal"),
          type: "text",
          required: true,
          canonicalKey: "business.ein",
          helpText: t(
            "The EIN assigned by the IRS. If not yet obtained, you may file for the EIN concurrently with this license.",
            "El EIN asignado por el IRS. Si aún no lo ha obtenido, puede solicitar el EIN simultáneamente con esta licencia."
          ),
        },
        {
          id: "parte1_numero_registro_comerciante",
          label: t("Merchant Registration Number", "Número de registro de comerciante"),
          type: "text",
          canonicalKey: "business.merchant_registration_number",
          helpText: t(
            "If the business is registered as a merchant with Hacienda (proof of merchant status).",
            "Si el negocio está registrado como comerciante con Hacienda."
          ),
        },
        {
          id: "parte1_numero_seguro_social",
          label: t("Social security number or individual ID", "Número de seguro social o cédula de identidad"),
          type: "text",
          helpText: t(
            "If an individual applicant or sole proprietor. This field is filled by the applicant on the printed form and is not stored by SmartPR.",
            "Si es solicitante individual o propietario único. Este campo se completa en la forma impresa y no se almacena en SmartPR."
          ),
        },
        {
          id: "parte1_tipo",
          label: t("Business entity type", "Tipo de entidad comercial"),
          type: "radio",
          required: true,
          canonicalKey: "business.entity_type",
          options: [
            { value: "sole_proprietorship", label: t("Individual / Sole proprietor", "Individuo / Propietario único") },
            { value: "partnership", label: t("Partnership", "Sociedad") },
            { value: "partnership", label: t("Limited Liability Partnership (LLP)", "Sociedad de responsabilidad limitada") },
            { value: "stock_corporation", label: t("Corporation", "Corporación") },
            { value: "limited_liability_company", label: t("Limited Liability Company (LLC)", "Compañía de responsabilidad limitada") },
          ],
          helpText: t(
            "Select the entity type that matches your business structure as registered with the PR Department of State.",
            "Seleccione el tipo de entidad que coincida con su estructura empresarial registrada ante el Departamento de Estado de PR."
          ),
        },
      ],
    },
    {
      id: "parte_i_address",
      title: t("Part I: Business address", "Parte I: Dirección del negocio"),
      fields: [
        {
          id: "parte1_direccion_postal",
          label: t("Mailing address", "Dirección postal"),
          type: "address",
          canonicalKey: "location.mailing_address",
        },
        {
          id: "parte1_localizacion_negocio",
          label: t("Business location (physical address)", "Localización del negocio (dirección física)"),
          type: "address",
          required: true,
          canonicalKey: "location.physical_address",
        },
        {
          id: "parte1_numero_telefono",
          label: t("Business telephone number", "Número de teléfono del negocio"),
          type: "phone",
          canonicalKey: "business.phone",
        },
      ],
    },
    {
      id: "parte_ii_activities",
      title: t("Part II: Activities subject to license", "Parte II: Actividades sujetas a licencia"),
      description: t(
        "Check all activities your business will conduct. Currently only the primary activities are captured here; additional activities and exemptions may be added on the printed form.",
        "Marque todas las actividades que su negocio realizará. Actualmente solo se capturan las actividades principales; se pueden añadir actividades adicionales y exenciones en el formulario impreso."
      ),
      fields: [
        {
          id: "parte2_bebidas_alcoholicas",
          label: t("Sale of alcoholic beverages", "Venta de bebidas alcohólicas"),
          type: "checkbox",
          canonicalKey: "activities.alcohol_sales",
        },
        {
          id: "parte2_gasolina",
          label: t("Sale of gasoline / fuel", "Venta de gasolina / combustible"),
          type: "checkbox",
          canonicalKey: "activities.fuel_sales",
        },
        {
          id: "parte2_cigarrillos",
          label: t("Sale of cigarettes / tobacco", "Venta de cigarrillos / tabaco"),
          type: "checkbox",
          canonicalKey: "activities.cigarette_sales",
        },
        {
          id: "parte2_promotor_espectaculos",
          label: t("Public show / entertainment promotion", "Promoción de espectáculos / entretenimiento público"),
          type: "checkbox",
          canonicalKey: "activities.public_show_promoter",
        },
        {
          id: "parte2_metales_preciosos",
          label: t("Trade in precious metals", "Negociación en metales preciosos"),
          type: "checkbox",
          canonicalKey: "activities.precious_metals",
        },
        {
          id: "parte2_armas_municiones",
          label: t("Sale of weapons / ammunition", "Venta de armas / municiones"),
          type: "checkbox",
          canonicalKey: "activities.weapons_sales",
        },
        {
          id: "parte2_maquinas_monedas",
          label: t("Coin-operated machines", "Máquinas operadas con monedas"),
          type: "checkbox",
          canonicalKey: "activities.coin_operated_machines",
        },
      ],
    },
    {
      id: "parte_iii_comments",
      title: t("Part III: Business description", "Parte III: Descripción del negocio"),
      fields: [
        {
          id: "parte3_comentarios",
          label: t("Describe the business and specific activities", "Describa el negocio y las actividades específicas"),
          type: "textarea",
          required: true,
          canonicalKey: "business.activity_description",
          helpText: t(
            "Provide a clear description of what the business does and any special or unlisted activities. This helps the tax office assess applicability and any additional license requirements.",
            "Proporcione una descripción clara de lo que hace el negocio y cualquier actividad especial o no listada. Esto ayuda a la oficina de impuestos a evaluar la aplicabilidad y requisitos de licencia adicionales."
          ),
        },
      ],
    },
  ],
};
