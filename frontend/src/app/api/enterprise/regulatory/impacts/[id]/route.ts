// Update a regulatory impact's implementation status
// (not_started -> in_progress -> implemented). Audited with before/after.

import { getPool } from "../../../../../graph/db";
import { isImplementationStatus } from "../../../../../../lib/enterprise-regulatory";
import {
  gateRequest,
  isUuid,
  readJsonBody,
  resolveWorkspaceId,
  ensureDatabase,
  noDatabase,
  withTx,
  auditInTx,
} from "../../_util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const body = await readJsonBody(req);
  const ws = resolveWorkspaceId(req, body);
  if (!ws) return Response.json({ error: "workspace_required" }, { status: 400 });
  const gated = await gateRequest(req, "edit_project_facts", ws);
  if ("response" in gated) return gated.response;
  const { gate, meta } = gated;
  if (!ensureDatabase()) return noDatabase();

  const { id } = await params;
  if (!isUuid(id)) {
    return Response.json({ error: "invalid_impact_id" }, { status: 400 });
  }
  const next = body.implementation_status;
  if (!isImplementationStatus(next)) {
    return Response.json(
      { error: "invalid_implementation_status", allowed: ["not_started", "in_progress", "implemented"] },
      { status: 400 }
    );
  }

  try {
    const updated = await withTx(async (client) => {
      const { rows } = await client.query(
        `SELECT ri.id, ri.implementation_status, ri.event_id
           FROM regulatory_impacts ri
          WHERE ri.id = $1 AND ri.workspace_id = $2
          LIMIT 1`,
        [id, ws]
      );
      if (rows.length === 0) {
        throw Object.assign(new Error("impact_not_found"), { status: 404 });
      }
      const before = rows[0].implementation_status as string;
      if (before !== next) {
        await client.query(
          `UPDATE regulatory_impacts SET implementation_status = $1, updated_at = now()
            WHERE id = $2`,
          [next, id]
        );
        await auditInTx({
          client,
          meta,
          userId: gate.user.id,
          workspaceId: ws,
          action: "regulatory_impact.implementation_updated",
          targetType: "regulatory_impact",
          targetId: id,
          before: { implementation_status: before },
          after: { implementation_status: next },
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
    console.error("[regulatory-impact] patch failed:", e.message);
    return Response.json({ error: "update_failed" }, { status: e.status ?? 500 });
  }
}
