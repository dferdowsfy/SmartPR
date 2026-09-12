// ============================================================================
// SC2309 — Modelo SC 2309 "Solicitud de Licencias", Rev. 28 ago 14 /
// Rep. 26 jun 17. Departamento de Hacienda, Negociado de Impuesto al
// Consumo.
//
// The official application for Puerto Rico internal-revenue licenses
// (licencias de rentas internas), including alcohol beverage licenses.
// Hacienda's document repository still publishes this revision as the form
// to complete, and Hacienda's "Requisitos para cada tipo de Licencia de
// Rentas Internas" page directs every license type — including the alcohol
// licenses — to "Completar formulario 'Solicitud de Licencias', Formulario
// Modelo SC 2309" (both pages verified live 2026-09-12).
//
// FIELD IDS ARE A CONTRACT. `artifacts/formDataPopulation.ts::sc2309Values()`
// writes this form's answers into the official PDF by these exact ids —
// lic_bebidas, periodo, declarante_nombre, ... Renaming one here silently
// stops it reaching the PDF. The mapping geometry lives in
// `artifacts/overlayMaps.ts::SC2309_OVERLAY` (human-reviewed against the
// PDF's own text layer and a rendered page image).
//
// What SmartPR never writes (ownership backstop in population.ts):
//   * the "Firma" line in Parte IV (ownership: "signature") — hand-sign;
//   * the "Jurado y suscrito ante mí" block + "Núm. Affidávit"
//     (ownership: "notary") — completed by the notary public or authorized
//     public official at signing;
//   * "Número de Solicitud" and all of page 2 "Uso Oficial"
//     (ownership: "government_only") — Hacienda's processing boxes.
// Social security numbers are `sensitive` + `transient`: typed on the
// artifact, never auto-filled, never persisted in drafts.
// ============================================================================

import type { DigitalFormDefinition, LocalizedText } from "../../../engine/types.ts";

function t(en: string, es: string): LocalizedText {
  return { en, es };
}

export const SC2309: DigitalFormDefinition = {
  id: "FORM_PR_HACIENDA_SC2309",
  officialFormNumber: "SC2309",
  requirementId: "DOC_ALCOHOL_LICENSE",
  variantKey: "alcohol",
  title: t(
    "License Application — Modelo SC 2309 (Solicitud de Licencias)",
    "Solicitud de Licencias — Modelo SC 2309"
  ),
  agency: "Departamento de Hacienda — Negociado de Impuesto al Consumo",
  jurisdiction: "pr",
  version: "1.0.0",
  verificationStatus: "extracted_from_official_pdf",
  sourceDocument: "sc_2309_0.pdf",
  officialSourceUrl: "https://hacienda.pr.gov/documentos/solicitud-de-licencias",
  resultingDocumentName: t(
    "Populated Modelo SC 2309 license application, ready to sign and file with Hacienda",
    "Solicitud de licencias Modelo SC 2309 completada, lista para firmar y radicar en Hacienda"
  ),
  submissionMethod: "generated_preparation_pdf",
  officialEvidenceStillRequired: true,
  applicability: [],
  sections: [
    {
      id: "contribuyente",
      title: t("Taxpayer information (Parte I)", "Información del contribuyente (Parte I)"),
      description: t(
        "Who is applying for the license. The taxpayer-type checkbox (individual, partnership, corporation, LLC) is marked automatically from your business profile.",
        "Quién solicita la licencia. El encasillado de tipo de contribuyente (individuo, sociedad, corporación, LLC) se marca automáticamente desde su perfil de negocio."
      ),
      fields: [
        {
          id: "nombre",
          label: t("Taxpayer name", "Nombre del contribuyente"),
          type: "text",
          required: true,
          canonicalKey: "business.legalName",
          helpText: t(
            "Legal name of the individual or entity applying. Prefilled from your SmartPR profile.",
            "Nombre legal del individuo o entidad que solicita. Precargado desde su perfil de SmartPR."
          ),
        },
        {
          id: "numero_seguro_social",
          label: t("Social security number", "Número de seguro social"),
          type: "text",
          required: true,
          sensitive: true,
          transient: true,
          helpText: t(
            "Typed only on this form — SmartPR never stores it or fills it in automatically.",
            "Se escribe solo en este formulario — SmartPR nunca lo guarda ni lo llena automáticamente."
          ),
        },
        {
          id: "numero_registro_comerciante",
          label: t("Merchant registration number", "Número de registro de comerciante"),
          type: "text",
          canonicalKey: "business.merchantRegistrationNumber",
          helpText: t(
            "Your Registro de Comerciante number from SURI. Prefilled if SmartPR has it.",
            "Su número de Registro de Comerciante de SURI. Precargado si SmartPR lo tiene."
          ),
        },
        {
          id: "nombre_comercial",
          label: t("Trade name / business name", "Nombre comercial o del negocio"),
          type: "text",
          canonicalKey: "business.tradeName",
        },
        {
          id: "numero_identificacion_patronal",
          label: t("Employer identification number", "Número de identificación patronal"),
          type: "text",
          canonicalKey: "business.ein",
        },
        {
          id: "numero_telefono",
          label: t("Phone number", "Número de teléfono"),
          type: "phone",
          canonicalKey: "business.phone",
        },
        {
          id: "direccion_postal",
          label: t("Postal address", "Dirección postal"),
          type: "address",
          required: true,
          canonicalKey: "addresses.principalMailing",
        },
        {
          id: "codigo_postal",
          label: t("ZIP code", "Código postal"),
          type: "text",
          validation: [{ type: "pr_postal_code" }],
        },
        {
          id: "localizacion_negocio",
          label: t("Business physical location", "Localización del negocio"),
          type: "address",
          required: true,
          canonicalKey: "addresses.operatingAddress",
          helpText: t(
            "Where the licensed activity will operate. Prefilled from your SmartPR profile.",
            "Donde operará la actividad licenciada. Precargado desde su perfil de SmartPR."
          ),
        },
      ],
    },
    {
      id: "individuos",
      title: t("Additional information — Individuals", "Información adicional — Individuos"),
      description: t(
        "Complete only if the taxpayer is an individual (persona natural). Skip this block for partnerships, corporations and LLCs.",
        "Complete solo si el contribuyente es un individuo (persona natural). Omita este bloque para sociedades, corporaciones y LLC."
      ),
      fields: [
        {
          id: "fecha_nac_dia",
          label: t("Birth date — day", "Fecha de nacimiento — día"),
          type: "text",
        },
        {
          id: "fecha_nac_mes",
          label: t("Birth date — month", "Fecha de nacimiento — mes"),
          type: "text",
        },
        {
          id: "fecha_nac_anio",
          label: t("Birth date — year", "Fecha de nacimiento — año"),
          type: "text",
        },
        {
          id: "lugar_nacimiento",
          label: t("Place of birth", "Lugar de nacimiento"),
          type: "text",
        },
        {
          id: "estado_civil",
          label: t("Marital status", "Estado civil"),
          type: "radio",
          options: [
            { value: "casado", label: t("Married", "Casado") },
            { value: "soltero", label: t("Single", "Soltero") },
          ],
        },
        {
          id: "numero_dependientes",
          label: t("Number of dependents", "Número de dependientes"),
          type: "number",
        },
        {
          id: "nombre_conyuge",
          label: t("Spouse's name", "Nombre del cónyuge"),
          type: "text",
          visibleWhen: [{ field: "estado_civil", operator: "eq", value: "casado" }],
        },
        {
          id: "ssn_conyuge",
          label: t("Spouse's social security number", "Número de seguro social del cónyuge"),
          type: "text",
          sensitive: true,
          transient: true,
          visibleWhen: [{ field: "estado_civil", operator: "eq", value: "casado" }],
        },
        {
          id: "tarjeta_residencia_num",
          label: t("Resident card number (foreign citizens)", "Número de tarjeta de residencia (ciudadanos extranjeros)"),
          type: "text",
        },
        {
          id: "tarjeta_residencia_fecha",
          label: t("Card issue date", "Fecha de expedido"),
          type: "date",
        },
        {
          id: "cert_naturalizacion_num",
          label: t("Naturalization certificate number", "Número de certificado de naturalización"),
          type: "text",
        },
        {
          id: "puerto_entrada",
          label: t("Port of entry", "Puerto de entrada"),
          type: "text",
        },
      ],
    },
    {
      id: "sociedades",
      title: t("Additional information — Partnerships & Corporations", "Información adicional — Sociedades y corporaciones"),
      description: t(
        "List the owners, partners or highest-ranking officers in Puerto Rico. The form prints three rows — use an additional sheet if there are more.",
        "Identifique los dueños, socios u oficiales de más alta jerarquía en Puerto Rico. El formulario trae tres líneas — use una hoja adicional si son más."
      ),
      fields: [
        {
          id: "duenos",
          label: t("Owners / officers", "Dueños / oficiales"),
          type: "repeatable",
          partyCollection: "officers",
          minimumItems: 1,
          maximumItems: 3,
          subFields: [
            { id: "nombre", label: t("Name", "Nombre"), type: "text", required: true, partyKey: "fullName" },
            { id: "titulo", label: t("Title", "Título"), type: "text", required: true, partyKey: "role" },
            { id: "ssn", label: t("Social security number", "Número de seguro social"), type: "text", required: true },
          ],
          helpText: t(
            "Social security numbers are typed only on the form and never stored.",
            "Los números de seguro social se escriben solo en el formulario y nunca se guardan."
          ),
        },
      ],
    },
    {
      id: "licencias",
      title: t("License(s) requested (Parte II)", "Licencia(s) que solicita (Parte II)"),
      description: t(
        "Mark every internal-revenue license this application covers. 'Bebidas alcohólicas' is pre-marked when your profile reports alcohol sales.",
        "Marque cada licencia de rentas internas que cubre esta solicitud. 'Bebidas alcohólicas' viene premarcada cuando su perfil reporta venta de alcohol."
      ),
      fields: [
        {
          id: "lic_bebidas",
          label: t("Alcoholic beverages", "Bebidas alcohólicas"),
          type: "checkbox",
          canonicalKey: "activities.alcoholSales",
        },
        {
          id: "lic_gasolina",
          label: t("Gasoline", "Gasolina"),
          type: "checkbox",
          canonicalKey: "activities.fuelSales",
        },
        {
          id: "lic_cigarrillos",
          label: t("Cigarettes", "Cigarrillos"),
          type: "checkbox",
          canonicalKey: "activities.cigaretteSales",
        },
        {
          id: "lic_cemento",
          label: t("Cement", "Cemento"),
          type: "checkbox",
        },
        {
          id: "lic_vehiculos",
          label: t("Motor vehicles", "Vehículos"),
          type: "checkbox",
        },
        {
          id: "lic_promotor",
          label: t("Public show promoter", "Promotor de espectáculos públicos"),
          type: "checkbox",
          canonicalKey: "activities.publicShowPromoter",
        },
        {
          id: "lic_metales",
          label: t("Purchase and sale of precious metals", "Compra y venta de metales preciosos"),
          type: "checkbox",
          canonicalKey: "activities.preciousMetals",
        },
        {
          id: "lic_armas",
          label: t("Firearms and ammunition", "Armas y municiones"),
          type: "checkbox",
          canonicalKey: "activities.weaponsSales",
        },
        {
          id: "lic_pasatiempo",
          label: t("Amusement machine operator", "Operador de máquinas de pasatiempo"),
          type: "checkbox",
        },
        {
          id: "lic_tragamonedas",
          label: t("Coin-operated machines (slot machines)", "Máquinas operadas con monedas (tragamonedas)"),
          type: "checkbox",
          canonicalKey: "activities.coinOperatedMachines",
        },
        {
          id: "tragamonedas_detalle",
          label: t("Slot machine detail", "Detalle de tragamonedas"),
          type: "text",
          visibleWhen: [{ field: "lic_tragamonedas", operator: "truthy" }],
          requiredWhen: [{ field: "lic_tragamonedas", operator: "truthy" }],
        },
        {
          id: "lic_aceite",
          label: t("Lubricating oil importer or manufacturer", "Importador o manufacturero de aceite lubricante"),
          type: "checkbox",
        },
        {
          id: "lic_puerto_libre",
          label: t("Free-port-zone store", "Tienda en zona de puerto libre"),
          type: "checkbox",
        },
        {
          id: "lic_portador",
          label: t("Air, maritime or land carrier", "Porteador aéreo, marítimo o terrestre"),
          type: "checkbox",
        },
        {
          id: "lic_otras",
          label: t("Other (specify)", "Otras (detalle)"),
          type: "checkbox",
        },
        {
          id: "otras_detalle",
          label: t("Other license — detail", "Otra licencia — detalle"),
          type: "text",
          visibleWhen: [{ field: "lic_otras", operator: "truthy" }],
          requiredWhen: [{ field: "lic_otras", operator: "truthy" }],
        },
        {
          id: "periodo",
          label: t("License period requested", "Período de licencia solicitado"),
          type: "radio",
          required: true,
          options: [
            { value: "corto", label: t("Short period", "Período corto") },
            { value: "largo", label: t("Long period", "Período largo") },
          ],
          helpText: t(
            "Pick short or long period when the request month does not match your account-number month — the instructions explain how each period is computed.",
            "Escoja período corto o largo cuando el mes de solicitud no corresponda al mes de su número de cuenta — las instrucciones explican cómo se computa cada período."
          ),
        },
        {
          id: "comentarios",
          label: t("Comments", "Comentarios"),
          type: "textarea",
        },
      ],
    },
    {
      id: "negocio",
      title: t("Business data (Parte III)", "Datos del negocio (Parte III)"),
      fields: [
        {
          id: "tiene_licencia",
          label: t("Does the business already hold a license issued by the Department of the Treasury?", "¿Posee su negocio una licencia emitida por el Departamento de Hacienda?"),
          type: "radio",
          required: true,
          options: [
            { value: "si", label: t("Yes", "Sí") },
            { value: "no", label: t("No", "No") },
          ],
        },
        {
          id: "numeros_licencias",
          label: t("License numbers held", "Números de licencias que posee"),
          type: "text",
          visibleWhen: [{ field: "tiene_licencia", operator: "eq", value: "si" }],
          requiredWhen: [{ field: "tiene_licencia", operator: "eq", value: "si" }],
        },
        {
          id: "cant_billar",
          label: t("Physical equipment — billiards (quantity)", "Equipo físico — billar (cantidad)"),
          type: "number",
        },
        {
          id: "cant_entretenimiento",
          label: t("Physical equipment — amusement machines (quantity)", "Equipo físico — máquinas de entretenimiento (cantidad)"),
          type: "number",
        },
        {
          id: "cant_vellonera",
          label: t("Physical equipment — jukeboxes (quantity)", "Equipo físico — vellonera (cantidad)"),
          type: "number",
        },
        {
          id: "otros_equipo_detalle",
          label: t("Other equipment — describe", "Otros equipos — indique cuáles"),
          type: "text",
        },
        {
          id: "otros_equipo_cantidad",
          label: t("Other equipment — quantity", "Otros equipos — cantidad"),
          type: "number",
        },
        {
          id: "cerca_escuela_iglesia",
          label: t("Is the business within 100 meters of a school or church?", "¿Se encuentra su negocio a menos de 100 metros de una escuela o iglesia?"),
          type: "radio",
          required: true,
          options: [
            { value: "si", label: t("Yes", "Sí") },
            { value: "no", label: t("No", "No") },
          ],
        },
        {
          id: "distancia_metros",
          label: t("Distance to the nearest one (meters)", "Distancia del punto más cercano (metros)"),
          type: "number",
          visibleWhen: [{ field: "cerca_escuela_iglesia", operator: "eq", value: "si" }],
          requiredWhen: [{ field: "cerca_escuela_iglesia", operator: "eq", value: "si" }],
        },
        {
          id: "escuela_num_estudiantes",
          label: t("School — number of students", "Escuela — número de estudiantes"),
          type: "number",
          visibleWhen: [{ field: "cerca_escuela_iglesia", operator: "eq", value: "si" }],
        },
        {
          id: "escuela_edad_promedio",
          label: t("School — average age", "Escuela — edad promedio"),
          type: "number",
          visibleWhen: [{ field: "cerca_escuela_iglesia", operator: "eq", value: "si" }],
        },
        {
          id: "escuela_grados",
          label: t("School — grades", "Escuela — grados"),
          type: "text",
          visibleWhen: [{ field: "cerca_escuela_iglesia", operator: "eq", value: "si" }],
        },
        {
          id: "escuela_horarios",
          label: t("School — class hours", "Escuela — horarios de clases"),
          type: "text",
          visibleWhen: [{ field: "cerca_escuela_iglesia", operator: "eq", value: "si" }],
        },
        {
          id: "iglesia_num_feligreses",
          label: t("Church — number of parishioners", "Iglesia — número de feligreses"),
          type: "number",
          visibleWhen: [{ field: "cerca_escuela_iglesia", operator: "eq", value: "si" }],
        },
        {
          id: "iglesia_dias_servicio",
          label: t("Church — service days", "Iglesia — días de servicio"),
          type: "text",
          visibleWhen: [{ field: "cerca_escuela_iglesia", operator: "eq", value: "si" }],
        },
        {
          id: "iglesia_horarios",
          label: t("Church — service hours", "Iglesia — horarios de servicios"),
          type: "text",
          visibleWhen: [{ field: "cerca_escuela_iglesia", operator: "eq", value: "si" }],
        },
      ],
    },
    {
      id: "jurada",
      title: t("Sworn declaration (Parte IV)", "Declaración jurada (Parte IV)"),
      description: t(
        "The declaration is printed on the form — you sign it under oath before a notary public or authorized public official. SmartPR prints your name, title and date; the signature line itself stays blank for your hand.",
        "La declaración va impresa en el formulario — usted la firma bajo juramento ante un notario público o funcionario público autorizado. SmartPR imprime su nombre, título y fecha; la línea de firma queda en blanco para firmarla a mano."
      ),
      fields: [
        {
          id: "declaracion_texto",
          type: "statutory_text",
          body: t(
            "The declarant swears, under penalty of perjury: (1) they have not been convicted in or outside Puerto Rico of a felony, drug/controlled-substance or weapons trafficking, or the offenses listed in the form; (2) the information in the application and its annexes is complete and truthful, and the license may be suspended or revoked for noncompliance; (3) they submit subject to the perjury penalties of Article 274 of the Puerto Rico Penal Code and the Internal Revenue Code.",
            "El declarante jura, so pena de perjurio: (1) no haber sido convicto, en o fuera de Puerto Rico, de delito grave, tráfico de drogas, sustancias controladas o armas y municiones, ni de los delitos que lista el formulario; (2) que la información de la solicitud y sus anejos es completa y verídica, y que la licencia puede ser suspendida o revocada por incumplimiento; (3) que se somete a las penalidades del delito de perjurio del Artículo 274 del Código Penal y del Código de Rentas Internas."
          ),
        },
        {
          id: "declarante_nombre",
          label: t("Declarant name (printed)", "Nombre del declarante (en letra de molde)"),
          type: "text",
          required: true,
          canonicalKey: "contact.fullName",
          helpText: t(
            "Printed on the 'Nombre' line. Prefilled from your SmartPR profile.",
            "Se imprime en la línea 'Nombre'. Precargado desde su perfil de SmartPR."
          ),
        },
        {
          id: "declarante_titulo",
          label: t("Declarant title", "Título del declarante"),
          type: "text",
          required: true,
          helpText: t(
            "Your title — e.g. president, managing partner, owner.",
            "Su título — p. ej. presidente, socio gestor, dueño."
          ),
        },
        {
          id: "declarante_fecha",
          label: t("Date of signing", "Fecha de la firma"),
          type: "date",
          required: true,
          helpText: t(
            "Printed on the 'Fecha' line. This is the date you sign before the notary.",
            "Se imprime en la línea 'Fecha'. Es la fecha en que firma ante el notario."
          ),
        },
        {
          id: "juramento",
          label: t(
            "I declare under oath that the information in this application is complete and truthful, and I understand the license may be suspended or revoked for noncompliance.",
            "Declaro bajo juramento que la información de esta solicitud es completa y verídica, y entiendo que la licencia puede ser suspendida o revocada por incumplimiento."
          ),
          type: "attestation",
          required: true,
        },
        {
          id: "firma_aviso",
          label: t(
            "I understand the 'Firma' line must be signed by hand on the printed form and that SmartPR leaves it blank.",
            "Entiendo que la línea 'Firma' debe firmarse a mano en el formulario impreso y que SmartPR la deja en blanco."
          ),
          type: "attestation",
          required: true,
        },
      ],
    },
  ],
  notices: [
    t(
      "Sign the 'Firma' line by hand on the printed form, in front of a notary public or authorized public official — the 'Jurado y suscrito ante mí' block and the affidavit number are completed by them at signing, and SmartPR leaves that whole block blank.",
      "Firme la línea 'Firma' a mano en el formulario impreso, ante un notario público o funcionario público autorizado — el bloque 'Jurado y suscrito ante mí' y el número de affidávit los completa esa persona al momento de la firma, y SmartPR deja todo ese bloque en blanco."
    ),
    t(
      "Hacienda still publishes Modelo SC 2309 as the form to complete for internal-revenue licenses, and directs every license type to it (verified 2026-09-12). License applications and renewals are also handled through SURI (suri.hacienda.pr.gov) — confirm the filing route for your license type with Hacienda or your district office.",
      "Hacienda todavía publica el Modelo SC 2309 como el formulario a completar para las licencias de rentas internas, y dirige cada tipo de licencia a este formulario (verificado el 2026-09-12). Las solicitudes y renovaciones también se manejan por SURI (suri.hacienda.pr.gov) — confirme la vía de radicación para su tipo de licencia con Hacienda o su oficina de distrito."
    ),
    t(
      "Attach the documents Hacienda requires for your license type — merchant registration, municipal patente, CRIM negative debt certification, use permit, and the activity-specific documents listed on the form's instruction pages.",
      "Acompañe los documentos que Hacienda exige para su tipo de licencia — registro de comerciante, patente municipal, certificación negativa de deudas del CRIM, permiso de uso y los documentos específicos de la actividad que listan las páginas de instrucciones del formulario."
    ),
  ],
  feeMetadata: {
    source: t(
      "Modelo SC 2309 prints no fee. License fees (derechos) are assessed by Hacienda and prorated from issuance to the next due date based on the last digit of the account number, per the form's instructions — confirm the amount with Hacienda.",
      "El Modelo SC 2309 no tiene tarifa impresa. Los derechos de licencia los fija Hacienda y se prorratean desde la expedición hasta el próximo vencimiento según el último dígito del número de cuenta, según las instrucciones del formulario — confirme el monto con Hacienda."
    ),
    requiresPortalVerification: true,
  },
};
