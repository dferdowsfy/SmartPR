/** POST /api/replays/[id]/continue { answers? } — the person did their part (or answered Clara's questions): keep going. */
import { continueReplaySession } from "../../../../../lib/agency-runs/replay/replaySessions";
import { currentViewer, errorResponse, replayDeps, unauthorized } from "../../../../../lib/agency-runs/teach/routeContext";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const viewer = await currentViewer();
  if (!viewer) return unauthorized();
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { answers?: Record<string, string> };
  try {
    return Response.json({ replay: await continueReplaySession(await replayDeps(), viewer, id, body.answers && typeof body.answers === "object" ? body.answers : {}) });
  } catch (err) {
    return errorResponse(err);
  }
}
