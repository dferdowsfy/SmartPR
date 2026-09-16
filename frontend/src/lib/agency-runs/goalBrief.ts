/**
 * Structured goal brief for agency filings.
 *
 * SECURITY CONTRACT (audited below):
 * - GoalBrief carries LABELS ONLY — never field values, never secrets.
 * - `stripSensitivePassport` removes any key whose leaf matches the same
 *   sensitive-ID regex used by prefillFromPassport's isPrefillBlocked, so the
 *   passport JSON embedded in the task prompt can never leak SSNs,
 *   passwords, MFA codes, or other sensitive values.
 */
import type { AgencyFilingConfig } from "./filingTypes";
import type { AgencyAction } from "./agencyActions";
import { CANONICAL_LABELS } from "./canonicalFields";
import type { PortalAccountStatus } from "./preflight";

/**
 * Mirrors the SENSITIVE_ID_RE in prefillFromPassport.ts (that module does not
 * export it). Any key whose leaf matches is treated as sensitive and stripped.
 * Keep in sync if the source regex changes.
 */
const SENSITIVE_ID_RE =
  /\b(password|passwd|passcode|pwd|mfa|otp|totp|2fa|ssn|itin|tax[_-]?id|secret|pin|cvv|cvc|card[_-]?number|iban|routing)\b/i;

export interface GoalBrief {
  agency_en: string;
  agency_es: string;
  goal_en: string;
  goal_es: string;
  expected_outcome_en: string;
  expected_outcome_es: string;
  known_fields: { label_en: string; label_es: string }[];
  user_input_expected: { id: string; label_en: string; label_es: string; sensitive: boolean }[];
  evidence_available: string[];
  /**
   * Remembered/answered portal-account status (labels only). Drives the
   * PORTAL ACCOUNT line in the prompt block: HAS account → expect a login
   * gate; NO account → begin with new-account registration.
   */
  portal_account?: PortalAccountStatus;
}

/**
 * Build a labels-only brief from the filing config + resolved agency action.
 * Known fields = coverage keys with a known passport value (labels only).
 * User input expected = the action's missing items (ids/labels/sensitivity).
 *
 * `objective_en` / `objective_es` override the config's generic goal text when
 * the agency-action resolution pinned down a concrete objective (e.g. Dept. of
 * State annual report vs new-entity creation) — the agent must never be sent
 * in with an ambiguous goal.
 */
export function buildGoalBrief(input: {
  config: AgencyFilingConfig;
  action: AgencyAction;
  objective_en?: string | null;
  objective_es?: string | null;
  /** Portal-account label from memory or the pre-flight answer (labels only). */
  portal_account?: PortalAccountStatus;
}): GoalBrief {
  const { config, action } = input;

  // Known = coverage keys not flagged missing by the action. Missing-item ids
  // for passport fields are the canonical dotted paths themselves, so the
  // set of known fields is derived here rather than counted blindly.
  const coverage = config.passportCoverageKeys ?? [];
  const missingIds = new Set(
    (action.missing_items ?? [])
      .filter((m) => !m.sensitive)
      .map((m) => m.id)
  );
  const known_fields = coverage
    .filter((key) => !missingIds.has(key))
    .map((key) => {
      const lbl = CANONICAL_LABELS[key];
      return {
        label_en: lbl?.en ?? key,
        label_es: lbl?.es ?? key,
      };
    });

  const goal_en =
    input.objective_en?.trim() || action.objective_en?.trim() || config.goalEn;
  const goal_es =
    input.objective_es?.trim() || action.objective_es?.trim() || config.goalEs;

  return {
    agency_en: config.agencyEn,
    agency_es: config.agencyEs,
    goal_en,
    goal_es,
    expected_outcome_en: `Complete ${config.labelEn} and stop at pre-submit review — the human reviews and submits.`,
    expected_outcome_es: `Completar ${config.labelEs} y detenerse en la revisión previa al envío — el humano revisa y envía.`,
    known_fields,
    user_input_expected: (action.missing_items ?? []).map((m) => ({
      id: m.id,
      label_en: m.label_en,
      label_es: m.label_es,
      sensitive: m.sensitive,
    })),
    evidence_available: action.evidence_available ?? [],
    portal_account: input.portal_account,
  };
}

/**
 * Render the brief as a plain-text block for the agent task prompt.
 * Labels only — no values, no secrets.
 */
export function goalBriefToPromptBlock(brief: GoalBrief): string {
  const lines: string[] = [];
  lines.push("=== AGENCY / GOAL BRIEF ===");
  lines.push(`AGENCY: ${brief.agency_en} / ${brief.agency_es}`);
  lines.push(`GOAL: ${brief.goal_en}`);
  lines.push(`EXPECTED OUTCOME: ${brief.expected_outcome_en}`);
  // Only when the pre-flight step (or memory) resolved a portal-account
  // label — existing briefs without one stay byte-identical.
  if (brief.portal_account) {
    lines.push(portalAccountPromptLine(brief.portal_account));
  }
  lines.push("");
  lines.push(
    `KNOWN INFORMATION (${brief.known_fields.length} field${
      brief.known_fields.length === 1 ? "" : "s"
    } already in the Business Passport — prefill these aggressively, do NOT re-ask for them):`
  );
  if (brief.known_fields.length === 0) {
    lines.push("- (none yet — rely on the Business Passport JSON below and pause for the rest)");
  } else {
    for (const f of brief.known_fields) {
      lines.push(`- ${f.label_en}`);
    }
  }
  lines.push("");
  lines.push(
    `USER INPUT EXPECTED (pause for these via the pause markers — NEVER invent them):`
  );
  if (brief.user_input_expected.length === 0) {
    lines.push("- (none identified — if a gate appears, pause with the right marker and name the missing fields)");
  } else {
    for (const f of brief.user_input_expected) {
      lines.push(`- ${f.label_en}${f.sensitive ? " [sensitive — ask the human]" : ""}`);
    }
  }
  lines.push("");
  lines.push("AVAILABLE EVIDENCE:");
  if (brief.evidence_available.length === 0) {
    lines.push("- (no evidence tags on file for this filing)");
  } else {
    for (const tag of brief.evidence_available) {
      lines.push(`- ${tag}`);
    }
  }
  lines.push("=== END AGENCY / GOAL BRIEF ===");
  return lines.join("\n");
}

/**
 * Render the PORTAL ACCOUNT line for the agent prompt block.
 * - HAS account: expect a login gate; pause for credentials via USER_LOGIN.
 * - NO account: begin with new-account registration; pause where a password
 *   must be created — the agent NEVER invents or reuses a password.
 * - unknown/omitted: no line (the agent falls back to pausing at either gate).
 */
function portalAccountPromptLine(status: PortalAccountStatus | undefined): string {
  if (status === "has_account") {
    return "PORTAL ACCOUNT: the human already has an account on this portal — expect a login gate and pause for credentials via USER_LOGIN; never invent or type login credentials yourself.";
  }
  if (status === "no_account") {
    return "PORTAL ACCOUNT: the human does NOT have an account on this portal — begin with new-account registration; pause where a password must be created (never invent one, never reuse one, never type a placeholder).";
  }
  return "PORTAL ACCOUNT: unknown — if a login gate appears, pause for credentials via USER_LOGIN; if registration is required, pause where a password must be created (never invent one).";
}

function leafOf(key: string): string {
  const trimmed = key.trim();
  const dot = trimmed.lastIndexOf(".");
  return dot >= 0 ? trimmed.slice(dot + 1) : trimmed;
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_ID_RE.test(leafOf(key));
}

/**
 * Recursively remove any key whose leaf matches SENSITIVE_ID_RE (and anything
 * under such a key). Objects and arrays are walked; everything else passes
 * through. Result is safe to embed in the task prompt.
 */
export function stripSensitivePassport(
  passport: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
  if (!passport || typeof passport !== "object") return null;
  const cleanNode = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(cleanNode);
    if (node && typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (!k || isSensitiveKey(k)) continue;
        out[k] = cleanNode(v);
      }
      return out;
    }
    return node;
  };
  return cleanNode(passport) as Record<string, unknown> | null;
}
