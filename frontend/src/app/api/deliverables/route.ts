// The deliverables screen archives generated files (readiness report PDF /
// submission ZIP) for signed-in users. The bytes are uploaded to the private
// `deliverables` Supabase Storage bucket, namespaced by the uploading user's
// own id, and the `deliverables` table row is only written once that upload
// succeeds — so a row never claims to have archived a file that isn't there.
// Anonymous calls are a polite no-op so the client's fire-and-forget archive
// never breaks the user flow.

import { randomUUID } from "crypto";
import { getPool, isEnabled } from "../../graph/db";
import { ensureSchema } from "../../graph/store";
import { createSupabaseServer, getCurrentUser } from "../../../lib/supabase/server";
import { rateLimitAllow } from "../../../lib/rateLimit";
import { userCanAccessBusiness } from "../../compliance/server";
import { uploadDeliverable } from "../../forms/artifacts/storage.ts";
import { ensureUserWorkspace } from "../../compliance/server";
import { assertCanUseDeliverables, gateJson } from "../../../lib/billing/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_KINDS = new Set(["report", "zip", "submission"]);
const MAX_BYTES = 20 * 1024 * 1024;
const safeName = (name: string) => name.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-140) || "deliverable";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ archived: false, reason: "anonymous" });
  if (!isEnabled()) return Response.json({ archived: false, reason: "no_database" });
  const pool = getPool();
  if (!pool) return Response.json({ archived: false, reason: "no_database" });
  if (!rateLimitAllow(`deliverable-archive:${user.id}`, 20, 60_000)) {
    return Response.json({ archived: false, reason: "rate_limited" }, { status: 429 });
  }

  let kind = "report";
  let file: File | null = null;
  let submissionId: string | null = null;
  let businessId: string | null = null;
  try {
    const fd = await req.formData();
    const requestedKind = String(fd.get("kind") || "report");
    kind = ALLOWED_KINDS.has(requestedKind) ? requestedKind : "report";
    submissionId = (fd.get("submission_id") as string) || null;
    businessId = (fd.get("business_id") as string) || null;
    const candidate = fd.get("file");
    if (candidate instanceof File) file = candidate;
  } catch {
    return Response.json({ archived: false, reason: "bad_form" }, { status: 400 });
  }
  if (!file || file.size === 0) return Response.json({ archived: false, reason: "no_file" }, { status: 400 });
  if (file.size > MAX_BYTES) return Response.json({ archived: false, reason: "too_large" }, { status: 413 });

  await ensureSchema();
  // A business id must belong to the caller — never take a client's word for
  // whose records a deliverable gets filed under.
  if (businessId && !(await userCanAccessBusiness(pool, user.id, businessId))) {
    return Response.json({ archived: false, reason: "business_not_found" }, { status: 404 });
  }

  try {
    const workspaceId = businessId
      ? (
          await pool.query<{ workspace_id: string | null }>(
            `SELECT workspace_id FROM businesses WHERE id = $1 LIMIT 1`,
            [businessId]
          )
        ).rows[0]?.workspace_id
      : null;
    const ws = workspaceId || (await ensureUserWorkspace(pool, user));
    await assertCanUseDeliverables(pool, { workspaceId: ws, email: user.email });
  } catch (gateErr) {
    const gated = gateJson(gateErr);
    if (gated) return gated;
    throw gateErr;
  }

  const supabase = await createSupabaseServer();
  if (!supabase) return Response.json({ archived: false, reason: "storage_unavailable" }, { status: 503 });

  const deliverableId = randomUUID();
  const filename = safeName(file.name || "deliverable");
  let storagePath: string;
  try {
    const ref = await uploadDeliverable(
      supabase,
      { userId: user.id, deliverableId, fileName: filename },
      await file.arrayBuffer(),
      file.type || "application/octet-stream"
    );
    storagePath = `${ref.bucket}/${ref.objectPath}`;
  } catch (err) {
    console.error("[deliverables] storage upload failed:", (err as Error).message);
    return Response.json({ archived: false, reason: "storage_upload_failed" }, { status: 503 });
  }

  try {
    await pool.query(
      `INSERT INTO deliverables (id, user_id, business_id, submission_id, kind, filename, storage_path, size_bytes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [deliverableId, user.id, businessId, submissionId, kind, filename, storagePath, file.size]
    );
    return Response.json({ archived: true, id: deliverableId });
  } catch (err) {
    console.error("[deliverables] archive failed:", (err as Error).message);
    return Response.json({ archived: false, reason: "insert_failed" }, { status: 500 });
  }
}
