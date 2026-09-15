/**
 * GET /api/agency-runs/[id] — run + events (poll advances the mock timeline).
 */
import { getRun } from "../../../../lib/agency-runs/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const run = getRun(id);
  if (!run) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ run });
}
