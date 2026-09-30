/** GET /api/skills/review — admin review queue (private skills sent for review + shared drafts). */
import { reviewQueue } from "../../../../lib/agency-runs/skills/skillLibrary";
import { skillCard } from "../../../../lib/agency-runs/skills/skillCard";
import { currentViewer, errorResponse, skillRepo, unauthorized } from "../../../../lib/agency-runs/teach/routeContext";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const viewer = await currentViewer();
  if (!viewer) return unauthorized();
  try {
    const rows = await reviewQueue(await skillRepo(), viewer);
    return Response.json({
      queue: rows.map((r) => ({ id: r.id, scope: r.scope, status: r.status, taught_by: r.taught_by, portal_host: r.portal_host, form: r.form, version: r.version, submitted_at: r.submitted_at, card: skillCard(r.skill) })),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
