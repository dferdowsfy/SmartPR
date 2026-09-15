import type { AgencyFilingType } from "./types";

const SURI_URL = "https://suri.hacienda.pr.gov";

function filingLabel(filingType: AgencyFilingType): string {
  if (filingType === "SURI_REGISTER_TAXPAYER") {
    return "Register as Individual Taxpayer / Crear acceso SURI (Register Taxpayer)";
  }
  return "Registro de Comerciante (Merchant Registration) — post-login path";
}

/**
 * Build the Browser Use Cloud task prompt for a SURI assisted filing.
 * Passport JSON is embedded for prefill; sensitive IDs must not be invented.
 */
export function buildSuriTaskPrompt(input: {
  filingType: AgencyFilingType;
  passport: Record<string, unknown> | null;
  resumeHint?: string;
}): string {
  const passportBlock = input.passport
    ? JSON.stringify(input.passport, null, 2)
    : "(no passport JSON available — fill only what the user provides on screen; do not invent data)";

  const resume = input.resumeHint
    ? `\n\nRESUME CONTEXT: The human just finished a pause (${input.resumeHint}). Continue from the current page toward pre-submit review. Do not restart from scratch unless the session was lost.`
    : "";

  return `You are SmartPR's agency filing assistant controlling a real browser for Puerto Rico Hacienda SURI.

GOAL
- Filing type: ${input.filingType} — ${filingLabel(input.filingType)}
- Open and stay on the allowlisted domain only: ${SURI_URL}
- Prefill non-sensitive fields from the Business Passport JSON below.
- Spanish UI is OK; follow on-screen Spanish labels.

HARD RULES (never violate)
1. NEVER click the final Submit / Enviar / Confirmar envío button that permanently files. Stop at pre-submit review and report REVIEW_READY.
2. Domain allowlist: only suri.hacienda.pr.gov (and its necessary redirects on that host). Do not visit other sites.
3. Do NOT invent SSN, ITIN, passwords, MFA codes, or other sensitive IDs. Leave those for the human.
4. When you hit an upload wall, login/MFA wall, captcha, or payment gate: STOP immediately, do not loop, and report clearly with one of these markers in your final message:
   - PAUSE_USER_UPLOAD — documents required (photo ID, utility bill, SSN card; max 5 MB each)
   - PAUSE_USER_LOGIN — SURI login / MFA required (credentials stay with the human)
   - PAUSE_CAPTCHA — captcha / portal challenge
   - PAUSE_PAYMENT — payment required
5. Prefer Verify Address when the portal requires it before Next.
6. WhatsApp intervention number for the human (mention if stuck): +1-301-221-5129

BUSINESS PASSPORT JSON (prefill source)
\`\`\`json
${passportBlock}
\`\`\`

PROCEDURE OUTLINE
1. Navigate to ${SURI_URL}
2. For SURI_REGISTER_TAXPAYER: Registration → Create SURI Logon / Register as Individual Taxpayer; prefill name, address, contact from passport; pause at uploads and login as needed.
3. For SURI_MERCHANT_REGISTRATION: use post-login merchant registration path; prefill merchant fields from passport; pause at uploads/captcha as needed.
4. Stop at review with REVIEW_READY — human submits on the portal.
${resume}

When finished or paused, end with a short status line containing exactly one marker: PAUSE_USER_UPLOAD | PAUSE_USER_LOGIN | PAUSE_CAPTCHA | PAUSE_PAYMENT | REVIEW_READY | FAILED:<reason>`;
}

export function buildResumeTaskPrompt(input: {
  filingType: AgencyFilingType;
  pauseReason: string | null;
}): string {
  return buildSuriTaskPrompt({
    filingType: input.filingType,
    passport: null,
    resumeHint: input.pauseReason || "user resumed after assisting",
  });
}
