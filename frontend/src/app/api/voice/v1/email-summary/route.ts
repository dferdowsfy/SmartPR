// email_my_summary — authenticated voice API.
// POST /api/voice/v1/email-summary { business_id?, call_summary? }
//
// Emails a recap of the voice call to the caller's VERIFIED SmartPR email on
// file. The request MUST NOT include an email address argument — the recipient is
// always derived server-side from the validated voice session, never chosen
// by the agent. Available on all plans (including free); recurring
// compliance reminders remain governed by the existing paid-plan rules.

import { getPool, isEnabled } from "../../../../graph/db";
import { resolveVoiceContext, voiceError } from "../../_voice";
import { toolEmailMySummary } from "../../../../../lib/voice/tools";
import { readJson } from "../../_util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    if (!isEnabled()) return Response.json({ error: "no_database" }, { status: 503 });
    const pool = getPool();
    if (!pool) return Response.json({ error: "no_database" }, { status: 503 });
    const ctx = await resolveVoiceContext(request.headers.get("authorization"), pool);
    const body = await readJson(request);
    // NOTE: any "email"/"to"/"recipient" field in the body is deliberately
    // ignored. The recipient always comes from the voice session.
    const businessId =
      typeof body.business_id === "string" && body.business_id ? body.business_id : null;
    // Optional agent-written recap of what the call was about; the email
    // body is built from it. Omitted => deterministic session-activity recap.
    const callSummary =
      typeof body.call_summary === "string" && body.call_summary.trim()
        ? body.call_summary
        : null;
    const result = await toolEmailMySummary(pool, ctx, businessId, callSummary);
    return Response.json(result);
  } catch (err) {
    return voiceError(err);
  }
}
