/**
 * Best-effort Assistant-panel prefill from Business Passport / _denormalized.
 * Never invents values; never prefills sensitive fields (password, MFA, SSN, …).
 * Field values must never be logged or persisted on the run.
 */
import type { AgencyPendingField } from "./types";

const SENSITIVE_ID_RE =
  /\b(password|passwd|passcode|pwd|mfa|otp|totp|2fa|ssn|itin|tax[_-]?id|secret|pin|cvv|cvc|card[_-]?number|iban|routing)\b/i;

/** True when the pending field must never be prefilled from passport. */
export function isPrefillBlocked(field: AgencyPendingField): boolean {
  if (field.sensitive) return true;
  if (field.type === "password") return true;
  const id = field.id || "";
  const label = field.label || "";
  if (SENSITIVE_ID_RE.test(id) || SENSITIVE_ID_RE.test(label)) return true;
  return false;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value === "string") {
    const t = value.trim();
    return t ? t : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function toSnake(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .toLowerCase();
}

function setIfAbsent(map: Map<string, string>, key: string, value: string): void {
  const k = key.toLowerCase();
  if (!k || map.has(k)) return;
  map.set(k, value);
}

/**
 * Flatten passport JSON (nested objects + `_denormalized`) into dotted + leaf keys.
 * Leaf keys (e.g. `email`) and dotted paths (e.g. `business.email`) both appear.
 * `_denormalized` leaves are registered first so list-view columns win on collisions.
 */
export function flattenPassportValues(
  passport: Record<string, unknown> | null | undefined
): Map<string, string> {
  const out = new Map<string, string>();
  if (!passport || typeof passport !== "object") return out;

  const visit = (node: unknown, path: string[]) => {
    if (node === null || node === undefined) return;
    if (Array.isArray(node)) {
      for (const item of node.slice(0, 8)) {
        if (typeof item === "string" || typeof item === "number") {
          const s = asNonEmptyString(item);
          if (s && path.length) {
            setIfAbsent(out, path.join("."), s);
            setIfAbsent(out, path[path.length - 1]!, s);
          }
        } else if (item && typeof item === "object") {
          visit(item, path);
        }
      }
      return;
    }
    if (typeof node === "object") {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (!k || k.startsWith("$")) continue;
        visit(v, [...path, k]);
      }
      return;
    }
    const s = asNonEmptyString(node);
    if (!s || path.length === 0) return;
    const rawDotted = path.join(".");
    const snakeParts = path.map(toSnake);
    const snakeDotted = snakeParts.join(".");
    setIfAbsent(out, rawDotted, s);
    setIfAbsent(out, snakeDotted, s);
    setIfAbsent(out, path[path.length - 1]!, s);
    setIfAbsent(out, snakeParts[snakeParts.length - 1]!, s);
  };

  const denorm = passport._denormalized;
  if (denorm && typeof denorm === "object") {
    for (const [k, v] of Object.entries(denorm as Record<string, unknown>)) {
      const s = asNonEmptyString(v);
      if (!s) continue;
      setIfAbsent(out, k, s);
      setIfAbsent(out, toSnake(k), s);
      setIfAbsent(out, `_denormalized.${toSnake(k)}`, s);
    }
  }

  for (const [k, v] of Object.entries(passport)) {
    if (k === "_denormalized") continue;
    visit(v, [k]);
  }

  // Derive first/last from contact.fullName when missing.
  const full =
    out.get("contact.fullname") ||
    out.get("fullname") ||
    out.get("contact.full_name");
  if (full) {
    const parts = full.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      setIfAbsent(out, "first_name", parts[0]!);
      setIfAbsent(out, "firstname", parts[0]!);
      setIfAbsent(out, "last_name", parts.slice(1).join(" "));
      setIfAbsent(out, "lastname", parts.slice(1).join(" "));
    }
  }

  return out;
}

function getAny(flat: Map<string, string>, keys: string[]): string | null {
  for (const key of keys) {
    const v = flat.get(key.toLowerCase());
    if (v) return v;
  }
  return null;
}

/** Concept → passport key candidates (lowercase dotted / leaf). */
const CONCEPT_KEYS: Record<string, string[]> = {
  email: [
    "email",
    "business.email",
    "contact.email",
    "owner.email",
    "business_email",
    "contact_email",
    "login_email",
    "user_email",
    "username",
  ],
  phone: [
    "phone",
    "tel",
    "mobile",
    "cellphone",
    "cell_phone",
    "business.phone",
    "contact.phone",
    "owner.phone",
    "business_phone",
    "contact_phone",
  ],
  legal_name: [
    "legal_name",
    "legalname",
    "business.legalname",
    "business.legal_name",
    "name",
    "_denormalized.legal_name",
    "_denormalized.name",
  ],
  business_name: [
    "business_name",
    "tradename",
    "trade_name",
    "business.tradename",
    "business.trade_name",
    "dba",
    "name",
    "legal_name",
    "_denormalized.name",
    "_denormalized.legal_name",
  ],
  first_name: ["first_name", "firstname", "contact.firstname", "given_name"],
  last_name: ["last_name", "lastname", "contact.lastname", "surname", "family_name"],
  full_name: [
    "full_name",
    "fullname",
    "contact.fullname",
    "contact.full_name",
    "owner_name",
    "owner.full_name",
  ],
  municipality: [
    "municipality",
    "city",
    "cityormunicipality",
    "city_or_municipality",
    "addresses.principalphysical.cityormunicipality",
    "addresses.principal_physical.city_or_municipality",
    "location.municipality",
    "_denormalized.municipality",
  ],
  postal_code: [
    "postal_code",
    "zip",
    "zipcode",
    "zip_code",
    "postalcode",
    "addresses.principalphysical.postalcode",
    "addresses.principal_physical.postal_code",
    "location.postal_code",
  ],
  state: [
    "state",
    "addresses.principalphysical.state",
    "addresses.principal_physical.state",
    "location.state",
  ],
  address: [
    "addresses.principalphysical.line1",
    "addresses.principal_physical.line1",
    "street",
    "street1",
    "line1",
    "address_line1",
    "location.physical_address",
    "address",
    "physical_address",
    "_denormalized.physical_address",
  ],
  address2: [
    "address2",
    "street2",
    "line2",
    "addresses.principalphysical.line2",
    "addresses.principal_physical.line2",
  ],
  mailing_address: [
    "mailing_address",
    "addresses.principalmailing.line1",
    "addresses.principal_mailing.line1",
    "location.mailing_address",
  ],
  entity_number: [
    "entity_number",
    "registry_number",
    "registrynumber",
    "business.registrynumber",
    "business.registry_number",
    "_denormalized.entity_number",
  ],
  ein: [
    "ein",
    "employer_id",
    "employer_identification_number",
    "federal_ein",
    "business.ein",
  ],
  entity_type: [
    "entity_type",
    "entitytype",
    "business_structure",
    "businessstructure",
    "business.entitytype",
    "business.entity_type",
    "_denormalized.business_structure",
  ],
  naics: ["naics", "naics_code", "naicscode", "business.naicscode", "business.naics_code"],
  merchant_registration: [
    "merchant_registration_number",
    "merchantregistrationnumber",
    "business.merchantregistrationnumber",
    "business.merchant_registration_number",
  ],
};

type Concept = keyof typeof CONCEPT_KEYS;

/** Map pending field id/label → concept when unambiguous. */
function resolveConcept(field: AgencyPendingField): Concept | null {
  const id = (field.id || "").toLowerCase().replace(/[\s-]+/g, "_");
  const label = (field.label || "").toLowerCase();
  const blob = `${id} ${label}`;

  if (
    id === "email" ||
    id === "business_email" ||
    id === "contact_email" ||
    id === "login_email" ||
    id === "user_email" ||
    id === "username" ||
    id.endsWith("_email")
  ) {
    return "email";
  }
  if (
    id === "phone" ||
    id === "tel" ||
    id === "mobile" ||
    id === "cellphone" ||
    id === "cell_phone" ||
    id.endsWith("_phone")
  ) {
    return "phone";
  }
  if (id === "legal_name" || id === "legalname") return "legal_name";
  if (id === "business_name" || id === "trade_name" || id === "tradename" || id === "dba") {
    return "business_name";
  }
  if (id === "name") {
    if (/business|legal|entity|company|comercio|negocio/.test(label)) return "business_name";
    if (/owner|contact|person|full|nombre completo/.test(label)) return "full_name";
    return "legal_name";
  }
  if (id === "first_name" || id === "firstname" || id === "given_name") return "first_name";
  if (id === "last_name" || id === "lastname" || id === "surname" || id === "family_name") {
    return "last_name";
  }
  if (id === "full_name" || id === "fullname" || id === "owner_name") return "full_name";
  if (id === "municipality" || id === "city") return "municipality";
  if (id === "postal_code" || id === "zip" || id === "zipcode" || id === "zip_code") {
    return "postal_code";
  }
  if (id === "state") return "state";
  if (
    id === "address" ||
    id === "street" ||
    id === "street1" ||
    id === "line1" ||
    id === "physical_address" ||
    id === "address_line1"
  ) {
    return "address";
  }
  if (id === "address2" || id === "street2" || id === "line2" || id === "address_line2") {
    return "address2";
  }
  if (id === "mailing_address") return "mailing_address";
  if (id === "entity_number" || id === "registry_number") return "entity_number";
  if (id === "ein" || id === "employer_id" || id === "fein" || id === "federal_ein") return "ein";
  if (id === "entity_type" || id === "business_structure") return "entity_type";
  if (id === "naics" || id === "naics_code") return "naics";
  if (id === "merchant_registration_number" || id === "merchant_reg") {
    return "merchant_registration";
  }

  if (/\b(e-?mail|correo)\b/.test(blob) && !/password|contrase/.test(blob)) return "email";
  if (/\b(phone|tel[eé]fono|mobile|celular|cell)\b/.test(blob)) return "phone";
  if (/\b(municipio|municipality|city|ciudad)\b/.test(blob)) return "municipality";
  if (/\b(zip|postal|c[oó]digo postal)\b/.test(blob)) return "postal_code";
  if (/\b(ein|employer id|fein)\b/.test(blob)) return "ein";
  if (/\b(legal name|nombre legal|raz[oó]n social)\b/.test(blob)) return "legal_name";
  if (/\b(trade name|dba|nombre comercial)\b/.test(blob)) return "business_name";
  if (/\b(first name|nombre)\b/.test(blob) && !/last|apellido|completo|full|negocio|legal/.test(blob)) {
    return "first_name";
  }
  if (/\b(last name|apellido|surname)\b/.test(blob)) return "last_name";
  if (/\b(full name|nombre completo)\b/.test(blob)) return "full_name";
  if (
    /\b(physical address|street|direcci[oó]n f[ií]sica|calle)\b/.test(blob) &&
    !/mail|postal|correo/.test(blob)
  ) {
    return "address";
  }
  if (/\b(mailing address|direcci[oó]n postal)\b/.test(blob)) return "mailing_address";
  if (/\b(registry|entity number|n[uú]mero de registro)\b/.test(blob)) return "entity_number";
  if (/\b(entity type|business structure|tipo de entidad)\b/.test(blob)) return "entity_type";
  if (/\bnaics\b/.test(blob)) return "naics";
  if (/\b(merchant registration|registro de comerciante)\b/.test(blob)) {
    return "merchant_registration";
  }

  return null;
}

function resolveForField(
  field: AgencyPendingField,
  flat: Map<string, string>
): string | null {
  if (isPrefillBlocked(field)) return null;

  const id = (field.id || "").trim().toLowerCase();

  const direct = getAny(flat, [
    id,
    id.replace(/_/g, ""),
    `business.${id}`,
    `contact.${id}`,
    `addresses.${id}`,
    `_denormalized.${id}`,
  ]);
  if (direct) return direct;

  const concept = resolveConcept(field);
  if (concept) {
    const fromConcept = getAny(flat, CONCEPT_KEYS[concept]);
    if (fromConcept) return fromConcept;
  }

  for (const [key, value] of flat) {
    const leaf = key.includes(".") ? key.slice(key.lastIndexOf(".") + 1) : key;
    if (leaf === id && value) return value;
  }

  return null;
}

/**
 * Map every non-sensitive pending field to a passport / _denormalized value when
 * a clear match exists. Sensitive fields are always omitted.
 */
export function prefillFromPassport(
  pendingFields: AgencyPendingField[],
  passport: Record<string, unknown> | null | undefined
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!pendingFields?.length || !passport) return out;
  const flat = flattenPassportValues(passport);
  if (flat.size === 0) return out;

  for (const field of pendingFields) {
    if (!field?.id) continue;
    if (isPrefillBlocked(field)) continue;
    const value = resolveForField(field, flat);
    if (value) out[field.id] = value;
  }
  return out;
}

/**
 * Merge user-submitted values with passport prefill for still-empty non-sensitive
 * pending fields. Submitted values always win. Used on Fill & continue so the
 * agent receives a complete fill set.
 */
export function mergeFieldsWithPassportPrefill(
  pendingFields: AgencyPendingField[],
  submitted: Record<string, string>,
  passport: Record<string, unknown> | null | undefined
): Record<string, string> {
  const fromPassport = prefillFromPassport(pendingFields, passport);
  const out: Record<string, string> = { ...fromPassport };

  for (const [id, raw] of Object.entries(submitted || {})) {
    if (typeof id !== "string" || typeof raw !== "string") continue;
    const key = id.trim();
    const val = raw.trim();
    if (!key || !val) continue;
    out[key] = val; // submitted wins
  }

  for (const [k, v] of Object.entries(out)) {
    if (!v?.trim()) delete out[k];
  }
  return out;
}
