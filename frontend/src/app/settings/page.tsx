"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowser } from "../../lib/supabase/client";
import { passwordResetRedirectUrl } from "../../lib/siteUrl";
import PhoneAccessSection from "./phone-access";

interface AccountUser {
  email: string | null;
  name: string | null;
}

interface PrefRow {
  scope: "global" | "business" | "obligation" | "digest";
  business_id: string | null;
  obligation_id: string | null;
  muted: boolean;
}

interface BusinessRow {
  id: string;
  legal_name: string;
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
  const [prefs, setPrefs] = useState<PrefRow[]>([]);
  const [businesses, setBusinesses] = useState<BusinessRow[]>([]);
  const [prefsBusy, setPrefsBusy] = useState(false);
  const [perBusinessOpen, setPerBusinessOpen] = useState(false);
  const [billing, setBilling] = useState<{ plan: string; planName: string; status: string; currentPeriodEnd: string | null } | null>(null);

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
    fetch("/api/notifications/preferences")
      .then((r) => r.json())
      .then((d) => setPrefs(Array.isArray(d.preferences) ? d.preferences : []))
      .catch(() => {});
    fetch("/api/businesses")
      .then((r) => r.json())
      .then((d) => setBusinesses(Array.isArray(d.businesses) ? d.businesses : []))
      .catch(() => {});
    fetch("/api/billing/status")
      .then((r) => r.json())
      .then((d) => { if (d && !d.error) setBilling(d); })
      .catch(() => {});
  }, [router]);

  const setPreference = async (pref: { scope: PrefRow["scope"]; business_id?: string; obligation_id?: string; muted: boolean }) => {
    setPrefsBusy(true);
    try {
      const res = await fetch("/api/notifications/preferences", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(pref),
      });
      if (!res.ok) throw new Error("save failed");
      setPrefs((prev) => {
        const key = (p: PrefRow) =>
          `${p.scope}:${p.business_id || ""}:${p.obligation_id || ""}`;
        const next: PrefRow = {
          scope: pref.scope,
          business_id: pref.business_id || null,
          obligation_id: pref.obligation_id || null,
          muted: pref.muted,
        };
        const rest = prev.filter((p) => key(p) !== key(next));
        return [...rest, next];
      });
    } catch {
      setError("We could not save your notification preference.");
    } finally {
      setPrefsBusy(false);
    }
  };

  const isMuted = (scope: PrefRow["scope"], businessId?: string, obligationId?: string) =>
    prefs.some(
      (p) =>
        p.scope === scope &&
        (p.business_id || null) === (businessId || null) &&
        (p.obligation_id || null) === (obligationId || null) &&
        p.muted
    );
  const globalMuted = isMuted("global");
  const digestMuted = isMuted("digest");

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
    <div className="page-viewport bg-[#f4f1ea]">
      
      <main className="mx-auto max-w-2xl px-5 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-[#161616]">Account settings</h1>
          <p className="mt-1 text-sm text-[#161616]/60">
            Manage your profile, billing, password, and sign-in for SmartPR.
          </p>
        </div>

        <section className="rounded-2xl border border-slate-200 bg-white p-6">
          {loading ? (
            <div className="text-sm text-[#161616]/50">Loading account…</div>
          ) : user ? (
            <>
            <section className="mb-6 overflow-hidden rounded-2xl bg-[#161616] text-white">
              <div className="px-6 pt-6">
                <p className="text-xs font-semibold uppercase tracking-widest text-white/50">
                  Voice access
                </p>
                <h2 className="mt-1 text-xl font-bold leading-snug">
                  Call SmartPR and get answers by voice
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-white/70">
                  Call{" "}
                  <a
                    href="tel:+17405636900"
                    className="font-semibold text-white underline decoration-white/40 underline-offset-2"
                  >
                    +1 (740) 563-6900
                  </a>{" "}
                  from your registered number and say your 6-digit voice PIN when asked.
                </p>
              </div>
              <div className="p-6 pt-4">
                <div className="rounded-xl bg-white p-5 text-[#161616]">
                  <PhoneAccessSection hideHeader />
                </div>
              </div>
            </section>
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
                <h2 className="text-sm font-semibold text-[#161616]">Billing</h2>
                <p className="mt-1 text-sm text-[#161616]/60">
                  Your SmartPR plan and what it includes.
                </p>
                <div className="mt-4 rounded-xl border border-slate-200 px-4 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-[#161616]">
                        {billing ? billing.planName : "Loading plan…"}
                      </div>
                      {billing && (
                        <div className="mt-0.5 text-xs text-[#161616]/50">
                          Status: {billing.status}
                          {billing.currentPeriodEnd ? ` · Renews ${new Date(billing.currentPeriodEnd).toLocaleDateString()}` : ""}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => router.push("/pricing")}
                      className="rounded-lg bg-[#161616] px-4 py-2 text-sm font-medium text-white"
                    >
                      {billing && billing.plan !== "free" ? "Change plan" : "View plans"}
                    </button>
                  </div>
                  <p className="mt-3 text-xs text-[#161616]/50">
                    Paid plans unlock filled government documents, deliverables, and compliance
                    reminders for your businesses.
                  </p>
                </div>
              </div>

              <div className="border-t border-slate-200 pt-6">
                <h2 className="text-sm font-semibold text-[#161616]">Notifications</h2>
                <p className="mt-1 text-sm text-[#161616]/60">
                  Deadline reminders are sent by email from alerts@getsmartpr.com — 60, 30, and 7 days
                  before a stored expiry date, plus a nudge if a filing sits untouched for 14 days.
                  Paid accounts also get a monthly compliance snapshot on the 1st of each month.
                </p>
                <label className="mt-4 flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-slate-200 px-4 py-3">
                  <span className="text-sm font-medium text-[#161616]">
                    Email deadline reminders
                    <span className="block text-xs font-normal text-[#161616]/50">
                      {globalMuted ? "Off — you won't receive reminder emails." : "On for all your businesses."}
                    </span>
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={!globalMuted}
                    disabled={prefsBusy}
                    onClick={() => setPreference({ scope: "global", muted: !globalMuted })}
                    className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${globalMuted ? "bg-slate-300" : "bg-emerald-600"}`}
                  >
                    <span
                      className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${globalMuted ? "left-0.5" : "left-[22px]"}`}
                    />
                  </button>
                </label>
                <label className="mt-4 flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-slate-200 px-4 py-3">
                  <span className="text-sm font-medium text-[#161616]">
                    Monthly compliance snapshot
                    <span className="block text-xs font-normal text-[#161616]/50">
                      {digestMuted || globalMuted
                        ? "Off — you won't receive the monthly digest."
                        : "On — a monthly summary of upcoming deadlines, stalled filings, and missing dates."}
                    </span>
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={!digestMuted && !globalMuted}
                    disabled={prefsBusy || globalMuted}
                    onClick={() => setPreference({ scope: "digest", muted: !digestMuted })}
                    className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${digestMuted || globalMuted ? "bg-slate-300" : "bg-emerald-600"}`}
                  >
                    <span
                      className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${digestMuted || globalMuted ? "left-0.5" : "left-[22px]"}`}
                    />
                  </button>
                </label>
                {businesses.length > 0 && (
                  <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
                    <button
                      type="button"
                      onClick={() => setPerBusinessOpen((open) => !open)}
                      aria-expanded={perBusinessOpen}
                      className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left"
                    >
                      <span className="text-xs font-semibold uppercase tracking-wide text-[#161616]/50">
                        Per-business reminders ({businesses.length})
                      </span>
                      <svg
                        className={`h-4 w-4 shrink-0 text-[#161616]/50 transition-transform ${perBusinessOpen ? "rotate-180" : ""}`}
                        viewBox="0 0 16 16"
                        fill="none"
                        aria-hidden="true"
                      >
                        <path
                          d="M4 6l4 4 4-4"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                    {perBusinessOpen && (
                      <div className="space-y-2 border-t border-slate-200 px-4 py-3">
                        {businesses.map((b) => {
                          const muted = isMuted("business", b.id);
                          return (
                            <label
                              key={b.id}
                              className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-slate-200 px-4 py-2.5"
                            >
                              <span className="text-sm text-[#161616]">{b.legal_name}</span>
                              <button
                                type="button"
                                role="switch"
                                aria-checked={!muted}
                                aria-label={`Reminders for ${b.legal_name}`}
                                disabled={prefsBusy || globalMuted}
                                onClick={() => setPreference({ scope: "business", business_id: b.id, muted: !muted })}
                                className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${muted || globalMuted ? "bg-slate-300" : "bg-emerald-600"}`}
                              >
                                <span
                                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${muted || globalMuted ? "left-0.5" : "left-[22px]"}`}
                                />
                              </button>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>

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
            </>
          ) : (
            <div className="text-sm text-red-700">{error || "Redirecting to sign in…"}</div>
          )}
        </section>
      </main>
    </div>
  );
}
