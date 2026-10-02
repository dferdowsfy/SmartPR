/**
 * POST /api/teach-sessions/[id]/fill-from-passport { selector } — type the
 * business's Passport value for that field into the live portal. The value
 * stays server-side (never returned to the page or recorded).
 */
import { currentViewer, errorResponse, unauthorized, workerDeps } from "../../../../../lib/agency-runs/teach/routeContext";
import { fillFromPassportTeach } from "../../../../../lib/agency-runs/teach/teachSessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const viewer = await currentViewer();
  if (!viewer) return unauthorized();
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { selector?: unknown };
  try {
    return Response.json(await fillFromPassportTeach(workerDeps, viewer, id, typeof body.selector === "string" ? body.selector : ""), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
