import type { AgencyFilingConfig, PlaybookChannel } from "./filingTypes";
import { renderPortalFieldMapping } from "./canonicalFields";
import {
  goalBriefToPromptBlock,
  stripSensitivePassport,
  type GoalBrief,
} from "./goalBrief";
import type { SubmissionObjective } from "./types";

/**
 * Render the structured submission objective as the first block of the
 * agent task prompt. No browser session starts without one of these:
 * SmartPR decided what must be filed, and the agent executes ONLY it.
 * Ids/labels only — never field values, never secrets.
 */
export function submissionObjectivePromptBlock(
  objective: SubmissionObjective
): string {
  const lines = [
    "=== SUBMISSION OBJECTIVE ===",
    `submission_objective_id: ${objective.submission_objective_id}`,
    `business_id: ${objective.business_id}`,
    `requirement_id: ${objective.requirement_id ?? "(none)"}`,
    `requirement_name: ${objective.requirement_name}`,
    `obligation_id: ${objective.obligation_id}`,
    `obligation_status: ${objective.obligation_status}`,
    `agency: ${objective.agency}`,
    `transaction_type: ${objective.transaction_type}`,
    `target_portal: ${objective.target_portal}`,
    `approved_fields: ${(objective.approved_fields ?? []).join(", ") || "(none)"}`,
    `approved_documents: ${(objective.approved_documents ?? []).join(", ") || "(none)"}`,
    `ready_to_start: ${objective.ready_to_start}`,
    "",
    "You are executing ONE SmartPR filing objective. Complete only this filing.",
    "Use only the structured SmartPR fields and approved documents provided with this task.",
    "Do not choose a different transaction.",
    "Do not infer missing facts.",
    "Do not add new requirements.",
    "Stop and report a blocker if the portal requests information SmartPR has not supplied.",
    "=== END SUBMISSION OBJECTIVE ===",
  ];
  return lines.join("\n");
}

/** Ephemeral login fields for USER_LOGIN resume — never persisted on the run. */
export type ResumeCredentials = {
  email?: string;
  password?: string;
  mfa?: string;
};

/** Unified ephemeral field map keyed by stable id (email, password, ssn, …). */
export type ResumeFields = Record<string, string>;

/**
 * Render a filing playbook as the deterministic procedure block of the agent
 * task prompt. Steps render in recorded order with their channel semantics
 * so the agent knows, per step, whether to collect fields in the Assistant
 * panel (INLINE), pull credentials from Secure Vault (VAULT), hand the step
 * to the human in the live browser (IN_BROWSER), or drive it itself (AGENT).
 * Sensitive fields are flagged — the agent must never invent them.
 *
 * Returns null when the config carries no playbook (or an empty one) so the
 * caller can fall back to the goal-oriented `procedureEn` outline.
 */
export function renderPlaybookProcedure(
  config: AgencyFilingConfig
): string | null {
  const playbook = config.playbook;
  const steps = playbook?.steps;
  if (!playbook || !Array.isArray(steps) || steps.length === 0) return null;

  const CHANNEL_NOTES: Record<PlaybookChannel, string> = {
    INLINE:
      "the human provides these fields in the SmartPR Assistant panel — emit REQUIRED_FIELDS with exactly these ids, then WAIT for FIELDS FILL",
    VAULT:
      "credentials come from Secure Vault — never ask the human to type them in chat or the browser",
    IN_BROWSER:
      "the human handles this step directly in the live browser — pause and invite takeover",
    AGENT: "drive this step yourself — no user input needed",
  };

  const lines = [
    `PLAYBOOK PROCEDURE — ${playbook.scope_en}. Follow these steps IN ORDER. Adapt only when the portal's actual screens differ from what is recorded.`,
  ];
  steps.forEach((step, i) => {
    lines.push(`${i + 1}. ${step.label_en} [${step.channel}: ${CHANNEL_NOTES[step.channel]}]`);
    if (step.pageId) lines.push(`   Portal page: "${step.pageId}"`);
    for (const f of step.fields ?? []) {
      const parts = [`id=${f.id}`, `label=${f.label_en}`, `type=${f.type}`];
      parts.push(f.required ? "required" : "optional");
      if (f.sensitive) parts.push("sensitive=true");
      if (f.repeatable) parts.push("repeatable");
      if (f.passportPath) parts.push(`passport=${f.passportPath}`);
      if (f.options && f.options.length > 0) {
        parts.push(`options=${f.options.join(" | ")}`);
      }
      lines.push(`   - ${parts.join("; ")}`);
    }
    if (step.gate) lines.push(`   GATE: ${step.gate}`);
    if (step.expectedState_en) lines.push(`   Continue when: ${step.expectedState_en}`);
    if (step.notes_en) lines.push(`   Note: ${step.notes_en}`);
  });
  lines.push(
    `CONFIRMATION — capture and report: ${playbook.confirmation.reference_en} (${playbook.confirmation.where_en})`
  );
  if (playbook.quirks_en.length > 0) {
    lines.push("PORTAL QUIRKS (observed during the walkthrough — respect these):");
    for (const q of playbook.quirks_en) lines.push(`   - ${q}`);
  }
  return lines.join("\n");
}

export function credentialsToFields(
  creds: ResumeCredentials | null | undefined
): ResumeFields {
  if (!creds) return {};
  const out: ResumeFields = {};
  if (typeof creds.email === "string" && creds.email.trim()) out.email = creds.email.trim();
  if (typeof creds.password === "string" && creds.password.trim()) {
    out.password = creds.password.trim();
  }
  if (typeof creds.mfa === "string" && creds.mfa.trim()) out.mfa = creds.mfa.trim();
  return out;
}

/**
 * Merge credentials into fields (fields win on key conflict).
 * Returns null when nothing usable was provided.
 */
export function mergeResumeFields(
  fields?: ResumeFields | null,
  credentials?: ResumeCredentials | null
): ResumeFields | null {
  const fromCreds = credentialsToFields(credentials);
  const fromFields: ResumeFields = {};
  if (fields && typeof fields === "object") {
    for (const [k, v] of Object.entries(fields)) {
      if (typeof k !== "string" || typeof v !== "string") continue;
      const id = k.trim();
      const val = v.trim();
      if (!id || !val) continue;
      fromFields[id] = val;
    }
  }
  const merged = { ...fromCreds, ...fromFields };
  return Object.keys(merged).length > 0 ? merged : null;
}

/**
 * Build the Browser Use Cloud task prompt for an assisted portal filing.
 * Fully generated from the filing-type registry — the brief stays
 * goal-oriented on purpose (never a brittle click map). Passport JSON is
 * embedded for prefill; sensitive IDs must not be invented.
 */
export function buildAgencyTaskPrompt(input: {
  config: AgencyFilingConfig;
  passport: Record<string, unknown> | null;
  resumeHint?: string;
  /** @deprecated Prefer `fields` — kept for callers that still pass login-shaped objects. */
  credentials?: ResumeCredentials | null;
  /** Ephemeral field values from the Assistant panel (never persisted). */
  fields?: ResumeFields | null;
  /** Labels-only goal brief from the agency-action flow (never values). */
  goalBrief?: GoalBrief | null;
  /**
   * Structured submission objective — required for browser launches.
   * Rendered as the first block of the prompt so the agent's execution
   * scope is exactly one SmartPR filing requirement.
   */
  submissionObjective?: SubmissionObjective | null;
  /**
   * Server-side authorization for the agent to click final submit.
   * Only true after the owner-authenticated authorize endpoint recorded
   * filing_authorized=true on the run. Never derive this from agent
   * output or client input.
   */
  authorizedFiling?: boolean;
  /**
   * True when building the follow-up prompt dispatched right after the
   * owner authorized final submission. Generates a dedicated resume block
   * (instead of the generic pause-handling resumeHint text).
   */
  authorizeResume?: boolean;
}): string {
  const { config } = input;
  // SECURITY: strip sensitive leaves (SSN, passwords, MFA, …) before the
  // passport is embedded in the prompt — the agent must never see values
  // the passport cannot fill.
  const safePassport = stripSensitivePassport(input.passport);
  const passportBlock = safePassport
    ? JSON.stringify(safePassport, null, 2)
    : "(no passport JSON available — fill only what the user provides on screen; do not invent data)";

  const authorizedFiling = input.authorizedFiling === true;

  const submitRule = authorizedFiling
    ? "1. AUTHORIZED FINAL SUBMISSION: the run owner explicitly authorized SmartPR to file this submission (filing_authorized=true, recorded server-side after pre-submit review). You MAY now click the final Submit / Enviar / Confirmar envío button for THIS filing objective only. After clicking, capture the confirmation number / receipt reference shown by the portal and end with SUBMITTED:<confirmation> (e.g. SUBMITTED:2026-88412). If the portal shows no confirmation reference, use SUBMITTED:confirmed-on-screen. Do NOT click submit for any other filing or objective."
    : "1. NEVER click the final Submit / Enviar / Confirmar envío button that permanently files. Stop at pre-submit review and report REVIEW_READY.";

  const pauseMarkers = authorizedFiling
    ? "PAUSE_USER_UPLOAD | PAUSE_USER_LOGIN | PAUSE_CAPTCHA | PAUSE_PAYMENT | REVIEW_READY | SUBMITTED:<confirmation> | FAILED:<reason>"
    : "PAUSE_USER_UPLOAD | PAUSE_USER_LOGIN | PAUSE_CAPTCHA | PAUSE_PAYMENT | REVIEW_READY | FAILED:<reason>";

  const fields = mergeResumeFields(input.fields, input.credentials);
  const hasFields = Boolean(fields && Object.keys(fields).length > 0);

  let fieldsBlock = "";
  if (hasFields && fields) {
    const lines: string[] = [
      "",
      "FIELDS FILL (user provided from the SmartPR Assistant panel — use EXACTLY these values; do not invent or alter them)",
    ];
    for (const [id, value] of Object.entries(fields)) {
      lines.push(`- ${id}: type exactly: ${value}`);
    }
    lines.push(
      "- Locate the matching fields on the CURRENT page (by label / autocomplete / nearby text) and type these values into them.",
      "- After FIELDS FILL, continue filling any remaining non-sensitive blanks from the Business Passport JSON — do not stop at only the listed ids.",
      "- If an Ingresar / Login / Sign in / Continuar / Next / Guardar button is present after filling, click it to proceed past the gate.",
      "- If the fields were accepted (you leave the page or the blanks are no longer empty), do NOT re-pause for the same fields.",
      authorizedFiling
        ? "- The owner authorized final submission for this run — after FIELDS FILL and verification you MAY click the final Submit / Enviar for THIS filing only, then report SUBMITTED:<confirmation>."
        : "- Still NEVER click the final Submit / Enviar that permanently files.",
      "- Do not invent secrets; only use the values listed above. If a listed id has no matching control on screen, skip it and note that — do not invent a different field."
    );
    fieldsBlock = "\n" + lines.join("\n");
  }

  const authorizeBlock = input.authorizeResume
    ? `\n\nRESUME CONTEXT: The run owner reviewed the pre-submit state in SmartPR and explicitly authorized final submission (filing_authorized=true, recorded server-side). VERIFY the current page still shows the pre-submit review you reported — do not re-fill fields that are already correct. Then click the final Submit / Enviar / Confirmar envío button for THIS filing objective only. Capture the confirmation number / receipt reference the portal shows and end with SUBMITTED:<confirmation>. If the portal shows no reference, use SUBMITTED:confirmed-on-screen.`
    : "";

  const resume = input.resumeHint
    ? hasFields
      ? `\n\nRESUME CONTEXT: The human provided required fields from the Assistant panel so you can fill them on the current page. ${fieldsBlock ? "Follow FIELDS FILL below, then" : ""} briefly VERIFY the page state and CONTINUE toward pre-submit review — do NOT re-pause for the same fields if they are now filled. Only pause again if other gates remain or listed fields are still empty / rejected, and emit REQUIRED_FIELDS for whatever is still missing — prefer error=<exact on-screen validation message> and keep hint= for format if useful. The Business Passport JSON below is still your prefill source — keep filling every identified field from it.`
      : `\n\nRESUME CONTEXT: The human just handled the pause (${input.resumeHint}) directly in the live browser — assume they completed the login / typed the sensitive fields / uploaded the documents. Briefly VERIFY the current page state: if the previously blocking step is done (fields filled, gate cleared), CONTINUE forward toward pre-submit review — do NOT re-pause for the same reason. Only pause again if specific fields are still visibly empty or the gate is still literally blocking, and name exactly which fields are still missing via REQUIRED_FIELDS. The Business Passport JSON below is still your prefill source — keep filling every identified field from it.`
    : "";

  const playbookProcedure = renderPlaybookProcedure(config);
  const procedure =
    playbookProcedure ??
    config.procedureEn.map((step, i) => `${i + 1}. ${step}`).join("\n");
  const procedureHeading = playbookProcedure
    ? "PLAYBOOK PROCEDURE (goal-oriented — adapt to what the portal actually shows; ordered from the recorded filing flow)"
    : "PROCEDURE OUTLINE (goal-oriented — adapt to what the portal actually shows)";

  // Structured goal brief — so the agent is never sent in with just
  // "Go to SURI". Labels only, no values, no secrets.
  const goalBriefBlock = input.goalBrief
    ? `\n\n${goalBriefToPromptBlock(input.goalBrief)}\n`
    : "";

  return `${input.submissionObjective ? `${submissionObjectivePromptBlock(input.submissionObjective)}\n\n` : ""}You are SmartPR's agency filing assistant controlling a real browser for ${config.agencyEn} (${config.portalEn}).
${goalBriefBlock}
GOAL
- Filing: ${config.labelEn}
- ${config.goalEn}
- Open and stay on the allowlisted domains only: ${config.domains.join(", ")} (start: ${config.startUrl})
- Spanish UI is OK; follow on-screen Spanish labels.

PREFILL — DO THIS AGGRESSIVELY
- SEQUENCING (mandatory): on every page, FIRST fill ALL non-sensitive fields you can from the Business Passport JSON below. ONLY THEN pause for blanks the passport cannot satisfy (usually password / MFA / SSN / uploads).
- Do NOT PAUSE and do NOT emit REQUIRED_FIELDS for any control the passport can already fill (email, phone, legal/business names, addresses, municipality, EIN/registry when present and non-sensitive, etc.).
- Fill EVERY form field whose meaning you can identify from the passport: legal/business names, entity type, addresses, phone, email, dates, organizer/member details, non-sensitive IDs, and anything else with a clear match.
${renderPortalFieldMapping(config.agencyId)}
- For dropdowns/selects: pick the option whose visible text best matches the passport value. Never leave a dropdown on a placeholder/default when the passport identifies the value.
- For checkboxes/radios that clearly correspond to passport facts, set them.
- If a field has no passport match and is not sensitive, use visible page context; if truly unknown, leave it blank and note it — do not invent.
- Sensitive fields (SSN, ITIN, passwords, MFA codes): NEVER invent — leave them blank for the human and pause with the right marker below.

HUMAN INPUT PATH (login / required text fields)
- When you PAUSE_USER_LOGIN or pause for required text fields, the human types ONLY in the SmartPR Assistant panel on the left — NOT in the live browser iframe (it is view-only until Fill & continue).
- Do NOT expect the human to type into the live browser for email/password/MFA or other required text fields.
- Wait for resume with FIELDS FILL values; then type those exact values into the matching controls and continue.
- FILL RELIABILITY (mandatory on every form): portal pages re-render while you type, which can drop keystrokes or scatter characters into the wrong fields. After typing into ANY text field, read that field's value back from the page and confirm it matches what you intended. If it is empty or wrong: click into the field, select all (Ctrl+A / Cmd+A), delete, type the full value again in one steady pass, then read back again. Repeat until the value reads back correctly.
- Never click Submit / Log in / Continue / Guardar while a required field still reads back empty or wrong — the page will silently reject the submit and you will look stuck. Verify every required field's value first, then click once.
- After clicking submit, verify the page actually advanced (URL or heading changed). If you are still on the same form with no visible error message, re-read the field values before doing anything else — do not blindly re-click the button.
- Keep emitting accurate REQUIRED_FIELDS for whatever is still empty after passport prefill (ids/labels/types/sensitivity/hints/errors only — never echo secrets). Use hint= for format guidance; on failed fills prefer error=<exact on-screen validation message>.

HARD RULES (never violate)
${submitRule}
2. Domain allowlist: only ${config.domains.join(", ")} (and necessary redirects on those hosts). Do not visit other sites.
3. Do NOT invent SSN, ITIN, passwords, MFA codes, or other sensitive IDs. Leave those for the human (unless FIELDS FILL below supplies exact values for this turn only).
4. When you hit an upload wall, login/MFA wall, captcha, payment gate, or any page with required blanks the passport cannot fill: STOP immediately, do not loop, and end your message with BOTH:
   (a) exactly one pause/status marker, and
   (b) a machine-parseable REQUIRED_FIELDS block listing ONLY fields the human must provide (never list passport-fillable blanks).

PAUSE / STATUS MARKERS (exactly one)
   - PAUSE_USER_UPLOAD — documents required (${config.uploadsEn})
   - PAUSE_USER_LOGIN — portal login / MFA / account credentials required
   - PAUSE_CAPTCHA — captcha / portal challenge
   - PAUSE_PAYMENT — payment required
   - REVIEW_READY — pre-submit review; human submits${authorizedFiling ? "\n   - SUBMITTED:<confirmation> — authorized final submission completed; include the portal confirmation / receipt reference" : ""}
   - FAILED:<reason> — unrecoverable failure

REQUIRED_FIELDS PROTOCOL (mandatory on every PAUSE_*)
After the marker line, emit:

REQUIRED_FIELDS:
- id=<slug>; label=<human label>; type=<text|email|password|tel|number>; sensitive=<true|false>
- id=<slug>; label=<human label>; type=<...>; sensitive=<...>; optional=true
- id=<slug>; label=<human label>; type=<...>; sensitive=<...>; hint=<short format — no semicolons>
- id=<slug>; label=<human label>; type=<...>; sensitive=<...>; hint=<format>; error=<exact on-screen validation — no semicolons>

Rules for the block:
- List ONLY fields that are currently empty/required on screen AND that the passport cannot fill (or that are sensitive — passwords, MFA, SSN, ITIN, etc.). Never list email/phone/name/address/EIN/etc. when the passport already has a clear value — fill those yourself before pausing.
- Use stable id slugs: email, password, mfa, ssn, itin, phone, legal_name, …
- type must be one of: text | email | password | tel | number
- sensitive=true for passwords, MFA, SSN/ITIN. Prefer type=password ONLY for actual passwords; use type=text with sensitive=true for SSN/ITIN/ID so the human can verify format with show/hide.
- ALWAYS include hint= for SSN/ITIN/ID (and any format-sensitive field): describe the expected format as the portal shows it (e.g. "9 digits — dashes or no dashes as shown"). Do not put ";" inside hint or error values.
- On re-pause after a failed fill (portal validation error visible on screen): REQUIRED_FIELDS MUST prefer error=<exact on-screen validation message> AND may keep hint= for format if still useful (e.g. hint=9 digits; error=Portal: el número de ID no es válido).
- For PAUSE_USER_UPLOAD the fields block may be empty (upload UI already exists).
- For PAUSE_CAPTCHA / PAUSE_PAYMENT usually no text fields — takeover stays primary; you may emit an empty REQUIRED_FIELDS: block or omit field lines.
- On login pages: pause once with REQUIRED_FIELDS (email if passport has no email, password, mfa if shown). Prefer the Assistant-fill path. Do NOT loop on login.
- After the human provides values via resume / FIELDS FILL: fill those exact fields, then CONTINUE passport prefill for any remaining non-sensitive blanks on the page. Do not invent. Do not re-pause for the same fields if they are now filled.

Example (login):
PAUSE_USER_LOGIN
REQUIRED_FIELDS:
- id=email; label=Email; type=email; sensitive=false
- id=password; label=Password; type=password; sensitive=true
- id=mfa; label=MFA code; type=text; sensitive=true; optional=true

Example (sensitive profile blank):
PAUSE_USER_LOGIN
REQUIRED_FIELDS:
- id=ssn; label=SSN / ID; type=text; sensitive=true; hint=9 digits as shown on the portal (dashes OK)

Example (re-pause after bad format):
PAUSE_USER_LOGIN
REQUIRED_FIELDS:
- id=ssn; label=SSN / ID; type=text; sensitive=true; hint=9 digits; error=Portal: el número de ID no es válido

BUSINESS PASSPORT JSON (prefill source)
\`\`\`json
${passportBlock}
\`\`\`

${procedureHeading}
${procedure}
${authorizeBlock}${resume}${fieldsBlock}

When finished or paused, end with a short status line containing exactly one marker: ${pauseMarkers}
On every PAUSE_*, also include the REQUIRED_FIELDS block as specified above.`;
}

/**
 * Build the follow-up task prompt dispatched after the owner authorizes
 * final submission ("File it for me"). The ONLY difference from the
 * standard prompt is authorizedFiling=true, which lifts the never-submit
 * hard rule for this run's single filing objective.
 *
 * SECURITY: callers must only pass authorizedFiling=true after the
 * owner-authenticated authorize endpoint recorded filing_authorized=true
 * on the run. Never derive this from agent output or client input.
 */
export function buildAuthorizeTaskPrompt(input: {
  config: AgencyFilingConfig;
  passport: Record<string, unknown> | null;
  goalBrief?: GoalBrief | null;
  submissionObjective?: SubmissionObjective | null;
}): string {
  return buildAgencyTaskPrompt({
    config: input.config,
    passport: input.passport,
    goalBrief: input.goalBrief ?? null,
    submissionObjective: input.submissionObjective ?? null,
    authorizedFiling: true,
    authorizeResume: true,
  });
}

export function buildResumeTaskPrompt(input: {
  config: AgencyFilingConfig;
  pauseReason: string | null;
  passport: Record<string, unknown> | null;
  credentials?: ResumeCredentials | null;
  fields?: ResumeFields | null;
  /**
   * Server-side authorization for the agent to click final submit.
   * Only true after the owner authorized via the authorize endpoint.
   */
  authorizedFiling?: boolean;
}): string {
  return buildAgencyTaskPrompt({
    config: input.config,
    passport: input.passport,
    resumeHint: input.pauseReason || "user resumed after assisting",
    credentials: input.credentials ?? null,
    fields: input.fields ?? null,
    authorizedFiling: input.authorizedFiling ?? false,
  });
}
