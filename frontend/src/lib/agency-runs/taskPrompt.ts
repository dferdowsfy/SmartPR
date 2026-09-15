import type { AgencyFilingConfig } from "./filingTypes";

/** Ephemeral login fields for USER_LOGIN resume — never persisted on the run. */
export type ResumeCredentials = {
  email?: string;
  password?: string;
  mfa?: string;
};

/** Unified ephemeral field map keyed by stable id (email, password, ssn, …). */
export type ResumeFields = Record<string, string>;

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
}): string {
  const { config } = input;
  const passportBlock = input.passport
    ? JSON.stringify(input.passport, null, 2)
    : "(no passport JSON available — fill only what the user provides on screen; do not invent data)";

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
      "- If an Ingresar / Login / Sign in / Continuar / Next / Guardar button is present after filling, click it to proceed past the gate.",
      "- If the fields were accepted (you leave the page or the blanks are no longer empty), do NOT re-pause for the same fields.",
      "- Still NEVER click the final Submit / Enviar that permanently files.",
      "- Do not invent secrets; only use the values listed above. If a listed id has no matching control on screen, skip it and note that — do not invent a different field."
    );
    fieldsBlock = "\n" + lines.join("\n");
  }

  const resume = input.resumeHint
    ? hasFields
      ? `\n\nRESUME CONTEXT: The human provided required fields from the Assistant panel so you can fill them on the current page. ${fieldsBlock ? "Follow FIELDS FILL below, then" : ""} briefly VERIFY the page state and CONTINUE toward pre-submit review — do NOT re-pause for the same fields if they are now filled. Only pause again if other gates remain or listed fields are still empty, and emit REQUIRED_FIELDS for whatever is still missing. The Business Passport JSON below is still your prefill source — keep filling every identified field from it.`
      : `\n\nRESUME CONTEXT: The human just handled the pause (${input.resumeHint}) directly in the live browser — assume they completed the login / typed the sensitive fields / uploaded the documents. Briefly VERIFY the current page state: if the previously blocking step is done (fields filled, gate cleared), CONTINUE forward toward pre-submit review — do NOT re-pause for the same reason. Only pause again if specific fields are still visibly empty or the gate is still literally blocking, and name exactly which fields are still missing via REQUIRED_FIELDS. The Business Passport JSON below is still your prefill source — keep filling every identified field from it.`
    : "";

  const procedure = config.procedureEn
    .map((step, i) => `${i + 1}. ${step}`)
    .join("\n");

  return `You are SmartPR's agency filing assistant controlling a real browser for ${config.agencyEn} (${config.portalEn}).

GOAL
- Filing: ${config.labelEn}
- ${config.goalEn}
- Open and stay on the allowlisted domains only: ${config.domains.join(", ")} (start: ${config.startUrl})
- Spanish UI is OK; follow on-screen Spanish labels.

PREFILL — DO THIS AGGRESSIVELY
- SEQUENCING: on every page, FIRST fill all non-sensitive fields from the passport, THEN pause for the sensitive ones. Never pause on a page that still has unfilled fields the passport could satisfy — the human should only ever need to fill the sensitive blanks.
- Fill EVERY form field whose meaning you can identify from the Business Passport JSON below: legal/business names, entity type, addresses, phone, email, dates, organizer/member details, non-sensitive IDs, and anything else with a clear match.
- For dropdowns/selects: pick the option whose visible text best matches the passport value. Never leave a dropdown on a placeholder/default when the passport identifies the value.
- For checkboxes/radios that clearly correspond to passport facts, set them.
- If a field has no passport match and is not sensitive, use visible page context; if truly unknown, leave it blank and note it — do not invent.
- Sensitive fields (SSN, ITIN, passwords, MFA codes): NEVER invent — leave them blank for the human and pause with the right marker below.

HARD RULES (never violate)
1. NEVER click the final Submit / Enviar / Confirmar envío button that permanently files. Stop at pre-submit review and report REVIEW_READY.
2. Domain allowlist: only ${config.domains.join(", ")} (and necessary redirects on those hosts). Do not visit other sites.
3. Do NOT invent SSN, ITIN, passwords, MFA codes, or other sensitive IDs. Leave those for the human (unless FIELDS FILL below supplies exact values for this turn only).
4. When you hit an upload wall, login/MFA wall, captcha, payment gate, or any page with required blanks the passport cannot fill: STOP immediately, do not loop, and end your message with BOTH:
   (a) exactly one pause/status marker, and
   (b) a machine-parseable REQUIRED_FIELDS block listing every field the human must provide on the CURRENT page.

PAUSE / STATUS MARKERS (exactly one)
   - PAUSE_USER_UPLOAD — documents required (${config.uploadsEn})
   - PAUSE_USER_LOGIN — portal login / MFA / account credentials required
   - PAUSE_CAPTCHA — captcha / portal challenge
   - PAUSE_PAYMENT — payment required
   - REVIEW_READY — pre-submit review; human submits
   - FAILED:<reason> — unrecoverable failure

REQUIRED_FIELDS PROTOCOL (mandatory on every PAUSE_*)
After the marker line, emit:

REQUIRED_FIELDS:
- id=<slug>; label=<human label>; type=<text|email|password|tel|number>; sensitive=<true|false>
- id=<slug>; label=<human label>; type=<...>; sensitive=<...>; optional=true

Rules for the block:
- List ONLY fields that are currently empty/required on screen AND that the passport cannot fill (or that are sensitive — passwords, MFA, SSN, ITIN, etc.).
- Use stable id slugs: email, password, mfa, ssn, itin, phone, legal_name, …
- type must be one of: text | email | password | tel | number
- sensitive=true for passwords, MFA, SSN/ITIN — the UI will use password-style inputs where appropriate.
- For PAUSE_USER_UPLOAD the fields block may be empty (upload UI already exists).
- For PAUSE_CAPTCHA / PAUSE_PAYMENT usually no text fields — takeover stays primary; you may emit an empty REQUIRED_FIELDS: block or omit field lines.
- After the human provides values via resume / FIELDS FILL, fill exactly those fields, do not invent, and do not re-pause for the same fields if they are now filled.

Example (login):
PAUSE_USER_LOGIN
REQUIRED_FIELDS:
- id=email; label=Email; type=email; sensitive=false
- id=password; label=Password; type=password; sensitive=true
- id=mfa; label=MFA code; type=text; sensitive=true; optional=true

Example (sensitive profile blank):
PAUSE_USER_LOGIN
REQUIRED_FIELDS:
- id=ssn; label=SSN; type=password; sensitive=true

BUSINESS PASSPORT JSON (prefill source)
\`\`\`json
${passportBlock}
\`\`\`

PROCEDURE OUTLINE (goal-oriented — adapt to what the portal actually shows)
${procedure}
${resume}${fieldsBlock}

When finished or paused, end with a short status line containing exactly one marker: PAUSE_USER_UPLOAD | PAUSE_USER_LOGIN | PAUSE_CAPTCHA | PAUSE_PAYMENT | REVIEW_READY | FAILED:<reason>
On every PAUSE_*, also include the REQUIRED_FIELDS block as specified above.`;
}

export function buildResumeTaskPrompt(input: {
  config: AgencyFilingConfig;
  pauseReason: string | null;
  passport: Record<string, unknown> | null;
  credentials?: ResumeCredentials | null;
  fields?: ResumeFields | null;
}): string {
  return buildAgencyTaskPrompt({
    config: input.config,
    passport: input.passport,
    resumeHint: input.pauseReason || "user resumed after assisting",
    credentials: input.credentials ?? null,
    fields: input.fields ?? null,
  });
}
