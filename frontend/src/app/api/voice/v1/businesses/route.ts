// list_my_businesses — authenticated voice API.
// Lists the businesses the caller may access (owner or workspace member).

import { getPool, isEnabled } from "../../../../graph/db";
import {
  auditedToolCall,
  listAccessibleBusinesses,
  resolveVoiceContext,
  voiceError,
} from "../../_voice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    if (!isEnabled()) return Response.json({ error: "no_database" }, { status: 503 });
    const pool = getPool();
    if (!pool) return Response.json({ error: "no_database" }, { status: 503 });
    const ctx = await resolveVoiceContext(request.headers.get("authorization"), pool);
    const result = await auditedToolCall(pool, ctx, "list_my_businesses", {}, async () => {
      const businesses = await listAccessibleBusinesses(pool, ctx);
      return {
        businesses: businesses.map((b) => ({
          id: b.id,
          public_id: b.public_id,
          name: b.name,
          legal_name: b.legal_name,
          business_type: b.business_type,
          municipality: b.municipality,
        })),
      };
    });
    return Response.json(result);
  } catch (err) {
    return voiceError(err);
  }
}
