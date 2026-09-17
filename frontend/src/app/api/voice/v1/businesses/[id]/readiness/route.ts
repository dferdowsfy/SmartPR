// get_readiness — authenticated voice API.
// Overall readiness plus per-matter scores, same computation as the dashboard.

import { getPool, isEnabled } from "../../../../../../graph/db";
import { resolveVoiceContext, voiceError } from "../../../../_voice";
import { toolGetReadiness } from "../../../../../../../lib/voice/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    if (!isEnabled()) return Response.json({ error: "no_database" }, { status: 503 });
    const pool = getPool();
    if (!pool) return Response.json({ error: "no_database" }, { status: 503 });
    const ctx = await resolveVoiceContext(request.headers.get("authorization"), pool);
    const { id } = await params;
    const result = await toolGetReadiness(pool, ctx, id);
    return Response.json(result);
  } catch (err) {
    return voiceError(err);
  }
}
