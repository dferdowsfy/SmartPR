"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { TopNav } from "../history/ui";
import { EnterpriseSubNav } from "./_nav";

interface Metric {
  key: string;
  label: string;
  value: number | null;
  href: string;
  note?: string;
}

interface FacilityRow {
  id: string;
  name: string;
  municipality: string | null;
  business_name: string | null;
  readiness: number | null;
  open_requirements: number;
  href: string;
}

interface ProjectRow {
  id: string;
  title: string;
  business_name: string;
  status: string;
  readiness: number | null;
  due_date: string | null;
  date_label: string;
  href: string;
}

interface OwnerRow {
  id: string;
  name: string | null;
  email: string | null;
  total: number;
  completed: number;
  overdue: number;
  critical: number;
}

interface DeptRow {
  department: string;
  total: number;
  completed: number;
  overdue: number;
}

interface RenewalRow {
  id: string;
  label: string;
  due_date: string;
  recurrence_rule: string | null;
  date_label: string;
  obligation_name: string | null;
  business_name: string | null;
  href: string;
}

interface RegEvent {
  id: string;
  title: string;
  summary: string | null;
  lifecycle: string;
  regulatory_source: string | null;
  effective_date: string | null;
  verification_date: string;
  affected_facilities: string[];
  affected_facility_count: number;
  href: string;
}

interface Facets {
  municipalities: string[];
  agencies: string[];
  departments: string[];
  owners: Array<{ id: string; name: string | null; email: string | null }>;
  statuses: string[];
  priorities: string[];
  businesses: Array<{ id: string; name: string }>;
  facilities: Array<{ id: string; name: string }>;
  projects: Array<{ id: string; name: string }>;
  domains: string[];
}

interface PortfolioData {
  workspace_id: string;
  generated_at: string;
  data_as_of: string;
  filters_applied: string[];
  metrics: Metric[];
  readiness: { overall: number | null; by_facility: FacilityRow[]; by_project: ProjectRow[] };
  workload: { by_owner: OwnerRow[]; by_department: DeptRow[]; unassigned_open: number };
  upcoming_renewals: RenewalRow[];
  regulatory: { recent: RegEvent[]; affected_facility_count: number };
  facets: Facets;
}

interface AccessWorkspace {
  id: string;
  name: string;
  permissions: string[];
}

function fmtDate(s: string | null): string {
  if (!s) return "—";
  try {
    return new Date(s + "T00:00:00").toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return s;
  }
}

function StatCard({ m }: { m: Metric }) {
  return (
    <Link
      href={m.href}
      className="block rounded-xl border border-[#161616]/12 bg-white p-4 transition hover:border-brand hover:shadow-sm"
    >
      <div className="text-xs font-medium uppercase tracking-wide text-[#5a5a5a]">{m.label}</div>
      <div className="mt-1 text-3xl font-semibold text-[#161616]">
        {m.value === null ? "—" : m.key === "overall_readiness" ? `${m.value}%` : m.value}
      </div>
      {m.note && <div className="mt-1 text-[11px] text-[#8a8a8a]">{m.note}</div>}
    </Link>
  );
}

function ReadinessBar({ value }: { value: number | null }) {
  if (value === null) return <span className="text-xs text-[#8a8a8a]">No scored projects</span>;
  const color = value >= 90 ? "#1f5a3a" : value >= 70 ? "#245c5c" : value >= 40 ? "#8a5a12" : "#8a2f2f";
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-32 overflow-hidden rounded-full bg-[#161616]/10">
        <div className="h-full rounded-full" style={{ width: `${value}%`, background: color }} />
      </div>
      <span className="text-xs font-medium" style={{ color }}>
        {value}%
      </span>
    </div>
  );
}

const EMPTY_FACETS: Facets = {
  municipalities: [],
  agencies: [],
  departments: [],
  owners: [],
  statuses: [],
  priorities: [],
  businesses: [],
  facilities: [],
  projects: [],
  domains: [],
};

export default function EnterprisePortfolioPage() {
  const [workspaces, setWorkspaces] = useState<AccessWorkspace[] | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [data, setData] = useState<PortfolioData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [regEvents, setRegEvents] = useState<RegEvent[] | null>(null);

  // Filter drafts (applied on "Apply").
  const [municipality, setMunicipality] = useState("");
  const [business, setBusiness] = useState("");
  const [facility, setFacility] = useState("");
  const [project, setProject] = useState("");
  const [domain, setDomain] = useState("");
  const [agency, setAgency] = useState("");
  const [department, setDepartment] = useState("");
  const [owner, setOwner] = useState("");
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [dueFrom, setDueFrom] = useState("");
  const [dueTo, setDueTo] = useState("");
  const [appliedQs, setAppliedQs] = useState("");

  // Workspace access probe.
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

  const load = useCallback((wsId: string, qs: string) => {
    setError(null);
    setData(null);
    fetch(`/api/enterprise/portfolio?workspace_id=${wsId}${qs ? `&${qs}` : ""}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "load_failed");
        setData(d);
      })
      .catch((e) => setError(e.message || "load_failed"));
  }, []);

  useEffect(() => {
    if (workspaceId) load(workspaceId, appliedQs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  // Regulatory changes card: Phase 5 endpoint when it exists, else fall back
  // to the portfolio payload; empty state when neither is available.
  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    fetch(`/api/enterprise/regulatory/events?workspace_id=${workspaceId}&limit=5`)
      .then(async (r) => {
        if (!r.ok) throw new Error("unavailable");
        const d = await r.json();
        if (!cancelled) setRegEvents(d.events ?? d.recent ?? []);
      })
      .catch(() => {
        if (!cancelled) setRegEvents(null);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const applyFilters = () => {
    const p = new URLSearchParams();
    if (municipality) p.set("municipality", municipality);
    if (business) p.set("business", business);
    if (facility) p.set("facility", facility);
    if (project) p.set("project", project);
    if (domain) p.set("domain", domain);
    if (agency) p.set("agency", agency);
    if (department) p.set("department", department);
    if (owner) p.set("owner", owner);
    if (status) p.set("status", status);
    if (priority) p.set("priority", priority);
    if (dueFrom) p.set("due_from", dueFrom);
    if (dueTo) p.set("due_to", dueTo);
    const qs = p.toString();
    setAppliedQs(qs);
    if (workspaceId) load(workspaceId, qs);
  };

  const clearFilters = () => {
    setMunicipality("");
    setBusiness("");
    setFacility("");
    setProject("");
    setDomain("");
    setAgency("");
    setDepartment("");
    setOwner("");
    setStatus("");
    setPriority("");
    setDueFrom("");
    setDueTo("");
    setAppliedQs("");
    if (workspaceId) load(workspaceId, "");
  };

  const facets: Facets = data?.facets ?? EMPTY_FACETS;
  const regulatoryCards: RegEvent[] = useMemo(() => {
    if (regEvents && regEvents.length > 0) return regEvents;
    return data?.regulatory.recent ?? [];
  }, [regEvents, data]);

  const noAccess = workspaces !== null && workspaces.length === 0;

  const selectCls =
    "rounded-md border border-[#161616]/15 bg-white px-2 py-1.5 text-sm text-[#161616]";

  return (
    <div className="min-h-screen bg-[#f4f1ea] text-[#161616]">
      <TopNav active="enterprise" />
      <main className="mx-auto max-w-7xl px-5 py-8 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-brand">
              Enterprise
            </p>
            <h1 className="mt-2 text-3xl font-medium tracking-tight sm:text-4xl">
              Portfolio dashboard
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-[#5a5a5a]">
              Live compliance posture across every business, facility, and project in this
              organization. Every metric drills down into the work queue.
            </p>
          </div>
          {workspaces && workspaces.length > 1 && (
            <label className="text-sm text-[#5a5a5a]">
              Organization{" "}
              <select
                className={selectCls}
                value={workspaceId ?? ""}
                onChange={(e) => setWorkspaceId(e.target.value)}
              >
                {workspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <div className="mt-6">
          <EnterpriseSubNav active="/enterprise" />
        </div>

        {noAccess ? (
          <div className="mt-10 rounded-xl border border-[#161616]/12 bg-white p-8 text-center">
            <p className="font-medium">No enterprise access</p>
            <p className="mt-1 text-sm text-[#5a5a5a]">
              Your account doesn&apos;t have record-viewing permission in any organization.
            </p>
          </div>
        ) : (
          <>
            {/* Filter bar */}
            <section aria-label="Portfolio filters" className="mt-6 rounded-xl border border-[#161616]/12 bg-white p-4">
              <div className="flex flex-wrap items-end gap-3">
                <label className="text-xs text-[#5a5a5a]">
                  Municipality
                  <select className={`${selectCls} ml-1`} value={municipality} onChange={(e) => setMunicipality(e.target.value)}>
                    <option value="">All</option>
                    {facets.municipalities.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-[#5a5a5a]">
                  Business
                  <select className={`${selectCls} ml-1`} value={business} onChange={(e) => setBusiness(e.target.value)}>
                    <option value="">All</option>
                    {facets.businesses.map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-[#5a5a5a]">
                  Facility
                  <select className={`${selectCls} ml-1`} value={facility} onChange={(e) => setFacility(e.target.value)}>
                    <option value="">All</option>
                    {facets.facilities.map((f) => (
                      <option key={f.id} value={f.id}>{f.name}</option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-[#5a5a5a]">
                  Project
                  <select className={`${selectCls} ml-1`} value={project} onChange={(e) => setProject(e.target.value)}>
                    <option value="">All</option>
                    {facets.projects.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-[#5a5a5a]">
                  Regulatory domain
                  <select className={`${selectCls} ml-1`} value={domain} onChange={(e) => setDomain(e.target.value)}>
                    <option value="">All</option>
                    {facets.domains.map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-[#5a5a5a]">
                  Agency
                  <select className={`${selectCls} ml-1`} value={agency} onChange={(e) => setAgency(e.target.value)}>
                    <option value="">All</option>
                    {facets.agencies.map((a) => (
                      <option key={a} value={a}>{a}</option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-[#5a5a5a]">
                  Department
                  <select className={`${selectCls} ml-1`} value={department} onChange={(e) => setDepartment(e.target.value)}>
                    <option value="">All</option>
                    {facets.departments.map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-[#5a5a5a]">
                  Owner
                  <select className={`${selectCls} ml-1`} value={owner} onChange={(e) => setOwner(e.target.value)}>
                    <option value="">All</option>
                    {facets.owners.map((o) => (
                      <option key={o.id} value={o.id}>{o.name || o.email}</option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-[#5a5a5a]">
                  Status
                  <select className={`${selectCls} ml-1`} value={status} onChange={(e) => setStatus(e.target.value)}>
                    <option value="">All</option>
                    {facets.statuses.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-[#5a5a5a]">
                  Priority
                  <select className={`${selectCls} ml-1`} value={priority} onChange={(e) => setPriority(e.target.value)}>
                    <option value="">All</option>
                    {facets.priorities.map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-[#5a5a5a]">
                  Due from
                  <input type="date" className={`${selectCls} ml-1`} value={dueFrom} onChange={(e) => setDueFrom(e.target.value)} />
                </label>
                <label className="text-xs text-[#5a5a5a]">
                  Due to
                  <input type="date" className={`${selectCls} ml-1`} value={dueTo} onChange={(e) => setDueTo(e.target.value)} />
                </label>
                <button
                  type="button"
                  onClick={applyFilters}
                  className="rounded-md bg-brand px-4 py-1.5 text-sm font-medium text-[#f6f3ea]"
                >
                  Apply
                </button>
                <button
                  type="button"
                  onClick={clearFilters}
                  className="rounded-md border border-[#161616]/15 px-4 py-1.5 text-sm text-[#161616]"
                >
                  Clear
                </button>
              </div>
              {data && data.filters_applied.length > 0 && (
                <p className="mt-2 text-xs text-[#5a5a5a]">
                  Filters: {data.filters_applied.join(" · ")}
                </p>
              )}
            </section>

            {error ? (
              <div className="mt-10 rounded-xl border border-[#8a2f2f]/30 bg-white p-8 text-center">
                <p className="font-medium text-[#8a2f2f]">Couldn&apos;t load portfolio data</p>
                <p className="mt-1 text-sm text-[#5a5a5a]">{error}</p>
                <button
                  type="button"
                  onClick={() => workspaceId && load(workspaceId, appliedQs)}
                  className="mt-4 rounded-md bg-brand px-4 py-1.5 text-sm font-medium text-[#f6f3ea]"
                >
                  Retry
                </button>
              </div>
            ) : !data ? (
              <p className="mt-10 text-sm text-[#5a5a5a]">Loading portfolio…</p>
            ) : (
              <>
                {/* Stat cards */}
                <section aria-label="Portfolio metrics" className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                  {data.metrics.map((m) => (
                    <StatCard key={m.key} m={m} />
                  ))}
                </section>

                <div className="mt-8 grid gap-6 lg:grid-cols-2">
                  {/* Readiness by facility */}
                  <section className="rounded-xl border border-[#161616]/12 bg-white p-5">
                    <h2 className="text-base font-semibold">Readiness by facility</h2>
                    <p className="mt-1 text-xs text-[#5a5a5a]">
                      Facilities roll up the project readiness of their linked business.
                    </p>
                    {data.readiness.by_facility.length === 0 ? (
                      <p className="mt-4 text-sm text-[#8a8a8a]">No facilities in scope.</p>
                    ) : (
                      <ul className="mt-4 space-y-3">
                        {data.readiness.by_facility.map((f) => (
                          <li key={f.id}>
                            <div className="flex items-baseline justify-between gap-2">
                              <Link href={f.href} className="text-sm font-medium hover:text-brand">
                                {f.name}
                              </Link>
                              <span className="text-xs text-[#8a8a8a]">
                                {f.municipality ?? "—"} · {f.open_requirements} open
                              </span>
                            </div>
                            <div className="mt-1">
                              <ReadinessBar value={f.readiness} />
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>

                  {/* Regulatory changes */}
                  <section className="rounded-xl border border-[#161616]/12 bg-white p-5">
                    <h2 className="text-base font-semibold">Recent regulatory changes</h2>
                    <p className="mt-1 text-xs text-[#5a5a5a]">
                      Verified changes and the facilities they affect.
                    </p>
                    {regulatoryCards.length === 0 ? (
                      <p className="mt-4 text-sm text-[#8a8a8a]">
                        No verified regulatory changes yet. Regulatory change tracking will appear
                        here once available.
                      </p>
                    ) : (
                      <ul className="mt-4 divide-y divide-[#161616]/8">
                        {regulatoryCards.map((ev) => (
                          <li key={ev.id} className="py-3">
                            <Link href={ev.href ?? "/enterprise/regulatory"} className="text-sm font-medium hover:text-brand">
                              {ev.title}
                            </Link>
                            <div className="mt-1 text-xs text-[#5a5a5a]">
                              {ev.regulatory_source ?? "Source on file"} · effective{" "}
                              {fmtDate(ev.effective_date)} · verified{" "}
                              {fmtDate(ev.verification_date?.slice(0, 10) ?? null)}
                            </div>
                            <div className="mt-1 text-xs text-[#5a5a5a]">
                              Affected facilities:{" "}
                              {ev.affected_facilities.length > 0
                                ? ev.affected_facilities.join(", ")
                                : "none mapped yet"}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                </div>

                {/* Readiness by project */}
                <section className="mt-6 rounded-xl border border-[#161616]/12 bg-white p-5">
                  <h2 className="text-base font-semibold">Readiness by project</h2>
                  {data.readiness.by_project.length === 0 ? (
                    <p className="mt-4 text-sm text-[#8a8a8a]">No projects in scope.</p>
                  ) : (
                    <div className="mt-4 overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-[#161616]/10 text-left text-xs uppercase tracking-wide text-[#5a5a5a]">
                            <th className="py-2 pr-4">Project</th>
                            <th className="py-2 pr-4">Business</th>
                            <th className="py-2 pr-4">Status</th>
                            <th className="py-2 pr-4">Readiness</th>
                            <th className="py-2">Due</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.readiness.by_project.map((p) => (
                            <tr key={p.id} className="border-b border-[#161616]/6 last:border-0">
                              <td className="py-2 pr-4">
                                <Link href={p.href} className="font-medium hover:text-brand">
                                  {p.title}
                                </Link>
                              </td>
                              <td className="py-2 pr-4 text-[#5a5a5a]">{p.business_name}</td>
                              <td className="py-2 pr-4 text-[#5a5a5a]">{p.status}</td>
                              <td className="py-2 pr-4">
                                <ReadinessBar value={p.readiness} />
                              </td>
                              <td className="py-2 text-[#5a5a5a]">
                                {fmtDate(p.due_date)}{" "}
                                {p.due_date && (
                                  <span className="text-[11px] text-[#8a8a8a]">({p.date_label})</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>

                <div className="mt-6 grid gap-6 lg:grid-cols-2">
                  {/* Workload by owner */}
                  <section className="rounded-xl border border-[#161616]/12 bg-white p-5">
                    <h2 className="text-base font-semibold">Progress by owner</h2>
                    {data.workload.by_owner.length === 0 ? (
                      <p className="mt-4 text-sm text-[#8a8a8a]">
                        No owned requirements in scope.
                        {data.workload.unassigned_open > 0 && (
                          <>
                            {" "}
                            <Link href="/enterprise/work?view=unassigned" className="text-brand hover:underline">
                              {data.workload.unassigned_open} open without an owner
                            </Link>
                            .
                          </>
                        )}
                      </p>
                    ) : (
                      <div className="mt-4 overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-[#161616]/10 text-left text-xs uppercase tracking-wide text-[#5a5a5a]">
                              <th className="py-2 pr-4">Owner</th>
                              <th className="py-2 pr-4">Assigned</th>
                              <th className="py-2 pr-4">Done</th>
                              <th className="py-2 pr-4">Overdue</th>
                              <th className="py-2">Critical</th>
                            </tr>
                          </thead>
                          <tbody>
                            {data.workload.by_owner.map((o) => (
                              <tr key={o.id} className="border-b border-[#161616]/6 last:border-0">
                                <td className="py-2 pr-4 font-medium">{o.name || o.email}</td>
                                <td className="py-2 pr-4">{o.total}</td>
                                <td className="py-2 pr-4">{o.completed}</td>
                                <td className="py-2 pr-4">{o.overdue}</td>
                                <td className="py-2">{o.critical}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>

                  {/* Workload by department + renewals */}
                  <div className="space-y-6">
                    <section className="rounded-xl border border-[#161616]/12 bg-white p-5">
                      <h2 className="text-base font-semibold">Progress by department</h2>
                      {data.workload.by_department.length === 0 ? (
                        <p className="mt-4 text-sm text-[#8a8a8a]">No department data in scope.</p>
                      ) : (
                        <div className="mt-4 overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b border-[#161616]/10 text-left text-xs uppercase tracking-wide text-[#5a5a5a]">
                                <th className="py-2 pr-4">Department</th>
                                <th className="py-2 pr-4">Assigned</th>
                                <th className="py-2 pr-4">Done</th>
                                <th className="py-2">Overdue</th>
                              </tr>
                            </thead>
                            <tbody>
                              {data.workload.by_department.map((d) => (
                                <tr key={d.department} className="border-b border-[#161616]/6 last:border-0">
                                  <td className="py-2 pr-4 font-medium">{d.department}</td>
                                  <td className="py-2 pr-4">{d.total}</td>
                                  <td className="py-2 pr-4">{d.completed}</td>
                                  <td className="py-2">{d.overdue}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </section>

                    <section className="rounded-xl border border-[#161616]/12 bg-white p-5">
                      <h2 className="text-base font-semibold">Upcoming renewals</h2>
                      {data.upcoming_renewals.length === 0 ? (
                        <p className="mt-4 text-sm text-[#8a8a8a]">No upcoming renewals scheduled.</p>
                      ) : (
                        <ul className="mt-4 divide-y divide-[#161616]/8">
                          {data.upcoming_renewals.slice(0, 8).map((r) => (
                            <li key={r.id} className="py-2">
                              <Link href={r.href} className="text-sm font-medium hover:text-brand">
                                {r.label}
                              </Link>
                              <div className="text-xs text-[#5a5a5a]">
                                {fmtDate(r.due_date)} ({r.date_label})
                                {r.business_name ? ` · ${r.business_name}` : ""}
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>
                  </div>
                </div>

                <p className="mt-8 text-xs text-[#8a8a8a]">
                  Data as of {new Date(data.data_as_of).toLocaleString("en-US", { timeZone: "America/New_York" })} ET.
                  Dates labeled “internal target” are organizational targets, not verified government
                  deadlines. Metrics reflect the filters currently applied.
                </p>
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
