/**
 * POST /api/teach-sessions/[id]/secure-input { value, selector? } — a
 * one-time sensitive value (password, SSN, verification code) typed into
 * Clara's masked chat card. It goes straight to the live portal field and
 * is dropped: never stored, logged, recorded, or returned.
 */
import { currentViewer, errorResponse, unauthorized, workerDeps } from "../../../../../lib/agency-runs/teach/routeContext";
import { secureFillTeach } from "../../../../../lib/agency-runs/teach/teachSessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const viewer = await currentViewer();
  if (!viewer) return unauthorized();
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const out = await secureFillTeach(workerDeps, viewer, id, {
      value: typeof body.value === "string" ? body.value : "",
      selector: typeof body.selector === "string" ? body.selector : null,
    });
    return Response.json(out, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
