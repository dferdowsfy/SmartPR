"use client";

// ============================================================================
// Admin review queue + agent controls.
//
// This page intentionally explains what each agent does, displays exactly what
// the last run returned, links admins to the original sourced documents, and
// constrains discovery inputs to dropdowns instead of free-form agent prompts.
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import { TopNav } from "../../history/ui";

interface ReviewItem {
  item_kind: "rule" | "document" | "template" | "change_event";
  item_id: string;
  title: string | null;
  status: string;
  confidence_score: number | null;
  source_domain: string | null;
  source_url: string | null;
  source_file_url: string | null;
  agency_name: string | null;
  municipality: string | null;
  document_type: string | null;
  canonical_requirement_code: string | null;
  metadata_json: Record<string, unknown> | null;
  updated_at: string;
}

interface DiscoveryRunResult {
  sourcesCrawled?: { seedUrl: string; agency: string; pagesVisited: number; documentsFound: number }[];
  rulesCreated?: number;
  documentsCreated?: number;
  draftTemplatesCreated?: number;
  feeReferences?: string[];
  errors?: string[];
  note?: string;
  error?: string;
  message?: string;
}

interface MonitoringRunResult {
  results?: { runId: string | null; ruleId: string; status: string; changeDetected: boolean; summary: string }[];
  error?: string;
  message?: string;
}

type LastRun =
  | { kind: "discovery"; data: DiscoveryRunResult }
  | { kind: "monitoring"; data: MonitoringRunResult }
  | null;

const KIND_LABEL: Record<ReviewItem["item_kind"], string> = {
  rule: "Requirement rule",
  document: "Source document",
  template: "Form template",
  change_event: "Change event",
};

const ACTIONS: Record<ReviewItem["item_kind"], { action: string; label: string; primary?: boolean; help: string }[]> = {
  rule: [
    { action: "approve_rule", label: "Approve rule", primary: true, help: "Makes the discovered requirement active." },
    { action: "reject_rule", label: "Reject", help: "Deprecates the proposed requirement." },
    { action: "mark_source_stale", label: "Mark stale", help: "Keeps it in needs_review for follow-up." },
  ],
  document: [
    { action: "approve_document", label: "Approve document", primary: true, help: "Marks the sourced file as trusted for requirement packages." },
    { action: "reject_document", label: "Reject", help: "Deprecates the sourced file." },
  ],
  template: [
    { action: "approve_template", label: "Publish template", primary: true, help: "Publishes the fillable schema; prior active template is deprecated." },
    { action: "reject_template", label: "Reject", help: "Deprecates the draft template." },
  ],
  change_event: [
    { action: "accept_change", label: "Accept observation", primary: true, help: "Closes the monitoring observation as accepted; it does not overwrite forms." },
    { action: "reject_change", label: "Reject observation", help: "Closes the monitoring observation as rejected." },
  ],
};

const BUSINESS_TYPE_OPTIONS = [
  { value: "restaurant", label: "Restaurant / food service" },
  { value: "retail", label: "Retail store" },
  { value: "professional_services", label: "Professional services" },
  { value: "construction", label: "Construction / contractor" },
  { value: "tourism", label: "Tourism / hospitality" },
  { value: "healthcare", label: "Healthcare" },
];

const MUNICIPALITY_OPTIONS = ["", "San Juan", "Guaynabo", "Bayamón", "Carolina", "Ponce", "Mayagüez", "Arecibo", "Caguas"];

const SOURCE_OPTIONS = [
  { label: "All curated official sources", value: "" },
  { label: "OGPe / Permisos", value: "https://www.permisos.pr.gov/" },
  { label: "Single Business Portal", value: "https://www.sbp.pr.gov/" },
  { label: "Hacienda", value: "https://hacienda.pr.gov/" },
  { label: "Departamento de Salud", value: "https://www.salud.pr.gov/" },
  { label: "Bomberos formularios", value: "https://agencias.pr.gov/agencias/bomberos/formularios/Pages/default.aspx" },
  { label: "Departamento de Estado", value: "https://www.estado.pr.gov/" },
];

function formatMeta(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

export default function AdminRequirementsPage() {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [lastRun, setLastRun] = useState<LastRun>(null);
  const [disc, setDisc] = useState({ stateOrTerritory: "PR", municipality: "", businessType: "restaurant", seedUrl: "" });

  const queueStats = useMemo(() => {
    return items.reduce<Record<ReviewItem["item_kind"], number>>(
      (acc, item) => ({ ...acc, [item.item_kind]: acc[item.item_kind] + 1 }),
      { rule: 0, document: 0, template: 0, change_event: 0 }
    );
  }, [items]);

  const load = useCallback(async () => {
    const res = await fetch("/api/requirements/admin");
    const data = await res.json();
    setItems(data.items ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      const meRes = await fetch("/api/me");
      const me = await meRes.json();
      const admin = !!me?.user?.isAdmin;
      if (!active) return;
      setIsAdmin(admin);
      if (admin) await load();
      else setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [load]);

  const act = async (item: ReviewItem, action: string) => {
    setBusy(item.item_id + action);
    try {
      const res = await fetch("/api/requirements/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, itemId: item.item_id }),
      });
      const data = await res.json();
      setToast(data.message ?? (data.ok ? "Done." : "Failed."));
      await load();
    } finally {
      setBusy(null);
    }
  };

  const runDiscovery = async () => {
    setBusy("discover");
    try {
      const res = await fetch("/api/requirements/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stateOrTerritory: disc.stateOrTerritory,
          municipality: disc.municipality || undefined,
          businessType: disc.businessType,
          seedUrl: disc.seedUrl || undefined,
        }),
      });
      const data = (await res.json()) as DiscoveryRunResult;
      setLastRun({ kind: "discovery", data });
      setToast(data.error ? `Discovery failed: ${data.message || data.error}` : "Discovery finished. Review the run output below.");
      await load();
    } finally {
      setBusy(null);
    }
  };

  const runMonitor = async () => {
    setBusy("monitor");
    try {
      const res = await fetch("/api/requirements/monitor", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = (await res.json()) as MonitoringRunResult;
      setLastRun({ kind: "monitoring", data });
      const changed = (data.results ?? []).filter((r) => r.changeDetected).length;
      setToast(data.error ? `Monitoring failed: ${data.message || data.error}` : `Monitoring finished: ${changed} change(s) detected.`);
      await load();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="min-h-screen bg-[#f4f1ea]">
      <TopNav active="admin" />
      {isAdmin === false ? (
        <div className="mx-auto max-w-5xl px-5 py-8">
          <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center">
            <h1 className="text-xl font-bold text-[#161616]">Not authorized</h1>
            <p className="mt-2 text-sm text-[#161616]/60">
              This area is restricted to administrators. Ask an administrator to add your account to <code className="rounded bg-slate-100 px-1">ADMIN_EMAILS</code>.
            </p>
          </div>
        </div>
      ) : isAdmin === null ? (
        <div className="p-10 text-center text-[#161616]/50">Checking access…</div>
      ) : (
        <div className="mx-auto max-w-6xl px-5 py-8">
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-[#161616]">Document Discovery Review</h1>
              <p className="text-sm text-[#161616]/60">
                Discovery creates reviewable rules, source documents, versions, monitoring records, and draft schemas. Approval is explicit and never overwrites active forms.
              </p>
            </div>
            <button onClick={runMonitor} disabled={busy === "monitor"} className="rounded-full bg-[#161616] px-5 py-2 text-sm font-medium text-white disabled:opacity-50">
              {busy === "monitor" ? "Checking sources…" : "Run monitoring now"}
            </button>
          </div>

          {toast && <div className="my-3 rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800">{toast}</div>}

          <div className="grid gap-4 lg:grid-cols-[1.25fr_.75fr]">
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="text-sm font-bold text-[#161616]">Run discovery from official sources</div>
              <p className="mb-3 text-xs text-[#161616]/60">
                Choose a predefined business category and optional source. The agent crawls official pages, extracts downloadable files, checksums assets, and returns counts/errors below.
              </p>
              <div className="grid gap-2 md:grid-cols-4">
                <select className="rounded border border-slate-300 px-2 py-1.5 text-sm" value={disc.stateOrTerritory} onChange={(e) => setDisc((d) => ({ ...d, stateOrTerritory: e.target.value }))}>
                  <option value="PR">Puerto Rico</option>
                </select>
                <select className="rounded border border-slate-300 px-2 py-1.5 text-sm" value={disc.municipality} onChange={(e) => setDisc((d) => ({ ...d, municipality: e.target.value }))}>
                  {MUNICIPALITY_OPTIONS.map((m) => <option key={m || "all"} value={m}>{m || "Statewide / all municipalities"}</option>)}
                </select>
                <select className="rounded border border-slate-300 px-2 py-1.5 text-sm" value={disc.businessType} onChange={(e) => setDisc((d) => ({ ...d, businessType: e.target.value }))}>
                  {BUSINESS_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <select className="rounded border border-slate-300 px-2 py-1.5 text-sm" value={disc.seedUrl} onChange={(e) => setDisc((d) => ({ ...d, seedUrl: e.target.value }))}>
                  {SOURCE_OPTIONS.map((o) => <option key={o.label} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <button onClick={runDiscovery} disabled={busy === "discover"} className="mt-3 rounded-full bg-brand px-5 py-2 text-sm font-medium text-white disabled:opacity-50">
                {busy === "discover" ? "Crawling…" : "Run discovery"}
              </button>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="text-sm font-bold text-[#161616]">What approval does</div>
              <ul className="mt-2 space-y-1 text-xs text-[#161616]/65">
                <li><b>Approve rule:</b> activates a discovered requirement.</li>
                <li><b>Approve document:</b> marks a sourced file trusted and viewable for packages.</li>
                <li><b>Publish template:</b> activates the fillable schema and deprecates older active versions.</li>
                <li><b>Accept observation:</b> closes a monitoring alert; it does not overwrite content.</li>
              </ul>
              <div className="mt-3 grid grid-cols-4 gap-2 text-center text-xs">
                <div className="rounded bg-[#f4f1ea] p-2"><b>{queueStats.rule}</b><br />Rules</div>
                <div className="rounded bg-[#f4f1ea] p-2"><b>{queueStats.document}</b><br />Docs</div>
                <div className="rounded bg-[#f4f1ea] p-2"><b>{queueStats.template}</b><br />Templates</div>
                <div className="rounded bg-[#f4f1ea] p-2"><b>{queueStats.change_event}</b><br />Alerts</div>
              </div>
            </div>
          </div>

          {lastRun && (
            <div className="my-4 rounded-2xl border border-slate-200 bg-white p-4">
              <div className="mb-2 text-sm font-bold text-[#161616]">Last {lastRun.kind} run returned</div>
              {lastRun.kind === "discovery" ? (
                <div className="space-y-2 text-xs text-[#161616]/70">
                  <div>Rules: {lastRun.data.rulesCreated ?? 0} · Documents: {lastRun.data.documentsCreated ?? 0} · Draft templates: {lastRun.data.draftTemplatesCreated ?? 0}</div>
                  <div className="grid gap-2 md:grid-cols-2">
                    {(lastRun.data.sourcesCrawled ?? []).map((s) => (
                      <div key={s.seedUrl} className="rounded border border-slate-100 p-2">
                        <b>{s.agency}</b><br />Visited {s.pagesVisited} page(s), found {s.documentsFound} document(s).<br />
                        <a className="text-brand underline" href={s.seedUrl} target="_blank" rel="noreferrer">Open seed</a>
                      </div>
                    ))}
                  </div>
                  {(lastRun.data.errors ?? []).length > 0 && <div className="rounded bg-amber-50 p-2 text-amber-800">Warnings: {lastRun.data.errors?.slice(0, 5).join(" | ")}</div>}
                </div>
              ) : (
                <div className="grid gap-2 md:grid-cols-2">
                  {(lastRun.data.results ?? []).map((r) => (
                    <div key={r.runId || r.ruleId} className="rounded border border-slate-100 p-2 text-xs text-[#161616]/70">
                      <b>{r.status}</b> · {r.changeDetected ? "Change detected" : "No change"}<br />{r.summary}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {loading ? (
            <div className="p-10 text-center text-[#161616]/50">Loading…</div>
          ) : items.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-[#161616]/50">Nothing needs review. 🎉</div>
          ) : (
            <div className="mt-4 space-y-3">
              {items.map((item) => {
                const downloadUrl = item.source_file_url || formatMeta(item.metadata_json?.download_url);
                return (
                  <div key={item.item_kind + item.item_id} className="rounded-2xl border border-slate-200 bg-white p-5">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <span className="inline-block rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">{KIND_LABEL[item.item_kind]}</span>
                        <div className="mt-1 font-semibold text-[#161616]">{item.title || "(untitled)"}</div>
                        <div className="mt-1 flex flex-wrap gap-3 text-xs text-[#161616]/55">
                          <span>Status: {item.status}</span>
                          {item.document_type && <span>Type: {item.document_type}</span>}
                          {item.canonical_requirement_code && <span>Requirement: {item.canonical_requirement_code}</span>}
                          {item.agency_name && <span>Agency: {item.agency_name}</span>}
                          {item.municipality && <span>Municipality: {item.municipality}</span>}
                          {item.confidence_score != null && <span>Confidence: {Math.round(Number(item.confidence_score) * 100)}%</span>}
                          <span>Updated: {new Date(item.updated_at).toLocaleDateString()}</span>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2 text-xs">
                          {item.source_url && <a className="rounded-full border border-slate-300 px-3 py-1 text-[#161616]" href={item.source_url} target="_blank" rel="noreferrer">View source page</a>}
                          {downloadUrl && <a className="rounded-full border border-brand px-3 py-1 text-brand" href={downloadUrl} target="_blank" rel="noreferrer">View sourced file</a>}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2 lg:justify-end">
                        {ACTIONS[item.item_kind].map((a) => (
                          <button key={a.action} title={a.help} onClick={() => act(item, a.action)} disabled={busy === item.item_id + a.action} className={`rounded-full px-4 py-1.5 text-sm font-medium disabled:opacity-50 ${a.primary ? "bg-brand text-white" : "border border-slate-300 text-[#161616]"}`}>
                            {a.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
