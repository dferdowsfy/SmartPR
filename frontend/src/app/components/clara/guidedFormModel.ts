// The guided in-platform form for a requirement that has no dedicated
// SmartPR form: generated from the requirement's "What you'll need" list,
// with the business's details prefilled (Passport / intake profile). Pure —
// the modal (GuidedRequirementForm.tsx) renders it; tests assert on it.

type Language = "en" | "es";

/** Prefill keys the intake profile / Business Passport can supply. */
export type PrefillKey = "legalName" | "tradeName" | "ein" | "address" | "municipality" | "contactName" | "email" | "phone" | "projectDescription";
export type Prefill = Partial<Record<PrefillKey, string>>;

export interface GuidedSubject {
  /** Stable key: engine document id, energy process id, or requirement code. */
  key: string;
  name: string;
  agency?: string | null;
  /** "What you'll need" — one field per item. */
  needs?: string[];
  /** Official portal (⋯ menu / Teach Clara prefill), never the primary action. */
  portalUrl?: string | null;
  portalLabel?: string | null;
}

export type GuidedFieldKind = "text" | "textarea" | "document";

export interface GuidedField {
  id: string;
  label: string;
  kind: GuidedFieldKind;
  prefill?: PrefillKey;
  required: boolean;
  hint?: string;
}

export interface GuidedSection {
  id: "business" | "project" | "needs" | "notes";
  title: string;
  fields: GuidedField[];
}

const DOC_WORDS = /\b(plans?|stud(y|ies)|reports?|certificat(e|es|ion)|permits?|letters?|maps?|drawings?|surveys?|deeds?|lease|title|proof|cop(y|ies)|evidence|licen[cs]es?|insurance|polic(y|ies)|statements?|pdf|agreements?|contracts?|applications?|proposals?|declarations?|ownership|planos?|estudios?|informes?|certificad[oa]s?|certificaci[oó]n|permisos?|cartas?|mapas?|escrituras?|contratos?|evidencias?|licencias?|p[oó]lizas?|propuestas?|declaraci[oó]n|solicitud(es)?|acuerdos?|copias?|titularidad|arrendamiento)\b/i;

/** Whether a "What you'll need" item asks for a document (upload) or an answer (text). */
export function needIsDocument(need: string): boolean {
  return DOC_WORDS.test(need);
}

function slug(s: string, i: number): string {
  const base = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40);
  return `need_${i + 1}_${base || "item"}`;
}

const SITE_AGENCY = /\b(ogpe|jp|junta de planificaci|planning|municip|dea|environment|ambiental|bomberos|fire|luma|preb|energ|negociado|calidad ambiental|drna|construction|construcci)/i;
const TAX_AGENCY = /\b(hacienda|suri|irs|tax|crim|estado|state|department of state|departamento de estado|cfse|dtrh|labor)/i;

/** Sections of the guided form for a requirement. */
export function guidedFormSections(subject: GuidedSubject, language: Language): GuidedSection[] {
  const es = language === "es";
  const T = (en: string, sp: string) => (es ? sp : en);
  const who = `${subject.agency ?? ""} ${subject.name}`;
  const business: GuidedField[] = [
    { id: "legal_name", label: T("Business legal name", "Nombre legal del negocio"), kind: "text", prefill: "legalName", required: true },
    { id: "trade_name", label: T("Trade name (DBA)", "Nombre comercial (DBA)"), kind: "text", prefill: "tradeName", required: false },
  ];
  if (TAX_AGENCY.test(who)) business.push({ id: "ein", label: T("EIN (federal employer ID)", "Seguro social patronal (EIN)"), kind: "text", prefill: "ein", required: false, hint: T("Only the business's EIN — never an SSN.", "Solo el EIN del negocio — nunca un seguro social.") });
  business.push(
    { id: "address", label: T("Business address", "Dirección del negocio"), kind: "text", prefill: "address", required: true },
    { id: "municipality", label: T("Municipality", "Municipio"), kind: "text", prefill: "municipality", required: true },
    { id: "contact_name", label: T("Contact person", "Persona contacto"), kind: "text", prefill: "contactName", required: true },
    { id: "email", label: T("Contact email", "Correo electrónico"), kind: "text", prefill: "email", required: true },
    { id: "phone", label: T("Contact phone", "Teléfono"), kind: "text", prefill: "phone", required: false },
  );
  const sections: GuidedSection[] = [{ id: "business", title: T("Business details", "Datos del negocio"), fields: business }];
  if (SITE_AGENCY.test(who)) {
    sections.push({
      id: "project",
      title: T("Project and site", "Proyecto y lugar"),
      fields: [
        { id: "project_description", label: T("What the project is", "Qué es el proyecto"), kind: "textarea", prefill: "projectDescription", required: true },
        { id: "site_address", label: T("Site address", "Dirección del lugar"), kind: "text", prefill: "address", required: true },
        { id: "parcel", label: T("Parcel (catastro) number", "Número de catastro"), kind: "text", required: false },
      ],
    });
  }
  const needs = (subject.needs ?? []).map((n) => n.trim()).filter(Boolean);
  const needFields: GuidedField[] = needs.length
    ? needs.map((n, i) => ({ id: slug(n, i), label: n, kind: needIsDocument(n) ? "document" : "textarea", required: true }))
    : [
        { id: "documents", label: T("Documents the agency asks for", "Documentos que pide la agencia"), kind: "document", required: false },
        { id: "answers", label: T("What the agency asked (in your words)", "Lo que pide la agencia (en tus palabras)"), kind: "textarea", required: false },
      ];
  sections.push({ id: "needs", title: T("What you'll need", "Lo que necesitarás"), fields: needFields });
  sections.push({ id: "notes", title: T("Notes", "Notas"), fields: [{ id: "notes", label: T("Anything Clara or your reviewer should know", "Algo que Clara o tu revisor deba saber"), kind: "textarea", required: false }] });
  return sections;
}

export interface GuidedDraft {
  values: Record<string, string>;
  /** Document fields: the files attached (names only on this device). */
  files: Record<string, { name: string; size: number }[]>;
  /** "I have it" for a document field. */
  have: Record<string, boolean>;
  status: "draft" | "ready";
  updatedAt: string;
}

export function emptyDraft(sections: GuidedSection[], prefill: Prefill): GuidedDraft {
  const values: Record<string, string> = {};
  for (const s of sections) for (const f of s.fields) if (f.prefill && prefill[f.prefill]) values[f.id] = prefill[f.prefill]!;
  return { values, files: {}, have: {}, status: "draft", updatedAt: new Date(0).toISOString() };
}

/** Required fields answered / total (a document counts when attached or marked "I have it"). */
export function guidedProgress(sections: GuidedSection[], d: GuidedDraft): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const s of sections) for (const f of s.fields) {
    if (!f.required) continue;
    total++;
    if (f.kind === "document" ? (d.files[f.id]?.length ?? 0) > 0 || d.have[f.id] : (d.values[f.id] ?? "").trim()) done++;
  }
  return { done, total };
}

export function draftStorageKey(businessId: string | null | undefined, key: string): string {
  return `smartpr.guided.v1.${businessId || "local"}.${key}`;
}
