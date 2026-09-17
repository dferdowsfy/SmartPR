// get_account_context — authenticated voice API.
// Returns the caller's account context. Every field is derived server-side
// from the validated voice session; the agent supplies nothing but the token.

import { getPool, isEnabled } from "../../../../graph/db";
import { resolveVoiceContext, voiceError } from "../../_voice";
import { toolGetAccountContext } from "../../../../../lib/voice/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    if (!isEnabled()) return Response.json({ error: "no_database" }, { status: 503 });
    const pool = getPool();
    if (!pool) return Response.json({ error: "no_database" }, { status: 503 });
    const ctx = await resolveVoiceContext(request.headers.get("authorization"), pool);
    const result = await toolGetAccountContext(pool, ctx);
    return Response.json(result);
  } catch (err) {
    return voiceError(err);
  }
}
