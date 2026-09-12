// ============================================================================
// Regulatory change impact — review queue (Phase 5).
// Lists regulatory events grouped by lifecycle, with filters and a
// human-recorded "new development" form. Every event requires a
// human-entered regulatory_source; SmartPR never invents sources.
// ============================================================================
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { TopNav } from "../../history/ui";
import { EnterpriseSubNav } from "../_nav";
import { REGULATORY_LIFECYCLES, LIFECYCLE_LABELS } from "../../../lib/enterprise-regulatory";

interface AccessWorkspace {
  id: string;
  name: string;
  permissions: string[];
}

interface RegEvent {
  id: string;
  title: string;
  summary: string | null;
  lifecycle: string;
  regulatory_source: string | null;
  source_version: string | null;
  effective_date: string | null;
  verification_date: string | null;
  workspace_id: string | null;
  impact_count: number;
  acknowledged_count: number;
  created_at: string;
}

const BADGE: Record<string, string> = {
  proposed: "bg-[#161616]/8 text-[#161616]/70",
  pending_review: "bg-amber-100 text-amber-900",
  enacted_not_effective: "bg-blue-100 text-blue-900",
  effective: "bg-emerald-100 text-emerald-900",
  superseded: "bg-[#161616]/8 text-[#161616]/40 line-through",
};

const inputCls =
  "mt-1 w-full rounded-md border border-[#161616]/15 bg-white px-3 py-2 text-sm focus:border-brand focus:outline-none";
const labelCls = "block text-xs font-medium text-[#5a5a5a]";

function splitList(v: string): string[] {
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}

export default function RegulatoryQueuePage() {
  const [workspaces, setWorkspaces] = useState<AccessWorkspace[] | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [events, setEvents] = useState<RegEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lifecycleFilter, setLifecycleFilter] = useState<string>("all");
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Create-form fields
  const [fTitle, setFTitle] = useState("");
  const [fSource, setFSource] = useState("");
  const [fVersion, setFVersion] = useState("");
  const [fEffective, setFEffective] = useState("");
  const [fSummary, setFSummary] = useState("");
  const [fPrevRule, setFPrevRule] = useState("");
  const [fUpdatedRule, setFUpdatedRule] = useState("");
  const [fChangeEvent, setFChangeEvent] = useState("");
  const [fAgencies, setFAgencies] = useState("");
  const [fMunicipalities, setFMunicipalities] = useState("");
  const [fBusinessTypes, setFBusinessTypes] = useState("");
  const [fIndustries, setFIndustries] = useState("");
  const [fRequirements, setFRequirements] = useState("");

  const perms = useMemo(
    () => workspaces?.find((w) => w.id === workspaceId)?.permissions ?? [],
    [workspaces, workspaceId]
  );
  const canManage = perms.includes("manage_exceptions");

  useEffect(() => {
    fetch("/api/enterprise/access")
      .then((r) => r.json())
      .then((d) => {
        const ws: AccessWorkspace[] = (d.workspaces ?? []).filter((w: AccessWorkspace) =>
          w.permissions.includes("view_records")
        );
        setWorkspaces(ws);
        if (ws.length > 0) {
          const fromUrl = new URLSearchParams(window.location.search).get("workspace_id");
          setWorkspaceId(ws.some((w) => w.id === fromUrl) ? fromUrl! : ws[0].id);
        }
      })
      .catch(() => setWorkspaces([]));
  }, []);

  const load = useCallback(
    (wsId: string, lifecycle: string, q: string) => {
      setLoading(true);
      setError(null);
      const p = new URLSearchParams();
      if (lifecycle !== "all") p.set("lifecycle", lifecycle);
      if (q) p.set("search", q);
      fetch(`/api/enterprise/regulatory/events?workspace_id=${wsId}&${p.toString()}`)
        .then(async (r) => {
          const d = await r.json();
          if (!r.ok) throw new Error(d.error || "load_failed");
          setEvents(d.events ?? []);
        })
        .catch((e) => setError(e.message || "load_failed"))
        .finally(() => setLoading(false));
    },
    []
  );

  useEffect(() => {
    if (workspaceId) load(workspaceId, lifecycleFilter, search);
  }, [workspaceId, lifecycleFilter, search, load]);

  const grouped = useMemo(() => {
    const map = new Map<string, RegEvent[]>();
    for (const lc of REGULATORY_LIFECYCLES) map.set(lc, []);
    for (const e of events) {
      if (!map.has(e.lifecycle)) map.set(e.lifecycle, []);
      map.get(e.lifecycle)!.push(e);
    }
    return map;
  }, [events]);

  const resetCreateForm = () => {
    setFTitle(""); setFSource(""); setFVersion(""); setFEffective("");
    setFSummary(""); setFPrevRule(""); setFUpdatedRule(""); setFChangeEvent("");
    setFAgencies(""); setFMunicipalities(""); setFBusinessTypes("");
    setFIndustries(""); setFRequirements(""); setCreateError(null);
  };

  const submitCreate = async () => {
    if (!workspaceId) return;
    setCreating(true);
    setCreateError(null);
    try {
      const targeting: Record<string, string[]> = {};
      const t = {
        agency_names: splitList(fAgencies),
        municipalities: splitList(fMunicipalities),
        business_types: splitList(fBusinessTypes),
        industries: splitList(fIndustries),
        requirement_names: splitList(fRequirements),
      };
      for (const [k, v] of Object.entries(t)) if (v.length > 0) targeting[k] = v;
      const body: Record<string, unknown> = {
        title: fTitle.trim(),
        regulatory_source: fSource.trim(),
        source_version: fVersion.trim() || undefined,
        effective_date: fEffective || undefined,
        summary: fSummary.trim() || undefined,
        prev_rule_text: fPrevRule.trim() || undefined,
        updated_rule_text: fUpdatedRule.trim() || undefined,
        change_event_id: fChangeEvent.trim() || undefined,
        targeting,
      };
      const res = await fetch(`/api/enterprise/regulatory/events?workspace_id=${workspaceId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!res.ok) {
        throw new Error(d.message || d.error || "create_failed");
      }
      setShowCreate(false);
      resetCreateForm();
      load(workspaceId, lifecycleFilter, search);
    } catch (e) {
      setCreateError((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const detailHref = (id: string) =>
    `/enterprise/regulatory/${id}?workspace_id=${workspaceId}`;

  return (
    <div className="min-h-screen bg-[#f6f3ea] text-[#161616]">
      <TopNav active="enterprise" />
      <main className="mx-auto max-w-6xl px-4 pb-16 pt-6 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Regulatory changes</h1>
            <p className="mt-2 max-w-2xl text-sm text-[#5a5a5a]">
              Review queue for regulatory developments: verify the source and
              interpretation, compute the impact on your requirements, and track
              acknowledgment and implementation. Remediation is only ever
              triggered once a change is <em>effective</em>.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {workspaces && workspaces.length > 1 && (
              <label className="text-sm text-[#5a5a5a]">
                Organization{" "}
                <select
                  className="rounded-md border border-[#161616]/15 bg-white px-2 py-1.5 text-sm"
                  value={workspaceId ?? ""}
                  onChange={(e) => setWorkspaceId(e.target.value)}
                >
                  {workspaces.map((w) => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              </label>
            )}
            {canManage && (
              <button
                type="button"
                onClick={() => { resetCreateForm(); setShowCreate(true); }}
                className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-[#f6f3ea] hover:opacity-90"
              >
                Record development
              </button>
            )}
          </div>
        </div>

        <div className="mt-6">
          <EnterpriseSubNav active="/enterprise/regulatory" />
        </div>

        {workspaces && workspaces.length === 0 && (
          <div className="mt-10 rounded-xl border border-[#161616]/12 bg-white p-8 text-center">
            <p className="font-medium">No enterprise access</p>
            <p className="mt-1 text-sm text-[#5a5a5a]">
              Your account doesn&apos;t have record-viewing permission in any organization.
            </p>
          </div>
        )}

        {workspaceId && (
          <>
            <section aria-label="Filters" className="mt-6 rounded-xl border border-[#161616]/12 bg-white p-4">
              <div className="flex flex-wrap items-end gap-3">
                <label className="text-xs text-[#5a5a5a]">
                  Lifecycle
                  <select
                    className={`${inputCls} ml-1 w-auto`}
                    value={lifecycleFilter}
                    onChange={(e) => setLifecycleFilter(e.target.value)}
                  >
                    <option value="all">All stages</option>
                    {REGULATORY_LIFECYCLES.map((lc) => (
                      <option key={lc} value={lc}>{LIFECYCLE_LABELS[lc as keyof typeof LIFECYCLE_LABELS]}</option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-[#5a5a5a]">
                  Search
                  <input
                    className={`${inputCls} ml-1 w-64`}
                    placeholder="Title, summary, or source…"
                    value={searchDraft}
                    onChange={(e) => setSearchDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") setSearch(searchDraft.trim()); }}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => setSearch(searchDraft.trim())}
                  className="rounded-md border border-[#161616]/15 px-3 py-2 text-sm hover:bg-[#161616]/5"
                >
                  Apply
                </button>
                {search && (
                  <button
                    type="button"
                    onClick={() => { setSearch(""); setSearchDraft(""); }}
                    className="rounded-md px-3 py-2 text-sm text-[#5a5a5a] hover:bg-[#161616]/5"
                  >
                    Clear
                  </button>
                )}
              </div>
            </section>

            {error && (
              <p className="mt-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-800">
                Couldn&apos;t load regulatory events: {error}
              </p>
            )}

            {loading ? (
              <p className="mt-8 text-sm text-[#8a8a8a]">Loading…</p>
            ) : events.length === 0 ? (
              <div className="mt-8 rounded-xl border border-[#161616]/12 bg-white p-8 text-center">
                <p className="font-medium">No regulatory developments recorded</p>
                <p className="mt-1 text-sm text-[#5a5a5a]">
                  {canManage
                    ? "Record the first development to start the review workflow."
                    : "A compliance manager can record regulatory developments here."}
                </p>
              </div>
            ) : lifecycleFilter === "all" ? (
              <div className="mt-6 space-y-8">
                {REGULATORY_LIFECYCLES.map((lc) => {
                  const list = grouped.get(lc) ?? [];
                  if (list.length === 0) return null;
                  return (
                    <section key={lc} aria-label={LIFECYCLE_LABELS[lc as keyof typeof LIFECYCLE_LABELS]}>
                      <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-[#5a5a5a]">
                        <span className={`rounded-full px-2.5 py-0.5 text-xs normal-case ${BADGE[lc]}`}>
                          {LIFECYCLE_LABELS[lc as keyof typeof LIFECYCLE_LABELS]}
                        </span>
                        <span className="text-[#8a8a8a]">{list.length}</span>
                      </h2>
                      <ul className="mt-3 divide-y divide-[#161616]/8 rounded-xl border border-[#161616]/12 bg-white">
                        {list.map((e) => <EventRow key={e.id} e={e} href={detailHref(e.id)} />)}
                      </ul>
                    </section>
                  );
                })}
              </div>
            ) : (
              <ul className="mt-6 divide-y divide-[#161616]/8 rounded-xl border border-[#161616]/12 bg-white">
                {events.map((e) => <EventRow key={e.id} e={e} href={detailHref(e.id)} />)}
              </ul>
            )}
          </>
        )}
      </main>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Record regulatory development">
          <div className="my-8 w-full max-w-2xl rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold">Record regulatory development</h2>
            <p className="mt-1 text-sm text-[#5a5a5a]">
              Record what changed, citing the <strong>official source</strong> you verified it
              from. New developments always start as <em>Proposed</em> and move through the
              verification workflow.
            </p>
            {createError && (
              <p className="mt-3 rounded-md bg-red-50 px-4 py-3 text-sm text-red-800">{createError}</p>
            )}
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className={labelCls}>Title *
                <input className={inputCls} value={fTitle} onChange={(e) => setFTitle(e.target.value)} placeholder="e.g. OGPe Permiso Único fee schedule update" />
              </label>
              <label className={labelCls}>Regulatory source * <span className="font-normal">(official, human-verified)</span>
                <input className={inputCls} value={fSource} onChange={(e) => setFSource(e.target.value)} placeholder="e.g. OGPe — official fee schedule" />
              </label>
              <label className={labelCls}>Source version
                <input className={inputCls} value={fVersion} onChange={(e) => setFVersion(e.target.value)} placeholder="e.g. 2026-09" />
              </label>
              <label className={labelCls}>Effective date
                <input type="date" className={inputCls} value={fEffective} onChange={(e) => setFEffective(e.target.value)} />
              </label>
              <label className={`${labelCls} sm:col-span-2`}>Summary
                <textarea className={inputCls} rows={3} value={fSummary} onChange={(e) => setFSummary(e.target.value)} placeholder="What changed, in plain language." />
              </label>
              <label className={labelCls}>Previous rule text
                <textarea className={inputCls} rows={3} value={fPrevRule} onChange={(e) => setFPrevRule(e.target.value)} placeholder="How the requirement read before." />
              </label>
              <label className={labelCls}>Updated rule text
                <textarea className={inputCls} rows={3} value={fUpdatedRule} onChange={(e) => setFUpdatedRule(e.target.value)} placeholder="How the requirement reads now." />
              </label>
              <label className={`${labelCls} sm:col-span-2`}>Linked change-detection event (optional UUID)
                <input className={inputCls} value={fChangeEvent} onChange={(e) => setFChangeEvent(e.target.value)} placeholder="requirement_change_events id" />
              </label>
            </div>
            <h3 className="mt-5 text-sm font-semibold">Impact targeting</h3>
            <p className="mt-1 text-xs text-[#5a5a5a]">
              Comma-separated. An obligation matches when <strong>every filled group</strong> matches
              (exact, case-insensitive). Leave all blank to compute zero impacts, or link a
              change-detection event above to derive agency / municipality / business-type tags
              from the knowledge graph.
            </p>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <label className={labelCls}>Agency names
                <input className={inputCls} value={fAgencies} onChange={(e) => setFAgencies(e.target.value)} placeholder="OGPe, Departamento de Hacienda" />
              </label>
              <label className={labelCls}>Municipalities
                <input className={inputCls} value={fMunicipalities} onChange={(e) => setFMunicipalities(e.target.value)} placeholder="San Juan" />
              </label>
              <label className={labelCls}>Business types
                <input className={inputCls} value={fBusinessTypes} onChange={(e) => setFBusinessTypes(e.target.value)} placeholder="Manufacturing" />
              </label>
              <label className={labelCls}>Industries
                <input className={inputCls} value={fIndustries} onChange={(e) => setFIndustries(e.target.value)} placeholder="Manufacturing" />
              </label>
              <label className={`${labelCls} sm:col-span-2`}>Requirement names
                <input className={inputCls} value={fRequirements} onChange={(e) => setFRequirements(e.target.value)} placeholder="Permiso Único" />
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={() => setShowCreate(false)} className="rounded-md px-4 py-2 text-sm text-[#5a5a5a] hover:bg-[#161616]/5">
                Cancel
              </button>
              <button
                type="button"
                onClick={submitCreate}
                disabled={creating || !fTitle.trim() || !fSource.trim()}
                className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-[#f6f3ea] hover:opacity-90 disabled:opacity-40"
              >
                {creating ? "Recording…" : "Record development"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EventRow({ e, href }: { e: RegEvent; href: string }) {
  const ackPct = e.impact_count > 0 ? Math.round((e.acknowledged_count / e.impact_count) * 100) : 0;
  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={href} className="text-sm font-medium hover:text-brand">{e.title}</Link>
        <span className={`rounded-full px-2 py-0.5 text-xs ${BADGE[e.lifecycle] ?? BADGE.proposed}`}>
          {LIFECYCLE_LABELS[e.lifecycle as keyof typeof LIFECYCLE_LABELS] ?? e.lifecycle}
        </span>
        {e.workspace_id === null && (
          <span className="rounded-full bg-[#161616]/8 px-2 py-0.5 text-xs text-[#5a5a5a]">Global</span>
        )}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#5a5a5a]">
        {e.regulatory_source && <span>Source: {e.regulatory_source}{e.source_version ? ` (${e.source_version})` : ""}</span>}
        {e.effective_date && <span>Effective: {e.effective_date}</span>}
        {e.verification_date && <span>Verified: {new Date(e.verification_date).toLocaleDateString()}</span>}
      </div>
      {e.summary && <p className="mt-1 line-clamp-2 text-sm text-[#161616]/70">{e.summary}</p>}
      <div className="mt-2 flex items-center gap-3 text-xs text-[#5a5a5a]">
        <span>{e.impact_count} impacted</span>
        {e.impact_count > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-24 overflow-hidden rounded-full bg-[#161616]/10">
              <span className="block h-full rounded-full bg-emerald-600" style={{ width: `${ackPct}%` }} />
            </span>
            {e.acknowledged_count}/{e.impact_count} acknowledged
          </span>
        )}
      </div>
    </li>
  );
}
