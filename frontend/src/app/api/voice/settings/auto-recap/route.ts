// Phone Access auto-recap preference API (web-session authenticated).
// POST /api/voice/settings/auto-recap { enabled: boolean }

import { getPool, isEnabled } from "../../../../graph/db";
import { getCurrentUser } from "../../../../../lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!isEnabled()) return Response.json({ error: "no_database" }, { status: 503 });
  const pool = getPool();
  if (!pool) return Response.json({ error: "no_database" }, { status: 503 });

  let enabled: unknown;
  try {
    ({ enabled } = (await req.json()) as { enabled?: unknown });
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }
  if (typeof enabled !== "boolean") {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  const { rowCount } = await pool.query(
    `UPDATE voice_access SET auto_recap_enabled = $2, updated_at = now()
      WHERE user_id = $1`,
    [user.id, enabled]
  );
  if (!rowCount) {
    return Response.json({ error: "not_enrolled" }, { status: 404 });
  }
  return Response.json({ ok: true, auto_recap_enabled: enabled });
}
