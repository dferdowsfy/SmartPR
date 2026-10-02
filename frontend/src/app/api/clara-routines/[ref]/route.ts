/**
 * PATCH  /api/clara-routines/[ref] { name } — rename a routine you taught.
 * DELETE /api/clara-routines/[ref]          — remove it (Fill with Clara stops using it).
 * Owner only; shared-library routines are managed by the SmartPR team.
 */
import { currentViewer, errorResponse, skillRepo, unauthorized } from "../../../../lib/agency-runs/teach/routeContext";
import { removeRoutine, renameRoutine } from "../../../../lib/agency-runs/teach/learnedRoutines";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: Request, ctx: { params: Promise<{ ref: string }> }) {
  const viewer = await currentViewer();
  if (!viewer) return unauthorized();
  const { ref } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { name?: unknown };
  try {
    return Response.json({ routine: await renameRoutine(await skillRepo(), viewer, ref, typeof body.name === "string" ? body.name : "") });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ ref: string }> }) {
  const viewer = await currentViewer();
  if (!viewer) return unauthorized();
  const { ref } = await ctx.params;
  try {
    await removeRoutine(await skillRepo(), viewer, ref);
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
