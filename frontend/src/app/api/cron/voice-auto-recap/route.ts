// Voice auto-recap sweep.
//
// POST /api/cron/voice-auto-recap
// Emails automatic recaps for ended voice sessions whose users have
// auto_recap_enabled (Settings > Phone access). Each session is recapped
// at most once; delivery failures are retried on the next sweep.
//
// Auth: header `x-cron-secret: $VOICE_RECAP_CRON_SECRET` (set this env var
// when scheduling the job; the value is never logged or committed).
// Suggested schedule: every 15 minutes via the host's scheduler.

import { getPool } from "../../../graph/db";
import { runAutoRecapSweep } from "../../../../lib/voice/auto-recap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cronAuthorized(req: Request): boolean {
  const secret = process.env.VOICE_RECAP_CRON_SECRET;
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
    const summary = await runAutoRecapSweep(pool);
    return Response.json({ ok: true, ...summary });
  } catch (err) {
    console.error(`[voice-auto-recap] cron failed: ${(err as Error)?.message || err}`);
    return Response.json({ error: "Cron run failed." }, { status: 500 });
  }
}
