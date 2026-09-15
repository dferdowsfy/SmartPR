// Patch locker metadata: requirement tags and/or attach to an obligation
// (reuse without re-upload). Does not move the binary in storage.
import { getPool, isEnabled } from "../../../graph/db";
import { ensureSchema } from "../../../graph/store";
import { getCurrentUser } from "../../../../lib/supabase/server";
import {
  mergeRequirementTags,
  normalizeRequirementTags,
} from "../../../compliance/evidenceLocker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PatchBody {
  requirement_tags?: unknown;
  add_tags?: unknown;
  /** Attach this locker file to an obligation (adds its requirement_id tag). */
  obligation_id?: string | null;
  document_type?: string | null;
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!isEnabled()) return Response.json({ error: "no_database" }, { status: 503 });
  const pool = getPool();
  if (!pool) return Response.json({ error: "no_database" }, { status: 503 });

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  await ensureSchema();

  const { rows } = await pool.query<{
    id: string;
    business_id: string;
    obligation_id: string | null;
    requirement_tags: string[] | null;
    document_type: string | null;
  }>(
    `SELECT e.id, e.business_id, e.obligation_id, e.requirement_tags, e.document_type
       FROM evidence e
       JOIN businesses b ON b.id = e.business_id
       LEFT JOIN workspace_members wm ON wm.workspace_id = b.workspace_id AND wm.user_id = $2
      WHERE e.id = $1 AND (b.user_id = $2 OR wm.user_id IS NOT NULL OR e.user_id = $2)
      LIMIT 1`,
    [id, user.id]
  );
  const row = rows[0];
  if (!row) return Response.json({ error: "not_found" }, { status: 404 });

  let tags = normalizeRequirementTags(row.requirement_tags);
  let obligationId = row.obligation_id;
  let matterId: string | null | undefined = undefined;
  let documentType = row.document_type;

  if (body.requirement_tags !== undefined) {
    tags = normalizeRequirementTags(body.requirement_tags);
  }
  if (body.add_tags !== undefined) {
    tags = mergeRequirementTags(tags, body.add_tags);
  }

  if (body.obligation_id !== undefined && body.obligation_id !== null && body.obligation_id !== "") {
    const { rows: oblRows } = await pool.query<{
      id: string; business_id: string; matter_id: string | null; name: string; requirement_id: string | null;
    }>(
      `SELECT o.id, o.business_id, o.matter_id, o.name, o.requirement_id
         FROM obligations o
         JOIN businesses b ON b.id = o.business_id
         LEFT JOIN workspace_members wm ON wm.workspace_id = b.workspace_id AND wm.user_id = $3
        WHERE o.id = $1 AND o.business_id = $2 AND (b.user_id = $3 OR wm.user_id IS NOT NULL)
        LIMIT 1`,
      [body.obligation_id, row.business_id, user.id]
    );
    const obl = oblRows[0];
    if (!obl) return Response.json({ error: "obligation_not_found" }, { status: 404 });
    // Keep prior obligation_id if already set — tags carry multi-requirement reuse.
    if (!obligationId) obligationId = obl.id;
    matterId = obl.matter_id;
    if (obl.requirement_id) tags = mergeRequirementTags(tags, [obl.requirement_id]);
    if (!documentType) documentType = obl.name;
    await pool.query(
      `UPDATE notifications SET status='CANCELLED'
        WHERE obligation_id=$1 AND type='DOWNLOAD_FOLLOWUP' AND status='PENDING'`,
      [obl.id]
    );
  }

  if (typeof body.document_type === "string") {
    documentType = body.document_type.trim() || documentType;
  }

  const { rows: updated } = await pool.query(
    `UPDATE evidence SET
       requirement_tags = $2::text[],
       obligation_id = COALESCE($3::uuid, obligation_id),
       matter_id = COALESCE($4::uuid, matter_id),
       document_type = COALESCE($5, document_type)
     WHERE id = $1
     RETURNING id, business_id, obligation_id, original_filename, mime_type, size_bytes,
               document_type, review_status, requirement_tags, created_at, storage_path`,
    [id, tags, obligationId, matterId ?? null, documentType]
  );

  return Response.json({ ok: true, evidence: updated[0] });
}
