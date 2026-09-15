/**
 * POST /api/agency-runs/[id]/resume — continue after USER_UPLOAD / USER_LOGIN / CAPTCHA.
 * For Browser Use: dispatches a follow-up task when the session is idle.
 */
import { assertRunOwner, peekRun, resumeRun } from "../../../../../lib/agency-runs/store";
import { getCurrentUser } from "../../../../../lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const peek = peekRun(id);
  if (!peek) return Response.json({ error: "not_found" }, { status: 404 });

  const user = await getCurrentUser();
  if (!assertRunOwner(peek, user?.id ?? null)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const run = await resumeRun(id);
  if (!run) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ run });
}
