"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { createSupabaseBrowser, isAuthConfigured } from "../../../lib/supabase/client";
import { authRedirectUrl, passwordResetRedirectUrl, verificationRedirectUrl } from "../../../lib/siteUrl";
import { BrandLogo } from "../../components/brand/BrandProvider";
import { GUEST_INTAKE, guestContinuePath, sanitizeNext } from "../../../lib/safeNext";

type Mode = "signin" | "forgot" | "link";

function LoginInner() {
  const sp = useSearchParams();
  const router = useRouter();
  const nextPath = sanitizeNext(sp.get("next"), "/businesses");
  const signupNextPath = sanitizeNext(sp.get("next"), GUEST_INTAKE);
  const signupHref = `/signup?intent=start&next=${encodeURIComponent(signupNextPath)}`;
  const inviteToken = sp.get("invite");

  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(() =>
    sp.get("verified") === "1" ? "Your email is verified. Please log in to continue." : null,
  );
  const [showResend, setShowResend] = useState(false);
  const [inviteAccepted, setInviteAccepted] = useState<string | null>(null);

  useEffect(() => {
    if (sp.get("mode") === "signup") router.replace(signupHref);
  }, [router, signupHref, sp]);

  // Invited user landing back here with a session (e.g. after a magic-link
  // round-trip): accept the invite, then continue.
  useEffect(() => {
    if (!inviteToken) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled || !data.session) return;
      const res = await fetch("/api/invites/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: inviteToken }),
      });
      const result = await res.json().catch(() => ({}));
      if (cancelled) return;
      if (res.ok) {
        setInviteAccepted(result.workspaceName || "the workspace");
        router.push(nextPath);
      } else {
        setErr(result.error || "Could not accept the invitation.");
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inviteToken]);

  if (!isAuthConfigured()) {
    return (
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-4xl font-medium">Login is not configured</h1>
        <p className="mt-3 text-[#1b1b1b]">
          Add <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to enable accounts.
          You can still use SmartPR without signing in.
        </p>
      </div>
    );
  }

  const supabase = createSupabaseBrowser();
  const resetRedirectTo = passwordResetRedirectUrl();
  const swapMode = (m: Mode) => { setMode(m); setErr(null); setInfo(null); setShowResend(false); };

  const bootstrapPlatform = async () => {
    const response = await fetch("/api/auth/bootstrap", { method: "POST" });
    if (response.ok) return true;
    const result = await response.json().catch(() => ({}));
    setErr(result.error || "Signed in, but SmartPR could not initialize your workspace.");
    return false;
  };

  const acceptInvite = async (): Promise<boolean> => {
    if (!inviteToken) return true;
    try {
      const res = await fetch("/api/invites/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: inviteToken }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(result.error || "Signed in, but the workspace invitation could not be accepted.");
        return false;
      }
      setInviteAccepted(result.workspaceName || "the workspace");
      return true;
    } catch {
      setErr("Signed in, but the workspace invitation could not be accepted.");
      return false;
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === "link" && !email) return;
    if (mode !== "forgot" && mode !== "link" && (!email || !password)) return;
    if (mode === "forgot" && !email) return;
    setBusy(true); setErr(null); setInfo(null);
    try {
      if (mode === "link") {
        // Preserve the invite across the magic-link round-trip: the callback
        // drops the user back here, and the session effect above accepts it.
        const linkNext = inviteToken
          ? `/auth/login?invite=${encodeURIComponent(inviteToken)}&next=${encodeURIComponent(nextPath)}`
          : nextPath;
        const { error } = await supabase.auth.signInWithOtp({
          email: email.trim(),
          options: { emailRedirectTo: authRedirectUrl(linkNext) },
        });
        if (error) { setErr(error.message); return; }
        setInfo(`Sign-in link sent to ${email.trim()}. Check your inbox — the link expires in 60 minutes.`);
        return;
      }
      if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: resetRedirectTo });
        if (error) { setErr(error.message); return; }
        setInfo(`Password reset link sent to ${email}. Check your inbox.`);
        return;
      }
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        const m = error.message || "";
        if (/email\s*not\s*confirmed/i.test(m)) {
          setErr("This email is not confirmed yet. Check your inbox for the verification link.");
          setShowResend(true);
        } else if (/invalid\s*login\s*credentials/i.test(m)) {
          setErr("Email or password is incorrect.");
          setShowResend(false);
        } else {
          setErr(m);
          setShowResend(false);
        }
        return;
      }
      if (await bootstrapPlatform()) {
        if (await acceptInvite()) router.push(nextPath);
      }
    } catch (e) {
      setErr((e as Error).message || "Login failed");
    } finally {
      setBusy(false);
    }
  };

  const resendVerification = async () => {
    if (!email) return;
    setBusy(true); setErr(null);
    try {
      const { error } = await supabase.auth.resend({
        email: email.trim(),
        type: "signup",
        options: { emailRedirectTo: verificationRedirectUrl(nextPath) },
      });
      if (error) { setErr(error.message); return; }
      setInfo(`Verification link sent to ${email.trim()}. Check your inbox.`);
      setShowResend(false);
    } catch (e) {
      setErr((e as Error).message || "Could not resend the verification email.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-full">
      <h1 className="font-[family-name:var(--font-display)] text-4xl font-medium">
        {mode === "signin" ? "Welcome back." : mode === "link" ? "Sign in with email." : "Reset your password."}
      </h1>
      <p className="mt-3 mb-8 text-[#1b1b1b]">
        {mode === "signin" ? "Continue your Puerto Rico filing work."
          : mode === "link" ? "Enter your email and we'll send a one-click sign-in link. No password needed."
          : "Enter the email on your account and we'll send a reset link."}
      </p>

      {inviteToken && !inviteAccepted && (
        <div className="mb-6 rounded-lg border border-brand/30 bg-brand/8 px-4 py-3 text-sm text-[#161616]">
          You&apos;ve been invited to join a SmartPR workspace. Log in with the invited email address to accept.
        </div>
      )}
      {inviteAccepted && (
        <div className="mb-6 rounded-lg border border-[#1f5a3a]/30 bg-[#1f5a3a]/8 px-4 py-3 text-sm text-[#1f5a3a]">
          You&apos;ve joined {inviteAccepted}.
        </div>
      )}

      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium">Email</label>
          <input type="email" required autoComplete="email" value={email}
            onChange={(e) => setEmail(e.target.value)} placeholder="you@business.com"
            className="w-full rounded-lg border border-[#161616]/22 bg-[#fbf8f2] px-3 py-2.5 text-sm placeholder:text-[#5a5a5a]" />
        </div>
        {mode === "signin" && (
          <div>
            <div className="mb-1 flex items-baseline justify-between">
              <label className="text-sm font-medium">Password</label>
              <button type="button" onClick={() => swapMode("forgot")} className="text-sm text-brand underline-offset-4 hover:underline">
                Forgot password?
              </button>
            </div>
            <input type="password" required minLength={6}
              autoComplete="current-password"
              value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="Your password"
              className="w-full rounded-lg border border-[#161616]/22 bg-[#fbf8f2] px-3 py-2.5 text-sm placeholder:text-[#5a5a5a]" />
          </div>
        )}
        <button type="submit"
          disabled={busy || !email || (mode === "signin" && password.length < 6)}
          className="w-full rounded-lg bg-brand py-3 font-medium text-[#f6f3ea] disabled:opacity-50">
          {busy ? (mode === "forgot" ? "Sending…" : mode === "link" ? "Sending…" : "Logging in…")
                : (mode === "forgot" ? "Send reset link" : mode === "link" ? "Email me a sign-in link" : "Login")}
        </button>
        {mode === "signin" && (
          <button type="button" onClick={() => swapMode("link")}
            className="w-full rounded-lg border border-[#161616]/22 py-3 text-sm font-medium text-[#161616] hover:bg-[#161616]/5">
            Email me a sign-in link instead
          </button>
        )}
      </form>

      {err && <div className="mt-3 text-sm text-[#8a2f2f]">{err}</div>}
      {info && <div className="mt-3 text-sm text-[#1f5a3a]">{info}</div>}
      {showResend && (
        <button type="button" onClick={() => void resendVerification()} disabled={busy || !email}
          className="mt-3 block text-sm font-medium text-brand underline-offset-4 hover:underline disabled:opacity-50">
          {busy ? "Sending…" : "Resend verification email"}
        </button>
      )}

      {mode === "forgot" && (
        <button onClick={() => swapMode("signin")} className="mt-4 block text-sm text-[#5a5a5a] hover:text-[#161616]">
          Back to login
        </button>
      )}
      {mode === "link" && (
        <button onClick={() => swapMode("signin")} className="mt-4 block text-sm text-[#5a5a5a] hover:text-[#161616]">
          Back to password login
        </button>
      )}

      <div className="mt-6 text-sm text-[#5a5a5a]">
        {mode === "signin" ? (
          <>Need an account?{" "}
            <Link href={signupHref} className="font-medium text-[#161616] underline-offset-4 hover:underline">Create account</Link>
          </>
        ) : null}
      </div>

      <button type="button" onClick={() => router.push(guestContinuePath(sp.get("next")))} className="mt-6 block text-sm text-[#5a5a5a] hover:text-[#161616]">
        Continue without an account
      </button>
      <p className="mt-2 text-xs text-[#5a5a5a]">
        You can finish this assessment first. An account is required later to save to the cloud, manage multiple businesses, and resume on another device.
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen flex-col bg-[#f4f1ea] text-[#161616]">
      <header className="px-6 py-5">
        <Link href="/" aria-label="Home"><BrandLogo size="auth" /></Link>
      </header>
      <main className="mx-auto grid w-full max-w-md flex-1 place-items-center px-6 py-10">
        <Suspense fallback={<div className="text-[#5a5a5a]">Loading…</div>}>
          <LoginInner />
        </Suspense>
      </main>
      <footer className="px-6 py-6 text-sm text-[#5a5a5a]">
        <Link href="/privacy" className="underline-offset-4 hover:underline">Privacy Policy</Link>
        {" · "}
        <Link href={GUEST_INTAKE} className="underline-offset-4 hover:underline">Start without an account</Link>
      </footer>
    </div>
  );
}
