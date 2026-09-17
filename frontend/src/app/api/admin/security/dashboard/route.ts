// GET /api/admin/security/dashboard — factual control counts only (no SOC 2 score)
import { requireSecurityAdmin, jsonOk } from "../_util";
import { controlInventorySummary, listSecurityControls } from "../../../../../lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await requireSecurityAdmin();
  if ("response" in gate) return gate.response;
  const { pool } = gate;

  const summary = controlInventorySummary();

  let evidenceCount = 0;
  let openIncidents = 0;
  let openRisks = 0;
  let activePolicies = 0;
  let recentReviews = 0;
  let activeSupportGrants = 0;

  try {
    const e = await pool.query(`SELECT COUNT(*)::text AS n FROM security_control_evidence`);
    evidenceCount = Number(e.rows[0]?.n || 0);
  } catch { /* table may not exist yet */ }
  try {
    const i = await pool.query(
      `SELECT COUNT(*)::text AS n FROM security_incidents WHERE status NOT IN ('resolved','closed')`
    );
    openIncidents = Number(i.rows[0]?.n || 0);
  } catch { /* missing */ }
  try {
    const r = await pool.query(
      `SELECT COUNT(*)::text AS n FROM security_risks WHERE status IN ('open','mitigating')`
    );
    openRisks = Number(r.rows[0]?.n || 0);
  } catch { /* missing */ }
  try {
    const p = await pool.query(
      `SELECT COUNT(*)::text AS n FROM security_policies WHERE status = 'active'`
    );
    activePolicies = Number(p.rows[0]?.n || 0);
  } catch { /* missing */ }
  try {
    const ar = await pool.query(
      `SELECT COUNT(*)::text AS n FROM security_access_reviews WHERE created_at > now() - interval '90 days'`
    );
    recentReviews = Number(ar.rows[0]?.n || 0);
  } catch { /* missing */ }
  try {
    const sg = await pool.query(
      `SELECT COUNT(*)::text AS n FROM support_access_grants
        WHERE revoked_at IS NULL AND expires_at > now()`
    );
    activeSupportGrants = Number(sg.rows[0]?.n || 0);
  } catch { /* missing */ }

  return jsonOk({
    disclaimer:
      "SOC 2 readiness dashboard only. These are factual inventory counts — not a compliance score or certification status.",
    controls: summary,
    live: {
      evidence_records: evidenceCount,
      open_incidents: openIncidents,
      open_risks: openRisks,
      active_policies: activePolicies,
      access_reviews_90d: recentReviews,
      active_support_grants: activeSupportGrants,
    },
    control_list: listSecurityControls().map((c) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      category: c.category,
    })),
  });
}
