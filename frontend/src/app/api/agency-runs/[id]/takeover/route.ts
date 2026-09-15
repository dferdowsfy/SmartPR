/**
 * POST /api/agency-runs/[id]/takeover — log that the user took over the live
 * browser. Run status is unchanged; this only appends a step-log event so
 * the on-screen notifications reflect the handoff.
 */
import { assertRunOwner, peekRun, takeoverRun } from "../../../../../lib/agency-runs/store";
import { getCurrentUser } from "../../../../../lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const peek = peekRun(id);
  if (!peek) return Response.json({ error: "not_found" }, { status: 404 });

  const user = await getCurrentUser();
  if (!assertRunOwner(peek, user?.id ?? null)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const run = takeoverRun(id);
  if (!run) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ run });
}
