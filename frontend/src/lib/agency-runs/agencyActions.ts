/**
 * Agency → actions resolution.
 *
 * Resolves the list of actionable agency filings for one agency from the
 * filing registry + the business's passport + prior run statuses. Labels only
 * flow through here — never field values, never secrets.
 */
import type { AgencyFilingType } from "./types";
import { AGENCY_FILING_CONFIGS, isFilingLaunchable, type AgencyFilingConfig } from "./filingTypes";
import { flattenPassportValues } from "./prefillFromPassport";
import { CANONICAL_LABELS } from "./canonicalFields";

export type AgencyId = "HACIENDA_SURI" | "DEPT_STATE" | "OGPE" | "DEMO_REHEARSAL";

export const AGENCY_IDS: AgencyId[] = ["HACIENDA_SURI", "DEPT_STATE", "OGPE", "DEMO_REHEARSAL"];

export function isAgencyId(value: string): value is AgencyId {
  return (AGENCY_IDS as string[]).includes(value);
}

export interface AgencyAction {
  id: string;
  filing_type: AgencyFilingType;
  agency_id: string;
  title_en: string;
  title_es: string;
  agency_en: string;
  agency_es: string;
  status: "ready" | "blocked" | "not_required" | "completed";
  known: number;
  total: number;
  missing_items: {
    id: string;
    label_en: string;
    label_es: string;
    sensitive: boolean;
  }[];
  blocked_by: string[];
  evidence_available: string[];
  /**
   * Resolved concrete objective for this action (labels only). Used when one
   * filing type covers distinct workflows — e.g. Dept. of State "create a new
   * entity" vs "file the annual report" — so the browser agent is never sent
   * in with an ambiguous goal and has to guess which workflow to run.
   */
  objective_en?: string;
  objective_es?: string;
  /**
   * SmartPR obligation this action fulfills (from the obligations table —
   * the deterministic requirements engine's output for the business).
   * Set by resolveFilingOptions; absent on registry-only actions.
   */
  obligation_id?: string;
  /** Engine document_id (obligations.requirement_id); synthetic for demo. */
  requirement_id?: string | null;
}

const COMPLETED_STATUSES = new Set(["review", "completed"]);

/* ------------------------------------------------------------------ */
/* Dept. of State objective                                            */
/*                                                                     */
/* One config = one agency + one filing variant. Corporation formation, */
/* LLC formation and the annual report are separate configs, each      */
/* reached only from its own rule-emitted requirement                  */
/* (DOC_CERT_INCORPORATION / DOC_CERT_ORGANIZATION / DOC_ANNUAL_REPORT). */
/* The old passport-heuristic split of one config into "new entity or  */
/* annual report" is gone: it sent LLC owners through corporation      */
/* screens and let the agent's objective depend on passport guesses.   */
/* ------------------------------------------------------------------ */

const CORPORATION_OBJECTIVE = {
  title_en: "Dept. of State — Form a corporation",
  title_es: "Departamento de Estado — Crear una corporación",
  objective_en:
    "Form a NEW corporation by filing its Certificate of Incorporation in the Corporate & Entities Registry creation wizard. Do NOT form an LLC and do NOT file an annual report.",
  objective_es:
    "Crear una NUEVA corporación radicando su Certificado de Incorporación en el asistente de creación del Registro de Corporaciones y Entidades. NO cree una LLC ni radique un informe anual.",
};

/** Attach the concrete objective for filings whose config names one variant. */
function withObjective(action: AgencyAction): AgencyAction {
  if (action.filing_type !== "DEPT_STATE_CORPORATE_FILING") return action;
  return { ...action, ...CORPORATION_OBJECTIVE };
}

/**
 * True when the coverage key is present (non-empty) in the flattened passport.
 * flattenPassportValues lowercases keys; municipality/state live under
 * addresses.principalPhysical in the flattened map, so the canonical
 * "addresses.municipality" / "addresses.state" keys fall back to their leaf
 * (both are address-scoped concepts — no collision risk with other leaves).
 */
function coverageHit(flat: Map<string, string>, key: string): boolean {
  const k = key.toLowerCase();
  if (flat.has(k)) return true;
  const leaf = k.includes(".") ? k.slice(k.lastIndexOf(".") + 1) : k;
  if ((leaf === "municipality" || leaf === "state") && flat.has(leaf)) return true;
  return false;
}

function humanizeKey(key: string): string {
  const leaf = key.includes(".") ? key.slice(key.lastIndexOf(".") + 1) : key;
  return leaf
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/^./, (c) => c.toUpperCase());
}

function coverageLabel(key: string): { label_en: string; label_es: string } {
  const lbl = CANONICAL_LABELS[key];
  if (lbl) return { label_en: lbl.en, label_es: lbl.es };
  const human = humanizeKey(key);
  return { label_en: human, label_es: human };
}

function actionForConfig(
  config: AgencyFilingConfig,
  agencyId: string,
  flat: Map<string, string>,
  completed: Set<AgencyFilingType>
): AgencyAction {
  const coverage = config.passportCoverageKeys ?? [];

  const missingKeys = coverage.filter((key) => !coverageHit(flat, key));
  const known = coverage.length - missingKeys.length;

  const missing_items: AgencyAction["missing_items"] = [
    ...missingKeys.map((key) => ({
      id: key,
      ...coverageLabel(key),
      sensitive: false,
    })),
    ...(config.sensitiveNeeds ?? []).map((need) => ({
      id: need.id,
      label_en: need.label_en,
      label_es: need.label_es,
      sensitive: true,
    })),
  ];

  const blockedBy = (config.blockedBy ?? []).filter((ft) => !completed.has(ft));

  let status: AgencyAction["status"];
  if (completed.has(config.id)) {
    status = "completed";
  } else if (config.requiresExistingAccount || !config.enabled) {
    status = "not_required";
  } else if (blockedBy.length > 0) {
    status = "blocked";
  } else {
    status = "ready";
  }

  return {
    id: config.id,
    filing_type: config.id,
    agency_id: agencyId,
    title_en: config.labelEn,
    title_es: config.labelEs,
    agency_en: config.agencyEn,
    agency_es: config.agencyEs,
    status,
    known,
    total: coverage.length,
    missing_items,
    blocked_by: blockedBy as string[],
    evidence_available: config.evidenceTags ?? [],
  };
}

export async function resolveAgencyActions(input: {
  business_id: string;
  agency_id: string;
  passport: Record<string, unknown> | null;
  priorRuns: { filing_type: AgencyFilingType; status: string }[];
}): Promise<AgencyAction[]> {
  const { agency_id, passport, priorRuns } = input;
  void input.business_id; // reserved for future requirement-engine enrichment

  const configs = AGENCY_FILING_CONFIGS.filter((c) => c.agencyId === agency_id);
  const flat = flattenPassportValues(passport);

  const completed = new Set<AgencyFilingType>();
  for (const run of priorRuns ?? []) {
    if (COMPLETED_STATUSES.has(String(run.status))) completed.add(run.filing_type);
  }

  // Best-effort requirement enrichment intentionally resolves registry-only:
  // the requirements engine is a POST-only admin crawl endpoint, not a
  // per-business requirements lookup, so no requirements are invented here.
  const actions = configs.map((config) =>
    actionForConfig(config, agency_id, flat, completed)
  );
  // Dept. of State covers two distinct workflows — resolve the concrete
  // objective so the agent never has to guess between them.
  return actions.flatMap((action) =>
    action.filing_type === "DEPT_STATE_CORPORATE_FILING"
      ? [withObjective(action)]
      : [action]
  );
}

/* ------------------------------------------------------------------ */
/* Filing options — obligation-driven picker                           */
/*                                                                     */
/* SmartPR decides what needs to be filed: its deterministic engine    */
/* output, persisted per business as obligations. The browser agent     */
/* only executes the selected filing. These options join each          */
/* obligation to the filing registry via config.requirementIds         */
/* (engine document_ids only — never requirement names). Obligations    */
/* with no mapped filing surface as disabled "not yet supported"      */
/* entries — the picker never falls back to agency-first browsing.     */
/* Labels only — never field values, never secrets.                    */
/* ------------------------------------------------------------------ */

/** Minimal obligation shape — matches VoiceObligation from the voice API. */
export interface ObligationLike {
  id: string;
  name: string;
  requirement_id: string | null;
  agency: string | null;
  /** Derived obligation status (deriveObligationStatus). */
  status: string;
}

/**
 * Filing-level status shown on the picker card. Mapped from the
 * obligation's derived status + the action's launch readiness:
 *   submitted          — obligation COMPLETED or a prior run finished review
 *   in_progress        — obligation IN_PROGRESS or a run is active
 *   ready_to_start     — SmartPR has everything; browser may launch
 *   missing_information— non-sensitive SmartPR data still missing; the user
 *                        goes back to SmartPR fields instead of the browser
 *   blocked            — waiting on another filing (config.blockedBy)
 *   not_available      — a filing variant exists for the requirement but is
 *                        not launchable (disabled, or its launch switch is
 *                        off) — visible, never startable
 *   unsupported        — SmartPR identified the requirement but no browser
 *                        filing exists for it yet (disabled entry, no launch)
 */
export type FilingStatus =
  | "ready_to_start"
  | "missing_information"
  | "in_progress"
  | "submitted"
  | "blocked"
  | "not_available"
  | "unsupported";

export interface FilingOption {
  /** Stable id: the filing type for supported options, `unsupported:<obligation_id>` otherwise. */
  id: string;
  /**
   * Full resolved action when a browser filing exists for this obligation.
   * Null when unsupported — rendered as a disabled entry, never launched.
   */
  action: AgencyAction | null;
  obligation_id: string;
  requirement_id: string | null;
  obligation_name: string;
  obligation_status: string;
  filing_status: FilingStatus;
  supported: boolean;
  /** Fictional rehearsal portal entry (synthetic obligation). */
  demo?: boolean;
  /**
   * Id of the active run behind an `in_progress` filing — powers the
   * Resume button so a filing is never a dead end. Absent when the
   * in-progress state comes from the obligation alone (no run to reopen).
   */
  active_run_id?: string;
  // Convenience copies for grouped rendering.
  title_en: string;
  title_es: string;
  agency_id: string;
  agency_en: string;
  agency_es: string;
}

export interface FilingGroup {
  agency_id: string;
  agency_name_en: string;
  agency_name_es: string;
  /** Fictional rehearsal portal group — rendered with a DEMO badge. */
  demo?: boolean;
  filings: FilingOption[];
}

/** Synthetic obligation id/name for the demo rehearsal portal (no real obligation exists). */
export const DEMO_OBLIGATION_ID = "demo:rehearsal";
export const DEMO_REQUIREMENT_ID = "demo:rehearsal-filing";

const ACTIVE_RUN_STATUSES = new Set(["queued", "running", "paused"]);

/** Missing non-sensitive passport items — informational only. The human can
 * start the filing anyway and the assistant asks for these during the run. */
export function nonSensitiveMissingItems(
  action: AgencyAction
): AgencyAction["missing_items"] {
  return (action.missing_items ?? []).filter((m) => !m.sensitive);
}

export function syntheticDemoObligation(): ObligationLike {
  return {
    id: DEMO_OBLIGATION_ID,
    name: "Demo rehearsal filing",
    requirement_id: DEMO_REQUIREMENT_ID,
    agency: null,
    status: "MISSING",
  };
}

const FILING_STATUS_RANK: Record<FilingStatus, number> = {
  ready_to_start: 0,
  in_progress: 1,
  missing_information: 2,
  blocked: 3,
  submitted: 4,
  not_available: 5,
  unsupported: 6,
};

/** Group id for obligations with no browser filing available. The picker
 * shows this group (every requirement stays visible) but none of its
 * entries can start. */
export const OTHER_AGENCY_ID = "OTHER";

function filingStatusFor(
  obligationStatus: string,
  action: AgencyAction,
  completed: Set<AgencyFilingType>,
  active: Set<AgencyFilingType>
): FilingStatus {
  if (obligationStatus === "COMPLETED" || completed.has(action.filing_type)) {
    return "submitted";
  }
  if (obligationStatus === "IN_PROGRESS" || active.has(action.filing_type)) {
    return "in_progress";
  }
  if (action.status === "blocked") return "blocked";
  if (action.status === "not_required") return "unsupported";
  if (nonSensitiveMissingItems(action).length > 0) return "missing_information";
  return "ready_to_start";
}

/**
 * Resolve the filing picker for a business: every SmartPR obligation joined
 * to its browser filing (when one exists), grouped by agency. Agency is
 * visual grouping only — the execution objective is always the specific
 * obligation/filing, never the agency.
 */
export function resolveFilingOptions(input: {
  business_id: string;
  passport: Record<string, unknown> | null;
  priorRuns: { filing_type: AgencyFilingType; status: string; id?: string }[];
  obligations: ObligationLike[];
  /** Include the fictional rehearsal portal (admin / ?demo=1 only). */
  includeDemo?: boolean;
  /** Launch-switch environment (tests pass their own; defaults to process.env). */
  env?: Record<string, string | undefined>;
}): FilingGroup[] {
  const { passport, priorRuns, includeDemo } = input;
  const env = input.env ?? (typeof process !== "undefined" ? process.env : {});
  void input.business_id; // reserved for future per-business tuning

  const flat = flattenPassportValues(passport);

  const completed = new Set<AgencyFilingType>();
  const active = new Set<AgencyFilingType>();
  /** Newest active run id per filing type — the Resume target. */
  const activeRunId = new Map<AgencyFilingType, string>();
  for (const run of priorRuns ?? []) {
    if (COMPLETED_STATUSES.has(String(run.status))) completed.add(run.filing_type);
    else if (ACTIVE_RUN_STATUSES.has(String(run.status))) {
      active.add(run.filing_type);
      if (run.id) activeRunId.set(run.filing_type, run.id);
    }
  }

  // Every registry entry joins its requirements — including disabled ones —
  // so the human sees WHICH filing a requirement maps to. Whether it can
  // start is decided separately by isFilingLaunchable (enabled + launch
  // switch): non-launchable variants render as "not_available" and the run
  // API refuses them.
  const configByRequirementId = new Map<string, AgencyFilingConfig>();
  for (const config of AGENCY_FILING_CONFIGS) {
    for (const reqId of config.requirementIds ?? []) {
      if (!configByRequirementId.has(reqId)) configByRequirementId.set(reqId, config);
    }
  }

  const obligations = includeDemo
    ? [...input.obligations, syntheticDemoObligation()]
    : input.obligations;

  const seen = new Set<string>();
  const options: FilingOption[] = [];
  for (const obligation of obligations) {
    if (!obligation || seen.has(obligation.id)) continue;
    seen.add(obligation.id);
    const config = obligation.requirement_id
      ? configByRequirementId.get(obligation.requirement_id)
      : undefined;
    if (!config || !config.agencyId) {
      options.push({
        id: `unsupported:${obligation.id}`,
        action: null,
        obligation_id: obligation.id,
        requirement_id: obligation.requirement_id,
        obligation_name: obligation.name,
        obligation_status: obligation.status,
        filing_status: "unsupported",
        supported: false,
        title_en: obligation.name,
        title_es: obligation.name,
        agency_id: OTHER_AGENCY_ID,
        agency_en: obligation.agency || "Other SmartPR requirements",
        agency_es: obligation.agency || "Otros requisitos de SmartPR",
      });
      continue;
    }

    const base = actionForConfig(config, config.agencyId, flat, completed);
    base.obligation_id = obligation.id;
    base.requirement_id = obligation.requirement_id;

    // Each config names exactly one variant; its requirement already chose it.
    const variants = [withObjective(base)];
    const launchable = isFilingLaunchable(config, env);

    for (const action of variants) {
      const computed = filingStatusFor(obligation.status, action, completed, active);
      // Never offer Start for a non-launchable variant — but keep submitted /
      // in-progress truth (an existing run can still be resumed).
      const filing_status: FilingStatus =
        launchable || computed === "submitted" || computed === "in_progress"
          ? computed
          : "not_available";
      options.push({
        id: action.filing_type,
        action,
        obligation_id: obligation.id,
        requirement_id: obligation.requirement_id,
        obligation_name: obligation.name,
        obligation_status: obligation.status,
        filing_status,
        supported: filing_status !== "unsupported" && filing_status !== "not_available",
        demo: config.agencyId === "DEMO_REHEARSAL" ? true : undefined,
        active_run_id: activeRunId.get(action.filing_type),
        title_en: action.title_en,
        title_es: action.title_es,
        agency_id: config.agencyId,
        agency_en: config.agencyEn,
        agency_es: config.agencyEs,
      });
    }
  }

  // Group by agency (visual grouping only), agency order first, unsupported
  // obligations trailing in their own group.
  const groupOrder = [...AGENCY_IDS, OTHER_AGENCY_ID];
  const groups = new Map<string, FilingGroup>();
  for (const option of options) {
    let group = groups.get(option.agency_id);
    if (!group) {
      const other = option.agency_id === OTHER_AGENCY_ID;
      group = {
        agency_id: option.agency_id,
        agency_name_en: other ? "Other SmartPR requirements" : option.agency_en,
        agency_name_es: other ? "Otros requisitos de SmartPR" : option.agency_es,
        demo: option.demo,
        filings: [],
      };
      groups.set(option.agency_id, group);
    }
    group.filings.push(option);
  }
  const ordered = [...groups.values()].sort(
    (a, b) => groupOrder.indexOf(a.agency_id) - groupOrder.indexOf(b.agency_id)
  );
  for (const group of ordered) {
    group.filings.sort(
      (a, b) => FILING_STATUS_RANK[a.filing_status] - FILING_STATUS_RANK[b.filing_status]
    );
  }
  return ordered;
}
