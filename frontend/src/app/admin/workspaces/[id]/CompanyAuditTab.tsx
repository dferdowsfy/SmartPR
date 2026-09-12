"use client";

import { Fragment, useCallback, useEffect, useState } from "react";

interface AuditEvent {
  id: string;
  created_at: string;
  actor_user_id: string | null;
  actor_email: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  source: string | null;
  reason: string | null;
  ip: string | null;
  correlation_id: string | null;
  before: unknown;
  after: unknown;
}

const inputCls =
  "rounded-lg border border-[#161616]/22 bg-[#fbf8f2] px-3 py-2 text-sm placeholder:text-[#5a5a5a]";
const btnPrimary =
  "rounded-lg bg-brand px-4 py-2 text-sm font-medium text-[#f6f3ea] disabled:opacity-50";
const btnGhost =
  "rounded-lg border border-[#161616]/22 px-4 py-2 text-sm font-medium text-[#161616] hover:bg-[#161616]/5 disabled:opacity-50";

function pretty(v: unknown): string {
  if (v == null) return "—";
  return typeof v === "string" ? v : JSON.stringify(v, null, 1);
}

/**
 * Superadmin cross-org audit view for one workspace. Same event envelope as
 * the org audit log, plus the source filter (so support-access actions with
 * source='superadmin' are easy to isolate).
 */
export function CompanyAuditTab({ workspaceId }: { workspaceId: string }) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const [fAction, setFAction] = useState("");
  const [fActor, setFActor] = useState("");
  const [fTargetType, setFTargetType] = useState("");
  const [fSource, setFSource] = useState("");
  const [fSearch, setFSearch] = useState("");

  const load = useCallback(
    async (p: number) => {
      setLoading(true);
      setErr(null);
      try {
        const q = new URLSearchParams({ page: String(p), page_size: "25" });
        if (fAction.trim()) q.set("action", fAction.trim());
        if (fActor.trim()) q.set("actor", fActor.trim());
        if (fTargetType.trim()) q.set("target_type", fTargetType.trim());
        if (fSource) q.set("source", fSource);
        if (fSearch.trim()) q.set("search", fSearch.trim());
        const res = await fetch(`/api/admin/workspaces/${workspaceId}/audit?${q.toString()}`);
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || "Could not load audit events.");
        setEvents(d.events || []);
        setTotal(d.total || 0);
        setPage(d.page || p);
        setExpanded(null);
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [workspaceId, fAction, fActor, fTargetType, fSource, fSearch]
  );

  useEffect(() => {
    void load(1);
  }, [workspaceId]); // eslint-disable-line react-hooks/exhaustive-deps

  const exportCsv = () => {
    const q = new URLSearchParams({ format: "csv", page_size: "200" });
    if (fAction.trim()) q.set("action", fAction.trim());
    if (fActor.trim()) q.set("actor", fActor.trim());
    if (fTargetType.trim()) q.set("target_type", fTargetType.trim());
    if (fSource) q.set("source", fSource);
    if (fSearch.trim()) q.set("search", fSearch.trim());
    window.location.href = `/api/admin/workspaces/${workspaceId}/audit?${q.toString()}`;
  };

  const totalPages = Math.max(1, Math.ceil(total / 25));

  return (
    <div className="space-y-4">
      {err && <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{err}</p>}

      <div className="grid gap-2 rounded-xl border border-[#161616]/15 bg-[#fbf8f2] p-4 sm:grid-cols-3 lg:grid-cols-6">
        <input className={inputCls} placeholder="Action (exact)" value={fAction} onChange={(e) => setFAction(e.target.value)} />
        <input className={inputCls} placeholder="Actor (email or id)" value={fActor} onChange={(e) => setFActor(e.target.value)} />
        <input className={inputCls} placeholder="Target type" value={fTargetType} onChange={(e) => setFTargetType(e.target.value)} />
        <select className={inputCls} value={fSource} onChange={(e) => setFSource(e.target.value)}>
          <option value="">All sources</option>
          {["ui", "api", "automation", "superadmin"].map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <input className={inputCls} placeholder="Search…" value={fSearch} onChange={(e) => setFSearch(e.target.value)} />
        <div className="flex gap-2">
          <button className={btnPrimary} onClick={() => void load(1)} disabled={loading}>Filter</button>
          <button className={btnGhost} onClick={exportCsv}>CSV</button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-[#5a5a5a]">Loading…</p>
      ) : (
        <>
          <p className="text-sm text-[#5a5a5a]">{total} event{total === 1 ? "" : "s"}</p>
          <div className="overflow-x-auto rounded-xl border border-[#161616]/15 bg-[#fbf8f2]">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[#161616]/15 text-xs uppercase tracking-wide text-[#5a5a5a]">
                  <th className="px-4 py-3 font-medium">When</th>
                  <th className="px-4 py-3 font-medium">Actor</th>
                  <th className="px-4 py-3 font-medium">Action</th>
                  <th className="px-4 py-3 font-medium">Target</th>
                  <th className="px-4 py-3 font-medium">Source</th>
                  <th className="px-4 py-3 font-medium">Reason</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <Fragment key={e.id}>
                    <tr
                      className="cursor-pointer border-b border-[#161616]/8 hover:bg-[#161616]/[0.03]"
                      onClick={() => setExpanded(expanded === e.id ? null : e.id)}
                    >
                      <td className="whitespace-nowrap px-4 py-2.5 text-xs text-[#5a5a5a]">
                        {new Date(e.created_at).toLocaleString()}
                      </td>
                      <td className="px-4 py-2.5 text-xs">{e.actor_email || e.actor_user_id?.slice(0, 8) || "—"}</td>
                      <td className="px-4 py-2.5 font-mono text-xs">{e.action}</td>
                      <td className="px-4 py-2.5 font-mono text-xs">
                        {e.target_type ? `${e.target_type}:${(e.target_id || "").slice(0, 8)}` : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-xs">
                        <span
                          className={
                            "rounded-full px-2 py-0.5 " +
                            (e.source === "superadmin" ? "bg-amber-100 font-medium text-amber-800" : "bg-[#161616]/8")
                          }
                        >
                          {e.source || "—"}
                        </span>
                      </td>
                      <td className="max-w-[240px] truncate px-4 py-2.5 text-xs text-[#5a5a5a]">
                        {e.reason || "—"}
                      </td>
                    </tr>
                    {expanded === e.id && (
                      <tr className="bg-[#161616]/[0.02]">
                        <td colSpan={6} className="px-4 py-3">
                          <div className="grid gap-4 text-xs lg:grid-cols-3">
                            <div>
                              <p className="font-semibold">Envelope</p>
                              <dl className="mt-1 space-y-1 font-mono text-[11px]">
                                <div>ID: {e.id}</div>
                                <div>IP: {e.ip || "—"}</div>
                                <div>Correlation: {e.correlation_id || "—"}</div>
                              </dl>
                            </div>
                            <div>
                              <p className="font-semibold">Before</p>
                              <pre className="mt-1 max-h-48 overflow-auto rounded bg-[#161616]/5 p-2 font-mono text-[11px]">
                                {pretty(e.before)}
                              </pre>
                            </div>
                            <div>
                              <p className="font-semibold">After</p>
                              <pre className="mt-1 max-h-48 overflow-auto rounded bg-[#161616]/5 p-2 font-mono text-[11px]">
                                {pretty(e.after)}
                              </pre>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
                {events.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-sm text-[#5a5a5a]">
                      No events match these filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <button className={btnGhost} disabled={page <= 1} onClick={() => void load(page - 1)}>← Prev</button>
            <span className="text-[#5a5a5a]">Page {page} of {totalPages}</span>
            <button className={btnGhost} disabled={page >= totalPages} onClick={() => void load(page + 1)}>Next →</button>
          </div>
        </>
      )}
    </div>
  );
}
