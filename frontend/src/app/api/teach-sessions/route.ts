/**
 * POST /api/teach-sessions — start a Teach Clara session.
 *
 * Body: { start_url, form, portal_name?, business_id?, requirement_key?, agency? }
 * The worker is probed first (reachable, authorized, can launch the
 * recorder's browser, live view wired); a specific reason comes back when
 * it can't record.
 * Opens the teacher's own browser session on the worker (the teacher signs
 * in themselves; Clara never sees credentials) with the structure-only
 * recorder injected. Admins teach into the shared library, everyone else
 * into their private skills (enforced server side).
 */
import { loadPassportForBusiness } from "../../../lib/agency-runs/passportLoader";
import { currentViewer, errorResponse, unauthorized, workerDeps } from "../../../lib/agency-runs/teach/routeContext";
import { startTeachSession } from "../../../lib/agency-runs/teach/teachSessions";
import { probeTeachWorker } from "../../../lib/agency-runs/teach/teachWorkerClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const viewer = await currentViewer({ withTier: true });
  if (!viewer) return unauthorized();
  const probe = await probeTeachWorker({ fresh: true });
  if (!probe.ok) {
    return Response.json(
      { error: "teach_unavailable", reason: probe.reason, message: probe.message, operator_hint: viewer.isAdmin ? probe.operator_hint : null },
      { status: 503 }
    );
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const businessId = typeof body.business_id === "string" ? body.business_id : null;
  try {
    const passport = businessId ? await loadPassportForBusiness(businessId, viewer.userId) : null;
    const session = await startTeachSession(workerDeps, {
      viewer,
      tier: viewer.tier,
      businessId,
      passport,
      startUrl: String(body.start_url ?? ""),
      portalName: String(body.portal_name ?? ""),
      form: String(body.form ?? ""),
      requirementKey: typeof body.requirement_key === "string" ? body.requirement_key : null,
      agency: typeof body.agency === "string" ? body.agency : null,
    });
    return Response.json({ session }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
