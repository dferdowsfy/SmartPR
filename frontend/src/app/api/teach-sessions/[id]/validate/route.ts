/**
 * POST /api/teach-sessions/[id]/validate — the validation step of
 * record-first Teach Clara: deterministic rules + a simulated dry run, the
 * advisory model review (labels only, when configured) and, with
 * { live_check: true } and the browser worker available, a live check that
 * the portal opens where the recording starts (stops at the first sign-in;
 * fills and clicks nothing). Only a passing routine can be saved as learned.
 */
import { teachDomainDecision } from "../../../../../lib/agency-runs/teach/domains";
import { currentViewer, errorResponse, modelPrompter, replayDeps, unauthorized } from "../../../../../lib/agency-runs/teach/routeContext";
import { getTeachState, validateTeachSession } from "../../../../../lib/agency-runs/teach/teachSessions";
import { replayAvailability } from "../../../../../lib/agency-runs/teach/teachWorkerClient";
import { portalEntryCheck, summarize } from "../../../../../lib/agency-runs/teach/validateRoutine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const viewer = await currentViewer();
  if (!viewer) return unauthorized();
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const out = await validateTeachSession(viewer, id, { reviewer: await modelPrompter(400) });
    if (body.live_check === true && replayAvailability().ok && out.validation.status === "pass") {
      const state = getTeachState(viewer, id);
      const decision = teachDomainDecision(state.startUrl, { isAdmin: true });
      if (decision.ok) {
        const deps = await replayDeps();
        const first = state.steps.find((s) => s.observed) ?? null;
        const live = await portalEntryCheck({ start: deps.startDrive, driver: deps.driver, stop: deps.stopDrive }, { startUrl: state.startUrl, allowedDomains: decision.allowedDomains, firstStep: first });
        out.validation = summarize([...out.validation.checks, { ...live, id: "dry_run" }], out.validation.llm);
      }
    }
    return Response.json(out);
  } catch (err) {
    return errorResponse(err);
  }
}
