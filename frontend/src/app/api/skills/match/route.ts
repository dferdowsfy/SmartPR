/**
 * GET /api/skills/match?url=…&form=…  (or ?host=…&form=…)
 * → { skill: { id, version, scope, status } | null, can_teach, teach_label }
 * Used to offer "Show Clara" when no skill exists for a portal + form.
 */
import { matchSkill } from "../../../../lib/agency-runs/skills/skillLibrary";
import { currentViewer, errorResponse, skillRepo, unauthorized } from "../../../../lib/agency-runs/teach/routeContext";
import { teachAvailability } from "../../../../lib/agency-runs/teach/teachWorkerClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const viewer = await currentViewer();
  if (!viewer) return unauthorized();
  const q = new URL(req.url).searchParams;
  let host = q.get("host") ?? "";
  try {
    if (!host && q.get("url")) host = new URL(q.get("url")!).hostname;
  } catch {
    return Response.json({ error: "bad_request", message: "Invalid url." }, { status: 400 });
  }
  const form = q.get("form") ?? "";
  if (!host || !form) return Response.json({ error: "bad_request", message: "host (or url) and form are required." }, { status: 400 });
  try {
    const row = await matchSkill(await skillRepo(), viewer, host, form);
    return Response.json({
      skill: row ? { id: row.id, version: row.version, scope: row.scope, status: row.status } : null,
      can_teach: teachAvailability().ok,
      teach_label: viewer.isAdmin ? "teach" : "show",
    });
  } catch (err) {
    return errorResponse(err);
  }
}
