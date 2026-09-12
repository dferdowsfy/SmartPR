// Verify a regulatory event: advance its lifecycle through the guarded
// state machine, recording verification date, verifier, reviewer notes,
// and an optional source version bump. Audited with before/after.

import { getPool } from "../../../../../../graph/db";
import {
  canTransitionLifecycle,
  isRegulatoryLifecycle,
  type RegulatoryLifecycle,
} from "../../../../../../../lib/enterprise-regulatory";
import {
  gateRequest,
  isUuid,
  readJsonBody,
  resolveWorkspaceId,
  ensureDatabase,
  noDatabase,
  withTx,
  auditInTx,
} from "../../../_util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const body = await readJsonBody(req);
  const ws = resolveWorkspaceId(req, body);
  if (!ws) return Response.json({ error: "workspace_required" }, { status: 400 });
  const gated = await gateRequest(req, "manage_exceptions", ws);
  if ("response" in gated) return gated.response;
  const { gate, meta } = gated;
  if (!ensureDatabase()) return noDatabase();

  const { id } = await params;
  if (!isUuid(id)) {
    return Response.json({ error: "invalid_event_id" }, { status: 400 });
  }

  const target = body.lifecycle_target;
  if (!isRegulatoryLifecycle(target)) {
    return Response.json({ error: "invalid_lifecycle_target" }, { status: 400 });
  }
  const reviewerNotes =
    typeof body.reviewer_notes === "string" && body.reviewer_notes.trim()
      ? body.reviewer_notes.trim().slice(0, 8000)
      : null;
  const sourceVersion =
    typeof body.source_version === "string" && body.source_version.trim()
      ? body.source_version.trim().slice(0, 120)
      : null;

  try {
    const updated = await withTx(async (client) => {
      const { rows } = await client.query(
        `SELECT id, lifecycle, title FROM regulatory_events re
          WHERE re.id = $1 AND (re.workspace_id = $2 OR re.workspace_id IS NULL)
          LIMIT 1`,
        [id, ws]
      );
      if (rows.length === 0) {
        throw Object.assign(new Error("event_not_found"), { status: 404 });
      }
      const current = rows[0].lifecycle as RegulatoryLifecycle;
      if (!canTransitionLifecycle(current, target)) {
        throw Object.assign(
          new Error(`invalid_transition:${current}->${target}`),
          { status: 422 }
        );
      }
      const { rows: out } = await client.query(
        `UPDATE regulatory_events
            SET lifecycle = $1,
                verification_date = now(),
                verified_by = $2,
                reviewer_notes = COALESCE($3, reviewer_notes),
                source_version = COALESCE($4, source_version),
                updated_at = now()
          WHERE id = $5
          RETURNING id, title, lifecycle, regulatory_source, source_version,
                    effective_date, verification_date, verified_by,
                    reviewer_notes, workspace_id, created_at, updated_at`,
        [target, gate.user.id, reviewerNotes, sourceVersion, id]
      );
      await auditInTx({
        client,
        meta,
        userId: gate.user.id,
        workspaceId: ws,
        action: "regulatory_event.verified",
        targetType: "regulatory_event",
        targetId: id,
        before: { lifecycle: current },
        after: {
          lifecycle: target,
          reviewer_notes: reviewerNotes,
          source_version: sourceVersion,
        },
      });
      return out[0];
    });
    return Response.json({ event: updated });
  } catch (err) {
    const e = err as Error & { status?: number };
    if (e.message === "event_not_found") {
      return Response.json({ error: "event_not_found" }, { status: 404 });
    }
    if (e.message.startsWith("invalid_transition:")) {
      const [, detail] = e.message.split(":");
      return Response.json(
        { error: "invalid_transition", transition: detail },
        { status: 422 }
      );
    }
    console.error("[regulatory-event] verify failed:", e.message);
    return Response.json({ error: "verify_failed" }, { status: e.status ?? 500 });
  }
}
