// Professional review of a location's Property & Site Report.
//   GET                 → { review }
//   POST { action }     → applies ONE action (status / note / question); the
//                         server appends the history entry.
// Editing needs an edit-capable role on the business. SmartPR has no
// licensed-professional credential check yet: the actor is recorded by
// account, and "Reviewed" is never a government approval.

import { NO_STORE, resolveBusinessAccess } from "../../../../../../../locations/routeAccess";
import { applyReview, getReview } from "../../../../../../../locations/reportStore";
import { parseReviewAction } from "../../../../../../../locations/propertyReview";
import { getCurrentUser } from "../../../../../../../../lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; locationId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id, locationId } = await ctx.params;
  const r = await resolveBusinessAccess(id);
  if ("error" in r) return r.error;
  return Response.json({ review: await getReview(r.pool, r.business, locationId) }, { headers: NO_STORE });
}

export async function POST(req: Request, ctx: Ctx) {
  const { id, locationId } = await ctx.params;
  const r = await resolveBusinessAccess(id, { write: true });
  if ("error" in r) return r.error;
  let body: { action?: unknown };
  try { body = await req.json(); } catch { return Response.json({ error: "bad_json" }, { status: 400 }); }
  const action = parseReviewAction(body.action);
  if (!action) return Response.json({ error: "invalid_action" }, { status: 400 });
  const user = await getCurrentUser();
  const name = (user?.user_metadata as { full_name?: string } | undefined)?.full_name ?? user?.email ?? null;
  try {
    const result = await applyReview(r.pool, r.business, { id: r.userId, name }, locationId, action);
    if (!result.ok) return Response.json({ error: result.error }, { status: result.error === "not_found" ? 404 : 409 });
    return Response.json({ review: result.review }, { headers: NO_STORE });
  } catch (err) {
    console.error("[site-report-review] failed:", (err as Error).message);
    return Response.json({ error: "save_failed" }, { status: 500 });
  }
}
