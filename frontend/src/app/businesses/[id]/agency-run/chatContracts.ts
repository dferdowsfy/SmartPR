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
export type {
  FilingGroup,
  FilingOption,
  FilingStatus,
} from "../../../../lib/agency-runs/agencyActions";
export type { GoalBrief } from "../../../../lib/agency-runs/goalBrief";
export type {
  Preflight,
  PreflightQuestion,
  PortalAccountStatus,
} from "../../../../lib/agency-runs/preflight";
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
/* Filing picker — obligation-driven (filing-first) copy helpers       */
/* ------------------------------------------------------------------ */

/** Compact status-chip label for a filing option card. Testable pure helper. */
export function filingStatusChipLabel(
  option: import("../../../../lib/agency-runs/agencyActions").FilingOption,
  lang: Lang
): string {
  switch (option.filing_status) {
    case "ready_to_start":
      return L("Ready to start", "Lista para empezar", lang);
    case "missing_information":
      return L("Missing information", "Falta información", lang);
    case "in_progress":
      return L("In progress", "En curso", lang);
    case "submitted":
      return L("Submitted", "Enviada", lang);
    case "blocked":
      return L("Blocked", "Bloqueada", lang);
    case "unsupported":
      return L("Not yet supported", "Aún no soportado", lang);
  }
}

/**
 * Intro line for the filing picker — states plainly that SmartPR decided
 * what needs to be filed; the human only picks which filing to prepare.
 */
export function filingPickerIntro(lang: Lang): string {
  return L(
    "I found the filings SmartPR has identified for this business. Which one would you like me to prepare?",
    "Encontré los trámites que SmartPR identificó para este negocio. ¿Cuál quieres que prepare?",
    lang
  );
}

/**
 * Gate copy shown when SmartPR information is still missing for a filing.
 * Informational only — the human can start anyway and the assistant asks
 * for the missing items during the run (mid-run pauses). Never validated
 * as portal-required fields, so this never blocks the launch.
 */
export function filingGateCopy(count: number, lang: Lang): string {
  if (lang === "es") {
    return count === 1
      ? "Aún falta 1 pieza en tu Pasaporte de Negocio — el asistente te la pedirá durante el trámite."
      : `Aún faltan ${count} piezas en tu Pasaporte de Negocio — el asistente te las pedirá durante el trámite.`;
  }
  return count === 1
    ? "1 item is still missing from your Business Passport — the assistant will ask for it during the filing."
    : `${count} items are still missing from your Business Passport — the assistant will ask for them during the filing.`;
}

/** Copy for an obligation SmartPR identified but no browser filing covers yet. */
export function filingUnsupportedCopy(lang: Lang): string {
  return L(
    "SmartPR identified this requirement, but a browser filing isn't available for it yet.",
    "SmartPR identificó este requisito, pero aún no hay un trámite de navegador disponible para él.",
    lang
  );
}

/**
 * Call-to-action on a missing-information filing card — the missing items
 * are Business Passport facts, so the card links to the passport section
 * where the human fills them in. Without this the card is a dead end.
 */
export function filingPassportCtaCopy(lang: Lang): string {
  return L(
    "Complete in Business Passport",
    "Completar en el Pasaporte del Negocio",
    lang
  );
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

const FAILURE_PREFIXES = ["Agent run failed:", "El agente falló:"];

/**
 * Extract the underlying failure reason from a run's events for the terminal
 * failure bubble. The store records the raw provider error as
 * "Agent run failed: <error>"; this strips the prefix and humanizes it so
 * chat shows the actual reason instead of a generic "hit a problem".
 * Returns null when no failure event is present.
 */
export function failureReason(
  events: { message?: string; message_es?: string }[] | undefined | null,
  lang: Lang
): string | null {
  if (!events || events.length === 0) return null;
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    const text = lang === "es" ? ev?.message_es : ev?.message;
    if (typeof text !== "string") continue;
    const prefix = FAILURE_PREFIXES.find((p) => text.startsWith(p));
    if (!prefix) continue;
    const raw = text.slice(prefix.length).trim();
    return humanizeValidationError(raw || undefined, lang);
  }
  return null;
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
