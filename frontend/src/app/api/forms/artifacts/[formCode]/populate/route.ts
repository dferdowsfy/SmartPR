// Populate a working copy of a government artifact.
// POST { profile, businessId?, instanceId?, archive? } -> application/pdf
//
// The canonical template is read-only input. Genericized municipal templates
// are refused here: they are not any municipality's official form.
import { randomUUID } from "node:crypto";

import { createSupabaseServer, getCurrentUser } from "../../../../../../lib/supabase/server";
import { getPool } from "../../../../../graph/db";
import { ensureUserWorkspace, userCanAccessBusiness } from "../../../../../compliance/server";
import { assertCanUseDeliverables, gateJson } from "../../../../../../lib/billing/access";
import { ArtifactGenerationError, generateWorkingCopy } from "../../../../../forms/artifacts/library";
import { recordGeneratedFiling } from "../../../../../forms/artifacts/persistence";
import { emptyCanonicalData, type CanonicalApplicationData, type FormData } from "../../../../../forms/engine/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, ctx: { params: Promise<{ formCode: string }> }) {
  const { formCode } = await ctx.params;
  // Filled government forms are a paid deliverable: the free tier covers the
  // assessment and the requirements checklist, but generating the populated
  // official PDF requires a plan with the deliverables entitlement.
  // NOTE: admins are resolved via isUserAdmin() (ADMIN_EMAILS env var or the
  // admin_allowlist table). While no admin is configured anywhere, every
  // signed-in user is treated as an admin (open default).
  const user = await getCurrentUser();
  const pool = getPool();
  if (!user) {
    return Response.json(
      {
        error: "Create a free account and choose a plan to generate filled government forms.",
        code: "auth_required",
        upgradeUrl: "/pricing",
      },
      { status: 402 }
    );
  }
  if (pool) {
    try {
      const workspaceId = await ensureUserWorkspace(pool, user);
      await assertCanUseDeliverables(pool, { workspaceId, email: user.email });
    } catch (err) {
      const gated = gateJson(err);
      if (gated) return gated;
      throw err;
    }
  }

  let body: { profile?: Partial<CanonicalApplicationData>; formData?: FormData; businessId?: string; instanceId?: string; archive?: boolean };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  const profile = { ...emptyCanonicalData(), ...(body.profile ?? {}) } as CanonicalApplicationData;
  let result;
  try {
    result = await generateWorkingCopy({ formCode, profile, formData: body.formData, purpose: "filing" });
  } catch (error) {
    const status = error instanceof ArtifactGenerationError ? 409 : 500;
    return Response.json({ error: (error as Error).message }, { status });
  }

  const warnings: string[] = [];
  let archived = false;
  if (body.archive && body.businessId && user) {
    const owns = pool ? await userCanAccessBusiness(pool, user.id, body.businessId) : false;
    if (!owns) {
      warnings.push("Not archived: this business does not belong to your account.");
    } else {
      const outcome = await recordGeneratedFiling({
        tenantId: user.id,
        businessId: body.businessId,
        userId: user.id,
        instanceId: body.instanceId ?? randomUUID(),
        formCode,
        result,
        profile,
        storageClient: await createSupabaseServer(),
      });
      warnings.push(...outcome.warnings);
      archived = outcome.persisted && Boolean(outcome.storagePath);
    }
  } else if (body.archive && !user) {
    warnings.push("Not archived: sign in to save this filing to your account.");
  }

  return new Response(Buffer.from(result.bytes), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${formCode}-prepared.pdf"`,
      "cache-control": "no-store",
      "x-smartpr-populated-fields": String(result.populated.length),
      "x-smartpr-unanswered-fields": String(result.unanswered.length),
      "x-smartpr-template-checksum": result.templateChecksum,
      ...(body.archive ? { "x-smartpr-archived": String(archived) } : {}),
      ...(warnings.length ? { "x-smartpr-warnings": warnings.join(" | ").slice(0, 400) } : {}),
    },
  });
}
