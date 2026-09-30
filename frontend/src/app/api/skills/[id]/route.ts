/**
 * GET /api/skills/[id] — one visible skill with its human-readable card.
 * PUT /api/skills/[id] — { skill } replaces an owned draft (validated; locked after submit).
 */
import { getVisibleSkill, updateDraft } from "../../../../lib/agency-runs/skills/skillLibrary";
import { skillCard } from "../../../../lib/agency-runs/skills/skillCard";
import type { Skill } from "../../../../lib/agency-runs/skills/skill";
import { currentViewer, errorResponse, skillRepo, unauthorized } from "../../../../lib/agency-runs/teach/routeContext";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const viewer = await currentViewer();
  if (!viewer) return unauthorized();
  const { id } = await ctx.params;
  try {
    const row = await getVisibleSkill(await skillRepo(), viewer, id);
    if (!row) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json({
      skill: { id: row.id, scope: row.scope, status: row.status, version: row.version, mine: row.owner_user_id === viewer.userId, review_notes: row.review_notes, json: row.skill },
      card: skillCard(row.skill),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const viewer = await currentViewer();
  if (!viewer) return unauthorized();
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { skill?: Skill };
  if (!body.skill || typeof body.skill !== "object") return Response.json({ error: "bad_request" }, { status: 400 });
  try {
    const row = await updateDraft(await skillRepo(), viewer, id, body.skill);
    return Response.json({ skill: { id: row.id, status: row.status, version: row.version }, card: skillCard(row.skill) });
  } catch (err) {
    return errorResponse(err);
  }
}
