// ============================================================================
// AGRICORP01 — SOLICITUD AGRICULTOR BONA FIDE (CORPORACIONES, SOCIEDADES
// ESPECIALES O SUCESIONES), Modelo DA-OCAB-05 (Corporaciones), Rev. ABRIL
// 2021, Departamento de Agricultura, Gobierno de Puerto Rico. Certificación
// de agricultor bona fide bajo la Ley Núm. 60 de 1 de julio de 2019,
// variante para entidades jurídicas.
//
// 7 pages, no AcroForm fields — populated by coordinate overlay
// (AGRICORP01_OVERLAY in artifacts/overlayMaps.ts, populationMethod
// "pdf_overlay").
//
// FIELD IDS ARE A CONTRACT. `artifacts/formDataPopulation.ts::`
// agriBonafideCorpValues() writes this form's applicant-owned answers into
// the official PDF by these exact ids — caso_tipo, anio_solicitado,
// employer_ssn, foundation_date, cell, fax, the member_N_name/ssn fields, the
// tipo_empresa/empleo_*/inversion_presente_anio fields, the finca_a_*/b_*/c_*
// fields, the pesca_* fields, the elab_* fields, ingresos_no_agricolas and
// signature_date (split into firma_fecha_dia/mes/anio). Renaming one here
// silently stops it reaching the PDF.
//
// The entity's legal name, postal address, phone and email are
// `smartpr_derived` in form-mappings/AGRICORP01.json: populated from the
// shared canonical profile rather than re-asked (the schema still shows them
// with canonicalKey so the filer can see and correct what will be printed).
// The entity-kind boxes (Corporación / Sociedad Especial / Sucesión /
// Sociedad de Responsabilidad Limitada) are marked from the profile's
// business.entity_type via writeWhen rows — Sucesión has no canonical
// mapping and is marked by hand on the printed form when it applies.
//
// Sensitive identifiers: the employer identifier (2. Seguro Social Patronal)
// and the member SSNs in the section-6 table ARE written to the PDF, passed
// as sensitive: true — the values print on the document but population
// metadata records only [provided]. This differs from the individuo variant
// (AGRIIND01), whose SSN boxes stay blank and are hand-written.
//
// Never written by SmartPR and never collected here:
//   * "Para Uso Interno" header: OFICINA REGIONAL, MUNICIPIO, Núm. Solicitud.
//   * "Firma del Agricultor o Representante Autorizado" (page 5) — hand-signed.
//   * Section 14 (agronomist: income computation, RECOMENDACIÓN,
//     Cumple/No Cumple, signature — page 6) — agency staff.
//   * Section 15 (regional director: observations, date, signature — page 7).
// ============================================================================

import type { DigitalFormDefinition, FormField } from "../../../engine/types.ts";
import { t } from "../department-of-state/shared.ts";

const YEAR_VALIDATION = [
  {
    type: "regex" as const,
    param: "^(19|20)\\d{2}$",
    message: t("Enter a four-digit year.", "Escriba un año de cuatro dígitos."),
  },
];

const NUEVO = [{ field: "tipo_empresa", operator: "eq" as const, value: "negocio_nuevo" }];
const EXISTENTE = [{ field: "tipo_empresa", operator: "eq" as const, value: "negocio_existente" }];

/** Finca location + tenure + negocios-agrícolas table fields shared by 10(a), 10(b) and 10(c). */
function fincaFields(
  prefix: "finca_a" | "finca_b" | "finca_c",
  opts: { required: boolean; gate?: string }
): FormField[] {
  const req = opts.required;
  const gate: FormField["visibleWhen"] = opts.gate
    ? [{ field: opts.gate, operator: "truthy" as const }]
    : undefined;
  const reqGate = { requiredWhen: gate };
  return [
    {
      id: `${prefix}_carr`,
      label: t("Highway (Carr.)", "Carretera (Carr.)"),
      type: "text",
      visibleWhen: gate,
    },
    {
      id: `${prefix}_km`,
      label: t("Kilometer (Km.)", "Kilómetro (Km.)"),
      type: "text",
      visibleWhen: gate,
    },
    {
      id: `${prefix}_hm`,
      label: t("Hectometer (Hm.)", "Hectómetro (Hm.)"),
      type: "text",
      visibleWhen: gate,
    },
    {
      id: `${prefix}_bo`,
      label: t("Ward (Bo.)", "Barrio (Bo.)"),
      type: "text",
      visibleWhen: gate,
      ...(req ? { required: true } : reqGate),
    },
    {
      id: `${prefix}_sector`,
      label: t("Sector", "Sector"),
      type: "text",
      visibleWhen: gate,
    },
    {
      id: `${prefix}_municipio`,
      label: t("Municipality", "Municipio"),
      type: "text",
      visibleWhen: gate,
      ...(req ? { required: true } : reqGate),
    },
    {
      id: `${prefix}_catastro`,
      label: t("Cadastral number (if available)", "Número de catastro (si lo tiene)"),
      type: "text",
      visibleWhen: gate,
      helpText: t(
        "The form says 'de estar disponible' — leave it blank if you do not have it.",
        "El formulario dice 'de estar disponible' — déjelo en blanco si no lo tiene."
      ),
    },
    {
      id: `${prefix}_cuerdas`,
      label: t("Total cuerdas", "Cantidad de cuerdas"),
      type: "number",
      visibleWhen: gate,
      ...(req ? { required: true } : reqGate),
      validation: [{ type: "number_min", param: 0 }],
    },
    {
      id: `${prefix}_propias`,
      label: t("Owned cuerdas", "Cuerdas propias"),
      type: "number",
      visibleWhen: gate,
      validation: [{ type: "number_min", param: 0 }],
    },
    {
      id: `${prefix}_fecha_adquisicion`,
      label: t("Acquisition date", "Fecha en que se adquirió"),
      type: "date",
      visibleWhen: gate,
    },
    {
      id: `${prefix}_usufructos`,
      label: t("Usufruct cuerdas", "Cuerdas en usufructo"),
      type: "number",
      visibleWhen: gate,
      validation: [{ type: "number_min", param: 0 }],
    },
    {
      id: `${prefix}_fecha_otorgacion`,
      label: t("Usufruct grant date", "Fecha de otorgación del usufructo"),
      type: "date",
      visibleWhen: gate,
    },
    {
      id: `${prefix}_arrendadas`,
      label: t("Leased cuerdas", "Cuerdas arrendadas"),
      type: "number",
      visibleWhen: gate,
      validation: [{ type: "number_min", param: 0 }],
    },
    {
      id: `${prefix}_fecha_vencimiento`,
      label: t("Lease expiration date", "Fecha de vencimiento del arrendamiento"),
      type: "date",
      visibleWhen: gate,
    },
    ...([1, 2, 3] as const).flatMap((row) => [
      {
        id: `${prefix}_r${row}_negocio`,
        label: t(`Farm ${prefix.slice(-1).toUpperCase()} business row ${row} — agricultural business`, `Finca ${prefix.slice(-1).toUpperCase()} negocio renglón ${row} — negocio agrícola`),
        type: "text" as const,
        visibleWhen: gate,
      },
      {
        id: `${prefix}_r${row}_cuerdas`,
        label: t(`Row ${row} — cuerdas`, `Renglón ${row} — cantidad de cuerdas`),
        type: "text" as const,
        visibleWhen: gate,
      },
      {
        id: `${prefix}_r${row}_produccion`,
        label: t(`Row ${row} — estimated annual production`, `Renglón ${row} — producción anual estimada`),
        type: "text" as const,
        visibleWhen: gate,
      },
      {
        id: `${prefix}_r${row}_desarrollo`,
        label: t(`Row ${row} — development level on the farm`, `Renglón ${row} — nivel de desarrollo en la finca`),
        type: "text" as const,
        visibleWhen: gate,
      },
    ]),
  ];
}

/** Six member rows for the section-6 table (name + SSN each). */
const MEMBER_FIELDS: FormField[] = ([1, 2, 3, 4, 5, 6] as const).flatMap((n) => [
  {
    id: `member_${n}_name`,
    label:
      n === 1
        ? t("Member 1 full name (authorized representative)", "Nombre y apellidos del socio/miembro 1 (representante autorizado)")
        : t(`Member ${n} full name`, `Nombre y apellidos del socio/miembro ${n}`),
    type: "text" as const,
    required: n === 1,
    helpText:
      n === 1
        ? t(
            "The form asks you to identify the person authorized to represent the entity — enter them as member 1.",
            "El formulario pide identificar a la persona autorizada a representar la entidad — escríbala como el miembro 1."
          )
        : undefined,
  },
  {
    id: `member_${n}_ssn`,
    label: t(`Member ${n} social security number`, `Seguro social del socio/miembro ${n}`),
    type: "text" as const,
    sensitive: true,
    transient: true,
    requiredWhen: [{ field: `member_${n}_name`, operator: "truthy" as const }],
    helpText: t(
      "Printed on the document. SmartPR stores only a marker that it was provided, never the number.",
      "Se imprime en el documento. SmartPR solo guarda una marca de que fue provisto, nunca el número."
    ),
  },
]);

export const AGRICORP01: DigitalFormDefinition = {
  id: "FORM_PR_AGRI_BONAFIDE_CORPORACION",
  officialFormNumber: "DA-OCAB-05 (Corporaciones)",
  requirementId: "DOC_AGRICULTURE_REGISTRATION",
  variantKey: "bona_fide_corporacion",
  title: t(
    "Agricultor Bona Fide Application (Corporations, Special Partnerships or Successions)",
    "Solicitud Agricultor Bona Fide (Corporaciones, Sociedades Especiales o Sucesiones)"
  ),
  agency: "Departamento de Agricultura (Gobierno de Puerto Rico)",
  jurisdiction: "pr",
  version: "Rev. ABRIL 2021",
  verificationStatus: "extracted_from_official_pdf",
  sourceDocument: "RealForms/AGRI-Bonafide-Corporacion-2021.pdf",
  resultingDocumentName: t(
    "Bona fide farmer application (corporation) — DA-OCAB-05",
    "Solicitud de agricultor bona fide (corporación) — DA-OCAB-05"
  ),
  submissionMethod: "generated_preparation_pdf",
  officialEvidenceStillRequired: true,
  applicability: [],
  sections: [
    {
      id: "solicitud",
      title: t("Application type", "Tipo de solicitud"),
      fields: [
        {
          id: "anio_solicitado",
          label: t("Requested year (AÑO SOLICITADO)", "Año solicitado"),
          type: "text",
          required: true,
          validation: YEAR_VALIDATION,
          placeholder: t("2026", "2026"),
        },
        {
          id: "caso_tipo",
          label: t("Is this a new case or a renewal?", "¿Es un caso nuevo o una renovación?"),
          type: "radio",
          required: true,
          options: [
            { value: "caso_nuevo", label: t("New case (Caso Nuevo)", "Caso nuevo") },
            { value: "renovacion", label: t("Renewal (Renovación)", "Renovación") },
          ],
        },
      ],
    },
    {
      id: "entidad",
      title: t("The entity", "La entidad"),
      fields: [
        {
          id: "entity_legal_name",
          canonicalKey: "business.legal_name",
          label: t("Entity legal name", "Nombre legal de la entidad"),
          type: "text",
          required: true,
        },
        {
          id: "employer_ssn",
          label: t("Employer social security number (Seguro Social Patronal)", "Seguro social patronal"),
          type: "text",
          required: true,
          sensitive: true,
          transient: true,
          helpText: t(
            "Printed on the document next to section 2. SmartPR stores only a marker that it was provided, never the number itself.",
            "Se imprime en el documento junto a la sección 2. SmartPR solo guarda una marca de que fue provisto, nunca el número."
          ),
        },
        {
          id: "foundation_date",
          label: t("Organization or foundation date", "Fecha de organización o fundación"),
          type: "date",
          required: true,
        },
        {
          id: "mailing_address",
          canonicalKey: "location.mailing_address",
          label: t("Mailing address", "Dirección postal"),
          type: "address",
          required: true,
        },
        {
          id: "phone",
          canonicalKey: "business.phone",
          label: t("Phone", "Teléfono"),
          type: "phone",
        },
        {
          id: "cell",
          label: t("Cell phone", "Celular"),
          type: "phone",
        },
        {
          id: "fax",
          label: t("Fax", "Fax"),
          type: "text",
        },
        {
          id: "email",
          canonicalKey: "business.email",
          label: t("Email", "Correo electrónico"),
          type: "email",
        },
      ],
    },
    {
      id: "miembros",
      title: t("Shareholders, partners or beneficiaries (section 6)", "Accionistas, socios o beneficiarios (sección 6)"),
      fields: MEMBER_FIELDS,
    },
    {
      id: "empresa",
      title: t("Type of business and employment (sections 7–9)", "Tipo de empresa y empleo (secciones 7–9)"),
      fields: [
        {
          id: "tipo_empresa",
          label: t("Type of business", "Tipo de empresa"),
          type: "radio",
          required: true,
          options: [
            { value: "negocio_nuevo", label: t("New business (Negocio Nuevo)", "Negocio nuevo") },
            { value: "negocio_existente", label: t("Existing business (Negocio Existente)", "Negocio existente") },
          ],
        },
        {
          id: "empleo_nuevo_nuevos",
          label: t("New business — new jobs to create", "Negocio nuevo — empleos nuevos a crearse"),
          type: "number",
          visibleWhen: NUEVO,
          requiredWhen: NUEVO,
          validation: [{ type: "number_min", param: 0 }],
        },
        {
          id: "empleo_nuevo_actuales",
          label: t("New business — current jobs", "Negocio nuevo — empleos actuales"),
          type: "number",
          visibleWhen: NUEVO,
          requiredWhen: NUEVO,
          validation: [{ type: "number_min", param: 0 }],
        },
        {
          id: "empleo_nuevo_fijos",
          label: t("New business — permanent jobs", "Negocio nuevo — empleos fijos"),
          type: "number",
          visibleWhen: NUEVO,
          requiredWhen: NUEVO,
          validation: [{ type: "number_min", param: 0 }],
        },
        {
          id: "empleo_nuevo_temporeros",
          label: t("New business — temporary jobs", "Negocio nuevo — empleos temporeros"),
          type: "number",
          visibleWhen: NUEVO,
          requiredWhen: NUEVO,
          validation: [{ type: "number_min", param: 0 }],
        },
        {
          id: "empleo_exist_nuevos",
          label: t("Existing business — new jobs to create", "Negocio existente — empleos nuevos a crearse"),
          type: "number",
          visibleWhen: EXISTENTE,
          requiredWhen: EXISTENTE,
          validation: [{ type: "number_min", param: 0 }],
        },
        {
          id: "empleo_exist_actuales",
          label: t("Existing business — current jobs", "Negocio existente — empleos actuales"),
          type: "number",
          visibleWhen: EXISTENTE,
          requiredWhen: EXISTENTE,
          validation: [{ type: "number_min", param: 0 }],
        },
        {
          id: "empleo_exist_fijos",
          label: t("Existing business — permanent jobs", "Negocio existente — empleos fijos"),
          type: "number",
          visibleWhen: EXISTENTE,
          requiredWhen: EXISTENTE,
          validation: [{ type: "number_min", param: 0 }],
        },
        {
          id: "empleo_exist_temporeros",
          label: t("Existing business — temporary jobs", "Negocio existente — empleos temporeros"),
          type: "number",
          visibleWhen: EXISTENTE,
          requiredWhen: EXISTENTE,
          validation: [{ type: "number_min", param: 0 }],
        },
        {
          id: "inversion_presente_anio",
          label: t("Current-year investment in the agricultural business", "Inversión en el negocio en el presente año"),
          type: "currency",
          required: true,
        },
      ],
    },
    {
      id: "finca_a",
      title: t("Farm (a) — location and tenure (section 10)", "Finca (a) — localización y tenencia (sección 10)"),
      fields: fincaFields("finca_a", { required: true }),
    },
    {
      id: "finca_b",
      title: t("Farm (b) — location and tenure (section 10)", "Finca (b) — localización y tenencia (sección 10)"),
      fields: [
        {
          id: "tiene_finca_b",
          label: t("The entity operates a second farm", "La entidad opera una segunda finca"),
          type: "checkbox",
        },
        ...fincaFields("finca_b", { required: false, gate: "tiene_finca_b" }),
      ],
    },
    {
      id: "finca_c",
      title: t("Farm (c) — location and tenure (section 10)", "Finca (c) — localización y tenencia (sección 10)"),
      fields: [
        {
          id: "tiene_finca_c",
          label: t("The entity operates a third farm", "La entidad opera una tercera finca"),
          type: "checkbox",
        },
        ...fincaFields("finca_c", { required: false, gate: "tiene_finca_c" }),
      ],
    },
    {
      id: "pesca",
      title: t("Commercial marine fishing (section 11)", "Pesca marítima comercial (sección 11)"),
      fields: [
        {
          id: "realiza_pesca",
          label: t("The entity does commercial marine fishing", "La entidad realiza pesca marítima comercial"),
          type: "checkbox",
        },
        {
          id: "pesca_licencia_drna",
          label: t("DRNA commercial fishing license number", "Número de licencia de pesca comercial del DRNA"),
          type: "text",
          visibleWhen: [{ field: "realiza_pesca", operator: "truthy" as const }],
          requiredWhen: [{ field: "realiza_pesca", operator: "truthy" as const }],
        },
        {
          id: "pesca_registro_embarcacion",
          label: t("DRNA vessel registration number", "Número de registro de embarcación del DRNA"),
          type: "text",
          visibleWhen: [{ field: "realiza_pesca", operator: "truthy" as const }],
          requiredWhen: [{ field: "realiza_pesca", operator: "truthy" as const }],
        },
        {
          id: "pesca_estadisticas",
          label: t("Attach the Fisheries Research Laboratory statistics copy", "Anejar copia de estadísticas del Laboratorio de Investigaciones Pesqueras"),
          type: "checkbox",
          visibleWhen: [{ field: "realiza_pesca", operator: "truthy" as const }],
          helpText: t(
            "The form asks whether the fisheries-laboratory statistics copy is attached.",
            "El formulario pregunta si se aneja la copia de estadísticas del laboratorio de pesca."
          ),
        },
        ...([1, 2, 3] as const).flatMap((row) => [
          {
            id: `pesca_r${row}_negocio`,
            label: t(`Fishing row ${row} — agricultural business`, `Pesca renglón ${row} — negocio agrícola`),
            type: "text" as const,
            visibleWhen: [{ field: "realiza_pesca", operator: "truthy" as const }],
          },
          {
            id: `pesca_r${row}_clase`,
            label: t(`Fishing row ${row} — fish or shellfish class`, `Pesca renglón ${row} — clase de pescado o marisco`),
            type: "text" as const,
            visibleWhen: [{ field: "realiza_pesca", operator: "truthy" as const }],
          },
          {
            id: `pesca_r${row}_produccion`,
            label: t(`Fishing row ${row} — estimated annual production`, `Pesca renglón ${row} — producción anual estimada`),
            type: "text" as const,
            visibleWhen: [{ field: "realiza_pesca", operator: "truthy" as const }],
          },
          {
            id: `pesca_r${row}_salidas`,
            label: t(`Fishing row ${row} — offshore trips information`, `Pesca renglón ${row} — información sobre las salidas`),
            type: "text" as const,
            visibleWhen: [{ field: "realiza_pesca", operator: "truthy" as const }],
          },
        ]),
      ],
    },
    {
      id: "elaboradores",
      title: t("Processors of Puerto Rico-produced raw material (section 12)", "Elaboradores de materia prima producida en Puerto Rico (sección 12)"),
      fields: [
        {
          id: "tiene_planta",
          label: t("The entity operates a processing plant", "La entidad opera una planta elaboradora"),
          type: "checkbox",
        },
        {
          id: "elab_planta_bo",
          label: t("Plant — ward (Bo.)", "Planta — barrio (Bo.)"),
          type: "text",
          visibleWhen: [{ field: "tiene_planta", operator: "truthy" as const }],
        },
        {
          id: "elab_planta_carr",
          label: t("Plant — highway (Carr.)", "Planta — carretera (Carr.)"),
          type: "text",
          visibleWhen: [{ field: "tiene_planta", operator: "truthy" as const }],
        },
        {
          id: "elab_planta_km",
          label: t("Plant — kilometer (Km.)", "Planta — kilómetro (Km.)"),
          type: "text",
          visibleWhen: [{ field: "tiene_planta", operator: "truthy" as const }],
        },
        {
          id: "elab_planta_hm",
          label: t("Plant — hectometer (Hm.)", "Planta — hectómetro (Hm.)"),
          type: "text",
          visibleWhen: [{ field: "tiene_planta", operator: "truthy" as const }],
        },
        {
          id: "elab_municipio",
          label: t("Plant municipality", "Municipio de la planta"),
          type: "text",
          visibleWhen: [{ field: "tiene_planta", operator: "truthy" as const }],
          requiredWhen: [{ field: "tiene_planta", operator: "truthy" as const }],
        },
        {
          id: "elab_cuerdas",
          label: t("Plant cuerdas", "Cantidad de cuerdas de la planta"),
          type: "number",
          visibleWhen: [{ field: "tiene_planta", operator: "truthy" as const }],
          validation: [{ type: "number_min", param: 0 }],
        },
        {
          id: "elab_catastro",
          label: t("Plant cadastral number (if available)", "Número de catastro de la planta (si lo tiene)"),
          type: "text",
          visibleWhen: [{ field: "tiene_planta", operator: "truthy" as const }],
        },
        {
          id: "elab_tenencia_legal",
          label: t("Legal tenure of the plant land", "Tenencia legal de los terrenos de la planta"),
          type: "text",
          visibleWhen: [{ field: "tiene_planta", operator: "truthy" as const }],
        },
        {
          id: "elab_declaracion_jurada",
          label: t("Applicable sworn statement", "Declaración jurada aplicable"),
          type: "text",
          visibleWhen: [{ field: "tiene_planta", operator: "truthy" as const }],
        },
        ...([1, 2, 3, 4] as const).flatMap((row) => [
          {
            id: `elab_r${row}_subproducto`,
            label: t(`Processor row ${row} — by-product`, `Elaborador renglón ${row} — subproducto`),
            type: "text" as const,
            visibleWhen: [{ field: "tiene_planta", operator: "truthy" as const }],
          },
          {
            id: `elab_r${row}_agricultor`,
            label: t(`Processor row ${row} — farmer`, `Elaborador renglón ${row} — agricultor`),
            type: "text" as const,
            visibleWhen: [{ field: "tiene_planta", operator: "truthy" as const }],
          },
          {
            id: `elab_r${row}_producto`,
            label: t(`Processor row ${row} — product`, `Elaborador renglón ${row} — producto`),
            type: "text" as const,
            visibleWhen: [{ field: "tiene_planta", operator: "truthy" as const }],
          },
          {
            id: `elab_r${row}_desarrollo`,
            label: t(`Processor row ${row} — development level`, `Elaborador renglón ${row} — nivel de desarrollo`),
            type: "text" as const,
            visibleWhen: [{ field: "tiene_planta", operator: "truthy" as const }],
          },
        ]),
      ],
    },
    {
      id: "ingresos",
      title: t("Other income (section 13)", "Otros ingresos (sección 13)"),
      fields: [
        {
          id: "ingresos_no_agricolas",
          label: t(
            "Non-agricultural income or income from ineligible agricultural activities",
            "Ingresos no agrícolas o de actividades agrícolas no elegibles"
          ),
          type: "textarea",
          helpText: t(
            "Describe any income from non-agricultural activities or from agricultural activities not eligible under the bona fide farmer rules. Leave blank if none.",
            "Describa cualquier ingreso de actividades no agrícolas o de actividades agrícolas no elegibles. Déjelo en blanco si no tiene ninguno."
          ),
        },
      ],
    },
    {
      id: "firma",
      title: t("Date and signature", "Fecha y firma"),
      fields: [
        {
          id: "signature_date",
          label: t("Signing date", "Fecha de la firma"),
          type: "date",
          required: true,
          helpText: t(
            "Written on the form as Día / Mes / Año. The signature itself is done by hand.",
            "Se escribe en el formulario como Día / Mes / Año. La firma se hace a mano."
          ),
        },
        {
          id: "signature_acknowledgement",
          label: t(
            "I understand the signature line must be signed by hand on the printed form",
            "Entiendo que la firma debe hacerse a mano en el formulario impreso"
          ),
          type: "attestation",
          required: true,
        },
      ],
    },
  ],
  notices: [
    t(
      "This generates ONE document in the bona fide farmer certification package under Law 60 of 2019 — the certification request itself, not the incentive grant.",
      "Esto genera UN documento del paquete de certificación de agricultor bona fide bajo la Ley Núm. 60 de 2019 — la solicitud de certificación en sí, no la concesión del incentivo."
    ),
    t(
      "The 'Firma del Agricultor o Representante Autorizado' line and the date (Día/Mes/Año) are completed by hand on the printed form — SmartPR leaves the signature line blank.",
      "La línea 'Firma del Agricultor o Representante Autorizado' y la fecha (Día/Mes/Año) se completan a mano en el formulario impreso — SmartPR deja la línea de firma en blanco."
    ),
    t(
      "The employer social security number (Seguro Social Patronal) and the member social security numbers are printed on the document. SmartPR stores only a marker that they were provided, never the numbers themselves.",
      "El seguro social patronal y los seguros sociales de los miembros se imprimen en el documento. SmartPR solo guarda una marca de que fueron provistos, nunca los números."
    ),
    t(
      "The entity-kind boxes (Corporación, Sociedad Especial, Sucesión, Sociedad de Responsabilidad Limitada) are marked from the entity type in the SmartPR profile. Sucesión has no profile equivalent — mark it by hand on the printed form if it applies.",
      "Las casillas de tipo de entidad (Corporación, Sociedad Especial, Sucesión, Sociedad de Responsabilidad Limitada) se marcan según el tipo de entidad del perfil. Sucesión no tiene equivalente en el perfil — márquela a mano en el impreso si aplica."
    ),
    t(
      "Section 14 (the agronomist's income computation, recommendations, Cumple/No Cumple and signature) and section 15 (the regional director's observations and signature) are completed by Department of Agriculture staff — SmartPR leaves them blank. Bring tax returns and income documents to the farm inspection.",
      "La sección 14 (el cómputo de ingresos, las recomendaciones, Cumple/No Cumple y la firma del agrónomo) y la sección 15 (las observaciones y firma del director regional) las completa el personal del Departamento de Agricultura — SmartPR las deja en blanco. Lleve sus planillas y documentos de ingreso a la inspección de la finca."
    ),
    t(
      "The 'OFICINA REGIONAL', 'MUNICIPIO' (in the header) and 'Núm. Solicitud' boxes are for the Department's internal use — SmartPR leaves them blank.",
      "Las casillas 'OFICINA REGIONAL', 'MUNICIPIO' (del encabezado) y 'Núm. Solicitud' son para uso interno del Departamento — SmartPR las deja en blanco."
    ),
  ],
  feeMetadata: {
    source: t(
      "No fee is printed on the DA-OCAB-05 form itself. Confirm any filing cost with the Department of Agriculture's regional office before filing.",
      "El formulario DA-OCAB-05 no imprime ninguna tarifa. Confirme cualquier costo de radicación con la oficina regional del Departamento de Agricultura antes de presentar."
    ),
    requiresPortalVerification: true,
  },
};
