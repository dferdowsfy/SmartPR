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
  /**
   * Protected detail (SSN / ITIN): stored encrypted outside passport_json,
   * masked everywhere, read only at fill time. Never in a routine, log,
   * recording, screenshot or model prompt.
   */
  sensitive?: boolean;
  /** Only relevant when another Passport detail has one of these values (e.g. LLC member count). */
  when?: { path: string; equals: string[] };
}

export const PASSPORT_CATALOG: PassportCatalogEntry[] = [
  { path: "business.legalName", en: "Business legal name", es: "Nombre legal del negocio",
    keywords: ["nombre legal", "legal name", "razon social", "nombre de la entidad", "entity name", "nombre de la corporacion", "nombre de la compania", "business name", "nombre del negocio"],
    kinds: ["text"] },
  { path: "business.tradeName", en: "Trade name (DBA)", es: "Nombre comercial (DBA)",
    keywords: ["nombre comercial", "trade name", "dba", "doing business as", "nombre de fantasia"], kinds: ["text"] },
  { path: "business.entityType", en: "Entity type", es: "Tipo de entidad",
    keywords: ["tipo de entidad", "entity type", "tipo de organizacion", "tipo de negocio", "business type", "estructura", "legal structure", "type of legal structure", "choose type of legal structure", "estructura legal", "type of organization", "type of entity", "tipo de estructura"],
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
  { path: "contact.firstName", en: "First name", es: "Primer nombre",
    keywords: ["primer nombre", "first name", "nombre de pila", "given name"], kinds: ["text"] },
  { path: "contact.middleName", en: "Middle name", es: "Segundo nombre",
    keywords: ["segundo nombre", "middle name", "middle initial", "inicial"], kinds: ["text"] },
  { path: "contact.lastName", en: "Last name", es: "Primer apellido",
    keywords: ["primer apellido", "apellido paterno", "last name", "surname", "family name", "apellido"], kinds: ["text"] },
  { path: "contact.taxId", en: "SSN or ITIN", es: "Seguro social o ITIN",
    keywords: ["ssn", "itin", "seguro social", "social security", "social security number", "numero de seguro social", "taxpayer identification number", "ssn or itin", "ssn itin"],
    kinds: ["text", "number"], sensitive: true },
  { path: "contact.secondLastName", en: "Second last name", es: "Segundo apellido",
    keywords: ["segundo apellido", "apellido materno", "second last name", "mother s maiden name"], kinds: ["text"] },
  { path: "contact.email", en: "Contact email", es: "Email de contacto",
    keywords: ["email", "e-mail", "correo electronico", "correo", "email address"], kinds: ["email"] },
  { path: "contact.phone", en: "Contact phone", es: "Teléfono de contacto",
    keywords: ["telefono", "phone", "celular", "mobile", "tel"], kinds: ["phone"] },
  { path: "contact.role", en: "Contact's role", es: "Puesto del contacto",
    keywords: ["puesto", "cargo", "title", "role", "titulo", "responsible party role", "your role"], kinds: ["text", "option"] },
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
  { path: "operations.fiscalYearEnd", en: "Accounting year closing month", es: "Mes de cierre del año contable",
    keywords: ["closing month", "accounting year", "fiscal year", "cierre del ano contable", "mes de cierre", "ano fiscal", "closing month of accounting year"], kinds: ["option", "text"] },
  { path: "business.llcMemberCount", en: "Number of LLC members", es: "Cantidad de miembros de la LLC",
    keywords: ["number of members", "members of the llc", "llc members", "cantidad de miembros", "numero de miembros"], kinds: ["number", "option"],
    when: { path: "business.entityType", equals: ["llc", "limited_liability_company"] } },
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

/** True when a catalog detail applies to this Passport (conditional details like LLC member count). */
export function catalogEntryApplies(entry: PassportCatalogEntry, passport: unknown): boolean {
  if (!entry.when) return true;
  const v = readPassportPath(passport, entry.when.path);
  return typeof v === "string" && entry.when.equals.includes(v.toLowerCase());
}

/**
 * New Passport details Clara discovers (no catalog mapping yet) live under
 * business.additional.<slug>, so they persist with the Passport and are
 * reusable by later filings. The slug comes from the portal label only.
 */
export const ADDITIONAL_PREFIX = "business.additional.";
export function additionalDetailPath(label: string): string | null {
  const slug = normalizeLabel(label).replace(/ñ/g, "n").split(" ").filter(Boolean).slice(0, 6).join("_").slice(0, 48);
  return slug ? `${ADDITIONAL_PREFIX}${slug}` : null;
}
export function isAdditionalPath(path: string): boolean {
  return path.startsWith(ADDITIONAL_PREFIX) && /^[a-z0-9_]{1,48}$/.test(path.slice(ADDITIONAL_PREFIX.length));
}

/**
 * A protected detail's value never sits in passport_json; only a marker in
 * the same section does ("contact.taxIdOnFile" + "contact.taxIdLast4"), so it
 * survives every Passport save and tells Clara the value exists.
 */
export function protectedMarkerPaths(path: string): { onFile: string; last4: string } {
  return { onFile: `${path}OnFile`, last4: `${path}Last4` };
}

/** Whether the Passport has this detail (protected details: the on-file marker). */
export function passportHas(passport: unknown, path: string): boolean {
  if (catalogEntry(path)?.sensitive) return readPassportPath(passport, protectedMarkerPaths(path).onFile) === true;
  const v = readPassportPath(passport, path);
  return v !== undefined && v !== null && v !== "" && typeof v !== "object";
}

/** Set a dotted path on a plain object (creating sections as needed). Returns the same object. */
export function setPassportPath<T extends Record<string, unknown>>(passport: T, path: string, value: unknown): T {
  const parts = path.split(".");
  let node: Record<string, unknown> = passport;
  for (const part of parts.slice(0, -1)) {
    const next = node[part];
    if (next == null || typeof next !== "object" || Array.isArray(next)) node[part] = {};
    node = node[part] as Record<string, unknown>;
  }
  node[parts.at(-1)!] = value;
  return passport;
}

/**
 * Canonical Passport entity type for an option a portal shows
 * ("Limited Liability Company (LLC)" → limited_liability_company). null when
 * the option isn't a business entity SmartPR tracks (Estate, Trusts …).
 */
export function entityTypeForOption(label: string): string | null {
  const t = normalizeLabel(label);
  if (/limited liability partnership|\bllp\b|sociedad de responsabilidad limitada/.test(t)) return "limited_liability_partnership";
  if (/limited liability compan|\bllc\b|compania de responsabilidad limitada/.test(t)) return "limited_liability_company";
  if (/sole proprietor|individuo|persona natural|empresa individual/.test(t)) return "sole_proprietorship";
  if (/non ?profit|tax exempt|sin fines de lucro/.test(t)) return "nonprofit_nonstock_corporation";
  if (/partnership|sociedad/.test(t)) return "partnership";
  if (/corporation|corporacion/.test(t)) return "stock_corporation";
  return null;
}

/** Entity types that portals usually group under one "Corporations" option. */
const CORPORATION_FAMILY = new Set(["stock_corporation", "close_corporation", "professional_corporation", "corporation", "foreign_corporation"]);

/**
 * The option on the page that matches a Passport value (labels only).
 * Entity types match by meaning; anything else by its text.
 */
export function optionForPassportValue(path: string, value: unknown, options: { label: string }[]): string | null {
  if (value === undefined || value === null || value === "" || typeof value === "object") return null;
  const v = String(value).toLowerCase();
  if (path === "business.entityType") {
    const want = v === "llc" ? "limited_liability_company" : CORPORATION_FAMILY.has(v) ? "stock_corporation" : v;
    const hit = options.find((o) => entityTypeForOption(o.label) === want);
    return hit ? hit.label : null;
  }
  const n = normalizeLabel(String(value));
  const exact = options.find((o) => normalizeLabel(o.label) === n);
  if (exact) return exact.label;
  const partial = options.filter((o) => n && (normalizeLabel(o.label).startsWith(n) || n.startsWith(normalizeLabel(o.label))));
  return partial.length === 1 ? partial[0].label : null;
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
