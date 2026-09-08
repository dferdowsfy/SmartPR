"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { TopNav } from "../history/ui";
import { createSupabaseBrowser } from "../../lib/supabase/client";
import { passwordResetRedirectUrl } from "../../lib/siteUrl";

interface AccountUser {
  email: string | null;
  name: string | null;
}

export default function SettingsPage() {
  const router = useRouter();
  const [user, setUser] = useState<AccountUser | null>(null);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/me")
      .then((response) => response.json())
      .then((data) => {
        if (!data.user) {
          router.replace("/auth/login?next=/settings");
          return;
        }
        setUser(data.user);
        setName(data.user.name || "");
      })
      .catch(() => setError("We could not load your account settings."))
      .finally(() => setLoading(false));
  }, [router]);

  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const supabase = createSupabaseBrowser();
      const { error: updateError } = await supabase.auth.updateUser({
        data: { full_name: name.trim(), name: name.trim() },
      });
      if (updateError) throw updateError;
      setUser((current) => (current ? { ...current, name: name.trim() } : current));
      setMessage("Profile settings saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "We could not save your profile settings.");
    } finally {
      setSaving(false);
    }
  };

  const sendPasswordReset = async () => {
    if (!user?.email) return;
    setResetBusy(true);
    setMessage(null);
    setError(null);
    try {
      const supabase = createSupabaseBrowser();
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(user.email, {
        redirectTo: passwordResetRedirectUrl(),
      });
      if (resetError) throw resetError;
      setMessage(`Password reset link sent to ${user.email}. Check your inbox.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "We could not send a password reset email.");
    } finally {
      setResetBusy(false);
    }
  };

  const logOut = () => {
    window.location.assign("/auth/signout");
  };

  return (
    <div className="min-h-screen bg-[#f4f1ea]">
      <TopNav active="settings" />
      <main className="mx-auto max-w-2xl px-5 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-[#161616]">Account settings</h1>
          <p className="mt-1 text-sm text-[#161616]/60">
            Manage your profile, password, and sign-in for SmartPR.
          </p>
        </div>

        <section className="rounded-2xl border border-slate-200 bg-white p-6">
          {loading ? (
            <div className="text-sm text-[#161616]/50">Loading account…</div>
          ) : user ? (
            <div className="space-y-8">
              <form onSubmit={saveProfile} className="space-y-5">
                <div>
                  <label htmlFor="profile-name" className="mb-1 block text-xs font-semibold text-[#161616]/70">
                    Display name
                  </label>
                  <input
                    id="profile-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-[#161616]"
                    placeholder="Your name"
                    autoComplete="name"
                  />
                </div>
                <div>
                  <label htmlFor="profile-email" className="mb-1 block text-xs font-semibold text-[#161616]/70">
                    Email
                  </label>
                  <input
                    id="profile-email"
                    value={user.email || ""}
                    readOnly
                    className="w-full rounded-lg border border-slate-200 bg-[#f4f1ea] px-3 py-2.5 text-sm text-[#161616]/70"
                  />
                  <p className="mt-1 text-xs text-[#161616]/50">
                    Your sign-in email is managed by your authentication account.
                  </p>
                </div>

                {message && (
                  <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                    {message}
                  </div>
                )}
                {error && (
                  <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-[#161616] px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save profile"}
                </button>
              </form>

              <div className="border-t border-slate-200 pt-6">
                <h2 className="text-sm font-semibold text-[#161616]">Password</h2>
                <p className="mt-1 text-sm text-[#161616]/60">
                  We’ll email you a secure link to choose a new password.
                </p>
                <button
                  type="button"
                  onClick={sendPasswordReset}
                  disabled={resetBusy || !user.email}
                  className="mt-3 rounded-lg border border-slate-300 px-5 py-2.5 text-sm font-medium text-[#161616] disabled:opacity-50"
                >
                  {resetBusy ? "Sending…" : "Email password reset link"}
                </button>
              </div>

              <div className="border-t border-slate-200 pt-6">
                <h2 className="text-sm font-semibold text-[#161616]">Session</h2>
                <p className="mt-1 text-sm text-[#161616]/60">Sign out of SmartPR on this device.</p>
                <button
                  type="button"
                  onClick={logOut}
                  className="mt-3 rounded-lg border border-slate-300 px-5 py-2.5 text-sm font-medium text-[#161616]"
                >
                  Log out
                </button>
              </div>
            </div>
          ) : (
            <div className="text-sm text-red-700">{error || "Redirecting to sign in…"}</div>
          )}
        </section>
      </main>
    </div>
  );
}
