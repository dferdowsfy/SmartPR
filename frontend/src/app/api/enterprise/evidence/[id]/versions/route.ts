// GET /api/enterprise/evidence/[id]/versions — immutable version history
// with every review decision (the audit trail for an evidence document).
// Permission: view_records.

import { gateEnterprise, badRequest, notFound } from "../../../_util";
import { getPool } from "../../../../../graph/db";
import { isUuid } from "../../../../../../lib/enterprise-work";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: evidenceId } = await context.params;
  if (!isUuid(evidenceId)) return badRequest("Invalid evidence id.");

  const url = new URL(request.url);
  const gate = await gateEnterprise(
    request,
    "view_records",
    url.searchParams.get("workspace_id")
  );
  if ("response" in gate) return gate.response;
  const { workspaceId } = gate;

  const pool = getPool();
  if (!pool) return Response.json({ error: "no_database" }, { status: 503 });

  const { rows: evRows } = await pool.query<{
    evidence_id: string;
    enterprise_state: string;
    original_filename: string | null;
    obligation_id: string | null;
    obligation_name: string | null;
  }>(
    `SELECT e.id::text AS evidence_id, e.enterprise_state AS enterprise_state,
            e.original_filename AS original_filename,
            e.obligation_id::text AS obligation_id, o.name AS obligation_name
       FROM evidence e
       JOIN businesses b ON b.id = e.business_id
       LEFT JOIN obligations o ON o.id = e.obligation_id
      WHERE e.id = $1::uuid AND b.workspace_id = $2::uuid
      LIMIT 1`,
    [evidenceId, workspaceId]
  );
  const ev = evRows[0];
  if (!ev) return notFound();

  const { rows: versions } = await pool.query(
    `SELECT v.id::text AS version_id, v.version_number, v.storage_path,
            v.file_hash, v.uploaded_by::text AS uploaded_by,
            COALESCE(u.name, u.email) AS uploaded_by_name,
            v.created_at
       FROM evidence_versions v
       LEFT JOIN users u ON u.id = v.uploaded_by
      WHERE v.evidence_id = $1::uuid
      ORDER BY v.version_number ASC`,
    [evidenceId]
  );

  const { rows: reviews } = await pool.query(
    `SELECT r.id::text AS review_id,
            r.evidence_version_id::text AS evidence_version_id,
            v.version_number AS version_number,
            r.reviewer_user_id::text AS reviewer_user_id,
            COALESCE(u.name, u.email) AS reviewer_name,
            r.decision, r.reason, r.previous_state, r.resulting_state,
            r.created_at
       FROM evidence_reviews r
       LEFT JOIN evidence_versions v ON v.id = r.evidence_version_id
       LEFT JOIN users u ON u.id = r.reviewer_user_id
      WHERE r.evidence_id = $1::uuid
      ORDER BY r.created_at ASC`,
    [evidenceId]
  );

  return Response.json({
    workspace_id: workspaceId,
    evidence: ev,
    versions,
    reviews,
  });
}
