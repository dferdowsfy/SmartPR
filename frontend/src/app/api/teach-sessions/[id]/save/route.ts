/**
 * POST /api/teach-sessions/[id]/save — save the taught skill.
 *
 * Body: { submit?: boolean }. Always saved as a draft first (admin → shared
 * library, everyone else → private). submit=true then sends a private skill
 * for review, which locks it. The skill must pass validateSkill.
 * learn=true (record-first Teach) requires a passing validation
 * (POST …/validate) and marks the skill as a learned routine for its
 * checklist requirement.
 */
import { currentViewer, errorResponse, skillRepo, unauthorized } from "../../../../../lib/agency-runs/teach/routeContext";
import { saveTeachSession } from "../../../../../lib/agency-runs/teach/teachSessions";
import { summarizeRoutine } from "../../../../../lib/agency-runs/teach/learnedRoutines";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const viewer = await currentViewer();
  if (!viewer) return unauthorized();
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const row = await saveTeachSession({ repo: await skillRepo() }, viewer, id, { submit: body.submit === true, learn: body.learn === true });
    return Response.json(
      { skill: { id: row.id, skill_id: row.skill_id, version: row.version, scope: row.scope, status: row.status }, routine: summarizeRoutine(row, viewer) },
      { status: 201 }
    );
  } catch (err) {
    return errorResponse(err);
  }
}
