"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight, Bell, Bot, Building2, CalendarDays, CheckCircle2,
  ChevronDown, Download, ExternalLink, FileText, FolderOpen, Lock, MapPin, Scale, ShieldAlert, Upload,
} from "lucide-react";
import { useDeliverablesAccess } from "../../../lib/billing/useDeliverablesAccess";
import { ScorePill, fmtDate, fmtDateTime } from "../../history/ui";
import { StatusBadge } from "../../components/compliance/StatusBadge";
import { DUE_DATE_UNKNOWN_MESSAGE, type DueDateSource, type ObligationStatus } from "../../compliance/types";
import { GovernmentFormModal } from "../../forms/engine/GovernmentFormModal";
import { getDefinition } from "../../forms/engine/registry";
import { canonicalFromBusinessRow, passportCoverage } from "../../forms/engine/businessPassport";
import { BusinessTile } from "../BusinessTile";
import { DashboardCompliance, type ComplianceTab } from "../DashboardCompliance";
import { ActiveFilingPanel, MunicipalityNotice } from "../ActiveFilingPanel";
import { activeFilingFor, municipalityConflict, municipalRequirements } from "../activeFiling";
import type { PassportLocationWithGeographies } from "../../locations/geo";
import { PassportLocationSection } from "../PassportLocationSection";
import { BusinessPassportPanel } from "../BusinessPassportPanel";
import { MatterSiteSelect } from "../MatterSiteSelect";
import { AttachFromLockerPicker, EvidenceLockerPanel } from "../EvidenceLockerPanel";
import { evidenceForObligation } from "../../compliance/evidenceLocker";
import { getDocumentDownload, downloadKindLabel, KB } from "../../kb";
import { legalBasisFor } from "../../requirementGuidance";
import { PR_REQUIREMENT_GUIDANCE } from "../../guidance/pr";
import { L } from "../../i18n";
import { useLang } from "../../useLang";
import type { Lang, FormData as GovFormData } from "../../forms/engine/types";

interface BusinessRecord {
  id: string; public_id: string | null; name: string; legal_name: string | null; entity_number: string | null;
  municipality: string | null; business_type: string | null; onboarding_mode: "NEW" | "EXISTING";
  business_structure: string | null; industry: string | null; physical_address: string | null;
  notes: string | null; created_at: string | null;
  passport_json?: Record<string, unknown> | null;
}
interface Matter { id: string; matter_type: string; title: string; status: string; readiness_score: number | null; opened_at: string; completed_at: string | null; submission_id: string | null; due_date: string | null; due_date_source: DueDateSource; source_reference: string | null; location_id?: string | null }
interface Obligation { id: string; name: string; agency: string | null; matter_id?: string | null; matter_title: string | null; requirement_id?: string | null; form_id?: string | null; status: ObligationStatus; due_date: string | null; due_date_source: DueDateSource; source_reference: string | null; next_action: string; downloaded_at?: string | null }
interface Evidence { id: string; obligation_id: string | null; original_filename: string; obligation_name: string | null; review_status: string; created_at: string; requirement_tags?: string[] | null; mime_type?: string | null; size_bytes?: number | null; document_type?: string | null }
interface Submission { id: string; created_at: string; business_type: string | null; municipality: string | null; readiness_score: number | null }
interface Deliverable { id: string; filename: string; kind: string; generated_at: string }
interface Notification { id: string; message: string; scheduled_for: string; status: string }

interface Detail {
  business?: BusinessRecord;
  overall_readiness?: number | null;
  matters?: Matter[];
  obligations?: Obligation[];
  agency_runs?: { filing_type: string; status: string }[];
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

function actionLabelForStatus(status: ObligationStatus, hasMatter: boolean, lang: Lang): string {
  switch (status) {
    case "MISSING": case "OVERDUE": case "UNKNOWN": return hasMatter ? L("Continue", lang) : L("Start", lang);
    case "NEEDS_ATTENTION": return L("Review", lang);
    case "DUE_SOON": case "UPCOMING": return hasMatter ? L("Continue", lang) : L("Review", lang);
    case "IN_PROGRESS": return L("Continue", lang);
    default: return L("Review", lang);
  }
}

function requirementStatusText(status: ObligationStatus, lang: Lang): string {
  switch (status) {
    case "MISSING": return L("Not started", lang);
    case "OVERDUE": return L("Overdue", lang);
    case "NEEDS_ATTENTION": return L("Missing information", lang);
    case "UNKNOWN": return L("Needs information", lang);
    case "IN_PROGRESS": return L("In progress", lang);
    case "DUE_SOON": return L("Due soon", lang);
    case "UPCOMING": return L("Upcoming", lang);
    default: return status.replaceAll("_", " ");
  }
}

function dateLabel(value: string | null | undefined, lang: Lang) {
  if (!value) return L("No date set", lang);
  return new Date(`${value}T00:00:00`).toLocaleDateString(lang === "es" ? "es-PR" : "en-US", { month: "short", day: "numeric", year: "numeric" });
}

// Days-remaining chip for the compliance calendar — same semantic colors as
// StatusBadge (soft red = urgent, gold/amber = approaching, green = fine).
function ReadinessRing({ percent }: { percent: number | null }) {
  const size = 96, stroke = 10, r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const pct = percent == null ? 0 : Math.max(0, Math.min(100, percent));
  return (
    <div className="relative h-24 w-24 shrink-0">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e7e2d6" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" style={{ stroke: "var(--brand-primary)" }} strokeWidth={stroke}
          strokeDasharray={c} strokeDashoffset={c - (c * pct) / 100} strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-xl font-semibold text-[#161616]">
        {percent == null ? "—" : `${percent}%`}
      </div>
    </div>
  );
}

function readinessLabel(percent: number | null, lang: Lang): { text: string; cls: string } {
  if (percent == null) return { text: L("Not started", lang), cls: "bg-slate-100 text-slate-600" };
  if (percent >= 90) return { text: L("On track", lang), cls: "bg-emerald-50 text-emerald-700" };
  if (percent >= 50) return { text: L("In progress", lang), cls: "bg-amber-50 text-amber-800" };
  return { text: L("Needs attention", lang), cls: "bg-rose-50 text-rose-700" };
}

function Empty({ text }: { text: string }) { return <div className="rounded-xl border border-dashed border-slate-200 py-7 text-center text-sm text-slate-400">{text}</div>; }

// Fetches a short-lived signed URL from an ownership-checked API route, then
// opens it directly — the file's bytes never pass through our own server.
function DownloadButton({ kind, id, lang }: { kind: "evidence" | "deliverables"; id: string; lang: Lang }) {
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
      <Download className="h-3.5 w-3.5" />{failed ? L("Try again", lang) : L("Download", lang)}
    </button>
  );
}

function DetailField({ label, value, lang }: { label: string; value: string | null | undefined; lang: Lang }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[#5a5a5a]">{label}</div>
      <div className="mt-0.5 truncate text-sm font-medium text-[#161616]" title={value || undefined}>{value || L("Not entered", lang)}</div>
    </div>
  );
}

function LegalBasisDisclosure({ item, lang }: { item: Obligation; lang: Lang }) {
  const [open, setOpen] = useState(false);
  // Provision-level legal basis straight from the regulatory knowledge graph
  // (triggering rule's citation, else the required document's). Never rendered
  // when the graph has no citation — the absence is honest, not filled in.
  // Review-provenance citations ("Validated review …") are suppressed for
  // unvalidated concepts, mirroring the assessment flow: provenance is not a
  // legal basis.
  const basis = useMemo(() => {
    const concept = item.requirement_id ? PR_REQUIREMENT_GUIDANCE[item.requirement_id] : undefined;
    const status = concept?.validationStatus === "validated" ? "VALIDATED" : "GUIDANCE_NEEDS_REVIEW";
    return legalBasisFor(item.source_reference, item.requirement_id, KB, status);
  }, [item.source_reference, item.requirement_id]);
  if (!basis) return null;
  // Some graph citations are bare URLs with no separate citation_url — never
  // render those as dead text; the citation itself becomes the link.
  const linkUrl = basis.url || (/^https?:\/\/\S+$/i.test(basis.citation.trim()) ? basis.citation.trim() : null);
  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline"
      >
        <Scale className="h-3 w-3" />
        {L("Legal basis", lang)}
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="mt-1.5 max-w-xl rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600">
          <div className="font-semibold text-[#161616]">
            {linkUrl ? (
              <a href={linkUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-brand hover:underline">
                {basis.citation}
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : basis.citation}
          </div>
          {item.agency && (
            <div className="mt-0.5">{L("Issuing agency", lang)}: {item.agency}</div>
          )}
          <div className="mt-0.5 text-slate-500">
            {L("This is the law SmartPR tied to the decision that this requirement applies to this business.", lang)}
          </div>
        </div>
      )}
    </div>
  );
}

function ObligationRow({ item, business, businessId, evidence, reload, onMarkComplete }: {
  item: Obligation; business: BusinessRecord; businessId: string; evidence: Evidence[]; reload: () => void; onMarkComplete?: (id: string) => void;
}) {
  const { canUseDeliverables, paywallCode } = useDeliverablesAccess();
  const deliverablesLocked = canUseDeliverables === false;
  const [date, setDate] = useState(item.due_date || "");
  const [source, setSource] = useState<DueDateSource>(item.due_date_source === "UNKNOWN" ? "USER_PROVIDED" : item.due_date_source);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // Per-requirement reminder mute (notification_preferences, scope=obligation).
  const [muted, setMuted] = useState<boolean | null>(null);
  const [muteBusy, setMuteBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/notifications/preferences")
      .then((r) => (r.ok ? r.json() : { preferences: [] }))
      .then((data) => {
        if (cancelled) return;
        const prefs = Array.isArray(data.preferences) ? data.preferences : data;
        const found = (Array.isArray(prefs) ? prefs : []).find(
          (p: { scope?: string; obligation_id?: string | null; muted?: boolean }) =>
            p.scope === "obligation" && p.obligation_id === item.id
        );
        setMuted(found ? !!found.muted : false);
      })
      .catch(() => { if (!cancelled) setMuted(false); });
    return () => { cancelled = true; };
  }, [item.id]);
  const toggleMute = async () => {
    if (muteBusy || muted === null) return;
    setMuteBusy(true);
    try {
      const response = await fetch("/api/notifications/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "obligation", obligation_id: item.id, muted: !muted }),
      });
      if (response.ok) setMuted(!muted);
    } finally {
      setMuteBusy(false);
    }
  };
  // Optimistic flag so the row visibly flips to "completed" the moment the
  // user clicks, instead of silently vanishing once the list re-sorts.
  const [justCompleted, setJustCompleted] = useState(false);
  const [dateDialogOpen, setDateDialogOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Official download/filing destination tracking: the row's visible button
  // opens the destination in a new tab; the click is recorded server-side so
  // the row can nudge the user back and a 3-day bell reminder is scheduled.
  const [downloaded, setDownloaded] = useState(!!item.downloaded_at);
  // REG-PROFESSION-AGENCY-002: resolve the download destination through the
  // obligation's own source rule when known, so the business page shows the
  // same filing link as the intake card (e.g. Salud, not the shared
  // Juntas/Didaxis default, for a tattoo-artist license).
  const dl = useMemo(
    () => getDocumentDownload(item.requirement_id, item.source_reference ?? undefined),
    [item.requirement_id, item.source_reference]
  );
  const recordDownload = useCallback(() => {
    setDownloaded(true);
    fetch(`/api/obligations/${item.id}/download`, { method: "POST" })
      .then(() => reload())
      .catch(() => { /* best-effort; the destination already opened */ });
  }, [item.id, reload]);
  // "Complete document" opens the official government form in a modal right
  // here on the business page — the user never leaves this screen.
  const [formOpen, setFormOpen] = useState(false);
  const definition = item.form_id ? getDefinition(item.form_id) : undefined;
  const draftKey = `gov-draft-${item.id}-${item.form_id ?? "none"}`;
  const lang = useLang();
  const canonical = useMemo(() => canonicalFromBusinessRow(business), [business]);
  const initialDraft = useMemo((): GovFormData | undefined => {
    try {
      if (typeof window === "undefined") return undefined;
      const raw = window.localStorage.getItem(draftKey);
      return raw ? (JSON.parse(raw) as GovFormData) : undefined;
    } catch { return undefined; }
  }, [draftKey]);
  // The completed PDF for this row, newest first — shown persistently in the
  // row once the document is finished (and visible in Documents regardless).
  const rowEvidence = useMemo(
    () => evidenceForObligation(evidence, {
      id: item.id,
      requirement_id: item.requirement_id,
      name: item.name,
    })
      .slice()
      .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || "")),
    [evidence, item.id, item.requirement_id, item.name]
  );
  const completedPdf = rowEvidence[0];
  const completed = item.status === "COMPLETED" || justCompleted;
  const update = async (payload: Record<string, unknown>) => {
    setBusy(true); setMessage(null);
    const response = await fetch(`/api/obligations/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const result = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) { setMessage(result.error || L("Could not update.", lang)); setJustCompleted(false); return; }
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
      if (!response.ok) { setMessage(result.error || L("Could not upload.", lang)); return; }
      reload();
    } finally {
      setUploading(false);
    }
  };
  const attachFromLocker = async (evidenceId: string) => {
    setUploading(true); setMessage(null);
    try {
      const response = await fetch(`/api/evidence/${evidenceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ obligation_id: item.id }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) { setMessage(result.error || L("Could not attach.", lang)); return; }
      reload();
    } finally {
      setUploading(false);
    }
  };
  // The modal hands back the finished official PDF. Save it as evidence on
  // this obligation (the same store the Upload button uses) and mark the row
  // complete: the finished document is the completion. The draft is kept so
  // the form can be reopened and edited; the row keeps its PDF download.
  // Throwing keeps the modal open with the error; the applicant's answers are
  // never lost.
  const handlePdfReady = async ({ blob, filename }: { blob: Blob; filename: string }) => {
    const form = new FormData();
    form.append("file", new File([blob], filename, { type: "application/pdf" }));
    form.append("obligation_id", item.id);
    const response = await fetch("/api/evidence", { method: "POST", body: form });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || L("Could not save the completed document.", lang));
    setMessage(null);
    setJustCompleted(true);
    onMarkComplete?.(item.id);
    await update({ complete: true });
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
            <div className="text-xs text-slate-500">{item.agency || L("Agency not recorded", lang)}{item.matter_title ? ` · ${item.matter_title}` : ""}</div>
            <LegalBasisDisclosure item={item} lang={lang} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="text-right">
            <div className="text-sm font-semibold text-slate-700">{dateLabel(item.due_date, lang)}</div>
            {item.due_date && item.due_date_source !== "UNKNOWN" && (
              <div className="text-[10px] uppercase tracking-wide text-slate-400">{item.due_date_source.replaceAll("_", " ")}</div>
            )}
          </div>
          <StatusBadge status={completed ? "COMPLETED" : (item.status as ObligationStatus)} lang={lang} />
        </div>
      </div>
      {!item.due_date && !completed && <p className="mt-2 text-xs text-slate-500">{L(DUE_DATE_UNKNOWN_MESSAGE, lang)}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
        <span className="mr-auto text-xs font-medium text-slate-600">{completed ? L("Marked as complete", lang) : L(item.next_action, lang)}</span>
        {!completed && (
          <>
            <button
              type="button" disabled={uploading || busy} onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-full border border-brand px-3 py-1 text-xs font-semibold text-brand disabled:opacity-50"
            >
              <Upload className="h-3.5 w-3.5" />{uploading ? L("Uploading…", lang) : L("Upload", lang)}
            </button>
            <AttachFromLockerPicker
              lang={lang}
              lockerFiles={evidence}
              requirementId={item.requirement_id}
              obligationId={item.id}
              busy={uploading || busy}
              onAttach={(evidenceId) => void attachFromLocker(evidenceId)}
            />
            {dl?.kind === "filing_portal" ? (
              /* Clara-first filing: portal filings launch the in-app Clara
                 filing workspace instead of kicking the user out to the
                 government site in a new tab. */
              <Link
                href={item.requirement_id
                  ? `/businesses/${businessId}/agency-run?filing=${encodeURIComponent(item.requirement_id)}`
                  : `/businesses/${businessId}/agency-run`}
                title={L("Work through this filing with Clara — you stay in control of every step.", lang)}
                className="inline-flex items-center gap-1.5 rounded-full bg-brand px-3 py-1 text-xs font-bold text-white"
              >
                <Bot className="h-3.5 w-3.5" />
                {L("File with Clara", lang)}
              </Link>
            ) : dl ? (
              <a
                href={dl.url} target="_blank" rel="noopener noreferrer" onClick={recordDownload}
                className="inline-flex items-center gap-1.5 rounded-full border-2 border-brand px-3 py-1 text-xs font-bold text-brand"
              >
                {downloaded ? <CheckCircle2 className="h-3.5 w-3.5" /> : <ExternalLink className="h-3.5 w-3.5" />}
                {downloaded ? L("Open again", lang) : L(downloadKindLabel(dl.kind), lang)}
              </a>
            ) : null}
            <input
              ref={fileInputRef} type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png,.heic,.webp,.doc,.docx,.xls,.xlsx"
              onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void uploadFile(file); }}
            />
            {definition && (
              <button
                type="button" onClick={() => setFormOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-full bg-brand px-3 py-1 text-xs font-semibold text-white"
              >
                {deliverablesLocked ? <Lock className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}{L("Complete document", lang)}
              </button>
            )}
            <button
              type="button" onClick={() => { setDate(item.due_date || ""); setMessage(null); setDateDialogOpen(true); }}
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-600"
            >
              <CalendarDays className="h-3.5 w-3.5" />{L("Update date", lang)}
            </button>
          </>
        )}
        {completed ? (
          <>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-3 py-1 text-xs font-semibold text-white">
              <CheckCircle2 className="h-3.5 w-3.5" />Completed
            </span>
            {definition && (
              <button
                type="button" onClick={() => setFormOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-600"
              >
                <FileText className="h-3.5 w-3.5" />{L("Edit document", lang)}
              </button>
            )}
            <button
              type="button" disabled={muteBusy || muted === null} onClick={toggleMute} title={L("Mute or unmute email reminders for this requirement.", lang)}
              className={`rounded-full border px-3 py-1 text-xs font-semibold disabled:opacity-50 ${muted ? "border-slate-300 bg-slate-100 text-slate-500" : "border-amber-300 text-amber-700"}`}
            >
              {muted ? `🔕 ${L("Reminders off", lang)}` : `🔔 ${L("Reminders on", lang)}`}
            </button>
          </>
        ) : (
          <button disabled={busy} onClick={markComplete} className="rounded-full border border-emerald-300 px-3 py-1 text-xs font-semibold text-emerald-700 disabled:opacity-50">{L("Mark renewed / complete", lang)}</button>
        )}
      </div>
      {downloaded && !completed && (
        <p className="mt-2 text-xs font-semibold text-brand">
          ✓ {L("Got it? Upload the finished document when you come back.", lang)}
        </p>
      )}
      {completedPdf && (
        <div className="mt-2 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
          <FileText className="h-4 w-4 shrink-0 text-emerald-700" />
          <span className="min-w-0 flex-1 truncate text-xs font-semibold text-emerald-900" title={completedPdf.original_filename}>
            {L("Completed document:", lang)} {completedPdf.original_filename}
          </span>
          <DownloadButton kind="evidence" id={completedPdf.id} lang={lang} />
        </div>
      )}
      {message && !dateDialogOpen && <p className="mt-2 text-xs text-red-600">{message}</p>}
      {dateDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setDateDialogOpen(false)}>
          <div
            role="dialog" aria-modal="true" aria-label={L("Update due date", lang)}
            className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="font-bold text-[#161616]">{L("Update due date", lang)}</h3>
            <p className="mt-0.5 text-xs text-slate-500">{item.name}</p>
            <label className="mt-4 block text-xs font-semibold text-slate-600">{L("Due date", lang)}
              <input
                type="date" value={date} onChange={(event) => setDate(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal text-[#161616]"
              />
            </label>
            <label className="mt-3 block text-xs font-semibold text-slate-600">{L("Date source", lang)}
              <select
                value={source} onChange={(event) => setSource(event.target.value as DueDateSource)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-[#161616]"
              >
                <option value="USER_PROVIDED">{L("User provided", lang)}</option>
                <option value="DOCUMENT_EXTRACTED">{L("Document extracted", lang)}</option>
                <option value="EXTERNALLY_VERIFIED">{L("Externally verified", lang)}</option>
                <option value="REGULATORY_RULE">{L("Regulatory rule", lang)}</option>
              </select>
            </label>
            {message && <p className="mt-2 text-xs text-red-600">{message}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setDateDialogOpen(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600">{L("Cancel", lang)}</button>
              <button type="button" disabled={busy || !date} onClick={saveDate} className="rounded-lg bg-[#161616] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{L("Save date", lang)}</button>
            </div>
          </div>
        </div>
      )}
      {formOpen && definition && (
        <GovernmentFormModal
          definition={definition}
          requirementCode={item.requirement_id ?? item.id}
          canonical={canonical}
          lang={lang}
          initialPaywallCode={deliverablesLocked ? (paywallCode ?? "plan_deliverables_locked") : undefined}
          initialData={initialDraft}
          onClose={() => setFormOpen(false)}
          onSaveDraft={(_formId, data) => {
            try { window.localStorage.setItem(draftKey, JSON.stringify(data)); } catch { /* private mode */ }
          }}
          onCanonicalChange={() => { /* no intake profile to write back to on this page */ }}
          onComplete={() => { /* the PDF handoff in onPdfReady is the save */ }}
          onPdfReady={handlePdfReady}
          completeLabels={["Save completed document", "Guardar documento completado"]}
        />
      )}
    </div>
  );
}

export default function BusinessDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const lang = useLang();
  const [data, setData] = useState<Detail | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [showAllRequirements, setShowAllRequirements] = useState(false);
  const [showBusinessDetails, setShowBusinessDetails] = useState(false);
  // Tiles start collapsed; a deep link (#business-passport, #all-requirements …) opens its tile.
  const [activeTile, setActiveTile] = useState<string>("passport");
  const [navEl, setNavEl] = useState<HTMLUListElement | null>(null);
  const [panelEl, setPanelEl] = useState<HTMLDivElement | null>(null);
  /** Switch sections; bring the panel's top into view if the reader had scrolled past it. */
  const selectSection = (key: string) => {
    setActiveTile(key);
    window.setTimeout(() => {
      const panel = document.querySelector<HTMLElement>('[data-testid="section-panel"]');
      if (panel && panel.getBoundingClientRect().top < 0) {
        const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        panel.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
      }
    }, 0);
  };
  /** Scroll without animation when the user prefers reduced motion. */
  const scrollToId = (elId: string) => window.setTimeout(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    document.getElementById(elId)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }, 0);
  const openSection = (key: string, elId: string) => { setActiveTile(key); scrollToId(elId); };
  const openRequirements = () => { setShowAllRequirements(true); scrollToId("all-requirements"); };
  /** Open one requirement (and its actions) in the dashboard's requirement list. */
  const openObligation = (obligationId: string) => { setShowAllRequirements(true); scrollToId(`obligation-${obligationId}`); };
  const [complianceTab, setComplianceTab] = useState<ComplianceTab>("calendar");
  useEffect(() => {
    const byHash: Record<string, string> = { "#business-passport": "passport", "#property-location": "location", "#evidence-locker": "evidence", "#missing-requirements": "missing", "#compliance-calendar": "calendar", "#annual-filings": "calendar" };
    const hash = window.location.hash;
    const t = window.setTimeout(() => {
      if (byHash[hash]) setActiveTile(byHash[hash]!);
      if (hash === "#annual-filings") setComplianceTab("filings");
      if (hash === "#all-requirements") setShowAllRequirements(true);
    }, 0);
    return () => window.clearTimeout(t);
  }, []);
  const [locations, setLocations] = useState<PassportLocationWithGeographies[] | null>(null);
  const locationCount = locations?.length ?? null;
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
  const loadLocations = useCallback(() => fetch(`/api/businesses/${encodeURIComponent(id)}/locations`, { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => setLocations(Array.isArray(j?.locations) ? j.locations : []))
    .catch(() => setLocations([])), [id]);
  useEffect(() => { void loadLocations(); }, [loadLocations]);

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
      id: `matter-${matter.id}`, name: matter.title, agency: L("Filing matter", lang), matter_title: matter.title,
      status: matter.status === "NEEDS_ATTENTION" ? "NEEDS_ATTENTION" : "IN_PROGRESS",
      due_date: matter.due_date, due_date_source: matter.due_date_source,
      source_reference: matter.source_reference, next_action: L("Continue filing", lang),
    }));
    const calendar = [...obligations.filter((item) => item.due_date && item.status !== "COMPLETED"), ...matterCalendar]
      .sort((a, b) => (a.due_date || "").localeCompare(b.due_date || ""));

    const history = matters.filter((matter) => matter.status === "COMPLETED");

    return { totalApplicable, completed: completed.length, readiness, missing, calendar, activeMatters, history };
  }, [data]);

  // Passport completeness for the tile header — same coverage the panel shows.
  const passportStats = useMemo(() => {
    if (!data?.business) return { filled: 0, total: 0, pct: 0 };
    const cov = passportCoverage(canonicalFromBusinessRow(data.business as unknown as Parameters<typeof canonicalFromBusinessRow>[0]));
    const total = cov.filled.length + cov.empty.length;
    return { filled: cov.filled.length, total, pct: total ? Math.round((cov.filled.length / total) * 100) : 0 };
  }, [data]);

  const activeFiling = data?.matters ? activeFilingFor(data.matters, data.obligations ?? [], data.agency_runs ?? []) : null;
  const conflict = data?.business ? municipalityConflict(data.business.municipality, locations ?? []) : null;

  if (loadError) return <div className="page-viewport bg-[#f4f1ea]"><div className="p-12 text-center text-sm text-rose-700">{L("Couldn't load this business right now.", lang)} <button type="button" onClick={() => void load()} className="font-semibold underline">{L("Try again", lang)}</button></div></div>;
  if (!data) return <div className="page-viewport bg-[#f4f1ea]"><div className="p-12 text-center text-slate-500">{L("Loading compliance profile…", lang)}</div></div>;
  if (data.error || !data.business) return <div className="page-viewport bg-[#f4f1ea]"><div className="p-12 text-center text-slate-500">{L("Business not found.", lang)}</div></div>;

  const business = data.business;
  const evidence = data.evidence ?? [];
  const submissions = data.submissions ?? [];
  const notifications = data.notifications ?? [];
  const deliverables = data.deliverables ?? [];
  const unreadNotifications = notifications.filter((item) => item.status === "PENDING" || item.status === "DELIVERED").length;
  const shortId = business.public_id || id;

  const readinessInfo = readinessLabel(derived.readiness, lang);
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
    <div className="page-viewport bg-[#f4f1ea]">
      
      <main className="mx-auto max-w-7xl px-5 py-8">
        <div className="flex items-center justify-between">
          <Link href="/businesses" className="text-sm font-semibold text-brand">← Back</Link>
          <Link href="/businesses" className="rounded-lg bg-[#161616] px-4 py-2 text-sm font-medium text-white">{L("My Businesses", lang)}</Link>
        </div>

        <header className="mt-3 rounded-2xl border border-[#161616]/15 bg-[#fbf8f2] p-6 text-[#161616]">
          <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
            <div>
              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-[#5a5a5a]">
                <Building2 className="h-3.5 w-3.5" /><span>{business.business_type || L("Business type not entered", lang)}</span>
                <span>·</span>
                <MapPin className="h-3.5 w-3.5" /><span>{business.municipality || L("Municipality not entered", lang)}</span>
                <span>·</span><span>{L("Active", lang)}</span>
              </div>
              <h1 className="font-[family-name:var(--font-display)] text-4xl font-medium tracking-tight md:text-5xl">{business.legal_name || business.name}</h1>
              <p className="mt-2 max-w-2xl text-base text-[#5a5a5a]">{business.entity_number || L("Entity number not entered", lang)} · {business.onboarding_mode === "EXISTING" ? L("Existing business reconstruction", lang) : L("SmartPR formation workflow", lang)}</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button" onClick={() => setShowBusinessDetails((value) => !value)} aria-expanded={showBusinessDetails}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#161616]/20 bg-white px-4 py-3 text-sm font-medium text-[#161616]"
              >
                {L("Business details", lang)}
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showBusinessDetails ? "rotate-180" : ""}`} />
              </button>
              <Link href={`/businesses/${shortId}/matters/new`} className="inline-flex items-center gap-2 rounded-lg bg-brand px-5 py-3 text-sm font-medium text-[#f6f3ea]">{L("Start New Filing / Renewal", lang)}</Link>
              <Link
                href={`/businesses/${shortId}/agency-run`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#161616]/20 bg-white px-4 py-3 text-sm font-medium text-[#161616] hover:bg-[#f4f1ea] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                data-testid="open-clara"
                aria-label={lang === "es" ? "Abrir Clara, asistente para radicar" : "Open Clara, filing assistant"}
              >
                <Bot className="h-4 w-4" aria-hidden="true" /> {lang === "es" ? "Abrir Clara" : "Open Clara"}
              </Link>
            </div>
          </div>

          {showBusinessDetails && (
            <div className="mt-5 grid gap-4 rounded-xl border border-[#161616]/15 bg-[#f4f1ea] p-4 sm:grid-cols-2 lg:grid-cols-3">
              <DetailField lang={lang} label={L("Legal name", lang)} value={business.legal_name || business.name} />
              <DetailField lang={lang} label={L("Entity number", lang)} value={business.entity_number} />
              <DetailField lang={lang} label={L("Business structure", lang)} value={business.business_structure} />
              <DetailField lang={lang} label={L("Business type", lang)} value={business.business_type} />
              <DetailField lang={lang} label={L("Industry", lang)} value={business.industry} />
              <DetailField lang={lang} label={L("Municipality", lang)} value={business.municipality} />
              <DetailField lang={lang} label={L("Physical address", lang)} value={business.physical_address} />
              <DetailField lang={lang} label={L("Onboarding mode", lang)} value={business.onboarding_mode === "EXISTING" ? L("Existing business reconstruction", lang) : L("SmartPR formation workflow", lang)} />
              <DetailField lang={lang} label={L("Entry created", lang)} value={fmtDate(business.created_at)} />
              <div className="sm:col-span-2 lg:col-span-3"><DetailField lang={lang} label={L("Notes", lang)} value={business.notes} /></div>
            </div>
          )}
        </header>

        {/* Active filing first (what am I preparing, what blocks it, what next),
            then overall business readiness and any location conflict. */}
        <div className="mt-6 grid items-start gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <ActiveFilingPanel
              lang={lang}
              filing={activeFiling}
              businessId={shortId}
              onOpenRequirement={() => openRequirements()}
              municipalityFlag={conflict ? conflict.passport : null}
            />
          </div>
          <div className="space-y-4">
            {conflict && (
              <MunicipalityNotice
                lang={lang}
                conflict={conflict}
                affected={municipalRequirements(data.obligations ?? []).map((o) => o.name)}
                onResolve={() => openSection("location", "property-location")}
                onReviewPassport={() => openSection("passport", "business-passport")}
              />
            )}
            <section className="rounded-2xl border border-[#D9DCE1] bg-white p-4" data-testid="business-readiness">
              <div className="flex items-center gap-4">
                <ReadinessRing percent={derived.readiness} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">{L("Overall readiness", lang)}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${readinessInfo.cls}`}>{readinessInfo.text}</span>
                  </div>
                  <p className="mt-1 text-sm font-semibold text-[#161616]">
                    {derived.totalApplicable
                      ? (lang === "es" ? `${derived.completed} de ${derived.totalApplicable} requisitos completados` : `${derived.completed} of ${derived.totalApplicable} requirements complete`)
                      : L("No applicable requirements recorded yet.", lang)}
                  </p>
                  {conflict && <p className="mt-0.5 text-xs font-medium text-amber-800">{lang === "es" ? "Puede cambiar: el municipio está en conflicto" : "May change: municipality conflict"}</p>}
                </div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <div className="rounded-xl bg-[#E8F3EC] px-2 py-2 text-center"><div className="text-lg font-bold text-[#1E6B43]">{derived.completed}</div><div className="text-[11px] text-[#1E6B43]">{L("Complete", lang)}</div></div>
                <div className="rounded-xl bg-[#FBEAEA] px-2 py-2 text-center"><div className="text-lg font-bold text-[#9F2D2D]">{Math.max(derived.totalApplicable - derived.completed, 0)}</div><div className="text-[11px] text-[#9F2D2D]">{lang === "es" ? "Pendientes" : "Remaining"}</div></div>
                <div className="rounded-xl bg-[#FBF1DE] px-2 py-2 text-center"><div className="text-lg font-bold text-[#8A5A00]">{derived.activeMatters.length}</div><div className="text-[11px] text-[#8A5A00]">{L("Active filing", lang)}</div></div>
              </div>
              {nextBestAction && (!activeFiling || activeFiling.next?.item.id !== nextBestAction.id) && (
                <a href={`#obligation-${nextBestAction.id}`} onClick={() => setShowAllRequirements(true)} className="mt-3 flex items-center gap-2 rounded-xl bg-[#F4F1EA] px-3 py-2 text-sm hover:bg-[#ece8de]">
                  <ArrowRight className="h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate"><span className="text-slate-500">{L("Next best action", lang)}: </span><span className="font-semibold text-[#161616]">{nextBestAction.name}</span></span>
                </a>
              )}
            </section>
          </div>
        </div>

        {/* Persistent section menu + content panel. Desktop: sticky left
            sidebar listing all seven sections; narrow screens: a sticky
            compact grid above the content. Every option stays visible. */}
        <div className="mt-6 grid gap-4 lg:grid-cols-[17rem_minmax(0,1fr)] lg:items-start" data-testid="business-sections">
          <nav
            aria-label={lang === "es" ? "Secciones del negocio" : "Business sections"}
            className="sticky top-0 z-30 -mx-5 border-b border-[#161616]/10 bg-[#f4f1ea] px-5 py-2 shadow-[0_4px_8px_-6px_rgba(15,23,42,0.25)] lg:top-4 lg:shadow-none lg:mx-0 lg:max-h-[calc(100dvh-2rem)] lg:overflow-y-auto lg:rounded-2xl lg:border lg:border-[#D9DCE1] lg:bg-white lg:p-2"
            data-testid="section-nav"
          >
            <ul ref={setNavEl} className="grid grid-cols-4 gap-1 lg:grid-cols-1" />
          </nav>
          <div ref={setPanelEl} className="min-w-0 scroll-mt-40 rounded-2xl border border-[#D9DCE1] bg-white p-4 sm:p-6 lg:scroll-mt-4" data-testid="section-panel" />
        </div>
        <div hidden data-testid="section-sources">
          <BusinessTile
            id="business-passport" testId="tile-passport" tone="blue" icon={<Building2 className="h-5 w-5" />}
            title={lang === "es" ? "Pasaporte del negocio" : "Business Passport"} shortTitle={lang === "es" ? "Pasaporte" : "Passport"}
            summary={lang === "es" ? `${passportStats.filled} de ${passportStats.total} datos guardados` : `${passportStats.filled} of ${passportStats.total} facts on file`}
            metric={`${passportStats.pct}%`} showSummaryInPanel={false}
            selected={activeTile === "passport"} onSelect={() => selectSection("passport")} navEl={navEl} panelEl={panelEl}
          >
            <BusinessPassportPanel businessId={shortId} business={business} lang={lang} onSaved={() => load()} showLocation={false} embedded />
          </BusinessTile>

          <BusinessTile
            id="property-location" testId="tile-location" tone="green" icon={<MapPin className="h-5 w-5" />}
            title={lang === "es" ? "Ubicación de la propiedad" : "Property location"} shortTitle={lang === "es" ? "Ubicación" : "Location"} metric={locationCount ?? "…"}
            summary={locationCount == null
              ? (lang === "es" ? "Cargando…" : "Loading…")
              : locationCount === 0
                ? (business.municipality || (lang === "es" ? "Aún no hay ubicación" : "No location yet"))
                : `${business.municipality ? `${business.municipality} · ` : ""}${lang === "es" ? `${locationCount} ubicación${locationCount === 1 ? "" : "es"}` : `${locationCount} location${locationCount === 1 ? "" : "s"}`}`}
            selected={activeTile === "location"} onSelect={() => selectSection("location")} navEl={navEl} panelEl={panelEl}
          >
            <PassportLocationSection businessId={shortId} lang={lang} embedded onPassportUpdated={() => { void load(); void loadLocations(); }} />
          </BusinessTile>

          <BusinessTile
            id="evidence-locker" testId="tile-evidence" tone="amber" icon={<FolderOpen className="h-5 w-5" />}
            title={lang === "es" ? "Archivo de evidencia" : "Evidence locker"} shortTitle={lang === "es" ? "Evidencia" : "Evidence"}
            summary={(() => {
              const verified = evidence.filter((e) => e.review_status === "VERIFIED").length;
              return lang === "es"
                ? `${evidence.length} documento${evidence.length === 1 ? "" : "s"} · ${verified} verificado${verified === 1 ? "" : "s"}`
                : `${evidence.length} document${evidence.length === 1 ? "" : "s"} · ${verified} verified`;
            })()}
            metric={evidence.length}
            selected={activeTile === "evidence"} onSelect={() => selectSection("evidence")} navEl={navEl} panelEl={panelEl}
          >
            <EvidenceLockerPanel
              businessId={shortId}
              files={evidence}
              obligations={(data.obligations ?? []).map((o) => ({ id: o.id, name: o.name, requirement_id: o.requirement_id }))}
              lang={lang}
              onChanged={() => load()}
              embedded
            />
          </BusinessTile>

          <BusinessTile
            id="missing-requirements" testId="tile-missing" tone="rose" icon={<ShieldAlert className="h-5 w-5" />}
            title={L("Missing Requirements", lang)} shortTitle={lang === "es" ? "Faltan" : "Missing"}
            summary={derived.missing.length
              ? (lang === "es" ? `Faltan ${derived.missing.length} · ${topMissing[0]?.name ?? ""}` : `${derived.missing.length} left · next: ${topMissing[0]?.name ?? ""}`)
              : (lang === "es" ? "No falta nada" : "Nothing missing")}
            metric={derived.missing.length}
            selected={activeTile === "missing"} onSelect={() => selectSection("missing")} navEl={navEl} panelEl={panelEl}
          >
            <div>
              {topMissing.length ? (
                <div className="space-y-2">
                  {topMissing.map((item, index) => (
                    <div key={item.id} className="flex items-center gap-3 rounded-xl border border-slate-200 px-4 py-3">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-500">{index + 1}</span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-semibold text-[#161616]">{item.name}</div>
                      </div>
                      <span className="hidden sm:inline-flex whitespace-nowrap rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-bold tracking-wide text-rose-700">{requirementStatusText(item.status, lang).toUpperCase()}</span>
                      <a href={`#obligation-${item.id}`} onClick={() => setShowAllRequirements(true)} className="shrink-0 rounded-lg bg-brand px-3.5 py-1.5 text-xs font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">{actionLabelForStatus(item.status, Boolean(item.matter_title), lang)}</a>
                    </div>
                  ))}
                </div>
              ) : <Empty text={L("No missing requirements are recorded.", lang)} />}
              <button type="button" onClick={() => setShowAllRequirements(true)} className="mt-3 text-sm font-semibold text-brand hover:underline">{L("View all requirements", lang)}</button>
            </div>
          </BusinessTile>

          <BusinessTile
            id="compliance-calendar" testId="tile-calendar" tone="violet" icon={<CalendarDays className="h-5 w-5" />}
            title={lang === "es" ? "Calendario y radicaciones anuales" : "Compliance calendar & annual filings"} shortTitle={lang === "es" ? "Calendario" : "Calendar"} showSummaryInPanel={false}
            summary={topCalendar[0] ? `${dateLabel(topCalendar[0].due_date, lang)} · ${topCalendar[0].name}` : (lang === "es" ? "Sin fechas próximas" : "No upcoming dates")}
            metric={derived.calendar.length}
            selected={activeTile === "calendar"} onSelect={() => selectSection("calendar")} navEl={navEl} panelEl={panelEl}
          >
            <DashboardCompliance
              lang={lang}
              businessIds={[business.id, business.public_id].filter((x): x is string => Boolean(x))}
              tab={complianceTab}
              onTab={setComplianceTab}
              onOpenObligation={openObligation}
            />
          </BusinessTile>

          <BusinessTile
            id="filings-documents" testId="tile-filings" tone="slate" icon={<FileText className="h-5 w-5" />}
            title={L("Filings & Documents", lang)} shortTitle={lang === "es" ? "Trámites" : "Filings"} metric={derived.activeMatters.length}
            summary={lang === "es"
              ? `${derived.activeMatters.length} radicación${derived.activeMatters.length === 1 ? "" : "es"} activa${derived.activeMatters.length === 1 ? "" : "s"} · ${evidence.length} documento${evidence.length === 1 ? "" : "s"}`
              : `${derived.activeMatters.length} active filing${derived.activeMatters.length === 1 ? "" : "s"} · ${evidence.length} document${evidence.length === 1 ? "" : "s"}`}
            selected={activeTile === "filings"} onSelect={() => selectSection("filings")} navEl={navEl} panelEl={panelEl}
          >
            <div>
            <div className="space-y-4">
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{L("Active filings", lang)}</div>
                {derived.activeMatters.length ? (
                  <div className="space-y-2">
                    {derived.activeMatters.map((matter) => (
                      <div key={matter.id} className="flex flex-col justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3 sm:flex-row sm:items-center">
                        <div className="min-w-0">
                          <div className="font-semibold text-[#161616]">{matter.title}</div>
                          <div className="text-xs text-slate-500">{matter.matter_type.replaceAll("_", " ")} · {L("Opened", lang)} {fmtDate(matter.opened_at)}</div>
                          <div className="mt-1.5">
                            <MatterSiteSelect businessId={shortId} matterId={matter.id} locationId={matter.location_id ?? null} lang={lang} />
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-3">
                          <StatusBadge status={matter.status === "READY" ? "CURRENT" : matter.status === "DRAFT" ? "IN_PROGRESS" : matter.status as ObligationStatus} lang={lang} />
                          <ScorePill score={matter.readiness_score} />
                          {matter.submission_id && <Link href={`/?entry=new-business&resume=${matter.submission_id}`} className="text-xs font-semibold text-brand">Resume →</Link>}
                          <button onClick={() => void completeMatter(matter.id)} className="rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-600">{L("Mark filing complete", lang)}</button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : <Empty text={L("No active filings.", lang)} />}
              </div>
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{L("Documents", lang)}</div>
                {evidence.length ? (
                  <div className="space-y-2">
                    {evidence.map((item) => (
                      <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3">
                        <div className="min-w-0"><div className="truncate font-semibold text-[#161616]">{item.original_filename}</div><div className="text-xs text-slate-500">{item.obligation_name || L("Unmatched evidence", lang)} · {L("Added", lang)} {fmtDateTime(item.created_at)}{(item.requirement_tags && item.requirement_tags.length) ? ` · ${item.requirement_tags.join(", ")}` : ""}</div></div>
                        <div className="flex shrink-0 items-center gap-2">
                          <StatusBadge status={item.review_status === "VERIFIED" ? "CURRENT" : item.review_status === "NEEDS_REVIEW" ? "NEEDS_ATTENTION" : "UNKNOWN"} lang={lang} />
                          <DownloadButton kind="evidence" id={item.id} lang={lang} />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : <Empty text={L("No uploaded evidence is associated with this business.", lang)} />}
              </div>
              {deliverables.length > 0 && (
                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{L("Deliverable library", lang)}</div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {deliverables.map((item) => (
                      <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3">
                        <div className="min-w-0"><div className="truncate font-semibold text-[#161616]">{item.filename}</div><div className="text-xs text-slate-500">{item.kind} · {fmtDateTime(item.generated_at)}</div></div>
                        <DownloadButton kind="deliverables" id={item.id} lang={lang} />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            </div>
          </BusinessTile>

          <BusinessTile
            id="history-notifications" testId="tile-history" tone="slate" icon={<Bell className="h-5 w-5" />}
            title={L("History & Notifications", lang)} shortTitle={lang === "es" ? "Historial" : "History"} metric={derived.history.length + submissions.length}
            summary={(() => {
              const n = derived.history.length + submissions.length;
              return lang === "es"
                ? `${n} radicación${n === 1 ? "" : "es"} pasada${n === 1 ? "" : "s"} · ${unreadNotifications} sin leer`
                : `${n} past filing${n === 1 ? "" : "s"} · ${unreadNotifications} unread`;
            })()}
            selected={activeTile === "history"} onSelect={() => selectSection("history")} navEl={navEl} panelEl={panelEl}
          >
            <div>
            <div className="space-y-4">
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{L("Filing history", lang)}</div>
                {derived.history.length || submissions.length ? (
                  <div className="space-y-2">
                    {derived.history.map((matter) => <div key={matter.id} className="rounded-xl border border-slate-200 px-4 py-3"><div className="font-semibold text-[#161616]">{matter.title}</div><div className="text-xs text-slate-500">{L("Completed", lang)} {fmtDate(matter.completed_at)}</div></div>)}
                    {submissions.map((submission) => (
                      <Link key={submission.id} href={`/history/${submission.id}`} className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3">
                        <div><div className="font-semibold text-[#161616]">Rules evaluation · {fmtDate(submission.created_at)}</div><div className="text-xs text-slate-500">{submission.business_type || L("Business profile", lang)} · {submission.municipality || "—"}</div></div>
                        <ScorePill score={submission.readiness_score} />
                      </Link>
                    ))}
                  </div>
                ) : <Empty text={L("No filing history yet.", lang)} />}
              </div>
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{L("Notifications", lang)}</div>
                {notifications.length ? (
                  <div className="space-y-2">
                    {notifications.slice(0, 10).map((item) => <div key={item.id} className="rounded-xl border border-slate-200 px-4 py-3"><div className="text-sm font-semibold text-[#161616]">{item.message}</div><div className="text-xs text-slate-500">{L("Scheduled", lang)} {fmtDateTime(item.scheduled_for)} · {item.status}</div></div>)}
                  </div>
                ) : <Empty text={L("No reminders have been scheduled.", lang)} />}
              </div>
            </div>
            </div>
          </BusinessTile>
        </div>

        {showAllRequirements && (
          <section id="all-requirements" className="mt-6 rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-950/[0.02]">
            <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4 font-bold text-[#161616]">
              {L("All requirements", lang)}
              <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{derived.totalApplicable}</span>
              <button type="button" onClick={() => setShowAllRequirements(false)} className="text-sm font-semibold text-brand hover:underline">{L("Hide", lang)}</button>
            </div>
            <div className="space-y-3 p-5">
              {outstandingDisplay.length ? outstandingDisplay.map((item) => (
                <ObligationRow
                  key={item.id} item={item} business={business} businessId={shortId} evidence={evidence} reload={load} onMarkComplete={markRecentlyCompleted}
                />
              )) : <Empty text={L("No outstanding requirements.", lang)} />}
              {otherCompleted.length > 0 && (
                <>
                  <div className="pt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{L("Completed", lang)}</div>
                  {otherCompleted.map((item) => (
                    <ObligationRow
                      key={item.id} item={item} business={business} businessId={shortId} evidence={evidence} reload={load}
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
