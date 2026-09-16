/**
 * Pre-flight model for Agency Assist.
 *
 * RULE: passport first, questions second. The pre-flight chat message leads
 * with the passport items SmartPR will reuse (labels only — never values),
 * then asks AT MOST 3 questions that SmartPR genuinely cannot answer itself:
 *
 *   Q1. Portal account status — "Do you already have an account on {portal}?"
 *       (only when not already remembered). Decides the run's first step:
 *       login gate vs new-account registration.
 *   Q2. Known-sensitive items — secure masked inputs for sensitive missing
 *       items the action already flags (e.g. SSN), with an "ask me later"
 *       skip. Values flow ONLY into the agent prompt's FIELDS FILL block —
 *       never persisted on the run, never rendered into chat or events.
 *   Q3. Evidence — attach supporting documents now or during the run.
 *
 * Pure module (no React, no DB) so it is directly unit-testable.
 */
import type { AgencyFilingConfig } from "./filingTypes";
import type { AgencyAction } from "./agencyActions";
import type { GoalBrief } from "./goalBrief";

export type PortalAccountStatus = "has_account" | "no_account" | "unknown";

export type PreflightQuestion =
  | { kind: "account_status" }
  | {
      kind: "sensitive_field";
      id: string;
      label_en: string;
      label_es: string;
    }
  | { kind: "evidence" };

export interface Preflight {
  /** Labels only — never passport values. */
  passport_items: { label_en: string; label_es: string }[];
  questions: PreflightQuestion[];
  portal_name_en: string;
  portal_name_es: string;
  /** Up-front evidence tags for the attach-now question. */
  evidence_tags: string[];
}

/** Max questions in the pre-flight message — unanswered ones become mid-run pauses. */
export const MAX_PREFLIGHT_QUESTIONS = 3;

/**
 * Build the pre-flight model. Account status is asked only when unknown;
 * sensitive fields come only from the action's own missing_items (sensitive
 * flags); evidence appears only when the filing config needs uploads.
 */
export function buildPreflight(input: {
  config: AgencyFilingConfig;
  action: AgencyAction;
  brief: GoalBrief;
  portalAccount: PortalAccountStatus;
}): Preflight {
  const { config, action, portalAccount } = input;
  const questions: PreflightQuestion[] = [];

  // Q1 — portal account status (skip when already remembered).
  if (portalAccount === "unknown") {
    questions.push({ kind: "account_status" });
  }

  // Q2 — known-sensitive missing items, in the action's own order.
  const sensitiveMissing = (action.missing_items ?? []).filter((m) => m.sensitive);
  for (const m of sensitiveMissing) {
    if (questions.length >= MAX_PREFLIGHT_QUESTIONS) break;
    questions.push({
      kind: "sensitive_field",
      id: m.id,
      label_en: m.label_en,
      label_es: m.label_es,
    });
  }

  // Q3 — evidence, only when the filing config actually needs uploads.
  const needsEvidence =
    (config.evidenceTags?.length ?? 0) > 0 || (config.uploadsEn ?? "").trim().length > 0;
  if (needsEvidence && questions.length < MAX_PREFLIGHT_QUESTIONS) {
    questions.push({ kind: "evidence" });
  }

  return {
    passport_items: (input.brief.known_fields ?? []).map((f) => ({
      label_en: f.label_en,
      label_es: f.label_es,
    })),
    questions,
    portal_name_en: config.portalEn,
    portal_name_es: config.portalEs,
    evidence_tags: config.evidenceTags ?? [],
  };
}

/**
 * Validate a client-supplied account-status answer. Only the two explicit
 * choices are accepted — anything else is treated as unanswered.
 */
export function parseAccountStatusAnswer(
  value: unknown
): "has_account" | "no_account" | null {
  if (value === "has_account" || value === "no_account") return value;
  return null;
}
