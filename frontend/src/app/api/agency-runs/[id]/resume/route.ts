/**
 * POST /api/agency-runs/[id]/resume — continue after USER_UPLOAD / USER_LOGIN / CAPTCHA.
 */
import { resumeRun } from "../../../../../lib/agency-runs/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const run = resumeRun(id);
  if (!run) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ run });
}
