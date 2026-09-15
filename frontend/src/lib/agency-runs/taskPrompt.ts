import type { AgencyFilingConfig } from "./filingTypes";

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
}): string {
  const { config } = input;
  const passportBlock = input.passport
    ? JSON.stringify(input.passport, null, 2)
    : "(no passport JSON available — fill only what the user provides on screen; do not invent data)";

  const resume = input.resumeHint
    ? `\n\nRESUME CONTEXT: The human just finished a pause (${input.resumeHint}). Continue from the current page toward pre-submit review. Do not restart from scratch unless the session was lost.`
    : "";

  const procedure = config.procedureEn
    .map((step, i) => `${i + 1}. ${step}`)
    .join("\n");

  return `You are SmartPR's agency filing assistant controlling a real browser for ${config.agencyEn} (${config.portalEn}).

GOAL
- Filing: ${config.labelEn}
- ${config.goalEn}
- Open and stay on the allowlisted domains only: ${config.domains.join(", ")} (start: ${config.startUrl})
- Prefill non-sensitive fields from the Business Passport JSON below.
- Spanish UI is OK; follow on-screen Spanish labels.

HARD RULES (never violate)
1. NEVER click the final Submit / Enviar / Confirmar envío button that permanently files. Stop at pre-submit review and report REVIEW_READY.
2. Domain allowlist: only ${config.domains.join(", ")} (and necessary redirects on those hosts). Do not visit other sites.
3. Do NOT invent SSN, ITIN, passwords, MFA codes, or other sensitive IDs. Leave those for the human.
4. When you hit an upload wall, login/MFA wall, captcha, or payment gate: STOP immediately, do not loop, and report clearly with one of these markers in your final message:
   - PAUSE_USER_UPLOAD — documents required (${config.uploadsEn})
   - PAUSE_USER_LOGIN — portal login / MFA required (credentials stay with the human)
   - PAUSE_CAPTCHA — captcha / portal challenge
   - PAUSE_PAYMENT — payment required

BUSINESS PASSPORT JSON (prefill source)
\`\`\`json
${passportBlock}
\`\`\`

PROCEDURE OUTLINE (goal-oriented — adapt to what the portal actually shows)
${procedure}
${resume}

When finished or paused, end with a short status line containing exactly one marker: PAUSE_USER_UPLOAD | PAUSE_USER_LOGIN | PAUSE_CAPTCHA | PAUSE_PAYMENT | REVIEW_READY | FAILED:<reason>`;
}

export function buildResumeTaskPrompt(input: {
  config: AgencyFilingConfig;
  pauseReason: string | null;
}): string {
  return buildAgencyTaskPrompt({
    config: input.config,
    passport: null,
    resumeHint: input.pauseReason || "user resumed after assisting",
  });
}
