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

const ENTITY_TOKENS = new Set(["llc", "l", "c", "inc", "incorporated", "corp", "corporation", "co", "company", "csp", "psc", "llp", "ltd", "the"]);

/** "Caribe Precision Manufacturing, L.L.C." → ["caribe", "precision", "manufacturing"]. */
export function businessNameTokens(name: string | null | undefined): string[] {
  return (name ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !ENTITY_TOKENS.has(t));
}

function nameMatches(named: string[], candidate: string | null | undefined): boolean {
  const c = businessNameTokens(candidate);
  if (!named.length || !c.length) return false;
  if (named.join(" ") === c.join(" ")) return true;
  // Every distinctive word of the shorter name appears in the longer one
  // ("Caribe Precision" ↔ "Caribe Precision Manufacturing"), with at least
  // two words in common so a single shared word ("Caribe") is never enough.
  const [short, long] = named.length <= c.length ? [named, c] : [c, named];
  return short.length >= 2 && short.every((t) => long.includes(t));
}

/**
 * The account's business the narrative names, when exactly one matches
 * confidently. Null when no name was given, nothing matches, or several
 * businesses match — then the intake shows the picker instead.
 */
export function matchBusinessByName(
  businesses: readonly LinkableBusiness[],
  name: string | null | undefined
): LinkableBusiness | null {
  const named = businessNameTokens(name);
  if (!named.length) return null;
  const hits = businesses.filter((b) => nameMatches(named, b.legal_name) || nameMatches(named, b.name));
  return hits.length === 1 ? hits[0] : null;
}
