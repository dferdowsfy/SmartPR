// get_requirements — authenticated voice API.
// Returns the business's requirements from the authoritative persisted
// obligations (created by SmartPR's deterministic requirements engine from
// the business's stored facts). Grok never determines requirements itself.

import { getPool, isEnabled } from "../../../../../../graph/db";
import {
  auditedToolCall,
  requireBusinessAccess,
  resolveVoiceContext,
  voiceError,
} from "../../../../_voice";
import { getBusinessObligations } from "../../../../_business";

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
      "get_requirements",
      { business_id: id },
      async () => {
        const business = await requireBusinessAccess(pool, ctx, id);
        const obligations = await getBusinessObligations(pool, business.id);
        return {
          business_id: business.id,
          business_name: business.name,
          requirements: obligations.map((o) => ({
            id: o.id,
            name: o.name,
            agency: o.agency,
            status: o.status,
            due_date: o.due_date,
            next_action: o.next_action,
          })),
        };
      }
    );
    return Response.json(result);
  } catch (err) {
    return voiceError(err);
  }
}
