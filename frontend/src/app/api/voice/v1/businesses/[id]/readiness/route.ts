// get_readiness — authenticated voice API.
// Overall readiness plus per-matter scores, same computation as the dashboard.

import { getPool, isEnabled } from "../../../../../../graph/db";
import {
  auditedToolCall,
  requireBusinessAccess,
  resolveVoiceContext,
  voiceError,
} from "../../../../_voice";
import { getBusinessReadiness } from "../../../../_business";

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
    const result = await auditedToolCall(
      pool,
      ctx,
      "get_readiness",
      { business_id: id },
      async () => {
        const business = await requireBusinessAccess(pool, ctx, id);
        const readiness = await getBusinessReadiness(pool, business.id);
        return {
          business_id: business.id,
          business_name: business.name,
          overall_readiness: readiness.overall,
          matters: readiness.matters,
        };
      }
    );
    return Response.json(result);
  } catch (err) {
    return voiceError(err);
  }
}
