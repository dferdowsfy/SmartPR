/**
 * POST /api/teach-sessions/[id]/passport-detail { path, value } — save a
 * missing Business Passport detail from Teach Clara. The value goes to the
 * business's Passport (SSN / ITIN to the protected store) and is never
 * returned; the response carries only a masked preview and the refreshed
 * session view.
 */
import { currentViewer, errorResponse, unauthorized } from "../../../../../lib/agency-runs/teach/routeContext";
import { savePassportFieldTeach } from "../../../../../lib/agency-runs/teach/teachSessions";
import { dbPassportStore } from "../../../../../lib/agency-runs/passportWrite";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const viewer = await currentViewer();
  if (!viewer) return unauthorized();
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { path?: unknown; value?: unknown };
  try {
    const out = await savePassportFieldTeach({ passportStore: dbPassportStore() }, viewer, id, {
      path: typeof body.path === "string" ? body.path : "",
      value: typeof body.value === "string" ? body.value : "",
    });
    return Response.json(out, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
