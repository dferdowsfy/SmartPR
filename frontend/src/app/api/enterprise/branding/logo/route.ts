// POST /api/enterprise/branding/logo — secure logo upload (Phase 8).
//
// Two-step flow: this endpoint validates and stores the file in the private
// `brand-assets` bucket (path `{workspace_id}/{kind}-{timestamp}.{ext}`) and
// returns a signed preview URL. Publishing happens via
// PUT /api/enterprise/branding, which only accepts paths in the shape this
// endpoint produces for the same workspace.
//
// Gate: platform super admin OR `configure_branding_security` enterprise
// permission. Storage RLS additionally restricts the bucket to workspace
// members, so a super admin who is not a member cannot upload (clear error).

import { randomUUID } from "node:crypto";
import { getPool } from "../../../../../app/graph/db";
import { createSupabaseServer, isAuthConfigured } from "../../../../../lib/supabase/server";
import { rateLimitAllow } from "../../../../../lib/rateLimit";
import { requireBrandingSecurity } from "../../../../../lib/enterprise-gate";
import {
  isLogoKind,
  logoExtensionForMime,
  MAX_LOGO_BYTES,
  type LogoKind,
} from "../../../../../lib/enterprise-branding";
import { writeAuditEvent, getRequestMeta } from "../../../../../lib/enterprise-permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIGNED_URL_TTL_SECONDS = 3600;

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const workspaceId = typeof form?.get("workspace_id") === "string"
    ? (form.get("workspace_id") as string)
    : "";
  const gate = await requireBrandingSecurity(workspaceId);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  if (!rateLimitAllow(`brand-logo-upload:${user.id}`, 20, 60_000)) {
    return Response.json({ error: "Too many uploads. Try again in a minute." }, { status: 429 });
  }

  const kindRaw = form?.get("kind");
  if (!isLogoKind(kindRaw)) {
    return Response.json(
      { error: "kind must be one of: primary, compact, favicon" },
      { status: 400 }
    );
  }
  const kind: LogoKind = kindRaw;

  const candidate = form?.get("file");
  const file = candidate instanceof File ? candidate : null;
  if (!file || file.size === 0) {
    return Response.json({ error: "A logo file is required." }, { status: 400 });
  }
  if (file.size > MAX_LOGO_BYTES) {
    return Response.json({ error: "Logo files must be 2 MB or smaller." }, { status: 413 });
  }
  if (!file.type || !file.type.toLowerCase().startsWith("image/")) {
    return Response.json({ error: "Only image files are accepted." }, { status: 415 });
  }
  const ext = logoExtensionForMime(file.type);
  if (!ext) {
    return Response.json({ error: `Unsupported image type: ${file.type}` }, { status: 415 });
  }

  if (!isAuthConfigured()) {
    return Response.json({ error: "Supabase Storage is not configured." }, { status: 503 });
  }
  const supabase = await createSupabaseServer();
  if (!supabase) {
    return Response.json({ error: "Supabase Storage is unavailable." }, { status: 503 });
  }

  const path = `${workspaceId}/${kind}-${Date.now()}-${randomUUID().slice(0, 8)}.${ext}`;
  const { error: uploadError } = await supabase.storage
    .from("brand-assets")
    .upload(path, file, { contentType: file.type, upsert: false });
  if (uploadError) {
    // Most likely cause: the caller is a super admin who is not a member of
    // this workspace (bucket RLS is member-only by design).
    console.error("[brand-logo-upload]", uploadError.message);
    return Response.json(
      {
        error:
          "Upload was rejected by storage. Workspace members with branding permission can upload; " +
          "a super admin must be a workspace member to upload logos.",
      },
      { status: 403 }
    );
  }

  const { data: signed, error: signError } = await supabase.storage
    .from("brand-assets")
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (signError || !signed?.signedUrl) {
    console.error("[brand-logo-sign]", signError?.message);
    return Response.json({ error: "Upload succeeded but a preview URL could not be issued." }, { status: 500 });
  }

  const meta = getRequestMeta(request);
  await writeAuditEvent(getPool(), {
    actorUserId: user.id,
    workspaceId,
    action: "enterprise.branding.logo_upload",
    targetType: "workspace_branding",
    targetId: workspaceId,
    before: null,
    after: { kind, path, size_bytes: file.size, mime_type: file.type },
    ip: meta.ip,
    userAgent: meta.userAgent,
    correlationId: meta.correlationId,
    source: "api",
  });

  return Response.json({
    kind,
    path,
    preview_url: signed.signedUrl,
    expires_in: SIGNED_URL_TTL_SECONDS,
  });
}
