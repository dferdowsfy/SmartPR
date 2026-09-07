// Signed, ownership-checked download for an archived deliverable. Never signs
// a URL for a row the requesting user does not own.

import { getPool, isEnabled } from "../../../../graph/db";
import { createSupabaseServer, getCurrentUser } from "../../../../../lib/supabase/server";
import { parseStoragePath, signedFilingUrl } from "../../../../forms/artifacts/storage.ts";
import { ensureUserWorkspace } from "../../../../compliance/server";
import { assertCanUseDeliverables, gateJson } from "../../../../../lib/billing/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!isEnabled()) return Response.json({ error: "no_database" }, { status: 503 });
  const pool = getPool();
  if (!pool) return Response.json({ error: "no_database" }, { status: 503 });

  try {
    const ws = await ensureUserWorkspace(pool, user);
    await assertCanUseDeliverables(pool, { workspaceId: ws, email: user.email });
  } catch (gateErr) {
    const gated = gateJson(gateErr);
    if (gated) return gated;
    throw gateErr;
  }

  const { rows } = await pool.query<{ storage_path: string; filename: string }>(
    `SELECT storage_path, filename FROM deliverables WHERE id = $1 AND user_id = $2`,
    [id, user.id]
  );
  const row = rows[0];
  if (!row || !row.storage_path || row.storage_path.startsWith("pending-storage/")) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const supabase = await createSupabaseServer();
  if (!supabase) return Response.json({ error: "storage_unavailable" }, { status: 503 });
  try {
    const url = await signedFilingUrl(supabase, parseStoragePath(row.storage_path), 300);
    return Response.json({ url, filename: row.filename });
  } catch (err) {
    console.error("[deliverables-download]", (err as Error).message);
    return Response.json({ error: "sign_failed" }, { status: 503 });
  }
}
