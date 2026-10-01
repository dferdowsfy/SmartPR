/**
 * POST /api/replays/[id]/secure-input { value, selector? } — a one-time
 * sensitive value (password, SSN, verification code) from Clara's masked
 * chat card, typed straight into the paused portal screen. Never stored,
 * logged, or returned; the replay continues only when the person says so.
 */
import { secureInputReplay } from "../../../../../lib/agency-runs/replay/replaySessions";
import { currentViewer, errorResponse, replayDeps, unauthorized } from "../../../../../lib/agency-runs/teach/routeContext";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const viewer = await currentViewer();
  if (!viewer) return unauthorized();
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const out = await secureInputReplay(await replayDeps(), viewer, id, {
      value: typeof body.value === "string" ? body.value : "",
      selector: typeof body.selector === "string" ? body.selector : null,
    });
    return Response.json(out, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
