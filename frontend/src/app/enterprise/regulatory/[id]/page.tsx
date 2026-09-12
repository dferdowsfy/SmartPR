// ============================================================================
// Regulatory event detail (Phase 5): source & verification metadata,
// previous vs updated rule text, affected requirements/businesses/facilities/
// projects, required actions, acknowledgment + implementation tracking.
// Verify / compute-impact / acknowledge actions are permission-gated.
// ============================================================================
"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { TopNav } from "../../../history/ui";
import { EnterpriseSubNav } from "../../_nav";
import {
  LIFECYCLE_LABELS,
  LIFECYCLE_TRANSITIONS,
  IMPLEMENTATION_STATUSES,
  type RegulatoryLifecycle,
} from "../../../../lib/enterprise-regulatory";

interface AccessWorkspace {
  id: string;
  name: string;
  permissions: string[];
}

interface Impact {
  id: string;
  obligation_id: string | null;
  business_id: string | null;
  facility_id: string | null;
  matter_id: string | null;
  required_action: string | null;
  ack_status: string;
  implementation_status: string;
  applicability: string;
  match_basis: string | null;
  obligation_name: string | null;
  obligation_agency: string | null;
  business_name: string | null;
  facility_name: string | null;
  facility_municipality: string | null;
  matter_title: string | null;
}

interface Report {
  event: {
    id: string;
    title: string;
    summary: string | null;
    lifecycle: string;
    regulatory_source: string | null;
    source_version: string | null;
    effective_date: string | null;
    verification_date: string | null;
    verified_by_email: string | null;
    reviewer_notes: string | null;
    workspace_id: string | null;
    change_event_id: string | null;
    targeting: Record<string, string[]> | null;
    prev_rule_text: string | null;
    updated_rule_text: string | null;
    created_at: string;
  };
  rollup: {
    total: number;
    acknowledged: number;
    pending_ack: number;
    not_started: number;
    in_progress: number;
    implemented: number;
    projected: number;
    confirmed: number;
  };
  affected: {
    obligations: { id: string; name: string }[];
    businesses: { id: string; name: string }[];
    facilities: { id: string; name: string }[];
    projects: { id: string; name: string }[];
  };
  impacts: Impact[];
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

const TARGETING_LABELS: Record<string, string> = {
  obligation_ids: "Obligations (reviewer picks)",
  business_ids: "Businesses (reviewer picks)",
  facility_ids: "Facilities (reviewer picks)",
  agency_names: "Agencies",
  municipalities: "Municipalities",
  business_types: "Business types",
  industries: "Industries",
  requirement_names: "Requirements",
};

function levelOf(i: Impact): "obligation" | "business" | "facility" | "project" | "other" {
  if (i.obligation_id) return "obligation";
  if (i.business_id) return "business";
  if (i.facility_id) return "facility";
  if (i.matter_id) return "project";
  return "other";
}

function impactTitle(i: Impact): string {
  return (
    i.obligation_name ??
    i.business_name ??
    i.facility_name ??
    i.matter_title ??
    "Impact"
  );
}

export default function RegulatoryEventDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: eventId } = use(params);
  const [workspaces, setWorkspaces] = useState<AccessWorkspace[] | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Verify form
  const [verifyTarget, setVerifyTarget] = useState("");
  const [verifyNotes, setVerifyNotes] = useState("");
  const [verifyVersion, setVerifyVersion] = useState("");
  // Compute-impact form
  const [actionOverride, setActionOverride] = useState("");
  const [lastCompute, setLastCompute] = useState<Record<string, unknown> | null>(null);

  const perms = useMemo(
    () => workspaces?.find((w) => w.id === workspaceId)?.permissions ?? [],
    [workspaces, workspaceId]
  );
  const canManage = perms.includes("manage_exceptions");
  const canOperate = perms.includes("edit_project_facts");

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
    (wsId: string) => {
      setLoading(true);
      setError(null);
      fetch(`/api/enterprise/regulatory/events/${eventId}/report?workspace_id=${wsId}`)
        .then(async (r) => {
          const d = await r.json();
          if (!r.ok) throw new Error(d.error || "load_failed");
          setReport(d);
        })
        .catch((e) => setError(e.message || "load_failed"))
        .finally(() => setLoading(false));
    },
    [eventId]
  );

  useEffect(() => {
    if (workspaceId) load(workspaceId);
  }, [workspaceId, load]);

  const allowedTargets = useMemo(() => {
    if (!report) return [];
    return (
      LIFECYCLE_TRANSITIONS[report.event.lifecycle as RegulatoryLifecycle] ?? []
    );
  }, [report]);

  useEffect(() => {
    setVerifyTarget(allowedTargets[0] ?? "");
  }, [allowedTargets]);

  const api = useCallback(
    async (path: string, method: string, body?: unknown) => {
      const res = await fetch(`${path}?workspace_id=${workspaceId}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.message || d.error || "request_failed");
      return d;
    },
    [workspaceId]
  );

  const doVerify = async () => {
    if (!verifyTarget) return;
    setBusy("verify");
    setActionMsg(null);
    try {
      await api(`/api/enterprise/regulatory/events/${eventId}/verify`, "POST", {
        lifecycle_target: verifyTarget,
        reviewer_notes: verifyNotes.trim() || undefined,
        source_version: verifyVersion.trim() || undefined,
      });
      setVerifyNotes("");
      setVerifyVersion("");
      setActionMsg(`Lifecycle advanced to ${LIFECYCLE_LABELS[verifyTarget as RegulatoryLifecycle]}.`);
      load(workspaceId!);
    } catch (e) {
      setActionMsg(`Verification failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const doCompute = async () => {
    setBusy("compute");
    setActionMsg(null);
    setLastCompute(null);
    try {
      const d = await api(
        `/api/enterprise/regulatory/events/${eventId}/compute-impact`,
        "POST",
        { required_action: actionOverride.trim() || undefined }
      );
      setLastCompute(d);
      setActionMsg(
        `Impact computed: ${d.matched.obligations} requirements, ${d.matched.businesses} businesses, ` +
          `${d.matched.facilities} facilities, ${d.matched.projects} projects ` +
          `(${d.applicability}).` +
          (d.obligation_work_updated > 0
            ? ` ${d.obligation_work_updated} obligation work items re-opened for remediation.`
            : "")
      );
      load(workspaceId!);
    } catch (e) {
      setActionMsg(`Compute failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const doAcknowledge = async (impactId: string) => {
    setBusy(`ack:${impactId}`);
    try {
      await api(`/api/enterprise/regulatory/impacts/${impactId}/acknowledge`, "POST");
      load(workspaceId!);
    } catch (e) {
      setActionMsg(`Acknowledge failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const doSetImplementation = async (impactId: string, status: string) => {
    setBusy(`impl:${impactId}`);
    try {
      await api(`/api/enterprise/regulatory/impacts/${impactId}`, "PATCH", {
        implementation_status: status,
      });
      load(workspaceId!);
    } catch (e) {
      setActionMsg(`Update failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const groupedImpacts = useMemo(() => {
    const g: Record<string, Impact[]> = {
      obligation: [],
      business: [],
      facility: [],
      project: [],
      other: [],
    };
    for (const i of report?.impacts ?? []) g[levelOf(i)].push(i);
    return g;
  }, [report]);

  const targeting = report?.event.targeting ?? {};
  const targetingKeys = Object.keys(targeting).filter(
    (k) => Array.isArray(targeting[k]) && targeting[k].length > 0
  );

  return (
    <div className="min-h-screen bg-[#f6f3ea] text-[#161616]">
      <TopNav active="enterprise" />
      <main className="mx-auto max-w-6xl px-4 pb-16 pt-6 sm:px-6">
        <Link
          href={`/enterprise/regulatory${workspaceId ? `?workspace_id=${workspaceId}` : ""}`}
          className="text-sm text-[#5a5a5a] hover:text-brand"
        >
          ← Regulatory changes
        </Link>

        <div className="mt-4">
          <EnterpriseSubNav active="/enterprise/regulatory" />
        </div>

        {error && (
          <p className="mt-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-800">
            Couldn&apos;t load event: {error}
          </p>
        )}
        {loading && <p className="mt-8 text-sm text-[#8a8a8a]">Loading…</p>}

        {report && (
          <>
            <div className="mt-6 rounded-xl border border-[#161616]/12 bg-white p-6">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-semibold">{report.event.title}</h1>
                <span className={`rounded-full px-2.5 py-0.5 text-xs ${BADGE[report.event.lifecycle] ?? BADGE.proposed}`}>
                  {LIFECYCLE_LABELS[report.event.lifecycle as RegulatoryLifecycle] ?? report.event.lifecycle}
                </span>
                {report.event.workspace_id === null && (
                  <span className="rounded-full bg-[#161616]/8 px-2 py-0.5 text-xs text-[#5a5a5a]">Global</span>
                )}
              </div>
              {report.event.summary && (
                <p className="mt-2 max-w-3xl text-sm text-[#161616]/75">{report.event.summary}</p>
              )}
              <dl className="mt-4 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <dt className="text-xs text-[#8a8a8a]">Regulatory source</dt>
                  <dd className="font-medium">
                    {report.event.regulatory_source ?? "—"}
                    {report.event.source_version && (
                      <span className="ml-1 font-normal text-[#5a5a5a]">({report.event.source_version})</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-[#8a8a8a]">Effective date</dt>
                  <dd>{report.event.effective_date ?? "Not set"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-[#8a8a8a]">Verification</dt>
                  <dd>
                    {report.event.verification_date
                      ? `${new Date(report.event.verification_date).toLocaleDateString()}${report.event.verified_by_email ? ` by ${report.event.verified_by_email}` : ""}`
                      : "Not yet verified"}
                  </dd>
                </div>
              </dl>
              {report.event.reviewer_notes && (
                <div className="mt-4 rounded-md bg-[#f6f3ea] p-3 text-sm">
                  <p className="text-xs font-medium text-[#8a8a8a]">Reviewer notes</p>
                  <p className="mt-1 whitespace-pre-wrap">{report.event.reviewer_notes}</p>
                </div>
              )}
            </div>

            {(report.event.prev_rule_text || report.event.updated_rule_text) && (
              <section className="mt-6" aria-label="Rule comparison">
                <h2 className="text-sm font-semibold">Previous rule vs updated rule</h2>
                <div className="mt-2 grid gap-4 md:grid-cols-2">
                  <div className="rounded-xl border border-[#161616]/12 bg-white p-4">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-[#8a8a8a]">Previous</h3>
                    <p className="mt-2 whitespace-pre-wrap text-sm">
                      {report.event.prev_rule_text ?? <span className="text-[#8a8a8a]">Not recorded</span>}
                    </p>
                  </div>
                  <div className="rounded-xl border border-brand/30 bg-white p-4">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-brand">Updated</h3>
                    <p className="mt-2 whitespace-pre-wrap text-sm">
                      {report.event.updated_rule_text ?? <span className="text-[#8a8a8a]">Not recorded</span>}
                    </p>
                  </div>
                </div>
              </section>
            )}

            {canManage && (
              <section className="mt-6 rounded-xl border border-[#161616]/12 bg-white p-5" aria-label="Reviewer actions">
                <h2 className="text-sm font-semibold">Reviewer actions</h2>
                {actionMsg && (
                  <p className="mt-2 rounded-md bg-[#f6f3ea] px-3 py-2 text-sm">{actionMsg}</p>
                )}
                <div className="mt-3 grid gap-6 md:grid-cols-2">
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-[#8a8a8a]">Verify / advance lifecycle</h3>
                    {allowedTargets.length === 0 ? (
                      <p className="mt-2 text-sm text-[#8a8a8a]">
                        This event is superseded — its lifecycle is terminal.
                      </p>
                    ) : (
                      <div className="mt-2 space-y-3">
                        <label className={labelCls}>Next stage
                          <select className={inputCls} value={verifyTarget} onChange={(e) => setVerifyTarget(e.target.value)}>
                            {allowedTargets.map((t) => (
                              <option key={t} value={t}>{LIFECYCLE_LABELS[t as RegulatoryLifecycle]}</option>
                            ))}
                          </select>
                        </label>
                        <label className={labelCls}>Reviewer notes
                          <textarea className={inputCls} rows={2} value={verifyNotes} onChange={(e) => setVerifyNotes(e.target.value)} placeholder="What was verified, and against which source…" />
                        </label>
                        <label className={labelCls}>Source version (optional)
                          <input className={inputCls} value={verifyVersion} onChange={(e) => setVerifyVersion(e.target.value)} placeholder="e.g. 2026-10" />
                        </label>
                        <button
                          type="button"
                          onClick={doVerify}
                          disabled={busy === "verify"}
                          className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-[#f6f3ea] hover:opacity-90 disabled:opacity-40"
                        >
                          {busy === "verify" ? "Verifying…" : "Verify & advance"}
                        </button>
                      </div>
                    )}
                  </div>
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-[#8a8a8a]">Compute impact</h3>
                    <p className="mt-2 text-xs text-[#5a5a5a]">
                      Re-runnable and safe: recomputes affected requirements, businesses,
                      facilities, and projects without resetting acknowledgment or
                      implementation progress.
                      {report.event.lifecycle !== "effective" && (
                        <strong className="block mt-1 text-amber-800">
                          This event is not effective — impacts will be marked projected and no
                          obligation work will be changed.
                        </strong>
                      )}
                    </p>
                    <label className={`${labelCls} mt-3`}>Required action override (optional, applies to all rows)
                      <textarea className={inputCls} rows={2} value={actionOverride} onChange={(e) => setActionOverride(e.target.value)} placeholder="Leave blank for the standard per-level action text." />
                    </label>
                    <button
                      type="button"
                      onClick={doCompute}
                      disabled={busy === "compute"}
                      className="mt-3 rounded-md border border-brand px-4 py-2 text-sm font-medium text-brand hover:bg-brand/10 disabled:opacity-40"
                    >
                      {busy === "compute" ? "Computing…" : "Compute impact"}
                    </button>
                    {lastCompute !== null && (
                      <pre className="mt-2 overflow-auto rounded-md bg-[#161616]/5 p-2 text-[11px]">
                        {JSON.stringify(lastCompute, null, 1)}
                      </pre>
                    )}
                  </div>
                </div>
              </section>
            )}

            <section className="mt-6 rounded-xl border border-[#161616]/12 bg-white p-5" aria-label="Impact summary">
              <h2 className="text-sm font-semibold">Impact summary</h2>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  ["Requirements", report.affected.obligations.length],
                  ["Businesses", report.affected.businesses.length],
                  ["Facilities", report.affected.facilities.length],
                  ["Projects", report.affected.projects.length],
                ].map(([label, n]) => (
                  <div key={label as string} className="rounded-lg bg-[#f6f3ea] p-3 text-center">
                    <p className="text-2xl font-semibold">{n as number}</p>
                    <p className="text-xs text-[#5a5a5a]">{label as string}</p>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
                <span><strong>{report.rollup.acknowledged}</strong>/{report.rollup.total} acknowledged</span>
                <span><strong>{report.rollup.not_started}</strong> not started</span>
                <span><strong>{report.rollup.in_progress}</strong> in progress</span>
                <span><strong>{report.rollup.implemented}</strong> implemented</span>
                {report.rollup.projected > 0 && (
                  <span className="text-amber-800"><strong>{report.rollup.projected}</strong> projected (not yet effective)</span>
                )}
              </div>
              <div className="mt-4">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-[#8a8a8a]">How impact was matched</h3>
                {targetingKeys.length === 0 ? (
                  <p className="mt-1 text-sm text-[#8a8a8a]">
                    No targeting recorded. Impacts were computed from reviewer-selected picks or
                    {report.event.change_event_id ? " tags derived from the linked knowledge-graph change event" : " nothing — re-run compute with targeting to match requirements"}.
                  </p>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {targetingKeys.map((k) => (
                      <span key={k} className="rounded-full bg-[#161616]/6 px-3 py-1 text-xs" title={targeting[k].join(", ")}>
                        <strong>{TARGETING_LABELS[k] ?? k}:</strong> {targeting[k].slice(0, 3).join(", ")}
                        {targeting[k].length > 3 && ` +${targeting[k].length - 3} more`}
                      </span>
                    ))}
                  </div>
                )}
                <p className="mt-2 text-xs text-[#8a8a8a]">
                  Matching is deterministic: every filled targeting group must match (exact,
                  case-insensitive). Each row below records the exact criterion that matched it.
                </p>
              </div>
            </section>

            <section className="mt-6" aria-label="Impacted items">
              <h2 className="text-sm font-semibold">Required actions & status</h2>
              {report.impacts.length === 0 ? (
                <p className="mt-2 rounded-xl border border-[#161616]/12 bg-white p-6 text-sm text-[#8a8a8a]">
                  No impacts computed yet. {canManage ? "Use “Compute impact” above to match this event against your requirements." : "A compliance manager can compute the impact."}
                </p>
              ) : (
                ([
                  ["obligation", "Requirements"],
                  ["business", "Businesses"],
                  ["facility", "Facilities"],
                  ["project", "Projects"],
                  ["other", "Other"],
                ] as const).map(([level, label]) => {
                  const list = groupedImpacts[level];
                  if (list.length === 0) return null;
                  return (
                    <div key={level} className="mt-4">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-[#5a5a5a]">
                        {label} <span className="text-[#8a8a8a]">({list.length})</span>
                      </h3>
                      <ul className="mt-2 divide-y divide-[#161616]/8 rounded-xl border border-[#161616]/12 bg-white">
                        {list.map((i) => (
                          <li key={i.id} className="px-5 py-4">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div>
                                <p className="text-sm font-medium">{impactTitle(i)}</p>
                                <p className="mt-0.5 text-xs text-[#5a5a5a]">
                                  {i.obligation_agency && <span>{i.obligation_agency} · </span>}
                                  {i.business_name && level !== "business" && <span>{i.business_name} · </span>}
                                  {i.applicability === "projected" ? (
                                    <span className="font-medium text-amber-800">Projected — not yet effective</span>
                                  ) : (
                                    <span className="font-medium text-emerald-800">Confirmed</span>
                                  )}
                                </p>
                              </div>
                              <div className="flex items-center gap-2">
                                {i.ack_status === "acknowledged" ? (
                                  <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs text-emerald-900">Acknowledged</span>
                                ) : canOperate ? (
                                  <button
                                    type="button"
                                    onClick={() => doAcknowledge(i.id)}
                                    disabled={busy === `ack:${i.id}`}
                                    className="rounded-md border border-[#161616]/15 px-3 py-1.5 text-xs hover:bg-[#161616]/5 disabled:opacity-40"
                                  >
                                    {busy === `ack:${i.id}` ? "…" : "Acknowledge"}
                                  </button>
                                ) : (
                                  <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs text-amber-900">Pending acknowledgment</span>
                                )}
                                <label className="text-xs text-[#5a5a5a]">
                                  <select
                                    className="rounded-md border border-[#161616]/15 bg-white px-2 py-1.5 text-xs"
                                    value={i.implementation_status}
                                    disabled={!canOperate || busy === `impl:${i.id}`}
                                    onChange={(e) => doSetImplementation(i.id, e.target.value)}
                                    title={canOperate ? "Implementation status" : "Requires edit permission"}
                                  >
                                    {IMPLEMENTATION_STATUSES.map((s) => (
                                      <option key={s} value={s}>
                                        {s.replace(/_/g, " ")}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                              </div>
                            </div>
                            {i.required_action && (
                              <p className="mt-2 text-sm text-[#161616]/75">{i.required_action}</p>
                            )}
                            {i.match_basis && (
                              <p className="mt-1 text-xs text-[#8a8a8a]" title={i.match_basis}>
                                Matched: {i.match_basis}
                              </p>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
