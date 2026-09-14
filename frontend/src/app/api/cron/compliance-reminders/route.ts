// Daily compliance-reminder sender.
//
// POST /api/cron/compliance-reminders
// Sends due PENDING email notifications (RENEWAL_60/30/7_DAY) plus the
// 14-day stalled-filing nudge. Email only — no SMS/WhatsApp in this phase.
//
// Auth: header `x-cron-secret: $COMPLIANCE_CRON_SECRET` (set this env var
// when scheduling the job; the value is never logged or committed).
// Schedule: once daily (~8:00am ET) via the host's scheduler (Railway cron,
// Supabase pg_cron hitting the endpoint, etc.).
//
// Safety properties:
// - Idempotent: a notification flips PENDING → DELIVERED exactly once; the
//   (obligation_id, type, scheduled_for) unique constraint prevents
//   double-scheduling upstream.
// - Free workspaces are skipped (paywall: Core/Operator/Partner+ only).
// - Global / per-business / per-obligation email mutes are honored.
// - A renewal reminder fires ONLY when the obligation still carries a stored
//   due date with real provenance — never an estimate.

import { getPool } from "../../../graph/db";
import { runComplianceReminderCron } from "../../../../lib/compliance-reminders";

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
    const summary = await runComplianceReminderCron(pool);
    return Response.json({ ok: true, ...summary });
  } catch (err) {
    console.error(`[compliance-reminders] cron failed: ${(err as Error)?.message || err}`);
    return Response.json({ error: "Cron run failed." }, { status: 500 });
  }
}
