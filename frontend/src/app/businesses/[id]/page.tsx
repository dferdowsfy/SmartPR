"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle, ArrowRight, Bell, Building2, CalendarDays, CheckCircle2,
  ChevronDown, Download, FileText, FolderOpen, MapPin, ShieldAlert, Upload,
} from "lucide-react";
import { TopNav, ScorePill, fmtDate, fmtDateTime } from "../../history/ui";
import { StatusBadge } from "../../components/compliance/StatusBadge";
import { DUE_DATE_UNKNOWN_MESSAGE, type DueDateSource, type ObligationStatus } from "../../compliance/types";

interface BusinessRecord {
  id: string; public_id: string | null; name: string; legal_name: string | null; entity_number: string | null;
  municipality: string | null; business_type: string | null; onboarding_mode: "NEW" | "EXISTING";
  business_structure: string | null; industry: string | null; physical_address: string | null;
  notes: string | null; created_at: string | null;
}
interface Matter { id: string; matter_type: string; title: string; status: string; readiness_score: number | null; opened_at: string; completed_at: string | null; submission_id: string | null; due_date: string | null; due_date_source: DueDateSource; source_reference: string | null }
interface Obligation { id: string; name: string; agency: string | null; matter_id?: string | null; matter_title: string | null; requirement_id?: string | null; form_id?: string | null; status: ObligationStatus; due_date: string | null; due_date_source: DueDateSource; source_reference: string | null; next_action: string }
interface Evidence { id: string; original_filename: string; obligation_name: string | null; review_status: string; created_at: string }
interface Submission { id: string; created_at: string; business_type: string | null; municipality: string | null; readiness_score: number | null }
interface Deliverable { id: string; filename: string; kind: string; generated_at: string }
interface Notification { id: string; message: string; scheduled_for: string; status: string }

interface Detail {
  business?: BusinessRecord;
  overall_readiness?: number | null;
  matters?: Matter[];
  obligations?: Obligation[];
  evidence?: Evidence[];
  submissions?: Submission[];
  deliverables?: Deliverable[];
  notifications?: Notification[];
  error?: string;
}

// Requirements not yet satisfied, ranked worst-first so the dashboard's top
// three rows are always the ones that most need the user's attention.
const MISSING_PRIORITY: Record<string, number> = {
  OVERDUE: 0, MISSING: 1, NEEDS_ATTENTION: 2, UNKNOWN: 3, DUE_SOON: 4, IN_PROGRESS: 5, UPCOMING: 6,
};

function actionLabelForStatus(status: ObligationStatus, hasMatter: boolean): string {
  switch (status) {
    case "MISSING": case "OVERDUE": case "UNKNOWN": return hasMatter ? "Continue" : "Start";
    case "NEEDS_ATTENTION": return "Review";
    case "DUE_SOON": case "UPCOMING": return hasMatter ? "Continue" : "Review";
    case "IN_PROGRESS": return "Continue";
    default: return "Review";
  }
}

function requirementStatusText(status: ObligationStatus): string {
  switch (status) {
    case "MISSING": return "Not started";
    case "OVERDUE": return "Overdue";
    case "NEEDS_ATTENTION": return "Missing information";
    case "UNKNOWN": return "Needs information";
    case "IN_PROGRESS": return "In progress";
    case "DUE_SOON": return "Due soon";
    case "UPCOMING": return "Upcoming";
    default: return status.replaceAll("_", " ");
  }
}

function dateLabel(value?: string | null) {
  if (!value) return "No date set";
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// Days-remaining chip for the compliance calendar — same semantic colors as
// StatusBadge (soft red = urgent, gold/amber = approaching, green = fine).
function TimeBadge({ dueDate, completed }: { dueDate: string | null; completed: boolean }) {
  if (completed) return <span className="inline-flex whitespace-nowrap rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold tracking-wide text-emerald-700">DONE</span>;
  if (!dueDate) return <span className="inline-flex whitespace-nowrap rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1 text-[11px] font-bold tracking-wide text-slate-600">NO DATE</span>;
  const days = Math.ceil((new Date(`${dueDate}T00:00:00`).getTime() - new Date(new Date().toDateString()).getTime()) / 86400000);
  let text: string; let cls: string;
  if (days < 0) { text = "Overdue"; cls = "border-red-300 bg-red-50 text-red-700"; }
  else if (days === 0) { text = "Due today"; cls = "border-red-300 bg-red-50 text-red-700"; }
  else if (days <= 14) { text = `${days} day${days === 1 ? "" : "s"}`; cls = "border-rose-200 bg-rose-50 text-rose-700"; }
  else if (days <= 60) { text = `${days} days`; cls = "border-amber-200 bg-amber-50 text-amber-800"; }
  else { text = "Upcoming"; cls = "border-sky-200 bg-sky-50 text-sky-700"; }
  return <span className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-bold tracking-wide ${cls}`}>{text}</span>;
}

// Dark-teal progress ring, drawn with plain SVG so no charting dependency is
// needed for a single stat.
function ReadinessRing({ percent }: { percent: number | null }) {
  const size = 96, stroke = 10, r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const pct = percent == null ? 0 : Math.max(0, Math.min(100, percent));
  return (
    <div className="relative h-24 w-24 shrink-0">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e7e2d6" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#245c5c" strokeWidth={stroke}
          strokeDasharray={c} strokeDashoffset={c - (c * pct) / 100} strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-xl font-semibold text-[#161616]">
        {percent == null ? "—" : `${percent}%`}
      </div>
    </div>
  );
}

function readinessLabel(percent: number | null): { text: string; cls: string } {
  if (percent == null) return { text: "Not started", cls: "bg-slate-100 text-slate-600" };
  if (percent >= 90) return { text: "On track", cls: "bg-emerald-50 text-emerald-700" };
  if (percent >= 50) return { text: "In progress", cls: "bg-amber-50 text-amber-800" };
  return { text: "Needs attention", cls: "bg-rose-50 text-rose-700" };
}

function StatTile({ icon, iconBg, value, label }: { icon: React.ReactNode; iconBg: string; value: number; label: string }) {
  return (
    <div className="flex flex-1 flex-col items-center gap-2 px-4 py-2 text-center">
      <span className={`flex h-11 w-11 items-center justify-center rounded-full ${iconBg}`}>{icon}</span>
      <div className="text-2xl font-semibold text-[#161616]">{value}</div>
      <div className="text-xs font-medium text-slate-500">{label}</div>
    </div>
  );
}

function CollapsibleRow({ icon, iconBg, title, summary, children, defaultOpen }: {
  icon: React.ReactNode; iconBg: string; title: string; summary: string; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-950/[0.02]">
      <button
        type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}
        className="flex w-full items-center gap-3 rounded-2xl px-5 py-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#245c5c]"
      >
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${iconBg}`}>{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="font-bold text-[#161616]">{title}</div>
          <div className="text-xs text-slate-500">{summary}</div>
        </div>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="border-t border-slate-100 px-5 py-4">{children}</div>}
    </section>
  );
}

function Empty({ text }: { text: string }) { return <div className="rounded-xl border border-dashed border-slate-200 py-7 text-center text-sm text-slate-400">{text}</div>; }

// Fetches a short-lived signed URL from an ownership-checked API route, then
// opens it directly — the file's bytes never pass through our own server.
function DownloadButton({ kind, id }: { kind: "evidence" | "deliverables"; id: string }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const download = async () => {
    setBusy(true); setFailed(false);
    try {
      const response = await fetch(`/api/${kind}/${id}/download`);
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.url) { setFailed(true); return; }
      window.open(result.url, "_blank", "noopener,noreferrer");
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      type="button" onClick={() => void download()} disabled={busy}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-600 disabled:opacity-50"
    >
      <Download className="h-3.5 w-3.5" />{failed ? "Try again" : "Download"}
    </button>
  );
}

function DetailField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[#5a5a5a]">{label}</div>
      <div className="mt-0.5 truncate text-sm font-medium text-[#161616]" title={value || undefined}>{value || "Not entered"}</div>
    </div>
  );
}

function ObligationRow({ item, submissionId, reload, onMarkComplete }: {
  item: Obligation; submissionId?: string | null; reload: () => void; onMarkComplete?: (id: string) => void;
}) {
  const [date, setDate] = useState(item.due_date || "");
  const [source, setSource] = useState<DueDateSource>(item.due_date_source === "UNKNOWN" ? "USER_PROVIDED" : item.due_date_source);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // Optimistic flag so the row visibly flips to "completed" the moment the
  // user clicks, instead of silently vanishing once the list re-sorts.
  const [justCompleted, setJustCompleted] = useState(false);
  const [dateDialogOpen, setDateDialogOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const completed = item.status === "COMPLETED" || justCompleted;
  const update = async (payload: Record<string, unknown>) => {
    setBusy(true); setMessage(null);
    const response = await fetch(`/api/obligations/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const result = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) { setMessage(result.error || "Could not update."); setJustCompleted(false); return; }
    reload();
  };
  const markComplete = () => {
    setJustCompleted(true);
    onMarkComplete?.(item.id);
    void update({ complete: true });
  };
  const uploadFile = async (file: File) => {
    setUploading(true); setMessage(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("obligation_id", item.id);
      const response = await fetch("/api/evidence", { method: "POST", body: form });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) { setMessage(result.error || "Could not upload."); return; }
      reload();
    } finally {
      setUploading(false);
    }
  };
  const saveDate = () => {
    setDateDialogOpen(false);
    void update({
      due_date: date,
      due_date_source: source,
      // Preserve any existing rule reference. The internal rule id is never
      // shown or edited here.
      source_reference: item.source_reference || undefined,
    });
  };
  return (
    <div id={`obligation-${item.id}`} className={`rounded-xl border px-4 py-3 transition-colors ${completed ? "border-emerald-300 bg-emerald-50" : "border-slate-200"}`}>
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
        <div className="flex min-w-0 items-center gap-2">
          {completed && <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />}
          <div className="min-w-0">
            <div className="font-semibold text-[#161616]">{item.name}</div>
            <div className="text-xs text-slate-500">{item.agency || "Agency not recorded"}{item.matter_title ? ` · ${item.matter_title}` : ""}</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="text-right">
            <div className="text-sm font-semibold text-slate-700">{dateLabel(item.due_date)}</div>
            {item.due_date && item.due_date_source !== "UNKNOWN" && (
              <div className="text-[10px] uppercase tracking-wide text-slate-400">{item.due_date_source.replaceAll("_", " ")}</div>
            )}
          </div>
          <StatusBadge status={completed ? "COMPLETED" : (item.status as ObligationStatus)} />
        </div>
      </div>
      {!item.due_date && !completed && <p className="mt-2 text-xs text-slate-500">{DUE_DATE_UNKNOWN_MESSAGE}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
        <span className="mr-auto text-xs font-medium text-slate-600">{completed ? "Marked as complete" : item.next_action}</span>
        {!completed && (
          <>
            <button
              type="button" disabled={uploading || busy} onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-full border border-[#245c5c] px-3 py-1 text-xs font-semibold text-[#245c5c] disabled:opacity-50"
            >
              <Upload className="h-3.5 w-3.5" />{uploading ? "Uploading…" : "Upload"}
            </button>
            <input
              ref={fileInputRef} type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png,.heic,.webp,.doc,.docx,.xls,.xlsx"
              onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void uploadFile(file); }}
            />
            {item.form_id && submissionId && item.requirement_id && (
              <a
                href={`/?entry=new-business&resume=${submissionId}&govForm=${item.form_id}&req=${item.requirement_id}`}
                className="inline-flex items-center gap-1.5 rounded-full bg-[#245c5c] px-3 py-1 text-xs font-semibold text-white"
              >
                <FileText className="h-3.5 w-3.5" />Complete document
              </a>
            )}
            <button
              type="button" onClick={() => { setDate(item.due_date || ""); setMessage(null); setDateDialogOpen(true); }}
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-600"
            >
              <CalendarDays className="h-3.5 w-3.5" />Update date
            </button>
          </>
        )}
        {completed ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-3 py-1 text-xs font-semibold text-white">
            <CheckCircle2 className="h-3.5 w-3.5" />Completed
          </span>
        ) : (
          <button disabled={busy} onClick={markComplete} className="rounded-full border border-emerald-300 px-3 py-1 text-xs font-semibold text-emerald-700 disabled:opacity-50">Mark renewed / complete</button>
        )}
      </div>
      {message && !dateDialogOpen && <p className="mt-2 text-xs text-red-600">{message}</p>}
      {dateDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setDateDialogOpen(false)}>
          <div
            role="dialog" aria-modal="true" aria-label="Update due date"
            className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="font-bold text-[#161616]">Update due date</h3>
            <p className="mt-0.5 text-xs text-slate-500">{item.name}</p>
            <label className="mt-4 block text-xs font-semibold text-slate-600">Due date
              <input
                type="date" value={date} onChange={(event) => setDate(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal text-[#161616]"
              />
            </label>
            <label className="mt-3 block text-xs font-semibold text-slate-600">Date source
              <select
                value={source} onChange={(event) => setSource(event.target.value as DueDateSource)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-[#161616]"
              >
                <option value="USER_PROVIDED">User provided</option>
                <option value="DOCUMENT_EXTRACTED">Document extracted</option>
                <option value="EXTERNALLY_VERIFIED">Externally verified</option>
                <option value="REGULATORY_RULE">Regulatory rule</option>
              </select>
            </label>
            {message && <p className="mt-2 text-xs text-red-600">{message}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setDateDialogOpen(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600">Cancel</button>
              <button type="button" disabled={busy || !date} onClick={saveDate} className="rounded-lg bg-[#161616] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Save date</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function BusinessDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [data, setData] = useState<Detail | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [showAllRequirements, setShowAllRequirements] = useState(false);
  const [showBusinessDetails, setShowBusinessDetails] = useState(false);
  // Requirements the user just marked complete: kept pinned in the
  // "outstanding" list (rendered with their new completed look) instead of
  // silently dropping out of view the instant the list re-sorts.
  const [recentlyCompletedIds, setRecentlyCompletedIds] = useState<Set<string>>(new Set());
  const markRecentlyCompleted = useCallback((requirementId: string) => {
    setRecentlyCompletedIds((prev) => new Set(prev).add(requirementId));
  }, []);
  const load = useCallback(() => fetch(`/api/businesses/${id}`)
    .then((response) => response.json())
    .then((result) => { setData(result); setLoadError(false); })
    .catch(() => setLoadError(true)), [id]);
  useEffect(() => { void load(); }, [load]);

  // Normalize to the short public URL once the business loads, so the address
  // bar never carries the full UUID. The anchor (if any) is preserved.
  useEffect(() => {
    const publicId = data?.business?.public_id;
    if (publicId && id !== publicId) router.replace(`/businesses/${publicId}${window.location.hash}`);
  }, [data, id, router]);

  const completeMatter = async (matterId: string) => {
    const response = await fetch(`/api/matters/${matterId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "COMPLETED" }),
    });
    if (response.ok) await load();
  };

  // Every number on this page — the ring, the tiles, the "N of M complete"
  // line and the status pill — is derived from this one pass over the
  // fetched obligations/matters so they can never drift apart.
  const derived = useMemo(() => {
    const obligations = data?.obligations ?? [];
    const matters = data?.matters ?? [];
    const activeMatters = matters.filter((matter) => !["COMPLETED", "ARCHIVED"].includes(matter.status));

    const totalApplicable = obligations.length;
    const completed = obligations.filter((item) => item.status === "COMPLETED" || item.status === "CURRENT");
    const readiness = totalApplicable ? Math.round((completed.length / totalApplicable) * 100) : null;

    const missing = obligations
      .filter((item) => item.status !== "COMPLETED" && item.status !== "CURRENT")
      .slice()
      .sort((a, b) => (MISSING_PRIORITY[a.status] ?? 9) - (MISSING_PRIORITY[b.status] ?? 9));

    const matterCalendar: Obligation[] = matters.filter((matter) => matter.due_date && matter.status !== "COMPLETED").map((matter) => ({
      id: `matter-${matter.id}`, name: matter.title, agency: "Filing matter", matter_title: matter.title,
      status: matter.status === "NEEDS_ATTENTION" ? "NEEDS_ATTENTION" : "IN_PROGRESS",
      due_date: matter.due_date, due_date_source: matter.due_date_source,
      source_reference: matter.source_reference, next_action: "Continue filing",
    }));
    const calendar = [...obligations.filter((item) => item.due_date && item.status !== "COMPLETED"), ...matterCalendar]
      .sort((a, b) => (a.due_date || "").localeCompare(b.due_date || ""));

    const history = matters.filter((matter) => matter.status === "COMPLETED");

    return { totalApplicable, completed: completed.length, readiness, missing, calendar, activeMatters, history };
  }, [data]);

  // Short public id for every link out of this page; falls back to the UUID
  // until the API returns public_id.
  const submissionByMatterId = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const matter of data?.matters ?? []) map.set(matter.id, matter.submission_id);
    return map;
  }, [data]);

  if (loadError) return <div className="min-h-screen bg-[#f4f1ea]"><TopNav active="businesses" /><div className="p-12 text-center text-sm text-rose-700">Couldn&apos;t load this business right now. <button type="button" onClick={() => void load()} className="font-semibold underline">Try again</button></div></div>;
  if (!data) return <div className="min-h-screen bg-[#f4f1ea]"><TopNav active="businesses" /><div className="p-12 text-center text-slate-500">Loading compliance profile…</div></div>;
  if (data.error || !data.business) return <div className="min-h-screen bg-[#f4f1ea]"><TopNav active="businesses" /><div className="p-12 text-center text-slate-500">Business not found.</div></div>;

  const business = data.business;
  const evidence = data.evidence ?? [];
  const submissions = data.submissions ?? [];
  const notifications = data.notifications ?? [];
  const deliverables = data.deliverables ?? [];
  const unreadNotifications = notifications.filter((item) => item.status === "PENDING" || item.status === "DELIVERED").length;
  const shortId = business.public_id || id;

  const readinessInfo = readinessLabel(derived.readiness);
  const topMissing = derived.missing.slice(0, 3);
  const shownMissing = showAllRequirements ? derived.missing : topMissing;
  const topCalendar = derived.calendar.slice(0, 3);
  const nextBestAction = topMissing[0];

  // Recently-completed items keep their spot in the "All requirements"
  // outstanding list (pinned to the top) so marking one complete shows an
  // immediate, visible confirmation instead of the row just disappearing.
  const allObligations = data.obligations ?? [];
  const pinnedCompleted = allObligations.filter((item) => recentlyCompletedIds.has(item.id));
  const outstandingDisplay = [...pinnedCompleted, ...shownMissing.filter((item) => !recentlyCompletedIds.has(item.id))];
  const otherCompleted = allObligations.filter((item) => (item.status === "COMPLETED" || item.status === "CURRENT") && !recentlyCompletedIds.has(item.id));

  return (
    <div className="min-h-screen bg-[#f4f1ea]">
      <TopNav active="businesses" />
      <main className="mx-auto max-w-7xl px-5 py-8">
        <div className="flex items-center justify-between">
          <Link href="/businesses" className="text-sm font-semibold text-[#245c5c]">← Back</Link>
          <Link href="/businesses" className="rounded-lg bg-[#161616] px-4 py-2 text-sm font-medium text-white">My Businesses</Link>
        </div>

        <header className="mt-3 rounded-2xl border border-[#161616]/15 bg-[#fbf8f2] p-6 text-[#161616]">
          <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
            <div>
              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-[#5a5a5a]">
                <Building2 className="h-3.5 w-3.5" /><span>{business.business_type || "Business type not entered"}</span>
                <span>·</span>
                <MapPin className="h-3.5 w-3.5" /><span>{business.municipality || "Municipality not entered"}</span>
                <span>·</span><span>Active</span>
              </div>
              <h1 className="font-[family-name:var(--font-display)] text-4xl font-medium tracking-tight md:text-5xl">{business.legal_name || business.name}</h1>
              <p className="mt-2 max-w-2xl text-base text-[#5a5a5a]">{business.entity_number || "Entity number not entered"} · {business.onboarding_mode === "EXISTING" ? "Existing business reconstruction" : "SmartPR formation workflow"}</p>
            </div>
            <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
              <button
                type="button" onClick={() => setShowBusinessDetails((value) => !value)} aria-expanded={showBusinessDetails}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#161616]/20 bg-white px-4 py-3 text-sm font-medium text-[#161616]"
              >
                Business details
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showBusinessDetails ? "rotate-180" : ""}`} />
              </button>
              <Link href={`/businesses/${shortId}/matters/new`} className="inline-flex items-center gap-2 rounded-lg bg-[#245c5c] px-5 py-3 text-sm font-medium text-[#f6f3ea]">Start New Filing / Renewal</Link>
            </div>
          </div>

          {showBusinessDetails && (
            <div className="mt-5 grid gap-4 rounded-xl border border-[#161616]/15 bg-[#f4f1ea] p-4 sm:grid-cols-2 lg:grid-cols-3">
              <DetailField label="Legal name" value={business.legal_name || business.name} />
              <DetailField label="Entity number" value={business.entity_number} />
              <DetailField label="Business structure" value={business.business_structure} />
              <DetailField label="Business type" value={business.business_type} />
              <DetailField label="Industry" value={business.industry} />
              <DetailField label="Municipality" value={business.municipality} />
              <DetailField label="Physical address" value={business.physical_address} />
              <DetailField label="Onboarding mode" value={business.onboarding_mode === "EXISTING" ? "Existing business reconstruction" : "SmartPR formation workflow"} />
              <DetailField label="Entry created" value={fmtDate(business.created_at)} />
              <div className="sm:col-span-2 lg:col-span-3"><DetailField label="Notes" value={business.notes} /></div>
            </div>
          )}
        </header>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <section className="flex items-center gap-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm shadow-slate-950/[0.02]">
            <ReadinessRing percent={derived.readiness} />
            <div>
              <div className="text-xs font-medium uppercase tracking-wider text-slate-500">Overall readiness</div>
              <span className={`mt-1 inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${readinessInfo.cls}`}>{readinessInfo.text}</span>
              <p className="mt-2 text-sm text-slate-600">{derived.totalApplicable ? `${derived.completed} of ${derived.totalApplicable} requirements complete.` : "No applicable requirements recorded yet."}</p>
              <button type="button" onClick={() => setShowAllRequirements(true)} className="mt-1 text-sm font-semibold text-[#245c5c] hover:underline">View all requirements</button>
            </div>
          </section>

          <section className="flex items-stretch divide-x divide-slate-100 rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-950/[0.02]">
            <StatTile icon={<CheckCircle2 className="h-5 w-5 text-emerald-600" />} iconBg="bg-emerald-50" value={derived.completed} label="Complete" />
            <StatTile icon={<AlertTriangle className="h-5 w-5 text-rose-600" />} iconBg="bg-rose-50" value={Math.max(derived.totalApplicable - derived.completed, 0)} label="Need attention" />
            <StatTile icon={<FileText className="h-5 w-5 text-amber-600" />} iconBg="bg-amber-50" value={derived.activeMatters.length} label="Active filing" />
          </section>
        </div>

        {nextBestAction && (
          <div className="mt-6 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm shadow-slate-950/[0.02] sm:flex-row sm:items-center">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#245c5c]"><ArrowRight className="h-4 w-4 text-white" /></span>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium text-slate-500">Next best action</div>
              <div className="font-bold text-[#161616]">{nextBestAction.name}</div>
            </div>
            <a href={`#obligation-${nextBestAction.id}`} onClick={() => setShowAllRequirements(true)} className="inline-flex items-center justify-center rounded-lg bg-[#245c5c] px-5 py-2.5 text-sm font-medium text-[#f6f3ea]">Continue</a>
          </div>
        )}

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-950/[0.02]">
            <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4 font-bold text-[#161616]">
              <ShieldAlert className="h-4 w-4 text-rose-600" />Missing Requirements
              <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{derived.missing.length}</span>
            </div>
            <div className="p-5">
              {topMissing.length ? (
                <div className="space-y-2">
                  {topMissing.map((item, index) => (
                    <div key={item.id} className="flex items-center gap-3 rounded-xl border border-slate-200 px-4 py-3">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-500">{index + 1}</span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-semibold text-[#161616]">{item.name}</div>
                      </div>
                      <span className="hidden sm:inline-flex whitespace-nowrap rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-bold tracking-wide text-rose-700">{requirementStatusText(item.status).toUpperCase()}</span>
                      <a href={`#obligation-${item.id}`} onClick={() => setShowAllRequirements(true)} className="shrink-0 rounded-lg bg-[#245c5c] px-3.5 py-1.5 text-xs font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#245c5c]">{actionLabelForStatus(item.status, Boolean(item.matter_title))}</a>
                    </div>
                  ))}
                </div>
              ) : <Empty text="No missing requirements are recorded." />}
              <button type="button" onClick={() => setShowAllRequirements(true)} className="mt-3 text-sm font-semibold text-[#245c5c] hover:underline">View all requirements</button>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-950/[0.02]">
            <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4 font-bold text-[#161616]">
              <CalendarDays className="h-4 w-4 text-emerald-600" />Compliance Calendar
              <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{derived.calendar.length}</span>
            </div>
            <div className="p-5">
              {topCalendar.length ? (
                <div className="space-y-2">
                  {topCalendar.map((item) => (
                    <a key={item.id} href={`#obligation-${item.id}`} onClick={() => setShowAllRequirements(true)} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3">
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-500">{dateLabel(item.due_date)}</div>
                        <div className="truncate font-semibold text-[#161616]">{item.name}</div>
                      </div>
                      <TimeBadge dueDate={item.due_date} completed={false} />
                    </a>
                  ))}
                </div>
              ) : <Empty text={DUE_DATE_UNKNOWN_MESSAGE} />}
              <Link href={`/calendar?business=${shortId}`} className="mt-3 inline-block text-sm font-semibold text-[#245c5c] hover:underline">View full calendar</Link>
            </div>
          </section>
        </div>

        <div className="mt-6 grid gap-4">
          <CollapsibleRow
            icon={<FolderOpen className="h-4 w-4 text-blue-600" />} iconBg="bg-blue-50"
            title="Filings & Documents"
            summary={`${derived.activeMatters.length} active filing${derived.activeMatters.length === 1 ? "" : "s"} · ${evidence.length} document${evidence.length === 1 ? "" : "s"}`}
          >
            <div className="space-y-4">
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Active filings</div>
                {derived.activeMatters.length ? (
                  <div className="space-y-2">
                    {derived.activeMatters.map((matter) => (
                      <div key={matter.id} className="flex flex-col justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3 sm:flex-row sm:items-center">
                        <div><div className="font-semibold text-[#161616]">{matter.title}</div><div className="text-xs text-slate-500">{matter.matter_type.replaceAll("_", " ")} · Opened {fmtDate(matter.opened_at)}</div></div>
                        <div className="flex flex-wrap items-center gap-3">
                          <StatusBadge status={matter.status === "READY" ? "CURRENT" : matter.status === "DRAFT" ? "IN_PROGRESS" : matter.status as ObligationStatus} />
                          <ScorePill score={matter.readiness_score} />
                          {matter.submission_id && <Link href={`/?entry=new-business&resume=${matter.submission_id}`} className="text-xs font-semibold text-[#245c5c]">Resume →</Link>}
                          <button onClick={() => void completeMatter(matter.id)} className="rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-600">Mark filing complete</button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : <Empty text="No active filings." />}
              </div>
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Documents</div>
                {evidence.length ? (
                  <div className="space-y-2">
                    {evidence.map((item) => (
                      <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3">
                        <div className="min-w-0"><div className="truncate font-semibold text-[#161616]">{item.original_filename}</div><div className="text-xs text-slate-500">{item.obligation_name || "Unmatched evidence"} · Added {fmtDateTime(item.created_at)}</div></div>
                        <div className="flex shrink-0 items-center gap-2">
                          <StatusBadge status={item.review_status === "VERIFIED" ? "CURRENT" : item.review_status === "NEEDS_REVIEW" ? "NEEDS_ATTENTION" : "UNKNOWN"} />
                          <DownloadButton kind="evidence" id={item.id} />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : <Empty text="No uploaded evidence is associated with this business." />}
              </div>
              {deliverables.length > 0 && (
                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Deliverable library</div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {deliverables.map((item) => (
                      <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3">
                        <div className="min-w-0"><div className="truncate font-semibold text-[#161616]">{item.filename}</div><div className="text-xs text-slate-500">{item.kind} · {fmtDateTime(item.generated_at)}</div></div>
                        <DownloadButton kind="deliverables" id={item.id} />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </CollapsibleRow>

          <CollapsibleRow
            icon={<Bell className="h-4 w-4 text-amber-600" />} iconBg="bg-amber-50"
            title="History & Notifications"
            summary={`${derived.history.length + submissions.length} past filing${derived.history.length + submissions.length === 1 ? "" : "s"} · ${unreadNotifications} unread`}
          >
            <div className="space-y-4">
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Filing history</div>
                {derived.history.length || submissions.length ? (
                  <div className="space-y-2">
                    {derived.history.map((matter) => <div key={matter.id} className="rounded-xl border border-slate-200 px-4 py-3"><div className="font-semibold text-[#161616]">{matter.title}</div><div className="text-xs text-slate-500">Completed {fmtDate(matter.completed_at)}</div></div>)}
                    {submissions.map((submission) => (
                      <Link key={submission.id} href={`/history/${submission.id}`} className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3">
                        <div><div className="font-semibold text-[#161616]">Rules evaluation · {fmtDate(submission.created_at)}</div><div className="text-xs text-slate-500">{submission.business_type || "Business profile"} · {submission.municipality || "—"}</div></div>
                        <ScorePill score={submission.readiness_score} />
                      </Link>
                    ))}
                  </div>
                ) : <Empty text="No filing history yet." />}
              </div>
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Notifications</div>
                {notifications.length ? (
                  <div className="space-y-2">
                    {notifications.slice(0, 10).map((item) => <div key={item.id} className="rounded-xl border border-slate-200 px-4 py-3"><div className="text-sm font-semibold text-[#161616]">{item.message}</div><div className="text-xs text-slate-500">Scheduled {fmtDateTime(item.scheduled_for)} · {item.status}</div></div>)}
                  </div>
                ) : <Empty text="No reminders have been scheduled." />}
              </div>
            </div>
          </CollapsibleRow>
        </div>

        {showAllRequirements && (
          <section id="all-requirements" className="mt-6 rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-950/[0.02]">
            <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4 font-bold text-[#161616]">
              All requirements
              <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{derived.totalApplicable}</span>
              <button type="button" onClick={() => setShowAllRequirements(false)} className="text-sm font-semibold text-[#245c5c] hover:underline">Hide</button>
            </div>
            <div className="space-y-3 p-5">
              {outstandingDisplay.length ? outstandingDisplay.map((item) => (
                <ObligationRow
                  key={item.id} item={item} reload={load} onMarkComplete={markRecentlyCompleted}
                  submissionId={item.matter_id ? submissionByMatterId.get(item.matter_id) ?? null : null}
                />
              )) : <Empty text="No outstanding requirements." />}
              {otherCompleted.length > 0 && (
                <>
                  <div className="pt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Completed</div>
                  {otherCompleted.map((item) => (
                    <ObligationRow
                      key={item.id} item={item} reload={load}
                      submissionId={item.matter_id ? submissionByMatterId.get(item.matter_id) ?? null : null}
                    />
                  ))}
                </>
              )}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
