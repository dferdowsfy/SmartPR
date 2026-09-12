"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useEnterpriseWorkspaces } from "../../_lib/useEnterpriseWorkspaces";

interface AuditEvent {
  id: string;
  created_at: string;
  actor_user_id: string | null;
  actor_email: string | null;
  actor_name: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  source: string | null;
  reason: string | null;
  ip: string | null;
  user_agent: string | null;
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

/** Flatten a JSON value to dotted-path rows for the diff view. */
function flatten(v: unknown, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  if (v && typeof v === "object" && !Array.isArray(v)) {
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      for (const [pk, pv] of flatten(val, prefix ? `${prefix}.${k}` : k)) out.set(pk, pv);
    }
  } else if (Array.isArray(v)) {
    out.set(prefix || "(root)", JSON.stringify(v));
  } else {
    out.set(prefix || "(root)", v == null ? "—" : String(v));
  }
  return out;
}

function DiffView({ before, after }: { before: unknown; after: unknown }) {
  const rows = useMemo(() => {
    const b = flatten(before);
    const a = flatten(after);
    const keys = [...new Set([...b.keys(), ...a.keys()])].sort();
    return keys.map((k) => {
      const bv = b.get(k);
      const av = a.get(k);
      const kind = bv === undefined ? "added" : av === undefined ? "removed" : bv === av ? "same" : "changed";
      return { key: k, before: bv, after: av, kind };
    });
  }, [before, after]);

  if (rows.length === 0) return <p className="text-sm text-[#5a5a5a]">No payload recorded.</p>;
  return (
    <table className="w-full text-left text-xs">
      <thead>
        <tr className="border-b border-[#161616]/15 text-[#5a5a5a]">
          <th className="py-2 pr-2 font-medium">Field</th>
          <th className="py-2 pr-2 font-medium">Before</th>
          <th className="py-2 font-medium">After</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr
            key={r.key}
            className={
              "border-b border-[#161616]/8 align-top " +
              (r.kind === "added"
                ? "bg-green-50"
                : r.kind === "removed"
                  ? "bg-red-50"
                  : r.kind === "changed"
                    ? "bg-amber-50"
                    : "")
            }
          >
            <td className="py-1.5 pr-2 font-mono text-[11px]">{r.key}</td>
            <td className="max-w-[220px] break-words py-1.5 pr-2 font-mono text-[11px]">
              {r.kind === "added" ? "—" : r.before}
            </td>
            <td className="max-w-[220px] break-words py-1.5 font-mono text-[11px]">
              {r.kind === "removed" ? "—" : r.after}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AuditInner() {
  const { workspaces, workspace, workspaceId } = useEnterpriseWorkspaces();
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<AuditEvent | null>(null);

  const [fAction, setFAction] = useState("");
  const [fActor, setFActor] = useState("");
  const [fTargetType, setFTargetType] = useState("");
  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo] = useState("");
  const [fSearch, setFSearch] = useState("");

  const load = useCallback(
    async (p: number) => {
      if (!workspaceId) return;
      setLoading(true);
      setErr(null);
      try {
        const q = new URLSearchParams({
          workspace_id: workspaceId,
          page: String(p),
          page_size: "25",
        });
        if (fAction.trim()) q.set("action", fAction.trim());
        if (fActor.trim()) q.set("actor", fActor.trim());
        if (fTargetType.trim()) q.set("target_type", fTargetType.trim());
        if (fFrom) q.set("date_from", fFrom);
        if (fTo) q.set("date_to", fTo);
        if (fSearch.trim()) q.set("search", fSearch.trim());
        const res = await fetch(`/api/enterprise/audit?${q.toString()}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not load audit events.");
        setEvents(data.events || []);
        setTotal(data.total || 0);
        setPage(data.page || p);
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [workspaceId, fAction, fActor, fTargetType, fFrom, fTo, fSearch]
  );

  useEffect(() => {
    setPage(1);
  }, [workspaceId]);
  useEffect(() => {
    void load(1);
  }, [workspaceId]); // eslint-disable-line react-hooks/exhaustive-deps

  const applyFilters = () => void load(1);

  const exportCsv = () => {
    if (!workspaceId) return;
    const q = new URLSearchParams({ workspace_id: workspaceId, format: "csv", page_size: "200" });
    if (fAction.trim()) q.set("action", fAction.trim());
    if (fActor.trim()) q.set("actor", fActor.trim());
    if (fTargetType.trim()) q.set("target_type", fTargetType.trim());
    if (fFrom) q.set("date_from", fFrom);
    if (fTo) q.set("date_to", fTo);
    if (fSearch.trim()) q.set("search", fSearch.trim());
    window.location.href = `/api/enterprise/audit?${q.toString()}`;
  };

  const totalPages = Math.max(1, Math.ceil(total / 25));

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-[#5a5a5a]">
            Organization administration
          </p>
          <h1 className="mt-1 text-3xl font-bold">Audit log</h1>
          {workspace && (
            <p className="mt-1 text-sm text-[#5a5a5a]">
              {workspace.name} · append-only · scoped to your organization
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <select
            className={inputCls}
            value={workspaceId ?? ""}
            onChange={(e) => {
              if (e.target.value)
                window.location.search = `?workspace=${encodeURIComponent(e.target.value)}`;
            }}
          >
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
          <button className={btnGhost} onClick={exportCsv} disabled={!workspaceId}>
            Export CSV
          </button>
        </div>
      </div>

      <div className="mt-5 grid gap-3 rounded-xl border border-[#161616]/15 bg-[#fbf8f2] p-4 sm:grid-cols-3 lg:grid-cols-6">
        <input className={inputCls} placeholder="Action (exact)" value={fAction} onChange={(e) => setFAction(e.target.value)} />
        <input className={inputCls} placeholder="Actor (email or id)" value={fActor} onChange={(e) => setFActor(e.target.value)} />
        <input className={inputCls} placeholder="Target type" value={fTargetType} onChange={(e) => setFTargetType(e.target.value)} />
        <input className={inputCls} type="date" value={fFrom} onChange={(e) => setFFrom(e.target.value)} aria-label="From date" />
        <input className={inputCls} type="date" value={fTo} onChange={(e) => setFTo(e.target.value)} aria-label="To date" />
        <input className={inputCls} placeholder="Search…" value={fSearch} onChange={(e) => setFSearch(e.target.value)} />
      </div>
      <div className="mt-3 flex gap-2">
        <button className={btnPrimary} onClick={applyFilters} disabled={loading}>
          Apply filters
        </button>
        <button
          className={btnGhost}
          onClick={() => {
            setFAction(""); setFActor(""); setFTargetType(""); setFFrom(""); setFTo(""); setFSearch("");
          }}
        >
          Clear
        </button>
      </div>

      {err && <p className="mt-4 text-sm text-red-700">{err}</p>}
      {loading && <p className="mt-4 text-sm text-[#5a5a5a]">Loading…</p>}

      {!loading && !err && (
        <>
          <p className="mt-4 text-sm text-[#5a5a5a]">
            {total} event{total === 1 ? "" : "s"}
          </p>
          <div className="mt-2 overflow-x-auto rounded-xl border border-[#161616]/15 bg-[#fbf8f2]">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[#161616]/15 text-xs uppercase tracking-wide text-[#5a5a5a]">
                  <th className="px-4 py-3 font-medium">When</th>
                  <th className="px-4 py-3 font-medium">Actor</th>
                  <th className="px-4 py-3 font-medium">Action</th>
                  <th className="px-4 py-3 font-medium">Target</th>
                  <th className="px-4 py-3 font-medium">Source</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr
                    key={e.id}
                    className="cursor-pointer border-b border-[#161616]/8 hover:bg-[#161616]/[0.03]"
                    onClick={() => setSelected(e)}
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
                      <span className="rounded-full bg-[#161616]/8 px-2 py-0.5">{e.source || "—"}</span>
                    </td>
                  </tr>
                ))}
                {events.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-sm text-[#5a5a5a]">
                      No events match these filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex items-center gap-3 text-sm">
            <button className={btnGhost} disabled={page <= 1} onClick={() => void load(page - 1)}>
              ← Prev
            </button>
            <span className="text-[#5a5a5a]">
              Page {page} of {totalPages}
            </span>
            <button className={btnGhost} disabled={page >= totalPages} onClick={() => void load(page + 1)}>
              Next →
            </button>
          </div>
        </>
      )}

      {selected && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/30"
          onClick={() => setSelected(null)}
        >
          <div
            className="h-full w-full max-w-xl overflow-y-auto bg-[#fbf8f2] p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <h2 className="font-mono text-lg font-semibold">{selected.action}</h2>
              <button className={btnGhost} onClick={() => setSelected(null)}>
                Close
              </button>
            </div>
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex gap-2"><dt className="w-32 shrink-0 text-[#5a5a5a]">When</dt><dd>{new Date(selected.created_at).toLocaleString()}</dd></div>
              <div className="flex gap-2"><dt className="w-32 shrink-0 text-[#5a5a5a]">Actor</dt><dd className="break-all">{selected.actor_email || selected.actor_user_id || "—"}{selected.actor_name ? ` (${selected.actor_name})` : ""}</dd></div>
              <div className="flex gap-2"><dt className="w-32 shrink-0 text-[#5a5a5a]">Target</dt><dd className="font-mono text-xs">{selected.target_type || "—"}{selected.target_id ? ` · ${selected.target_id}` : ""}</dd></div>
              <div className="flex gap-2"><dt className="w-32 shrink-0 text-[#5a5a5a]">Source</dt><dd>{selected.source || "—"}</dd></div>
              <div className="flex gap-2"><dt className="w-32 shrink-0 text-[#5a5a5a]">Reason</dt><dd className="break-words">{selected.reason || "—"}</dd></div>
              <div className="flex gap-2"><dt className="w-32 shrink-0 text-[#5a5a5a]">IP</dt><dd className="font-mono text-xs">{selected.ip || "—"}</dd></div>
              <div className="flex gap-2"><dt className="w-32 shrink-0 text-[#5a5a5a]">User agent</dt><dd className="break-all font-mono text-xs">{selected.user_agent || "—"}</dd></div>
              <div className="flex gap-2"><dt className="w-32 shrink-0 text-[#5a5a5a]">Correlation</dt><dd className="font-mono text-xs">{selected.correlation_id || "—"}</dd></div>
              <div className="flex gap-2"><dt className="w-32 shrink-0 text-[#5a5a5a]">Event ID</dt><dd className="font-mono text-xs">{selected.id}</dd></div>
            </dl>
            <h3 className="mt-6 text-sm font-semibold">Before / after</h3>
            <div className="mt-2">
              <DiffView before={selected.before} after={selected.after} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function EnterpriseAuditPage() {
  return (
    <div className="min-h-screen bg-[#f4f1ea] text-[#161616]">
      <Suspense fallback={<p className="px-6 py-8 text-sm">Loading…</p>}>
        <AuditInner />
      </Suspense>
    </div>
  );
}
