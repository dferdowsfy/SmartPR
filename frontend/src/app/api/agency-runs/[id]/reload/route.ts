/**
 * POST /api/agency-runs/[id]/reload — reload the portal page inside the live
 * browser. Queues a short agent turn that only refreshes the page and reports
 * what it shows; pause state is preserved.
 */
import { assertRunOwner, peekRun, reloadPageRun } from "../../../../../lib/agency-runs/store";
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

  const run = await reloadPageRun(id);
  if (!run) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ run });
}
