/**
 * xAI telephony gateway tests (pure helpers — no network, no secrets).
 *
 * Proves:
 * - webhook signatures verify per Standard Webhooks semantics and reject
 *   tampering, stale timestamps, and missing headers
 * - the pre-auth session.update attaches ONLY the anonymous knowledge-graph
 *   tool (no account tools, no token material)
 * - the authed session.update carries exactly the 19 curated tools with the
 *   session token in `authorization`
 * - DTMF PIN collection completes at exactly 6 digits and never buffers more
 * - caller phone extraction handles plain E.164 and sip: URI From headers
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import {
  AGENT_INSTRUCTIONS,
  buildAuthedSessionUpdate,
  buildCallGreeting,
  buildMcpToolEntry,
  buildPreAuthSessionUpdate,
  buildRealtimeCallUrl,
  DEFAULT_XAI_AGENT_ID,
  DtmfPinCollector,
  MCP_ALLOWED_TOOLS,
  parseDtmfEvent,
  parseIncomingCall,
  verifyWebhookSignature,
  XAI_REALTIME_WS_URL,
} from "./xaiRealtime";

const SECRET = "whsec_test_secret_value";

function sign(webhookId: string, timestamp: string, rawBody: string): string {
  return createHmac("sha256", SECRET).update(`${webhookId}.${timestamp}.${rawBody}`, "utf8").digest("base64");
}

describe("verifyWebhookSignature", () => {
  const rawBody = JSON.stringify({ type: "realtime.call.incoming", data: { call_id: "call_123" } });
  const webhookId = "evt_abc";
  const timestamp = String(Math.floor(Date.now() / 1000));

  it("accepts a valid signature", () => {
    const sig = sign(webhookId, timestamp, rawBody);
    const res = verifyWebhookSignature({
      rawBody,
      webhookId,
      timestamp,
      signatureHeader: `v1,${sig}`,
      secret: SECRET,
    });
    assert.equal(res.ok, true);
  });

  it("accepts when a valid signature is mixed with invalid ones", () => {
    const sig = sign(webhookId, timestamp, rawBody);
    const res = verifyWebhookSignature({
      rawBody,
      webhookId,
      timestamp,
      signatureHeader: `v1,bogus v1,${sig}`,
      secret: SECRET,
    });
    assert.equal(res.ok, true);
  });

  it("rejects a tampered body", () => {
    const sig = sign(webhookId, timestamp, rawBody);
    const res = verifyWebhookSignature({
      rawBody: rawBody + "tampered",
      webhookId,
      timestamp,
      signatureHeader: `v1,${sig}`,
      secret: SECRET,
    });
    assert.equal(res.ok, false);
    assert.equal((res as { reason: string }).reason, "bad_signature");
  });

  it("rejects a wrong secret", () => {
    const sig = sign(webhookId, timestamp, rawBody);
    const res = verifyWebhookSignature({
      rawBody,
      webhookId,
      timestamp,
      signatureHeader: `v1,${sig}`,
      secret: "whsec_wrong",
    });
    assert.equal(res.ok, false);
  });

  it("rejects stale timestamps", () => {
    const old = String(Math.floor(Date.now() / 1000) - 3600);
    const sig = sign(webhookId, old, rawBody);
    const res = verifyWebhookSignature({
      rawBody,
      webhookId,
      timestamp: old,
      signatureHeader: `v1,${sig}`,
      secret: SECRET,
    });
    assert.equal(res.ok, false);
    assert.equal((res as { reason: string }).reason, "stale_timestamp");
  });

  it("rejects missing headers and missing secret", () => {
    const sig = sign(webhookId, timestamp, rawBody);
    const base = { rawBody, webhookId, timestamp, signatureHeader: `v1,${sig}`, secret: SECRET };
    assert.equal(verifyWebhookSignature({ ...base, webhookId: null }).ok, false);
    assert.equal(verifyWebhookSignature({ ...base, signatureHeader: null }).ok, false);
    assert.equal(verifyWebhookSignature({ ...base, secret: undefined }).ok, false);
  });
});

describe("parseIncomingCall", () => {
  it("extracts call id and plain E.164 caller", () => {
    const info = parseIncomingCall({
      type: "realtime.call.incoming",
      data: {
        call_id: "call_123",
        sip_headers: [
          { name: "From", value: "+17875550100" },
          { name: "To", value: "+18005550199" },
        ],
      },
    });
    assert.deepEqual(info, { callId: "call_123", callerE164: "+17875550100" });
  });

  it("extracts caller from a sip: URI", () => {
    const info = parseIncomingCall({
      data: {
        call_id: "call_456",
        sip_headers: [{ name: "From", value: "sip:+17875550100@sip.provider.example;transport=tls" }],
      },
    });
    assert.equal(info?.callerE164, "+17875550100");
  });

  it("returns null caller when no From header is present", () => {
    const info = parseIncomingCall({ data: { call_id: "call_789", sip_headers: [] } });
    assert.deepEqual(info, { callId: "call_789", callerE164: null });
  });

  it("returns null for malformed payloads", () => {
    assert.equal(parseIncomingCall(null), null);
    assert.equal(parseIncomingCall({}), null);
    assert.equal(parseIncomingCall({ data: {} }), null);
    assert.equal(parseIncomingCall({ data: { call_id: 42 } }), null);
  });
});

describe("DtmfPinCollector", () => {
  it("completes at exactly 6 digits", () => {
    const c = new DtmfPinCollector();
    const digits = ["1", "2", "3", "4", "5"];
    for (const d of digits) assert.equal(c.push(d), null);
    assert.equal(c.pending, 5);
    assert.equal(c.push("6"), "123456");
    assert.equal(c.pending, 0);
  });

  it("ignores non-digit keys", () => {
    const c = new DtmfPinCollector();
    assert.equal(c.push("#"), null);
    assert.equal(c.push("*"), null);
    assert.equal(c.pending, 0);
    assert.equal(c.push("9"), null);
    assert.equal(c.pending, 1);
  });

  it("starts a fresh collection after completing", () => {
    const c = new DtmfPinCollector();
    for (const d of "111111") c.push(d);
    assert.equal(c.push("2"), null);
    assert.equal(c.pending, 1);
  });

  it("resets on demand", () => {
    const c = new DtmfPinCollector();
    c.push("1");
    c.push("2");
    c.reset();
    assert.equal(c.pending, 0);
  });
});

describe("parseDtmfEvent", () => {
  it("extracts the digit from dtmf events", () => {
    assert.equal(parseDtmfEvent({ type: "input_audio_buffer.dtmf_event_received", event: "7" }), "7");
  });

  it("returns null for other events or malformed input", () => {
    assert.equal(parseDtmfEvent({ type: "response.done" }), null);
    assert.equal(parseDtmfEvent(null), null);
    assert.equal(parseDtmfEvent({ type: "input_audio_buffer.dtmf_event_received" }), null);
  });
});

describe("buildRealtimeCallUrl", () => {
  it("includes both call_id and agent_id when an agent is set", () => {
    const url = buildRealtimeCallUrl("call_123", "agent_abc");
    assert.equal(url, `${XAI_REALTIME_WS_URL}?call_id=call_123&agent_id=agent_abc`);
  });

  it("omits agent_id when disabled", () => {
    assert.equal(buildRealtimeCallUrl("call_123"), `${XAI_REALTIME_WS_URL}?call_id=call_123`);
    assert.equal(buildRealtimeCallUrl("call_123", null), `${XAI_REALTIME_WS_URL}?call_id=call_123`);
    assert.equal(buildRealtimeCallUrl("call_123", ""), `${XAI_REALTIME_WS_URL}?call_id=call_123`);
  });

  it("encodes special characters in the call id", () => {
    const url = buildRealtimeCallUrl("call a/b", "agent_abc");
    assert.ok(url.includes("call_id=call+a%2Fb"));
    assert.ok(url.includes("agent_id=agent_abc"));
  });

  it("defaults to the SmartPR console agent", () => {
    assert.equal(DEFAULT_XAI_AGENT_ID, "agent_MDinRE52EURHvKZV");
  });
});

describe("session.update payloads", () => {
  it("pre-auth update attaches only the anonymous knowledge-graph tool", () => {
    const update = buildPreAuthSessionUpdate("eve");
    assert.equal(update.type, "session.update");
    assert.equal(update.session.voice, "eve");
    // Exactly one MCP tool entry, exposing only get_general_requirements:
    // the model can never see account tool names before authentication.
    // (The MCP server ALSO filters tools/list by the anonymous marker, as
    // defense in depth.)
    const tools = update.session.tools;
    assert.ok(tools && tools.length === 1);
    const entry = tools[0];
    assert.equal(entry.type, "mcp");
    assert.deepEqual([...entry.allowed_tools], ["get_general_requirements"]);
    assert.equal(entry.authorization, "anonymous");
    const serialized = JSON.stringify(update);
    assert.ok(!serialized.includes("vs_"));
    assert.ok(update.session.instructions.includes("get_general_requirements"));
  });

  it("pre-auth instructions frame the general tier and invite (never demand) the PIN", () => {
    const update = buildPreAuthSessionUpdate("eve");
    assert.ok(!update.session.instructions.includes("no PIN needed"));
    assert.ok(update.session.instructions.includes("Never ask the caller to say the PIN aloud"));
    assert.ok(update.session.instructions.includes("until authentication succeeds"));
  });

  it("call greeting leads with value and mentions the PIN only as the premium path", () => {
    const enrolledGreeting = buildCallGreeting(true);
    assert.ok(enrolledGreeting.includes("Ask me anything"));
    assert.ok(!enrolledGreeting.includes("no PIN needed"));
    assert.ok(enrolledGreeting.includes("premium voice access"));
    assert.ok(enrolledGreeting.includes("keypad now"));
    const strangerGreeting = buildCallGreeting(false);
    assert.ok(strangerGreeting.includes("Ask me anything"));
    assert.ok(!strangerGreeting.includes("no PIN needed"));
    assert.ok(strangerGreeting.includes("Phone access"));
    assert.ok(!strangerGreeting.includes("keypad now"));
  });

  it("authed update carries exactly the 19 curated tools with the token", () => {
    const token = "vs_test_token_value";
    const update = buildAuthedSessionUpdate("eve", "https://www.getsmartpr.com/api/mcp/voice", token);
    const tools = update.session.tools;
    assert.ok(tools && tools.length === 1);
    const entry = tools[0];
    assert.equal(entry.type, "mcp");
    assert.equal(entry.server_url, "https://www.getsmartpr.com/api/mcp/voice");
    assert.equal(entry.server_label, "smartpr");
    assert.deepEqual([...entry.allowed_tools], [...MCP_ALLOWED_TOOLS]);
    assert.equal(entry.allowed_tools.length, 19);
    assert.equal(entry.authorization, token);
  });

  it("buildMcpToolEntry never invents tools outside the allowlist", () => {
    const entry = buildMcpToolEntry("https://example.com/api/mcp/voice", "vs_x");
    for (const t of entry.allowed_tools) {
      assert.ok((MCP_ALLOWED_TOOLS as readonly string[]).includes(t), `unexpected tool ${t}`);
    }
  });

  it("agent instructions forbid PIN collection by the model", () => {
    assert.ok(AGENT_INSTRUCTIONS.includes("Never ask the caller to dictate their PIN aloud"));
    assert.ok(AGENT_INSTRUCTIONS.includes("Never collect passwords, PINs, or verification codes"));
  });
});
