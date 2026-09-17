// xAI realtime telephony helpers (pure, testable — no network).
//
// These build the exact payloads the SmartPR voice gateway sends to xAI's
// Speech-to-Speech API, and verify xAI's Standard Webhooks signatures on
// `realtime.call.incoming` events.
//
// Security invariants:
// - The raw 6-digit PIN is collected from DTMF events and sent ONLY to our
//   own /api/voice/phone/verify-pin route. It must never appear in a
//   session.update, conversation item, log line, or audit detail.
// - Webhook signatures are verified with a timing-safe compare before any
//   call state is created.

import { createHmac, timingSafeEqual } from "node:crypto";

import { PIN_LENGTH } from "./pin";

/** Behavioral system prompt for the SmartPR voice agent (docs/voice-mcp.md §8). */
export const AGENT_INSTRUCTIONS = `You are the conversational interface to SmartPR.

For account-specific information, use the SmartPR MCP tools.

SmartPR tool results are authoritative for account identity, permissions, subscription access, regulatory requirements, readiness, evidence, deadlines, and email actions.

Never infer account data that was not returned by SmartPR.

Never override a denied action.

If SmartPR returns AUTH_REQUIRED, tell the caller authentication is required.

If SmartPR returns FORBIDDEN, explain that the account does not have access to that resource.

If SmartPR returns PLAN_NOT_ENTITLED, explain the restriction and offer any returned alternative.

If several businesses are available and the caller has not identified one, ask which business they mean.

Never ask the caller for user IDs, workspace IDs, database IDs, or plan names.

Never ask the caller to dictate their PIN aloud.

Never invent regulatory requirements outside SmartPR's authoritative regulatory engine.

Action tools (create_draft_project, propose_project_fact_update, add_note) only PROPOSE. Read the confirmation summary back to the caller in plain language and ask for explicit confirmation. Only call confirm_pending_action with that pendingActionId when the caller gives an unambiguous yes; anything vague ("maybe", "I guess") is not confirmation. Never send a confirmation on the caller's behalf, never edit the proposal — confirm executes exactly what was proposed.

Secure links and emails always go to the verified account email. Never ask for or accept a recipient address, phone number, user ID, workspace ID, or plan name. Never collect passwords, PINs, or verification codes.`;

/** The exact 18 curated SmartPR MCP tools attachable to an xAI realtime session. */
export const MCP_ALLOWED_TOOLS = [
  "get_account_context",
  "list_my_businesses",
  "get_business_summary",
  "get_requirements",
  "get_missing_items",
  "get_readiness",
  "get_deadlines",
  "get_evidence_status",
  "email_my_summary",
  "create_draft_project",
  "propose_project_fact_update",
  "add_note",
  "confirm_pending_action",
  "cancel_pending_action",
  "send_secure_upload_link",
  "send_secure_action_link",
  "generate_deliverable",
  "email_deliverable",
] as const;

export const MCP_SERVER_LABEL = "smartpr";

// ---------------------------------------------------------------------------
// Realtime WebSocket URL
// ---------------------------------------------------------------------------

/** Base URL for xAI's Speech-to-Speech realtime API. */
export const XAI_REALTIME_WS_URL = "wss://api.x.ai/v1/realtime";

/**
 * Saved xAI agent loaded on the realtime session (xAI console → the agent's
 * "Code integration" snippet connects with `?agent_id=`). Loading the agent
 * applies its console configuration to the session; our session.update calls
 * still replace instructions and tools per the auth state machine below.
 */
export const DEFAULT_XAI_AGENT_ID = "agent_MDinRE52EURHvKZV";

/**
 * Build the WebSocket URL used to join an incoming phone call. When
 * `agentId` is set, the saved agent's config loads on the session (the xAI
 * console "Code integration" pattern: `?agent_id=`). Omit it to join with a
 * blank session configured purely by our session.update calls.
 */
export function buildRealtimeCallUrl(callId: string, agentId?: string | null): string {
  const params = new URLSearchParams({ call_id: callId });
  if (agentId) params.set("agent_id", agentId);
  return `${XAI_REALTIME_WS_URL}?${params.toString()}`;
}

export interface McpToolEntry {
  type: "mcp";
  server_url: string;
  server_label: string;
  server_description: string;
  allowed_tools: readonly string[];
  authorization: string;
}

export function buildMcpToolEntry(mcpServerUrl: string, sessionToken: string): McpToolEntry {
  return {
    type: "mcp",
    server_url: mcpServerUrl,
    server_label: MCP_SERVER_LABEL,
    server_description:
      "Authenticated SmartPR account tools: requirements, readiness, evidence, deadlines, draft projects, fact updates, notes, secure links, deliverables, and summary email.",
    allowed_tools: MCP_ALLOWED_TOOLS,
    // Raw Phase 1 voice session token (vs_…). The MCP server accepts it with
    // or without the "Bearer " prefix. Short-lived (30 min); refresh with a
    // new session.update when it expires.
    authorization: sessionToken,
  };
}

export interface SessionUpdatePayload {
  type: "session.update";
  session: {
    instructions: string;
    voice: string;
    turn_detection: { type: "server_vad" };
    tools?: McpToolEntry[];
  };
}

/**
 * Pre-authentication session: NO account tools attached (tools explicitly
 * cleared). The caller is in the free tier: they may ask general questions
 * with no PIN, and may enter the 6-digit PIN on the keypad at any time to
 * unlock premium account access. Account tools attach only after successful
 * PIN verification (second session.update).
 *
 * `tools: []` is sent explicitly (not omitted): when the session loads a
 * saved xAI agent via `?agent_id=`, the agent may bring console-configured
 * tools with it, and those must be cleared before the caller authenticates.
 */
export function buildPreAuthSessionUpdate(voice: string): SessionUpdatePayload {
  return {
    type: "session.update",
    session: {
      instructions: `${AGENT_INSTRUCTIONS}\n\nThe caller has not authenticated yet — they are in the free tier. Answer general questions about Puerto Rico business requirements, permits, licenses, and compliance from your own knowledge of Puerto Rico business regulation. Be precise about what you know, name the agency when you can, and say explicitly when an answer needs verification with the agency or a professional instead of guessing. If the caller enters their 6-digit PIN on the keypad and authentication succeeds, you will be told and given account tools. Never ask the caller to say the PIN aloud. Never offer account-specific information until authentication succeeds.`,
      voice,
      turn_detection: { type: "server_vad" },
      tools: [],
    },
  };
}

/**
 * Spoken greeting for an inbound call: free tier first, premium PIN as an
 * invitation. Sent as a system instruction right after the pre-auth session
 * update so the exact framing is spoken verbatim.
 */
export function buildCallGreeting(enrolled: boolean): string {
  const base =
    "You've reached SmartPR. Ask me general questions about Puerto Rico business requirements, permits, licenses, and compliance — no PIN needed.";
  const premium = enrolled
    ? " If you have a PIN for premium access to your account, enter the 6-digit PIN on the phone keypad now."
    : " For premium access to your own SmartPR account, set a PIN under Phone access in your SmartPR settings, then call back and enter it on the keypad.";
  return `${base}${premium} Never ask the caller to say the PIN aloud.`;
}

/** Authenticated session: attaches the 18 SmartPR MCP tools with the fresh session token. */
export function buildAuthedSessionUpdate(
  voice: string,
  mcpServerUrl: string,
  sessionToken: string,
): SessionUpdatePayload {
  return {
    type: "session.update",
    session: {
      instructions: AGENT_INSTRUCTIONS,
      voice,
      turn_detection: { type: "server_vad" },
      tools: [buildMcpToolEntry(mcpServerUrl, sessionToken)],
    },
  };
}

// ---------------------------------------------------------------------------
// Webhook signature verification (Standard Webhooks)
// ---------------------------------------------------------------------------

const SIGNATURE_TOLERANCE_SECONDS = 300;

export interface WebhookVerificationInput {
  rawBody: string;
  webhookId: string | null;
  timestamp: string | null;
  signatureHeader: string | null;
  secret: string | null | undefined;
  nowSeconds?: number;
}

export type WebhookVerificationResult = { ok: true } | { ok: false; reason: string };

/**
 * Verify an xAI `realtime.call.incoming` webhook using Standard Webhooks
 * semantics: HMAC-SHA256 over `${id}.${timestamp}.${rawBody}`, base64-encoded,
 * compared (timing-safe) against any `v1,<sig>` entry in webhook-signature.
 */
export function verifyWebhookSignature(input: WebhookVerificationInput): WebhookVerificationResult {
  const { rawBody, webhookId, timestamp, signatureHeader, secret } = input;
  if (!secret) return { ok: false, reason: "missing_secret" };
  if (!webhookId || !timestamp || !signatureHeader) return { ok: false, reason: "missing_headers" };

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return { ok: false, reason: "bad_timestamp" };
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > SIGNATURE_TOLERANCE_SECONDS) return { ok: false, reason: "stale_timestamp" };

  const signedPayload = `${webhookId}.${timestamp}.${rawBody}`;
  const expected = createHmac("sha256", secret).update(signedPayload, "utf8").digest("base64");

  const candidates = signatureHeader.split(" ").map((s) => s.trim()).filter(Boolean);
  for (const candidate of candidates) {
    const comma = candidate.indexOf(",");
    if (comma < 0) continue;
    const version = candidate.slice(0, comma);
    const sig = candidate.slice(comma + 1);
    if (version !== "v1" || !sig) continue;
    const a = Buffer.from(sig, "utf8");
    const b = Buffer.from(expected, "utf8");
    if (a.length === b.length && timingSafeEqual(a, b)) return { ok: true };
  }
  return { ok: false, reason: "bad_signature" };
}

// ---------------------------------------------------------------------------
// Incoming-call payload parsing
// ---------------------------------------------------------------------------

export interface IncomingCallInfo {
  callId: string;
  callerE164: string | null;
}

interface SipHeader {
  name?: string;
  value?: string;
}

/** Extract the call id and caller phone (SIP From header) from the webhook payload. */
export function parseIncomingCall(payload: unknown): IncomingCallInfo | null {
  if (!payload || typeof payload !== "object") return null;
  const data = (payload as { data?: unknown }).data;
  if (!data || typeof data !== "object") return null;
  const callId = (data as { call_id?: unknown }).call_id;
  if (typeof callId !== "string" || callId.length === 0) return null;

  let callerE164: string | null = null;
  const headers = (data as { sip_headers?: unknown }).sip_headers;
  if (Array.isArray(headers)) {
    for (const h of headers as SipHeader[]) {
      if (h && typeof h.name === "string" && h.name.toLowerCase() === "from" && typeof h.value === "string") {
        // Typical value: "+14155550100" or "sip:+14155550100@host".
        const m = /\+?[0-9][0-9.\-() ]*/.exec(h.value);
        if (m) {
          const digits = m[0].replace(/\D/g, "");
          if (digits.length >= 7) callerE164 = `+${digits}`;
        }
        break;
      }
    }
  }
  return { callId, callerE164 };
}

// ---------------------------------------------------------------------------
// DTMF PIN collection
// ---------------------------------------------------------------------------

/**
 * Buffers DTMF digits for the 6-digit voice PIN. The PIN is exactly
 * PIN_LENGTH digits — collection completes without requiring the caller to
 * press `#`, so the gateway can clear xAI's input buffer before the digits
 * are flushed to the model as text.
 *
 * Never log the buffered digits.
 */
export class DtmfPinCollector {
  private digits = "";

  /** Feed one DTMF event value. Returns the completed PIN, or null. */
  push(event: string): string | null {
    if (!/^[0-9]$/.test(event)) {
      // Non-digit keys (#, *) are ignored; a completed PIN submits on length.
      return null;
    }
    if (this.digits.length >= PIN_LENGTH) return null;
    this.digits += event;
    if (this.digits.length === PIN_LENGTH) {
      const pin = this.digits;
      this.digits = "";
      return pin;
    }
    return null;
  }

  reset(): void {
    this.digits = "";
  }

  get pending(): number {
    return this.digits.length;
  }
}

/** True when a realtime event looks like a DTMF keypress. */
export function parseDtmfEvent(event: unknown): string | null {
  if (!event || typeof event !== "object") return null;
  const e = event as { type?: unknown; event?: unknown };
  if (e.type !== "input_audio_buffer.dtmf_event_received") return null;
  return typeof e.event === "string" ? e.event : null;
}
