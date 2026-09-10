// ============================================================================
// PA01 — Declaración de Volumen de Negocios (annual municipal patente
// declaration), OGP PA01 – REV FEBRERO 2025.
//
// This is the ANNUAL declaration every Puerto Rico business files with its
// municipality — not to be confused with PA02 (Solicitud de Patente
// Provisional), the one-time new-business application. Both live under
// DOC_PATENTE_MUNICIPAL; routing.ts sends new businesses to PA02 and
// already-operating businesses to PA01 (see the ROUTES comment there).
//
// FIELD IDS ARE A CONTRACT. `artifacts/formDataPopulation.ts::pa01Values()`
// writes this form's applicant-owned answers into the official PDF's
// AcroForm fields by these exact ids — filing_year, the four fiscal-range
// ids, fiscal_year_designation, amended_return, final_return, patente_type,
// patente_exempt_percent, patente_type_other, business_type_pr and
// employer_ein. Renaming one here silently stops it reaching the PDF, so the
// ids below are deliberately identical to that module's expectations.
//
// Unlike PA02's radio groups, PA01's "Tipo de Patente" and "Tipo de Negocio"
// choices are INDEPENDENT checkboxes in the PDF — pa01Values() checks exactly
// one of each set and explicitly unchecks the rest.
//
// Everything else the printed header asks for is `smartpr_derived` in
// form-mappings/PA01.json: it is populated from the shared canonical profile
// rather than re-asked. Those fields still appear here (with canonicalKey) so
// the filer can SEE and correct what will be printed — the renderer writes any
// correction back to the canonical profile, which is what population reads.
//
// Deliberately NEVER written by SmartPR and never collected here:
//   * The Encasillado 1 computation summary and the pages 2–4 financial
//     schedules — the taxpayer's (or their CPA's) computation from the
//     business's books. They are not mapped at all; the generated PDF leaves
//     them blank for completion by hand.
//   * The CERTIFICACION signature line and its date (ownership: "signature").
//   * The filer's social security number: the "Número de Seguro Social o
//     Número de Identificación Patronal" blank is shared, so SmartPR prints
//     the business EIN into it ONLY for Corporación/Sociedad. For Individuo
//     and Entidad Ignorada the blank stays for the filer to hand-write their
//     own SSN — SmartPR never stores or prints a person's identifier.
// ============================================================================

import type { DigitalFormDefinition, FormOption } from "../../../engine/types.ts";
import { t } from "../department-of-state/shared.ts";

/**
 * Month choices for the contributive-year range. The stored VALUE is the
 * Spanish month name because `pa01Values()` writes it verbatim into the
 * "desde"/"hasta" text fields — this form has no coded month list of its own.
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

export const PA01: DigitalFormDefinition = {
  id: "FORM_PR_PATENTE_ANUAL",
  officialFormNumber: "PA01",
  requirementId: "DOC_PATENTE_MUNICIPAL",
  variantKey: "patente_anual",
  title: t(
    "Annual Municipal Business Volume Declaration (Patente)",
    "Declaración Anual de Volumen de Negocios (Patente)"
  ),
  agency: "Municipal finance office (OGP PA01 statewide form)",
  jurisdiction: "pr",
  version: "1.0.0",
  verificationStatus: "extracted_from_official_pdf",
  sourceDocument: "PA01-Declaracion-Volumen-Negocios-Rev-Feb-2025.pdf",
  resultingDocumentName: t(
    "Annual patente declaration, ready to sign and file at the municipality",
    "Declaración anual de patente, lista para firmar y radicar en el municipio"
  ),
  // The completed PA01 is filed at the municipality's collections office; there
  // is no statewide portal that accepts it, so SmartPR's job ends at producing
  // the populated, signable PDF.
  submissionMethod: "generated_preparation_pdf",
  officialEvidenceStillRequired: true,
  applicability: [],
  sections: [
    {
      id: "filing_period",
      title: t("Declaration period", "Período de la declaración"),
      description: t(
        "The patente is declared per contributive year. Confirm the year this declaration covers.",
        "La patente se declara por año contributivo. Confirme el año que cubre esta declaración."
      ),
      fields: [
        {
          id: "filing_year",
          label: t("Contributive year being declared", "Año contributivo declarado"),
          type: "text",
          required: true,
          helpText: t(
            "Printed in the 'Para el Año Natural' blank on the official form.",
            "Se imprime en el espacio 'Para el Año Natural' del formulario oficial."
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
          label: t("Contributive year begins — month", "El año contributivo comienza — mes"),
          type: "select",
          visibleWhen: [{ field: "uses_fiscal_year", operator: "truthy" }],
          requiredWhen: [{ field: "uses_fiscal_year", operator: "truthy" }],
          options: MONTH_OPTIONS(),
        },
        {
          id: "fiscal_year_from_year",
          label: t("Contributive year begins — year", "El año contributivo comienza — año"),
          type: "text",
          visibleWhen: [{ field: "uses_fiscal_year", operator: "truthy" }],
          requiredWhen: [{ field: "uses_fiscal_year", operator: "truthy" }],
          validation: [{ type: "regex", param: "^(19|20)\\d{2}$", message: t("Enter a four-digit year.", "Escriba un año de cuatro dígitos.") }],
        },
        {
          id: "fiscal_year_to_month",
          label: t("Contributive year ends — month", "El año contributivo termina — mes"),
          type: "select",
          visibleWhen: [{ field: "uses_fiscal_year", operator: "truthy" }],
          requiredWhen: [{ field: "uses_fiscal_year", operator: "truthy" }],
          options: MONTH_OPTIONS(),
        },
        {
          id: "fiscal_year_to_year",
          label: t("Contributive year ends — year", "El año contributivo termina — año"),
          type: "text",
          visibleWhen: [{ field: "uses_fiscal_year", operator: "truthy" }],
          requiredWhen: [{ field: "uses_fiscal_year", operator: "truthy" }],
          validation: [{ type: "regex", param: "^(19|20)\\d{2}$", message: t("Enter a four-digit year.", "Escriba un año de cuatro dígitos.") }],
        },
        {
          id: "fiscal_year_designation",
          label: t("Fiscal-year designation, as you write it (optional)", "Designación del año fiscal, como usted la escribe (opcional)"),
          type: "text",
          visibleWhen: [{ field: "uses_fiscal_year", operator: "truthy" }],
          helpText: t(
            "Printed in the 'Año Fiscal' box — write it the way it appears on your income tax return.",
            "Se imprime en la casilla 'Año Fiscal' — escríbalo como aparece en su planilla de contribución sobre ingresos."
          ),
        },
        {
          id: "amended_return",
          label: t("This is an amended declaration (Planilla Enmendada)", "Esta es una declaración enmendada (Planilla Enmendada)"),
          type: "checkbox",
          helpText: t(
            "Check only if you are correcting a declaration you already filed for this year.",
            "Márquela solo si está corrigiendo una declaración que ya radicó para este año."
          ),
        },
        {
          id: "final_return",
          label: t("This is a final declaration — the business closed (Planilla Final)", "Esta es una declaración final — el negocio cerró (Planilla Final)"),
          type: "checkbox",
          helpText: t(
            "Check only if the business ceased operations and this is its last declaration.",
            "Márquela solo si el negocio cesó operaciones y esta es su última declaración."
          ),
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
            { value: "oficio", label: t("Assessed ex officio (Oficio)", "De Oficio") },
            { value: "otros", label: t("Other (Otros)", "Otros") },
          ],
          helpText: t(
            "Choose Exenta only if the municipality granted this business a patente exemption — for example under an Act 60 decree. Oficio means the municipality assessed the patente on its own.",
            "Elija Exenta solo si el municipio le concedió una exención de patente a este negocio — por ejemplo bajo un decreto de la Ley 60. De Oficio significa que el municipio tasó la patente por su cuenta."
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
          id: "patente_type_other",
          label: t("Specify the other patente type", "Especifique el otro tipo de patente"),
          type: "text",
          visibleWhen: [{ field: "patente_type", operator: "eq", value: "otros" }],
          requiredWhen: [{ field: "patente_type", operator: "eq", value: "otros" }],
        },
        {
          id: "business_type_pr",
          label: t("Tipo de Negocio", "Tipo de Negocio"),
          type: "radio",
          required: true,
          options: [
            { value: "individual", label: t("Individual (Individuo)", "Individuo") },
            { value: "partnership", label: t("Partnership (Sociedad)", "Sociedad") },
            { value: "corporation", label: t("Corporation (Corporación)", "Corporación") },
            { value: "disregarded", label: t("Disregarded entity (Entidad Ignorada)", "Entidad Ignorada") },
          ],
          helpText: t(
            "Mark the box that matches how the business files. A disregarded entity (entidad ignorada) is typically owned by one person and files under that person's return.",
            "Marque la casilla que corresponda a cómo rinde el negocio. Una entidad ignorada por lo general tiene un solo dueño y rinde bajo la planilla de esa persona."
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
          id: "taxpayer_name",
          label: t(
            "Name of the person subject to the patente payment",
            "Nombre de la persona sujeta al pago de patente"
          ),
          type: "text",
          required: true,
          canonicalKey: "contact.fullName",
        },
        {
          id: "municipal_taxpayer_id",
          label: t("Municipal identification number", "Número de identificación municipal"),
          type: "text",
          canonicalKey: "operations.municipalTaxpayerId",
          helpText: t(
            "Assigned with your first patente — find it on last year's declaration or receipt.",
            "Se asigna con su primera patente — lo encuentra en la declaración o el recibo del año pasado."
          ),
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
          id: "contact_email",
          label: t("Contact person's email", "Correo electrónico de la persona contacto"),
          type: "text",
          required: true,
          canonicalKey: "contact.email",
        },
        {
          id: "employer_ein",
          label: t("Employer identification number (EIN)", "Número de identificación patronal"),
          type: "text",
          canonicalKey: "business.ein",
          helpText: t(
            "Printed on the form only for corporations and partnerships. If this business is an Individuo or Entidad Ignorada, leave it blank — you will hand-write your own social security number on the printed form instead.",
            "Se imprime en el formulario solo para corporaciones y sociedades. Si el negocio es Individuo o Entidad Ignorada, déjelo en blanco — usted escribirá a mano su propio número de seguro social en el formulario impreso."
          ),
        },
        {
          id: "establishment_date",
          label: t("Date the business was established", "Fecha de establecimiento del negocio"),
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
      id: "certification",
      title: t("Certification and signature", "Certificación y firma"),
      description: t(
        "SmartPR fills in the page-1 header. Everything that is a computation from your books stays blank for you or your CPA to complete by hand — and the certification is always signed by hand.",
        "SmartPR llena el encabezado de la página 1. Todo lo que sea un cómputo de sus libros queda en blanco para que usted o su CPA lo complete a mano — y la certificación siempre se firma a mano."
      ),
      fields: [
        {
          id: "computation_acknowledgement",
          label: t(
            "I understand the Encasillado 1 summary and the pages 2–4 computation schedules are my (or my CPA's) work from the business's books, and that SmartPR leaves them blank for completion by hand.",
            "Entiendo que el resumen del Encasillado 1 y las planillas de cómputo de las páginas 2 a 4 son trabajo mío (o de mi CPA) a base de los libros del negocio, y que SmartPR los deja en blanco para completarlos a mano."
          ),
          type: "attestation",
          required: true,
        },
        {
          id: "signature_acknowledgement",
          label: t(
            "I understand the CERTIFICACION on page 2 must be signed by hand, and that SmartPR leaves the signature line and its date blank.",
            "Entiendo que la CERTIFICACION de la página 2 debe firmarse a mano, y que SmartPR deja la línea de firma y su fecha en blanco."
          ),
          type: "attestation",
          required: true,
        },
        {
          id: "ssn_acknowledgement",
          label: t(
            "I understand that if this business is an Individuo or Entidad Ignorada, I must hand-write my own social security number on the printed form — SmartPR never stores or prints it.",
            "Entiendo que si el negocio es Individuo o Entidad Ignorada, debo escribir a mano mi propio número de seguro social en el formulario impreso — SmartPR nunca lo guarda ni lo imprime."
          ),
          type: "attestation",
          required: true,
        },
      ],
    },
  ],
  notices: [
    t(
      "SmartPR fills in the page-1 header of this declaration: the filing period, the patente and business-type boxes, and your business's identification and addresses from your SmartPR profile. The Encasillado 1 summary, the pages 2–4 computation schedules, and the CERTIFICACION signature are completed by hand — by you or your CPA, from the business's books.",
      "SmartPR llena el encabezado de la página 1 de esta declaración: el período, las casillas de tipo de patente y tipo de negocio, y la identificación y direcciones de su negocio desde su perfil de SmartPR. El resumen del Encasillado 1, las planillas de cómputo de las páginas 2 a 4 y la firma de la CERTIFICACION se completan a mano — por usted o su CPA, a base de los libros del negocio."
    ),
    t(
      "For a Corporación or Sociedad, SmartPR prints the business's employer identification number on the form. For an Individuo or Entidad Ignorada, the identifier blank stays empty: hand-write your own social security number on the printed form. SmartPR never stores or prints a person's government identifier.",
      "Para una Corporación o Sociedad, SmartPR imprime el número de identificación patronal del negocio en el formulario. Para un Individuo o Entidad Ignorada, el espacio del identificador queda vacío: escriba a mano su propio número de seguro social en el formulario impreso. SmartPR nunca guarda ni imprime el identificador personal de nadie."
    ),
    t(
      "Patente rates, due dates and any exemption are set by each municipality's own ordinance. Confirm the amount owed with your municipality's finance office before paying.",
      "Las tasas de patente, las fechas de vencimiento y cualquier exención las fija la ordenanza de cada municipio. Confirme la cantidad adeudada con la oficina de finanzas de su municipio antes de pagar."
    ),
  ],
  feeMetadata: {
    source: t(
      "Patente rates are set per municipality by ordinance under the Municipal Code; no fee is printed on the PA01 form itself.",
      "Las tasas de patente las fija cada municipio por ordenanza bajo el Código Municipal; el formulario PA01 no imprime una tarifa."
    ),
    requiresPortalVerification: true,
  },
};
