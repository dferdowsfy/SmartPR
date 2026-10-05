// ============================================================================
// Map-data drift: compare the official answers recorded for a sample case with
// a fresh, read-only lookup of the same government services, and describe each
// difference as a plain-language review item. Nothing here changes rules,
// fixtures, or deployments — a person reviews every item.
//
// Routing (never the product owner):
//   auto_resolve       a source did not answer; the next scheduled check retries it
//   engineering        the app could not read a live answer the way it reads the record
//   land_use_reviewer  an official answer changed; a qualified reviewer decides what it means
// ============================================================================

import type { OfficialFacts } from "./officialFacts.ts";
import type { SiteCase } from "./cases.ts";
import type { Issue } from "./consistency.ts";

export type DriftRoute = "auto_resolve" | "engineering" | "land_use_reviewer";

export interface DriftItem {
  case_id: string;
  case_label: string;
  route: DriftRoute;
  /** What changed, in a sentence. */
  what_changed: string;
  /** Which report outputs may be affected. */
  affects: string;
  /** Recorded vs live official values. */
  evidence: { source: string; recorded: string; live: string; recorded_at: string; checked_at: string };
  recommended_action: string;
}

type Field = { source: string; label: string; affects: string; get: (f: OfficialFacts) => unknown; answered: (f: OfficialFacts) => boolean };

const show = (v: unknown): string => (v === null || v === undefined || v === "" ? "none" : Array.isArray(v) ? (v.length ? [...v].map(String).sort().join(", ") : "none") : String(v));

const FIELDS: Field[] = [
  { source: "CRIM parcel map", label: "parcel number (catastro) at the pin", affects: "Property header, parcel checks", get: (f) => f.crim.catastro, answered: (f) => f.crim.answered },
  { source: "CRIM parcel map", label: "parcel type at the pin", affects: "Property header, off-lot notices", get: (f) => f.crim.tipo, answered: (f) => f.crim.answered },
  { source: "JP zoning map (calificación)", label: "zoning district at the pin", affects: "Zoning finding, permitted uses", get: (f) => f.jp.cali, answered: (f) => f.jp.answered },
  { source: "JP zoning map (calificación)", label: "land classification at the pin", affects: "Land class finding, permitted uses", get: (f) => f.jp.clasi, answered: (f) => f.jp.answered },
  { source: "JP zoning map (calificación)", label: "zoning effective date (vigencia)", affects: "Zoning finding source date", get: (f) => f.jp.vigencia, answered: (f) => f.jp.answered },
  { source: "JP zoning map (calificación)", label: "zoning resolution", affects: "Zoning finding source", get: (f) => f.jp.resolucion, answered: (f) => f.jp.answered },
  { source: "JP zoning map (calificación)", label: "catastro label on the zoning polygon", affects: "CRIM vs JP parcel-number notice", get: (f) => f.jp.num_catast, answered: (f) => f.jp.answered },
  { source: "JP zoning map (calificación)", label: "zoning districts on the parcel", affects: "Zoning coverage, permitted uses", get: (f) => f.jpParcel.districts, answered: (f) => f.jpParcel.answered },
  { source: "FEMA flood map (NFHL)", label: "governing flood zone at the pin", affects: "Flood finding, flood chip, PDF", get: (f) => f.fema.governing, answered: (f) => f.fema.answered },
  { source: "FEMA flood map (NFHL)", label: "flood zones at the pin", affects: "Flood finding, flood chip", get: (f) => f.fema.zones, answered: (f) => f.fema.answered },
  { source: "FEMA flood map (NFHL)", label: "regulatory floodway at the pin", affects: "Flood finding, floodway notice", get: (f) => f.fema.floodway, answered: (f) => f.fema.answered },
  { source: "FEMA flood map (NFHL)", label: "FIRM panel", affects: "Flood finding source", get: (f) => f.fema.panel, answered: (f) => f.fema.answered },
  { source: "FEMA flood map (NFHL)", label: "FIRM effective date", affects: "Flood finding source date", get: (f) => f.fema.effective, answered: (f) => f.fema.answered },
  { source: "FEMA flood map (NFHL)", label: "flood zones on the parcel", affects: "Flood coverage", get: (f) => f.femaParcel.keys, answered: (f) => f.femaParcel.answered },
  { source: "JP/FEMA advisory flood map", label: "advisory flood zone at the pin", affects: "Advisory-vs-FIRM notice", get: (f) => f.advisory.zone, answered: (f) => f.advisory.answered },
  { source: "NOAA coastal zone boundary", label: "inside the coastal zone", affects: "Coastal finding", get: (f) => f.coastal.inside, answered: (f) => f.coastal.answered },
  { source: "MIPR historic zones", label: "inside a historic zone", affects: "Historic finding", get: (f) => f.historicParcel.inside, answered: (f) => f.historicParcel.answered },
  { source: "Wetlands inventory", label: "wetlands on the parcel", affects: "Wetlands finding", get: (f) => f.wetlandsParcel.inside, answered: (f) => f.wetlandsParcel.answered },
];

/** Differences between the recorded and the live official answers for one case. */
export function diffOfficialFacts(c: SiteCase, recorded: OfficialFacts, live: OfficialFacts): DriftItem[] {
  const items: DriftItem[] = [];
  const base = { case_id: c.id, case_label: c.label };
  const stamp = { recorded_at: recorded.captured_at, checked_at: live.captured_at };
  const silent = new Set<string>();
  for (const fld of FIELDS) {
    if (fld.answered(recorded) && !fld.answered(live)) {
      if (silent.has(fld.source)) continue;
      silent.add(fld.source);
      items.push({ ...base, route: "auto_resolve",
        what_changed: `The ${fld.source} did not answer during this check, so its answers could not be compared.`,
        affects: "Nothing yet; reports already label an unanswered source as unknown, not clear.",
        evidence: { source: fld.source, recorded: "answered", live: "no answer", ...stamp },
        recommended_action: "No action now. The next scheduled check retries it; if it keeps failing, it moves to engineering." });
      continue;
    }
    if (!fld.answered(live)) continue;
    const a = show(fld.get(recorded)), b = show(fld.get(live));
    if (a === b) continue;
    items.push({ ...base, route: "land_use_reviewer",
      what_changed: `The ${fld.source} now gives a different ${fld.label}: it was ${a} and is now ${b}.`,
      affects: fld.affects,
      evidence: { source: fld.source, recorded: a, live: b, ...stamp },
      recommended_action: "Have a qualified land-use reviewer confirm the new official answer and whether any report wording or rule should change. Once confirmed, an engineer re-records this case with npm run geo:capture. Nothing changes automatically." });
  }
  return items;
}

/** Live answers the app could not read the way it reads the record (parser or pipeline problem). */
export function engineeringItems(c: SiteCase, issues: Issue[], checkedAt: string, recordedAt: string): DriftItem[] {
  // Value disagreements are covered by diffOfficialFacts; here we keep only problems in how outputs are built.
  return issues.filter((i) => i.output !== "fixture" && i.output !== "cases.ts").map((i) => ({
    case_id: c.id, case_label: c.label, route: "engineering" as const,
    what_changed: `With today's live map answers, the ${i.output} output fails a consistency check: ${i.fact}.`,
    affects: `The ${i.output} output for this location`,
    evidence: { source: "SmartPR site report", recorded: i.expected, live: i.actual, recorded_at: recordedAt, checked_at: checkedAt },
    recommended_action: "Engineering checks whether the live service changed its format or the report builder mis-reads it. Fixes go through normal review; no rule changes are made from this item.",
  }));
}

export const ROUTE_TEXT: Record<DriftRoute, string> = {
  auto_resolve: "Retries automatically",
  engineering: "Engineering",
  land_use_reviewer: "Land-use reviewer",
};
