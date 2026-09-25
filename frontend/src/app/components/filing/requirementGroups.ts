/**
 * The regulatory path, grouped so the whole of it stays visible: what to file
 * now, what may apply (and the fact that decides it), what waits on a
 * prerequisite, the documents the filings rely on, the registrations the
 * business already holds, and what is done.
 *
 * Pure: grouping reads the engine's own applicability and the KB's
 * `depends_on_document_ids`; Clara support reads the filing registry.
 */
import { AGENCY_FILING_CONFIGS, isFilingLaunchable, type AgencyFilingConfig } from "../../../lib/agency-runs/filingTypes";

export type RequirementGroupId =
  | "required_now"
  | "conditional"
  | "prerequisites"
  | "supporting"
  | "registrations"
  | "completed";

export const REQUIREMENT_GROUP_ORDER: RequirementGroupId[] = [
  "required_now",
  "conditional",
  "prerequisites",
  "supporting",
  "registrations",
  "completed",
];

export interface GroupableRequirement {
  documentId?: string | null;
  applicability?: string | null;
  stage?: string | null;
  mandatory?: boolean;
  /** Completed (issued document on file and valid). */
  done: boolean;
  /** Conditional only because a controlling question is unanswered. */
  awaitingAnswer: boolean;
}

export interface GroupedRequirement {
  group: RequirementGroupId;
  /** Present, unfinished requirements this one must wait for. */
  waitingOn: string[];
  /** Present requirements that wait for this one. */
  neededBefore: string[];
}

const CONDITIONAL = new Set(["conditional", "needs_more_information"]);
const REGISTRATION_STAGES = new Set(["tax_registration", "employment"]);

/** Prerequisites among the requirements actually present, from the KB. */
export function prerequisitesOf(
  documentId: string | null | undefined,
  documents: ReadonlyArray<{ id: string; depends_on_document_ids?: string[] | null }>
): string[] {
  if (!documentId) return [];
  return documents.find((d) => d.id === documentId)?.depends_on_document_ids ?? [];
}

export function groupRequirements(
  reqs: readonly GroupableRequirement[],
  documents: ReadonlyArray<{ id: string; depends_on_document_ids?: string[] | null }>
): GroupedRequirement[] {
  const pending = new Set(
    reqs
      .filter((r) => !r.done && r.documentId && !CONDITIONAL.has(r.applicability ?? "") && !r.awaitingAnswer)
      .map((r) => r.documentId as string)
  );
  return reqs.map((r) => {
    const deps = prerequisitesOf(r.documentId, documents);
    const waitingOn = deps.filter((d) => pending.has(d));
    const neededBefore = reqs
      .filter((o) => o !== r && !o.done && o.documentId && prerequisitesOf(o.documentId, documents).includes(r.documentId ?? ""))
      .map((o) => o.documentId as string);
    const a = r.applicability ?? "";
    let group: RequirementGroupId;
    if (r.done) group = "completed";
    else if (r.awaitingAnswer || CONDITIONAL.has(a)) group = "conditional";
    else if (a === "supporting_evidence") group = "supporting";
    else if (a === "verify_existing" || (REGISTRATION_STAGES.has(r.stage ?? "") && a !== "required" && a !== "likely_required")) group = "registrations";
    else if (waitingOn.length > 0) group = "prerequisites";
    else group = "required_now";
    return { group, waitingOn, neededBefore };
  });
}

// ---------------------------------------------------------------------------
// Clara support
// ---------------------------------------------------------------------------

export type ClaraSupport = "file" | "prepare" | "instructions";

export interface ClaraFilingSupport {
  support: ClaraSupport;
  config: AgencyFilingConfig | null;
}

/**
 * file         — Clara can open the agency portal and complete the filing.
 * prepare      — a filing flow exists but is not launchable yet: Clara prepares
 *                the package and walks the user through the portal.
 * instructions — no Clara flow: filing instructions + the agency site.
 */
export function claraSupportFor(
  documentId: string | null | undefined,
  env?: Record<string, string | undefined>
): ClaraFilingSupport {
  if (!documentId) return { support: "instructions", config: null };
  const configs = AGENCY_FILING_CONFIGS.filter((c) => (c.requirementIds ?? []).includes(documentId));
  const launchable = configs.find((c) => isFilingLaunchable(c, env));
  if (launchable) return { support: "file", config: launchable };
  if (configs.length) return { support: "prepare", config: configs[0] };
  return { support: "instructions", config: null };
}
