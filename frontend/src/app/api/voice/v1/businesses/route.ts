// list_my_businesses — authenticated voice API.
// Lists the businesses the caller may access (owner or workspace member).

import { getPool, isEnabled } from "../../../../graph/db";
import { resolveVoiceContext, voiceError } from "../../_voice";
import { toolListMyBusinesses } from "../../../../../lib/voice/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    if (!isEnabled()) return Response.json({ error: "no_database" }, { status: 503 });
    const pool = getPool();
    if (!pool) return Response.json({ error: "no_database" }, { status: 503 });
    const ctx = await resolveVoiceContext(request.headers.get("authorization"), pool);
    const result = await toolListMyBusinesses(pool, ctx);
    return Response.json(result);
  } catch (err) {
    return voiceError(err);
  }
}
