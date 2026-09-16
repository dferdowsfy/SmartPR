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
      "- After FIELDS FILL, continue filling any remaining non-sensitive blanks from the Business Passport JSON — do not stop at only the listed ids.",
      "- If an Ingresar / Login / Sign in / Continuar / Next / Guardar button is present after filling, click it to proceed past the gate.",
      "- If the fields were accepted (you leave the page or the blanks are no longer empty), do NOT re-pause for the same fields.",
      "- Still NEVER click the final Submit / Enviar that permanently files.",
      "- Do not invent secrets; only use the values listed above. If a listed id has no matching control on screen, skip it and note that — do not invent a different field."
    );
    fieldsBlock = "\n" + lines.join("\n");
  }

  const resume = input.resumeHint
    ? hasFields
      ? `\n\nRESUME CONTEXT: The human provided required fields from the Assistant panel so you can fill them on the current page. ${fieldsBlock ? "Follow FIELDS FILL below, then" : ""} briefly VERIFY the page state and CONTINUE toward pre-submit review — do NOT re-pause for the same fields if they are now filled. Only pause again if other gates remain or listed fields are still empty / rejected, and emit REQUIRED_FIELDS for whatever is still missing — prefer error=<exact on-screen validation message> and keep hint= for format if useful. The Business Passport JSON below is still your prefill source — keep filling every identified field from it.`
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
- SEQUENCING (mandatory): on every page, FIRST fill ALL non-sensitive fields you can from the Business Passport JSON below. ONLY THEN pause for blanks the passport cannot satisfy (usually password / MFA / SSN / uploads).
- Do NOT PAUSE and do NOT emit REQUIRED_FIELDS for any control the passport can already fill (email, phone, legal/business names, addresses, municipality, EIN/registry when present and non-sensitive, etc.).
- Fill EVERY form field whose meaning you can identify from the passport: legal/business names, entity type, addresses, phone, email, dates, organizer/member details, non-sensitive IDs, and anything else with a clear match.
- For dropdowns/selects: pick the option whose visible text best matches the passport value. Never leave a dropdown on a placeholder/default when the passport identifies the value.
- For checkboxes/radios that clearly correspond to passport facts, set them.
- If a field has no passport match and is not sensitive, use visible page context; if truly unknown, leave it blank and note it — do not invent.
- Sensitive fields (SSN, ITIN, passwords, MFA codes): NEVER invent — leave them blank for the human and pause with the right marker below.

HUMAN INPUT PATH (login / required text fields)
- When you PAUSE_USER_LOGIN or pause for required text fields, the human types ONLY in the SmartPR Assistant panel on the left — NOT in the live browser iframe (it is view-only until Fill & continue).
- Do NOT expect the human to type into the live browser for email/password/MFA or other required text fields.
- Wait for resume with FIELDS FILL values; then type those exact values into the matching controls and continue.
- Keep emitting accurate REQUIRED_FIELDS for whatever is still empty after passport prefill (ids/labels/types/sensitivity/hints/errors only — never echo secrets). Use hint= for format guidance; on failed fills prefer error=<exact on-screen validation message>.

HARD RULES (never violate)
1. NEVER click the final Submit / Enviar / Confirmar envío button that permanently files. Stop at pre-submit review and report REVIEW_READY.
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
   - REVIEW_READY — pre-submit review; human submits
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
