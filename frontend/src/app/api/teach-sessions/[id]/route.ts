/** GET /api/teach-sessions/[id] — pull new recorder events and return the session view. */
import { currentViewer, errorResponse, unauthorized, workerDeps } from "../../../../lib/agency-runs/teach/routeContext";
import { syncTeachSession } from "../../../../lib/agency-runs/teach/teachSessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const viewer = await currentViewer();
  if (!viewer) return unauthorized();
  const { id } = await ctx.params;
  try {
    return Response.json({ session: await syncTeachSession(workerDeps, viewer, id) });
  } catch (err) {
    return errorResponse(err);
  }
}
