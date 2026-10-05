// Signed, expiring, stateless handoff tokens: ChatGPT → SmartPR portal.
//
// The token carries ONLY the normalized scenario (business facts the user
// typed into ChatGPT — no account, email, or ChatGPT identifiers), an
// expiry, and an intent. It grants no access to anything: the portal uses it
// solely to prefill a review-before-save screen. Nothing is created until the
// user explicitly confirms inside SmartPR.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { NormalizedScenario } from "./assessment";

export const HANDOFF_TTL_SECONDS = 6 * 60 * 60; // survives a sign-in / email-verify round trip
export type HandoffIntent = "continue" | "unlock" | "use_plan";

export interface HandoffPayload {
  v: 1;
  jti: string;
  iat: number;
  exp: number;
  intent: HandoffIntent;
  scenario: NormalizedScenario;
}

export class HandoffError extends Error {
  constructor(public code: "not_configured" | "malformed" | "bad_signature" | "expired", msg?: string) {
    super(msg || code);
  }
}

function secret(): string {
  const s = process.env.CHATGPT_HANDOFF_SECRET || "";
  if (s.length < 32) throw new HandoffError("not_configured", "CHATGPT_HANDOFF_SECRET must be set (>= 32 chars).");
  return s;
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const sign = (body: string) => createHmac("sha256", secret()).update(`smartpr-chatgpt-handoff.v1.${body}`).digest();

export function createHandoffToken(scenario: NormalizedScenario, intent: HandoffIntent, nowMs = Date.now()): { token: string; expires_at: string } {
  const iat = Math.floor(nowMs / 1000);
  const payload: HandoffPayload = { v: 1, jti: randomBytes(9).toString("base64url"), iat, exp: iat + HANDOFF_TTL_SECONDS, intent, scenario };
  const body = b64(JSON.stringify(payload));
  if (body.length > 6000) throw new HandoffError("malformed", "Scenario too large.");
  return { token: `${body}.${b64(sign(body))}`, expires_at: new Date(payload.exp * 1000).toISOString() };
}

export function verifyHandoffToken(token: string | null | undefined, nowMs = Date.now()): HandoffPayload {
  if (!token || typeof token !== "string" || token.length > 8000) throw new HandoffError("malformed");
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) throw new HandoffError("malformed");
  const expected = sign(body);
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new HandoffError("bad_signature");
  let payload: HandoffPayload;
  try { payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch { throw new HandoffError("malformed"); }
  if (payload?.v !== 1 || typeof payload.exp !== "number" || !payload.scenario) throw new HandoffError("malformed");
  if (Math.floor(nowMs / 1000) >= payload.exp) throw new HandoffError("expired");
  return payload;
}
