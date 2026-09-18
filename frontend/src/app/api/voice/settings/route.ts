// Phone Access settings API (web-session authenticated).
// GET /api/voice/settings -> enrollment status for the signed-in user.

import { getPool, isEnabled } from "../../../graph/db";
import { getCurrentUser } from "../../../../lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface VoiceAccessRow {
  phone_display: string;
  enabled: boolean;
  last_verified_at: string | null;
  locked_until: string | null;
  updated_at: string;
  auto_recap_enabled?: boolean | null;
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!isEnabled()) return Response.json({ error: "no_database" }, { status: 503 });
  const pool = getPool();
  if (!pool) return Response.json({ error: "no_database" }, { status: 503 });

  // The auto_recap_enabled column arrives with the voice auto-recap
  // migration; fall back gracefully if it has not been applied yet.
  let rows: VoiceAccessRow[] = [];
  try {
    const res = await pool.query<VoiceAccessRow>(
      `SELECT phone_display, enabled, last_verified_at, locked_until, updated_at,
              auto_recap_enabled
         FROM voice_access WHERE user_id = $1 LIMIT 1`,
      [user.id]
    );
    rows = res.rows;
  } catch {
    const res = await pool.query<VoiceAccessRow>(
      `SELECT phone_display, enabled, last_verified_at, locked_until, updated_at
         FROM voice_access WHERE user_id = $1 LIMIT 1`,
      [user.id]
    );
    rows = res.rows;
  }
  const row = rows[0];
  if (!row) {
    return Response.json({ enrolled: false, enabled: false });
  }
  return Response.json({
    enrolled: true,
    enabled: row.enabled,
    phone_display: row.phone_display,
    last_verified_at: row.last_verified_at,
    locked: row.locked_until ? new Date(row.locked_until).getTime() > Date.now() : false,
    updated_at: row.updated_at,
    auto_recap_enabled: row.auto_recap_enabled ?? true,
  });
}
