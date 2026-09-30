/** POST /api/skills/[id]/submit — owner sends a private draft for review (locks it). */
import { submitForReview } from "../../../../../lib/agency-runs/skills/skillLibrary";
import { currentViewer, errorResponse, skillRepo, unauthorized } from "../../../../../lib/agency-runs/teach/routeContext";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const viewer = await currentViewer();
  if (!viewer) return unauthorized();
  const { id } = await ctx.params;
  try {
    const row = await submitForReview(await skillRepo(), viewer, id);
    return Response.json({ skill: { id: row.id, status: row.status } });
  } catch (err) {
    return errorResponse(err);
  }
}
