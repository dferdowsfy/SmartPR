import { getPool, isEnabled } from "../../graph/db";
import { ensureSchema } from "../../graph/store";
import { getCurrentUser } from "../../../lib/supabase/server";
import { deriveObligationStatus, daysUntil, nextActionForStatus, validDateOnly } from "../../compliance/dates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!isEnabled()) return Response.json({ enabled: false, businesses: [], items: [], notifications: [] });
  const pool = getPool();
  if (!pool) return Response.json({ enabled: false, businesses: [], items: [], notifications: [] });
  await ensureSchema();
  try {
    const [businessRows, obligationRows, mattersCount, notificationRows, dueMatterRows] = await Promise.all([
      pool.query(
        `SELECT b.id, b.public_id, COALESCE(b.legal_name,b.name) AS legal_name, b.entity_number,
                b.business_structure, b.business_type, b.industry, b.municipality,
                b.physical_address, b.onboarding_mode, b.created_at,
                (SELECT ROUND(AVG(m.readiness_score))::int FROM matters m
                  WHERE m.business_id=b.id AND m.status <> 'ARCHIVED') AS readiness_score,
                (SELECT COUNT(*)::int FROM matters m WHERE m.business_id=b.id AND m.status NOT IN ('COMPLETED','ARCHIVED')) AS active_matters
           FROM businesses b
           LEFT JOIN workspace_members wm ON wm.workspace_id=b.workspace_id AND wm.user_id=$1
          WHERE b.archived=false AND (b.user_id=$1 OR wm.user_id IS NOT NULL)
          ORDER BY COALESCE(b.legal_name,b.name)`,
        [user.id]
      ),
      pool.query(
        `SELECT o.id, o.business_id, b.public_id AS business_public_id, o.matter_id, o.requirement_id, o.name, o.agency,
                o.status, o.due_date::text, o.due_date_source, o.due_date_confidence,
                o.source_reference, o.renewal_frequency_months, o.mandatory, o.next_action,
                o.completed_at, b.legal_name, b.name AS legacy_name, b.municipality,
                m.matter_type, m.title AS matter_title, m.status AS matter_status,
                m.readiness_score,
                CASE
                  WHEN o.verified_at IS NOT NULL AND o.status IN ('CURRENT','UPCOMING','DUE_SOON','OVERDUE') THEN 'VERIFIED'
                  WHEN EXISTS (SELECT 1 FROM evidence e WHERE e.obligation_id=o.id AND e.review_status='VERIFIED') THEN 'VERIFIED'
                  WHEN EXISTS (SELECT 1 FROM evidence e WHERE e.obligation_id=o.id AND e.review_status='NEEDS_REVIEW') THEN 'NEEDS_REVIEW'
                  WHEN EXISTS (SELECT 1 FROM evidence e WHERE e.obligation_id=o.id) THEN 'FAILED'
                  ELSE 'NONE' END AS evidence_state
           FROM obligations o
           JOIN businesses b ON b.id=o.business_id
           LEFT JOIN matters m ON m.id=o.matter_id
           LEFT JOIN workspace_members wm ON wm.workspace_id=b.workspace_id AND wm.user_id=$1
          WHERE b.archived=false AND (b.user_id=$1 OR wm.user_id IS NOT NULL)
          ORDER BY o.due_date NULLS LAST, COALESCE(b.legal_name,b.name), o.name`,
        [user.id]
      ),
      pool.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM matters m JOIN businesses b ON b.id=m.business_id
          LEFT JOIN workspace_members wm ON wm.workspace_id=b.workspace_id AND wm.user_id=$1
         WHERE (b.user_id=$1 OR wm.user_id IS NOT NULL) AND m.status IN ('DRAFT','IN_PROGRESS','NEEDS_ATTENTION','READY')`,
        [user.id]
      ),
      pool.query(
        `SELECT n.id, n.type, n.message, n.scheduled_for, n.status, n.business_id, b.public_id AS business_public_id, n.obligation_id,
                COALESCE(b.legal_name,b.name) AS business_name
           FROM notifications n JOIN businesses b ON b.id=n.business_id
          WHERE n.user_id=$1 AND n.status IN ('PENDING','DELIVERED') AND n.scheduled_for <= now()
          ORDER BY n.scheduled_for DESC LIMIT 25`,
        [user.id]
      ),
      pool.query(
        `SELECT m.id, m.business_id, m.submission_id, m.matter_type, m.title, m.status AS matter_status,
                m.readiness_score, m.due_date::text, m.due_date_source, m.source_reference,
                COALESCE(b.legal_name,b.name) AS business_name, b.municipality
           FROM matters m JOIN businesses b ON b.id=m.business_id
           LEFT JOIN workspace_members wm ON wm.workspace_id=b.workspace_id AND wm.user_id=$1
          WHERE m.due_date IS NOT NULL AND m.status <> 'ARCHIVED'
            AND (b.user_id=$1 OR wm.user_id IS NOT NULL)`,
        [user.id]
      ),
    ]);

    const obligationItems = obligationRows.rows.map((row) => {
      const dueDate = validDateOnly(row.due_date);
      const effectiveStatus = deriveObligationStatus({
        currentStatus: row.status,
        dueDate,
        evidenceState: row.evidence_state,
        expectsRenewal: Boolean(row.renewal_frequency_months || dueDate),
      });
      return {
        ...row,
        business_name: row.legal_name || row.legacy_name,
        status: effectiveStatus,
        next_action: row.next_action || nextActionForStatus(effectiveStatus),
        item_type: "OBLIGATION",
      };
    });
    const matterItems = dueMatterRows.rows.map((row) => {
      const remaining = daysUntil(row.due_date);
      const effectiveStatus = row.matter_status === "COMPLETED" ? "COMPLETED"
        : remaining <= 0 ? "OVERDUE" : remaining <= 30 ? "DUE_SOON"
        : remaining <= 90 ? "UPCOMING" : "IN_PROGRESS";
      return {
        ...row,
        id: `matter-${row.id}`,
        matter_id: row.id,
        name: row.title,
        agency: null,
        status: effectiveStatus,
        matter_title: row.title,
        next_action: row.matter_status === "COMPLETED" ? "View filing record" : "Continue filing",
        item_type: "MATTER",
      };
    });
    const items = [...obligationItems, ...matterItems].sort((a, b) =>
      (a.due_date || "9999-12-31").localeCompare(b.due_date || "9999-12-31")
    );
    const metrics = {
      businesses: businessRows.rows.length,
      due_next_30_days: items.filter((item) => item.due_date && daysUntil(item.due_date) >= 0 && daysUntil(item.due_date) <= 30 && item.status !== "COMPLETED").length,
      overdue: items.filter((item) => item.status === "OVERDUE").length,
      needs_attention: items.filter((item) => ["NEEDS_ATTENTION", "MISSING", "UNKNOWN"].includes(item.status)).length,
      filings_in_progress: mattersCount.rows[0]?.count ?? 0,
    };
    return Response.json({
      enabled: true,
      user: { id: user.id, email: user.email, name: user.user_metadata?.full_name || null },
      metrics,
      businesses: businessRows.rows,
      items,
      notifications: notificationRows.rows,
    });
  } catch (error) {
    console.error("[portfolio]", (error as Error).message);
    return Response.json({ enabled: true, error: "query_failed", businesses: [], items: [], notifications: [] }, { status: 500 });
  }
}
