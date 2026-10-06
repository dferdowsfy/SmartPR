// ChatGPT → SmartPR handoff landing (review-before-save).
//
// Verifies the signed, expiring token server-side and shows the scenario
// for review. Nothing is created here: "Review in SmartPR intake" only
// prefills the intake (guest draft), where the user confirms every step.
// The token lives in the URL, so it survives a sign-in round trip
// (/auth/login?next=/chatgpt/handoff?t=…) until it expires.

import type { Metadata } from "next";
import Link from "next/link";
import { verifyHandoffToken, HandoffError } from "../../../lib/chatgpt/handoff";
import { getCurrentUser } from "../../../lib/supabase/server";
import { describeAnswers } from "../../../lib/chatgpt/assessment";
import HandoffReview from "./HandoffReview";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Continue from ChatGPT · SmartPR", robots: { index: false, follow: false } };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const t = typeof sp.t === "string" ? sp.t : null;
  let error: string | null = null;
  let payload: ReturnType<typeof verifyHandoffToken> | null = null;
  try {
    payload = verifyHandoffToken(t);
  } catch (e) {
    const code = e instanceof HandoffError ? e.code : "malformed";
    error = code === "expired"
      ? "This link from ChatGPT has expired. Ask SmartPR in ChatGPT for a new link, or start a new assessment here."
      : code === "not_configured"
        ? "ChatGPT handoff is not available right now."
        : "This link is invalid. Start a new assessment instead.";
  }
  const selfPath = t ? `/chatgpt/handoff?t=${encodeURIComponent(t)}` : "/chatgpt/handoff";
  // Only used to pick which buttons to show; nothing is read from or written
  // to the account here.
  const signedIn = payload ? !!(await getCurrentUser().catch(() => null)) : false;
  return (
    <main style={{ maxWidth: 720, margin: "40px auto", padding: "0 20px", fontFamily: "system-ui, sans-serif", color: "#0f172a" }}>
      <p style={{ color: "#0f766e", fontWeight: 600, margin: 0 }}>SmartPR · Continue from ChatGPT</p>
      <h1 style={{ fontSize: 26, margin: "6px 0 4px" }}>Review your scenario</h1>
      {error || !payload ? (
        <div role="alert" style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: 14, marginTop: 16 }}>
          {error}{" "}
          <Link href="/?entry=new-business" style={{ color: "#0f766e", fontWeight: 600 }}>Start a new assessment</Link>
        </div>
      ) : (
        <HandoffReview scenario={payload.scenario} intent={payload.intent} expiresAt={new Date(payload.exp * 1000).toISOString()} selfPath={selfPath} signedIn={signedIn} answerRows={describeAnswers(payload.scenario)} />
      )}
    </main>
  );
}
