/**
 * Business page — the active filing, its stage and its blockers (pure).
 *
 * Everything here is read from data the page already loads: matters
 * (status), obligations (status, matter_id, requirement_id) and the Clara
 * runs for this business (status per filing type). No status is inferred
 * beyond what that data says:
 *
 *   Clara run "submitted"           → submitted · waiting on agency
 *   Clara run "review"              → ready for review (Clara stopped at the submit gate)
 *   blocker MISSING/OVERDUE/NEEDS_ATTENTION/UNKNOWN, or matter NEEDS_ATTENTION → action needed
 *   only IN_PROGRESS blockers       → in progress
 *   only UPCOMING/DUE_SOON blockers → upcoming
 *   no blockers                     → ready for submission (SmartPR checklist complete)
 *
 * SmartPR does not receive agency decisions, so "approved" is never shown.
 */
import { PR_REQUIREMENT_GUIDANCE } from "../guidance/pr";
import { AGENCY_FILING_CONFIGS } from "../../lib/agency-runs/filingTypes";
import { currentGeography, type PassportLocationWithGeographies } from "../locations/geo";
import type { ObligationStatus } from "../compliance/types";

export interface AFMatter { id: string; title: string; matter_type: string; status: string; readiness_score: number | null; opened_at: string }
export interface AFObligation { id: string; name: string; agency: string | null; matter_id?: string | null; requirement_id?: string | null; status: ObligationStatus; next_action: string }
export interface AFRun { filing_type: string; status: string }

export type FilingStage = "action_needed" | "in_progress" | "upcoming" | "ready_for_review" | "ready_for_submission" | "submitted_waiting";

const DONE = new Set<string>(["COMPLETED", "CURRENT"]);
const ACTION = new Set<string>(["MISSING", "OVERDUE", "NEEDS_ATTENTION", "UNKNOWN"]);
const PRIORITY: Record<string, number> = { OVERDUE: 0, MISSING: 1, NEEDS_ATTENTION: 2, UNKNOWN: 3, DUE_SOON: 4, IN_PROGRESS: 5, UPCOMING: 6 };
const MATTER_RANK: Record<string, number> = { NEEDS_ATTENTION: 0, IN_PROGRESS: 1, DRAFT: 2, READY: 3 };

export interface ActiveFiling {
  matter: AFMatter;
  agency: string | null;
  stage: FilingStage;
  /** Linked requirements: done / total (null total = none linked). */
  done: number;
  total: number;
  pct: number | null;
  blockers: AFObligation[];
  next: { item: AFObligation; why: { en: string; es: string } | null } | null;
  /** Other active filings (not the focus). */
  others: AFMatter[];
}

/** Clara filing types that fulfil any of these requirement ids. */
function filingTypesFor(requirementIds: string[]): Set<string> {
  const out = new Set<string>();
  for (const c of AGENCY_FILING_CONFIGS) if ((c.requirementIds ?? []).some((r) => requirementIds.includes(r))) out.add(c.id);
  return out;
}

export function activeFilingFor(matters: AFMatter[], obligations: AFObligation[], runs: AFRun[]): ActiveFiling | null {
  const active = matters
    .filter((m) => m.status !== "COMPLETED" && m.status !== "ARCHIVED")
    .sort((a, b) => (MATTER_RANK[a.status] ?? 9) - (MATTER_RANK[b.status] ?? 9) || String(b.opened_at).localeCompare(String(a.opened_at)));
  const matter = active[0];
  if (!matter) return null;
  const linked = obligations.filter((o) => o.matter_id === matter.id);
  const blockers = linked.filter((o) => !DONE.has(o.status)).sort((a, b) => (PRIORITY[a.status] ?? 9) - (PRIORITY[b.status] ?? 9));
  const done = linked.length - blockers.length;
  const agencies = linked.map((o) => o.agency).filter((a): a is string => Boolean(a));
  const agency = agencies.sort((a, b) => agencies.filter((x) => x === b).length - agencies.filter((x) => x === a).length)[0] ?? null;

  const types = filingTypesFor(linked.map((o) => o.requirement_id ?? "").filter(Boolean));
  const runStatuses = runs.filter((r) => types.has(r.filing_type)).map((r) => r.status);

  let stage: FilingStage;
  if (runStatuses.includes("submitted")) stage = "submitted_waiting";
  else if (runStatuses.includes("review")) stage = "ready_for_review";
  else if (matter.status === "NEEDS_ATTENTION" || blockers.some((b) => ACTION.has(b.status))) stage = "action_needed";
  else if (blockers.some((b) => b.status === "IN_PROGRESS")) stage = "in_progress";
  else if (blockers.length > 0) stage = "upcoming";
  else if (linked.length > 0) stage = "ready_for_submission";
  else stage = "in_progress"; // nothing linked: no basis for a stronger claim

  const first = blockers[0];
  const g = first?.requirement_id ? PR_REQUIREMENT_GUIDANCE[first.requirement_id] : undefined;
  return {
    matter,
    agency,
    stage,
    done,
    total: linked.length,
    pct: linked.length ? Math.round((done / linked.length) * 100) : null,
    blockers,
    next: first ? { item: first, why: g ? { en: g.regulatoryReason.en, es: g.regulatoryReason.es } : null } : null,
    others: active.slice(1),
  };
}

// ------------------------------------------------------------------ municipality check

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

export interface MunicipalityConflict {
  passport: string;
  location: string;
  locationName: string | null;
}

/** Passport municipality vs the primary saved location's municipality. Never picks one. */
export function municipalityConflict(passportMunicipality: string | null | undefined, locations: PassportLocationWithGeographies[]): MunicipalityConflict | null {
  if (!passportMunicipality?.trim() || locations.length === 0) return null;
  const loc = locations.find((l) => l.is_primary) ?? locations[0]!;
  const derived = currentGeography(loc.geographies, "municipality")?.geography_name ?? loc.municipality;
  if (!derived?.trim()) return null;
  if (norm(derived) === norm(passportMunicipality)) return null;
  return { passport: passportMunicipality.trim(), location: derived.trim(), locationName: loc.name ?? null };
}

/** Requirements evaluated against the municipality (may change once resolved). */
export function municipalRequirements<T extends { name: string; agency: string | null }>(obligations: T[]): T[] {
  return obligations.filter((o) => /municip|patente|crim\b/i.test(`${o.name} ${o.agency ?? ""}`));
}
