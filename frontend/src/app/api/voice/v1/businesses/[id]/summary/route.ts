// get_business_summary — authenticated voice API.
// Compact profile + counts for one business the caller may access.

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
      "get_business_summary",
      { business_id: id },
      async () => {
        const business = await requireBusinessAccess(pool, ctx, id);
        const [obligations, evidence] = await Promise.all([
          getBusinessObligations(pool, business.id),
          getBusinessEvidence(pool, business.id),
        ]);
        const byStatus = new Map<string, number>();
        for (const o of obligations) byStatus.set(o.status, (byStatus.get(o.status) ?? 0) + 1);
        return {
          business: {
            id: business.id,
            name: business.name,
            legal_name: business.legal_name,
            business_structure: business.business_structure,
            business_type: business.business_type,
            industry: business.industry,
            municipality: business.municipality,
            physical_address: business.physical_address,
          },
          requirement_count: obligations.length,
          requirements_by_status: Object.fromEntries(byStatus),
          overdue_count: byStatus.get("OVERDUE") ?? 0,
          evidence_count: evidence.length,
        };
      }
    );
    return Response.json(result);
  } catch (err) {
    return voiceError(err);
  }
}
