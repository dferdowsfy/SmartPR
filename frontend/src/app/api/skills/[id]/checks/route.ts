/** POST /api/skills/[id]/checks — run the automated sanitization + replay checks (admin). */
import { getVisibleSkill } from "../../../../../lib/agency-runs/skills/skillLibrary";
import { runSkillChecks } from "../../../../../lib/agency-runs/skills/reviewChecks";
import { currentViewer, errorResponse, skillRepo, unauthorized } from "../../../../../lib/agency-runs/teach/routeContext";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const viewer = await currentViewer();
  if (!viewer) return unauthorized();
  if (!viewer.isAdmin) return Response.json({ error: "forbidden" }, { status: 403 });
  const { id } = await ctx.params;
  try {
    const row = await getVisibleSkill(await skillRepo(), viewer, id);
    if (!row) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json({ checks: await runSkillChecks(row.skill) });
  } catch (err) {
    return errorResponse(err);
  }
}
