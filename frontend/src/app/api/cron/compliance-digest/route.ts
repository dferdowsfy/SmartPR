// Monthly compliance-digest sender.
//
// POST /api/cron/compliance-digest
// Sends the monthly "compliance snapshot" digest email to paid workspaces:
// due within 30 days / due in 1–3 months / stalled filings / missing dates.
// Queries Supabase LIVE at send time. Email only — no SMS/WhatsApp.
//
// Auth: header `x-cron-secret: $COMPLIANCE_CRON_SECRET` (same secret as the
// daily compliance-reminder cron).
// Schedule: once monthly, on the 1st at ~8:00am ET, via the host's scheduler
// (Railway cron, Supabase pg_cron hitting the endpoint, etc.).
//
// Safety properties:
// - Idempotent per (workspace_id, period): the UNIQUE (workspace_id, period)
//   constraint on compliance_digest_log prevents double-sends.
// - Free workspaces are skipped (paywall: Core/Operator/Partner+ only).
// - The digest has its own opt-out (scope='digest'); the global EMAIL mute
//   covers both digest and transactional reminders.
// - A due item appears ONLY when the obligation still carries a stored due
//   date with real provenance — never an estimate.

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
