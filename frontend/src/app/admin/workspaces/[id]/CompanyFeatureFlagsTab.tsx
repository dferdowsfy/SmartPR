"use client";

import { useCallback, useEffect, useState } from "react";

interface Flag {
  key: string;
  value: unknown;
  source: string | null;
  updated_by: string | null;
  updated_by_email: string | null;
  updated_at: string;
  created_at: string;
}
interface HistoryRow {
  id: string;
  key: string;
  old_value: unknown;
  new_value: unknown;
  changed_by: string | null;
  changed_by_email: string | null;
  created_at: string;
}

const inputCls =
  "rounded-lg border border-[#161616]/22 bg-[#fbf8f2] px-3 py-2 text-sm placeholder:text-[#5a5a5a] font-mono";
const btnPrimary =
  "rounded-lg bg-brand px-4 py-2 text-sm font-medium text-[#f6f3ea] disabled:opacity-50";
const btnGhost =
  "rounded-lg border border-[#161616]/22 px-3 py-1.5 text-sm font-medium text-[#161616] hover:bg-[#161616]/5 disabled:opacity-50";

function pretty(v: unknown): string {
  return typeof v === "string" ? v : JSON.stringify(v);
}

export function CompanyFeatureFlagsTab({ workspaceId }: { workspaceId: string }) {
  const [flags, setFlags] = useState<Flag[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("true");
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/workspaces/${workspaceId}/feature-flags`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not load flags.");
      setFlags(d.flags || []);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/workspaces/${workspaceId}/feature-flags/history`);
      const d = await res.json();
      if (res.ok) setHistory(d.history || []);
    } catch {
      /* non-fatal */
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (showHistory) void loadHistory();
  }, [showHistory, loadHistory]);

  function parseValue(raw: string): { ok: boolean; value?: unknown; error?: string } {
    const t = raw.trim();
    if (t === "") return { ok: false, error: "value required" };
    // Convenience: bare true/false/numbers parse as JSON; otherwise treat as string.
    if (/^(true|false|null|-?\d+(\.\d+)?)$/.test(t)) {
      try {
        return { ok: true, value: JSON.parse(t) };
      } catch {
        return { ok: false, error: "invalid value" };
      }
    }
    if ((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"))) {
      try {
        return { ok: true, value: JSON.parse(t) };
      } catch {
        return { ok: false, error: "invalid JSON" };
      }
    }
    return { ok: true, value: t };
  }

  async function saveFlag(key: string, rawValue: string) {
    const parsed = parseValue(rawValue);
    if (!parsed.ok) {
      setErr(parsed.error || "invalid value");
      return;
    }
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/workspaces/${workspaceId}/feature-flags`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key, value: parsed.value, source: "superadmin" }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Save failed.");
      setMsg(`Flag "${key}" updated.`);
      setEditingKey(null);
      setNewKey("");
      setNewValue("true");
      void load();
      if (showHistory) void loadHistory();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="py-6 text-sm text-[#5a5a5a]">Loading feature flags…</p>;

  return (
    <div className="space-y-6">
      {err && <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{err}</p>}
      {msg && <p className="rounded-lg bg-green-50 px-4 py-2 text-sm text-green-800">{msg}</p>}

      <div className="rounded-xl border border-[#161616]/15 bg-[#fbf8f2] p-5">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Feature flags</h3>
          <button className={btnGhost} onClick={() => setShowHistory((s) => !s)}>
            {showHistory ? "Hide history" : "View history"}
          </button>
        </div>
        {flags.length === 0 ? (
          <p className="mt-2 text-sm text-[#5a5a5a]">No flags set for this workspace.</p>
        ) : (
          <table className="mt-3 w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[#161616]/15 text-xs uppercase tracking-wide text-[#5a5a5a]">
                <th className="py-2 pr-3 font-medium">Key</th>
                <th className="py-2 pr-3 font-medium">Value</th>
                <th className="py-2 pr-3 font-medium">Source</th>
                <th className="py-2 pr-3 font-medium">Last edited by</th>
                <th className="py-2 pr-3 font-medium">At</th>
                <th className="py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {flags.map((f) => (
                <tr key={f.key} className="border-b border-[#161616]/8 align-top">
                  <td className="py-2 pr-3 font-mono text-xs font-medium">{f.key}</td>
                  <td className="py-2 pr-3">
                    {editingKey === f.key ? (
                      <input
                        className={`${inputCls} w-full text-xs`}
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                      />
                    ) : (
                      <span className="font-mono text-xs">{pretty(f.value)}</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-xs">
                    <span className="rounded-full bg-[#161616]/8 px-2 py-0.5">{f.source || "—"}</span>
                  </td>
                  <td className="py-2 pr-3 text-xs">{f.updated_by_email || "—"}</td>
                  <td className="whitespace-nowrap py-2 pr-3 text-xs text-[#5a5a5a]">
                    {new Date(f.updated_at).toLocaleString()}
                  </td>
                  <td className="py-2 text-right">
                    {editingKey === f.key ? (
                      <>
                        <button className={btnPrimary} disabled={busy} onClick={() => void saveFlag(f.key, editValue)}>
                          Save
                        </button>{" "}
                        <button className={btnGhost} onClick={() => setEditingKey(null)}>Cancel</button>
                      </>
                    ) : (
                      <button
                        className={btnGhost}
                        onClick={() => {
                          setEditingKey(f.key);
                          setEditValue(pretty(f.value));
                        }}
                      >
                        Edit
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="mt-4 border-t border-[#161616]/12 pt-4">
          <h4 className="text-sm font-semibold">Add flag</h4>
          <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <input className={inputCls} placeholder="flag_key" value={newKey} onChange={(e) => setNewKey(e.target.value)} />
            <input className={inputCls} placeholder='true, 10, "text", or JSON' value={newValue} onChange={(e) => setNewValue(e.target.value)} />
            <button className={btnPrimary} disabled={busy || !newKey.trim()} onClick={() => void saveFlag(newKey.trim(), newValue)}>
              Add
            </button>
          </div>
        </div>
      </div>

      {showHistory && (
        <div className="rounded-xl border border-[#161616]/15 bg-[#fbf8f2] p-5">
          <h3 className="font-semibold">Change history</h3>
          {history.length === 0 ? (
            <p className="mt-2 text-sm text-[#5a5a5a]">No changes recorded.</p>
          ) : (
            <table className="mt-3 w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[#161616]/15 text-xs uppercase tracking-wide text-[#5a5a5a]">
                  <th className="py-2 pr-3 font-medium">When</th>
                  <th className="py-2 pr-3 font-medium">Key</th>
                  <th className="py-2 pr-3 font-medium">Old → new</th>
                  <th className="py-2 font-medium">By</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} className="border-b border-[#161616]/8">
                    <td className="whitespace-nowrap py-2 pr-3 text-xs text-[#5a5a5a]">
                      {new Date(h.created_at).toLocaleString()}
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs">{h.key}</td>
                    <td className="py-2 pr-3 font-mono text-xs">
                      <span className="text-red-700 line-through">{pretty(h.old_value)}</span>
                      {" → "}
                      <span className="text-green-800">{pretty(h.new_value)}</span>
                    </td>
                    <td className="py-2 text-xs">{h.changed_by_email || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      <p className="text-xs text-[#5a5a5a]">
        Every change writes a feature_flag_history row and an audit event (source=&apos;superadmin&apos;) — nothing is silent.
      </p>
    </div>
  );
}
