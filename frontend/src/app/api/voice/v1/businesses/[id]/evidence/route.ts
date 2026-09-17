// get_evidence_status — authenticated voice API.
// Evidence locker summary for the business: per-obligation coverage and
// the review status of each uploaded document.

import { getPool, isEnabled } from "../../../../../../graph/db";
import {
  auditedToolCall,
  requireBusinessAccess,
  resolveVoiceContext,
  voiceError,
} from "../../../../_voice";
import { getBusinessEvidence, getBusinessObligations } from "../../../../_business";

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
      "get_evidence_status",
      { business_id: id },
      async () => {
        const business = await requireBusinessAccess(pool, ctx, id);
        const [obligations, evidence] = await Promise.all([
          getBusinessObligations(pool, business.id),
          getBusinessEvidence(pool, business.id),
        ]);
        const verified = obligations.filter((o) => o.evidence_state === "VERIFIED").length;
        return {
          business_id: business.id,
          business_name: business.name,
          evidence_count: evidence.length,
          verified_requirements: verified,
          total_requirements: obligations.length,
          coverage: obligations.map((o) => ({
            requirement_id: o.id,
            requirement_name: o.name,
            evidence_state: o.evidence_state,
          })),
          documents: evidence.map((e) => ({
            id: e.id,
            filename: e.filename,
            document_type: e.document_type,
            review_status: e.review_status,
            obligation_name: e.obligation_name,
          })),
        };
      }
    );
    return Response.json(result);
  } catch (err) {
    return voiceError(err);
  }
}
