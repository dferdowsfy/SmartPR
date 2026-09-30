/**
 * Passport paths a teacher can map a portal field to, with the words that
 * usually name them on a PR government form (EN + ES). Paths follow the
 * Business Passport JSON (CanonicalApplicationData) the replay reads from.
 *
 * `proposeMapping` guesses from the portal label and the recorder's value
 * kind (never the value itself). It only ever proposes — the teacher
 * confirms, corrects, or says "ask me each time".
 */
import type { TeachValueKind } from "./events";

export interface PassportCatalogEntry {
  path: string;
  en: string;
  es: string;
  /** Lower-case, accent-free words/phrases that name this field on forms. */
  keywords: string[];
  /** Value kinds this field typically holds; used to break ties. */
  kinds: TeachValueKind[];
  /** true for yes/no or enum facts a screen can be conditional on. */
  branchable?: boolean;
}

export const PASSPORT_CATALOG: PassportCatalogEntry[] = [
  { path: "business.legalName", en: "Business legal name", es: "Nombre legal del negocio",
    keywords: ["nombre legal", "legal name", "razon social", "nombre de la entidad", "entity name", "nombre de la corporacion", "nombre de la compania", "business name", "nombre del negocio"],
    kinds: ["text"] },
  { path: "business.tradeName", en: "Trade name (DBA)", es: "Nombre comercial (DBA)",
    keywords: ["nombre comercial", "trade name", "dba", "doing business as", "nombre de fantasia"], kinds: ["text"] },
  { path: "business.entityType", en: "Entity type", es: "Tipo de entidad",
    keywords: ["tipo de entidad", "entity type", "tipo de organizacion", "tipo de negocio", "business type", "estructura"],
    kinds: ["option", "text"], branchable: true },
  { path: "business.ein", en: "EIN (federal employer ID)", es: "Seguro social patronal (EIN)",
    keywords: ["ein", "seguro social patronal", "employer identification", "numero patronal", "federal tax id"], kinds: ["number", "text"] },
  { path: "business.registryNumber", en: "Department of State registry number", es: "Número de registro del Departamento de Estado",
    keywords: ["numero de registro", "registry number", "registro de corporaciones", "numero de entidad", "entity number"], kinds: ["number", "text"] },
  { path: "business.merchantRegistrationNumber", en: "Merchant registration number (Hacienda)", es: "Número de Registro de Comerciante",
    keywords: ["registro de comerciante", "merchant registration", "numero de comerciante"], kinds: ["number", "text"] },
  { path: "business.naicsCode", en: "NAICS code", es: "Código NAICS",
    keywords: ["naics", "codigo de industria", "industry code"], kinds: ["number", "option", "text"] },
  { path: "business.activityDescription", en: "Business activity", es: "Actividad del negocio",
    keywords: ["actividad", "activity", "descripcion del negocio", "business description", "proposito", "purpose", "uso propuesto"], kinds: ["text"] },
  { path: "business.incorporationDate", en: "Formation date", es: "Fecha de incorporación",
    keywords: ["fecha de incorporacion", "fecha de formacion", "incorporation date", "formation date", "fecha de organizacion"], kinds: ["date"] },
  { path: "business.operationsStartDate", en: "Operations start date", es: "Fecha de inicio de operaciones",
    keywords: ["inicio de operaciones", "start date", "fecha de inicio", "comenzo operaciones"], kinds: ["date"] },
  { path: "business.email", en: "Business email", es: "Email del negocio",
    keywords: ["email del negocio", "business email", "correo del negocio", "correo electronico del negocio"], kinds: ["email"] },
  { path: "business.phone", en: "Business phone", es: "Teléfono del negocio",
    keywords: ["telefono del negocio", "business phone", "telefono comercial"], kinds: ["phone"] },
  { path: "contact.fullName", en: "Contact name", es: "Nombre de contacto",
    keywords: ["nombre de contacto", "contact name", "persona contacto", "nombre completo", "full name", "solicitante", "applicant", "nombre del dueno"], kinds: ["text"] },
  { path: "contact.email", en: "Contact email", es: "Email de contacto",
    keywords: ["email", "e-mail", "correo electronico", "correo", "email address"], kinds: ["email"] },
  { path: "contact.phone", en: "Contact phone", es: "Teléfono de contacto",
    keywords: ["telefono", "phone", "celular", "mobile", "tel"], kinds: ["phone"] },
  { path: "contact.role", en: "Contact's role", es: "Puesto del contacto",
    keywords: ["puesto", "cargo", "title", "role", "titulo"], kinds: ["text", "option"] },
  { path: "addresses.principalPhysical.line1", en: "Physical address", es: "Dirección física",
    keywords: ["direccion fisica", "physical address", "direccion", "address", "calle", "street", "direccion del local", "direccion del establecimiento", "linea 1", "address line 1"], kinds: ["text"] },
  { path: "addresses.principalPhysical.line2", en: "Physical address line 2", es: "Dirección física línea 2",
    keywords: ["linea 2", "address line 2", "apartamento", "suite", "apt", "urbanizacion"], kinds: ["text"] },
  { path: "addresses.municipality", en: "Municipality", es: "Municipio",
    keywords: ["municipio", "municipality", "pueblo", "ciudad", "city", "town"], kinds: ["option", "text"], branchable: true },
  { path: "addresses.principalPhysical.postalCode", en: "Postal code", es: "Código postal",
    keywords: ["codigo postal", "zip", "zip code", "postal code", "zipcode"], kinds: ["postal", "number"] },
  { path: "addresses.principalMailing.line1", en: "Mailing address", es: "Dirección postal",
    keywords: ["direccion postal", "mailing address", "direccion de correo", "po box", "apartado"], kinds: ["text"] },
  { path: "addresses.principalMailing.postalCode", en: "Mailing postal code", es: "Código postal (dirección postal)",
    keywords: ["codigo postal postal", "mailing zip", "mailing postal code"], kinds: ["postal", "number"] },
  { path: "property.cadastralNumber", en: "Cadastral number (catastro)", es: "Número de catastro",
    keywords: ["catastro", "numero de catastro", "cadastral", "parcel", "parcela"], kinds: ["number", "text"] },
  { path: "property.squareFootage", en: "Square footage", es: "Pies cuadrados",
    keywords: ["pies cuadrados", "square feet", "square footage", "area", "tamano del local"], kinds: ["number"] },
  { path: "property.occupancyType", en: "Owned or leased", es: "Propio o alquilado",
    keywords: ["propio o alquilado", "owned or leased", "tenencia", "arrendado", "alquilado", "propietario"], kinds: ["option"], branchable: true },
  { path: "operations.employeeCount", en: "Number of employees", es: "Cantidad de empleados",
    keywords: ["empleados", "employees", "numero de empleados", "cantidad de empleados", "headcount"], kinds: ["number"], branchable: true },
  { path: "operations.estimatedAnnualGrossReceipts", en: "Estimated annual gross receipts", es: "Volumen de negocio anual estimado",
    keywords: ["volumen de negocio", "gross receipts", "ingresos brutos", "ventas anuales"], kinds: ["number"] },
  { path: "operations.municipalTaxpayerId", en: "Municipal taxpayer ID", es: "Número de contribuyente municipal",
    keywords: ["contribuyente municipal", "municipal taxpayer", "numero de patente", "cuenta de patente"], kinds: ["number", "text"] },
  { path: "activities.foodService", en: "Serves food", es: "Sirve comida",
    keywords: ["alimentos", "comida", "food service", "sirve comida"], kinds: ["option"], branchable: true },
  { path: "activities.alcoholSales", en: "Sells alcohol", es: "Vende bebidas alcohólicas",
    keywords: ["alcohol", "bebidas alcoholicas", "licores"], kinds: ["option"], branchable: true },
  { path: "activities.signage", en: "Has signage", es: "Tiene rótulos",
    keywords: ["rotulo", "rotulos", "signage", "letrero"], kinds: ["option"], branchable: true },
];

const BY_PATH = new Map(PASSPORT_CATALOG.map((e) => [e.path, e]));

export function catalogEntry(path: string): PassportCatalogEntry | undefined {
  return BY_PATH.get(path);
}

/** Lower-case and strip accents/punctuation so "Teléfono:" matches "telefono". */
export function normalizeLabel(label: string): string {
  return label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface MappingProposal {
  path: string;
  en: string;
  es: string;
  /** "high" = a keyword phrase matched; "low" = only the value kind fit. */
  confidence: "high" | "low";
}

/**
 * Best passport path for a portal field label. Longer keyword matches win
 * (so "email del negocio" beats "email"); the value kind breaks ties and,
 * alone, gives a low-confidence guess for email/phone/postal fields.
 */
export function proposeMapping(label: string, kind: TeachValueKind): MappingProposal | null {
  const text = ` ${normalizeLabel(label)} `;
  let best: { entry: PassportCatalogEntry; score: number } | null = null;
  for (const entry of PASSPORT_CATALOG) {
    for (const kw of entry.keywords) {
      if (!text.includes(` ${kw} `)) continue;
      const score = kw.length * 10 + (entry.kinds.includes(kind) ? 5 : 0);
      if (!best || score > best.score) best = { entry, score };
    }
  }
  if (best) return { path: best.entry.path, en: best.entry.en, es: best.entry.es, confidence: "high" };
  const byKind: Partial<Record<TeachValueKind, string>> = {
    email: "contact.email",
    phone: "contact.phone",
    postal: "addresses.principalPhysical.postalCode",
  };
  const path = byKind[kind];
  const entry = path ? BY_PATH.get(path) : undefined;
  return entry ? { path: entry.path, en: entry.en, es: entry.es, confidence: "low" } : null;
}

/** Read a dotted path from a passport object. */
export function readPassportPath(passport: unknown, path: string): unknown {
  let node: unknown = passport;
  for (const part of path.split(".")) {
    if (node == null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}
