/**
 * Chat-first agency assistant: contract facade for the agency-run route.
 *
 * Thin delegation layer over the real lib modules (single source of truth):
 *   frontend/src/lib/agency-runs/workflowStates.ts
 *   frontend/src/lib/agency-runs/milestoneClassifier.ts
 *   frontend/src/lib/agency-runs/validationErrors.ts
 *   frontend/src/lib/agency-runs/irreversibleGates.ts
 *   frontend/src/lib/agency-runs/agencyActions.ts
 *   frontend/src/lib/agency-runs/goalBrief.ts
 *
 * A few route call sites need string shapes where the lib returns bilingual
 * objects — those get small adapters here. `actionStatusChipLabel` and
 * `chatScrollKey` are route-specific pure helpers that live here.
 *
 * Pure module (no React) so it is directly unit-testable.
 */
import type { Lang } from "../../../forms/engine/types";
import type {
  AgencyFilingType,
  AgencyPauseReason,
  AgencyRunEvent,
  AgencyRunStatus,
} from "../../../../lib/agency-runs/types";

export type { AgencyFilingType, AgencyPauseReason, AgencyRunEvent, AgencyRunStatus };
export type { AgencyAction } from "../../../../lib/agency-runs/agencyActions";
export type { GoalBrief } from "../../../../lib/agency-runs/goalBrief";
export type { AgencyWorkflowState } from "../../../../lib/agency-runs/workflowStates";
export type { ChatMilestone } from "../../../../lib/agency-runs/milestoneClassifier";

export {
  workflowStateForRun,
  isTerminalWorkflowState,
} from "../../../../lib/agency-runs/workflowStates";
import { workflowStatusLine as libWorkflowStatusLine } from "../../../../lib/agency-runs/workflowStates";
import type { AgencyWorkflowState } from "../../../../lib/agency-runs/workflowStates";
export { buildChatMilestones } from "../../../../lib/agency-runs/milestoneClassifier";
import { humanizeValidationError as libHumanizeValidationError } from "../../../../lib/agency-runs/validationErrors";
import { interventionHeading as libInterventionHeading } from "../../../../lib/agency-runs/validationErrors";
import { gateCopy as libGateCopy } from "../../../../lib/agency-runs/irreversibleGates";

const L = (en: string, es: string, lang: Lang) => (lang === "es" ? es : en);

/* ------------------------------------------------------------------ */
/* Route-specific pure helpers                                         */
/* ------------------------------------------------------------------ */

/** Compact status-chip label for an agency action card. Testable pure helper. */
export function actionStatusChipLabel(
  action: import("../../../../lib/agency-runs/agencyActions").AgencyAction,
  lang: Lang
): string {
  switch (action.status) {
    case "ready":
      return L("Ready to start", "Lista para empezar", lang);
    case "blocked": {
      const missing = action.missing_items?.length ?? 0;
      if (missing > 0) {
        return L(
          `Ready once you add ${missing} item${missing === 1 ? "" : "s"}`,
          `Lista cuando completes ${missing} pieza${missing === 1 ? "" : "s"}`,
          lang
        );
      }
      return L("Waiting on another step", "Esperando otro paso", lang);
    }
    case "not_required":
      return L("Not currently required", "No se requiere por ahora", lang);
    case "completed":
      return L("Completed", "Completada", lang);
  }
}

/* ------------------------------------------------------------------ */
/* Adapters: lib bilingual shapes -> the string shapes route call sites */
/* ------------------------------------------------------------------ */

/**
 * The SINGLE transient in-place status indicator at the bottom of chat.
 * Route call sites pass already-localized plain strings; the lib takes
 * bilingual objects, so localize-then-passthrough keeps behavior identical.
 */
export function workflowStatusLine(
  state: AgencyWorkflowState,
  lang: Lang,
  portalName?: string,
  detail?: string
): string {
  return libWorkflowStatusLine(
    state,
    lang,
    portalName ? { en: portalName, es: portalName } : undefined,
    detail ? { en: detail, es: detail } : undefined
  );
}

/**
 * Copy for the irreversible-action gate on the review card.
 * SmartPR never final-submits — the final-submission gate body says it plainly.
 */
export function gateCopy(lang: Lang): string {
  const g = libGateCopy("final_submission", lang);
  return L(g.body_en, g.body_es, lang);
}

/**
 * Translate a raw (possibly technical) validation error into human language.
 * Never leaks selectors, timeouts, or DOM internals. Always returns a human
 * string — the lib never invents explanations, quoting the raw text when it
 * has nothing better to say.
 */
export function humanizeValidationError(raw: unknown, lang: Lang): string {
  return libHumanizeValidationError(
    typeof raw === "string" ? raw : undefined,
    lang
  );
}

/** Title for the in-chat intervention card, from the pause reason. */
export function interventionHeading(pauseReason: AgencyPauseReason, lang: Lang): string {
  const h = libInterventionHeading(pauseReason, lang);
  return L(h.title_en, h.title_es, lang);
}

/* ------------------------------------------------------------------ */
/* Chat scroll key — single stable key so the thread scrolls on change  */
/* ------------------------------------------------------------------ */

export function chatScrollKey(args: {
  runId: string | null;
  milestoneCount: number;
  transient: string;
  cardOpen: boolean;
  msgCount: number;
}): string {
  return [
    args.runId ?? "none",
    args.milestoneCount,
    args.transient,
    args.cardOpen ? "card" : "nocard",
    args.msgCount,
  ].join("|");
}
