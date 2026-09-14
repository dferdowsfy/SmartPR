// Notification-preference API for the Settings UI.
// GET  /api/notifications/preferences        → my email preferences
// POST /api/notifications/preferences        → upsert one preference
//   { scope: 'global'|'business'|'obligation', business_id?, obligation_id?, muted: boolean }
import { getPool } from "../../../graph/db";
import { getCurrentUser } from "../../../../lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SCOPES = new Set(["global", "business", "obligation"]);

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const pool = getPool();
  if (!pool) return Response.json({ error: "Database unavailable." }, { status: 503 });
  const { rows } = await pool.query(
    `SELECT scope, business_id, obligation_id, muted
       FROM notification_preferences
      WHERE user_id = $1 AND channel = 'EMAIL'`,
    [user.id]
  );
  return Response.json({ preferences: rows });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const pool = getPool();
  if (!pool) return Response.json({ error: "Database unavailable." }, { status: 503 });
  let body: { scope?: string; business_id?: string; obligation_id?: string; muted?: boolean };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const scope = body.scope || "";
  if (!SCOPES.has(scope)) return Response.json({ error: "Invalid scope." }, { status: 400 });
  const businessId = scope === "business" ? body.business_id || null : null;
  const obligationId = scope === "obligation" ? body.obligation_id || null : null;
  if (scope === "business" && !businessId) return Response.json({ error: "business_id required." }, { status: 400 });
  if (scope === "obligation" && !obligationId) return Response.json({ error: "obligation_id required." }, { status: 400 });
  const muted = body.muted !== false;
  // Verify the business/obligation belongs to this user before writing.
  if (businessId) {
    const ok = await pool.query(
      `SELECT 1 FROM businesses b
        LEFT JOIN workspace_members wm ON wm.workspace_id = b.workspace_id AND wm.user_id = $2
       WHERE b.id = $1 AND (b.user_id = $2 OR wm.user_id IS NOT NULL) LIMIT 1`,
      [businessId, user.id]
    );
    if (!ok.rows[0]) return Response.json({ error: "not_found" }, { status: 404 });
  }
  if (obligationId) {
    const ok = await pool.query(
      `SELECT 1 FROM obligations o
         JOIN businesses b ON b.id = o.business_id
         LEFT JOIN workspace_members wm ON wm.workspace_id = b.workspace_id AND wm.user_id = $2
       WHERE o.id = $1 AND (b.user_id = $2 OR wm.user_id IS NOT NULL) LIMIT 1`,
      [obligationId, user.id]
    );
    if (!ok.rows[0]) return Response.json({ error: "not_found" }, { status: 404 });
  }
  await pool.query(
    `INSERT INTO notification_preferences (user_id, scope, business_id, obligation_id, channel, muted, updated_at)
     VALUES ($1, $2, $3, $4, 'EMAIL', $5, now())
     ON CONFLICT (user_id, scope, business_id, obligation_id, channel)
     DO UPDATE SET muted = EXCLUDED.muted, updated_at = now()`,
    [user.id, scope, businessId, obligationId, muted]
  );
  return Response.json({ updated: true });
}
