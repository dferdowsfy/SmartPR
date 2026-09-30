/** GET /api/replays/[id] — the replay's plan, status, pause and milestones (no values). */
import { getReplaySession } from "../../../../lib/agency-runs/replay/replaySessions";
import { currentViewer, errorResponse, unauthorized } from "../../../../lib/agency-runs/teach/routeContext";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const viewer = await currentViewer();
  if (!viewer) return unauthorized();
  const { id } = await ctx.params;
  try {
    return Response.json({ replay: getReplaySession(viewer, id) });
  } catch (err) {
    return errorResponse(err);
  }
}
