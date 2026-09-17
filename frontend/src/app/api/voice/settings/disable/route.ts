// Disable Phone Access (web-session authenticated).
// POST /api/voice/settings/disable {}
// Turns phone access off and revokes every outstanding voice session.
// Re-enabling is done by enrolling again.

import { getPool, isEnabled } from "../../../../graph/db";
import { getCurrentUser } from "../../../../../lib/supabase/server";
import { logVoiceAudit } from "../../../../../lib/voice/audit";
import { clientIp } from "../../_util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!isEnabled()) return Response.json({ error: "no_database" }, { status: 503 });
  const pool = getPool();
  if (!pool) return Response.json({ error: "no_database" }, { status: 503 });

  const { rows } = await pool.query<{ phone_e164: string }>(
    `SELECT phone_e164 FROM voice_access WHERE user_id = $1 LIMIT 1`,
    [user.id]
  );
  const row = rows[0];
  if (!row) return Response.json({ ok: true, enrolled: false });

  await pool.query(`UPDATE voice_access SET enabled = false, updated_at = now() WHERE user_id = $1`, [
    user.id,
  ]);
  await pool.query(
    `UPDATE voice_sessions SET revoked_at = now(), revoke_reason = 'access_disabled'
      WHERE user_id = $1 AND revoked_at IS NULL`,
    [user.id]
  );
  await logVoiceAudit(pool, {
    userId: user.id,
    phoneE164: row.phone_e164,
    action: "disabled",
    ip: clientIp(request),
  });
  return Response.json({ ok: true, enabled: false });
}
