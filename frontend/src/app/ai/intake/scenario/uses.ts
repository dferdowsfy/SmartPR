/**
 * Property / activity use vocabulary. A use is a normalized label plus the
 * occupancy family it belongs to — two uses in the same family are the
 * "same use" for change-of-use reasoning (warehouse ↔ storage), different
 * families are a potential change of use (warehouse → daycare).
 *
 * Only what a term MEANS lives here. Which permits a use triggers is the KB's
 * job (business types and rules), never this file's.
 */

export type UseFamily =
  | "storage"
  | "office"
  | "industrial"
  | "retail"
  | "food"
  | "assembly"
  | "education"
  | "childcare"
  | "healthcare"
  | "lodging"
  | "residential"
  | "automotive"
  | "commercial"
  | "vacant";

export interface UseTerm {
  /** Regex source (no flags) matching the phrase. */
  pattern: string;
  label: string;
  family: UseFamily;
  /** Human label for chips. */
  display: string;
  /** Generic terms ("commercial operation") never make a use specific. */
  generic?: boolean;
}

// Order matters: longer / more specific phrases first.
export const USE_TERMS: UseTerm[] = [
  { pattern: "day[\\s-]?care(?: center)?|child[\\s-]?care(?: center)?|pre-?school", label: "daycare", family: "childcare", display: "Daycare" },
  { pattern: "warehous(?:e|es|ing)|storage(?: facility)?|distribution cent(?:er|re)", label: "warehouse", family: "storage", display: "Warehouse" },
  { pattern: "offices?", label: "office", family: "office", display: "Office" },
  { pattern: "manufacturing(?: plant| facility)?|factory|industrial(?: facility| building| plant)?|plant", label: "manufacturing", family: "industrial", display: "Manufacturing" },
  { pattern: "auto(?:motive)? repair(?: shop)?|body shop|car wash|dealership", label: "automotive", family: "automotive", display: "Automotive" },
  { pattern: "restaurant|caf[eé]|bakery|commercial kitchen|food service|bar", label: "restaurant", family: "food", display: "Restaurant / food service" },
  { pattern: "retail(?: store| space)?|store(?:front)?|shop", label: "retail", family: "retail", display: "Retail" },
  { pattern: "(?:medical )?clinic|medical office|pharmacy|laboratory", label: "clinic", family: "healthcare", display: "Clinic / healthcare" },
  { pattern: "private school|school|tutoring center|training cent(?:er|re)", label: "school", family: "education", display: "School" },
  { pattern: "gym|fitness (?:studio|center)|event venue|church|theater|theatre", label: "assembly", family: "assembly", display: "Assembly / venue" },
  { pattern: "hotel|guest ?house|short[\\s-]term rental", label: "lodging", family: "lodging", display: "Lodging" },
  { pattern: "residence|house|home|apartments?|residential", label: "residential", family: "residential", display: "Residential" },
  { pattern: "vacant (?:lot|land)|empty lot|lot|parcel of land", label: "vacant_land", family: "vacant", display: "Vacant land" },
  {
    pattern: "(?:new )?commercial (?:operation|use|activity|business|tenant|space|building|property)|business (?:operation|use)|operation",
    label: "commercial_operation",
    family: "commercial",
    display: "Commercial operation",
    generic: true,
  },
];

const COMPILED = USE_TERMS.map((t) => ({ ...t, re: new RegExp(`\\b(?:${t.pattern})\\b`, "i") }));

/** First use term found in a phrase (most specific first). */
export function matchUse(phrase: string): UseTerm | null {
  for (const t of COMPILED) if (t.re.test(phrase)) return t;
  return null;
}

/** All distinct use terms in a phrase, in order of appearance. */
export function matchUses(phrase: string): UseTerm[] {
  const found: { t: UseTerm; at: number }[] = [];
  for (const t of COMPILED) {
    const m = t.re.exec(phrase);
    if (m && !found.some((f) => f.t.label === t.label)) found.push({ t, at: m.index });
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.t);
}

export function findUseByLabel(label: string): UseTerm | undefined {
  const base = label.split("_and_")[0];
  return USE_TERMS.find((t) => t.label === label || t.label === base);
}

/** "warehouse_and_office" → families of each part. */
export function familiesOf(label: string): UseFamily[] {
  return label
    .split("_and_")
    .map((p) => USE_TERMS.find((t) => t.label === p)?.family)
    .filter((f): f is UseFamily => !!f);
}

/** "manufacturing_and_warehouse_and_office" → "Manufacturing, warehouse and office". */
export function listLabelOfUse(label: string): string {
  const parts = label.split("_and_").map((p) => (USE_TERMS.find((t) => t.label === p)?.display ?? p.replace(/_/g, " ")).toLowerCase());
  const text = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0] ?? "";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function displayOfUse(label: string): string {
  return label
    .split("_and_")
    .map((p) => USE_TERMS.find((t) => t.label === p)?.display ?? p.replace(/_/g, " "))
    .join(" / ");
}

/**
 * Does moving from `existing` to `proposed` plausibly change the use?
 * true = different occupancy family; false = same family; null = can't tell
 * (generic proposed use).
 */
export function usesDiffer(existing: string, proposed: string): boolean | null {
  const parts = proposed.split("_and_").map((p) => findUseByLabel(p) ?? matchUse(p.replace(/_/g, " ")));
  if (parts.length === 0 || parts.some((p) => !p || p.generic)) return null;
  const ex = familiesOf(existing);
  if (ex.length === 0) return null;
  // A mixed use changes the use if ANY part falls outside the authorized
  // families. Office accessory to storage/industrial is the same occupancy.
  return parts.some((p) => {
    const pf = p!.family;
    if (ex.includes(pf)) return false;
    if (pf === "office" && ex.some((f) => f === "storage" || f === "industrial")) return false;
    return true;
  });
}
