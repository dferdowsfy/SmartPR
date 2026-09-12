"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { createSupabaseBrowser, isAuthConfigured } from "../../../lib/supabase/client";
import { passwordResetRedirectUrl, verificationRedirectUrl } from "../../../lib/siteUrl";
import { SmartPRLogo } from "../../components/brand/SmartPRLogo";
import { GUEST_INTAKE, guestContinuePath, sanitizeNext } from "../../../lib/safeNext";

type Mode = "signin" | "forgot";

function LoginInner() {
  const sp = useSearchParams();
  const router = useRouter();
  const nextPath = sanitizeNext(sp.get("next"), "/businesses");
  const signupNextPath = sanitizeNext(sp.get("next"), GUEST_INTAKE);
  const signupHref = `/signup?intent=start&next=${encodeURIComponent(signupNextPath)}`;

  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(() =>
    sp.get("verified") === "1" ? "Your email is verified. Please log in to continue." : null,
  );
  const [showResend, setShowResend] = useState(false);

  useEffect(() => {
    if (sp.get("mode") === "signup") router.replace(signupHref);
  }, [router, signupHref, sp]);

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

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode !== "forgot" && (!email || !password)) return;
    if (mode === "forgot" && !email) return;
    setBusy(true); setErr(null); setInfo(null);
    try {
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
      if (await bootstrapPlatform()) router.push(nextPath);
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
        {mode === "signin" ? "Welcome back." : "Reset your password."}
      </h1>
      <p className="mt-3 mb-8 text-[#1b1b1b]">
        {mode === "signin" ? "Continue your Puerto Rico filing work."
          : "Enter the email on your account and we'll send a reset link."}
      </p>

      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium">Email</label>
          <input type="email" required autoComplete="email" value={email}
            onChange={(e) => setEmail(e.target.value)} placeholder="you@business.com"
            className="w-full rounded-lg border border-[#161616]/22 bg-[#fbf8f2] px-3 py-2.5 text-sm placeholder:text-[#5a5a5a]" />
        </div>
        {mode !== "forgot" && (
          <div>
            <div className="mb-1 flex items-baseline justify-between">
              <label className="text-sm font-medium">Password</label>
              {mode === "signin" && (
                <button type="button" onClick={() => swapMode("forgot")} className="text-sm text-[#245c5c] underline-offset-4 hover:underline">
                  Forgot password?
                </button>
              )}
            </div>
            <input type="password" required minLength={6}
              autoComplete="current-password"
              value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="Your password"
              className="w-full rounded-lg border border-[#161616]/22 bg-[#fbf8f2] px-3 py-2.5 text-sm placeholder:text-[#5a5a5a]" />
          </div>
        )}
        <button type="submit"
          disabled={busy || !email || (mode !== "forgot" && password.length < 6)}
          className="w-full rounded-lg bg-[#245c5c] py-3 font-medium text-[#f6f3ea] disabled:opacity-50">
          {busy ? (mode === "forgot" ? "Sending…" : "Logging in…")
                : (mode === "forgot" ? "Send reset link" : "Login")}
        </button>
      </form>

      {err && <div className="mt-3 text-sm text-[#8a2f2f]">{err}</div>}
      {info && <div className="mt-3 text-sm text-[#1f5a3a]">{info}</div>}
      {showResend && (
        <button type="button" onClick={() => void resendVerification()} disabled={busy || !email}
          className="mt-3 block text-sm font-medium text-[#245c5c] underline-offset-4 hover:underline disabled:opacity-50">
          {busy ? "Sending…" : "Resend verification email"}
        </button>
      )}

      {mode === "forgot" && (
        <button onClick={() => swapMode("signin")} className="mt-4 block text-sm text-[#5a5a5a] hover:text-[#161616]">
          Back to login
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
        <Link href="/" aria-label="SmartPR home"><SmartPRLogo size="auth" /></Link>
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
