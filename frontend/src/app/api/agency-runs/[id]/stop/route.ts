/**
 * POST /api/agency-runs/[id]/stop — halt the mock agency run.
 */
import { stopRun } from "../../../../../lib/agency-runs/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const run = stopRun(id);
  if (!run) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ run });
}
