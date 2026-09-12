"use client";

import { useCallback, useEffect, useState } from "react";

interface Grant {
  id: string;
  granted_to_email: string;
  reason: string;
  scope: string;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
}

const DURATIONS = [
  { key: "15m", label: "15 minutes" },
  { key: "1h", label: "1 hour" },
  { key: "4h", label: "4 hours" },
  { key: "24h", label: "24 hours" },
];

const inputCls =
  "rounded-lg border border-[#161616]/22 bg-[#fbf8f2] px-3 py-2 text-sm placeholder:text-[#5a5a5a]";
const btnPrimary =
  "rounded-lg bg-brand px-4 py-2 text-sm font-medium text-[#f6f3ea] disabled:opacity-50";
const btnDanger =
  "rounded-lg border border-red-700/40 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50";

export function CompanySupportAccessTab({ workspaceId }: { workspaceId: string }) {
  const [grants, setGrants] = useState<Grant[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [reason, setReason] = useState("");
  const [duration, setDuration] = useState("1h");
  const [scope, setScope] = useState("read_only");

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/workspaces/${workspaceId}/overview`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not load grants.");
      setGrants(d.support_access?.recent || []);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function grant() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/workspaces/${workspaceId}/support-access`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: reason.trim(), duration, scope }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Grant failed.");
      setMsg(
        `Support access granted until ${new Date(d.grant.expires_at).toLocaleString()}. The banner is now visible on all /admin pages.`
      );
      setReason("");
      void load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(g: Grant) {
    if (!confirm(`Revoke support access for ${g.granted_to_email}?`)) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await fetch(
        `/api/admin/workspaces/${workspaceId}/support-access/${g.id}/revoke`,
        { method: "POST" }
      );
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Revoke failed.");
      setMsg("Grant revoked.");
      void load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const now = new Date();
  const isActive = (g: Grant) => !g.revoked_at && new Date(g.expires_at) > now;

  if (loading) return <p className="py-6 text-sm text-[#5a5a5a]">Loading support access…</p>;

  return (
    <div className="space-y-6">
      {err && <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{err}</p>}
      {msg && <p className="rounded-lg bg-green-50 px-4 py-2 text-sm text-green-800">{msg}</p>}

      <div className="rounded-xl border border-amber-600/30 bg-amber-50 p-5">
        <h3 className="font-semibold">Grant support access</h3>
        <p className="mt-1 text-xs text-[#5a5a5a]">
          Reason-bound and time-limited. While a grant is active a banner shows on every
          /admin page, and every action you take is audited with source=&apos;superadmin&apos;.
          There is no invisible impersonation.
        </p>
        <div className="mt-3 space-y-3">
          <div>
            <label className="text-xs font-medium text-[#5a5a5a]">
              Reason <span className="text-red-700">*required</span>
            </label>
            <textarea
              className={`${inputCls} mt-1 w-full`}
              rows={2}
              placeholder="e.g. Investigating onboarding failure reported by the customer (ticket #1234)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs font-medium text-[#5a5a5a]">
                Duration <span className="text-red-700">*required</span>
              </label>
              <select className={`${inputCls} mt-1 w-full`} value={duration} onChange={(e) => setDuration(e.target.value)}>
                {DURATIONS.map((d) => (
                  <option key={d.key} value={d.key}>{d.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-[#5a5a5a]">Scope</label>
              <select className={`${inputCls} mt-1 w-full`} value={scope} onChange={(e) => setScope(e.target.value)}>
                <option value="read_only">read_only (view records, billing, audit logs)</option>
                <option value="read_write">read_write (full — use sparingly)</option>
              </select>
            </div>
          </div>
          <button className={btnPrimary} disabled={busy || !reason.trim()} onClick={() => void grant()}>
            {busy ? "Granting…" : "Grant support access"}
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-[#161616]/15 bg-[#fbf8f2] p-5">
        <h3 className="font-semibold">Grants</h3>
        {grants.length === 0 ? (
          <p className="mt-2 text-sm text-[#5a5a5a]">No support-access grants for this workspace.</p>
        ) : (
          <table className="mt-3 w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[#161616]/15 text-xs uppercase tracking-wide text-[#5a5a5a]">
                <th className="py-2 pr-3 font-medium">To</th>
                <th className="py-2 pr-3 font-medium">Reason</th>
                <th className="py-2 pr-3 font-medium">Scope</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 pr-3 font-medium">Expires</th>
                <th className="py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {grants.map((g) => (
                <tr key={g.id} className="border-b border-[#161616]/8 align-top">
                  <td className="py-2 pr-3 text-xs font-medium">{g.granted_to_email}</td>
                  <td className="max-w-[260px] break-words py-2 pr-3 text-xs">{g.reason}</td>
                  <td className="py-2 pr-3 text-xs">
                    <span className="rounded-full bg-[#161616]/8 px-2 py-0.5">{g.scope}</span>
                  </td>
                  <td className="py-2 pr-3 text-xs">
                    {isActive(g) ? (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800">active</span>
                    ) : g.revoked_at ? (
                      <span className="text-red-700">revoked</span>
                    ) : (
                      <span className="text-[#5a5a5a]">expired</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap py-2 pr-3 text-xs text-[#5a5a5a]">
                    {new Date(g.expires_at).toLocaleString()}
                  </td>
                  <td className="py-2 text-right">
                    {isActive(g) ? (
                      <button className={btnDanger} disabled={busy} onClick={() => void revoke(g)}>
                        Revoke
                      </button>
                    ) : (
                      <span className="text-xs text-[#5a5a5a]">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
