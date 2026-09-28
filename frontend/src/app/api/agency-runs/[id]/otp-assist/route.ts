/**
 * POST /api/agency-runs/[id]/otp-assist — QA OTP assist: fetch the portal's
 * fresh emailed verification code from the QA mailbox and hand it to the
 * agent through the ephemeral resume path. Hard-gated: the run must be
 * paused at an MFA step, the business must be on the QA allowlist, Gmail
 * must be configured, and the agency must have an OTP spec. The code itself
 * is never stored, logged, or returned — only the run (with assist events).
 *
 * Error codes: not_found | forbidden | not_paused_at_mfa | not_allowed |
 * not_configured | no_spec | no_code
 */
import { assertRunOwner, assistQaOtp, peekRun } from "../../../../../lib/agency-runs/store";
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

  const result = await assistQaOtp(id, { manual: true });
  if (!result.ok) {
    const status = result.error === "not_found" ? 404 : 409;
    return Response.json(
      { error: result.error, ...(result.run ? { run: result.run } : {}) },
      { status }
    );
  }
  return Response.json({ ok: true, run: result.run });
}
