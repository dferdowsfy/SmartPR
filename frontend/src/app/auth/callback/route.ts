// OAuth + Magic Link callback. Exchanges the auth code for a session cookie,
// upserts the user mirror, claims any anonymous submissions matching the
// user's email, then redirects to ?next= (or the portfolio dashboard).

import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServer } from "../../../lib/supabase/server";
import { bootstrapPlatformUser } from "../../../lib/auth/bootstrap";
import { convertLeadForUser } from "../../../lib/leads";
import { getPool, isEnabled } from "../../graph/db";
import { claimSubmissionsByEmail } from "../../graph/auth-actions";
import { authCallbackPath } from "../../../lib/safeNext";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const nextPath = authCallbackPath(url.searchParams.get("next"));
  const supabase = await createSupabaseServer();

  if (code && supabase) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const { data } = await supabase.auth.getUser();
      const u = data?.user;
      if (u) {
        await bootstrapPlatformUser(u).catch((bootstrapError) => {
          console.error("[auth-callback] platform bootstrap failed:", (bootstrapError as Error).message);
        });
        // Link any landing-page lead to this account and tell the founder.
        // Best-effort: a notification failure must never break sign-in.
        try {
          if (isEnabled()) {
            const pool = getPool();
            if (pool) await convertLeadForUser(pool, u);
          }
        } catch (leadError) {
          console.error("[auth-callback] lead conversion", (leadError as Error).message);
        }
        await claimSubmissionsByEmail(u.id, u.email ?? null);
      }
    }
  }

  return NextResponse.redirect(new URL(nextPath, req.url));
}
