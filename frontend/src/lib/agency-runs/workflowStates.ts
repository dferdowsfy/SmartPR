/**
 * Workflow-level presentation states for Agency Assist runs.
 *
 * The run model (types.ts) tracks machine states ("queued" | "running" |
 * "paused" | ...). This module translates those into human-facing workflow
 * states and the single transient in-place status line the UI shows while a
 * run is active. Pure functions only — no I/O.
 */
import type {
  AgencyPauseReason,
  AgencyRunStatus,
} from "./types";
import type { Lang } from "../../app/forms/engine/types";

export type AgencyWorkflowState =
  | "NOT_STARTED"
  | "PREPARING"
  | "READY"
  | "AUTOMATING"
  | "WAITING_FOR_USER"
  | "VALIDATING_USER_INPUT"
  | "RESUMING"
  | "BLOCKED"
  | "READY_FOR_REVIEW"
  | "SUBMITTING"
  | "COMPLETED"
  | "FAILED";

const L = (en: string, es: string, lang: Lang): string =>
  lang === "es" ? es : en;

export interface WorkflowStateInput {
  status: AgencyRunStatus;
  pauseReason: AgencyPauseReason;
  /**
   * Consecutive pauses for the same reason (from AgencyRun.pause_streak).
   * A streak >= 3 means the user is stuck in a pause loop -> BLOCKED.
   */
  pauseStreak?: number;
}

/**
 * Map a run's machine status to the human-facing workflow state.
 *
 * Notes:
 * - paused -> WAITING_FOR_USER for every pause reason (USER_LOGIN,
 *   USER_UPLOAD, CAPTCHA, PAYMENT); a pauseStreak >= 3 escalates to BLOCKED.
 * - stopped -> NOT_STARTED: the user deliberately stopped the run, so the
 *   workflow returns to its pre-run state.
 * - There is no path to SUBMITTING from the current model: the agent never
 *   final-submits on a portal. The type member is reserved for future use.
 */
export function workflowStateForRun(
  input: WorkflowStateInput
): AgencyWorkflowState {
  const { status, pauseStreak = 0 } = input;
  switch (status) {
    case "queued":
      return "PREPARING";
    case "running":
      return "AUTOMATING";
    case "paused":
      return pauseStreak >= 3 ? "BLOCKED" : "WAITING_FOR_USER";
    case "review":
      return "READY_FOR_REVIEW";
    case "stopped":
      return "NOT_STARTED";
    case "failed":
      return "FAILED";
  }
}

export interface WorkflowStatusLineOptions {
  /** Bilingual portal name, e.g. { en: "SURI", es: "SURI" }. */
  portalName?: { en: string; es: string };
  /** Optional second-line hint under the status, e.g. what is being filled. */
  detail?: { en: string; es: string };
}

/**
 * The SINGLE transient in-place status indicator text for a workflow state.
 * Plain user language, bilingual. When `detail` is provided it is appended
 * on a second line.
 */
export function workflowStatusLine(
  state: AgencyWorkflowState,
  lang: Lang,
  portalName?: { en: string; es: string },
  detail?: { en: string; es: string }
): string {
  const portal = portalName ? L(portalName.en, portalName.es, lang) : null;
  const withDetail = (base: string): string =>
    detail ? `${base}\n${L(detail.en, detail.es, lang)}` : base;

  switch (state) {
    case "NOT_STARTED":
      return L("Ready when you are.", "Lista cuando tú digas.", lang);
    case "PREPARING":
      return L("Preparing your filing…", "Preparando tu radicación…", lang);
    case "READY":
      return L("Ready to start.", "Lista para empezar.", lang);
    case "AUTOMATING":
      return withDetail(
        portal
          ? L(`Working on ${portal}…`, `Trabajando en ${portal}…`, lang)
          : L("Working on the portal…", "Trabajando en el portal…", lang)
      );
    case "WAITING_FOR_USER":
      return withDetail(L("I need one item from you.", "Necesito un dato tuyo.", lang));
    case "VALIDATING_USER_INPUT":
      return L(
        "Checking what you sent…",
        "Verificando lo que me pasaste…",
        lang
      );
    case "RESUMING":
      return L(
        "Picking up where we left off…",
        "Retomando donde nos quedamos…",
        lang
      );
    case "BLOCKED":
      return L(
        "I'm stuck on something I can't fix alone.",
        "Me tranqué en algo que no puedo resolver solo.",
        lang
      );
    case "READY_FOR_REVIEW":
      return L(
        "Your application is ready for review.",
        "Tu solicitud está lista para revisión.",
        lang
      );
    case "SUBMITTING":
      return L("Submitting your filing…", "Enviando tu radicación…", lang);
    case "COMPLETED":
      return L(
        "Done — your filing is complete.",
        "Listo — tu radicación está completa.",
        lang
      );
    case "FAILED":
      return L(
        "Something didn't work — here's what happened.",
        "Algo no funcionó — esto fue lo que pasó.",
        lang
      );
  }
}

/** True for workflow states the run cannot leave on its own. */
export function isTerminalWorkflowState(state: AgencyWorkflowState): boolean {
  return state === "COMPLETED" || state === "FAILED";
}
