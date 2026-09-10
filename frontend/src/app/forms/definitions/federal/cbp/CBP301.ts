// ============================================================================
// CBP301 — CBP Form 301, "CUSTOMS BOND" (U.S. Customs and Border Protection,
// Department of Homeland Security), form face "CBP Form 301 (04/24)",
// 19 CFR Part 113.
//
// The bond an importer (or other regulated party) posts so CBP is secured for
// duties, taxes, charges and compliance with the listed activity conditions.
// Five pages, 114 fillable AcroForm widgets — populated by the AcroForm branch
// (see form-mappings/CBP301.json), NOT by coordinate overlay.
//
// FIELD IDS ARE A CONTRACT. `artifacts/formDataPopulation.ts::cbp301Values()`
// writes this form's answers into the official PDF by these exact ids —
// execution_date, bond_type, transaction_id, transaction_date, port_code,
// effective_date, activity_code, limit_of_liability, principal_name,
// principal_address, importer_cbp_id, broker_filer_code,
// surety_reference_number, surety_name, surety_address, surety_number.
// Renaming one here silently stops it reaching the PDF.
//
// The principal's name and address are `smartpr_derived` in the mapping: the
// canonical pass prints the business legal name, and cbp301Values() overwrites
// it with name + physical address composed from these very fields (prefilled
// from the profile, correctable on the form). They still appear here (with
// canonicalKey) so the filer can see and correct what will be printed.
//
// Key-field scope only: page-1 bond terms (Section I), one Section II activity
// + its limit of liability, principal identity, and the surety identity basics.
// Page 2 (co-principal, co-surety, Section III trade names), the seal-
// declaration checkboxes, and the surety-requested mailing address are left
// for the filer/broker/surety to complete by hand — see the mapping notes.
//
// Two things are never written by SmartPR and never collected here:
//   * Both signature lines (ownership: "signature") — principal and surety
//     sign by hand.
//   * BOND NUMBER (Assigned by CBP) (ownership: "government_only") — CBP's.
//
// Honest scope, stated in the notices and the catalog: in practice continuous
// bonds are filed electronically through CBP's eBond process in ACE, arranged
// by the importer's customs broker and surety — the paper Form 301 is the
// legacy path. And CBP's own page notes the OMB approval (No. 1651-0050,
// expired 08/31/2025) is expired but the form remains valid while under OMB
// review.
// ============================================================================

import type { DigitalFormDefinition, FormOption } from "../../../engine/types.ts";
import { t } from "../../pr/department-of-state/shared.ts";

/** Section II activity codes, in the order printed on the form. */
function ACTIVITY_OPTIONS(): FormOption[] {
  const codes: Array<[string, string, string]> = [
    ["1", "Importer or broker — §113.62", "Importador o corredor — §113.62"],
    ["1a", "Drawback payments refunds — §113.65", "Reembolsos de drawback — §113.65"],
    ["2", "Custodian of bonded merchandise — §113.63", "Custodio de mercancía bajo fianza — §113.63"],
    ["3", "International carrier — §113.64", "Transportista internacional — §113.64"],
    ["3a", "Instruments of international traffic — §113.66", "Instrumentos de tráfico internacional — §113.66"],
    ["4", "Foreign trade zone operator — §113.73", "Operador de zona de comercio exterior — §113.73"],
    ["5", "Public gauger — §113.67", "Medidor público — §113.67"],
    ["6", "Wool & fur products labeling — §113.68", "Etiquetado de productos de lana y piel — §113.68"],
    ["7", "Bill of lading — §113.69", "Conocimiento de embarque — §113.69"],
    ["8", "Detention of copyrighted material — §113.70", "Detención de material con derechos de autor — §113.70"],
    ["9", "Neutrality — §113.71", "Neutralidad — §113.71"],
    ["10", "Court costs for condemned goods — §113.72", "Costas judiciales por mercancía decomisada — §113.72"],
    ["11", "Airport security bond — Part 113 App. A", "Fianza de seguridad aeroportuaria — Parte 113 Ap. A"],
    ["12", "ITC exclusion bond — Part 113 App. B", "Fianza de exclusión de la ITC — Parte 113 Ap. B"],
    ["15", "Intellectual property rights importation (IPR)", "Importación de derechos de propiedad intelectual (IPR)"],
    ["16", "Importer security filing (ISF) — Part 113 App. D", "Declaración de seguridad del importador (ISF) — Parte 113 Ap. D"],
    ["17", "Marine terminal operator", "Operador de terminal marítimo"],
  ];
  return codes.map(([value, en, es]) => ({ value, label: t(en, es) }));
}

export const CBP301: DigitalFormDefinition = {
  id: "FORM_CBP_301",
  officialFormNumber: "CBP301",
  requirementId: "DOC_CUSTOMS_BROKER_BOND",
  variantKey: "customs_bond",
  title: t(
    "Customs Bond (CBP Form 301)",
    "Fianza de Aduana (Formulario 301 de CBP)"
  ),
  agency: "U.S. Customs and Border Protection (CBP), Department of Homeland Security",
  jurisdiction: "federal",
  version: "1.0.0",
  verificationStatus: "extracted_from_official_pdf",
  sourceDocument: "CBP-Form-301.pdf",
  resultingDocumentName: t(
    "Populated CBP Form 301 customs bond — preparation copy for your broker/surety",
    "Formulario 301 de CBP lleno — copia de preparación para tu corredor/fiador"
  ),
  // SmartPR produces the populated official PDF; the bond itself is arranged
  // through the customs broker and surety (usually electronically via eBond),
  // so SmartPR's job ends at the signable preparation copy.
  submissionMethod: "generated_preparation_pdf",
  officialEvidenceStillRequired: true,
  // The rules engine decides which businesses owe a customs bond (import/export,
  // freight forwarding, logistics, wholesale distribution); this variant
  // carries no narrowing applicability conditions of its own.
  applicability: [],
  sections: [
    {
      id: "bond_terms",
      title: t("Bond terms", "Términos de la fianza"),
      description: t(
        "Section I of the form: one bond covers either a single transaction or a continuous year — never both.",
        "Sección I del formulario: una fianza cubre una sola transacción o un año continuo — nunca ambas."
      ),
      fields: [
        {
          id: "bond_type",
          label: t("Bond type", "Tipo de fianza"),
          type: "radio",
          required: true,
          options: [
            { value: "single", label: t("Single transaction bond", "Fianza de transacción única") },
            { value: "continuous", label: t("Continuous bond", "Fianza continua") },
          ],
          helpText: t(
            "A continuous bond stays in force for one year from its effective date and renews annually — that is what an importer with ongoing shipments uses.",
            "La fianza continua tiene vigencia de un año desde su fecha de efectividad y se renueva cada año — es la que usa un importador con embarques recurrentes."
          ),
        },
        {
          id: "transaction_id",
          label: t("Transaction identification", "Identificación de la transacción"),
          type: "text",
          visibleWhen: [{ field: "bond_type", operator: "eq", value: "single" }],
          requiredWhen: [{ field: "bond_type", operator: "eq", value: "single" }],
          helpText: t(
            "The transaction this bond secures — e.g. an entry number or seizure number.",
            "La transacción que asegura esta fianza — por ejemplo un número de entrada o de incautación."
          ),
        },
        {
          id: "transaction_date",
          label: t("Transaction date", "Fecha de la transacción"),
          type: "date",
          visibleWhen: [{ field: "bond_type", operator: "eq", value: "single" }],
          requiredWhen: [{ field: "bond_type", operator: "eq", value: "single" }],
        },
        {
          id: "port_code",
          label: t("Port code", "Código del puerto"),
          type: "text",
          visibleWhen: [{ field: "bond_type", operator: "eq", value: "single" }],
          requiredWhen: [{ field: "bond_type", operator: "eq", value: "single" }],
          helpText: t(
            "The CBP port code for the transaction — your customs broker has it.",
            "El código del puerto de CBP para la transacción — tu corredor de aduana lo tiene."
          ),
        },
        {
          id: "effective_date",
          label: t("Effective date", "Fecha de efectividad"),
          type: "date",
          visibleWhen: [{ field: "bond_type", operator: "eq", value: "continuous" }],
          requiredWhen: [{ field: "bond_type", operator: "eq", value: "continuous" }],
          helpText: t(
            "The bond stays in force for one year beginning with this date, for each succeeding annual period, until terminated per CBP regulations.",
            "La fianza tiene vigencia de un año a partir de esta fecha, por cada período anual siguiente, hasta que se termine según el reglamento de CBP."
          ),
        },
        {
          id: "execution_date",
          label: t("Execution date", "Fecha de otorgamiento"),
          type: "date",
          required: true,
          helpText: t(
            "Printed at the top of page 1. Defaults to today.",
            "Se imprime arriba en la página 1. Por defecto es hoy."
          ),
        },
      ],
    },
    {
      id: "activity",
      title: t("Covered activity", "Actividad cubierta"),
      description: t(
        "Section II of the form: check one box only — the activity whose conditions this bond secures.",
        "Sección II del formulario: marca una sola casilla — la actividad cuyas condiciones asegura esta fianza."
      ),
      fields: [
        {
          id: "activity_code",
          label: t("Activity code", "Código de actividad"),
          type: "select",
          required: true,
          options: ACTIVITY_OPTIONS(),
          helpText: t(
            "Most importers use code 1 (Importer or broker). Your customs broker or surety confirms the right one.",
            "La mayoría de los importadores usan el código 1 (Importador o corredor). Tu corredor de aduana o tu fiador confirma cuál es el correcto."
          ),
        },
        {
          id: "limit_of_liability",
          label: t("Limit of liability (bond amount, USD)", "Límite de responsabilidad (monto de la fianza, USD)"),
          type: "currency",
          required: true,
          validation: [{ type: "number_min", param: 0 }],
          helpText: t(
            "The amount the principal and surety bind themselves to the United States for this activity — set with your surety.",
            "La cantidad por la que el principal y el fiador se obligan con los Estados Unidos por esta actividad — se fija con tu fiador."
          ),
        },
      ],
    },
    {
      id: "importer",
      title: t("Importer (principal)", "Importador (principal)"),
      description: t(
        "Prefilled from your SmartPR profile. Correct anything that is wrong — corrections are saved back to your profile and used on every other form.",
        "Precargado desde su perfil de SmartPR. Corrija lo que esté incorrecto — las correcciones se guardan en su perfil y se usan en los demás formularios."
      ),
      fields: [
        {
          id: "principal_name",
          label: t("Principal name", "Nombre del principal"),
          type: "text",
          required: true,
          canonicalKey: "business.legalName",
          helpText: t(
            "The importer of record — the business posting the bond.",
            "El importador registrado — el negocio que otorga la fianza."
          ),
        },
        {
          id: "principal_address",
          label: t("Principal physical address", "Dirección física del principal"),
          type: "address",
          required: true,
          canonicalKey: "addresses.operatingAddress",
          helpText: t(
            "Printed together with the name, including state of incorporation where it applies.",
            "Se imprime junto al nombre, incluyendo el estado de incorporación donde aplique."
          ),
        },
        {
          id: "importer_cbp_id",
          label: t("CBP identification number", "Número de identificación de CBP"),
          type: "text",
          required: true,
          canonicalKey: "business.ein",
          helpText: t(
            "The importer-of-record number — for a company, its EIN. An individual importer writes their own number on the printed form by hand; SmartPR never stores a person's social security number.",
            "El número de importador registrado — para una compañía, su EIN. Un importador individual escribe su propio número a mano en el formulario impreso; SmartPR nunca guarda el seguro social de una persona."
          ),
        },
        {
          id: "broker_filer_code",
          label: t("Broker filer code (optional)", "Código del corredor (opcional)"),
          type: "text",
          helpText: t(
            "Your customs broker's filer code, if you are filing through a broker.",
            "El código de tu corredor de aduana, si radicas a través de un corredor."
          ),
        },
        {
          id: "surety_reference_number",
          label: t("Surety reference number (optional)", "Número de referencia del fiador (opcional)"),
          type: "text",
          helpText: t(
            "The surety's own reference number for this bond, if they gave you one.",
            "El número de referencia del fiador para esta fianza, si te dieron uno."
          ),
        },
      ],
    },
    {
      id: "surety",
      title: t("Surety", "Fiador"),
      description: t(
        "The surety company guaranteeing the bond. Your broker or surety completes what you leave blank — this section is theirs.",
        "La compañía fiadora que garantiza la fianza. Tu corredor o tu fiador completa lo que dejes en blanco — esta sección es de ellos."
      ),
      fields: [
        {
          id: "surety_name",
          label: t("Surety name", "Nombre del fiador"),
          type: "text",
          helpText: t(
            "The surety company, exactly as it will sign.",
            "La compañía fiadora, exactamente como va a firmar."
          ),
        },
        {
          id: "surety_address",
          label: t("Surety physical address", "Dirección física del fiador"),
          type: "address",
        },
        {
          id: "surety_number",
          label: t("Surety number", "Número del fiador"),
          type: "text",
          helpText: t(
            "The surety's CBP-assigned surety number — your surety provides it.",
            "El número de fiador asignado por CBP — tu fiador te lo provee."
          ),
        },
      ],
    },
    {
      id: "signing",
      title: t("Signatures", "Firmas"),
      description: t(
        "SmartPR never signs for anyone — both signature lines and both seal checkboxes stay blank for hand completion.",
        "SmartPR nunca firma por nadie — ambas líneas de firma y ambas casillas de sello se quedan en blanco para completarse a mano."
      ),
      fields: [
        {
          id: "bond_acknowledgement",
          label: t(
            "I understand both signature lines ('Signature' under PRINCIPAL and under SURETY) and both 'affix seal' checkboxes must be completed by hand by the principal and the surety, the surety's section (surety number, agent ID) is completed by my surety or customs broker, and SmartPR leaves all of them blank.",
            "Entiendo que ambas líneas de firma ('Signature' bajo PRINCIPAL y bajo SURETY) y ambas casillas de 'affix seal' deben completarse a mano por el principal y el fiador, que la sección del fiador (número de fiador, ID del agente) la completa mi fiador o mi corredor de aduana, y que SmartPR deja todo eso en blanco."
          ),
          type: "attestation",
          required: true,
        },
      ],
    },
  ],
  notices: [
    t(
      "SmartPR leaves both signature lines ('Signature' under PRINCIPAL and under SURETY) and both 'affix seal' checkboxes blank on purpose — the principal and the surety sign and seal by hand on the printed form.",
      "SmartPR deja a propósito en blanco ambas líneas de firma ('Signature' bajo PRINCIPAL y bajo SURETY) y ambas casillas de 'affix seal' — el principal y el fiador firman y sellan a mano en el formulario impreso."
    ),
    t(
      "In practice, continuous customs bonds are filed electronically through CBP's eBond process in ACE, arranged by your customs broker and surety — the paper Form 301 is the legacy path. Confirm with your broker or surety which path they use before filing paper.",
      "En la práctica, las fianzas de aduana continuas se radican electrónicamente por el proceso eBond de CBP en ACE, gestionado por tu corredor de aduana y tu fiador — el Formulario 301 en papel es la vía vieja. Confirma con tu corredor o tu fiador cuál vía usan antes de radicar en papel."
    ),
    t(
      "CBP's own page notes the OMB approval (No. 1651-0050, expired 08/31/2025) is expired, but the form remains valid for use while it is under OMB review for a new date.",
      "La propia página de CBP indica que la aprobación de OMB (Núm. 1651-0050, vencida el 31/08/2025) está vencida, pero el formulario sigue siendo válido mientras OMB lo revisa para una nueva fecha."
    ),
  ],
  feeMetadata: {
    source: t(
      "No fee is printed on the form — the bond premium is set by your surety, not by CBP.",
      "El formulario no tiene tarifa impresa — la prima de la fianza la fija tu fiador, no CBP."
    ),
    requiresPortalVerification: false,
  },
};
