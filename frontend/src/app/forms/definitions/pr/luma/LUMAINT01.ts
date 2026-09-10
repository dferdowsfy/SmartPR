// ============================================================================
// LUMAINT01 — Confirmación de Orientación al Cliente sobre el proceso de
// interconexión de Generación Distribuida (GD), Rev. 10-2021.
//
// LUMA Energy Servco, LLC, acting as agent of the Puerto Rico Electric Power
// Authority. One page, no native AcroForm fields — populated by coordinate
// overlay (see LUMAINT01_OVERLAY in artifacts/overlayMaps.ts).
//
// What this document is: the customer attests that a certified installer (or
// company representative) oriented them on LUMA's GD interconnection process
// and the net-metering programs, and marks which regulation applies. It is one
// piece of the interconnection registration package the installer submits to
// LUMA — it is not the interconnection agreement itself (that is executed
// separately with LUMA after the registration is validated).
//
// FIELD IDS ARE A CONTRACT. `artifacts/formDataPopulation.ts::lumaInt01Values()`
// writes this form's answers into the official PDF by these exact ids —
// customer_name, account_number, installer_name, installer_company,
// regulation_distribution_mark, regulation_transmission_mark, project_name,
// project_number, capacity_kw, project_address, project_address_line2,
// customer_address, signature_date. Renaming one here silently stops it
// reaching the PDF.
//
// The customer's name, project address and signer address are
// `smartpr_derived` in the overlay map: populated from the shared canonical
// profile rather than re-asked. They still appear here (with canonicalKey) so
// the filer can see and correct what will be printed.
//
// One thing is never written by SmartPR and never collected here:
//   * The "Firma del Cliente" signature line (ownership: "signature")
// ============================================================================

import type { DigitalFormDefinition, LocalizedText } from "../../../engine/types.ts";

function t(en: string, es: string): LocalizedText {
  return { en, es };
}

export const LUMAINT01: DigitalFormDefinition = {
  id: "FORM_PR_LUMA_INTERCONNECTION",
  officialFormNumber: "LUMAINT01",
  requirementId: "DOC_LUMA_INTERCONNECTION",
  variantKey: "interconnection",
  title: t(
    "Customer Orientation Confirmation — Distributed Generation Interconnection",
    "Confirmación de Orientación al Cliente — Interconexión de Generación Distribuida"
  ),
  agency: "LUMA Energy Servco, LLC (agent of the Puerto Rico Electric Power Authority)",
  jurisdiction: "pr",
  version: "1.0.0",
  verificationStatus: "extracted_from_official_pdf",
  sourceDocument: "LUMA-Confirmacion-Orientacion-Cliente-Rev10-2021.pdf",
  resultingDocumentName: t(
    "Signed customer orientation confirmation for the LUMA interconnection registration package",
    "Confirmación de orientación al cliente firmada para el paquete de registro de interconexión de LUMA"
  ),
  submissionMethod: "generated_preparation_pdf",
  officialEvidenceStillRequired: true,
  applicability: [],
  sections: [
    {
      id: "customer",
      title: t("Customer", "Cliente"),
      description: t(
        "You, the LUMA account holder where the solar system will be installed.",
        "Usted, el titular de la cuenta de LUMA donde se instalará el sistema solar."
      ),
      fields: [
        {
          id: "customer_name",
          label: t("Customer full name", "Nombre y apellidos del cliente"),
          type: "text",
          required: true,
          canonicalKey: "contact.fullName",
          helpText: t(
            "Printed on the 'Yo, ___' line. Prefilled from your SmartPR profile.",
            "Se imprime en la línea 'Yo, ___'. Precargado desde su perfil de SmartPR."
          ),
        },
        {
          id: "account_number",
          label: t("LUMA account number", "Número de cuenta de LUMA"),
          type: "text",
          required: true,
          helpText: t(
            "The electric service account at the installation address — find it on your LUMA bill.",
            "La cuenta del servicio eléctrico en la dirección de instalación — la encuentra en su factura de LUMA."
          ),
        },
      ],
    },
    {
      id: "installer",
      title: t("Installer", "Instalador"),
      description: t(
        "The certified installer — or company representative — who oriented you on the interconnection process.",
        "El instalador certificado — o representante de la compañía — que le orientó sobre el proceso de interconexión."
      ),
      fields: [
        {
          id: "installer_name",
          label: t("Installer name", "Nombre y apellidos del instalador"),
          type: "text",
          required: true,
        },
        {
          id: "installer_company",
          label: t("Installer company (if applicable)", "Compañía del instalador (si aplica)"),
          type: "text",
          helpText: t(
            "Complete only if you were oriented by a company representative rather than the installer directly.",
            "Complete solo si le orientó un representante de la compañía en lugar del instalador directamente."
          ),
        },
      ],
    },
    {
      id: "regulation",
      title: t("Applicable regulation", "Reglamento aplicable"),
      description: t(
        "The form asks you to mark which interconnection regulation applies to your project. Your installer will know.",
        "El formulario le pide marcar qué reglamento de interconexión aplica a su proyecto. Su instalador lo sabrá."
      ),
      fields: [
        {
          id: "regulation",
          label: t("Which regulation covers this project?", "¿Qué reglamento cubre este proyecto?"),
          type: "radio",
          required: true,
          options: [
            {
              value: "distribution",
              label: t(
                "Distribution system interconnection regulation",
                "Reglamento de interconexión con el sistema de distribución"
              ),
            },
            {
              value: "transmission",
              label: t(
                "Transmission / subtransmission system interconnection regulation",
                "Reglamento de interconexión con el sistema de transmisión o subtransmisión"
              ),
            },
          ],
          helpText: t(
            "Almost all commercial rooftop projects fall under the distribution regulation.",
            "Casi todos los proyectos comerciales en techos caen bajo el reglamento de distribución."
          ),
        },
      ],
    },
    {
      id: "project",
      title: t("Project", "Proyecto"),
      description: t(
        "The distributed-generation system described in the confirmation.",
        "El sistema de generación distribuida descrito en la confirmación."
      ),
      fields: [
        {
          id: "project_name",
          label: t("Project or owner name", "Nombre del proyecto o del dueño"),
          type: "text",
          required: true,
        },
        {
          id: "project_number",
          label: t("LUMA project number (if already assigned)", "Número de proyecto de LUMA (si ya fue asignado)"),
          type: "text",
        },
        {
          id: "capacity_kw",
          label: t("System capacity (kW)", "Capacidad del sistema (kW)"),
          type: "text",
          required: true,
          helpText: t(
            "AC capacity of the solar system, in kilowatts — your installer provides this from the system design.",
            "Capacidad en corriente alterna del sistema solar, en kilovatios — su instalador la provee según el diseño del sistema."
          ),
        },
        {
          id: "project_address",
          label: t("Physical address of the project", "Dirección física del proyecto"),
          type: "address",
          required: true,
          canonicalKey: "addresses.operatingAddress",
          helpText: t(
            "Where the system will be installed. Prefilled from your SmartPR profile.",
            "Donde se instalará el sistema. Precargado desde su perfil de SmartPR."
          ),
        },
        {
          id: "project_address_line2",
          label: t("Address continuation (optional)", "Continuación de la dirección (opcional)"),
          type: "text",
        },
      ],
    },
    {
      id: "signing",
      title: t("Signature block", "Bloque de firma"),
      description: t(
        "SmartPR pre-fills the address and date, but the signature itself is always yours — sign by hand on the printed form.",
        "SmartPR precarga la dirección y la fecha, pero la firma siempre es la suya — fírmela a mano en el formulario impreso."
      ),
      fields: [
        {
          id: "customer_address",
          label: t("Signer address", "Dirección del firmante"),
          type: "address",
          required: true,
          canonicalKey: "addresses.operatingAddress",
        },
        {
          id: "signature_date",
          label: t("Date of signing", "Fecha de la firma"),
          type: "date",
          required: true,
          helpText: t(
            "Defaults to today. Printed on the 'Fecha' line under the signature.",
            "Por defecto es hoy. Se imprime en la línea 'Fecha' debajo de la firma."
          ),
        },
        {
          id: "signature_acknowledgement",
          label: t(
            "I understand the 'Firma del Cliente' line must be signed by hand and that SmartPR leaves it blank.",
            "Entiendo que la línea 'Firma del Cliente' debe firmarse a mano y que SmartPR la deja en blanco."
          ),
          type: "attestation",
          required: true,
        },
      ],
    },
  ],
  notices: [
    t(
      "SmartPR leaves the 'Firma del Cliente' signature line blank on purpose — sign it by hand on the printed form before it goes into the registration package.",
      "SmartPR deja la línea de 'Firma del Cliente' en blanco a propósito — fírmela a mano en el formulario impreso antes de incluirlo en el paquete de registro."
    ),
    t(
      "This confirmation is one document inside the interconnection registration package your installer submits to LUMA (with the certified electrical installation and its annexes). The interconnection and net-metering agreement itself is signed separately with LUMA after the registration is validated.",
      "Esta confirmación es un documento dentro del paquete de registro de interconexión que su instalador somete a LUMA (con la certificación de la instalación eléctrica y sus anejos). El acuerdo de interconexión y medición neta como tal se firma por separado con LUMA después de validado el registro."
    ),
  ],
  feeMetadata: {
    source: t(
      "No fee is printed on this attestation itself.",
      "Esta confirmación como tal no tiene tarifa impresa."
    ),
    requiresPortalVerification: false,
  },
};
