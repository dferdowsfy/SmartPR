// get_missing_items — authenticated voice API.
// Requirements still needing evidence or reviewer attention: obligations with
// no evidence, failed evidence, or evidence awaiting review.

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

const MISSING_STATES = new Set(["NONE", "FAILED", "NEEDS_REVIEW"]);

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
      "get_missing_items",
      { business_id: id },
      async () => {
        const business = await requireBusinessAccess(pool, ctx, id);
        const obligations = await getBusinessObligations(pool, business.id);
        const missing = obligations.filter(
          (o) => MISSING_STATES.has(o.evidence_state) || o.status === "MISSING"
        );
        return {
          business_id: business.id,
          business_name: business.name,
          missing_count: missing.length,
          missing_items: missing.map((o) => ({
            id: o.id,
            name: o.name,
            agency: o.agency,
            evidence_state: o.evidence_state,
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
