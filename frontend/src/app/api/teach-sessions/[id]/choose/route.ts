/**
 * POST /api/teach-sessions/[id]/choose { selector, option } — pick one of a
 * screen question's options on the live page, just this time (not saved to
 * the Business Passport). For dropdowns the live view can't open.
 */
import { currentViewer, errorResponse, unauthorized, workerDeps } from "../../../../../lib/agency-runs/teach/routeContext";
import { chooseOnceTeach } from "../../../../../lib/agency-runs/teach/teachSessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const viewer = await currentViewer();
  if (!viewer) return unauthorized();
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { selector?: unknown; option?: unknown };
  try {
    return Response.json(await chooseOnceTeach(workerDeps, viewer, id, { selector: typeof body.selector === "string" ? body.selector : "", option: typeof body.option === "string" ? body.option : "" }), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
