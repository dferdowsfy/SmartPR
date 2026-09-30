/** GET /api/skills — skills the signed-in account can see (own + approved shared; admins also see the review queue). */
import { listVisibleSkills } from "../../../lib/agency-runs/skills/skillLibrary";
import { skillCard } from "../../../lib/agency-runs/skills/skillCard";
import { currentViewer, errorResponse, skillRepo, unauthorized } from "../../../lib/agency-runs/teach/routeContext";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const viewer = await currentViewer();
  if (!viewer) return unauthorized();
  try {
    const rows = await listVisibleSkills(await skillRepo(), viewer);
    return Response.json({
      skills: rows.map((r) => ({
        id: r.id,
        skill_id: r.skill_id,
        version: r.version,
        scope: r.scope,
        status: r.status,
        taught_by: r.taught_by,
        mine: r.owner_user_id === viewer.userId,
        portal_host: r.portal_host,
        form: r.form,
        updated_at: r.updated_at,
        counts: skillCard(r.skill).counts,
      })),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
