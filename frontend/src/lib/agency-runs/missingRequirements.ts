/**
 * Missing requirements for one Clara workflow (client-safe, pure).
 *
 * A workflow is "not ready" only because of ITS OWN blockers: the
 * non-sensitive Passport coverage keys its filing config needs that are not on
 * file, plus prior filings it depends on (agencyActions.actionForConfig →
 * filingStatusFor). Global Passport completeness never gates a workflow.
 *
 * This module turns those blockers into the inline completion form:
 *  - missingFieldsFor: only the editable, missing fields for that workflow
 *    (sensitive values are never asked here — Clara collects them in masked
 *    one-time cards during the run).
 *  - validateMissingValue: SmartPR's existing validators (formValidation).
 *  - passportPatchFor: the canonical Business Passport shape
 *    (CanonicalApplicationData) written through PATCH /api/businesses/[id]
 *    with mergePassport — the same store the full Passport page edits. No
 *    Clara-specific copy of any value is kept.
 */
import type { FilingOption } from "./agencyActions";
import { CANONICAL_LABELS } from "./canonicalFields";
import { EMAIL_RE, PHONE_RE, isValidPrPostalCode } from "../../app/forms/engine/formValidation";

type Bi = { en: string; es: string };

export type MissingFieldKind = "text" | "email" | "phone" | "ein" | "postal" | "select";

export interface MissingFieldSpec {
  /** Coverage key the filing config names (e.g. "business.ein"). */
  key: string;
  /** Dotted path written into the canonical Passport. */
  path: string;
  kind: MissingFieldKind;
  label: Bi;
  help?: Bi;
  options?: { value: string; label: Bi }[];
  autoComplete?: string;
}

const ENTITY_TYPES: { value: string; label: Bi }[] = [
  { value: "limited_liability_company", label: { en: "Limited liability company (LLC)", es: "Compañía de responsabilidad limitada (LLC)" } },
  { value: "stock_corporation", label: { en: "Corporation", es: "Corporación" } },
  { value: "close_corporation", label: { en: "Close corporation", es: "Corporación íntima" } },
  { value: "professional_corporation", label: { en: "Professional corporation", es: "Corporación profesional" } },
  { value: "nonprofit_nonstock_corporation", label: { en: "Nonprofit corporation", es: "Corporación sin fines de lucro" } },
  { value: "foreign_corporation", label: { en: "Foreign corporation", es: "Corporación foránea" } },
  { value: "limited_liability_partnership", label: { en: "Limited liability partnership (LLP)", es: "Sociedad de responsabilidad limitada (LLP)" } },
  { value: "partnership", label: { en: "Partnership", es: "Sociedad" } },
  { value: "sole_proprietorship", label: { en: "Sole proprietorship", es: "Individuo / negocio propio" } },
];

/** Where each coverage key lives in the canonical Passport, and its control. */
const SPECS: Record<string, Omit<MissingFieldSpec, "key" | "label">> = {
  "business.legalName": { path: "business.legalName", kind: "text", autoComplete: "organization" },
  "business.tradeName": { path: "business.tradeName", kind: "text", help: { en: "The name customers see (DBA). Repeat the legal name if you don't use another.", es: "El nombre que ven tus clientes. Repite el nombre legal si no usas otro." } },
  "business.entityType": { path: "business.entityType", kind: "select", options: ENTITY_TYPES },
  "business.ein": { path: "business.ein", kind: "ein", help: { en: "9 digits, e.g. 66-1234567", es: "9 dígitos, ej. 66-1234567" } },
  "business.registryNumber": { path: "business.registryNumber", kind: "text", help: { en: "Your Department of State registry number", es: "Tu número de registro del Departamento de Estado" } },
  "contact.fullName": { path: "contact.fullName", kind: "text", autoComplete: "name" },
  "contact.email": { path: "contact.email", kind: "email", autoComplete: "email" },
  "contact.phone": { path: "contact.phone", kind: "phone", autoComplete: "tel" },
  "addresses.principalPhysical.line1": { path: "addresses.principalPhysical.line1", kind: "text", autoComplete: "address-line1" },
  "addresses.principalPhysical.line2": { path: "addresses.principalPhysical.line2", kind: "text", autoComplete: "address-line2" },
  "addresses.principalPhysical.postalCode": { path: "addresses.principalPhysical.postalCode", kind: "postal", autoComplete: "postal-code", help: { en: "Puerto Rico ZIP, e.g. 00901", es: "Código postal de Puerto Rico, ej. 00901" } },
  "addresses.municipality": { path: "addresses.municipality", kind: "text", autoComplete: "address-level2" },
  "addresses.state": { path: "addresses.principalPhysical.stateOrTerritory", kind: "text", autoComplete: "address-level1" },
};

export function specForKey(key: string): MissingFieldSpec {
  const lbl = CANONICAL_LABELS[key];
  const base = SPECS[key] ?? { path: key, kind: "text" as const };
  return { key, label: lbl ? { en: lbl.en, es: lbl.es } : { en: key, es: key }, ...base };
}

/** Only the editable fields this workflow is missing (never sensitive ones). */
export function missingFieldsFor(f: FilingOption): MissingFieldSpec[] {
  const seen = new Set<string>();
  const out: MissingFieldSpec[] = [];
  for (const m of f.action?.missing_items ?? []) {
    if (m.sensitive || seen.has(m.id)) continue;
    seen.add(m.id);
    const spec = specForKey(m.id);
    out.push(CANONICAL_LABELS[m.id] ? spec : { ...spec, label: { en: m.label_en, es: m.label_es } });
  }
  return out;
}

/** What blocks the workflow from starting: missing fields + prerequisite filings. */
export function blockerCount(f: FilingOption): number {
  return missingFieldsFor(f).length + (f.action?.blocked_by.length ?? 0);
}

/** null when valid; otherwise a localized error. Required: every field here. */
export function validateMissingValue(spec: MissingFieldSpec, raw: string): Bi | null {
  const v = raw.trim();
  if (!v) return { en: "This field is required.", es: "Este campo es obligatorio." };
  switch (spec.kind) {
    case "email":
      return EMAIL_RE.test(v) ? null : { en: "Enter a valid email address.", es: "Escribe un correo electrónico válido." };
    case "phone":
      return PHONE_RE.test(v) && v.replace(/\D/g, "").length >= 7 ? null : { en: "Enter a valid phone number.", es: "Escribe un número de teléfono válido." };
    case "ein":
      return /^\d{2}-?\d{7}$/.test(v) ? null : { en: "An EIN has 9 digits (e.g. 66-1234567).", es: "El EIN tiene 9 dígitos (ej. 66-1234567)." };
    case "postal":
      return isValidPrPostalCode(v) ? null : { en: "Enter a Puerto Rico ZIP code (006xx–009xx).", es: "Escribe un código postal de Puerto Rico (006xx–009xx)." };
    case "select":
      return spec.options?.some((o) => o.value === v) ? null : { en: "Choose an option.", es: "Escoge una opción." };
    default:
      return null;
  }
}

/** Nested canonical-Passport patch for the entered values (trimmed; EIN as NN-NNNNNNN). */
export function passportPatchFor(specs: readonly MissingFieldSpec[], values: Record<string, string>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const s of specs) {
    let v = (values[s.key] ?? "").trim();
    if (!v) continue;
    if (s.kind === "ein") {
      const d = v.replace(/\D/g, "");
      v = `${d.slice(0, 2)}-${d.slice(2)}`;
    }
    const parts = s.path.split(".");
    let node = patch;
    for (const p of parts.slice(0, -1)) node = (node[p] ??= {}) as Record<string, unknown>;
    node[parts[parts.length - 1]!] = v;
  }
  return patch;
}
