// OAuth + Magic Link + Email Verification callback.
//
// - ?code=              → exchangeCodeForSession (OAuth, magic links, and the
//                        PKCE confirmation links Supabase sends for signups)
// - ?token_hash=&type=  → verifyOtp fallback for hash-based email links
//
// After a successful verification the route redirects to ?next= (default the
// guest intake). EXCEPTION: email-verification links carry
// next=/auth/login?verified=1… — in that case the user is signed back out
// and sent to the login page, so they explicitly log in after verifying.

import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServer } from "../../../lib/supabase/server";
import { bootstrapPlatformUser } from "../../../lib/auth/bootstrap";
import { convertLeadForUser } from "../../../lib/leads";
import { getPool, isEnabled } from "../../graph/db";
import { claimSubmissionsByEmail } from "../../graph/auth-actions";
import { authCallbackPath } from "../../../lib/safeNext";
import { getSiteUrl } from "../../../lib/siteUrl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type OtpType = "signup" | "magiclink" | "recovery" | "invite" | "email_change" | "phone_change";

function asOtpType(value: string | null): OtpType | null {
  return value === "signup" ||
    value === "magiclink" ||
    value === "recovery" ||
    value === "invite" ||
    value === "email_change" ||
    value === "phone_change"
    ? value
    : null;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const otpType = asOtpType(url.searchParams.get("type"));
  const nextPath = authCallbackPath(url.searchParams.get("next"));
  const supabase = await createSupabaseServer();

  // Email-verification links land on the LOGIN page (next=/auth/login?verified=1…):
  // consume the token, then sign the user back out so the next step is an
  // explicit login — never a silent drop into the app.
  const verifyToLogin = nextPath === "/auth/login" || nextPath.startsWith("/auth/login?");

  if (supabase && (code || (tokenHash && otpType))) {
    let authedUser: { id: string; email?: string | null } | null = null;
    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) {
        const { data } = await supabase.auth.getUser();
        authedUser = data?.user ?? null;
      } else {
        console.error("[auth-callback] exchangeCodeForSession failed:", error.message);
      }
    } else if (tokenHash && otpType) {
      const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: otpType });
      if (!error) {
        authedUser = data?.user ?? null;
      } else {
        console.error("[auth-callback] verifyOtp failed:", error.message);
      }
    }

    if (authedUser) {
      if (verifyToLogin) {
        // Adopt any anonymous submissions, then drop the session: the login
        // page (with its "email verified" notice) is the next step.
        // Best-effort — a failure here must never break verification.
        await claimSubmissionsByEmail(authedUser.id, authedUser.email ?? null).catch((claimError) => {
          console.error("[auth-callback] claim submissions:", (claimError as Error).message);
        });
        await supabase.auth.signOut().catch(() => {});
      } else {
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
  }

  // Build the redirect off the canonical site URL, never req.url: behind
  // Railway's proxy req.url is https://localhost:8080/…, which would send
  // users to a dead localhost address.
  return NextResponse.redirect(new URL(nextPath, getSiteUrl()));
}
