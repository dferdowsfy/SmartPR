// Monthly compliance-digest sender (spec section 10, revised).
//
// POST /api/cron/compliance-digest
// Sends the proactive-compliance-officer digest to paid workspaces, in the
// user's language (English / Puerto Rican Spanish). Queries Supabase LIVE at
// send time. Email only — no SMS/WhatsApp.
//
// The email answers four questions: what must I do (ACTION REQUIRED),
// what is coming (COMING UP, 30/60/90-day windows), what changed
// (WHAT CHANGED — only verified developments matched to THIS business),
// and what SmartPR is missing (SMARTPR NEEDS FROM YOU), plus an
// explainable COMPLIANCE HEALTH score (current / total applicable).
//
// Auth: header `x-cron-secret: $COMPLIANCE_CRON_SECRET` (same secret as the
// daily compliance-reminder cron and the regulatory-scan cron).
// Schedule: once monthly, on the 1st at ~8:00am ET, via the host's scheduler
// (Railway cron, Supabase pg_cron hitting the endpoint, etc.). The
// regulatory-scan cron (POST /api/cron/regulatory-scan) should run earlier
// the same morning (~6:00am ET) so fresh findings are available.
//
// Safety properties:
// - Idempotent per (workspace_id, period): the UNIQUE (workspace_id, period)
//   constraint on compliance_digest_log prevents double-sends.
// - Free workspaces are skipped (paywall: Core/Operator/Partner+ only).
// - The digest has its own opt-out (scope='digest'); the global EMAIL mute
//   covers both digest and transactional reminders.
// - A due item appears ONLY when the obligation still carries a stored due
//   date with real provenance — never an estimate.
// - WHAT CHANGED shows only review_status='verified' developments matched
//   deterministically to the business, each at most once per workspace.
//   Generic Puerto Rico news (no targeting criteria) never matches.

import { getPool } from "../../../graph/db";
import { runComplianceDigestCron } from "../../../../lib/compliance-digest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cronAuthorized(req: Request): boolean {
  const secret = process.env.COMPLIANCE_CRON_SECRET;
  if (!secret) return false;
  const given = req.headers.get("x-cron-secret");
  if (!given || given.length !== secret.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ secret.charCodeAt(i);
  return diff === 0;
}

export async function POST(req: Request) {
  if (!cronAuthorized(req)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const pool = getPool();
  if (!pool) return Response.json({ error: "Database unavailable." }, { status: 503 });
  try {
    const summary = await runComplianceDigestCron(pool);
    return Response.json({ ok: true, ...summary });
  } catch (err) {
    console.error(`[compliance-digest] cron failed: ${(err as Error)?.message || err}`);
    return Response.json({ error: "Cron run failed." }, { status: 500 });
  }
}
