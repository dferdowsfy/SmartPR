/**
 * GET /api/clara-routines — the signed-in person's learned routines (taught
 * by recording, validated), so checklist rows can lead with "Fill with
 * Clara" (strict replay) and show "Clara learned this". Signed out: empty.
 */
import { currentViewer, skillRepo } from "../../../lib/agency-runs/teach/routeContext";
import { listLearnedRoutines } from "../../../lib/agency-runs/teach/learnedRoutines";
import { teachAvailability } from "../../../lib/agency-runs/teach/teachWorkerClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const live_recorder = teachAvailability().ok;
  const viewer = await currentViewer().catch(() => null);
  if (!viewer) return Response.json({ signed_in: false, live_recorder, routines: [] });
  try {
    return Response.json({ signed_in: true, live_recorder, routines: await listLearnedRoutines(await skillRepo(), viewer) });
  } catch (err) {
    console.error("[clara-routines]", (err as Error)?.message);
    return Response.json({ signed_in: true, live_recorder, routines: [] });
  }
}
