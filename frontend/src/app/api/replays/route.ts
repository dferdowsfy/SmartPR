/**
 * POST /api/replays { skill_ref, business_id } — build the preflight plan
 * for replaying a skill with this business's passport. Nothing opens until
 * the person confirms (POST /api/replays/[id]/start).
 */
import { loadCanonicalPassportForBusiness as loadPassportForBusiness } from "../../../lib/agency-runs/passportLoader";
import { planReplaySession } from "../../../lib/agency-runs/replay/replaySessions";
import { currentViewer, errorResponse, replayDeps, unauthorized } from "../../../lib/agency-runs/teach/routeContext";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const viewer = await currentViewer();
  if (!viewer) return unauthorized();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof body.skill_ref !== "string") return Response.json({ error: "bad_request", message: "skill_ref required." }, { status: 400 });
  const businessId = typeof body.business_id === "string" ? body.business_id : null;
  try {
    const passport = businessId ? await loadPassportForBusiness(businessId, viewer.userId) : null;
    return Response.json({ replay: await planReplaySession(await replayDeps(), viewer, { ref: body.skill_ref, businessId, passport }) }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
