// ============================================================================
// Enterprise regulatory change impact — shared logic (Phase 5).
//
// Server-side + test-safe: pure functions only, no next/headers imports.
//
// Design notes:
// - Every regulatory event is HUMAN-RECORDED. The regulatory_source field is
//   mandatory and is never defaulted, inferred, or AI-generated. There are
//   no integrations that fetch regulatory changes from outside.
// - Impact matching is deterministic and explainable: each regulatory_impacts
//   row carries `match_basis`, a human-readable explanation of exactly which
//   criterion matched. Reviewers can re-run compute-impact safely (idempotent
//   upsert keyed on match_key; ack/implementation progress is preserved).
// - CRITICAL LIFECYCLE RULE: impacts computed while an event is not
//   `effective` are written with applicability='projected' and MUST NOT
//   create or modify obligation_work rows. Only lifecycle='effective' events
//   may trigger remediation (obligation_work -> in_progress).
// ============================================================================

export const REGULATORY_LIFECYCLES = [
  "proposed",
  "pending_review",
  "enacted_not_effective",
  "effective",
  "superseded",
] as const;

export type RegulatoryLifecycle = (typeof REGULATORY_LIFECYCLES)[number];

export function isRegulatoryLifecycle(v: unknown): v is RegulatoryLifecycle {
  return typeof v === "string" && (REGULATORY_LIFECYCLES as readonly string[]).includes(v);
}

/** Allowed lifecycle transitions for the verify endpoint. */
export const LIFECYCLE_TRANSITIONS: Record<RegulatoryLifecycle, RegulatoryLifecycle[]> = {
  proposed: ["pending_review", "superseded"],
  pending_review: ["enacted_not_effective", "superseded"],
  enacted_not_effective: ["effective", "superseded"],
  effective: ["superseded"],
  superseded: [],
};

export function canTransitionLifecycle(
  from: RegulatoryLifecycle,
  to: RegulatoryLifecycle
): boolean {
  return LIFECYCLE_TRANSITIONS[from]?.includes(to) ?? false;
}

export const ACK_STATUSES = ["pending", "acknowledged"] as const;
export type AckStatus = (typeof ACK_STATUSES)[number];

export const IMPLEMENTATION_STATUSES = ["not_started", "in_progress", "implemented"] as const;
export type ImplementationStatus = (typeof IMPLEMENTATION_STATUSES)[number];

export function isImplementationStatus(v: unknown): v is ImplementationStatus {
  return (
    typeof v === "string" && (IMPLEMENTATION_STATUSES as readonly string[]).includes(v)
  );
}

export type ImpactApplicability = "projected" | "confirmed";

// ---------------------------------------------------------------------------
// Targeting spec — the deterministic impact-matching spec stored on the
// event (regulatory_events.targeting). All tag matching is AND across the
// specified (non-empty) groups and OR within a group.
// ---------------------------------------------------------------------------

export interface TargetingSpec {
  /** Explicit obligation UUIDs picked by the reviewer (bypass tag filters). */
  obligation_ids?: string[];
  /** Explicit business UUIDs picked by the reviewer. */
  business_ids?: string[];
  /** Explicit facility UUIDs picked by the reviewer. */
  facility_ids?: string[];
  /** Agency name tags, e.g. ["OGPe", "Departamento de Hacienda"]. */
  agency_names?: string[];
  /** Municipality tags, e.g. ["San Juan"]. */
  municipalities?: string[];
  /** Business type tags. */
  business_types?: string[];
  /** Industry tags. */
  industries?: string[];
  /** Requirement (obligation) name tags. */
  requirement_names?: string[];
}

const TARGETING_ARRAYS: (keyof TargetingSpec)[] = [
  "obligation_ids",
  "business_ids",
  "facility_ids",
  "agency_names",
  "municipalities",
  "business_types",
  "industries",
  "requirement_names",
];

/** Sanitize an untrusted targeting object into a TargetingSpec (or {}). */
export function sanitizeTargeting(raw: unknown): TargetingSpec {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const src = raw as Record<string, unknown>;
  const out: TargetingSpec = {};
  for (const key of TARGETING_ARRAYS) {
    const v = src[key];
    if (!Array.isArray(v)) continue;
    const cleaned = [
      ...new Set(
        v.filter((x) => typeof x === "string").map((x) => (x as string).trim()).filter(Boolean)
      ),
    ];
    if (cleaned.length > 0) out[key] = cleaned;
  }
  return out;
}

export function isUuidLike(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

/** Normalize for deterministic, explainable matching (lowercase, trimmed). */
export function normalizeTag(v: string | null | undefined): string {
  return (v ?? "").trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Pure impact matching
// ---------------------------------------------------------------------------

export interface ObligationCandidate {
  obligation_id: string;
  obligation_name: string;
  agency: string | null;
  requirement_id: string | null;
  business_id: string;
  business_name: string;
  business_type: string | null;
  industry: string | null;
  municipality: string | null;
  matter_id: string | null;
}

export interface MatchResult {
  matched: boolean;
  /** Human-readable explanation stored on regulatory_impacts.match_basis. */
  basis: string;
}

/**
 * Decide whether an obligation candidate is in scope for an event.
 * Returns the explainable match basis when matched.
 *
 * Rules:
 *  1. Reviewer-picked obligation_ids always match ("selected by reviewer").
 *  2. Reviewer-picked business_ids match every obligation of those businesses.
 *  3. Otherwise, every SPECIFIED tag group must match (AND across groups,
 *     OR within a group); at least one tag group must be specified.
 */
export function matchObligation(
  targeting: TargetingSpec,
  candidate: ObligationCandidate
): MatchResult {
  if (targeting.obligation_ids?.includes(candidate.obligation_id)) {
    return { matched: true, basis: "Selected by reviewer (explicit obligation pick)" };
  }
  if (targeting.business_ids?.includes(candidate.business_id)) {
    return {
      matched: true,
      basis: `Business "${candidate.business_name}" selected by reviewer`,
    };
  }

  const parts: string[] = [];
  const groups: Array<{
    key: keyof TargetingSpec;
    values: string[] | undefined;
    candidateValue: string;
    label: string;
  }> = [
    {
      key: "agency_names",
      values: targeting.agency_names,
      candidateValue: candidate.agency ?? "",
      label: "agency",
    },
    {
      key: "municipalities",
      values: targeting.municipalities,
      candidateValue: candidate.municipality ?? "",
      label: "municipality",
    },
    {
      key: "business_types",
      values: targeting.business_types,
      candidateValue: candidate.business_type ?? "",
      label: "business type",
    },
    {
      key: "industries",
      values: targeting.industries,
      candidateValue: candidate.industry ?? "",
      label: "industry",
    },
    {
      key: "requirement_names",
      values: targeting.requirement_names,
      candidateValue: candidate.obligation_name ?? "",
      label: "requirement",
    },
  ];

  let specified = 0;
  for (const g of groups) {
    if (!g.values || g.values.length === 0) continue;
    specified += 1;
    const hit = g.values.find((t) => normalizeTag(t) === normalizeTag(g.candidateValue));
    if (!hit) return { matched: false, basis: "" };
    parts.push(`${g.label} matches "${g.candidateValue.trim()}"`);
  }

  if (specified === 0) return { matched: false, basis: "" };
  return { matched: true, basis: parts.join("; ") };
}

export interface FacilityCandidate {
  facility_id: string;
  facility_name: string;
  business_id: string | null;
  municipality: string | null;
}

/**
 * Decide whether a facility is in scope: explicit facility pick, facility of
 * an affected business, or municipality tag match. `affectedBusinessIds` are
 * the businesses already matched through their obligations / explicit picks.
 */
export function matchFacility(
  targeting: TargetingSpec,
  candidate: FacilityCandidate,
  affectedBusinessIds: Set<string>
): MatchResult {
  if (targeting.facility_ids?.includes(candidate.facility_id)) {
    return { matched: true, basis: "Selected by reviewer (explicit facility pick)" };
  }
  if (candidate.business_id && affectedBusinessIds.has(candidate.business_id)) {
    return {
      matched: true,
      basis: "Facility belongs to an affected business",
    };
  }
  if (targeting.municipalities && targeting.municipalities.length > 0) {
    const hit = targeting.municipalities.find(
      (t) => normalizeTag(t) === normalizeTag(candidate.municipality)
    );
    if (hit) {
      return {
        matched: true,
        basis: `municipality matches "${(candidate.municipality ?? "").trim()}"`,
      };
    }
  }
  return { matched: false, basis: "" };
}

// ---------------------------------------------------------------------------
// Required-action text builders (deterministic; reviewer may override via
// the compute-impact request body).
// ---------------------------------------------------------------------------

export interface EventBrief {
  title: string;
  regulatory_source: string;
  source_version: string | null;
  lifecycle: RegulatoryLifecycle;
  effective_date: string | null;
}

function sourceLabel(e: EventBrief): string {
  return e.source_version
    ? `${e.regulatory_source} (version ${e.source_version})`
    : e.regulatory_source;
}

export function requiredActionForObligation(
  e: EventBrief,
  obligationName: string,
  businessName: string
): string {
  const upcoming =
    e.lifecycle === "effective"
      ? `Effective${e.effective_date ? ` ${e.effective_date}` : ""}. `
      : "Not yet effective — plan ahead; no remediation is due yet. ";
  return (
    `Regulatory change "${e.title}" (${sourceLabel(e)}). ${upcoming}` +
    `Re-verify that "${obligationName}" for ${businessName} still meets the updated ` +
    `requirement, update internal work and supporting evidence, and record the outcome here.`
  );
}

export function requiredActionForBusiness(e: EventBrief, businessName: string): string {
  const upcoming =
    e.lifecycle === "effective"
      ? ""
      : " This change is not yet effective — prepare, but do not remediate yet.";
  return (
    `Assess the organization-level impact of "${e.title}" (${sourceLabel(e)}) on ` +
    `${businessName}: identify every affected requirement, assign owners, and track ` +
    `implementation against the effective date.${upcoming}`
  );
}

export function requiredActionForFacility(
  e: EventBrief,
  facilityName: string,
  municipality: string | null
): string {
  const upcoming =
    e.lifecycle === "effective"
      ? ""
      : " This change is not yet effective — prepare, but do not remediate yet.";
  return (
    `Assess the facility-level impact of "${e.title}" (${sourceLabel(e)}) at ` +
    `${facilityName}${municipality ? ` (${municipality})` : ""}: confirm which site ` +
    `permits, licenses, and inspections are affected.${upcoming}`
  );
}

export function requiredActionForProject(e: EventBrief, projectTitle: string): string {
  const upcoming =
    e.lifecycle === "effective"
      ? ""
      : " This change is not yet effective — prepare, but do not remediate yet.";
  return (
    `Review project "${projectTitle}" for impact of "${e.title}" (${sourceLabel(e)}): ` +
    `confirm the filing/submission plan still reflects the updated requirement.${upcoming}`
  );
}

/** Deterministic dedupe key for an impact row (one row per matched entity). */
export function impactMatchKey(
  level: "obligation" | "business" | "facility" | "project",
  id: string
): string {
  return `${level}:${id}`;
}

// ---------------------------------------------------------------------------
// Event shape for the review queue / detail views
// ---------------------------------------------------------------------------

export const LIFECYCLE_LABELS: Record<RegulatoryLifecycle, string> = {
  proposed: "Proposed",
  pending_review: "Pending review",
  enacted_not_effective: "Enacted — not yet effective",
  effective: "Effective",
  superseded: "Superseded",
};

/** True when compute-impact may also update obligation_work (remediation). */
export function mayTriggerRemediation(lifecycle: RegulatoryLifecycle): boolean {
  return lifecycle === "effective";
}

/** Applicability flag written on impact rows. */
export function applicabilityFor(lifecycle: RegulatoryLifecycle): ImpactApplicability {
  return mayTriggerRemediation(lifecycle) ? "confirmed" : "projected";
}
