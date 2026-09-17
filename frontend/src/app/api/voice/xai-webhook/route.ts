// xAI telephony webhook: receives `realtime.call.incoming` events.
// POST /api/voice/xai-webhook
//
// Verifies the Standard Webhooks signature (XAI_WEBHOOK_SECRET) before doing
// anything, then hands the call to the xAI call manager and returns 200
// immediately — the realtime session runs detached from this request.

import { handleIncomingCall } from "../../../../lib/voice/xaiCallManager";
import { parseIncomingCall, verifyWebhookSignature } from "../../../../lib/voice/xaiRealtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const rawBody = await request.text();

  const verified = verifyWebhookSignature({
    rawBody,
    webhookId: request.headers.get("webhook-id"),
    timestamp: request.headers.get("webhook-timestamp"),
    signatureHeader: request.headers.get("webhook-signature"),
    secret: process.env.XAI_WEBHOOK_SECRET,
  });
  if (!verified.ok) {
    console.error(`[xai-voice] webhook rejected: ${verified.reason}`);
    return Response.json({ error: "bad_signature" }, { status: 401 });
  }

  let payload: unknown = null;
  try {
    payload = JSON.parse(rawBody) as unknown;
  } catch {
    return Response.json({ error: "bad_json" }, { status: 400 });
  }

  const eventType =
    payload && typeof payload === "object" ? (payload as { type?: unknown }).type : null;
  if (eventType !== "realtime.call.incoming") {
    return Response.json({ received: true, ignored: true });
  }

  const incoming = parseIncomingCall(payload);
  if (!incoming) {
    return Response.json({ error: "bad_payload" }, { status: 400 });
  }

  // Detached: the call lifecycle (WebSocket, PIN flow, hangup) runs in the
  // background. This response must return fast so xAI doesn't retry.
  handleIncomingCall(incoming.callId, incoming.callerE164);

  return Response.json({ received: true });
}
