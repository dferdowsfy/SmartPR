/** POST /api/replays/[id]/stop — close the replay browser; the person can finish by hand. */
import { stopReplaySession } from "../../../../../lib/agency-runs/replay/replaySessions";
import { currentViewer, errorResponse, replayDeps, unauthorized } from "../../../../../lib/agency-runs/teach/routeContext";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const viewer = await currentViewer();
  if (!viewer) return unauthorized();
  const { id } = await ctx.params;
  try {
    return Response.json({ replay: await stopReplaySession(await replayDeps(), viewer, id ) });
  } catch (err) {
    return errorResponse(err);
  }
}
