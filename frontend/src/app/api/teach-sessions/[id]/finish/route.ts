/**
 * POST /api/teach-sessions/[id]/finish — stop recording (closes the worker
 * browser) and return the skill-card preview, with anything that still
 * blocks saving. GET returns the preview without stopping.
 */
import { currentViewer, errorResponse, unauthorized, workerDeps } from "../../../../../lib/agency-runs/teach/routeContext";
import { finishTeachSession, previewTeachSession } from "../../../../../lib/agency-runs/teach/teachSessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const viewer = await currentViewer();
  if (!viewer) return unauthorized();
  const { id } = await ctx.params;
  try {
    return Response.json(await finishTeachSession(workerDeps, viewer, id));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const viewer = await currentViewer();
  if (!viewer) return unauthorized();
  const { id } = await ctx.params;
  try {
    return Response.json(previewTeachSession(viewer, id));
  } catch (err) {
    return errorResponse(err);
  }
}
