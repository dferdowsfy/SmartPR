// ============================================================================
// PA02 — Solicitud de Patente Provisional (municipal business licence / patente).
//
// OCAM (Oficina del Comisionado de Asuntos Municipales) publishes PA02 as ONE
// standardized statewide intake form: the printed layout is identical across
// Puerto Rico municipalities and `Municipio` is a blank applicant field, not a
// per-municipality variant. See artifacts/catalog.ts for the provenance note.
//
// FIELD IDS ARE A CONTRACT. `artifacts/formDataPopulation.ts::pa02Values()`
// already writes this form's applicant-owned answers into the official PDF's
// AcroForm fields by these exact ids — patente_type, patente_exempt_percent,
// business_type_pr, filing_year, uses_fiscal_year and the four fiscal-range
// ids. Renaming one here silently stops it reaching the PDF, so the ids below
// are deliberately identical to that module's expectations.
//
// Everything else the printed form asks for is `smartpr_derived` in
// form-mappings/PA02.json: it is populated from the shared canonical profile
// rather than re-asked. Those fields still appear here (with canonicalKey) so
// the filer can SEE and correct what will be printed — the renderer writes any
// correction back to the canonical profile, which is what population reads.
//
// Two blocks are never written by SmartPR and never collected here:
//   * JURAMENTO  — the notary block (ownership: "notary")
//   * USO OFICIAL SOLAMENTE — municipal staff only (ownership: "government_only")
// The owner's social security number is likewise never stored (see notices).
// ============================================================================

import type { DigitalFormDefinition, FormOption } from "../../../engine/types.ts";
import { t } from "../department-of-state/shared.ts";

/**
 * Month choices for the fiscal-year range. The stored VALUE is the Spanish
 * month name because `pa02Values()` writes it verbatim into the PDF's
 * "Mes desde Rango" / "Mes hasta Rango" text fields — this form has no coded
 * month list of its own.
 */
function MONTH_OPTIONS(): FormOption[] {
  const months: Array<[string, string]> = [
    ["Enero", "January"],
    ["Febrero", "February"],
    ["Marzo", "March"],
    ["Abril", "April"],
    ["Mayo", "May"],
    ["Junio", "June"],
    ["Julio", "July"],
    ["Agosto", "August"],
    ["Septiembre", "September"],
    ["Octubre", "October"],
    ["Noviembre", "November"],
    ["Diciembre", "December"],
  ];
  return months.map(([es, en]) => ({ value: es, label: t(en, es) }));
}

export const PA02: DigitalFormDefinition = {
  id: "FORM_PR_PATENTE_MUNICIPAL",
  officialFormNumber: "PA02",
  requirementId: "DOC_PATENTE_MUNICIPAL",
  variantKey: "patente",
  title: t(
    "Provisional Municipal Business Licence Application (Patente)",
    "Solicitud de Patente Provisional"
  ),
  agency: "Municipal finance office (OCAM statewide form)",
  jurisdiction: "pr",
  version: "1.0.0",
  verificationStatus: "extracted_from_official_pdf",
  sourceDocument: "PA02-Solicitud-de-Patente-Provisional.pdf",
  resultingDocumentName: t(
    "Patente Municipal issued by the municipality's finance office",
    "Patente Municipal emitida por la oficina de finanzas del municipio"
  ),
  // The completed PA02 is filed at the municipality's collections office; there
  // is no statewide portal that accepts it, so SmartPR's job ends at producing
  // the populated, signable PDF.
  submissionMethod: "generated_preparation_pdf",
  officialEvidenceStillRequired: true,
  // Every business operating in a municipality needs a patente, so this variant
  // carries no narrowing applicability conditions — the rules engine decides
  // whether DOC_PATENTE_MUNICIPAL applies at all.
  applicability: [],
  sections: [
    {
      id: "filing_period",
      title: t("Filing period", "Período de la solicitud"),
      description: t(
        "The patente is assessed per contributive year. Confirm the year this application covers.",
        "La patente se tasa por año contributivo. Confirme el año que cubre esta solicitud."
      ),
      fields: [
        {
          id: "filing_year",
          label: t("Contributive year being applied for", "Año contributivo solicitado"),
          type: "text",
          required: true,
          helpText: t(
            "Printed in both the 'Año Natural' and 'Año' blanks on the official form.",
            "Se imprime en los espacios 'Año Natural' y 'Año' del formulario oficial."
          ),
          validation: [{ type: "regex", param: "^(19|20)\\d{2}$", message: t("Enter a four-digit year.", "Escriba un año de cuatro dígitos.") }],
        },
        {
          id: "uses_fiscal_year",
          label: t(
            "This business uses a fiscal year that is not the calendar year",
            "Este negocio usa un año fiscal distinto al año natural"
          ),
          type: "checkbox",
          helpText: t(
            "Leave unchecked if your contributive year runs January through December.",
            "Déjelo sin marcar si su año contributivo va de enero a diciembre."
          ),
        },
        {
          id: "fiscal_year_from_month",
          label: t("Fiscal year begins — month", "El año fiscal comienza — mes"),
          type: "select",
          visibleWhen: [{ field: "uses_fiscal_year", operator: "truthy" }],
          requiredWhen: [{ field: "uses_fiscal_year", operator: "truthy" }],
          options: MONTH_OPTIONS(),
        },
        {
          id: "fiscal_year_from_year",
          label: t("Fiscal year begins — year", "El año fiscal comienza — año"),
          type: "text",
          visibleWhen: [{ field: "uses_fiscal_year", operator: "truthy" }],
          requiredWhen: [{ field: "uses_fiscal_year", operator: "truthy" }],
          validation: [{ type: "regex", param: "^(19|20)\\d{2}$", message: t("Enter a four-digit year.", "Escriba un año de cuatro dígitos.") }],
        },
        {
          id: "fiscal_year_to_month",
          label: t("Fiscal year ends — month", "El año fiscal termina — mes"),
          type: "select",
          visibleWhen: [{ field: "uses_fiscal_year", operator: "truthy" }],
          requiredWhen: [{ field: "uses_fiscal_year", operator: "truthy" }],
          options: MONTH_OPTIONS(),
        },
        {
          id: "fiscal_year_to_year",
          label: t("Fiscal year ends — year", "El año fiscal termina — año"),
          type: "text",
          visibleWhen: [{ field: "uses_fiscal_year", operator: "truthy" }],
          requiredWhen: [{ field: "uses_fiscal_year", operator: "truthy" }],
          validation: [{ type: "regex", param: "^(19|20)\\d{2}$", message: t("Enter a four-digit year.", "Escriba un año de cuatro dígitos.") }],
        },
      ],
    },
    {
      id: "patente_type",
      title: t("Type of patente", "Tipo de patente"),
      fields: [
        {
          id: "patente_type",
          label: t("Tipo de Patente", "Tipo de Patente"),
          type: "radio",
          required: true,
          options: [
            { value: "normal", label: t("Normal", "Normal") },
            { value: "exenta", label: t("Exempt (Exenta)", "Exenta") },
          ],
          helpText: t(
            "Choose Exempt only if the municipality has granted this business a patente exemption — for example under an Act 60 decree.",
            "Elija Exenta solo si el municipio le concedió una exención de patente a este negocio — por ejemplo bajo un decreto de la Ley 60."
          ),
        },
        {
          id: "patente_exempt_percent",
          label: t("Exemption percentage granted", "Porciento de exención concedido"),
          type: "number",
          visibleWhen: [{ field: "patente_type", operator: "eq", value: "exenta" }],
          requiredWhen: [{ field: "patente_type", operator: "eq", value: "exenta" }],
          helpText: t(
            "Enter the percentage stated in your exemption decree or municipal ordinance.",
            "Escriba el porciento indicado en su decreto de exención u ordenanza municipal."
          ),
          validation: [
            { type: "number_min", param: 0 },
            { type: "number_max", param: 100 },
          ],
        },
        {
          id: "business_type_pr",
          label: t("Tipo de Negocio", "Tipo de Negocio"),
          type: "radio",
          required: true,
          options: [
            { value: "individual", label: t("Individual / sole proprietor", "Individuo") },
            { value: "partnership", label: t("Partnership (Sociedad)", "Sociedad") },
            { value: "corporation", label: t("Corporation (Corporación)", "Corporación") },
          ],
          helpText: t(
            "The official form offers only these three boxes. An LLC files under Corporación unless the municipality directs otherwise.",
            "El formulario oficial ofrece solo estas tres casillas. Una LLC se presenta bajo Corporación salvo que el municipio indique otra cosa."
          ),
        },
      ],
    },
    {
      id: "business_identification",
      title: t("Business identification", "Identificación del negocio"),
      description: t(
        "Prefilled from your SmartPR profile. Correct anything that is wrong — corrections are saved back to your profile and used on every other form.",
        "Precargado desde su perfil de SmartPR. Corrija lo que esté incorrecto — las correcciones se guardan en su perfil y se usan en los demás formularios."
      ),
      fields: [
        {
          id: "municipality",
          label: t("Municipio", "Municipio"),
          type: "text",
          required: true,
          canonicalKey: "addresses.municipality",
        },
        {
          id: "business_legal_name",
          label: t(
            "Name of the individual, industry, business or service office",
            "Nombre del individuo, industria, negocio u oficina de servicio"
          ),
          type: "text",
          required: true,
          canonicalKey: "business.legalName",
        },
        {
          id: "business_activity",
          label: t("Class of industry, business or service", "Clase de industria, negocio o servicio"),
          type: "text",
          required: true,
          canonicalKey: "business.activityDescription",
        },
        {
          id: "business_phone",
          label: t("Business telephone number", "Número de teléfono del negocio"),
          type: "phone",
          required: true,
          canonicalKey: "business.phone",
        },
        {
          id: "employer_ein",
          label: t("Employer social security / EIN", "Número de Seguro Social Patronal"),
          type: "text",
          canonicalKey: "business.ein",
          helpText: t(
            "The business's federal employer identification number, not a person's social security number.",
            "El número de identificación patronal federal del negocio, no el seguro social de una persona."
          ),
        },
        {
          id: "municipal_taxpayer_id",
          label: t("Municipal identification number", "Número de identificación municipal"),
          type: "text",
          canonicalKey: "operations.municipalTaxpayerId",
          helpText: t(
            "Leave blank if the municipality has not issued one yet — it is assigned with your first patente.",
            "Déjelo en blanco si el municipio aún no ha emitido uno — se asigna con su primera patente."
          ),
        },
        {
          id: "establishment_date",
          label: t("Date the business was established", "Fecha de establecimiento"),
          type: "date",
          required: true,
          canonicalKey: "business.operationsStartDate",
          helpText: t(
            "Printed into the separate month, day and year blanks on the official form.",
            "Se imprime en los espacios separados de mes, día y año del formulario oficial."
          ),
        },
      ],
    },
    {
      id: "operations",
      title: t("Employees and payroll", "Empleados y nómina"),
      fields: [
        {
          id: "employee_count",
          label: t("Number of employees", "Número de empleados"),
          type: "number",
          required: true,
          canonicalKey: "operations.employeeCount",
          validation: [{ type: "number_min", param: 0 }],
        },
        {
          id: "annual_payroll",
          label: t("Annual payroll", "Nómina anual"),
          type: "currency",
          required: true,
          canonicalKey: "operations.estimatedAnnualPayroll",
          helpText: t(
            "Enter 0 if the business has no payroll yet.",
            "Escriba 0 si el negocio aún no tiene nómina."
          ),
          validation: [{ type: "number_min", param: 0 }],
        },
      ],
    },
    {
      id: "addresses",
      title: t("Addresses", "Direcciones"),
      fields: [
        {
          id: "physical_address",
          label: t("Physical address of the business", "Dirección física del negocio"),
          type: "address",
          required: true,
          canonicalKey: "addresses.operatingAddress",
        },
        {
          id: "mailing_address",
          label: t("Mailing address of the business", "Dirección postal del negocio"),
          type: "address",
          required: true,
          canonicalKey: "addresses.principalMailing",
        },
      ],
    },
    {
      id: "owner",
      title: t("Owner or representative", "Dueño o representante"),
      fields: [
        {
          id: "owner_name",
          label: t("Name of the owner or representative", "Nombre del dueño o representante"),
          type: "text",
          required: true,
          canonicalKey: "contact.fullName",
        },
        {
          id: "owner_title",
          label: t("Position of the owner or representative", "Posición del dueño o representante"),
          type: "text",
          required: true,
          canonicalKey: "contact.role",
        },
        // NO owner_address field. The printed form's "Dirección Residencial del
        // Dueño o Representante" is `smartpr_derived` from the canonical
        // `owner.address`, which is DERIVED (authorizedSigners[0].physicalAddress
        // ?? principalMailing) and has no single settable path. A UI field here
        // would either write the owner's home address back into the BUSINESS's
        // address (corrupting the shared profile) or collect a value that never
        // reaches the PDF. Population fills this line without one.
        {
          id: "notarization_acknowledgement",
          label: t(
            "I understand the JURAMENTO block must be completed and sworn before a notary or authorized municipal official, and that SmartPR leaves it blank.",
            "Entiendo que el bloque de JURAMENTO debe completarse y jurarse ante un notario u oficial municipal autorizado, y que SmartPR lo deja en blanco."
          ),
          type: "attestation",
          required: true,
        },
        {
          id: "ssn_acknowledgement",
          label: t(
            "I understand I must write the owner's social security number on the printed form myself — SmartPR never stores or prints it.",
            "Entiendo que debo escribir yo mismo el número de seguro social del dueño en el formulario impreso — SmartPR nunca lo guarda ni lo imprime."
          ),
          type: "attestation",
          required: true,
        },
      ],
    },
  ],
  notices: [
    t(
      "SmartPR leaves three areas of this form blank on purpose: the owner's social security number (a person's government identifier SmartPR never stores), the JURAMENTO / notary block, and the USO OFICIAL SOLAMENTE box reserved for municipal staff. Complete the first two by hand before filing.",
      "SmartPR deja tres áreas de este formulario en blanco a propósito: el número de seguro social del dueño (un identificador personal que SmartPR nunca guarda), el bloque de JURAMENTO, y el recuadro USO OFICIAL SOLAMENTE reservado para el personal municipal. Complete los dos primeros a mano antes de presentar."
    ),
    t(
      "Patente rates, due dates and any exemption are set by each municipality's own ordinance. Confirm the amount owed with your municipality's finance office before paying.",
      "Las tasas de patente, las fechas de vencimiento y cualquier exención los fija la ordenanza de cada municipio. Confirme la cantidad adeudada con la oficina de finanzas de su municipio antes de pagar."
    ),
  ],
  feeMetadata: {
    source: t(
      "Patente rates are set per municipality by ordinance under the Municipal Code; no fee is printed on the PA02 form itself.",
      "Las tasas de patente las fija cada municipio por ordenanza bajo el Código Municipal; el formulario PA02 no imprime una tarifa."
    ),
    requiresPortalVerification: true,
  },
};
