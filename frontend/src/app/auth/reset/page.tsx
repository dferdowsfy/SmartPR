"use client";

// Password-reset landing. Handles:
// 1) PKCE ?code= exchange (when redirectTo is this page)
// 2) Implicit hash tokens (#access_token&type=recovery)
// 3) Session already established via /auth/callback?next=/auth/reset

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowser, isAuthConfigured } from "../../../lib/supabase/client";
import { SmartPRLogo } from "../../components/brand/SmartPRLogo";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!isAuthConfigured()) {
      setReady(true);
      return;
    }
    const supabase = createSupabaseBrowser();
    let cancelled = false;

    const mark = (ok: boolean) => {
      if (cancelled) return;
      setHasSession(ok);
      setReady(true);
    };

    const establish = async () => {
      // PKCE: ?code= on this URL
      const url = new URL(window.location.href);
      const code = url.searchParams.get("code");
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (!error) {
          url.searchParams.delete("code");
          window.history.replaceState({}, "", url.pathname + url.search);
        }
      }

      // Implicit recovery hash (tokens in fragment — never reach the server)
      if (typeof window !== "undefined" && window.location.hash.includes("type=recovery")) {
        // createBrowserClient with detectSessionInUrl (default) picks these up
        await new Promise((r) => setTimeout(r, 50));
      }

      const { data } = await supabase.auth.getSession();
      if (data.session) {
        mark(true);
        return;
      }

      const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
        if (event === "PASSWORD_RECOVERY" || (event === "SIGNED_IN" && session)) {
          mark(!!session);
        }
      });

      // Final check after a short wait for hash parsing
      setTimeout(async () => {
        const again = await supabase.auth.getSession();
        mark(!!again.data.session);
        sub.subscription.unsubscribe();
      }, 400);
    };

    void establish();
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      setErr("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setErr("Passwords don't match.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const supabase = createSupabaseBrowser();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setErr(error.message);
        return;
      }
      setDone(true);
      setTimeout(() => router.push("/businesses"), 1200);
    } finally {
      setBusy(false);
    }
  };

  if (!ready) {
    return (
      <div className="min-h-screen bg-[#f4f1ea] p-10 text-center text-[#161616]/50">Loading…</div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f4f1ea]">
      <div className="mx-auto flex max-w-md flex-col gap-6 px-4 pt-12">
        <div className="flex justify-center">
          <SmartPRLogo className="h-10 w-auto" />
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-7">
          <h1 className="font-[family-name:var(--font-display)] text-3xl font-medium text-[#161616]">
            Set a new password
          </h1>

          {!hasSession ? (
            <>
              <p className="mt-2 text-sm text-[#161616]/70">
                This reset link is missing or expired. Request a new one from the sign-in page.
              </p>
              <button
                type="button"
                onClick={() => router.push("/auth/login?mode=forgot")}
                className="mt-5 w-full rounded-lg bg-[#161616] py-2.5 font-medium text-white"
              >
                Request a new reset link
              </button>
            </>
          ) : done ? (
            <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              Password updated. Taking you to your workspace…
            </div>
          ) : (
            <>
              <p className="mb-5 mt-1 text-sm text-[#161616]/60">Choose a new password for your account.</p>
              <form onSubmit={submit} className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-[#161616]/70">New password</label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 6 characters"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-[#161616] placeholder:text-[#161616]/40"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-[#161616]/70">Confirm password</label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-[#161616] placeholder:text-[#161616]/40"
                  />
                </div>
                <button
                  type="submit"
                  disabled={busy || password.length < 6}
                  className="w-full rounded-lg bg-[#161616] py-2.5 font-medium text-white disabled:opacity-50"
                >
                  {busy ? "Updating…" : "Update password"}
                </button>
              </form>
              {err && (
                <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {err}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
