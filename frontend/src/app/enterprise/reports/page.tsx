"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { TopNav } from "../../history/ui";
import { EnterpriseSubNav } from "../_nav";

interface ReportDef {
  key: string;
  label: string;
  description: string;
  /** any of these permissions grants access */
  anyOf: string[];
}

const REPORT_DEFS: ReportDef[] = [
  { key: "readiness", label: "Readiness", description: "Project readiness scores with open/completed requirement counts.", anyOf: ["view_records"] },
  { key: "deficiencies", label: "Deficiencies", description: "Critical and high-priority open requirements.", anyOf: ["view_records"] },
  { key: "deadlines", label: "Deadlines", description: "Upcoming and overdue dates with verified/internal-target labeling.", anyOf: ["view_records"] },
  { key: "evidence-queue", label: "Evidence queue", description: "Evidence awaiting review, by workflow state.", anyOf: ["view_records"] },
  { key: "regulatory-impact", label: "Regulatory impact", description: "Verified regulatory changes and their mapped impacts.", anyOf: ["view_records"] },
  { key: "facility-comparison", label: "Facility comparison", description: "Side-by-side posture per facility.", anyOf: ["view_records"] },
  { key: "workload", label: "Workload", description: "Assignments, completion, overdue and critical counts per owner.", anyOf: ["assign_requirements", "view_records"] },
  { key: "audit-activity", label: "Audit activity", description: "Append-only audit trail for the organization.", anyOf: ["view_audit_logs"] },
];

interface AccessWorkspace {
  id: string;
  name: string;
  permissions: string[];
}

interface PreviewData {
  title: string;
  generated_at: string;
  data_as_of: string;
  filters_applied: string[];
  methodology: string[];
  summary: Array<{ label: string; value: string }>;
  columns: Array<{ key: string; label: string }>;
  records: Array<Record<string, unknown>>;
  record_count: number;
  gated_fields: string[];
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

export default function EnterpriseReportsPage() {
  const [workspaces, setWorkspaces] = useState<AccessWorkspace[] | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [report, setReport] = useState<string>("readiness");
  const [facets, setFacets] = useState<Facets>(EMPTY_FACETS);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState<"csv" | "pdf" | null>(null);

  // Filters
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [business, setBusiness] = useState("");
  const [facility, setFacility] = useState("");
  const [project, setProject] = useState("");
  const [domain, setDomain] = useState("");
  const [municipality, setMunicipality] = useState("");
  const [agency, setAgency] = useState("");
  const [department, setDepartment] = useState("");
  const [owner, setOwner] = useState("");
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [dueFrom, setDueFrom] = useState("");
  const [dueTo, setDueTo] = useState("");

  useEffect(() => {
    fetch("/api/enterprise/access")
      .then((r) => r.json())
      .then((d) => {
        const ws: AccessWorkspace[] = d.workspaces ?? [];
        setWorkspaces(ws);
        const withView = ws.filter((w) => w.permissions.includes("view_records"));
        if (withView.length > 0) {
          const fromUrl = new URLSearchParams(window.location.search).get("workspace_id");
          setWorkspaceId(withView.some((w) => w.id === fromUrl) ? fromUrl! : withView[0].id);
        }
      })
      .catch(() => setWorkspaces([]));
  }, []);

  // Facets for filter controls (from the portfolio API).
  useEffect(() => {
    if (!workspaceId) return;
    fetch(`/api/enterprise/portfolio?workspace_id=${workspaceId}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.facets) setFacets(d.facets);
      })
      .catch(() => {});
  }, [workspaceId]);

  const currentPerms = useMemo(
    () => workspaces?.find((w) => w.id === workspaceId)?.permissions ?? [],
    [workspaces, workspaceId]
  );
  const availableReports = useMemo(
    () => REPORT_DEFS.filter((r) => r.anyOf.some((p) => currentPerms.includes(p))),
    [currentPerms]
  );

  useEffect(() => {
    if (availableReports.length > 0 && !availableReports.some((r) => r.key === report)) {
      setReport(availableReports[0].key);
      setPreview(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableReports]);

  const buildQuery = useCallback(
    (format: "json" | "csv" | "pdf") => {
      const p = new URLSearchParams();
      p.set("workspace_id", workspaceId ?? "");
      p.set("format", format);
      if (from) p.set("from", from);
      if (to) p.set("to", to);
      if (business) p.set("business", business);
      if (facility) p.set("facility", facility);
      if (project) p.set("project", project);
      if (domain) p.set("domain", domain);
      if (municipality) p.set("municipality", municipality);
      if (agency) p.set("agency", agency);
      if (department) p.set("department", department);
      if (owner) p.set("owner", owner);
      if (status) p.set("status", status);
      if (priority) p.set("priority", priority);
      if (dueFrom) p.set("due_from", dueFrom);
      if (dueTo) p.set("due_to", dueTo);
      return `/api/enterprise/reports/${report}?${p.toString()}`;
    },
    [workspaceId, report, from, to, business, facility, project, domain, municipality, agency, department, owner, status, priority, dueFrom, dueTo]
  );

  const runPreview = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(buildQuery("json"));
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "report_failed");
      setPreview(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "report_failed");
      setPreview(null);
    } finally {
      setLoading(false);
    }
  }, [workspaceId, buildQuery]);

  const exportFile = async (format: "csv" | "pdf") => {
    if (!workspaceId) return;
    setExporting(format);
    setError(null);
    try {
      const r = await fetch(buildQuery(format));
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || "export_failed");
      }
      const blob = await r.blob();
      const stamp = new Date().toISOString().slice(0, 10);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `smartpr-${report}-${stamp}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "export_failed");
    } finally {
      setExporting(null);
    }
  };

  const clearFilters = () => {
    setFrom("");
    setTo("");
    setBusiness("");
    setFacility("");
    setProject("");
    setDomain("");
    setMunicipality("");
    setAgency("");
    setDepartment("");
    setOwner("");
    setStatus("");
    setPriority("");
    setDueFrom("");
    setDueTo("");
  };

  const selectCls = "rounded-md border border-[#161616]/15 bg-white px-2 py-1.5 text-sm text-[#161616]";
  const noAccess = workspaces !== null && availableReports.length === 0;

  return (
    <div className="min-h-screen bg-[#f4f1ea] text-[#161616]">
      <TopNav active="enterprise" />
      <main className="mx-auto max-w-7xl px-5 py-8 sm:px-6">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-brand">Enterprise</p>
        <h1 className="mt-2 text-3xl font-medium tracking-tight sm:text-4xl">Executive reports</h1>
        <p className="mt-2 max-w-2xl text-sm text-[#5a5a5a]">
          Point-in-time reports computed live from your records. Every generation and export is
          written to the audit trail.
        </p>

        <div className="mt-6">
          <EnterpriseSubNav active="/enterprise/reports" />
        </div>

        {noAccess ? (
          <div className="mt-10 rounded-xl border border-[#161616]/12 bg-white p-8 text-center">
            <p className="font-medium">No report access</p>
            <p className="mt-1 text-sm text-[#5a5a5a]">
              Your account doesn&apos;t have reporting permission in any organization.
            </p>
          </div>
        ) : (
          <div className="mt-6 grid gap-6 lg:grid-cols-[280px_1fr]">
            {/* Report picker */}
            <aside className="space-y-2">
              {workspaces && workspaces.length > 1 && (
                <label className="mb-3 block text-sm text-[#5a5a5a]">
                  Organization{" "}
                  <select
                    className={selectCls}
                    value={workspaceId ?? ""}
                    onChange={(e) => {
                      setWorkspaceId(e.target.value);
                      setPreview(null);
                    }}
                  >
                    {workspaces
                      .filter((w) => w.permissions.includes("view_records"))
                      .map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              {availableReports.map((r) => (
                <button
                  key={r.key}
                  type="button"
                  onClick={() => {
                    setReport(r.key);
                    setPreview(null);
                  }}
                  className={`block w-full rounded-lg border p-3 text-left transition ${
                    report === r.key
                      ? "border-brand bg-brand/5"
                      : "border-[#161616]/12 bg-white hover:border-[#161616]/25"
                  }`}
                >
                  <div className="text-sm font-semibold">{r.label}</div>
                  <div className="mt-0.5 text-xs text-[#5a5a5a]">{r.description}</div>
                </button>
              ))}
              {report === "workload" && !currentPerms.includes("view_billing") && (
                <p className="rounded-lg border border-[#161616]/12 bg-white p-3 text-xs text-[#5a5a5a]">
                  Confidential: the billing contact line in this report is visible only to
                  view_billing holders and is omitted for you.
                </p>
              )}
            </aside>

            {/* Controls + preview */}
            <div>
              <section aria-label="Report filters" className="rounded-xl border border-[#161616]/12 bg-white p-4">
                <div className="flex flex-wrap items-end gap-3">
                  <label className="text-xs text-[#5a5a5a]">
                    From
                    <input type="date" className={`${selectCls} ml-1`} value={from} onChange={(e) => setFrom(e.target.value)} />
                  </label>
                  <label className="text-xs text-[#5a5a5a]">
                    To
                    <input type="date" className={`${selectCls} ml-1`} value={to} onChange={(e) => setTo(e.target.value)} />
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
                    Domain
                    <select className={`${selectCls} ml-1`} value={domain} onChange={(e) => setDomain(e.target.value)}>
                      <option value="">All</option>
                      {facets.domains.map((d) => (
                        <option key={d} value={d}>{d}</option>
                      ))}
                    </select>
                  </label>
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
                    onClick={clearFilters}
                    className="rounded-md border border-[#161616]/15 px-3 py-1.5 text-sm text-[#161616]"
                  >
                    Clear
                  </button>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={runPreview}
                    disabled={loading || !workspaceId}
                    className="rounded-md bg-brand px-4 py-1.5 text-sm font-medium text-[#f6f3ea] disabled:opacity-50"
                  >
                    {loading ? "Generating…" : "Generate preview"}
                  </button>
                  <button
                    type="button"
                    onClick={() => exportFile("csv")}
                    disabled={exporting !== null || !workspaceId}
                    className="rounded-md border border-[#161616]/15 bg-white px-4 py-1.5 text-sm font-medium text-[#161616] disabled:opacity-50"
                  >
                    {exporting === "csv" ? "Exporting…" : "Export CSV"}
                  </button>
                  <button
                    type="button"
                    onClick={() => exportFile("pdf")}
                    disabled={exporting !== null || !workspaceId}
                    className="rounded-md border border-[#161616]/15 bg-white px-4 py-1.5 text-sm font-medium text-[#161616] disabled:opacity-50"
                  >
                    {exporting === "pdf" ? "Exporting…" : "Export PDF"}
                  </button>
                </div>
              </section>

              {error && (
                <div className="mt-4 rounded-xl border border-[#8a2f2f]/30 bg-white p-4">
                  <p className="text-sm font-medium text-[#8a2f2f]">Report failed</p>
                  <p className="mt-1 text-sm text-[#5a5a5a]">{error}</p>
                </div>
              )}

              {preview && (
                <section className="mt-6 rounded-xl border border-[#161616]/12 bg-white p-5">
                  <h2 className="text-lg font-semibold">{preview.title}</h2>
                  <p className="mt-1 text-xs text-[#5a5a5a]">
                    Generated{" "}
                    {new Date(preview.generated_at).toLocaleString("en-US", { timeZone: "America/New_York" })} ET
                    {" "}· data as of{" "}
                    {new Date(preview.data_as_of).toLocaleString("en-US", { timeZone: "America/New_York" })} ET
                    {preview.filters_applied.length > 0 &&
                      ` · Filters: ${preview.filters_applied.join(" · ")}`}
                  </p>

                  <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {preview.summary.map((s) => (
                      <div key={s.label} className="rounded-lg border border-[#161616]/10 bg-[#f4f1ea] p-3">
                        <div className="text-xs text-[#5a5a5a]">{s.label}</div>
                        <div className="mt-0.5 text-lg font-semibold">{s.value}</div>
                      </div>
                    ))}
                  </div>

                  {preview.gated_fields.length > 0 && (
                    <p className="mt-3 rounded-md bg-[#161616]/5 p-2 text-xs text-[#5a5a5a]">
                      Omitted confidential fields: {preview.gated_fields.join("; ")}
                    </p>
                  )}

                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-[#161616]/10 text-left text-xs uppercase tracking-wide text-[#5a5a5a]">
                          {preview.columns.map((c) => (
                            <th key={c.key} className="py-2 pr-4">{c.label}</th>
                          ))}
                          <th className="py-2">Record</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.records.slice(0, 25).map((r, i) => (
                          <tr key={i} className="border-b border-[#161616]/6 align-top last:border-0">
                            {preview.columns.map((c) => (
                              <td key={c.key} className="py-2 pr-4">
                                {r[c.key] === null || r[c.key] === undefined || r[c.key] === ""
                                  ? "—"
                                  : String(r[c.key])}
                              </td>
                            ))}
                            <td className="py-2">
                              {typeof r.record_url === "string" && r.record_url ? (
                                <a href={r.record_url} className="text-brand hover:underline">
                                  Open
                                </a>
                              ) : (
                                "—"
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {preview.record_count > 25 && (
                    <p className="mt-2 text-xs text-[#8a8a8a]">
                      Showing 25 of {preview.record_count} records — export for the full set.
                    </p>
                  )}

                  <div className="mt-6 border-t border-[#161616]/10 pt-4">
                    <h3 className="text-sm font-semibold">Methodology</h3>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-[#5a5a5a]">
                      {preview.methodology.map((m, i) => (
                        <li key={i}>{m}</li>
                      ))}
                    </ul>
                    <p className="mt-3 text-xs text-[#8a8a8a]">
                      Confidential — prepared for internal compliance use. Dates labeled “internal
                      target” are organizational targets, not verified government deadlines.
                    </p>
                  </div>
                </section>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
