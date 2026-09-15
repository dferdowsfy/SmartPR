/**
 * POST /api/agency-runs/[id]/resume — continue after USER_UPLOAD / USER_LOGIN / CAPTCHA.
 * For Browser Use: dispatches a follow-up task when the session is idle.
 * Optional JSON body: { credentials?: { email?, password?, mfa? } } — ephemeral only.
 */
import { assertRunOwner, peekRun, resumeRun } from "../../../../../lib/agency-runs/store";
import type { ResumeCredentials } from "../../../../../lib/agency-runs/taskPrompt";
import { getCurrentUser } from "../../../../../lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseCredentials(body: unknown): ResumeCredentials | null {
  if (!body || typeof body !== "object") return null;
  const creds = (body as { credentials?: unknown }).credentials;
  if (!creds || typeof creds !== "object") return null;
  const c = creds as Record<string, unknown>;
  const out: ResumeCredentials = {};
  if (typeof c.email === "string" && c.email.trim()) out.email = c.email.trim();
  if (typeof c.password === "string" && c.password.trim()) out.password = c.password.trim();
  if (typeof c.mfa === "string" && c.mfa.trim()) out.mfa = c.mfa.trim();
  return out.email || out.password || out.mfa ? out : null;
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const peek = peekRun(id);
  if (!peek) return Response.json({ error: "not_found" }, { status: 404 });

  const user = await getCurrentUser();
  if (!assertRunOwner(peek, user?.id ?? null)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  let credentials: ResumeCredentials | null = null;
  try {
    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const body = await req.json().catch(() => null);
      credentials = parseCredentials(body);
    }
  } catch {
    // Empty / non-JSON body is fine — resume without credentials.
  }

  const run = await resumeRun(id, { credentials });
  if (!run) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ run });
}
