/**
 * GET /api/clara-routines — the signed-in person's learned routines (taught
 * by recording, validated), so checklist rows can lead with "Fill with
 * Clara" (strict replay) and show "Clara learned this". Signed out: empty.
 *
 * `live_recorder` / `recorder` come from a real probe of the browser
 * worker (reachable, authorized, can launch the recorder's browser, live
 * view wired) — not just configuration. ?fresh=1 skips the probe cache.
 */
import { currentViewer, skillRepo } from "../../../lib/agency-runs/teach/routeContext";
import { listLearnedRoutines } from "../../../lib/agency-runs/teach/learnedRoutines";
import { probeTeachWorker, type TeachProbe } from "../../../lib/agency-runs/teach/teachWorkerClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function recorder(probe: TeachProbe, isAdmin: boolean) {
  return { ok: probe.ok, reason: probe.reason, busy: probe.busy, message: probe.message, operator_hint: isAdmin ? probe.operator_hint : null, checked_at: probe.checked_at };
}

export async function GET(req: Request) {
  const fresh = new URL(req.url).searchParams.get("fresh") === "1";
  const [viewer, probe] = await Promise.all([currentViewer().catch(() => null), probeTeachWorker({ fresh })]);
  const live_recorder = probe.ok;
  if (!viewer) return Response.json({ signed_in: false, live_recorder, recorder: recorder(probe, false), routines: [] });
  try {
    return Response.json({ signed_in: true, live_recorder, recorder: recorder(probe, viewer.isAdmin), routines: await listLearnedRoutines(await skillRepo(), viewer) });
  } catch (err) {
    console.error("[clara-routines]", (err as Error)?.message);
    return Response.json({ signed_in: true, live_recorder, recorder: recorder(probe, viewer.isAdmin), routines: [] });
  }
}
