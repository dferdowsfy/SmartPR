// How complete the Business Passport is, and what it feeds into the guided
// forms. Pure — PassportCard renders it; tests assert on it.

import { readPath } from "../../forms/engine/formConditions.ts";
import { PASSPORT_INTAKE_FIELDS } from "../../forms/engine/businessPassport.ts";
import type { CanonicalAddress, CanonicalApplicationData, Lang } from "../../forms/engine/types.ts";
import { localize } from "../../forms/engine/types.ts";
import type { Prefill } from "../clara/guidedFormModel.ts";

function filled(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === "string") return v.trim() !== "";
  if (typeof v === "object") return Boolean((v as Partial<CanonicalAddress>).line1?.trim());
  return true;
}

export interface PassportSummary {
  done: number;
  total: number;
  /** Labels of the details still missing, in form order. */
  missing: string[];
}

/** Details counted: every Passport field except optional ones and yes/no switches. */
export function passportSummary(canonical: CanonicalApplicationData, lang: Lang): PassportSummary {
  const mailingSame = readPath(canonical, "addresses.mailingSameAsPhysical") === true;
  const specs = PASSPORT_INTAKE_FIELDS.filter((s) => !s.optional && s.type !== "checkbox" && !(s.id === "principalMailing" && mailingSame));
  const missing = specs.filter((s) => !filled(readPath(canonical, s.canonicalKey))).map((s) => localize(s.label, lang));
  return { done: specs.length - missing.length, total: specs.length, missing };
}

function oneLine(a: CanonicalAddress | undefined): string | undefined {
  if (!a?.line1?.trim()) return undefined;
  return [a.line1, a.line2, a.cityOrMunicipality, a.postalCode].map((x) => x?.trim()).filter(Boolean).join(", ");
}

/** The guided forms' prefill, read from the Passport (fallback: the intake profile). */
export function prefillFromPassport(canonical: CanonicalApplicationData, fallback: Prefill = {}): Prefill {
  const s = (path: string) => {
    const v = readPath(canonical, path);
    return typeof v === "string" && v.trim() ? v.trim() : undefined;
  };
  return {
    legalName: s("business.legalName") ?? fallback.legalName,
    tradeName: s("business.tradeName") ?? fallback.tradeName,
    ein: s("business.ein") ?? fallback.ein,
    address: oneLine(readPath(canonical, "addresses.principalPhysical") as CanonicalAddress | undefined) ?? fallback.address,
    municipality: s("addresses.municipality") ?? fallback.municipality,
    contactName: s("contact.fullName") ?? fallback.contactName,
    email: s("contact.email") ?? s("business.email") ?? fallback.email,
    phone: s("contact.phone") ?? s("business.phone") ?? fallback.phone,
    projectDescription: s("business.purpose") ?? fallback.projectDescription,
  };
}
