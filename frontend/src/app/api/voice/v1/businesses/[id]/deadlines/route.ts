// get_deadlines — authenticated voice API.
// Upcoming and overdue deadlines: obligations with due dates plus the
// business's scheduled compliance notifications.

import { getPool, isEnabled } from "../../../../../../graph/db";
import {
  auditedToolCall,
  requireBusinessAccess,
  resolveVoiceContext,
  voiceError,
} from "../../../../_voice";
import { getBusinessNotifications, getBusinessObligations } from "../../../../_business";

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
      "get_deadlines",
      { business_id: id },
      async () => {
        const business = await requireBusinessAccess(pool, ctx, id);
        const [obligations, notifications] = await Promise.all([
          getBusinessObligations(pool, business.id),
          getBusinessNotifications(pool, business.id, ctx.userId),
        ]);
        const dated = obligations.filter((o) => o.due_date);
        const overdue = dated.filter((o) => o.status === "OVERDUE");
        return {
          business_id: business.id,
          business_name: business.name,
          overdue_count: overdue.length,
          deadlines: dated.map((o) => ({
            id: o.id,
            name: o.name,
            agency: o.agency,
            status: o.status,
            due_date: o.due_date,
            next_action: o.next_action,
          })),
          notifications: notifications.map((n) => ({
            id: n.id,
            type: n.type,
            scheduled_for: n.scheduled_for,
            status: n.status,
            message: n.message,
          })),
        };
      }
    );
    return Response.json(result);
  } catch (err) {
    return voiceError(err);
  }
}
