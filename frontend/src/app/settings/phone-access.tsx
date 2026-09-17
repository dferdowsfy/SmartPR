"use client";

import { useCallback, useEffect, useState } from "react";

interface PhoneStatus {
  enrolled: boolean;
  enabled: boolean;
  phone_display?: string;
  last_verified_at?: string | null;
  locked?: boolean;
}

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-[#161616]";

export default function PhoneAccessSection() {
  const [status, setStatus] = useState<PhoneStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [currentPin, setCurrentPin] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"view" | "enroll" | "change">("view");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/voice/settings");
      const data = (await response.json()) as PhoneStatus;
      setStatus(data);
      if (data.enrolled) setMode("view");
      else setMode("enroll");
    } catch {
      setError("We could not load your phone access settings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const submit = async (url: string, body: Record<string, string>) => {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.message || data.error || "Something went wrong.");
        return;
      }
      setPin("");
      setNewPin("");
      setCurrentPin("");
      await refresh();
      return data;
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const enroll = async (event: React.FormEvent) => {
    event.preventDefault();
    const data = await submit("/api/voice/settings/enroll", { phone, pin });
    if (data) setMessage(`Phone access enabled for ${data.phone_display}.`);
  };

  const changePin = async (event: React.FormEvent) => {
    event.preventDefault();
    const data = await submit("/api/voice/settings/pin", {
      current_pin: currentPin,
      new_pin: newPin,
    });
    if (data) {
      setMessage(
        data.action === "pin_reset"
          ? "Your voice PIN was reset."
          : "Your voice PIN was changed."
      );
      setMode("view");
    }
  };

  const disable = async () => {
    if (!window.confirm("Turn off phone access? Your PIN will stop working for voice calls.")) return;
    const data = await submit("/api/voice/settings/disable", {});
    if (data) setMessage("Phone access is turned off.");
  };

  if (loading) {
    return <p className="text-sm text-[#161616]/50">Loading phone access…</p>;
  }

  return (
    <div>
      <h2 className="text-sm font-semibold text-[#161616]">Phone access</h2>
      <p className="mt-1 text-sm text-[#161616]/60">
        Call SmartPR from your registered phone number and use your 6-digit voice PIN to
        check requirements, deadlines, and readiness by voice. Your PIN is stored as a
        secure hash — never as plain text.
      </p>

      {message && (
        <div role="status" className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {message}
        </div>
      )}
      {error && (
        <div role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {status?.enrolled && status.enabled && mode === "view" && (
        <div className="mt-4 space-y-3">
          <div className="rounded-lg bg-[#f4f1ea] px-3 py-2.5 text-sm text-[#161616]">
            <span className="font-medium">{status.phone_display}</span>
            <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
              Enabled
            </span>
            {status.locked && (
              <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
                Temporarily locked — try again later
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setMode("change")}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-[#161616]"
            >
              Change or reset PIN
            </button>
            <button
              type="button"
              onClick={disable}
              disabled={busy}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-red-700 disabled:opacity-50"
            >
              Turn off
            </button>
          </div>
        </div>
      )}

      {status?.enrolled && !status.enabled && mode === "view" && (
        <div className="mt-4">
          <p className="text-sm text-[#161616]/60">
            Phone access is turned off for {status.phone_display}. Re-enroll below to turn it
            back on.
          </p>
          <button
            type="button"
            onClick={() => setMode("enroll")}
            className="mt-3 rounded-lg bg-[#161616] px-5 py-2.5 text-sm font-medium text-white"
          >
            Re-enroll phone access
          </button>
        </div>
      )}

      {mode === "enroll" && (
        <form onSubmit={enroll} className="mt-4 space-y-4">
          <div>
            <label htmlFor="voice-phone" className="mb-1 block text-xs font-semibold text-[#161616]/70">
              Phone number
            </label>
            <input
              id="voice-phone"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              className={inputClass}
              placeholder="(787) 555-0142"
              autoComplete="tel"
              inputMode="tel"
            />
          </div>
          <div>
            <label htmlFor="voice-pin" className="mb-1 block text-xs font-semibold text-[#161616]/70">
              6-digit voice PIN
            </label>
            <input
              id="voice-pin"
              value={pin}
              onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))}
              className={inputClass}
              placeholder="••••••"
              inputMode="numeric"
              autoComplete="new-password"
              maxLength={6}
            />
            <p className="mt-1 text-xs text-[#161616]/50">
              You’ll say this PIN when you call. Five wrong tries locks it for 15 minutes.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy || pin.length !== 6 || !phone.trim()}
              className="rounded-lg bg-[#161616] px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {busy ? "Saving…" : "Enable phone access"}
            </button>
            {status?.enrolled && (
              <button
                type="button"
                onClick={() => setMode("view")}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-[#161616]"
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      )}

      {mode === "change" && (
        <form onSubmit={changePin} className="mt-4 space-y-4">
          <div>
            <label htmlFor="voice-current-pin" className="mb-1 block text-xs font-semibold text-[#161616]/70">
              Current PIN <span className="font-normal text-[#161616]/50">(leave blank if you forgot it)</span>
            </label>
            <input
              id="voice-current-pin"
              value={currentPin}
              onChange={(event) => setCurrentPin(event.target.value.replace(/\D/g, "").slice(0, 6))}
              className={inputClass}
              placeholder="••••••"
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
            />
          </div>
          <div>
            <label htmlFor="voice-new-pin" className="mb-1 block text-xs font-semibold text-[#161616]/70">
              New 6-digit PIN
            </label>
            <input
              id="voice-new-pin"
              value={newPin}
              onChange={(event) => setNewPin(event.target.value.replace(/\D/g, "").slice(0, 6))}
              className={inputClass}
              placeholder="••••••"
              inputMode="numeric"
              autoComplete="new-password"
              maxLength={6}
            />
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy || newPin.length !== 6}
              className="rounded-lg bg-[#161616] px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save new PIN"}
            </button>
            <button
              type="button"
              onClick={() => setMode("view")}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-[#161616]"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
