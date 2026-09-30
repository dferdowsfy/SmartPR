/**
 * POST /api/teach-sessions — start a Teach Clara session.
 *
 * Body: { start_url, form, portal_name?, business_id? }
 * Opens the teacher's own browser session on the worker (the teacher signs
 * in themselves; Clara never sees credentials) with the structure-only
 * recorder injected. Admins teach into the shared library, everyone else
 * into their private skills (enforced server side).
 */
import { loadPassportForBusiness } from "../../../lib/agency-runs/passportLoader";
import { currentViewer, errorResponse, unauthorized, workerDeps } from "../../../lib/agency-runs/teach/routeContext";
import { startTeachSession } from "../../../lib/agency-runs/teach/teachSessions";
import { teachAvailability } from "../../../lib/agency-runs/teach/teachWorkerClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const viewer = await currentViewer({ withTier: true });
  if (!viewer) return unauthorized();
  const availability = teachAvailability();
  if (!availability.ok) {
    return Response.json(
      {
        error: "teach_unavailable",
        reason: availability.reason,
        message: {
          en: "Teaching Clara needs SmartPR's own browser worker, which isn't turned on here yet.",
          es: "Para enseñarle a Clara hace falta el navegador propio de SmartPR, y todavía no está activo aquí.",
        },
      },
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
    });
    return Response.json({ session }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
