// Acknowledge a regulatory impact: pending -> acknowledged.
// Idempotent (re-acknowledging an acknowledged impact is a no-op).

import { getPool } from "../../../../../../graph/db";
import {
  gateRequest,
  isUuid,
  resolveWorkspaceId,
  ensureDatabase,
  noDatabase,
  withTx,
  auditInTx,
} from "../../../_util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ws = resolveWorkspaceId(req);
  if (!ws) return Response.json({ error: "workspace_required" }, { status: 400 });
  // Acknowledging is an operational update: facility and compliance managers
  // carry edit_project_facts.
  const gated = await gateRequest(req, "edit_project_facts", ws);
  if ("response" in gated) return gated.response;
  const { gate, meta } = gated;
  if (!ensureDatabase()) return noDatabase();

  const { id } = await params;
  if (!isUuid(id)) {
    return Response.json({ error: "invalid_impact_id" }, { status: 400 });
  }

  try {
    const updated = await withTx(async (client) => {
      const { rows } = await client.query(
        `SELECT ri.id, ri.ack_status, ri.event_id
           FROM regulatory_impacts ri
          WHERE ri.id = $1 AND ri.workspace_id = $2
          LIMIT 1`,
        [id, ws]
      );
      if (rows.length === 0) {
        throw Object.assign(new Error("impact_not_found"), { status: 404 });
      }
      const before = rows[0].ack_status as string;
      if (before !== "acknowledged") {
        await client.query(
          `UPDATE regulatory_impacts SET ack_status = 'acknowledged', updated_at = now()
            WHERE id = $1`,
          [id]
        );
        await auditInTx({
          client,
          meta,
          userId: gate.user.id,
          workspaceId: ws,
          action: "regulatory_impact.acknowledged",
          targetType: "regulatory_impact",
          targetId: id,
          before: { ack_status: before },
          after: { ack_status: "acknowledged" },
        });
      }
      const { rows: out } = await client.query(
        `SELECT id, event_id, ack_status, implementation_status FROM regulatory_impacts WHERE id = $1 AND workspace_id = $2`,
        [id, ws]
      );
      return { impact: out[0], was: before };
    });
    return Response.json({ impact: updated.impact, previously: updated.was });
  } catch (err) {
    const e = err as Error & { status?: number };
    if (e.message === "impact_not_found") {
      return Response.json({ error: "impact_not_found" }, { status: 404 });
    }
    console.error("[regulatory-impact] acknowledge failed:", e.message);
    return Response.json({ error: "acknowledge_failed" }, { status: e.status ?? 500 });
  }
}
