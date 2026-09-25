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
      : `\n\nRESUME CONTEXT: The human just handled the pause (${input.resumeHint}) directly in the live browser — they may have signed in, certified, signed, paid, uploaded or submitted. First re-identify the step the browser shows NOW. If the portal shows a submission confirmation (the human submitted), report SUBMITTED:<confirmation> and stop. If the previously blocking step is done, CONTINUE forward toward pre-submit review — do NOT re-pause for the same reason. Only pause again if that step is still literally blocking, with a PORTAL_STEP line (and REQUIRED_FIELDS only for form / identity steps). The Business Passport JSON below is still your prefill source — keep filling every identified field from it.`
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

SPEED (the human is watching live — every step costs seconds)
- FAST FILL: on a page with several plain text inputs / selects / textareas, fill them ALL in ONE JavaScript step instead of typing field by field. For each control use the native value setter so React/Vue forms register it, then fire events:
    const set = (el, v) => { const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); };
  Find controls by their label text, id, or name. Dates in native date inputs take ISO values (YYYY-MM-DD). Click checkboxes / radios normally.
- If a page rejects the JavaScript fill (values do not stick), fall back to typing — but type each value in one action, not character by character.
- Verify ONCE per page, right before submitting: read all required values back in a single step. Do not read back after every field.
- Do not re-read or re-navigate pages you have already completed, and do not wait or scroll without a reason.

PREFILL — DO THIS AGGRESSIVELY
- SEQUENCING (mandatory): on every page, FIRST fill ALL non-sensitive fields you can from the Business Passport JSON below. ONLY THEN pause for blanks the passport cannot satisfy (usually password / MFA / SSN / uploads).
- Do NOT PAUSE and do NOT emit REQUIRED_FIELDS for any control the passport can already fill (email, phone, legal/business names, addresses, municipality, EIN/registry when present and non-sensitive, etc.).
- Fill EVERY form field whose meaning you can identify from the passport: legal/business names, entity type, addresses, phone, email, dates, organizer/member details, non-sensitive IDs, and anything else with a clear match.
${renderPortalFieldMapping(config.agencyId)}
- For the Entity type dropdown: match the passport's business.entityType to the option's VISIBLE TEXT — sole_proprietorship="Sole proprietorship", llc="Limited Liability Company (LLC)", corporation="Corporation", nonprofit="Nonprofit organization" (Spanish equivalents likewise). Never invent an option that is not listed; if the passport's entity type matches no visible option, ask the human instead of stalling on retries.
- For dropdowns/selects: pick the option whose visible text best matches the passport value. Never leave a dropdown on a placeholder/default when the passport identifies the value.
- For checkboxes/radios that clearly correspond to passport facts, set them.
- If a field has no passport match and is not sensitive, use visible page context. If it is REQUIRED (asterisk, "required", or the browser blocks submit with "Please fill out this field") and still unknown: do NOT retry submit and do NOT guess — pause right away with PAUSE_USER_LOGIN and a REQUIRED_FIELDS line for exactly that field (e.g. id=fiscal_year_end; label=Fiscal year end; type=text; sensitive=false; hint=MM/DD/YYYY). Optional unknown fields stay blank.
- DATE FIELDS: native date inputs (mm/dd/yyyy with a calendar icon) ignore pasted text with slashes. Click the month segment and type the digits only, in order, with no separators (e.g. 12312025 for 12/31/2025), then read the value back. If it still reads empty, set it via JavaScript (input.value = "2025-12-31" — ISO format — then dispatch "input" and "change" events) and read back again. Never click submit while a required date reads empty.
- Sensitive fields (SSN, ITIN, passwords, MFA codes): NEVER invent — leave them blank and pause as described below.

HUMAN-ONLY STEPS (the human does these in the live browser — never you)
- Login, account-password creation, MFA / verification codes, CAPTCHA, certifications / attestations, signatures (including typing a printed name as a signature), payment, final review, and final submission.
- You NEVER type credentials, check a certification box, sign, pay, or click the final Submit. SmartPR never collects government passwords or MFA codes in chat: at a login or MFA step, pause and the human signs in via Take over.
- On a human-only step, pause with the matching marker and a PORTAL_STEP line. Do NOT emit REQUIRED_FIELDS for credentials. For certification / signature steps you MAY name still-empty items in missing= (e.g. missing=Signature (printed name)) so SmartPR can point the human to them.

PORTAL STEP REPORTING (mandatory on EVERY pause)
- Before pausing, identify the step the browser is showing RIGHT NOW from its heading, URL and controls. If the page declares a data-smartpr-step attribute (SmartPR rehearsal portal), use it.
- Emit one line: PORTAL_STEP: kind=<kind>; title=<the visible page heading>; missing=<labels of still-empty required items, comma-separated, or none>
- kind is one of: login | mfa | captcha | form | identity | upload | certification | signature | payment | review | submission | unknown
  - form = ordinary data blanks the passport cannot fill (e.g. a date); identity = SSN / ITIN / ID number entry.
  - If you cannot tell confidently what the page is asking for, use kind=unknown — never guess. SmartPR will ask the human to take over.
- SmartPR shows the human ONLY what matches this step: chat inputs for form / identity, a take-over prompt for everything else. A REQUIRED_FIELDS block that does not match the step is discarded.

HUMAN INPUT PATH (form / identity steps only)
- For form / identity steps the human answers in the SmartPR chat (the live browser is view-only meanwhile). REQUIRED_FIELDS must list exactly the blanks on the page you are on RIGHT NOW — on an SSN step only the SSN; on a form with one missing date only that date. Never list email / password / MFA.
- Wait for resume with FIELDS FILL values; then type those exact values into the matching controls and continue.
- FILL RELIABILITY: portal pages can re-render while you type and drop values. Before submitting a page, read all required values back in ONE step. For any that are empty or wrong: click the field, select all (Ctrl+A / Cmd+A), delete, and set the full value again, then re-check only those fields.
- Never click Submit / Log in / Continue / Guardar while a required field still reads back empty or wrong — the page will silently reject the submit and you will look stuck. Verify every required field's value first, then click once.
- After clicking submit, verify the page actually advanced (URL or heading changed). If you are still on the same form with no visible error message, re-read the field values before doing anything else — do not blindly re-click the button.
- Use hint= for format guidance; on failed fills prefer error=<exact on-screen validation message>.

HARD RULES (never violate)
${submitRule}
2. Domain allowlist: only ${config.domains.join(", ")} (and necessary redirects on those hosts). Do not visit other sites.
3. Do NOT invent SSN, ITIN, passwords, MFA codes, or other sensitive IDs (unless FIELDS FILL below supplies exact values for this turn only).
4. Never certify, sign, pay, or submit on the human's behalf.
5. When you hit any human step, or blanks the passport cannot fill: STOP immediately, do not loop, and end your message with exactly one marker, a PORTAL_STEP line, and — only for form / identity steps — a REQUIRED_FIELDS block.

PAUSE / STATUS MARKERS (exactly one)
   - PAUSE_USER_LOGIN — login / MFA / account password (PORTAL_STEP kind=login or mfa; no REQUIRED_FIELDS)
   - PAUSE_FOR_USER — any other human step: form, identity, certification, signature, review, unknown (PORTAL_STEP says which)
   - PAUSE_USER_UPLOAD — documents required (${config.uploadsEn})
   - PAUSE_CAPTCHA — captcha / portal challenge
   - PAUSE_PAYMENT — payment required
   - REVIEW_READY — pre-submit review; the human reviews and submits in the browser
   - SUBMITTED:<confirmation> — ONLY when you observe the portal's confirmation page after the HUMAN submitted (e.g. after a takeover); include the confirmation / receipt reference. You never click submit yourself.
   - FAILED:<reason> — unrecoverable failure

REQUIRED_FIELDS PROTOCOL (form / identity steps only)
REQUIRED_FIELDS:
- id=<slug>; label=<human label as shown>; type=<text|email|tel|number>; sensitive=<true|false>
- id=<slug>; label=<...>; type=<...>; sensitive=<...>; optional=true
- id=<slug>; label=<...>; type=<...>; sensitive=<...>; hint=<short format — no semicolons>
- id=<slug>; label=<...>; type=<...>; sensitive=<...>; hint=<format>; error=<exact on-screen validation — no semicolons>
- Stable id slugs: ssn, itin, fiscal_year_end, phone, legal_name, …  sensitive=true for SSN / ITIN / ID numbers (type=text). ALWAYS include hint= for format-sensitive fields. No ";" inside hint or error.

Example (login — the human signs in via Take over):
PAUSE_USER_LOGIN
PORTAL_STEP: kind=login; title=Log in; missing=none

Example (SSN step):
PAUSE_FOR_USER
PORTAL_STEP: kind=identity; title=Identity verification; missing=Social Security Number
REQUIRED_FIELDS:
- id=ssn; label=Social Security Number; type=text; sensitive=true; hint=9 digits as shown on the portal (dashes OK)

Example (certification — the human reviews and signs in the browser):
PAUSE_FOR_USER
PORTAL_STEP: kind=certification; title=Certification; missing=Certification checkbox, Signature (printed name)

Example (cannot identify the page):
PAUSE_FOR_USER
PORTAL_STEP: kind=unknown; title=<visible heading>; missing=none

BUSINESS PASSPORT JSON (prefill source)
\`\`\`json
${passportBlock}
\`\`\`

${procedureHeading}
${procedure}
${authorizeBlock}${resume}${fieldsBlock}

When finished or paused, end with a short status line containing exactly one marker: ${pauseMarkers}
On every pause, include the PORTAL_STEP line — and REQUIRED_FIELDS only for form / identity steps.`;
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
