// Impact report payload for a regulatory event: event details, affected
// businesses / facilities / projects, required actions, and acknowledgment
// + implementation rollups. Read-only (view_records).

import { getPool } from "../../../../../../graph/db";
import {
  gateRequest,
  isUuid,
  resolveWorkspaceId,
  ensureDatabase,
  noDatabase,
} from "../../../_util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
      `SELECT ri.id, ri.obligation_id, ri.business_id, ri.facility_id, ri.matter_id,
              ri.required_action, ri.ack_status, ri.implementation_status,
              ri.applicability, ri.match_basis, ri.match_key,
              o.name AS obligation_name, o.agency AS obligation_agency,
              b.name AS business_name,
              f.name AS facility_name, f.municipality AS facility_municipality,
              m.title AS matter_title
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
        LIMIT 5000`,
      [id, ws]
    );

    const rollup = {
      total: impacts.length,
      acknowledged: 0,
      pending_ack: 0,
      not_started: 0,
      in_progress: 0,
      implemented: 0,
      projected: 0,
      confirmed: 0,
    };
    const seen = {
      businesses: new Map<string, string>(),
      facilities: new Map<string, string>(),
      projects: new Map<string, string>(),
      obligations: new Map<string, string>(),
    };
    for (const r of impacts as Record<string, unknown>[]) {
      if (r.ack_status === "acknowledged") rollup.acknowledged += 1;
      else rollup.pending_ack += 1;
      if (r.implementation_status === "not_started") rollup.not_started += 1;
      else if (r.implementation_status === "in_progress") rollup.in_progress += 1;
      else if (r.implementation_status === "implemented") rollup.implemented += 1;
      if (r.applicability === "projected") rollup.projected += 1;
      else rollup.confirmed += 1;
      if (r.business_id && !seen.businesses.has(String(r.business_id))) {
        seen.businesses.set(String(r.business_id), String(r.business_name ?? ""));
      }
      if (r.facility_id && !seen.facilities.has(String(r.facility_id))) {
        seen.facilities.set(String(r.facility_id), String(r.facility_name ?? ""));
      }
      if (r.matter_id && !seen.projects.has(String(r.matter_id))) {
        seen.projects.set(String(r.matter_id), String(r.matter_title ?? ""));
      }
      if (r.obligation_id && !seen.obligations.has(String(r.obligation_id))) {
        seen.obligations.set(String(r.obligation_id), String(r.obligation_name ?? ""));
      }
    }

    const mapOut = (m: Map<string, string>) =>
      [...m.entries()].map(([id, name]) => ({ id, name }));

    return Response.json({
      event: events[0],
      rollup,
      affected: {
        obligations: mapOut(seen.obligations),
        businesses: mapOut(seen.businesses),
        facilities: mapOut(seen.facilities),
        projects: mapOut(seen.projects),
      },
      impacts,
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[regulatory-event] report failed:", (err as Error).message);
    return Response.json({ error: "query_failed" }, { status: 500 });
  }
}
