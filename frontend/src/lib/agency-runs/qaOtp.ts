/**
 * QA OTP assist — lets a supervised QA run get past a portal email-OTP step
 * without the human typing the code.
 *
 * Why this exists: Kavi (and any operator) cannot complete a portal OTP step
 * through Clara's Takeover pane — the pane is a streamed image of the remote
 * browser, so the protected credential_fill has no DOM target, and Gmail
 * verification codes are redacted server-side so they can never be typed
 * manually. The only component with real DOM access to the portal is the
 * browser agent itself. So the SmartPR *server* fetches the fresh OTP from
 * the QA mailbox (Gmail API) and hands it to the agent through the existing
 * ephemeral resume path (`resumeRun` with `{ fields: { mfa } }`) — the same
 * path a user-typed code takes. The code is never written to the run, the
 * transcript, logs, or events; only "QA assist sent a code" is recorded.
 *
 * HARD GATES (all must hold):
 *   1. The business is on the QA allowlist: QA_OTP_ASSIST_BUSINESSES
 *      (comma-separated business public ids, e.g. "wftfxnkt").
 *   2. Gmail API credentials are configured: QA_GOOGLE_CLIENT_ID,
 *      QA_GOOGLE_CLIENT_SECRET, QA_GMAIL_REFRESH_TOKEN.
 *   3. The run is paused at a PORTAL_STEP kind=mfa (never login — the
 *      password stays human-only — and never any other step).
 *   4. The filing's agency has an OTP spec below.
 *
 * This is a QA-testing feature. Real users always type their own codes.
 *
 * ONE-TIME SETUP (Darius):
 *   1. Google Cloud Console → APIs & Services → Credentials → Create
 *      Credentials → OAuth client ID → Application type "Desktop app".
 *      Enable the Gmail API for the project.
 *   2. Open the consent URL from buildQaOtpConsentUrl(clientId,
 *      "http://localhost") and approve gmail.readonly for the QA mailbox
 *      account. Google returns an authorization code.
 *   3. Exchange it once:
 *        curl -X POST https://oauth2.googleapis.com/token \
 *          -d client_id=... -d client_secret=... -d code=... \
 *          -d grant_type=authorization_code -d redirect_uri=http://localhost
 *      Keep the refresh_token from the response.
 *   4. Railway env: QA_GOOGLE_CLIENT_ID, QA_GOOGLE_CLIENT_SECRET,
 *      QA_GMAIL_REFRESH_TOKEN, QA_OTP_ASSIST_BUSINESSES=wftfxnkt
 */

export interface QaOtpSpec {
  agencyId: string;
  /** Gmail search sender, e.g. "DoNotReply@ddec.pr.gov". */
  from: string;
  /** Optional Gmail search subject fragment. */
  subjectIncludes?: string;
  /** How far back the Gmail search looks (minutes). */
  newerThanMinutes: number;
  /** Regex (with one capture group) that finds the code in the email body. */
  codePattern: RegExp;
  /** Reject codes from emails older than this (minutes) — a stale code is
   *  worse than no code because the portal will burn an attempt on it. */
  maxCodeAgeMinutes: number;
  /** How many times to re-poll Gmail before giving up (the portal email can
   *  lag the code screen by a minute or more). */
  pollAttempts: number;
  pollIntervalMs: number;
}

/** OTP email specs per agency. Add a new agency here when its login flow is
 *  observed to use an emailed code during a supervised walk. */
export const QA_OTP_SPECS: Record<string, QaOtpSpec> = {
  OGPE: {
    agencyId: "OGPE",
    from: "DoNotReply@ddec.pr.gov",
    subjectIncludes: "DDEC - SBP - Email Confirmation",
    newerThanMinutes: 10,
    codePattern: /\b(\d{6})\b/,
    maxCodeAgeMinutes: 4,
    pollAttempts: 6,
    pollIntervalMs: 15000,
  },
};

export function getQaOtpSpec(agencyId: string | undefined | null): QaOtpSpec | null {
  if (!agencyId) return null;
  return QA_OTP_SPECS[agencyId] ?? null;
}

/** QA allowlist — business public ids permitted to use OTP assist. */
function qaBusinessAllowlist(): string[] {
  return (process.env.QA_OTP_ASSIST_BUSINESSES || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** True when the Gmail API credentials for the QA mailbox are present. */
export function qaOtpAssistConfigured(): boolean {
  return Boolean(
    process.env.QA_GOOGLE_CLIENT_ID?.trim() &&
      process.env.QA_GOOGLE_CLIENT_SECRET?.trim() &&
      process.env.QA_GMAIL_REFRESH_TOKEN?.trim()
  );
}

/** True when this business may use QA OTP assist (allowlist + configured). */
export function qaOtpAssistAllowed(businessId: string | undefined | null): boolean {
  if (!businessId) return false;
  return qaOtpAssistConfigured() && qaBusinessAllowlist().includes(businessId.trim());
}

/** Pure guard for the auto-trigger: every condition except the Gmail fetch. */
export function shouldAutoAssist(input: {
  worker: string | undefined;
  status: string | undefined;
  stepKind: string | undefined | null;
  businessId: string | undefined | null;
  agencyId: string | undefined | null;
  assistInFlight: boolean;
}): boolean {
  return (
    input.worker === "browser_use" &&
    input.status === "paused" &&
    input.stepKind === "mfa" &&
    !input.assistInFlight &&
    qaOtpAssistAllowed(input.businessId) &&
    getQaOtpSpec(input.agencyId) !== null
  );
}

/** Gmail search query for the OTP email. */
export function buildGmailQuery(spec: QaOtpSpec): string {
  const parts = [`from:${spec.from}`, `newer_than:${spec.newerThanMinutes}m`];
  if (spec.subjectIncludes) parts.push(`subject:"${spec.subjectIncludes}"`);
  return parts.join(" ");
}

/** Base64url (Gmail) → UTF-8 text. */
export function decodeGmailBody(data: string): string {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf-8");
}

/**
 * Find the OTP in the email text. When several 6-digit runs appear (e.g. a
 * project number next to the code), prefer the first one after an explicit
 * cue word ("código", "verification code", "OTP") — the code follows its
 * label in these emails. Falls back to the first run when there is no cue.
 */
export function extractOtpCode(text: string, pattern: RegExp): string | null {
  const flags = pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g";
  const global = new RegExp(pattern.source, flags);
  const codes = [...text.matchAll(global)]
    .map((m) => ({ code: (m[1] ?? "").trim(), index: m.index ?? 0 }))
    .filter((c) => c.code);
  if (codes.length === 0) return null;
  const cueIdx = text.search(/c[oó]digo|verification code|\botp\b/i);
  if (cueIdx >= 0) {
    const afterCue = codes.find((c) => c.index >= cueIdx);
    if (afterCue) return afterCue.code;
  }
  return codes[0].code;
}

/** True when the email is fresh enough that its code is still usable. */
export function messageIsFresh(
  internalDateMs: number,
  nowMs: number,
  maxAgeMinutes: number
): boolean {
  if (!Number.isFinite(internalDateMs) || internalDateMs <= 0) return false;
  return nowMs - internalDateMs <= maxAgeMinutes * 60 * 1000;
}

/** Strip the code from any text before it is logged or surfaced. */
export function redactCode(text: string, code: string): string {
  if (!code) return text;
  return text.split(code).join("[redacted]");
}

export function buildQaOtpConsentUrl(clientId: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/gmail.readonly",
    access_type: "offline",
    prompt: "consent",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

interface GmailMessageMeta {
  id: string;
  internalDate?: string;
}

interface GmailPayload {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPayload[];
}

function findTextBody(payload: GmailPayload | undefined): string | null {
  if (!payload) return null;
  if (payload.mimeType === "text/plain" && payload.body?.data) return payload.body.data;
  for (const part of payload.parts || []) {
    const found = findTextBody(part);
    if (found) return found;
  }
  // Fallback: some messages carry the body at the top level.
  return payload.body?.data ?? null;
}

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

async function getAccessToken(fetchFn: FetchFn): Promise<string> {
  const clientId = process.env.QA_GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.QA_GOOGLE_CLIENT_SECRET?.trim();
  const refreshToken = process.env.QA_GMAIL_REFRESH_TOKEN?.trim();
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("QA OTP assist is not configured (missing Gmail API credentials)");
  }
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });
  const res = await fetchFn("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`token refresh failed: HTTP ${res.status}`);
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("token refresh returned no access token");
  return json.access_token;
}

async function listOtpMessages(
  fetchFn: FetchFn,
  accessToken: string,
  spec: QaOtpSpec
): Promise<GmailMessageMeta[]> {
  const params = new URLSearchParams({
    q: buildGmailQuery(spec),
    maxResults: "5",
  });
  const res = await fetchFn(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params.toString()}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) throw new Error(`message list failed: HTTP ${res.status}`);
  const json = (await res.json()) as { messages?: GmailMessageMeta[] };
  return json.messages ?? [];
}

async function readMessageCode(
  fetchFn: FetchFn,
  accessToken: string,
  id: string,
  spec: QaOtpSpec,
  nowMs: number
): Promise<string | null> {
  const res = await fetchFn(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) return null;
  const json = (await res.json()) as {
    internalDate?: string;
    payload?: GmailPayload;
    snippet?: string;
  };
  const internalDateMs = Number(json.internalDate);
  if (!messageIsFresh(internalDateMs, nowMs, spec.maxCodeAgeMinutes)) return null;
  const rawBody = findTextBody(json.payload);
  const text = rawBody ? decodeGmailBody(rawBody) : String(json.snippet || "");
  return extractOtpCode(text, spec.codePattern);
}

/**
 * Fetch the freshest usable OTP for the spec, polling Gmail because the
 * portal's email can lag the code screen. Returns the code, or null when no
 * fresh code appears. Never logs or throws the code itself.
 */
export async function fetchQaOtpCode(
  spec: QaOtpSpec,
  deps?: { fetchFn?: FetchFn; nowMs?: () => number; sleepMs?: (ms: number) => Promise<void> }
): Promise<string | null> {
  const fetchFn = deps?.fetchFn ?? fetch;
  const nowMs = deps?.nowMs ?? Date.now;
  const sleep = deps?.sleepMs ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  let accessToken: string;
  try {
    accessToken = await getAccessToken(fetchFn);
  } catch (err) {
    throw new Error(`QA OTP assist: mailbox unreachable (${err instanceof Error ? err.message : "unknown error"})`);
  }
  for (let attempt = 0; attempt < spec.pollAttempts; attempt++) {
    if (attempt > 0) await sleep(spec.pollIntervalMs);
    let metas: GmailMessageMeta[];
    try {
      metas = await listOtpMessages(fetchFn, accessToken, spec);
    } catch {
      continue; // transient — retry on the next poll
    }
    for (const meta of metas) {
      const code = await readMessageCode(fetchFn, accessToken, meta.id, spec, nowMs());
      if (code) return code;
    }
  }
  return null;
}
