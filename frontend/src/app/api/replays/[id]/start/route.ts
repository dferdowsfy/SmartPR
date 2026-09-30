/** POST /api/replays/[id]/start — the person confirmed the plan: open the replay browser and go until the first pause. */
import { startReplaySession } from "../../../../../lib/agency-runs/replay/replaySessions";
import { currentViewer, errorResponse, replayDeps, unauthorized } from "../../../../../lib/agency-runs/teach/routeContext";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const viewer = await currentViewer();
  if (!viewer) return unauthorized();
  const { id } = await ctx.params;
  try {
    return Response.json({ replay: await startReplaySession(await replayDeps(), viewer, id ) });
  } catch (err) {
    return errorResponse(err);
  }
}
