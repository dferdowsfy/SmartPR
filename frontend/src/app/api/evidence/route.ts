// Attach an evidence document to an existing obligation from the business
// profile. Stores the file in private Supabase storage and creates the
// evidence row (marked NEEDS_REVIEW — SmartPR has not verified the document).
import { randomUUID } from "crypto";
import { getPool, isEnabled } from "../../graph/db";
import { ensureSchema } from "../../graph/store";
import { getCurrentUser, createSupabaseServer, isAuthConfigured } from "../../../lib/supabase/server";
import { rateLimitAllow } from "../../../lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const safeName = (name: string) => name.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-140) || "document";

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!isEnabled()) return Response.json({ error: "no_database" }, { status: 503 });
  if (!rateLimitAllow(`evidence-create:${user.id}`, 20, 60_000)) {
    return Response.json({ error: "Too many uploads. Try again in a minute." }, { status: 429 });
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Invalid upload." }, { status: 400 });
  }
  const file = form.get("file");
  const obligationId = String(form.get("obligation_id") || "");
  if (!(file instanceof File) || file.size === 0) return Response.json({ error: "A document is required." }, { status: 400 });
  if (!obligationId) return Response.json({ error: "An obligation is required." }, { status: 400 });
  if (file.size > 20 * 1024 * 1024) return Response.json({ error: "Documents must be 20 MB or smaller." }, { status: 413 });
  if (file.type && !ALLOWED_MIME_TYPES.has(file.type)) {
    return Response.json({ error: "Unsupported file type. Upload a PDF, Word/Excel document, or photo." }, { status: 415 });
  }
  if (!isAuthConfigured()) return Response.json({ error: "Supabase Storage is not configured." }, { status: 503 });

  const pool = getPool();
  if (!pool) return Response.json({ error: "no_database" }, { status: 503 });
  await ensureSchema();

  // The obligation must belong to a business the user can access.
  const { rows } = await pool.query<{
    id: string; business_id: string; matter_id: string | null; name: string;
  }>(
    `SELECT o.id, o.business_id, o.matter_id, o.name
       FROM obligations o JOIN businesses b ON b.id = o.business_id
       LEFT JOIN workspace_members wm ON wm.workspace_id = b.workspace_id AND wm.user_id = $2
      WHERE o.id = $1 AND (b.user_id = $2 OR wm.user_id IS NOT NULL) LIMIT 1`,
    [obligationId, user.id]
  );
  const obligation = rows[0];
  if (!obligation) return Response.json({ error: "not_found" }, { status: 404 });

  const supabase = await createSupabaseServer();
  if (!supabase) return Response.json({ error: "Supabase Storage is unavailable." }, { status: 503 });
  const path = `${user.id}/obligations/${obligation.id}/${randomUUID()}/${safeName(file.name)}`;
  const { error } = await supabase.storage.from("evidence").upload(path, file, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });
  if (error) {
    console.error("[evidence] upload", error.message);
    return Response.json({ error: "Evidence storage is not ready. Try again shortly." }, { status: 503 });
  }

  const evidenceId = randomUUID();
  await pool.query(
    `INSERT INTO evidence
       (id, user_id, business_id, matter_id, obligation_id, original_filename,
        storage_path, mime_type, size_bytes, document_type, review_status, extracted_fields)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'NEEDS_REVIEW','{}'::jsonb)`,
    [evidenceId, user.id, obligation.business_id, obligation.matter_id, obligation.id,
      file.name, path, file.type || null, file.size, obligation.name]
  );
  // The user came back with the document — retire the download follow-up nudge.
  await pool.query(
    `UPDATE notifications SET status='CANCELLED'
      WHERE obligation_id=$1 AND type='DOWNLOAD_FOLLOWUP' AND status='PENDING'`,
    [obligation.id]
  );
  return Response.json({ ok: true, evidence_id: evidenceId });
}
