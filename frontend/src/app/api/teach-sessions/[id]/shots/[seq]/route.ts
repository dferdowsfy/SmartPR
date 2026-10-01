/**
 * GET /api/teach-sessions/[id]/shots/[seq] — one step's screenshot, for
 * the person who recorded it (owner-gated; fetched from the worker server
 * side so the worker's viewer token never reaches the page). No screenshot
 * is kept for steps on sensitive fields.
 */
import { currentViewer, unauthorized, workerDeps } from "../../../../../../lib/agency-runs/teach/routeContext";
import { teachShot } from "../../../../../../lib/agency-runs/teach/teachSessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string; seq: string }> }) {
  const viewer = await currentViewer();
  if (!viewer) return unauthorized();
  const { id, seq } = await ctx.params;
  const n = Number(seq);
  if (!Number.isInteger(n) || n < 1) return new Response(null, { status: 404 });
  try {
    const bytes = await teachShot(workerDeps, viewer, id, n);
    if (!bytes) return new Response(null, { status: 404 });
    return new Response(bytes, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, no-store" } });
  } catch {
    return new Response(null, { status: 404 });
  }
}
