// ============================================================================
// AGRIIND01 — SOLICITUD AGRICULTOR BONA FIDE (PARA INDIVIDUOS), Modelo
// DA-OCAB-05, Rev. ABRIL 2021, Departamento de Agricultura, Gobierno de
// Puerto Rico. Certificación de agricultor bona fide bajo la Ley Núm. 60 de
// 1 de julio de 2019, variante para personas naturales (individuos).
//
// 6 pages, 136 native AcroForm text fields (label-named) — populated directly
// via directAcroValues (populationMethod "acroform").
//
// FIELD IDS ARE A CONTRACT. `artifacts/formDataPopulation.ts::
// agriBonafideIndividuoValues()` writes this form's applicant-owned answers
// into the official PDF's AcroForm fields by these exact ids — filing_kind,
// filing_year, sexo, estado_civil, fecha_nacimiento, direccion_residencial,
// celular, fax, ocupacion, experiencia_anos, the conyuge_* fields, the
// negocio/empleo fields, the finca1_*/finca2_* fields, the pesca_* fields and
// the planta_* fields. Renaming one here silently stops it reaching the PDF.
//
// The farmer's name, postal address, phone, email and the finca/plant
// municipios are `smartpr_derived` in form-mappings/AGRIIND01.json: populated
// from the shared canonical profile rather than re-asked. The municipio rows
// still appear here (with canonicalKey) so the filer can see and correct what
// will be printed — the renderer writes corrections back to the profile.
//
// The residential address is the exception: the canonical `owner.address` is
// derived (authorizedSigners[0].physicalAddress ?? principalMailing) with no
// single settable path, so a canonicalKey here would corrupt the shared
// profile. It is collected as a form-local address and written straight into
// the PDF by agriBonafideIndividuoValues (precedence over the canonical
// default, same as the SS-4 pattern).
//
// Never written by SmartPR and never collected here:
//   * The three SSN boxes ("2 Seguro Social Personal", "Patronal", spouse
//     "Seguro Social") — personal government identifiers SmartPR never stores
//     (PA02 precedent: the filer writes them by hand on the printed form).
//   * "Firma del Agricultor o Representante Autorizado" — hand-signed.
//   * Section 23 (agronomist: 14a/14b income computation, RECOMENDACIÓN,
//     Cumple/No Cumple, numbered 1-10 evaluation, signature) — agency staff.
//   * Section 24 (regional director: observations, date, signature).
//   * "Para Uso Interno" header: OFICINA REGIONAL, MUNICIPIO, Núm. Solicitud.
// The Km blanks (19a and 19b) have no AcroForm widgets at all — hand-written.
// ============================================================================

import type { DigitalFormDefinition, FormField } from "../../../engine/types.ts";
import { t } from "../department-of-state/shared.ts";

const SEXO_OPTIONS = [
  { value: "Masculino", label: t("Masculino", "Masculino") },
  { value: "Femenino", label: t("Femenino", "Femenino") },
];

const ESTADO_CIVIL_OPTIONS = [
  { value: "Soltero", label: t("Soltero", "Soltero") },
  { value: "Casado", label: t("Casado", "Casado") },
  { value: "Divorciado", label: t("Divorciado", "Divorciado") },
  { value: "Viudo", label: t("Viudo", "Viudo") },
];

const YEAR_VALIDATION = [
  {
    type: "regex" as const,
    param: "^(19|20)\\d{2}$",
    message: t("Enter a four-digit year.", "Escriba un año de cuatro dígitos."),
  },
];

const CASADO = [{ field: "estado_civil", operator: "eq" as const, value: "Casado" }];

/** Finca location + cuerdas fields shared by 19a and 19b (prefix differs). */
function fincaFields(prefix: "finca1" | "finca2", opts: { required: boolean }): FormField[] {
  const req = opts.required;
  const when = prefix === "finca1" ? undefined : [{ field: "tiene_segunda_finca", operator: "truthy" as const }];
  const maybeRequired = (extra?: FormField["requiredWhen"]): Partial<FormField> =>
    prefix === "finca1" && req ? { required: true } : { requiredWhen: extra ?? when };
  return [
    {
      id: `${prefix}_hm`,
      label: t("Hectómetro (Hm.)", "Hectómetro (Hm.)"),
      type: "text",
      visibleWhen: when,
    },
    {
      id: `${prefix}_barrio`,
      label: t("Barrio", "Barrio"),
      type: "text",
      visibleWhen: when,
      ...maybeRequired(),
    },
    {
      id: `${prefix}_sector`,
      label: t("Sector", "Sector"),
      type: "text",
      visibleWhen: when,
    },
    {
      id: `${prefix}_catastro`,
      label: t("Catastro number (if available)", "Número de catastro (si lo tiene)"),
      type: "text",
      visibleWhen: when,
      helpText: t(
        "The form says 'de estar disponible' — leave it blank if you do not have it.",
        "El formulario dice 'de estar disponible' — déjelo en blanco si no lo tiene."
      ),
    },
    {
      id: `${prefix}_cuerdas_total`,
      label: t("Total cuerdas", "Cantidad de cuerdas"),
      type: "number",
      visibleWhen: when,
      ...maybeRequired(),
      validation: [{ type: "number_min", param: 0 }],
    },
    {
      id: `${prefix}_cuerdas_propias`,
      label: t("Owned cuerdas", "Cuerdas propias"),
      type: "number",
      visibleWhen: when,
      validation: [{ type: "number_min", param: 0 }],
    },
    {
      id: `${prefix}_fecha_adquisicion`,
      label: t("Date acquired", "Fecha en que se adquirió"),
      type: "date",
      visibleWhen: when,
      helpText: t(
        "Complete only if the farm has owned cuerdas.",
        "Complete solo si la finca tiene cuerdas propias."
      ),
    },
    {
      id: `${prefix}_cuerdas_usufructo`,
      label: t("Usufruct cuerdas", "Cuerdas en usufructo"),
      type: "number",
      visibleWhen: when,
      validation: [{ type: "number_min", param: 0 }],
    },
    {
      id: `${prefix}_fecha_otorgacion`,
      label: t("Usufruct grant date", "Fecha de otorgación del usufructo"),
      type: "date",
      visibleWhen: when,
    },
    {
      id: `${prefix}_cuerdas_arrendadas`,
      label: t("Leased cuerdas", "Cuerdas arrendadas"),
      type: "number",
      visibleWhen: when,
      validation: [{ type: "number_min", param: 0 }],
    },
    {
      id: `${prefix}_fecha_vencimiento`,
      label: t("Lease expiration date", "Fecha de vencimiento del arrendamiento"),
      type: "date",
      visibleWhen: when,
    },
  ];
}

/** The farm-business table rows (finca 19a / 19b): two free-text rows plus one
 *  split row with the form's four columns. The schema-field → PDF-row mapping
 *  (Row1/Row2/Row3/Row3_2...) lives in agriBonafideIndividuoValues(), next to
 *  the other AcroForm field-name contracts. */
function fincaNegociosFields(prefix: "finca1" | "finca2"): FormField[] {
  const when = prefix === "finca1" ? undefined : [{ field: "tiene_segunda_finca", operator: "truthy" as const }];
  return [
    {
      id: `${prefix}_negocios_row1`,
      label: t("Farm business — row 1 (free text)", "Negocio agrícola — fila 1 (texto libre)"),
      type: "text",
      visibleWhen: when,
      helpText: t(
        "Describe the crop or business, the cuerdas, the estimated yearly production and how developed it is — for example 'Café, 10 cuerdas, 200 quintales, en producción'.",
        "Describa el cultivo o negocio, las cuerdas, la producción anual estimada y cuán desarrollado está — por ejemplo 'Café, 10 cuerdas, 200 quintales, en producción'."
      ),
    },
    {
      id: `${prefix}_negocios_row2`,
      label: t("Farm business — row 2 (free text)", "Negocio agrícola — fila 2 (texto libre)"),
      type: "text",
      visibleWhen: when,
    },
    {
      id: `${prefix}_negocios_row3_negocio`,
      label: t("Row 3 — farm business", "Fila 3 — negocio agrícola"),
      type: "text",
      visibleWhen: when,
    },
    {
      id: `${prefix}_negocios_row3_cuerdas`,
      label: t("Row 3 — cuerdas", "Fila 3 — cantidad de cuerdas"),
      type: "text",
      visibleWhen: when,
    },
    {
      id: `${prefix}_negocios_row3_produccion`,
      label: t("Row 3 — estimated yearly production", "Fila 3 — producción anual estimada"),
      type: "text",
      visibleWhen: when,
      helpText: t(
        "In the units the form lists: arrobas, libras, mazos, millares, becerros, cuartillos.",
        "En las unidades que lista el formulario: arrobas, libras, mazos, millares, becerros, cuartillos."
      ),
    },
    {
      id: `${prefix}_negocios_row3_nivel`,
      label: t("Row 3 — development level on the farm", "Fila 3 — nivel de desarrollo en la finca"),
      type: "text",
      visibleWhen: when,
    },
  ];
}

export const AGRIIND01: DigitalFormDefinition = {
  id: "FORM_PR_AGRI_BONAFIDE_INDIVIDUO",
  officialFormNumber: "DA-OCAB-05 (Individuos)",
  requirementId: "DOC_AGRICULTURE_REGISTRATION",
  variantKey: "bona_fide_individuo",
  title: t(
    "Bona Fide Farmer Application (Individuals) — Law 60 of July 1, 2019",
    "Solicitud Agricultor Bona Fide (Para Individuos) — Ley Núm. 60 de 1 de julio de 2019"
  ),
  agency: "Departamento de Agricultura (Gobierno de Puerto Rico)",
  jurisdiction: "pr",
  version: "1.0.0",
  verificationStatus: "extracted_from_official_pdf",
  sourceDocument: "AGRI-Bonafide-Individuo.pdf",
  resultingDocumentName: t(
    "Signed Bona Fide Farmer application for the Department of Agriculture",
    "Solicitud de Agricultor Bona Fide firmada para el Departamento de Agricultura"
  ),
  submissionMethod: "generated_preparation_pdf",
  officialEvidenceStillRequired: true,
  // This is the natural-person variant; the juridical-entity (corporación)
  // variant is a separate form. The individuo/corporación split is handled by
  // the routing rows in engine/routing.ts — the corporación rows sit ABOVE the
  // individuo rows because first match wins.
  applicability: [],
  sections: [
    {
      id: "solicitud",
      title: t("Application type", "Tipo de solicitud"),
      fields: [
        {
          id: "filing_kind",
          label: t("Is this a new case or a renewal?", "¿Es un caso nuevo o una renovación?"),
          type: "radio",
          required: true,
          options: [
            { value: "caso_nuevo", label: t("New case (Caso Nuevo)", "Caso nuevo") },
            { value: "renovacion", label: t("Renewal (Renovación)", "Renovación") },
          ],
          helpText: t(
            "SmartPR marks the matching box on the official form.",
            "SmartPR marca la casilla correspondiente en el formulario oficial."
          ),
        },
        {
          id: "filing_year",
          label: t("Year requested (Año Solicitado)", "Año solicitado"),
          type: "text",
          required: true,
          helpText: t(
            "The certification year — defaults to the current year.",
            "El año de la certificación — por defecto es el año actual."
          ),
          validation: YEAR_VALIDATION,
        },
      ],
    },
    {
      id: "agricultor",
      title: t("Farmer information", "Datos del agricultor"),
      description: t(
        "Your name, addresses, phone and email are prefilled from your SmartPR profile. Correct anything that is wrong — corrections are saved back to your profile and used on every other form.",
        "Su nombre, direcciones, teléfono y correo están precargados desde su perfil de SmartPR. Corrija lo que esté incorrecto — las correcciones se guardan en su perfil y se usan en los demás formularios."
      ),
      fields: [
        {
          id: "farmer_name",
          label: t("Farmer's full name", "Nombre del agricultor"),
          type: "text",
          required: true,
          canonicalKey: "contact.fullName",
        },
        {
          id: "ssn_acknowledgement",
          label: t(
            "I understand I must write my personal social security number and the patronal number on the printed form myself — SmartPR never stores or prints them.",
            "Entiendo que debo escribir yo mismo mi seguro social personal y el patronal en el formulario impreso — SmartPR nunca los guarda ni los imprime."
          ),
          type: "attestation",
          required: true,
        },
        {
          id: "sexo",
          label: t("Sex (Sexo)", "Sexo"),
          type: "select",
          required: true,
          options: SEXO_OPTIONS,
        },
        {
          id: "estado_civil",
          label: t("Marital status (Estado Civil)", "Estado civil"),
          type: "select",
          required: true,
          options: ESTADO_CIVIL_OPTIONS,
        },
        {
          id: "fecha_nacimiento",
          label: t("Date of birth", "Fecha de nacimiento"),
          type: "date",
          required: true,
        },
        {
          id: "direccion_postal",
          label: t("Mailing address", "Dirección postal"),
          type: "address",
          required: true,
          canonicalKey: "addresses.principalMailing",
        },
        {
          id: "direccion_residencial",
          label: t("Residential address", "Dirección residencial"),
          type: "address",
          required: true,
          helpText: t(
            "Where you live — this goes on the form's 'Dirección Residencial' line, which is separate from your mailing address.",
            "Donde usted vive — esto va en la línea 'Dirección Residencial' del formulario, que es aparte de su dirección postal."
          ),
        },
        {
          id: "telefono",
          label: t("Telephone", "Teléfono"),
          type: "phone",
          required: true,
          canonicalKey: "contact.phone",
        },
        {
          id: "celular",
          label: t("Cell phone", "Celular"),
          type: "phone",
          helpText: t(
            "A second number, if you have one — your profile holds only one phone.",
            "Un segundo número, si tiene uno — su perfil guarda solo un teléfono."
          ),
        },
        {
          id: "fax",
          label: t("Fax", "Fax"),
          type: "text",
        },
        {
          id: "email",
          label: t("Email", "Correo electrónico"),
          type: "email",
          required: true,
          canonicalKey: "contact.email",
        },
        {
          id: "ocupacion",
          label: t("Occupation", "Ocupación"),
          type: "text",
          required: true,
        },
        {
          id: "experiencia_anos",
          label: t("Years of agricultural experience", "Años de experiencia agrícola"),
          type: "number",
          required: true,
          helpText: t(
            "Enter 0 if you are just starting out.",
            "Escriba 0 si apenas está empezando."
          ),
          validation: [{ type: "number_min", param: 0 }],
        },
      ],
    },
    {
      id: "conyuge",
      title: t("Spouse information", "Información del cónyuge"),
      description: t(
        "Complete only if you are married — the form asks for the spouse's information in items 10 through 15.",
        "Complete solo si está casado — el formulario pide la información del cónyuge en los encasillados 10 al 15."
      ),
      visibleWhen: CASADO,
      fields: [
        {
          id: "conyuge_nombre",
          label: t("Spouse's full name", "Nombre del cónyuge"),
          type: "text",
          requiredWhen: CASADO,
        },
        {
          id: "conyuge_ssn_acknowledgement",
          label: t(
            "I understand my spouse's social security number must be written by hand on the printed form — SmartPR never stores or prints it.",
            "Entiendo que el seguro social de mi cónyuge se escribe a mano en el formulario impreso — SmartPR nunca lo guarda ni lo imprime."
          ),
          type: "attestation",
          requiredWhen: CASADO,
        },
        {
          id: "conyuge_ocupacion",
          label: t("Spouse's occupation", "Ocupación del cónyuge"),
          type: "text",
          visibleWhen: CASADO,
        },
        {
          id: "conyuge_sexo",
          label: t("Spouse's sex", "Sexo del cónyuge"),
          type: "select",
          visibleWhen: CASADO,
          options: SEXO_OPTIONS,
        },
        {
          id: "conyuge_fecha_nacimiento",
          label: t("Spouse's date of birth", "Fecha de nacimiento del cónyuge"),
          type: "date",
          visibleWhen: CASADO,
        },
        {
          id: "conyuge_patrono",
          label: t("Spouse's employer", "Patrono del cónyuge"),
          type: "text",
          visibleWhen: CASADO,
        },
        {
          id: "conyuge_ingreso_anual",
          label: t("Spouse's annual income", "Ingreso anual del cónyuge"),
          type: "currency",
          visibleWhen: CASADO,
          validation: [{ type: "number_min", param: 0 }],
        },
      ],
    },
    {
      id: "negocio",
      title: t("Business type and employment", "Tipo de empresa y empleo"),
      description: t(
        "Mark whether this is a new or an existing business, and break down the jobs for that branch.",
        "Marque si es un negocio nuevo o uno existente, y desglose los empleos de esa rama."
      ),
      fields: [
        {
          id: "business_kind",
          label: t("Business type (Tipo de Empresa)", "Tipo de empresa"),
          type: "radio",
          required: true,
          options: [
            { value: "nuevo", label: t("New business (16 — Negocio Nuevo)", "Negocio nuevo (16)") },
            { value: "existente", label: t("Existing business (17 — Negocio Existente)", "Negocio existente (17)") },
          ],
        },
        {
          id: "nuevo_empleos_nuevos",
          label: t("New business — jobs to be created", "Negocio nuevo — empleos nuevos a crearse"),
          type: "number",
          visibleWhen: [{ field: "business_kind", operator: "eq", value: "nuevo" }],
          validation: [{ type: "number_min", param: 0 }],
        },
        {
          id: "nuevo_empleos_actuales",
          label: t("New business — current jobs", "Negocio nuevo — empleos actuales"),
          type: "number",
          visibleWhen: [{ field: "business_kind", operator: "eq", value: "nuevo" }],
          validation: [{ type: "number_min", param: 0 }],
        },
        {
          id: "nuevo_empleos_fijos",
          label: t("New business — permanent jobs", "Negocio nuevo — empleos fijos"),
          type: "number",
          visibleWhen: [{ field: "business_kind", operator: "eq", value: "nuevo" }],
          validation: [{ type: "number_min", param: 0 }],
        },
        {
          id: "nuevo_empleos_temporeros",
          label: t("New business — temporary jobs", "Negocio nuevo — empleos temporeros"),
          type: "number",
          visibleWhen: [{ field: "business_kind", operator: "eq", value: "nuevo" }],
          validation: [{ type: "number_min", param: 0 }],
        },
        {
          id: "existente_empleos_nuevos",
          label: t("Existing business — jobs to be created", "Negocio existente — empleos nuevos a crearse"),
          type: "number",
          visibleWhen: [{ field: "business_kind", operator: "eq", value: "existente" }],
          validation: [{ type: "number_min", param: 0 }],
        },
        {
          id: "existente_empleos_actuales",
          label: t("Existing business — current jobs", "Negocio existente — empleos actuales"),
          type: "number",
          visibleWhen: [{ field: "business_kind", operator: "eq", value: "existente" }],
          validation: [{ type: "number_min", param: 0 }],
        },
        {
          id: "existente_empleos_fijos",
          label: t("Existing business — permanent jobs", "Negocio existente — empleos fijos"),
          type: "number",
          visibleWhen: [{ field: "business_kind", operator: "eq", value: "existente" }],
          validation: [{ type: "number_min", param: 0 }],
        },
        {
          id: "existente_empleos_temporeros",
          label: t("Existing business — temporary jobs", "Negocio existente — empleos temporeros"),
          type: "number",
          visibleWhen: [{ field: "business_kind", operator: "eq", value: "existente" }],
          validation: [{ type: "number_min", param: 0 }],
        },
        {
          id: "inversion_actual",
          label: t("Investment in the business this year (18)", "Inversión en el negocio este año (18)"),
          type: "currency",
          helpText: t(
            "Enter 0 if there is no investment to report this year.",
            "Escriba 0 si no hay inversión que reportar este año."
          ),
          validation: [{ type: "number_min", param: 0 }],
        },
      ],
    },
    {
      id: "finca1",
      title: t("Farm information — 19(a)", "Información de la finca — 19(a)"),
      description: t(
        "Where the farm sits and how the land is held. The Km. blank next to the highway number has no digital box on the official form — write it by hand on the printed copy if it applies.",
        "Dónde ubica la finca y cómo se tiene la tierra. El espacio de Km. junto al número de carretera no tiene casilla digital en el formulario oficial — escríbalo a mano en la copia impresa si aplica."
      ),
      fields: [
        {
          id: "finca1_carretera",
          label: t("Highway number (Núm. de Carr.)", "Número de carretera"),
          type: "text",
          required: true,
        },
        ...fincaFields("finca1", { required: true }),
        {
          id: "municipio_finca1",
          label: t("Municipio", "Municipio"),
          type: "text",
          required: true,
          canonicalKey: "addresses.municipality",
        },
        ...fincaNegociosFields("finca1"),
      ],
    },
    {
      id: "finca2",
      title: t("Second farm — 19(b)", "Segunda finca — 19(b)"),
      description: t(
        "The official form's 19(b) has no digital boxes for the highway number or Km. — write those by hand on the printed copy if you report a second farm.",
        "El encasillado 19(b) del formulario oficial no tiene casillas digitales para el número de carretera ni el Km. — escríbalos a mano en la copia impresa si reporta una segunda finca."
      ),
      fields: [
        {
          id: "tiene_segunda_finca",
          label: t("I am reporting a second farm", "Estoy reportando una segunda finca"),
          type: "checkbox",
        },
        ...fincaFields("finca2", { required: false }),
        {
          id: "municipio_finca2",
          label: t("Municipio", "Municipio"),
          type: "text",
          visibleWhen: [{ field: "tiene_segunda_finca", operator: "truthy" }],
          requiredWhen: [{ field: "tiene_segunda_finca", operator: "truthy" }],
          canonicalKey: "addresses.municipality",
        },
        ...fincaNegociosFields("finca2"),
      ],
    },
    {
      id: "pesca",
      title: t("Fishing activities (20)", "Actividades pesqueras (20)"),
      description: t(
        "Complete only if you fish commercially. The form asks for your DRNA licenses and your reported catch.",
        "Complete solo si pesca comercialmente. El formulario pide sus licencias del DRNA y su pesca reportada."
      ),
      fields: [
        {
          id: "realiza_pesca",
          label: t("I perform commercial fishing activities", "Realizo actividades de pesca comercial"),
          type: "checkbox",
        },
        {
          id: "pesca_licencia_drna",
          label: t("DRNA commercial fisherman license", "Licencia de pescador comercial del DRNA"),
          type: "text",
          visibleWhen: [{ field: "realiza_pesca", operator: "truthy" }],
        },
        {
          id: "pesca_registro_embarcacion",
          label: t("DRNA vessel registration", "Registro de embarcación del DRNA"),
          type: "text",
          visibleWhen: [{ field: "realiza_pesca", operator: "truthy" }],
          helpText: t(
            "Leave blank if it does not apply.",
            "Déjelo en blanco si no aplica."
          ),
        },
        {
          id: "pesca_libras_estadisticas",
          label: t("Pounds of fish/shellfish per Fisheries Research Laboratory statistics", "Libras de pescado y mariscos según estadísticas del Laboratorio de Investigaciones Pesqueras"),
          type: "text",
          visibleWhen: [{ field: "realiza_pesca", operator: "truthy" }],
        },
        {
          id: "pesca_row1",
          label: t("Catch — row 1 (free text)", "Pesca — fila 1 (texto libre)"),
          type: "text",
          visibleWhen: [{ field: "realiza_pesca", operator: "truthy" }],
          helpText: t(
            "For example 'Chillo, 500 libras al año, desembarco en Guánica, bote propio'.",
            "Por ejemplo 'Chillo, 500 libras al año, desembarco en Guánica, bote propio'."
          ),
        },
        {
          id: "pesca_negocio",
          label: t("Row 2 — fishing business", "Fila 2 — negocio agrícola"),
          type: "text",
          visibleWhen: [{ field: "realiza_pesca", operator: "truthy" }],
        },
        {
          id: "pesca_clase",
          label: t("Row 2 — type of fish or shellfish", "Fila 2 — clase de pescado o marisco"),
          type: "text",
          visibleWhen: [{ field: "realiza_pesca", operator: "truthy" }],
        },
        {
          id: "pesca_produccion",
          label: t("Row 2 — estimated yearly production (pounds)", "Fila 2 — producción anual estimada (libras)"),
          type: "text",
          visibleWhen: [{ field: "realiza_pesca", operator: "truthy" }],
        },
        {
          id: "pesca_info_salidas",
          label: t("Row 2 — offshore trips (landing site, companions, vessel)", "Fila 2 — salidas alta mar (desembarco, acompañantes, embarcación)"),
          type: "text",
          visibleWhen: [{ field: "realiza_pesca", operator: "truthy" }],
        },
      ],
    },
    {
      id: "planta",
      title: t("Processing plant (21)", "Planta elaboradora (21)"),
      description: t(
        "Complete only if you operate — or use — a plant that processes Puerto Rico farm products.",
        "Complete solo si opera — o usa — una planta que elabora productos agrícolas de Puerto Rico."
      ),
      fields: [
        {
          id: "tiene_planta",
          label: t("I operate or use a processing plant", "Opero o uso una planta elaboradora"),
          type: "checkbox",
        },
        {
          id: "planta_localizacion",
          label: t("Plant location", "Localización de la planta de elaboración"),
          type: "text",
          visibleWhen: [{ field: "tiene_planta", operator: "truthy" }],
          requiredWhen: [{ field: "tiene_planta", operator: "truthy" }],
        },
        {
          id: "municipio_planta",
          label: t("Municipio", "Municipio"),
          type: "text",
          visibleWhen: [{ field: "tiene_planta", operator: "truthy" }],
          requiredWhen: [{ field: "tiene_planta", operator: "truthy" }],
          canonicalKey: "addresses.municipality",
        },
        {
          id: "planta_cuerdas",
          label: t("Plant cuerdas", "Cantidad de cuerdas"),
          type: "number",
          visibleWhen: [{ field: "tiene_planta", operator: "truthy" }],
          validation: [{ type: "number_min", param: 0 }],
        },
        {
          id: "planta_tenencia",
          label: t("Legal tenure", "Tenencia legal"),
          type: "text",
          visibleWhen: [{ field: "tiene_planta", operator: "truthy" }],
          helpText: t(
            "For example: propia, arrendada, usufructo.",
            "Por ejemplo: propia, arrendada, usufructo."
          ),
        },
        {
          id: "planta_subproductos_row1",
          label: t("By-products — row 1 (free text)", "Subproductos — fila 1 (texto libre)"),
          type: "text",
          visibleWhen: [{ field: "tiene_planta", operator: "truthy" }],
        },
        {
          id: "planta_subproductos_row2",
          label: t("By-products — row 2 (free text)", "Subproductos — fila 2 (texto libre)"),
          type: "text",
          visibleWhen: [{ field: "tiene_planta", operator: "truthy" }],
        },
        {
          id: "planta_subproductos_row3_nombre",
          label: t("Row 3 — by-products you process", "Fila 3 — subproductos que elabora"),
          type: "text",
          visibleWhen: [{ field: "tiene_planta", operator: "truthy" }],
        },
        {
          id: "planta_subproductos_row3_agricultores",
          label: t("Row 3 — farmers you buy raw material from (name and address)", "Fila 3 — agricultores a quienes compra materia prima (nombre y dirección)"),
          type: "text",
          visibleWhen: [{ field: "tiene_planta", operator: "truthy" }],
        },
        {
          id: "planta_subproductos_row3_producto",
          label: t("Row 3 — PR farm product and amount bought from the farmer", "Fila 3 — producto agrícola de P.R. y cantidad que le compra al agricultor"),
          type: "text",
          visibleWhen: [{ field: "tiene_planta", operator: "truthy" }],
        },
        {
          id: "planta_subproductos_row3_nivel",
          label: t("Row 3 — plant development level", "Fila 3 — nivel de desarrollo de la planta elaboradora"),
          type: "text",
          visibleWhen: [{ field: "tiene_planta", operator: "truthy" }],
        },
      ],
    },
    {
      id: "ingresos",
      title: t("Income — 14a / 14b (agency section)", "Ingresos — 14a / 14b (sección de la agencia)"),
      fields: [
        {
          id: "ingresos_info",
          type: "statutory_text",
          body: t(
            "The 14a/14b income section (section 23) is completed by the Department of Agriculture's agronomist, not by you — SmartPR leaves those boxes blank. Bring your tax returns and income documents to the farm inspection: the agronomist computes your gross income from them, and the bona fide certification depends on your agricultural income. Do not write anything in the 14a/14b boxes yourself.",
            "La sección de ingresos 14a/14b (sección 23) la completa el agrónomo del Departamento de Agricultura, no usted — SmartPR deja esas casillas en blanco. Lleve sus planillas y documentos de ingreso a la inspección de la finca: el agrónomo calcula su ingreso bruto con ellos, y la certificación bona fide depende de su ingreso agrícola. No escriba nada usted en las casillas 14a/14b."
          ),
        },
      ],
    },
    {
      id: "firma",
      title: t("Signature", "Firma"),
      description: t(
        "SmartPR prepares everything except the signature itself — the certification statement on page 4 is yours to sign.",
        "SmartPR prepara todo menos la firma como tal — la declaración de certificación de la página 4 es suya para firmar."
      ),
      fields: [
        {
          id: "firma_acknowledgement",
          label: t(
            "I understand the 'Firma del Agricultor o Representante Autorizado' line must be signed by hand, and the date (Día/Mes/Año) written by hand too — SmartPR leaves that block blank.",
            "Entiendo que la línea 'Firma del Agricultor o Representante Autorizado' se firma a mano, y la fecha (Día/Mes/Año) también se escribe a mano — SmartPR deja ese bloque en blanco."
          ),
          type: "attestation",
          required: true,
        },
      ],
    },
  ],
  notices: [
    t(
      "SmartPR leaves the three social security boxes blank on purpose — your personal number, the patronal number, and your spouse's number are personal government identifiers SmartPR never stores or prints. Write them by hand on the printed form before filing.",
      "SmartPR deja las tres casillas de seguro social en blanco a propósito — su número personal, el patronal y el de su cónyuge son identificadores personales que SmartPR nunca guarda ni imprime. Escríbalos a mano en el formulario impreso antes de presentarlo."
    ),
    t(
      "The 'Firma del Agricultor o Representante Autorizado' line and the date (Día/Mes/Año) are completed by hand on the printed form — SmartPR leaves that block blank.",
      "La línea 'Firma del Agricultor o Representante Autorizado' y la fecha (Día/Mes/Año) se completan a mano en el formulario impreso — SmartPR deja ese bloque en blanco."
    ),
    t(
      "Section 23 (the 14a/14b income computation, recommendations, Cumple/No Cumple and the agronomist's signature) and section 24 (the regional director's observations and signature) are completed by Department of Agriculture staff — SmartPR leaves them blank. Bring your tax returns and income documents to the farm inspection.",
      "La sección 23 (el cómputo de ingresos 14a/14b, las recomendaciones, Cumple/No Cumple y la firma del agrónomo) y la sección 24 (las observaciones y firma del director regional) las completa el personal del Departamento de Agricultura — SmartPR las deja en blanco. Lleve sus planillas y documentos de ingreso a la inspección de la finca."
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
