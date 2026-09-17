// get_missing_items — authenticated voice API.
// Requirements still needing evidence or reviewer attention: obligations with
// no evidence, failed evidence, or evidence awaiting review.

import { getPool, isEnabled } from "../../../../../../graph/db";
import { resolveVoiceContext, voiceError } from "../../../../_voice";
import { toolGetMissingItems } from "../../../../../../../lib/voice/tools";

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
    const result = await toolGetMissingItems(pool, ctx, id);
    return Response.json(result);
  } catch (err) {
    return voiceError(err);
  }
}
