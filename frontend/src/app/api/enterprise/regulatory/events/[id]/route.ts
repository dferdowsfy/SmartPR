// Regulatory event detail (GET): event + its impact rows, enriched with
// obligation / business / facility / project names for the detail UI.

import { getPool } from "../../../../../graph/db";
import {
  gateRequest,
  isUuid,
  resolveWorkspaceId,
  ensureDatabase,
  noDatabase,
} from "../../_util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IMPACT_COLUMNS = `
  ri.id, ri.event_id, ri.obligation_id, ri.business_id, ri.facility_id,
  ri.matter_id, ri.required_action, ri.ack_status, ri.implementation_status,
  ri.applicability, ri.match_basis, ri.match_key, ri.created_at, ri.updated_at,
  o.name AS obligation_name, o.agency AS obligation_agency,
  b.name AS business_name,
  f.name AS facility_name, f.municipality AS facility_municipality,
  m.title AS matter_title
`;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ws = resolveWorkspaceId(req);
  if (!ws) return Response.json({ error: "workspace_required" }, { status: 400 });
  const gated = await gateRequest(req, "view_records", ws);
  if ("response" in gated) return gated.response;
  if (!ensureDatabase()) return noDatabase();
  const pool = getPool()!;

  const { id } = await params;
  if (!isUuid(id)) {
    return Response.json({ error: "invalid_event_id" }, { status: 400 });
  }

  try {
    const { rows: events } = await pool.query(
      `SELECT re.id, re.title, re.summary, re.lifecycle, re.regulatory_source,
              re.source_version, re.effective_date, re.verification_date,
              re.verified_by, re.reviewer_notes, re.workspace_id,
              re.change_event_id, re.targeting, re.prev_rule_text,
              re.updated_rule_text, re.created_at, re.updated_at,
              (SELECT lower(u.email) FROM auth.users u WHERE u.id = re.verified_by) AS verified_by_email
         FROM regulatory_events re
        WHERE re.id = $1 AND (re.workspace_id = $2 OR re.workspace_id IS NULL)
        LIMIT 1`,
      [id, ws]
    );
    if (events.length === 0) {
      return Response.json({ error: "event_not_found" }, { status: 404 });
    }

    const { rows: impacts } = await pool.query(
      `SELECT ${IMPACT_COLUMNS}
         FROM regulatory_impacts ri
         LEFT JOIN obligations o ON o.id = ri.obligation_id
         LEFT JOIN businesses b ON b.id = ri.business_id
         LEFT JOIN facilities f ON f.id = ri.facility_id
         LEFT JOIN matters m ON m.id = ri.matter_id
        WHERE ri.event_id = $1 AND ri.workspace_id = $2
        ORDER BY
          CASE WHEN ri.obligation_id IS NOT NULL THEN 0
               WHEN ri.business_id IS NOT NULL THEN 1
               WHEN ri.facility_id IS NOT NULL THEN 2
               WHEN ri.matter_id IS NOT NULL THEN 3 ELSE 4 END,
          COALESCE(o.name, b.name, f.name, m.title, '')
        LIMIT 2000`,
      [id, ws]
    );

    return Response.json({ event: events[0], impacts });
  } catch (err) {
    console.error("[regulatory-event] detail failed:", (err as Error).message);
    return Response.json({ error: "query_failed" }, { status: 500 });
  }
}
