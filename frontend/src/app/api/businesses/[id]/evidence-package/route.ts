// Build a filing-ready ZIP of locker evidence attached (by link or tag) to
// this business's requirements. Preparation only — never submits to a portal.
import JSZip from "jszip";
import { getPool, isEnabled } from "../../../../graph/db";
import { ensureSchema, resolveBusinessUuid } from "../../../../graph/store";
import { createSupabaseServer, getCurrentUser } from "../../../../../lib/supabase/server";
import { userCanAccessBusiness } from "../../../../compliance/server";
import {
  packageEvidenceManifest,
  selectPackageEvidence,
  type LockerEvidence,
  type ObligationRef,
} from "../../../../compliance/evidenceLocker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!isEnabled()) return Response.json({ error: "no_database" }, { status: 503 });
  const pool = getPool();
  if (!pool) return Response.json({ error: "no_database" }, { status: 503 });
  await ensureSchema();

  const businessUuid = await resolveBusinessUuid(pool, id);
  if (!businessUuid || !(await userCanAccessBusiness(pool, user.id, businessUuid))) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const [oblRes, evRes, bizRes] = await Promise.all([
    pool.query<{ id: string; requirement_id: string | null; name: string; status: string }>(
      `SELECT id, requirement_id, name, status FROM obligations WHERE business_id=$1 ORDER BY created_at`,
      [businessUuid]
    ),
    pool.query<LockerEvidence>(
      `SELECT id, original_filename, mime_type, size_bytes, document_type, review_status,
              obligation_id, requirement_tags, created_at, storage_path
         FROM evidence WHERE business_id=$1 ORDER BY created_at DESC`,
      [businessUuid]
    ),
    pool.query<{ name: string; legal_name: string | null }>(
      `SELECT name, legal_name FROM businesses WHERE id=$1`,
      [businessUuid]
    ),
  ]);

  const obligations: ObligationRef[] = oblRes.rows;
  const entries = selectPackageEvidence(evRes.rows, obligations);
  const manifest = {
    generatedAt: new Date().toISOString(),
    businessId: businessUuid,
    businessName: bizRes.rows[0]?.legal_name || bizRes.rows[0]?.name || null,
    disclaimer:
      "SmartPR prepares this evidence package for filing readiness only. " +
      "It does not submit documents to any government portal and does not certify legal sufficiency.",
    evidence: packageEvidenceManifest(entries),
  };

  const zip = new JSZip();
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));

  const supabase = await createSupabaseServer();
  if (!supabase && entries.some((e) => e.storagePath)) {
    return Response.json({ error: "storage_unavailable" }, { status: 503 });
  }

  for (const entry of entries) {
    if (!entry.storagePath || !supabase) {
      zip.file(
        `${entry.zipPath}.missing.txt`,
        `Binary unavailable for ${entry.filename} (${entry.evidenceId}).`
      );
      continue;
    }
    const { data, error } = await supabase.storage.from("evidence").download(entry.storagePath);
    if (error || !data) {
      console.error("[evidence-package] download", entry.evidenceId, error?.message);
      zip.file(
        `${entry.zipPath}.missing.txt`,
        `Could not read storage for ${entry.filename}.`
      );
      continue;
    }
    const buf = Buffer.from(await data.arrayBuffer());
    zip.file(entry.zipPath, buf);
  }

  const blob = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  const safe = (bizRes.rows[0]?.legal_name || bizRes.rows[0]?.name || "business")
    .replace(/[^a-z0-9]+/gi, "-")
    .toLowerCase()
    .slice(0, 60) || "business";
  return new Response(new Uint8Array(blob), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="smartpr-evidence-${safe}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}

/** JSON-only preview of what the ZIP would include (no binaries). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!isEnabled()) return Response.json({ error: "no_database" }, { status: 503 });
  const pool = getPool();
  if (!pool) return Response.json({ error: "no_database" }, { status: 503 });
  await ensureSchema();

  const businessUuid = await resolveBusinessUuid(pool, id);
  if (!businessUuid || !(await userCanAccessBusiness(pool, user.id, businessUuid))) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const [oblRes, evRes] = await Promise.all([
    pool.query<{ id: string; requirement_id: string | null; name: string; status: string }>(
      `SELECT id, requirement_id, name, status FROM obligations WHERE business_id=$1`,
      [businessUuid]
    ),
    pool.query<LockerEvidence>(
      `SELECT id, original_filename, mime_type, size_bytes, document_type, review_status,
              obligation_id, requirement_tags, created_at, storage_path
         FROM evidence WHERE business_id=$1 ORDER BY created_at DESC`,
      [businessUuid]
    ),
  ]);
  const entries = selectPackageEvidence(evRes.rows, oblRes.rows);
  return Response.json({
    evidence: packageEvidenceManifest(entries),
    lockerCount: evRes.rows.length,
  });
}
