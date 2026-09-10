import { jsPDF } from "jspdf";

export type SampleFormValue = string | boolean;
export type SampleFormData = Record<string, SampleFormValue>;

export interface SampleFormOption {
  value: string;
  label: string;
}

export interface SampleFormField {
  key: string;
  label: string;
  type: "text" | "textarea" | "date" | "number" | "email" | "tel" | "select" | "checkbox";
  required?: boolean;
  placeholder?: string;
  help?: string;
  options?: SampleFormOption[];
  profileKey?: "name" | "municipality" | "business_structure" | "number_of_employees";
}

export interface SampleFormSection {
  title: string;
  fields: SampleFormField[];
}

export interface SampleApplicationDefinition {
  requirementCode: string;
  title: string;
  agency: string;
  description: string;
  officialOutput: string;
  filename: string;
  sections: SampleFormSection[];
}

export interface PreparedSampleApplication {
  requirementCode: string;
  title: string;
  filename: string;
  preparedAt: string;
  data: SampleFormData;
}

interface PrefillProfile {
  name?: string;
  municipality?: string;
  business_structure?: string;
  number_of_employees?: number | null;
}

const ENTITY_OPTIONS: SampleFormOption[] = [
  { value: "llc", label: "Limited Liability Company (LLC)" },
  { value: "corporation", label: "Corporation" },
  { value: "sole_proprietorship", label: "Sole Proprietorship" },
  { value: "partnership", label: "Partnership" },
  { value: "professional_corporation", label: "Professional Corporation" },
  { value: "other", label: "Other" },
];

export const SAMPLE_APPLICATIONS: Record<string, SampleApplicationDefinition> = {
  certificate_of_incorporation: {
    requirementCode: "certificate_of_incorporation",
    title: "Certificate of Incorporation Filing Worksheet (Sample)",
    agency: "Puerto Rico Department of State",
    description: "Preparation worksheet for the information commonly needed for an entity filing. This is not an issued Certificate of Incorporation.",
    officialOutput: "Certificate of Incorporation issued by the Puerto Rico Department of State",
    filename: "01_Certificate_of_Incorporation_Filing_Worksheet.pdf",
    sections: [
      {
        title: "Entity information",
        fields: [
          { key: "legal_name", label: "Proposed legal entity name", type: "text", required: true, profileKey: "name" },
          { key: "entity_type", label: "Entity type", type: "select", required: true, profileKey: "business_structure", options: ENTITY_OPTIONS },
          { key: "principal_address", label: "Principal office address", type: "textarea", required: true },
          { key: "mailing_address", label: "Mailing address", type: "textarea" },
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
    title: "Merchant Registration Application Worksheet (Sample)",
    agency: "Puerto Rico Department of Treasury (Hacienda / SURI)",
    description: "Preparation worksheet for merchant registration information. It does not replace registration in SURI or the certificate issued by Hacienda.",
    officialOutput: "Merchant Registration Certificate issued through SURI",
    filename: "02_Merchant_Registration_Application_Worksheet.pdf",
    sections: [
      {
        title: "Business and tax identity",
        fields: [
          { key: "legal_name", label: "Legal business name", type: "text", required: true, profileKey: "name" },
          { key: "trade_name", label: "Trade name / DBA", type: "text" },
          { key: "entity_type", label: "Entity type", type: "select", required: true, profileKey: "business_structure", options: ENTITY_OPTIONS },
          { key: "ein", label: "Federal EIN", type: "text", required: true, placeholder: "XX-XXXXXXX" },
          { key: "naics_code", label: "NAICS code", type: "text" },
          { key: "business_activity", label: "Primary business activity", type: "textarea", required: true },
        ],
      },
      {
        title: "Operations",
        fields: [
          { key: "physical_address", label: "Physical business address", type: "textarea", required: true },
          { key: "municipality", label: "Municipality", type: "text", required: true, profileKey: "municipality" },
          { key: "operations_start_date", label: "Operations start date", type: "date", required: true },
          { key: "employee_count", label: "Number of employees", type: "number", profileKey: "number_of_employees" },
          { key: "contact_name", label: "Responsible contact", type: "text", required: true },
          { key: "contact_email", label: "Contact email", type: "email", required: true },
          { key: "taxable_sales", label: "Will the business make taxable sales?", type: "select", required: true, options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }, { value: "unsure", label: "Not sure" }] },
        ],
      },
    ],
  },
  permiso_unico: {
    requirementCode: "permiso_unico",
    title: "Permiso Único Application Worksheet (Sample)",
    agency: "Office of Permit Management (OGPe)",
    description: "Preparation worksheet for a Permiso Único application. The official application and agency review occur through the authorized government process.",
    officialOutput: "Permiso Único issued by OGPe or the authorized municipality",
    filename: "03_Permiso_Unico_Application_Worksheet.pdf",
    sections: [
      {
        title: "Applicant and location",
        fields: [
          { key: "legal_name", label: "Legal business name", type: "text", required: true, profileKey: "name" },
          { key: "trade_name", label: "Trade name / DBA", type: "text" },
          { key: "business_address", label: "Business location address", type: "textarea", required: true },
          { key: "municipality", label: "Municipality", type: "text", required: true, profileKey: "municipality" },
          { key: "cadastral_number", label: "Property cadastral number", type: "text" },
          { key: "property_owner", label: "Property owner", type: "text", required: true },
          { key: "applicant_name", label: "Applicant / authorized representative", type: "text", required: true },
          { key: "applicant_email", label: "Applicant email", type: "email", required: true },
          { key: "applicant_phone", label: "Applicant phone", type: "tel", required: true },
        ],
      },
      {
        title: "Proposed use",
        fields: [
          { key: "proposed_use", label: "Proposed business use", type: "textarea", required: true },
          { key: "occupancy_description", label: "Occupancy / space description", type: "textarea", required: true },
          { key: "square_footage", label: "Approximate square footage", type: "number" },
          { key: "employee_count", label: "Number of employees", type: "number", profileKey: "number_of_employees" },
          { key: "food_service", label: "Food preparation or service", type: "select", required: true, options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }] },
          { key: "alcohol_sales", label: "Alcohol sales or service", type: "select", required: true, options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }] },
          { key: "construction_changes", label: "Construction, renovation, or change of use planned", type: "select", required: true, options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }, { value: "unsure", label: "Not sure" }] },
        ],
      },
    ],
  },
};

export const ISSUED_DOCUMENT_GUIDANCE: Record<string, string> = {
  certificate_of_incorporation: "Open and complete the official Department of State form here. After the agency accepts the filing, upload the official Certificate of Incorporation to complete this requirement.",
  merchant_registration: "Complete merchant registration in SURI. After Hacienda issues the certificate, upload the official Merchant Registration Certificate to complete this requirement.",
  permiso_unico: "Complete the application through OGPe's Single Business Portal or the applicable municipality. After approval, upload the issued Permiso Único to complete this requirement.",
  ein_letter: "SmartPR prepares the IRS Form SS-4 application for you. The EIN itself is agency-issued: after the IRS processes the application, upload the CP 575 notice or other accepted IRS EIN confirmation to complete this requirement.",
  doc_luma_interconnection: "SmartPR prepares LUMA's customer orientation attestation for you — print it, sign it by hand, and upload the signed copy. LUMA still requires the signed document as part of its interconnection registration.",
};

export const ISSUED_DOCUMENT_GUIDANCE_ES: Record<string, string> = {
  certificate_of_incorporation: "Abre y completa aquí el formulario oficial del Departamento de Estado. Después de que la agencia acepte la radicación, sube el Certificado de Incorporación oficial para completar este requisito.",
  merchant_registration: "Completa el registro de comerciante en SURI. Después de que Hacienda emita el certificado, sube el Certificado de Registro de Comerciante oficial para completar este requisito.",
  permiso_unico: "Completa la solicitud a través del Portal Único de Negocios de OGPe o el municipio correspondiente. Después de la aprobación, sube el Permiso Único emitido para completar este requisito.",
  ein_letter: "SmartPR prepara la solicitud del Formulario SS-4 del IRS por ti. El EIN en sí lo emite la agencia: después de que el IRS procese la solicitud, sube el aviso CP 575 u otra confirmación de EIN aceptada por el IRS para completar este requisito.",
  doc_luma_interconnection: "SmartPR te prepara la Confirmación de Orientación al Cliente de LUMA — imprímela, fírmala a mano y sube la copia firmada. LUMA sigue exigiendo el documento firmado como parte de su registro de interconexión.",
};

export function getSampleApplication(requirementCode: string): SampleApplicationDefinition | null {
  return SAMPLE_APPLICATIONS[requirementCode] ?? null;
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

  doc.setFillColor(255, 247, 237);
  doc.setDrawColor(251, 146, 60);
  doc.rect(margin, y, width, 16, "FD");
  doc.setTextColor(154, 52, 18);
  doc.setFont("helvetica", "bold");
  doc.text("SAMPLE PREPARATION WORKSHEET — NOT AN OFFICIAL GOVERNMENT FILING", margin + 4, y + 6);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text(`Official proof still required: ${definition.officialOutput}`, margin + 4, y + 11);
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
  doc.text("Prepared by", margin, y + 4);
  doc.text("Date", margin + 95, y + 4);
  y += 12;
  const footer = doc.splitTextToSize(
    "SmartPR organizes application information but does not submit filings or issue approvals. Verify all information against the current official agency process before filing.",
    width
  );
  doc.text(footer, margin, y);

  return doc.output("blob");
}
