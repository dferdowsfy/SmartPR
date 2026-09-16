/**
 * linkBusiness.ts — Existing-business picker helpers (project-first intake).
 *
 * When the intake's project intent is `existing_business` and the URL carries
 * no `?business=` id, the intake lists the user's businesses so they can
 * link one instead of the intake creating a new business record. The
 * `/api/businesses` listing returns raw DB rows and `public_id` is a
 * nullable column, so this module defensively keeps only rows with a usable
 * public id: the picker can never link to an unusable id.
 */

/** A business row the intake is allowed to link to. */
export interface LinkableBusiness {
  public_id: string;
  name?: string | null;
  legal_name?: string | null;
  municipality?: string | null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Normalize the raw `/api/businesses` JSON into linkable businesses.
 * Never throws: malformed payloads yield an empty list and the intake
 * shows its "no businesses" state instead of crashing.
 */
export function normalizeLinkableBusinesses(data: unknown): LinkableBusiness[] {
  const rows =
    data && typeof data === "object" && Array.isArray((data as { businesses?: unknown }).businesses)
      ? (data as { businesses: unknown[] }).businesses
      : [];
  const out: LinkableBusiness[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const publicId = asString(record.public_id);
    // A row without a usable public id cannot be linked (?business= would
    // be unusable) — skip it rather than letting the picker offer it.
    if (!publicId) continue;
    out.push({
      public_id: publicId,
      name: asString(record.name) || null,
      legal_name: asString(record.legal_name) || null,
      municipality: asString(record.municipality) || null,
    });
  }
  return out;
}
