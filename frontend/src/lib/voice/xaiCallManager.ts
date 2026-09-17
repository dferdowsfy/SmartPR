// SmartPR xAI telephony gateway — inbound call lifecycle.
//
// Inbound call flow (docs/voice-mcp.md §7):
//  1. xAI sends `realtime.call.incoming` to /api/voice/xai-webhook.
//  2. This manager opens wss://api.x.ai/v1/realtime?call_id=… with XAI_API_KEY.
//  3. Pre-auth session.update WITHOUT tools: Grok asks for the 6-digit PIN on
//     the keypad. DTMF digits are collected here, server-side.
//  4. On 6 digits: clear xAI's input buffer (best-effort, keeps the PIN out
//     of model context), then POST /api/voice/phone/verify-pin.
//  5. On success: second session.update WITH the 18 MCP tools, authorization
//     = the fresh voice session token. Grok proceeds with account tools.
//  6. On call end: revoke the voice session.
//
// Security invariants:
// - The raw PIN and session token are never logged, never sent to xAI, and
//   never placed in conversation history (DTMF flush scrubbed via
//   input_audio_buffer.clear + conversation.item.delete defense in depth).
// - The xAI API key lives only in process.env (Railway). This module never
//   prints it.

import WebSocket from "ws";

import {
  AGENT_INSTRUCTIONS,
  buildAuthedSessionUpdate,
  buildPreAuthSessionUpdate,
  DtmfPinCollector,
  parseDtmfEvent,
} from "./xaiRealtime";

const XAI_REALTIME_URL = "wss://api.x.ai/v1/realtime";
const XAI_CALLS_URL = "https://api.x.ai/v1/realtime/calls";
const AUTH_TIMEOUT_MS = 180_000;
const GOODBYE_TIMEOUT_MS = 15_000;

interface ActiveCall {
  callId: string;
  ws: WebSocket;
  authed: boolean;
  sessionToken: string | null;
  ended: boolean;
  pinCollector: DtmfPinCollector;
  authTimer: NodeJS.Timeout | null;
}

const activeCalls = new Map<string, ActiveCall>();

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : undefined;
}

function selfBaseUrl(): string {
  const port = env("PORT") || "3000";
  return `http://127.0.0.1:${port}`;
}

function log(callId: string, msg: string): void {
  console.log(`[xai-voice] call=${callId.slice(0, 8)}… ${msg}`);
}

/** Server-to-server POST to our own voice gateway routes. */
async function gatewayPost(path: string, body: Record<string, unknown>): Promise<{ status: number; json: unknown }> {
  const gatewayKey = env("VOICE_GATEWAY_API_KEY");
  if (!gatewayKey) throw new Error("VOICE_GATEWAY_API_KEY not configured");
  const res = await fetch(`${selfBaseUrl()}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${gatewayKey}`,
    },
    body: JSON.stringify(body),
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

function send(ws: WebSocket, payload: unknown): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}

function systemMessage(text: string): unknown {
  return {
    type: "conversation.item.create",
    item: {
      type: "message",
      role: "system",
      content: [{ type: "input_text", text }],
    },
  };
}

async function hangupCall(callId: string): Promise<void> {
  const key = env("XAI_API_KEY");
  if (!key) return;
  try {
    await fetch(`${XAI_CALLS_URL}/${encodeURIComponent(callId)}/hangup`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}` },
    });
  } catch (err) {
    console.error(`[xai-voice] hangup failed for call=${callId.slice(0, 8)}…`, err);
  }
}

function endCall(call: ActiveCall, reason: string): void {
  if (call.ended) return;
  call.ended = true;
  if (call.authTimer) clearTimeout(call.authTimer);
  activeCalls.delete(call.callId);
  log(call.callId, `ended (${reason})`);
  const token = call.sessionToken;
  call.sessionToken = null;
  try {
    call.ws.close();
  } catch {
    /* already closed */
  }
  // Revoke the voice session server-side so the token dies with the call.
  if (token) {
    gatewayPost("/api/voice/session/revoke", { session_token: token, reason: "call_ended" }).catch((err) =>
      console.error("[xai-voice] session revoke failed", err),
    );
  }
  void hangupCall(call.callId);
}

/** Wait for a single realtime event type, with timeout. */
function waitForEvent(
  ws: WebSocket,
  type: string,
  timeoutMs: number,
): Promise<unknown> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      ws.removeListener("message", onMessage);
      resolve(null);
    }, timeoutMs);
    const onMessage = (data: WebSocket.RawData) => {
      try {
        const evt = JSON.parse(String(data)) as { type?: string };
        if (evt.type === type) {
          clearTimeout(timer);
          ws.removeListener("message", onMessage);
          resolve(evt);
        }
      } catch {
        /* ignore malformed */
      }
    };
    ws.on("message", onMessage);
  });
}

/** Speak a system instruction, wait for the response to finish, then end. */
async function sayGoodbyeAndEnd(call: ActiveCall, text: string): Promise<void> {
  send(call.ws, systemMessage(text));
  send(call.ws, { type: "response.create" });
  await waitForEvent(call.ws, "response.done", GOODBYE_TIMEOUT_MS);
  endCall(call, "goodbye");
}

async function handlePinComplete(call: ActiveCall, pin: string, callerE164: string): Promise<void> {
  // Keep the PIN out of the model's context: clear xAI's DTMF buffer before
  // it flushes the digits as a text message (best-effort; xAI mirrors the
  // OpenAI realtime API surface).
  send(call.ws, { type: "input_audio_buffer.clear" });

  let result: { status: number; json: unknown };
  try {
    result = await gatewayPost("/api/voice/phone/verify-pin", { phone: callerE164, pin });
  } catch (err) {
    console.error("[xai-voice] verify-pin request failed", err);
    send(call.ws, systemMessage("The authentication service is unavailable. Please try again later."));
    send(call.ws, { type: "response.create" });
    return;
  }

  const body = (result.json ?? {}) as { error?: string; attempts_remaining?: number | null; session_token?: string };

  if (result.status === 200 && body.session_token) {
    call.authed = true;
    call.sessionToken = body.session_token;
    if (call.authTimer) clearTimeout(call.authTimer);
    const voice = env("XAI_VOICE") || "eve";
    const mcpUrl = env("VOICE_MCP_SERVER_URL") || "https://www.getsmartpr.com/api/mcp/voice";
    send(call.ws, buildAuthedSessionUpdate(voice, mcpUrl, body.session_token));
    send(
      call.ws,
      systemMessage(
        "The caller has successfully authenticated with their SmartPR voice PIN. " +
          "You now have access to their SmartPR account tools. Greet them and ask how you can help.",
      ),
    );
    send(call.ws, { type: "response.create" });
    log(call.callId, "authenticated, tools attached");
    return;
  }

  call.pinCollector.reset();
  if (body.error === "locked") {
    await sayGoodbyeAndEnd(
      call,
      "Too many incorrect PIN attempts. This number is locked for 15 minutes. Goodbye.",
    );
    return;
  }
  const remaining =
    typeof body.attempts_remaining === "number" ? ` You have ${body.attempts_remaining} attempts remaining.` : "";
  send(call.ws, systemMessage(`The PIN was incorrect.${remaining} Ask the caller to try entering their 6-digit PIN on the keypad again.`));
  send(call.ws, { type: "response.create" });
  log(call.callId, `pin rejected (${body.error ?? "unknown"})`);
}

/**
 * Entry point from the xAI webhook route. Fire-and-forget: the webhook
 * handler must return 200 immediately, so this runs detached.
 */
export function handleIncomingCall(callId: string, callerE164: string | null): void {
  if (activeCalls.has(callId)) return;
  void runCall(callId, callerE164).catch((err) => {
    console.error(`[xai-voice] call=${callId.slice(0, 8)}… failed`, err);
    const call = activeCalls.get(callId);
    if (call) endCall(call, "error");
  });
}

async function runCall(callId: string, callerE164: string | null): Promise<void> {
  const xaiKey = env("XAI_API_KEY");
  if (!xaiKey) {
    console.error("[xai-voice] XAI_API_KEY not configured; cannot answer call");
    return;
  }

  // Identify the caller before opening the realtime session.
  let enrolled = false;
  if (callerE164) {
    try {
      const lookup = await gatewayPost("/api/voice/phone/lookup", { phone: callerE164 });
      const body = (lookup.json ?? {}) as { enrolled?: boolean; enabled?: boolean };
      enrolled = lookup.status === 200 && body.enrolled === true && body.enabled !== false;
    } catch (err) {
      console.error("[xai-voice] phone lookup failed", err);
    }
  }
  log(callId, `incoming caller_enrolled=${enrolled}`);

  const ws = new WebSocket(`${XAI_REALTIME_URL}?call_id=${encodeURIComponent(callId)}`, {
    headers: { authorization: `Bearer ${xaiKey}` },
  });

  const call: ActiveCall = {
    callId,
    ws,
    authed: false,
    sessionToken: null,
    ended: false,
    pinCollector: new DtmfPinCollector(),
    authTimer: null,
  };
  activeCalls.set(callId, call);

  ws.on("error", (err) => {
    console.error(`[xai-voice] ws error call=${callId.slice(0, 8)}…`, err);
  });

  ws.on("close", () => {
    endCall(call, "ws_closed");
  });

  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", (err) => reject(err));
  });

  const voice = env("XAI_VOICE") || "eve";

  if (!enrolled) {
    send(ws, {
      type: "session.update",
      session: {
        instructions: `${AGENT_INSTRUCTIONS}\n\nThe caller is not enrolled in SmartPR voice access. Politely explain that this number is not enrolled for SmartPR voice service and that they can enroll from their SmartPR account settings, then say goodbye. Do not offer account information.`,
        voice,
        turn_detection: { type: "server_vad" },
      },
    });
    send(ws, { type: "response.create" });
    await waitForEvent(ws, "response.done", GOODBYE_TIMEOUT_MS);
    endCall(call, "not_enrolled");
    return;
  }

  // Pre-auth session: no tools. Grok prompts for the keypad PIN.
  send(ws, buildPreAuthSessionUpdate(voice));
  send(ws, { type: "response.create" });

  call.authTimer = setTimeout(() => {
    if (!call.authed && !call.ended) {
      void sayGoodbyeAndEnd(call, "We did not receive your PIN in time. Please call back when you are ready. Goodbye.");
    }
  }, AUTH_TIMEOUT_MS);

  ws.on("message", (data: WebSocket.RawData) => {
    if (call.ended) return;
    let evt: { type?: string };
    try {
      evt = JSON.parse(String(data)) as { type?: string };
    } catch {
      return;
    }

    // DTMF PIN collection (pre-auth only).
    if (!call.authed && evt.type === "input_audio_buffer.dtmf_event_received") {
      const digit = parseDtmfEvent(evt);
      if (digit !== null && callerE164) {
        const pin = call.pinCollector.push(digit);
        if (pin) void handlePinComplete(call, pin, callerE164);
      }
      return;
    }

    // Defense in depth: if xAI flushes buffered DTMF to the model as text
    // despite our input_audio_buffer.clear, delete the item so the PIN never
    // persists in conversation history.
    if (!call.authed && evt.type === "conversation.item.created") {
      const item = (evt as { item?: { id?: string; content?: Array<{ text?: string; transcript?: string }> } }).item;
      const text = (item?.content ?? [])
        .map((c) => c.text ?? c.transcript ?? "")
        .join(" ")
        .replace(/\D/g, "");
      if (text.length >= 6 && item?.id) {
        send(ws, { type: "conversation.item.delete", item_id: item.id });
        log(call.callId, "scrubbed dtmf flush from history");
      }
    }

    if (evt.type === "error") {
      console.error(`[xai-voice] realtime error call=${callId.slice(0, 8)}…`, JSON.stringify(evt).slice(0, 300));
    }
  });
}

/** For observability: how many calls are currently live. */
export function activeCallCount(): number {
  return activeCalls.size;
}
