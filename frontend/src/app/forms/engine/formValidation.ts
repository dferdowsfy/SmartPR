// ============================================================================
// Schema-driven validation and completion checking.
//
// Validation is data-driven off `ValidationRule[]` and the field/section
// visibility rules. Save Draft never runs completion validation; Complete does.
//
// Address validation (Part 1) is centralized here so the Puerto Rico
// designated-office rule ("valid PR address + postal code") is maintained in a
// single function rather than duplicated per form.
// ============================================================================

import { evaluateConditions } from "./formConditions.ts";
import type {
  CanonicalAddress,
  CanonicalApplicationData,
  DigitalFormDefinition,
  FormData,
  FormField,
  FormSection,
  Lang,
  LocalizedText,
  ValidationRule,
} from "./types.ts";
import { localize } from "./types.ts";

export interface FieldError {
  fieldId: string;
  path?: string;
  message: LocalizedText;
}

// --- Primitive validators -------------------------------------------------

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PHONE_RE = /^[+]?[-()\d\s.]{7,}$/;
const US_ZIP_RE = /^\d{5}(-\d{4})?$/;

/**
 * Puerto Rico postal codes are 006xx–009xx (five digits, optional +4).
 * Maintained here so every "PR designated office" field validates identically
 * and we can explain the specific field that is wrong — rather than repeating
 * the Department of State portal's opaque error experience.
 */
export function isValidPrPostalCode(zip: string): boolean {
  const trimmed = (zip || "").trim();
  if (!US_ZIP_RE.test(trimmed)) return false;
  const five = trimmed.slice(0, 5);
  return five >= "00600" && five <= "00999";
}

export function isPuertoRicoTerritory(state: string | undefined): boolean {
  const s = (state || "").trim().toLowerCase();
  return s === "pr" || s === "puerto rico" || s === "puertorico";
}

/**
 * Validate a Puerto Rico designated-office / operating address. Returns a list
 * of clear, field-specific errors (empty ⇒ valid).
 */
export function validatePuertoRicoAddress(addr: CanonicalAddress | undefined): FieldError[] {
  const errors: FieldError[] = [];
  if (!addr) {
    errors.push({ fieldId: "address", message: { en: "A Puerto Rico address is required.", es: "Se requiere una dirección de Puerto Rico." } });
    return errors;
  }
  if (!addr.line1 || addr.line1.trim() === "") {
    errors.push({ fieldId: "address", path: "line1", message: { en: "Street address (line 1) is required.", es: "La dirección (línea 1) es obligatoria." } });
  }
  if (!addr.cityOrMunicipality || addr.cityOrMunicipality.trim() === "") {
    errors.push({ fieldId: "address", path: "cityOrMunicipality", message: { en: "Municipality is required.", es: "El municipio es obligatorio." } });
  }
  if (addr.stateOrTerritory && !isPuertoRicoTerritory(addr.stateOrTerritory)) {
    errors.push({ fieldId: "address", path: "stateOrTerritory", message: { en: "A Puerto Rico designated office must be located in Puerto Rico (PR).", es: "La oficina designada debe estar ubicada en Puerto Rico (PR)." } });
  }
  if (!isValidPrPostalCode(addr.postalCode || "")) {
    errors.push({ fieldId: "address", path: "postalCode", message: { en: "Enter a valid Puerto Rico postal code (006xx–009xx).", es: "Ingrese un código postal válido de Puerto Rico (006xx–009xx)." } });
  }
  return errors;
}

// --- Name-designation validators (Parts 5, 9, 10) -------------------------

const CORP_SUFFIXES = ["inc", "incorporated", "corp", "corporation", "co", "company", "ltd", "limited"];
const PROF_CORP_SUFFIXES = ["p.s.c", "psc", "p.s.p", "psp", "professional", "c.s.p", "csp"];
const LLP_DESIGNATIONS = ["llp", "l.l.p", "srl", "s.r.l", "sociedad de responsabilidad limitada", "limited liability partnership"];

function nameHasToken(name: string, tokens: string[]): boolean {
  const cleaned = (name || "").toLowerCase().replace(/[.,]/g, "").replace(/\s+/g, " ").trim();
  return tokens.some((t) => {
    const token = t.replace(/[.]/g, "");
    return cleaned.split(" ").includes(token) || cleaned.includes(token);
  });
}

export function validateCorporateNameSuffix(name: string): boolean {
  return nameHasToken(name, CORP_SUFFIXES);
}
export function validateProfessionalCorpSuffix(name: string): boolean {
  return nameHasToken(name, PROF_CORP_SUFFIXES);
}
export function validateLlpDesignation(name: string): boolean {
  return nameHasToken(name, LLP_DESIGNATIONS);
}

// --- Rule engine ----------------------------------------------------------

function ruleMessage(rule: ValidationRule, fallback: LocalizedText): LocalizedText {
  return rule.message ?? fallback;
}

/** Validate one scalar value against a single rule. Returns error or null. */
export function applyRule(value: unknown, rule: ValidationRule): LocalizedText | null {
  const str = value === undefined || value === null ? "" : String(value);
  switch (rule.type) {
    case "required":
      return str.trim() === "" ? ruleMessage(rule, { en: "This field is required.", es: "Este campo es obligatorio." }) : null;
    case "email":
      return str && !EMAIL_RE.test(str) ? ruleMessage(rule, { en: "Enter a valid email address.", es: "Ingrese un correo electrónico válido." }) : null;
    case "phone":
      return str && !PHONE_RE.test(str) ? ruleMessage(rule, { en: "Enter a valid phone number.", es: "Ingrese un número de teléfono válido." }) : null;
    case "postal_code":
      return str && !US_ZIP_RE.test(str) ? ruleMessage(rule, { en: "Enter a valid postal code.", es: "Ingrese un código postal válido." }) : null;
    case "pr_postal_code":
      return str && !isValidPrPostalCode(str) ? ruleMessage(rule, { en: "Enter a valid Puerto Rico postal code (006xx–009xx).", es: "Ingrese un código postal válido de Puerto Rico." }) : null;
    case "min_length":
      return str.length < Number(rule.param) ? ruleMessage(rule, { en: `Must be at least ${rule.param} characters.`, es: `Debe tener al menos ${rule.param} caracteres.` }) : null;
    case "max_length":
      return str.length > Number(rule.param) ? ruleMessage(rule, { en: `Must be at most ${rule.param} characters.`, es: `Debe tener como máximo ${rule.param} caracteres.` }) : null;
    case "number_min":
      return value !== "" && value !== undefined && Number(value) < Number(rule.param) ? ruleMessage(rule, { en: `Must be at least ${rule.param}.`, es: `Debe ser al menos ${rule.param}.` }) : null;
    case "number_max":
      return value !== "" && value !== undefined && Number(value) > Number(rule.param) ? ruleMessage(rule, { en: `Must be at most ${rule.param}.`, es: `Debe ser como máximo ${rule.param}.` }) : null;
    case "regex":
      return str && !new RegExp(String(rule.param)).test(str) ? ruleMessage(rule, { en: "Invalid format.", es: "Formato inválido." }) : null;
    case "corporate_name_suffix":
      return str && !validateCorporateNameSuffix(str) ? ruleMessage(rule, { en: "The corporate name must include an accepted corporate term or abbreviation (e.g. Inc., Corp., Corporation).", es: "El nombre debe incluir un término o abreviatura corporativa aceptada (p. ej. Inc., Corp., Corporation)." }) : null;
    case "professional_corp_suffix":
      return str && !validateProfessionalCorpSuffix(str) ? ruleMessage(rule, { en: "The name must include an accepted professional corporation abbreviation (e.g. P.S.C.).", es: "El nombre debe incluir una abreviatura de corporación profesional aceptada (p. ej. P.S.C.)." }) : null;
    case "llp_designation":
      return str && !validateLlpDesignation(str) ? ruleMessage(rule, { en: "The name must include the required LLP / SRL designation.", es: "El nombre debe incluir la designación requerida de LLP / SRL." }) : null;
    case "future_within_days": {
      // Validated relationally elsewhere (needs the filing date); no-op here.
      return null;
    }
    default:
      return null;
  }
}

/**
 * Validate a future effective date is not more than `days` after the intended
 * filing date (Part 5/7 90-day rule). `filingDate` defaults to today.
 */
export function validateFutureWithinDays(
  futureDate: string | undefined,
  days: number,
  filingDate?: string
): boolean {
  if (!futureDate) return true;
  const future = new Date(futureDate).getTime();
  const base = filingDate ? new Date(filingDate).getTime() : Date.now();
  if (Number.isNaN(future) || Number.isNaN(base)) return false;
  if (future < base) return false;
  const diffDays = (future - base) / (1000 * 60 * 60 * 24);
  return diffDays <= days;
}

function isFieldRequired(field: FormField, formData: FormData, canonical?: CanonicalApplicationData): boolean {
  if (field.required) return true;
  if (field.requiredWhen && field.requiredWhen.length > 0) {
    return evaluateConditions(field.requiredWhen, formData, canonical);
  }
  return false;
}

function visibleFields(section: FormSection, formData: FormData, canonical?: CanonicalApplicationData): FormField[] {
  if (!evaluateConditions(section.visibleWhen, formData, canonical)) return [];
  return section.fields.filter((f) => evaluateConditions(f.visibleWhen, formData, canonical));
}

/**
 * Full completion validation across the whole definition. Only visible fields
 * are validated, so conditionally-hidden sections never block completion.
 */
export function validateForm(
  def: DigitalFormDefinition,
  formData: FormData,
  canonical?: CanonicalApplicationData
): FieldError[] {
  const errors: FieldError[] = [];

  for (const section of def.sections) {
    for (const field of visibleFields(section, formData, canonical)) {
      const value = (formData as Record<string, unknown>)[field.id];
      const required = isFieldRequired(field, formData, canonical);

      // Repeatable minimum-items check.
      if (field.type === "repeatable") {
        const items = Array.isArray(value) ? value : [];
        const min = field.minimumItems ?? (required ? 1 : 0);
        if (items.length < min) {
          errors.push({ fieldId: field.id, message: field.label ? { en: `Add at least ${min} ${localize(field.label, "en").toLowerCase()}.`, es: `Agregue al menos ${min}.` } : { en: `Add at least ${min} item(s).` } });
        }
        continue;
      }

      // Structured address.
      if (field.type === "address") {
        const addr = value as CanonicalAddress | undefined;
        if (required && (!addr || !addr.line1)) {
          errors.push({ fieldId: field.id, message: field.label ?? { en: "Address is required." } });
        }
        // PR-office fields opt in via a pr_postal_code rule.
        if (addr && field.validation?.some((r) => r.type === "pr_postal_code")) {
          for (const e of validatePuertoRicoAddress(addr)) {
            errors.push({ fieldId: field.id, path: e.path, message: e.message });
          }
        }
        continue;
      }

      // Attestation / checkbox required.
      if ((field.type === "attestation" || field.type === "checkbox") && required) {
        if (value !== true) {
          errors.push({ fieldId: field.id, message: field.label ?? { en: "This acknowledgement is required." } });
        }
        continue;
      }

      // Required scalar.
      if (required && (value === undefined || value === null || String(value).trim() === "")) {
        errors.push({ fieldId: field.id, message: field.label ?? { en: "This field is required." } });
        continue;
      }

      // Field-level validation rules (only when a value is present or required).
      if (field.validation && (required || (value !== undefined && value !== null && value !== ""))) {
        for (const rule of field.validation) {
          const msg = applyRule(value, rule);
          if (msg) errors.push({ fieldId: field.id, message: msg });
        }
      }
    }
  }

  // Required attestations declared at the form level.
  for (const att of def.attestations ?? []) {
    if (att.required && (formData as Record<string, unknown>)[att.id] !== true) {
      errors.push({ fieldId: att.id, message: att.label });
    }
  }

  // Required attachments.
  for (const att of def.attachments ?? []) {
    const req = att.required || evaluateConditions(att.requiredWhen, formData, canonical);
    if (req && !(formData as Record<string, unknown>)[att.id]) {
      errors.push({ fieldId: att.id, message: att.label });
    }
  }

  return errors;
}

/** Convenience: human-readable list of missing/invalid field labels. */
export function completionErrorLabels(errors: FieldError[], lang: Lang): string[] {
  return errors.map((e) => localize(e.message, lang));
}
