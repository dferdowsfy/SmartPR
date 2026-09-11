import { randomUUID } from "crypto";
import { getPool } from "../../../../graph/db";
import { ensureSchema } from "../../../../graph/store";
import { getCurrentUser } from "../../../../../lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Records that the user opened a requirement's official download/filing
 * destination in a new tab, and schedules a one-time in-app nudge three days
 * out — the return path that brings them back to upload the finished document.
 * The nudge is cancelled automatically when evidence is uploaded for the
 * obligation or the obligation is marked complete.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const pool = getPool();
  if (!pool) return Response.json({ error: "Database unavailable." }, { status: 503 });

  await ensureSchema();
  const current = (await pool.query<{
    id: string; status: string; name: string; business_id: string;
    business_name: string; has_evidence: boolean;
  }>(
    `SELECT o.id, o.status, o.name, o.business_id,
            COALESCE(b.legal_name, b.name) AS business_name,
            EXISTS (SELECT 1 FROM evidence e WHERE e.obligation_id=o.id) AS has_evidence
       FROM obligations o JOIN businesses b ON b.id=o.business_id
      WHERE o.id=$1 AND (b.user_id=$2 OR EXISTS (
        SELECT 1 FROM workspace_members wm WHERE wm.workspace_id=b.workspace_id AND wm.user_id=$2))`,
    [id, user.id]
  )).rows[0];
  if (!current) return Response.json({ error: "not_found" }, { status: 404 });

  await pool.query(`UPDATE obligations SET downloaded_at=now(), updated_at=now() WHERE id=$1`, [id]);

  // One live nudge at a time; a fresh download resets the clock.
  await pool.query(
    `UPDATE notifications SET status='CANCELLED'
      WHERE obligation_id=$1 AND type='DOWNLOAD_FOLLOWUP' AND status='PENDING'`,
    [id]
  );

  // No nudge needed when the requirement is already satisfied.
  if (current.status !== "COMPLETED" && !current.has_evidence) {
    const scheduledFor = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    await pool.query(
      `INSERT INTO notifications
         (id, user_id, workspace_id, business_id, obligation_id, type, scheduled_for, message)
       SELECT $1, $2, b.workspace_id, o.business_id, o.id, 'DOWNLOAD_FOLLOWUP', $3, $4
         FROM obligations o JOIN businesses b ON b.id=o.business_id
        WHERE o.id=$5`,
      [
        randomUUID(),
        user.id,
        scheduledFor,
        `You opened the official ${current.name} form for ${current.business_name} — upload the finished document when it's ready.`,
        id,
      ]
    );
  }
  return Response.json({ ok: true });
}
