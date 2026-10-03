/**
 * POST /api/teach-sessions/[id]/fill-page { continue?: boolean } — fill the
 * current portal screen from the Business Passport (text typed, choices
 * picked) and, when nothing is missing, press the screen's Continue. Values
 * never come back to the page; a final submit is never pressed.
 */
import { currentViewer, errorResponse, unauthorized, workerDeps } from "../../../../../lib/agency-runs/teach/routeContext";
import { fillPageFromPassportTeach } from "../../../../../lib/agency-runs/teach/teachSessions";
import { dbPassportStore } from "../../../../../lib/agency-runs/passportWrite";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const viewer = await currentViewer();
  if (!viewer) return unauthorized();
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { continue?: unknown };
  try {
    return Response.json(await fillPageFromPassportTeach({ ...workerDeps, passportStore: dbPassportStore() }, viewer, id, { continue: body.continue !== false }), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
