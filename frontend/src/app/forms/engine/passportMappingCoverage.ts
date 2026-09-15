// ============================================================================
// Server-only: mapping coverage for the Business Passport.
//
// Uses loadMapping (node:fs) to inspect form mapping JSON. Keep this out of
// businessPassport.ts so client components can import passport helpers without
// pulling Node FS into the Turbopack client bundle.
// ============================================================================

import { loadMapping } from "../artifacts/mappingStore.ts";
import { readCanonicalField } from "../artifacts/canonicalFields.ts";
import { BUSINESS_PASSPORT_FIELDS } from "./businessPassport.ts";
import type { CanonicalApplicationData } from "./types.ts";

/**
 * Mapping coverage: for each form code, which passport fields the mapping can
 * pull, and which of those the profile actually answers today.
 */
export function passportMappingCoverage(
  formCodes: string[],
  profile: CanonicalApplicationData
): Record<
  string,
  {
    mappedPassportFields: string[];
    filledFromPassport: string[];
    emptyPassportFields: string[];
  }
> {
  const out: Record<string, { mappedPassportFields: string[]; filledFromPassport: string[]; emptyPassportFields: string[] }> = {};
  const passportSet = new Set<string>(BUSINESS_PASSPORT_FIELDS);
  for (const formCode of formCodes) {
    const doc = loadMapping(formCode);
    const mapped = new Set<string>();
    if (doc) {
      for (const field of doc.fields) {
        if (field.canonicalField && passportSet.has(field.canonicalField)) {
          mapped.add(field.canonicalField);
        }
      }
    }
    const mappedPassportFields = [...mapped].sort();
    const filledFromPassport: string[] = [];
    const emptyPassportFields: string[] = [];
    for (const id of mappedPassportFields) {
      if (readCanonicalField(profile, id) !== undefined) filledFromPassport.push(id);
      else emptyPassportFields.push(id);
    }
    out[formCode] = { mappedPassportFields, filledFromPassport, emptyPassportFields };
  }
  return out;
}
