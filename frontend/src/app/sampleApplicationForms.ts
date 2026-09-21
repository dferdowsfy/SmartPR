import { jsPDF } from "jspdf";

export type SampleFormValue = string | boolean;
export type SampleFormData = Record<string, SampleFormValue>;

export interface SampleFormOption {
  value: string;
  label: string;
  /** Puerto Rican Spanish label, used when the worksheet renders in Spanish. */
  labelEs?: string;
}

export interface SampleFormField {
  key: string;
  label: string;
  type: "text" | "textarea" | "date" | "number" | "email" | "tel" | "select" | "checkbox";
  required?: boolean;
  placeholder?: string;
  help?: string;
  options?: SampleFormOption[];
  profileKey?: "name" | "municipality" | "business_structure" | "number_of_employees"
    | "trade_name" | "ein" | "email" | "phone" | "naics_code"
    | "physical_address" | "mailing_address" | "contact_name" | "contact_email" | "contact_phone";
  /** Puerto Rican Spanish variants, used when the worksheet renders in Spanish. */
  labelEs?: string;
  placeholderEs?: string;
  helpEs?: string;
}

export interface SampleFormSection {
  title: string;
  /** Puerto Rican Spanish title, used when the worksheet renders in Spanish. */
  titleEs?: string;
  fields: SampleFormField[];
}

export type SampleApplicationLayout = "worksheet" | "letter";

export interface SampleApplicationDefinition {
  requirementCode: string;
  title: string;
  agency: string;
  description: string;
  officialOutput: string;
  filename: string;
  sections: SampleFormSection[];
  /**
   * "worksheet" renders the classic field-list preparation PDF.
   * "letter" renders a formal letter with the field values merged into the
   * body text plus blank signature/notary blocks (never pre-filled).
   */
  layout?: SampleApplicationLayout;
  /** Modal kicker override (e.g. "Supporting document" for the admin letter). */
  kicker?: string;
  /** Puerto Rican Spanish variants, used when the worksheet renders in Spanish. */
  titleEs?: string;
  descriptionEs?: string;
  kickerEs?: string;
}

export interface PreparedSampleApplication {
  requirementCode: string;
  title: string;
  filename: string;
  preparedAt: string;
  data: SampleFormData;
}

export interface PrefillProfile {
  name?: string;
  municipality?: string;
  business_structure?: string;
  number_of_employees?: number | null;
  trade_name?: string;
  ein?: string;
  email?: string;
  phone?: string;
  naics_code?: string;
  physical_address?: string;
  mailing_address?: string;
  contact_name?: string;
  contact_email?: string;
  contact_phone?: string;
}

const ENTITY_OPTIONS: SampleFormOption[] = [
  { value: "llc", label: "Limited Liability Company (LLC)" },
  { value: "corporation", label: "Corporation" },
  { value: "sole_proprietorship", label: "Sole Proprietorship" },
  { value: "partnership", label: "Partnership" },
  { value: "professional_corporation", label: "Professional Corporation" },
  { value: "other", label: "Other" },
];

const YES_NO: SampleFormOption[] = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];

const YES_NO_UNSURE: SampleFormOption[] = [
  ...YES_NO,
  { value: "unsure", label: "Not sure" },
];

const YES_NO_NA: SampleFormOption[] = [
  ...YES_NO,
  { value: "na", label: "Not applicable" },
];

export const SAMPLE_APPLICATIONS: Record<string, SampleApplicationDefinition> = {
  certificate_of_incorporation: {
    requirementCode: "certificate_of_incorporation",
    title: "Certificate of Incorporation Filing Worksheet",
    agency: "Puerto Rico Department of State",
    description: "SmartPR worksheet gathering the information for an entity filing, pre-filled from your business profile.",
    officialOutput: "Certificate of Incorporation issued by the Puerto Rico Department of State",
    filename: "01_Certificate_of_Incorporation_Filing_Worksheet.pdf",
    sections: [
      {
        title: "Entity information",
        fields: [
          { key: "legal_name", label: "Proposed legal entity name", type: "text", required: true, profileKey: "name" },
          { key: "entity_type", label: "Entity type", type: "select", required: true, profileKey: "business_structure", options: ENTITY_OPTIONS },
          { key: "principal_address", label: "Principal office address", type: "textarea", required: true },
          { key: "mailing_address", label: "Mailing address", type: "textarea", profileKey: "mailing_address"},
          { key: "business_purpose", label: "Business purpose", type: "textarea", required: true, placeholder: "Describe the primary purpose of the business." },
        ],
      },
      {
        title: "Registered agent and organizer",
        fields: [
          { key: "registered_agent_name", label: "Registered agent name", type: "text", required: true },
          { key: "registered_agent_address", label: "Registered agent physical address", type: "textarea", required: true },
          { key: "organizer_name", label: "Organizer / incorporator name", type: "text", required: true },
          { key: "organizer_email", label: "Organizer email", type: "email", required: true },
          { key: "effective_date", label: "Requested effective date", type: "date" },
        ],
      },
    ],
  },
  merchant_registration: {
    requirementCode: "merchant_registration",
    title: "Merchant Registration Application Worksheet",
    agency: "Puerto Rico Department of Treasury (Hacienda / SURI)",
    description: "SmartPR worksheet gathering merchant registration information, pre-filled from your business profile.",
    officialOutput: "Merchant Registration Certificate issued through SURI",
    filename: "02_Merchant_Registration_Application_Worksheet.pdf",
    sections: [
      {
        title: "Business and tax identity",
        fields: [
          { key: "legal_name", label: "Legal business name", type: "text", required: true, profileKey: "name" },
          { key: "trade_name", label: "Trade name / DBA", type: "text", profileKey: "trade_name"},
          { key: "entity_type", label: "Entity type", type: "select", required: true, profileKey: "business_structure", options: ENTITY_OPTIONS },
          { key: "ein", label: "Federal EIN", type: "text", required: true, placeholder: "XX-XXXXXXX" , profileKey: "ein"},
          { key: "naics_code", label: "NAICS code", type: "text", profileKey: "naics_code"},
          { key: "business_activity", label: "Primary business activity", type: "textarea", required: true },
        ],
      },
      {
        title: "Operations",
        fields: [
          { key: "physical_address", label: "Physical business address", type: "textarea", required: true , profileKey: "physical_address"},
          { key: "municipality", label: "Municipality", type: "text", required: true, profileKey: "municipality" },
          { key: "operations_start_date", label: "Operations start date", type: "date", required: true },
          { key: "employee_count", label: "Number of employees", type: "number", profileKey: "number_of_employees" },
          { key: "contact_name", label: "Responsible contact", type: "text", required: true , profileKey: "contact_name"},
          { key: "contact_email", label: "Contact email", type: "email", required: true },
          { key: "taxable_sales", label: "Will the business make taxable sales?", type: "select", required: true, options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }, { value: "unsure", label: "Not sure" }] },
        ],
      },
    ],
  },
  permiso_unico: {
    requirementCode: "permiso_unico",
    kicker: "Preparation checklist",
    kickerEs: "Lista de preparación",
    title: "OGPe Permiso Único — Use / Occupancy Prep Checklist",
    titleEs: "OGPe Permiso Único — Lista de preparación de uso / ocupación",
    agency: "Office of Permit Management (OGPe) — Gobierno de Puerto Rico",
    description: "SmartPR prep pack for the Permiso Único / use-occupancy path. Filing is 100% electronic via OGPe's Single Business Portal (ogpe.pr.gov) — there is no standalone downloadable application. Use this bilingual checklist to assemble passport identity, property facts, and supporting evidence tagged in the Evidence locker (DOC_PERMISO_UNICO and related DOC_* codes). Never present this checklist as an official OGPe form.",
    descriptionEs: "Paquete de preparación de SmartPR para el Permiso Único / ruta de uso-ocupación. La radicación es 100% electrónica por el Portal Único de Negocios de OGPe (ogpe.pr.gov) — no hay solicitud descargable. Usa esta lista bilingüe para reunir la identidad del pasaporte, datos de la propiedad y evidencia de apoyo etiquetada en el Evidence locker (DOC_PERMISO_UNICO y códigos DOC_* relacionados). Nunca presentes esta lista como un formulario oficial de OGPe.",
    officialOutput: "Permiso Único issued by OGPe or the authorized municipality",
    filename: "03_OGPe_Permiso_Unico_Prep_Checklist.pdf",
    sections: [
      {
        title: "Applicant identity (Business Passport)",
        titleEs: "Identidad del solicitante (Pasaporte de negocio)",
        fields: [
          {
            key: "legal_name", label: "Legal business name", labelEs: "Nombre legal del negocio",
            type: "text", required: true, profileKey: "name",
            help: "Prefills from the Business Passport when available.",
            helpEs: "Se prellena desde el Pasaporte de negocio cuando está disponible.",
          },
          {
            key: "trade_name", label: "Trade name / DBA", labelEs: "Nombre comercial / DBA",
            type: "text", profileKey: "trade_name",
          },
          {
            key: "ein", label: "Federal EIN", labelEs: "EIN federal",
            type: "text", placeholder: "XX-XXXXXXX", placeholderEs: "XX-XXXXXXX", profileKey: "ein",
          },
          {
            key: "entity_type", label: "Entity type", labelEs: "Tipo de entidad",
            type: "select", profileKey: "business_structure", options: ENTITY_OPTIONS,
          },
          {
            key: "applicant_name", label: "Applicant / authorized representative", labelEs: "Solicitante / representante autorizado",
            type: "text", required: true, profileKey: "contact_name",
          },
          {
            key: "applicant_email", label: "Applicant email", labelEs: "Correo del solicitante",
            type: "email", required: true, profileKey: "contact_email",
          },
          {
            key: "applicant_phone", label: "Applicant phone", labelEs: "Teléfono del solicitante",
            type: "tel", required: true, profileKey: "contact_phone",
          },
        ],
      },
      {
        title: "Location & use / occupancy",
        titleEs: "Localización y uso / ocupación",
        fields: [
          {
            key: "business_address", label: "Business location address", labelEs: "Dirección del local",
            type: "textarea", required: true, profileKey: "physical_address",
          },
          {
            key: "municipality", label: "Municipality", labelEs: "Municipio",
            type: "text", required: true, profileKey: "municipality",
          },
          {
            key: "cadastral_number", label: "Property cadastral number (catastro)", labelEs: "Número catastral de la propiedad",
            type: "text",
            help: "Often required inside the OGPe portal for the premises.",
            helpEs: "A menudo se exige dentro del portal de OGPe para el local.",
          },
          {
            key: "property_owner", label: "Property owner", labelEs: "Dueño de la propiedad",
            type: "text", required: true,
          },
          {
            key: "proposed_use", label: "Proposed business use", labelEs: "Uso propuesto del negocio",
            type: "textarea", required: true,
          },
          {
            key: "occupancy_description", label: "Occupancy / space description", labelEs: "Descripción de ocupación / espacio",
            type: "textarea", required: true,
          },
          {
            key: "square_footage", label: "Approximate square footage", labelEs: "Área aproximada (pies cuadrados)",
            type: "number",
          },
          {
            key: "employee_count", label: "Number of employees", labelEs: "Número de empleados",
            type: "number", profileKey: "number_of_employees",
          },
          {
            key: "food_service", label: "Food preparation or service", labelEs: "Preparación o servicio de alimentos",
            type: "select", required: true,
            options: [
              { value: "yes", label: "Yes", labelEs: "Sí" },
              { value: "no", label: "No", labelEs: "No" },
            ],
            help: "If yes, also complete the Salud sanitary prep pack (DOC_HEALTH_PERMIT).",
            helpEs: "Si es sí, completa también el paquete de preparación sanitaria de Salud (DOC_HEALTH_PERMIT).",
          },
          {
            key: "alcohol_sales", label: "Alcohol sales or service", labelEs: "Venta o servicio de alcohol",
            type: "select", required: true,
            options: [
              { value: "yes", label: "Yes", labelEs: "Sí" },
              { value: "no", label: "No", labelEs: "No" },
            ],
          },
          {
            key: "construction_changes", label: "Construction, renovation, or change of use planned", labelEs: "Construcción, renovación o cambio de uso planificado",
            type: "select", required: true,
            options: [
              { value: "yes", label: "Yes", labelEs: "Sí" },
              { value: "no", label: "No", labelEs: "No" },
              { value: "unsure", label: "Not sure", labelEs: "No estoy seguro/a" },
            ],
          },
        ],
      },
      {
        title: "Supporting evidence checklist (Evidence locker tags)",
        titleEs: "Lista de evidencia de apoyo (etiquetas del Evidence locker)",
        fields: [
          {
            key: "doc_lease", label: "Lease / property control evidence ready — locker tag DOC_LEASE_AGREEMENT",
            labelEs: "Evidencia de arrendamiento / control de la propiedad lista — etiqueta DOC_LEASE_AGREEMENT",
            type: "checkbox", required: true,
            help: "Upload once to the Evidence locker and tag DOC_LEASE_AGREEMENT (and DOC_PERMISO_UNICO if the same file supports both).",
            helpEs: "Súbelo una vez al Evidence locker y etiquétalo DOC_LEASE_AGREEMENT (y DOC_PERMISO_UNICO si el mismo archivo sirve para ambos).",
          },
          {
            key: "doc_floor_plans", label: "Floor plans / site layout ready — locker tag DOC_FLOOR_PLANS",
            labelEs: "Planos / distribución del local listos — etiqueta DOC_FLOOR_PLANS",
            type: "checkbox", required: true,
          },
          {
            key: "doc_zoning", label: "Zoning / use certification assembled or pending in portal — locker tag DOC_ZONING",
            labelEs: "Certificación de zonificación / uso reunida o pendiente en el portal — etiqueta DOC_ZONING",
            type: "checkbox",
          },
          {
            key: "doc_occupancy", label: "Occupancy facts ready for portal entry — locker tag DOC_OCCUPANCY",
            labelEs: "Datos de ocupación listos para el portal — etiqueta DOC_OCCUPANCY",
            type: "checkbox",
          },
          {
            key: "doc_merchant_reg", label: "Hacienda merchant registration on hand — locker tag DOC_MERCHANT_REGISTRATION",
            labelEs: "Registro de comerciante de Hacienda a la mano — etiqueta DOC_MERCHANT_REGISTRATION",
            type: "checkbox", required: true,
          },
          {
            key: "doc_entity", label: "Entity formation / good standing on hand — locker tag DOC_CERT_INCORPORATION",
            labelEs: "Formación de entidad / good standing a la mano — etiqueta DOC_CERT_INCORPORATION",
            type: "checkbox", required: true,
          },
          {
            key: "portal_ack", label: "I will file in OGPe's Single Business Portal (ogpe.pr.gov) — SmartPR does not e-file",
            labelEs: "Radicaré en el Portal Único de Negocios de OGPe (ogpe.pr.gov) — SmartPR no radica electrónicamente",
            type: "checkbox", required: true,
            help: "After the agency issues the Permiso Único, upload it and tag DOC_PERMISO_UNICO in the Evidence locker.",
            helpEs: "Después de que la agencia emita el Permiso Único, súbelo y etiquétalo DOC_PERMISO_UNICO en el Evidence locker.",
          },
        ],
      },
    ],
  },
  health_permit: {
    requirementCode: "health_permit",
    kicker: "Preparation checklist",
    kickerEs: "Lista de preparación",
    title: "Departamento de Salud — Sanitary / Food-Establishment Prep Checklist",
    titleEs: "Departamento de Salud — Lista de preparación sanitaria / establecimiento de alimentos",
    agency: "Puerto Rico Department of Health (Departamento de Salud)",
    description: "SmartPR prep pack for sanitary / food-establishment style Health Permit work. The Licencia Sanitaria endorsement is typically processed inside OGPe's Permiso Único (Secretaría Auxiliar de Salud Ambiental) — there is no standalone downloadable Salud application in SmartPR's library. Use this bilingual checklist when DOC_HEALTH_PERMIT (and related Salud docs such as DOC_CFPM) apply. Tag supporting files in the Evidence locker. Never present this checklist as an official Salud form.",
    descriptionEs: "Paquete de preparación de SmartPR para el permiso sanitario / de establecimiento de alimentos. El endoso de Licencia Sanitaria suele tramitarse dentro del Permiso Único de OGPe (Secretaría Auxiliar de Salud Ambiental) — no hay solicitud descargable de Salud en la biblioteca de SmartPR. Usa esta lista bilingüe cuando apliquen DOC_HEALTH_PERMIT (y documentos relacionados de Salud como DOC_CFPM). Etiqueta los archivos de apoyo en el Evidence locker. Nunca presentes esta lista como un formulario oficial de Salud.",
    officialOutput: "Health / Sanitary Permit issued by the Department of Health (often via OGPe Permiso Único)",
    filename: "04_Salud_Sanitary_Permit_Prep_Checklist.pdf",
    sections: [
      {
        title: "Establishment identity (Business Passport)",
        titleEs: "Identidad del establecimiento (Pasaporte de negocio)",
        fields: [
          {
            key: "legal_name", label: "Legal business name", labelEs: "Nombre legal del negocio",
            type: "text", required: true, profileKey: "name",
          },
          {
            key: "trade_name", label: "Trade name / DBA", labelEs: "Nombre comercial / DBA",
            type: "text", profileKey: "trade_name",
          },
          {
            key: "physical_address", label: "Establishment address", labelEs: "Dirección del establecimiento",
            type: "textarea", required: true, profileKey: "physical_address",
          },
          {
            key: "municipality", label: "Municipality", labelEs: "Municipio",
            type: "text", required: true, profileKey: "municipality",
          },
          {
            key: "phone", label: "Establishment phone", labelEs: "Teléfono del establecimiento",
            type: "tel", required: true, profileKey: "phone",
          },
          {
            key: "email", label: "Contact email", labelEs: "Correo de contacto",
            type: "email", required: true, profileKey: "email",
          },
          {
            key: "contact_name", label: "Responsible contact", labelEs: "Contacto responsable",
            type: "text", required: true, profileKey: "contact_name",
          },
        ],
      },
      {
        title: "Food / sanitary operation",
        titleEs: "Operación alimentaria / sanitaria",
        fields: [
          {
            key: "operation_type", label: "Type of food / sanitary operation", labelEs: "Tipo de operación alimentaria / sanitaria",
            type: "select", required: true,
            options: [
              { value: "restaurant", label: "Restaurant", labelEs: "Restaurante" },
              { value: "cafeteria", label: "Cafeteria", labelEs: "Cafetería" },
              { value: "bar_food", label: "Bar with food service", labelEs: "Bar con servicio de alimentos" },
              { value: "bakery", label: "Bakery", labelEs: "Panadería" },
              { value: "food_truck", label: "Food truck / mobile unit", labelEs: "Food truck / unidad móvil" },
              { value: "catering", label: "Catering", labelEs: "Catering" },
              { value: "grocery", label: "Grocery / colmado", labelEs: "Colmado / tienda de viveres" },
              { value: "other", label: "Other", labelEs: "Otro" },
            ],
            help: "Only complete this pack when rules already surface DOC_HEALTH_PERMIT for your business type.",
            helpEs: "Completa este paquete solo cuando las reglas ya muestren DOC_HEALTH_PERMIT para tu tipo de negocio.",
          },
          {
            key: "seating_capacity", label: "Seating capacity", labelEs: "Capacidad de asientos",
            type: "number",
          },
          {
            key: "hours", label: "Hours of operation", labelEs: "Horario de operación",
            type: "text", required: true, placeholder: "e.g. Mon–Sat 11am–10pm", placeholderEs: "p. ej. Lun–Sáb 11am–10pm",
          },
          {
            key: "water_source", label: "Water source", labelEs: "Fuente de agua",
            type: "select", required: true,
            options: [
              { value: "aaa", label: "AAA (public water authority)", labelEs: "AAA (acueductos públicos)" },
              { value: "private_well", label: "Private well", labelEs: "Pozo privado" },
              { value: "other", label: "Other", labelEs: "Otro" },
            ],
          },
          {
            key: "sewage", label: "Sewage disposal", labelEs: "Disposición de aguas usadas",
            type: "select", required: true,
            options: [
              { value: "aaa_sewer", label: "AAA sewer system", labelEs: "Alcantarillado AAA" },
              { value: "septic", label: "Septic tank", labelEs: "Fosa séptica" },
              { value: "other", label: "Other", labelEs: "Otro" },
            ],
          },
          {
            key: "grease_trap", label: "Grease trap / interceptor installed", labelEs: "Trampa de grasa / interceptor instalado",
            type: "select", required: true,
            options: [
              { value: "yes", label: "Yes", labelEs: "Sí" },
              { value: "no", label: "No", labelEs: "No" },
              { value: "unsure", label: "Not sure", labelEs: "No estoy seguro/a" },
            ],
          },
          {
            key: "food_handlers", label: "Number of food handlers", labelEs: "Número de manipuladores de alimentos",
            type: "number", required: true,
          },
          {
            key: "manager_certified", label: "Certified food protection manager on staff", labelEs: "Gerente certificado en protección de alimentos en el personal",
            type: "select", required: true,
            options: [
              { value: "yes", label: "Yes", labelEs: "Sí" },
              { value: "no", label: "No", labelEs: "No" },
              { value: "unsure", label: "Not sure", labelEs: "No estoy seguro/a" },
            ],
            help: "When required, gather CFPM evidence and tag DOC_CFPM in the Evidence locker.",
            helpEs: "Cuando se exija, reúne la evidencia de CFPM y etiquétala DOC_CFPM en el Evidence locker.",
          },
        ],
      },
      {
        title: "Supporting evidence checklist (Evidence locker tags)",
        titleEs: "Lista de evidencia de apoyo (etiquetas del Evidence locker)",
        fields: [
          {
            key: "doc_cfpm", label: "Food protection manager certificate ready — locker tag DOC_CFPM",
            labelEs: "Certificado de gerente de protección de alimentos listo — etiqueta DOC_CFPM",
            type: "checkbox",
            help: "Gate: only when your checklist already includes DOC_CFPM / food-manager requirements.",
            helpEs: "Condición: solo cuando tu lista ya incluye DOC_CFPM / requisitos de gerente de alimentos.",
          },
          {
            key: "doc_floor_plans", label: "Kitchen / establishment floor plan ready — locker tag DOC_FLOOR_PLANS",
            labelEs: "Plano de cocina / establecimiento listo — etiqueta DOC_FLOOR_PLANS",
            type: "checkbox", required: true,
          },
          {
            key: "doc_lease", label: "Lease / premises control ready — locker tag DOC_LEASE_AGREEMENT",
            labelEs: "Arrendamiento / control del local listo — etiqueta DOC_LEASE_AGREEMENT",
            type: "checkbox", required: true,
          },
          {
            key: "doc_permiso_context", label: "Permiso Único / OGPe path in progress — related tag DOC_PERMISO_UNICO",
            labelEs: "Ruta de Permiso Único / OGPe en progreso — etiqueta relacionada DOC_PERMISO_UNICO",
            type: "checkbox",
            help: "Sanitary endorsement is commonly requested with each Permiso Único filing or renewal.",
            helpEs: "El endoso sanitario suele pedirse con cada radicación o renovación del Permiso Único.",
          },
          {
            key: "doc_merchant_reg", label: "Hacienda merchant registration on hand — locker tag DOC_MERCHANT_REGISTRATION",
            labelEs: "Registro de comerciante de Hacienda a la mano — etiqueta DOC_MERCHANT_REGISTRATION",
            type: "checkbox", required: true,
          },
          {
            key: "portal_ack", label: "I will complete Salud endorsement via the agency / OGPe portal — SmartPR does not e-file",
            labelEs: "Completaré el endoso de Salud por el portal de la agencia / OGPe — SmartPR no radica electrónicamente",
            type: "checkbox", required: true,
            help: "After issuance, upload the Health / Sanitary Permit and tag DOC_HEALTH_PERMIT.",
            helpEs: "Después de emitido, sube el Permiso de Salud / Sanitario y etiquétalo DOC_HEALTH_PERMIT.",
          },
        ],
      },
    ],
  },
  fire_certification: {
    requirementCode: "fire_certification",
    kicker: "Preparation checklist",
    kickerEs: "Lista de preparación",
    title: "Cuerpo de Bomberos — Fire-Safety Inspection Prep Checklist",
    titleEs: "Cuerpo de Bomberos — Lista de preparación para inspección de prevención",
    agency: "Puerto Rico Fire Bureau (Cuerpo de Bomberos de Puerto Rico)",
    description: "SmartPR prep pack for fire-safety inspection readiness. The Certificación de Prevención de Incendios (CPI) is processed through OGPe; an inspection by the Cuerpo de Bomberos underlies it. There is no standalone downloadable Bomberos application in SmartPR's library. Use this bilingual checklist to prepare premises facts and supporting evidence tagged DOC_FIRE_CERT (and related DOC_* codes) in the Evidence locker. Never present this checklist as an official Bomberos form.",
    descriptionEs: "Paquete de preparación de SmartPR para la inspección de prevención de incendios. La Certificación de Prevención de Incendios (CPI) se tramita por OGPe; la inspección del Cuerpo de Bomberos la sustenta. No hay solicitud descargable de Bomberos en la biblioteca de SmartPR. Usa esta lista bilingüe para preparar los datos del local y la evidencia etiquetada DOC_FIRE_CERT (y códigos DOC_* relacionados) en el Evidence locker. Nunca presentes esta lista como un formulario oficial de Bomberos.",
    officialOutput: "Fire Safety Certification / CPI issued via Bomberos inspection and OGPe processing",
    filename: "05_Bomberos_Fire_Safety_Prep_Checklist.pdf",
    sections: [
      {
        title: "Premises identity (Business Passport)",
        titleEs: "Identidad del local (Pasaporte de negocio)",
        fields: [
          {
            key: "legal_name", label: "Legal business name", labelEs: "Nombre legal del negocio",
            type: "text", required: true, profileKey: "name",
          },
          {
            key: "physical_address", label: "Premises address", labelEs: "Dirección del local",
            type: "textarea", required: true, profileKey: "physical_address",
          },
          {
            key: "municipality", label: "Municipality", labelEs: "Municipio",
            type: "text", required: true, profileKey: "municipality",
          },
          {
            key: "contact_name", label: "On-site contact for inspection", labelEs: "Contacto en el local para la inspección",
            type: "text", required: true, profileKey: "contact_name",
          },
          {
            key: "contact_phone", label: "Contact phone", labelEs: "Teléfono de contacto",
            type: "tel", required: true, profileKey: "contact_phone",
          },
          {
            key: "contact_email", label: "Contact email", labelEs: "Correo de contacto",
            type: "email", required: true, profileKey: "contact_email",
          },
        ],
      },
      {
        title: "Occupancy & fire protection",
        titleEs: "Ocupación y protección contra incendios",
        fields: [
          {
            key: "occupancy_use", label: "Occupancy / use of premises", labelEs: "Ocupación / uso del local",
            type: "select", required: true,
            options: [
              { value: "restaurant", label: "Restaurant / food service", labelEs: "Restaurante / servicio de alimentos" },
              { value: "retail", label: "Retail", labelEs: "Comercio al detal" },
              { value: "office", label: "Office", labelEs: "Oficina" },
              { value: "warehouse", label: "Warehouse / storage", labelEs: "Almacén / almacenamiento" },
              { value: "assembly", label: "Assembly / entertainment", labelEs: "Asamblea / entretenimiento" },
              { value: "industrial", label: "Industrial", labelEs: "Industrial" },
              { value: "other", label: "Other", labelEs: "Otro" },
            ],
          },
          {
            key: "square_footage", label: "Approximate square footage", labelEs: "Área aproximada (pies cuadrados)",
            type: "number", required: true,
          },
          {
            key: "stories", label: "Number of stories", labelEs: "Número de pisos",
            type: "number",
          },
          {
            key: "occupant_load", label: "Maximum occupant load", labelEs: "Carga máxima de ocupantes",
            type: "number",
          },
          {
            key: "extinguishers", label: "Portable fire extinguishers on site", labelEs: "Extintores portátiles en el local",
            type: "select", required: true,
            options: [
              { value: "yes", label: "Yes", labelEs: "Sí" },
              { value: "no", label: "No", labelEs: "No" },
            ],
          },
          {
            key: "alarm_system", label: "Fire alarm / detection system", labelEs: "Sistema de alarma / detección de incendios",
            type: "select", required: true,
            options: [
              { value: "yes", label: "Yes", labelEs: "Sí" },
              { value: "no", label: "No", labelEs: "No" },
            ],
          },
          {
            key: "sprinklers", label: "Automatic sprinkler system", labelEs: "Sistema automático de rociadores",
            type: "select", required: true,
            options: [
              { value: "yes", label: "Yes", labelEs: "Sí" },
              { value: "no", label: "No", labelEs: "No" },
            ],
          },
          {
            key: "emergency_lighting", label: "Emergency lighting and exit signage", labelEs: "Iluminación de emergencia y rótulos de salida",
            type: "select", required: true,
            options: [
              { value: "yes", label: "Yes", labelEs: "Sí" },
              { value: "no", label: "No", labelEs: "No" },
            ],
          },
          {
            key: "kitchen_suppression", label: "Kitchen hood suppression system (if cooking on site)", labelEs: "Sistema de supresión en campana (si se cocina en el local)",
            type: "select",
            options: [
              { value: "yes", label: "Yes", labelEs: "Sí" },
              { value: "no", label: "No", labelEs: "No" },
              { value: "na", label: "Not applicable", labelEs: "No aplica" },
            ],
          },
          {
            key: "hazardous_materials", label: "Flammable or hazardous materials stored on site", labelEs: "Materiales inflamables o peligrosos almacenados en el local",
            type: "select", required: true,
            options: [
              { value: "yes", label: "Yes", labelEs: "Sí" },
              { value: "no", label: "No", labelEs: "No" },
            ],
          },
          {
            key: "hazmat_details", label: "If yes, describe materials and quantities", labelEs: "Si es sí, describe materiales y cantidades",
            type: "textarea",
          },
          {
            key: "lpg", label: "Liquefied petroleum gas (LPG) on site", labelEs: "Gas licuado de petróleo (GLP) en el local",
            type: "select", required: true,
            options: [
              { value: "yes", label: "Yes", labelEs: "Sí" },
              { value: "no", label: "No", labelEs: "No" },
            ],
          },
        ],
      },
      {
        title: "Supporting evidence checklist (Evidence locker tags)",
        titleEs: "Lista de evidencia de apoyo (etiquetas del Evidence locker)",
        fields: [
          {
            key: "doc_floor_plans", label: "Floor plan / egress layout ready — locker tag DOC_FLOOR_PLANS",
            labelEs: "Plano / distribución de egreso listo — etiqueta DOC_FLOOR_PLANS",
            type: "checkbox", required: true,
          },
          {
            key: "doc_lease", label: "Lease / premises control ready — locker tag DOC_LEASE_AGREEMENT",
            labelEs: "Arrendamiento / control del local listo — etiqueta DOC_LEASE_AGREEMENT",
            type: "checkbox", required: true,
          },
          {
            key: "doc_permiso_context", label: "Permiso Único path in progress — related tag DOC_PERMISO_UNICO",
            labelEs: "Ruta de Permiso Único en progreso — etiqueta relacionada DOC_PERMISO_UNICO",
            type: "checkbox",
            help: "CPI is commonly renewed with each Permiso Único renewal.",
            helpEs: "La CPI suele renovarse con cada renovación del Permiso Único.",
          },
          {
            key: "inspection_ready", label: "Premises ready for Bomberos prevention inspection (exits clear, extinguishers current)",
            labelEs: "Local listo para la inspección de prevención de Bomberos (salidas libres, extintores vigentes)",
            type: "checkbox", required: true,
          },
          {
            key: "portal_ack", label: "I will request / track CPI via OGPe / Bomberos channels — SmartPR does not e-file",
            labelEs: "Solicitaré / daré seguimiento a la CPI por los canales de OGPe / Bomberos — SmartPR no radica electrónicamente",
            type: "checkbox", required: true,
            help: "After approval, upload the Fire Safety Certification and tag DOC_FIRE_CERT.",
            helpEs: "Después de la aprobación, sube la Certificación de Bomberos y etiquétala DOC_FIRE_CERT.",
          },
        ],
      },
    ],
  },
  alcohol_permit: {
    requirementCode: "alcohol_permit",
    title: "Alcohol Beverage License Application Worksheet",
    agency: "Puerto Rico Department of Treasury (Hacienda)",
    description: "SmartPR worksheet gathering the information for an alcohol beverage license application, pre-filled from your business profile.",
    officialOutput: "Alcohol Beverage License issued by Hacienda",
    filename: "06_Alcohol_Beverage_License_Worksheet.pdf",
    sections: [
      {
        title: "Applicant and premises",
        fields: [
          { key: "legal_name", label: "Legal business name", type: "text", required: true, profileKey: "name" },
          { key: "trade_name", label: "Trade name / DBA", type: "text", profileKey: "trade_name"},
          { key: "physical_address", label: "Premises address", type: "textarea", required: true , profileKey: "physical_address"},
          { key: "municipality", label: "Municipality", type: "text", required: true, profileKey: "municipality" },
          { key: "owner_name", label: "Owner / authorized representative", type: "text", required: true , profileKey: "contact_name"},
          { key: "contact_email", label: "Contact email", type: "email", required: true },
          { key: "contact_phone", label: "Contact phone", type: "tel", required: true },
        ],
      },
      {
        title: "Alcohol activity",
        fields: [
          { key: "activity_type", label: "Alcohol activity", type: "select", required: true, options: [
            { value: "on_premises", label: "Retail sale for on-premises consumption" },
            { value: "off_premises", label: "Retail sale for off-premises consumption" },
            { value: "wholesale", label: "Wholesale / distribution" },
            { value: "manufacturing", label: "Manufacturing" },
            { value: "other", label: "Other" },
          ] },
          { key: "beverage_types", label: "Beverages to be sold (beer, wine, spirits)", type: "text", required: true },
          { key: "hours_of_sale", label: "Proposed hours of alcohol sale", type: "text", required: true, placeholder: "e.g. Mon–Sat 12pm–2am" },
          { key: "seating_capacity", label: "Seating capacity (if on-premises)", type: "number" },
          { key: "federal_permit", label: "Federal TTB permit held or applied for (if applicable)", type: "select", options: YES_NO_NA },
        ],
      },
    ],
  },
  workers_comp: {
    requirementCode: "workers_comp",
    title: "Workers' Compensation (CFSE) Policy Worksheet",
    agency: "State Insurance Fund Corporation (CFSE / Fondo del Seguro del Estado)",
    description: "SmartPR worksheet gathering the information for a CFSE workers' compensation policy application, pre-filled from your business profile.",
    officialOutput: "Workers' compensation policy issued by the CFSE",
    filename: "07_Workers_Compensation_CFSE_Worksheet.pdf",
    sections: [
      {
        title: "Employer",
        fields: [
          { key: "legal_name", label: "Legal business name", type: "text", required: true, profileKey: "name" },
          { key: "trade_name", label: "Trade name / DBA", type: "text", profileKey: "trade_name"},
          { key: "fein", label: "Federal EIN", type: "text", required: true, placeholder: "XX-XXXXXXX" },
          { key: "physical_address", label: "Employer address", type: "textarea", required: true , profileKey: "physical_address"},
          { key: "municipality", label: "Municipality", type: "text", required: true, profileKey: "municipality" },
          { key: "contact_name", label: "Responsible contact", type: "text", required: true , profileKey: "contact_name"},
          { key: "contact_email", label: "Contact email", type: "email", required: true },
          { key: "contact_phone", label: "Contact phone", type: "tel", required: true },
        ],
      },
      {
        title: "Workforce and risk",
        fields: [
          { key: "employee_count", label: "Number of employees", type: "number", required: true, profileKey: "number_of_employees" },
          { key: "annual_payroll", label: "Estimated annual payroll (USD)", type: "number", required: true },
          { key: "work_description", label: "Description of work performed", type: "textarea", required: true },
          { key: "work_locations", label: "Work locations (municipalities)", type: "text", required: true },
          { key: "policy_start", label: "Requested policy start date", type: "date", required: true },
        ],
      },
    ],
  },
  sam_registration: {
    requirementCode: "sam_registration",
    title: "SAM.gov Entity Registration Worksheet",
    titleEs: "Hoja de trabajo para el registro de entidad en SAM.gov",
    agency: "U.S. General Services Administration (GSA) — System for Award Management (SAM.gov)",
    description: "SAM.gov entity registration is completed online at sam.gov — there is no downloadable registration form. This SmartPR worksheet gathers everything you will enter there, pre-filled from your business profile. Complete it here, then enter the information at sam.gov.",
    descriptionEs: "El registro de entidad en SAM.gov se completa en línea en sam.gov — no existe un formulario de registro descargable. Esta hoja de trabajo de SmartPR reúne todo lo que vas a ingresar allí, prellenado con tu perfil de negocio. Complétala aquí y luego ingresa la información en sam.gov.",
    officialOutput: "Active SAM.gov entity registration (verified at sam.gov)",
    filename: "08_SAM.gov_Entity_Registration_Worksheet.pdf",
    sections: [
      {
        title: "Account & access",
        titleEs: "Cuenta y acceso",
        fields: [
          {
            key: "login_gov_email", label: "Login.gov account email", labelEs: "Correo de la cuenta de Login.gov",
            type: "email", required: true,
            help: "SAM.gov sign-in uses a Login.gov account. Create one at login.gov if you do not have one yet.",
            helpEs: "Para entrar a SAM.gov se usa una cuenta de Login.gov. Crea una en login.gov si aún no tienes.",
          },
          {
            key: "has_login_gov", label: "Do you already have a Login.gov account?", labelEs: "¿Ya tienes una cuenta de Login.gov?",
            type: "select", options: [
              { value: "yes", label: "Yes", labelEs: "Sí" },
              { value: "no", label: "No", labelEs: "No" },
            ],
          },
        ],
      },
      {
        title: "Entity identity",
        titleEs: "Identidad de la entidad",
        fields: [
          {
            key: "legal_name", label: "Legal business name", labelEs: "Nombre legal del negocio",
            type: "text", required: true, profileKey: "name",
            help: "Must match the IRS records exactly — SAM.gov validates it against the IRS.",
            helpEs: "Tiene que coincidir exactamente con los récords del IRS — SAM.gov lo valida contra el IRS.",
          },
          {
            key: "physical_address", label: "Physical address", labelEs: "Dirección física",
            type: "textarea", required: true,
            help: "Must match the SAM.gov registration exactly — the Entity Administrator letter uses this address too.",
            helpEs: "Tiene que coincidir exactamente con el registro en SAM.gov — la carta del Administrador de la Entidad también usa esta dirección.",
          },
          {
            key: "mailing_address", label: "Mailing address (if different)", labelEs: "Dirección postal (si es diferente)",
            type: "textarea",
          },
          {
            key: "ein", label: "Taxpayer Identification Number (EIN)", labelEs: "Número de Identificación Patronal (EIN)",
            type: "text", required: true, placeholder: "XX-XXXXXXX",
          },
          {
            key: "entity_type", label: "Business structure / entity type", labelEs: "Estructura del negocio / tipo de entidad",
            type: "select", required: true, profileKey: "business_structure", options: ENTITY_OPTIONS,
          },
        ],
      },
      {
        title: "Business classification",
        titleEs: "Clasificación del negocio",
        fields: [
          {
            key: "naics_codes", label: "NAICS codes", labelEs: "Códigos NAICS",
            type: "text", required: true, placeholder: "e.g. 541512, 236220",
            help: "North American Industry Classification System codes describing your business activities. List all that apply, separated by commas.",
            helpEs: "Códigos del Sistema de Clasificación Industrial de América del Norte que describen las actividades del negocio. Indica todos los que apliquen, separados por comas.",
          },
          {
            key: "registration_purpose", label: "Purpose of registration", labelEs: "Propósito del registro",
            type: "select", required: true,
            options: [
              { value: "contracts", label: "Federal contracts", labelEs: "Contratos federales" },
              { value: "grants", label: "Federal grants / awards", labelEs: "Fondos federales / subvenciones" },
              { value: "both", label: "Both contracts and grants", labelEs: "Contratos y fondos federales" },
            ],
          },
        ],
      },
      {
        title: "Banking — electronic funds transfer",
        titleEs: "Datos bancarios — transferencia electrónica de fondos",
        fields: [
          {
            key: "bank_name", label: "Bank name", labelEs: "Nombre del banco",
            type: "text", required: true,
            help: "SAM.gov requires banking information for electronic funds transfer (EFT) payments. Enter it directly at sam.gov — SmartPR keeps this draft only on this device.",
            helpEs: "SAM.gov exige los datos bancarios para pagos por transferencia electrónica de fondos (EFT). Ingrésalos directamente en sam.gov — SmartPR guarda este borrador solo en este dispositivo.",
          },
          { key: "routing_number", label: "Routing number", labelEs: "Número de ruta", type: "text", required: true },
          { key: "account_number", label: "Account number", labelEs: "Número de cuenta", type: "text", required: true },
          {
            key: "account_type", label: "Account type", labelEs: "Tipo de cuenta",
            type: "select", required: true,
            options: [
              { value: "checking", label: "Checking", labelEs: "Cheques" },
              { value: "savings", label: "Savings", labelEs: "Ahorros" },
            ],
          },
        ],
      },
      {
        title: "Points of contact",
        titleEs: "Personas de contacto",
        fields: [
          { key: "poc_name", label: "Primary point of contact — name", labelEs: "Contacto principal — nombre", type: "text", required: true },
          { key: "poc_title", label: "Title", labelEs: "Título", type: "text", required: true },
          { key: "poc_email", label: "Email", labelEs: "Correo electrónico", type: "email", required: true },
          { key: "poc_phone", label: "Phone", labelEs: "Teléfono", type: "tel", required: true },
        ],
      },
      {
        title: "Representations & certifications",
        titleEs: "Representaciones y certificaciones",
        fields: [
          {
            key: "reps_certs_ack", label: "FAR / DFARS representations & certifications",
            labelEs: "Representaciones y certificaciones FAR / DFARS",
            type: "checkbox", required: true,
            help: "The representations and certifications are completed inside sam.gov as part of registration — this checkbox confirms you know to complete them there.",
            helpEs: "Las representaciones y certificaciones se completan dentro de sam.gov como parte del registro — esta casilla confirma que sabes que tienes que completarlas allí.",
          },
        ],
      },
    ],
  },
  sam_admin_letter: {
    requirementCode: "sam_admin_letter",
    layout: "letter",
    kicker: "Supporting document",
    kickerEs: "Documento de apoyo",
    title: "Entity Administrator Appointment Letter",
    titleEs: "Carta de nombramiento del Administrador de la Entidad",
    agency: "U.S. General Services Administration (GSA) — System for Award Management (SAM.gov)",
    description: "Template for the original signed, notarized letter on entity letterhead that GSA requires new entities to submit to appoint the SAM.gov Entity Administrator. Print on letterhead, sign by hand, and have it notarized — SmartPR never signs or notarizes.",
    descriptionEs: "Modelo de la carta original firmada y notarizada en papel con membrete de la entidad que GSA exige a las entidades nuevas para nombrar al Administrador de la Entidad de SAM.gov. Imprímela en papel con membrete, fírmala a mano y notarízala — SmartPR nunca firma ni notariza.",
    officialOutput: "Signed, notarized Entity Administrator appointment letter accepted by GSA",
    filename: "09_SAM.gov_Entity_Administrator_Appointment_Letter.pdf",
    sections: [
      {
        title: "Entity",
        titleEs: "Entidad",
        fields: [
          { key: "entity_legal_name", label: "Entity legal name", labelEs: "Nombre legal de la entidad", type: "text", required: true, profileKey: "name" },
          {
            key: "uei", label: "Unique Entity ID (UEI)", labelEs: "Identificador Único de Entidad (UEI)",
            type: "text",
            help: "If already assigned. Leave blank if the UEI is still pending.",
            helpEs: "Si ya se te asignó. Déjalo en blanco si aún está pendiente.",
          },
          {
            key: "entity_physical_address", label: "Entity physical address", labelEs: "Dirección física de la entidad",
            type: "textarea", required: true,
            help: "Must match the SAM.gov registration exactly.",
            helpEs: "Tiene que coincidir exactamente con el registro en SAM.gov.",
          },
        ],
      },
      {
        title: "Entity Administrator",
        titleEs: "Administrador de la Entidad",
        fields: [
          { key: "admin_name", label: "Administrator name", labelEs: "Nombre del administrador", type: "text", required: true },
          { key: "admin_title", label: "Administrator title", labelEs: "Título del administrador", type: "text", required: true },
          { key: "admin_email", label: "Administrator email", labelEs: "Correo electrónico del administrador", type: "email", required: true },
          { key: "admin_phone", label: "Administrator phone", labelEs: "Teléfono del administrador", type: "tel", required: true },
          {
            key: "admin_preference", label: "Account administration preference", labelEs: "Preferencia de administración de la cuenta",
            type: "select", required: true,
            options: [
              { value: "self_admin", label: "Self-administration — the entity administers its own SAM.gov account", labelEs: "Autoadministración — la entidad administra su propia cuenta de SAM.gov" },
              { value: "third_party_agent", label: "Third-party agent — the entity designates an agent to administer its SAM.gov account", labelEs: "Agente tercero — la entidad designa un agente para administrar su cuenta de SAM.gov" },
            ],
            help: "GSA requires the letter to state this preference.",
            helpEs: "GSA exige que la carta indique esta preferencia.",
          },
        ],
      },
    ],
  },
  daco_contractor_checklist: {
    requirementCode: "daco_contractor_checklist",
    kicker: "Supporting checklist",
    kickerEs: "Lista de apoyo",
    title: "DACO Contractor Registry — Supporting Documents Checklist",
    titleEs: "Registro de Contratistas DACO — Lista de documentos de apoyo",
    agency: "Departamento de Asuntos del Consumidor (DACO) — Gobierno de Puerto Rico",
    description: "SmartPR checklist for the DACO contractor / urbanizador-constructor filing package. SmartPR already prepares the official DACOUC01 application PDF for page-1 applicant fields — use this bilingual checklist to gather the bond, Hacienda, corporate, and consumer-responsibility attachments Ley 146-1995 and Regl. 8172 expect. Never present this checklist as an official DACO form.",
    descriptionEs: "Lista de SmartPR para el paquete de radicación de contratista / urbanizador-constructor ante DACO. SmartPR ya prepara el PDF oficial DACOUC01 con los datos del solicitante en la página 1 — usa esta lista bilingüe para reunir la fianza, Hacienda, documentos corporativos y la declaración de responsabilidad al consumidor que Ley 146-1995 y el Regl. 8172 esperan. Nunca presentes esta lista como un formulario oficial de DACO.",
    officialOutput: "DACO contractor certification / urbanizador-constructor license (agency-issued)",
    filename: "10_DACO_Contractor_Supporting_Documents_Checklist.pdf",
    sections: [
      {
        title: "Applicant",
        titleEs: "Solicitante",
        fields: [
          {
            key: "legal_name", label: "Applicant / business legal name", labelEs: "Nombre legal del solicitante / negocio",
            type: "text", required: true, profileKey: "name",
          },
          {
            key: "municipality", label: "Municipality of operations", labelEs: "Municipio de operaciones",
            type: "text", required: true, profileKey: "municipality",
          },
          {
            key: "physical_address", label: "Physical address", labelEs: "Dirección física",
            type: "textarea", required: true,
          },
          {
            key: "mailing_address", label: "Mailing address", labelEs: "Dirección postal",
            type: "textarea",
          },
          {
            key: "contact_phone", label: "Phone", labelEs: "Teléfono",
            type: "tel", required: true,
          },
          {
            key: "contact_email", label: "Email", labelEs: "Correo electrónico",
            type: "email", required: true,
          },
        ],
      },
      {
        title: "License requested",
        titleEs: "Licencia solicitada",
        fields: [
          {
            key: "application_type", label: "Application type", labelEs: "Tipo de solicitud",
            type: "select", required: true,
            options: [
              { value: "new", label: "New registration / license", labelEs: "Registro / licencia nueva" },
              { value: "renewal", label: "Renewal (renovación)", labelEs: "Renovación" },
            ],
          },
          {
            key: "activity_type", label: "Activity type", labelEs: "Tipo de actividad",
            type: "select", required: true,
            options: [
              { value: "constructor", label: "Constructor (builder)", labelEs: "Constructor" },
              { value: "urbanizador", label: "Urbanizador (developer)", labelEs: "Urbanizador" },
              { value: "ambos", label: "Both constructor and urbanizador", labelEs: "Ambos (constructor y urbanizador)" },
              { value: "specialty", label: "Specialty trade / other contracting", labelEs: "Oficio especializado / otra contratación" },
            ],
            help: "Ley 146-1995 requires DACO contractor certification before offering construction estimates or work on property you do not own. Regl. 8172 covers the urbanizador/constructor license application SmartPR maps as DACOUC01.",
            helpEs: "La Ley 146-1995 exige la certificación de contratista de DACO antes de ofrecer estimados o trabajos de construcción en propiedad que no es tuya. El Regl. 8172 cubre la solicitud de licencia de urbanizador/constructor que SmartPR mapea como DACOUC01.",
          },
          {
            key: "gross_volume", label: "Prior-year gross business volume (USD)", labelEs: "Volumen bruto del año anterior (USD)",
            type: "text", placeholder: "e.g. 75000",
            help: "Bond (fianza) percentage under Ley 146-1995 scales with gross volume; new contractors without history use the statutory minimum bond.",
            helpEs: "El por ciento de la fianza bajo la Ley 146-1995 escala con el volumen bruto; los contratistas nuevos sin historial usan la fianza mínima estatutaria.",
          },
        ],
      },
      {
        title: "Supporting documents checklist",
        titleEs: "Lista de documentos de apoyo",
        fields: [
          {
            key: "doc_incorporation", label: "Certificate of Incorporation / authority to do business in PR",
            labelEs: "Certificado de Incorporación / autorización para hacer negocios en PR",
            type: "checkbox", required: true,
          },
          {
            key: "doc_good_standing", label: "Good Standing / Certificate of Existence (if entity is over 2 years old)",
            labelEs: "Good Standing / Certificado de Existencia (si la entidad tiene más de 2 años)",
            type: "checkbox",
          },
          {
            key: "doc_merchant_reg", label: "Hacienda Merchant Registration (SURI)",
            labelEs: "Registro de Comerciantes de Hacienda (SURI)",
            type: "checkbox", required: true,
          },
          {
            key: "doc_patente", label: "Municipal patente / volume-of-business declaration",
            labelEs: "Patente municipal / declaración de volumen de negocios",
            type: "checkbox", required: true,
          },
          {
            key: "doc_id", label: "Driver's license of individual or entity representative",
            labelEs: "Licencia de conducir del individuo o representante de la entidad",
            type: "checkbox", required: true,
          },
          {
            key: "doc_bond", label: "Surety bond (fianza) matching Ley 146-1995 volume brackets (or evidence works are already bonded)",
            labelEs: "Fianza según los tramos de volumen de la Ley 146-1995 (o evidencia de que los trabajos ya están afianzados)",
            type: "checkbox", required: true,
            help: "New contractors without prior history: statutory minimum bond of $4,000 corresponding to $50,001 volume. Annual inscription renewal fee is $100 under Ley 146-1995.",
            helpEs: "Contratistas nuevos sin historial: fianza mínima estatutaria de $4,000 correspondiente a un volumen de $50,001. La renovación anual de la inscripción cuesta $100 bajo la Ley 146-1995.",
          },
          {
            key: "doc_consumer_declaration", label: "Declaración de Cumplimiento de Responsabilidades a los Consumidores",
            labelEs: "Declaración de Cumplimiento de Responsabilidades a los Consumidores",
            type: "checkbox", required: true,
          },
          {
            key: "doc_payment", label: "Payment prepared for DACO fees (check/money order to Secretario de Hacienda as instructed on the current DACO form)",
            labelEs: "Pago preparado de los derechos de DACO (cheque/giro a nombre del Secretario de Hacienda según el formulario vigente de DACO)",
            type: "checkbox", required: true,
          },
          {
            key: "dacouc01_prepared", label: "Official DACOUC01 application prepared in SmartPR (page-1 fields)",
            labelEs: "Solicitud oficial DACOUC01 preparada en SmartPR (campos de la página 1)",
            type: "checkbox", required: true,
            help: "Complete and download the official DACO form from the Contractor License requirement card. Sworn/notary pages stay blank for hand completion.",
            helpEs: "Completa y descarga el formulario oficial de DACO desde la tarjeta del requisito de Licencia de Contratista. Las páginas juradas/notariales se dejan en blanco para completarlas a mano.",
          },
        ],
      },
    ],
  },
};

export const ISSUED_DOCUMENT_GUIDANCE: Record<string, string> = {
  certificate_of_incorporation: "Open and complete the official Department of State form here. After the agency accepts the filing, upload the official Certificate of Incorporation to complete this requirement.",
  merchant_registration: "Complete merchant registration in SURI. After Hacienda issues the certificate, upload the official Merchant Registration Certificate to complete this requirement.",
  // REG-GUIDE-VERIFY-001 (2026-09-21 QA): the Permiso Único card rendered
  // "complete the permit application in SBP" with a VERIFY EXISTING badge on
  // the same live filing — apply-copy contradicting the verify posture.
  // Status-neutral: lead with the upload; the prep checklist is the
  // alternative for businesses without an issued permit.
  permiso_unico: "Upload the issued Permiso Único to complete this requirement. If the business does not have one yet, SmartPR prepares a bilingual Permiso Único / use-occupancy prep checklist (no standalone OGPe PDF — filing is portal-only): prefill identity from the Business Passport, assemble Evidence locker files tagged 'Permiso Único' and related documents, then file at ogpe.pr.gov.",
  // REG-GUIDE-VERIFY-001 (2026-09-21 QA): the EIN card rendered
  // "SmartPR prepares the IRS Form SS-4 application for you" with a VERIFY
  // EXISTING badge on a live Toa Alta auto-parts filing for an operating
  // business (S101) — apply-copy contradicting the verify posture. Status-
  // neutral: lead with the upload; preparation is the alternative.
  ein_letter: "Upload the IRS EIN confirmation (CP 575 notice or other accepted IRS EIN confirmation) to complete this requirement. If the business does not have an EIN yet, SmartPR prepares the IRS Form SS-4 application for you — the EIN itself is agency-issued.",
  health_permit: "SmartPR prepares a bilingual sanitary / food-establishment prep checklist when a Health / Sanitary Permit applies (often via OGPe Permiso Único). Tag supporting evidence (food protection manager certificate, floor plans, etc.) in the Evidence locker, complete the agency/portal steps, then upload the issued Health / Sanitary Permit.",
  fire_certification: "SmartPR prepares a bilingual Bomberos fire-safety inspection prep checklist. CPI is processed through OGPe after Bomberos inspection — SmartPR does not e-file. Assemble Evidence locker files tagged 'Fire Safety Certification' and related documents, prepare the premises, then upload the issued Fire Safety Certification.",
  alcohol_permit: "SmartPR prepares an alcohol beverage license worksheet for you. The license itself is agency-issued: complete the application with Hacienda, and after it issues the license, upload the official Alcohol Beverage License to complete this requirement.",
  workers_comp: "SmartPR prepares a CFSE policy worksheet for you. The policy itself is agency-issued: complete the application with the State Insurance Fund Corporation (CFSE), and after coverage is issued, upload the official CFSE policy evidence to complete this requirement.",
  doc_luma_interconnection: "SmartPR prepares LUMA's customer orientation attestation for you — print it, sign it by hand, and upload the signed copy. LUMA still requires the signed document as part of its interconnection registration.",
  contractor_license: "SmartPR prepares the official DACOUC01 urbanizador/constructor application (page-1 fields) and a bilingual supporting-documents checklist (bond, Hacienda, corporate papers, consumer-responsibility declaration). Complete DACOUC01, assemble the checklist attachments, file with DACO, then upload the agency-issued contractor certification to complete this requirement.",
  sam_registration: "SAM.gov registration is completed online at sam.gov — there is no downloadable form. SmartPR prepares a worksheet with everything you will enter there, plus the Entity Administrator appointment letter template (print on letterhead, sign by hand, have it notarized). After GSA activates the registration, upload the confirmation to complete this requirement.",
};

export const ISSUED_DOCUMENT_GUIDANCE_ES: Record<string, string> = {
  certificate_of_incorporation: "Abre y completa aquí el formulario oficial del Departamento de Estado. Después de que la agencia acepte la radicación, sube el Certificado de Incorporación oficial para completar este requisito.",
  merchant_registration: "Completa el registro de comerciante en SURI. Después de que Hacienda emita el certificado, sube el Certificado de Registro de Comerciante oficial para completar este requisito.",
  // REG-GUIDE-VERIFY-001 (2026-09-21 QA): status-neutral — see the EN entry.
  permiso_unico: "Sube el Permiso Único emitido para completar este requisito. Si el negocio aún no tiene uno, SmartPR te prepara una lista bilingüe de preparación del Permiso Único / uso-ocupación (no hay PDF independiente de OGPe — la radicación es solo por portal): prellena la identidad desde el Pasaporte de negocio, reúne archivos del Evidence locker etiquetados 'Permiso Único' y documentos relacionados, y luego radica en ogpe.pr.gov.",
  // REG-GUIDE-VERIFY-001 (2026-09-21 QA): status-neutral — see the EN entry.
  ein_letter: "Sube la confirmación del EIN del IRS (aviso CP 575 u otra confirmación aceptada por el IRS) para completar este requisito. Si el negocio aún no tiene EIN, SmartPR prepara la solicitud del Formulario SS-4 del IRS por ti — el EIN en sí lo emite la agencia.",
  health_permit: "SmartPR te prepara una lista bilingüe de preparación sanitaria / de establecimiento de alimentos cuando aplica un Permiso de Salud (a menudo vía Permiso Único de OGPe). Etiqueta evidencia de apoyo (certificado de manejador de alimentos, planos del local, etc.) en el Evidence locker, completa los pasos de la agencia/portal y luego sube el Permiso de Salud emitido.",
  fire_certification: "SmartPR te prepara una lista bilingüe de preparación para la inspección de Bomberos. La CPI se tramita por OGPe después de la inspección — SmartPR no radica electrónicamente. Reúne archivos del Evidence locker etiquetados 'Certificado de Bomberos' y documentos relacionados, prepara el local y luego sube la certificación emitida.",
  alcohol_permit: "SmartPR te prepara una hoja de trabajo para la licencia de bebidas alcohólicas. La licencia en sí la emite la agencia: completa la solicitud con Hacienda y, después de emitida, sube la Licencia de Bebidas Alcohólicas oficial para completar este requisito.",
  workers_comp: "SmartPR te prepara una hoja de trabajo para la póliza de la CFSE. La póliza en sí la emite la agencia: completa la solicitud con la Corporación del Fondo del Seguro del Estado (CFSE) y, después de emitida la cubierta, sube la evidencia oficial de la póliza para completar este requisito.",
  doc_luma_interconnection: "SmartPR te prepara la Confirmación de Orientación al Cliente de LUMA — imprímela, fírmala a mano y sube la copia firmada. LUMA sigue exigiendo el documento firmado como parte de su registro de interconexión.",
  contractor_license: "SmartPR te prepara la solicitud oficial DACOUC01 de urbanizador/constructor (campos de la página 1) y una lista bilingüe de documentos de apoyo (fianza, Hacienda, papeles corporativos, declaración de responsabilidad al consumidor). Completa DACOUC01, reúne los anejos de la lista, radica en DACO y luego sube la certificación de contratista emitida por la agencia para completar este requisito.",
  sam_registration: "El registro en SAM.gov se completa en línea en sam.gov — no hay un formulario descargable. SmartPR te prepara una hoja de trabajo con todo lo que vas a ingresar allí, más el modelo de carta de nombramiento del Administrador de la Entidad (imprímela en papel con membrete, fírmala a mano y notarízala). Después de que GSA active el registro, sube la confirmación para completar este requisito.",
};

export type SampleApplicationLanguage = "en" | "es";

/**
 * Return a copy of the definition with Puerto Rican Spanish copy swapped in
 * when language is "es". Definitions without Spanish variants render unchanged.
 */
export function localizeSampleDefinition(
  definition: SampleApplicationDefinition,
  language: SampleApplicationLanguage = "en"
): SampleApplicationDefinition {
  if (language !== "es") return definition;
  return {
    ...definition,
    title: definition.titleEs ?? definition.title,
    description: definition.descriptionEs ?? definition.description,
    kicker: definition.kickerEs ?? definition.kicker,
    sections: definition.sections.map((section) => ({
      ...section,
      title: section.titleEs ?? section.title,
      fields: section.fields.map((field) => ({
        ...field,
        label: field.labelEs ?? field.label,
        placeholder: field.placeholderEs ?? field.placeholder,
        help: field.helpEs ?? field.help,
        options: field.options?.map((option) => ({
          ...option,
          label: option.labelEs ?? option.label,
        })),
      })),
    })),
  };
}

export function getSampleApplication(
  requirementCode: string,
  language: SampleApplicationLanguage = "en"
): SampleApplicationDefinition | null {
  const definition = SAMPLE_APPLICATIONS[requirementCode] ?? null;
  return definition ? localizeSampleDefinition(definition, language) : null;
}

export function prefillSampleApplication(
  definition: SampleApplicationDefinition,
  profile: PrefillProfile,
  existing: SampleFormData = {}
): SampleFormData {
  const next: SampleFormData = { ...existing };
  for (const section of definition.sections) {
    for (const field of section.fields) {
      if (next[field.key] !== undefined || !field.profileKey) continue;
      const value = profile[field.profileKey];
      if (value !== undefined && value !== null) next[field.key] = String(value);
    }
  }
  return next;
}

export function missingRequiredSampleFields(
  definition: SampleApplicationDefinition,
  data: SampleFormData
): string[] {
  return definition.sections.flatMap((section) => section.fields)
    .filter((field) => field.required)
    .filter((field) => {
      const value = data[field.key];
      return value === undefined || value === false || String(value).trim() === "";
    })
    .map((field) => field.label);
}

export function generateSampleApplicationPdf(
  definition: SampleApplicationDefinition,
  data: SampleFormData,
  language: SampleApplicationLanguage = "en"
): Blob {
  const localized = localizeSampleDefinition(definition, language);
  if (localized.layout === "letter") {
    return generateLetterPdf(localized, data, language);
  }
  return generateWorksheetPdf(localized, language, data);
}

function generateWorksheetPdf(
  definition: SampleApplicationDefinition,
  language: SampleApplicationLanguage,
  data: SampleFormData
): Blob {
  const doc = new jsPDF({ unit: "mm", format: "letter" });
  const margin = 18;
  const width = 216 - margin * 2;
  let y = 20;

  const ensureSpace = (needed: number) => {
    if (y + needed <= 260) return;
    doc.addPage();
    y = 20;
  };

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(definition.title, margin, y);
  y += 7;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(75, 85, 99);
  doc.text(`Agency: ${definition.agency}`, margin, y);
  y += 6;
  const descriptionLines = doc.splitTextToSize(definition.description, width);
  doc.text(descriptionLines, margin, y);
  y += descriptionLines.length * 4 + 5;

  doc.setFillColor(239, 246, 255);
  doc.setDrawColor(59, 130, 246);
  doc.rect(margin, y, width, 16, "FD");
  doc.setTextColor(30, 64, 175);
  doc.setFont("helvetica", "bold");
  doc.text(language === "es" ? "Hoja de trabajo de preparación de SmartPR" : "SmartPR preparation worksheet", margin + 4, y + 6);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text(
    language === "es"
      ? `Completa la radicación oficial con ${definition.agency}; sube el documento emitido cuando llegue.`
      : `Complete the official filing with the ${definition.agency}; upload the issued document when it arrives.`,
    margin + 4, y + 11
  );
  y += 23;

  for (const section of definition.sections) {
    ensureSpace(18);
    doc.setTextColor(15, 35, 50);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(section.title, margin, y);
    y += 6;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);

    for (const field of section.fields) {
      const optionLabel = field.options?.find((option) => option.value === data[field.key])?.label;
      const rawValue = optionLabel ?? data[field.key];
      const value = rawValue === undefined || rawValue === "" ? "—" : String(rawValue);
      const lines = doc.splitTextToSize(`${field.label}: ${value}`, width - 4);
      ensureSpace(lines.length * 4 + 4);
      doc.text(lines, margin + 2, y);
      y += lines.length * 4 + 3;
    }
    y += 3;
  }

  ensureSpace(25);
  doc.setDrawColor(203, 213, 225);
  doc.line(margin, y, margin + 75, y);
  doc.line(margin + 95, y, margin + 145, y);
  doc.setTextColor(75, 85, 99);
  doc.setFontSize(8);
  doc.text(language === "es" ? "Preparado por" : "Prepared by", margin, y + 4);
  doc.text(language === "es" ? "Fecha" : "Date", margin + 95, y + 4);
  y += 12;
  const footer = doc.splitTextToSize(
    language === "es"
      ? "SmartPR organiza la información de la solicitud, pero no radica trámites ni emite aprobaciones. Verifica toda la información con el proceso oficial vigente de la agencia antes de radicar."
      : "SmartPR organizes application information but does not submit filings or issue approvals. Verify all information against the current official agency process before filing.",
    width
  );
  doc.text(footer, margin, y);

  return doc.output("blob");
}

/**
 * Formal-letter renderer for layout: "letter" definitions (today: the SAM.gov
 * Entity Administrator appointment letter).
 *
 * Page 1 is the letter itself: entity letterhead, the required appointment
 * statements with the user's data merged in, then signature and notary blocks
 * that are ALWAYS blank — SmartPR never signs or notarizes.
 * Page 2 carries mailing instructions and the source note (never mailed).
 */
export function generateLetterPdf(
  definition: SampleApplicationDefinition,
  data: SampleFormData,
  language: SampleApplicationLanguage = "en"
): Blob {
  const es = language === "es";
  const doc = new jsPDF({ unit: "mm", format: "letter" });
  const margin = 20;
  const width = 216 - margin * 2;
  let y = 22;

  const value = (key: string): string | null => {
    const val = data[key];
    if (val === undefined || val === null) return null;
    const s = String(val).trim();
    return s === "" ? null : s;
  };
  // Missing values render as a blank underline the signer completes by hand —
  // never as a placeholder that could be mistaken for data.
  const fill = (key: string, len = 26): string => value(key) ?? "_".repeat(len);

  const paragraph = (text: string, opts?: { bold?: boolean; size?: number; gap?: number }) => {
    doc.setFont("helvetica", opts?.bold ? "bold" : "normal");
    doc.setFontSize(opts?.size ?? 10.5);
    doc.setTextColor(20, 20, 20);
    const lines = doc.splitTextToSize(text, width);
    if (y + lines.length * 5 > 268) {
      doc.addPage();
      y = 22;
    }
    doc.text(lines, margin, y);
    y += lines.length * 5 + (opts?.gap ?? 4);
  };

  const blankLine = (label: string, lineLen = 92) => {
    if (y + 12 > 268) {
      doc.addPage();
      y = 22;
    }
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    doc.setTextColor(20, 20, 20);
    doc.text(label, margin, y);
    const labelW = doc.getTextWidth(label);
    doc.setDrawColor(20, 20, 20);
    doc.line(margin + labelW + 2, y, margin + labelW + 2 + lineLen, y);
    y += 10;
  };

  // ---- Letterhead: the entity's own name, or a blank line to complete ----
  const letterhead = value("entity_legal_name");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(20, 20, 20);
  if (letterhead) {
    const lines = doc.splitTextToSize(letterhead, width);
    doc.text(lines, 108, y, { align: "center" });
    y += lines.length * 6;
  } else {
    doc.text("_".repeat(46), 108, y, { align: "center" });
    y += 8;
  }
  doc.setDrawColor(120, 120, 120);
  doc.line(margin, y, margin + width, y);
  y += 8;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  doc.text(es ? "Fecha: ____________________" : "Date: ____________________", margin, y);
  y += 10;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(definition.title, 108, y, { align: "center" });
  y += 10;

  // ---- Required appointment statements (GSA / Federal Service Desk) ----
  const uei = fill("uei", 22);
  const adminName = fill("admin_name", 30);
  const adminTitle = fill("admin_title", 24);
  const adminEmail = fill("admin_email", 30);
  const adminPhone = fill("admin_phone", 18);
  const entityAddress = fill("entity_physical_address", 30);
  const pref = value("admin_preference");
  const prefText = es
    ? pref === "self_admin"
      ? "la autoadministración de su cuenta de SAM.gov"
      : pref === "third_party_agent"
        ? "la designación de un agente tercero para administrar su cuenta de SAM.gov"
        : "________________________________________"
    : pref === "self_admin"
      ? "self-administration of its SAM.gov account"
      : pref === "third_party_agent"
        ? "designation of a third-party agent to administer its SAM.gov account"
        : "________________________________________";

  if (es) {
    paragraph(
      `${fill("entity_legal_name", 34)}, con Identificador Único de Entidad (UEI) ${uei}, ` +
      `por la presente nombra a ${adminName}, ${adminTitle}, como Administrador de la Entidad ` +
      `para su registro de entidad en el Sistema de Gestión de Adjudicaciones (SAM.gov).`
    );
    paragraph(`La entidad elige ${prefText}.`);
    paragraph(
      `La información de contacto del Administrador de la Entidad es: correo electrónico ${adminEmail}, ` +
      `teléfono ${adminPhone}. La dirección física de la entidad es ${entityAddress}. ` +
      `Esta información tiene que coincidir exactamente con el registro de entidad en SAM.gov.`
    );
  } else {
    paragraph(
      `${fill("entity_legal_name", 34)}, with Unique Entity ID (UEI) ${uei}, ` +
      `hereby appoints ${adminName}, ${adminTitle}, as Entity Administrator ` +
      `for its System for Award Management (SAM.gov) entity registration.`
    );
    paragraph(`The entity elects ${prefText}.`);
    paragraph(
      `The Entity Administrator's contact information is: email ${adminEmail}, ` +
      `telephone ${adminPhone}. The entity's physical address is ${entityAddress}. ` +
      `This information must match the SAM.gov entity registration exactly.`
    );
  }

  // ---- Signature block: ALWAYS blank. SmartPR never signs. ----
  y += 4;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(es ? "Firma" : "Signature", margin, y);
  y += 8;
  blankLine(es ? "Firma:" : "Signature:");
  blankLine(es ? "Nombre en letra de molde:" : "Printed name:");
  blankLine(es ? "Título:" : "Title:");
  blankLine(es ? "Fecha:" : "Date:");

  // ---- Notary block: ALWAYS blank. SmartPR never notarizes. ----
  y += 4;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(es ? "Notarización" : "Notarization", margin, y);
  y += 8;
  paragraph(
    es
      ? `Estado de ____________________, Condado de ____________________`
      : `State of ____________________, County of ____________________`,
    { gap: 2 }
  );
  paragraph(
    es
      ? `Jurado y suscrito ante mí hoy _____ de ____________________ de 20_____.`
      : `Sworn to and subscribed before me this _____ day of ____________________, 20_____.`,
    { gap: 6 }
  );
  blankLine(es ? "Firma del notario:" : "Notary Public (signature):");
  blankLine(es ? "Nombre en letra de molde:" : "Printed name:");
  blankLine(es ? "Mi comisión vence:" : "My commission expires:");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  doc.text(es ? "[SELLO]" : "[SEAL]", margin, y);
  y += 10;

  // ---- Page 2: instructions (never mailed) ----
  doc.addPage();
  y = 22;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(20, 20, 20);
  doc.text(es ? "Instrucciones — no incluya esta página al enviar" : "Instructions — do not mail this page", margin, y);
  y += 10;
  const instructions = es
    ? [
      "Imprima esta carta en papel con membrete de la entidad.",
      "La persona que firma tiene que estar autorizada a actuar a nombre de la entidad.",
      "Entidades domésticas: la carta tiene que estar notarizada. Envíe el original firmado y notarizado según las instrucciones vigentes del Federal Service Desk (FSD) en sam.gov.",
      "El correo electrónico y el teléfono del administrador, y la dirección física de la entidad, tienen que coincidir exactamente con el registro en SAM.gov.",
      "Verifique la redacción vigente de la carta del FSD en sam.gov antes de enviarla — el FSD actualiza el modelo.",
    ]
    : [
      "Print this letter on the entity's letterhead.",
      "The signer must be authorized to act on behalf of the entity.",
      "Domestic entities: the letter must be notarized. Mail the original signed, notarized letter per the current Federal Service Desk (FSD) instructions at sam.gov.",
      "The administrator's email and phone, and the entity's physical address, must match the SAM.gov registration exactly.",
      "Verify the current FSD letter wording at sam.gov before mailing — FSD updates the template.",
    ];
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  for (const [i, text] of instructions.entries()) {
    const lines = doc.splitTextToSize(`${i + 1}. ${text}`, width - 6);
    if (y + lines.length * 5 > 268) {
      doc.addPage();
      y = 22;
    }
    doc.text(lines, margin + 3, y);
    y += lines.length * 5 + 4;
  }
  y += 6;
  paragraph(
    es
      ? "Modelo preparado por SmartPR según los requisitos del Federal Service Desk (FSD) de GSA para el nombramiento del Administrador de la Entidad. Esto es un modelo de preparación de SmartPR, no un formulario del gobierno. SmartPR no firma ni notariza."
      : "Template prepared by SmartPR from the GSA Federal Service Desk (FSD) Entity Administrator appointment requirements. This is a SmartPR preparation template, not a government form. SmartPR does not sign or notarize.",
    { size: 9, gap: 2 }
  );

  return doc.output("blob");
}
