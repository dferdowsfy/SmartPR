/**
 * POST /api/skills/[id]/review { decision: "approve" | "reject", notes? } (admin)
 * Approve re-runs the automated checks server side and only proceeds when
 * both pass; a private skill is promoted into the shared library as the
 * next version, attributed to its teacher. Reject keeps it private with notes.
 */
import { approveSkill, getVisibleSkill, rejectSkill } from "../../../../../lib/agency-runs/skills/skillLibrary";
import { runSkillChecks } from "../../../../../lib/agency-runs/skills/reviewChecks";
import { currentViewer, errorResponse, skillRepo, unauthorized } from "../../../../../lib/agency-runs/teach/routeContext";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const viewer = await currentViewer();
  if (!viewer) return unauthorized();
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { decision?: string; notes?: string };
  try {
    const repo = await skillRepo();
    if (body.decision === "reject") {
      const row = await rejectSkill(repo, viewer, id, String(body.notes ?? ""));
      return Response.json({ skill: { id: row.id, status: row.status } });
    }
    if (body.decision !== "approve") return Response.json({ error: "bad_request", message: "decision must be approve or reject." }, { status: 400 });
    const row = await getVisibleSkill(repo, viewer, id);
    if (!row) return Response.json({ error: "not_found" }, { status: 404 });
    const checks = await runSkillChecks(row.skill);
    if (!checks.ok) return Response.json({ error: "checks_failed", checks }, { status: 409 });
    const approved = await approveSkill(repo, viewer, id, checks);
    return Response.json({ skill: { id: approved.id, scope: approved.scope, status: approved.status, version: approved.version }, checks });
  } catch (err) {
    return errorResponse(err);
  }
}
