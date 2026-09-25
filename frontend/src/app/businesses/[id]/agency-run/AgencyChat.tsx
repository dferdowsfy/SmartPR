"use client";

/**
 * AgencyChat — chat-primary thread for the agency assistant.
 *
 * The chat is the primary surface for the whole run: filing picker,
 * pre-flight card, goal brief, milestone messages, one in-place transient
 * status, intervention cards (secure inputs, values never rendered), and
 * review card. The live browser is secondary (AgencyBrowser) and never
 * required.
 *
 * Filing-first: the picker lists the specific filings SmartPR identified
 * for this business (obligations joined to the filing registry, grouped by
 * agency). SmartPR decides what needs to be filed — the human only picks
 * which filing to prepare, and the browser agent executes only that one.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, ArrowRight, ArrowUp, Building2, CheckCircle2, ChevronDown, ChevronRight, ClipboardList,
  Eye, EyeOff, FileText, Flame, Hand, KeyRound, Landmark, ListChecks, Loader2, Play, Sparkles, Square,
  Stamp, Upload,
} from "lucide-react";
import type { Lang } from "../../../forms/engine/types";
import type {
  AgencyPauseReason,
  AgencyPendingField,
  AgencyRunPublic,
} from "../../../../lib/agency-runs/types";
import {
  nonSensitiveMissingItems,
  type FilingGroup,
  type FilingOption,
  type FilingStatus,
} from "../../../../lib/agency-runs/agencyActions";
import {
  collectPortalValidationMessages,
  fieldHasValidationIssue,
  VALIDATION_HINT_RE,
} from "../../../../lib/agency-runs/pendingFields";
import {
  isSealedSensitiveValue,
  unsealSensitiveValue,
} from "../../../../lib/agency-runs/sensitiveCrypto";
import {
  fieldValuePresent,
  isSensitiveField,
  type FieldValue,
} from "../../../../lib/agency-runs/sensitiveFields";
import { prefillFromPassport } from "../../../../lib/agency-runs/prefillFromPassport";
import { INLINE_STEPS, type PortalStepKind } from "../../../../lib/agency-runs/portalStep";
import { AGENCY_FILING_CONFIGS } from "../../../../lib/agency-runs/filingTypes";
import {
  filingReadinessKey,
  type FilingReadiness,
  type FilingReadinessSummary,
} from "../../../../lib/agency-runs/filingReadiness";
import { looksLikeSecret } from "./chatContracts";
import { cardDisplayName, cardExpiryLabel } from "../../../../lib/billing/filingFeeCard";
import { saveCardHref, useFilingFeeCard } from "../../FilingFeeCardSettings";
import {
  filingGateCopy,
  filingPassportCtaCopy,
  filingPickerIntro,
  filingStatusChipLabel,
  filingNotAvailableCopy,
  filingUnsupportedCopy,
  type AgencyAction,
  type ChatMilestone,
  type GoalBrief,
  type Preflight,
} from "./chatContracts";

const L = (en: string, es: string, lang: Lang) => (lang === "es" ? es : en);

/* ------------------------------------------------------------------ */
/* Session messages — ephemeral chat content around the run lifecycle   */
/* ------------------------------------------------------------------ */

/**
 * Filing picker — the first message. Lists the specific filings SmartPR
 * identified for this business (obligations joined to the filing registry),
 * grouped by agency. Agency is a visual heading only; the execution
 * objective is always the picked filing.
 */
export interface FilingPickerMsg {
  id: string;
  type: "filing-picker";
  groups: FilingGroup[];
  /** Documents on file + per-filing readiness (null = unavailable / signed out). */
  readiness?: FilingReadinessSummary | null;
  loading: boolean;
  error: string | null;
}
export interface GoalBriefMsg {
  id: string;
  type: "goal-brief";
  brief: GoalBrief;
  filingLabelEn: string;
  filingLabelEs: string;
}
/**
 * Pre-flight session message — shown after Start on an action card, before
 * the run launches. Passport items first (labels only), then at most 3
 * questions. Answers are passed to onConfirmPreflight; unanswered questions
 * simply become mid-run pauses.
 */
export interface PreflightMsg {
  id: string;
  type: "preflight";
  preflight: Preflight;
  action: AgencyAction;
  filingLabelEn: string;
  filingLabelEs: string;
  uploadsEn: string;
  uploadsEs: string;
}
export interface TextMsg {
  id: string;
  type: "text";
  textEn: string;
  textEs: string;
  tone: "info" | "warn" | "success";
}
/** Something the human typed into the chat input. */
export interface UserTextMsg {
  id: string;
  type: "user";
  text: string;
}
export type SessionMsg =
  | FilingPickerMsg
  | GoalBriefMsg
  | PreflightMsg
  | TextMsg
  | UserTextMsg;

/* ------------------------------------------------------------------ */
/* Small pieces                                                         */
/* ------------------------------------------------------------------ */

/**
 * Criticality tones for chat bubbles. Background carries the level; text
 * stays near-black on every tone so each notification reads at a glance.
 * - action (hand — Clara needs you): strongest, rose
 * - warn (yield sign): light yellow
 * - success / info (check marks): light green
 */
export type BubbleTone = "neutral" | "info" | "success" | "warn" | "action";

const BUBBLE_TONE_CLASSES: Record<BubbleTone, string> = {
  neutral: "border-[#161616]/10 bg-white",
  info: "border-emerald-100 bg-emerald-50/60",
  success: "border-emerald-200 bg-emerald-50",
  warn: "border-amber-200 bg-amber-50",
  action: "border-rose-300 bg-rose-100",
};

function AssistantBubble({
  children,
  id,
  tone = "neutral",
}: {
  children: React.ReactNode;
  id?: string;
  tone?: BubbleTone;
}) {
  return (
    <div id={id} className="flex scroll-mt-4 items-start gap-2.5">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#1e4d38] font-[family-name:var(--font-display)] text-[15px] text-white">
        M
      </span>
      <div
        className={`min-w-0 flex-1 rounded-2xl rounded-tl-md border px-4 py-3 shadow-sm shadow-slate-950/[0.03] ${BUBBLE_TONE_CLASSES[tone]}`}
      >
        {children}
      </div>
    </div>
  );
}

function MilestoneIcon({ tone }: { tone: ChatMilestone["tone"] }) {
  if (tone === "success") return <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700" />;
  if (tone === "action") return <Hand className="h-4 w-4 shrink-0 text-rose-700" />;
  if (tone === "warn") return <AlertTriangle className="h-4 w-4 shrink-0 text-amber-700" />;
  return <CheckCircle2 className="h-4 w-4 shrink-0 text-[#1e4d38]" />;
}

function MilestoneBubble({ milestone, lang }: { milestone: ChatMilestone; lang: Lang }) {
  const [open, setOpen] = useState(false);
  const hasDetails = (milestone.details?.length ?? 0) > 0;
  return (
    <AssistantBubble tone={milestone.tone}>
      <div className="flex items-start gap-2">
        <MilestoneIcon tone={milestone.tone} />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold text-[#161616]">
            {L(milestone.heading_en, milestone.heading_es, lang)}
          </p>
          {milestone.body_en && milestone.tone !== "info" ? (
            <p className="mt-1 text-[15px] leading-snug text-slate-800">
              {L(milestone.body_en, milestone.body_es ?? milestone.body_en, lang)}
            </p>
          ) : null}
          {hasDetails && (
            <div className="mt-2">
              <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className="inline-flex items-center gap-1 text-[15px] font-semibold text-[#1e4d38]"
                aria-expanded={open}
              >
                {L("View details", "Ver detalles", lang)}
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
              </button>
              {open && (
                <ul className="mt-2 space-y-1.5 rounded-xl bg-slate-50 p-3">
                  {milestone.details!.map((d, i) => (
                    <li key={i} className="flex items-start gap-2 text-[15px] text-slate-700">
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                      <span>{L(d.label_en, d.label_es, lang)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </AssistantBubble>
  );
}

/**
 * Recent agent status updates — the last few stay visible (older ones
 * dimmed) so fast status changes can actually be read instead of flashing
 * by in a single in-place line. Only the newest pulses.
 */
function TransientHistory({ labels }: { labels: string[] }) {
  if (labels.length === 0) return null;
  return (
    <div className="space-y-1.5 pl-11" aria-live="polite">
      {labels.map((label, i) => {
        const latest = i === labels.length - 1;
        return (
          <div key={`${i}-${label}`} className="flex items-center gap-2.5">
            {latest ? (
              <span className="relative flex h-2.5 w-2.5 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#1e4d38] opacity-60" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#1e4d38]" />
              </span>
            ) : (
              <span className="inline-flex h-2 w-2 shrink-0 rounded-full bg-slate-300" />
            )}
            <p className={latest ? "text-[15px] text-slate-500" : "text-[13px] text-slate-400"}>
              {label}
            </p>
          </div>
        );
      })}
    </div>
  );
}

const FILING_CHIP_STYLES: Record<FilingStatus, string> = {
  ready_to_start: "border-blue-200 bg-blue-50 text-blue-800",
  missing_information: "border-amber-200 bg-amber-50 text-amber-900",
  in_progress: "border-sky-200 bg-sky-50 text-sky-800",
  submitted: "border-emerald-200 bg-emerald-50 text-emerald-800",
  blocked: "border-amber-200 bg-amber-50 text-amber-900",
  not_available: "border-slate-200 bg-slate-100 text-slate-500",
  unsupported: "border-slate-200 bg-slate-100 text-slate-500",
};

/** Agency icon tile — colour-coded so agencies are recognisable at a glance. */
function AgencyTile({ agencyId, agencyName }: { agencyId: string; agencyName: string }) {
  const name = agencyName.toLowerCase();
  const [Icon, cls] =
    agencyId === "HACIENDA_SURI"
      ? [Landmark, "bg-emerald-50 text-emerald-700"]
      : agencyId === "DEPT_STATE"
        ? [Building2, "bg-sky-50 text-sky-700"]
        : agencyId === "OGPE"
          ? [Stamp, "bg-violet-50 text-violet-700"]
          : agencyId === "DEMO_REHEARSAL"
            ? [Sparkles, "bg-amber-50 text-amber-700"]
            : /fire|bombero/.test(name)
              ? [Flame, "bg-rose-50 text-rose-600"]
              : /municip/.test(name)
                ? [Landmark, "bg-teal-50 text-teal-700"]
                : [FileText, "bg-slate-100 text-slate-600"];
  return (
    <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${cls}`} aria-hidden="true">
      <Icon className="h-5 w-5" />
    </span>
  );
}

/**
 * One agency submission card. The whole card opens the filing's browser-
 * assisted workflow (pre-flight first); the human still reviews and submits
 * on the portal. Fully ready filings get the strong primary "Submit";
 * filings with gaps keep a softer button and say what's still needed.
 * Filings that can't launch show why — never a button.
 */
function FilingCard({
  filing,
  readiness,
  lang,
  onStart,
  onResume,
  busy,
  disabled,
  passportHref,
}: {
  filing: FilingOption;
  readiness: FilingReadiness | null;
  lang: Lang;
  onStart: () => void;
  onResume: () => void;
  busy: boolean;
  disabled: boolean;
  passportHref: string | null;
}) {
  const action = filing.action;
  const gate = action ? nonSensitiveMissingItems(action).length : 0;
  const verification = action
    ? AGENCY_FILING_CONFIGS.find((c) => c.id === action.filing_type)?.verification
    : undefined;
  const canStart =
    filing.supported &&
    (filing.filing_status === "ready_to_start" ||
      filing.filing_status === "missing_information");
  const canResume =
    filing.supported &&
    filing.filing_status === "in_progress" &&
    Boolean(filing.active_run_id);
  const fullyReady = canStart && readiness !== null && readiness.ready === readiness.total && gate === 0;
  const stillNeeded = readiness ? readiness.items.filter((i) => !i.ready) : [];
  const actionable = (canStart || canResume) && !disabled && !busy;
  const open = canResume ? onResume : onStart;
  const agency = L(filing.agency_en, filing.agency_es, lang);
  // Titles carry an agency prefix ("Dept. of State — Form a corporation");
  // the card already names the agency, so show just the filing.
  const title = L(filing.title_en, filing.title_es, lang).replace(/^[^—]{2,40}\s—\s/, "");
  const earlyAccess =
    filing.supported && verification && verification.status !== "verified" && action?.agency_id !== "DEMO_REHEARSAL";

  return (
    <div
      data-testid="filing-card"
      data-ready={fullyReady ? "true" : "false"}
      role={actionable ? "button" : undefined}
      tabIndex={actionable ? 0 : undefined}
      aria-label={actionable ? L(`${agency}: ${title} — open in the browser`, `${agency}: ${title} — abrir en el navegador`, lang) : undefined}
      onClick={(e) => {
        if (!actionable || (e.target as HTMLElement).closest("a,button")) return;
        open();
      }}
      onKeyDown={(e) => {
        if (!actionable || e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      }}
      className={`group rounded-2xl border bg-white p-3.5 transition-colors ${
        fullyReady
          ? "border-blue-300 bg-blue-50/40 shadow-sm shadow-blue-900/[0.05]"
          : "border-slate-200"
      } ${actionable ? "cursor-pointer hover:border-blue-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500" : ""}`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <AgencyTile agencyId={filing.agency_id} agencyName={filing.agency_en} />
        <div className="min-w-[10rem] flex-1">
          <p className="text-[15px] font-bold leading-snug text-[#161616]">{agency}</p>
          <p className="text-[14px] leading-snug text-slate-600">{title}</p>
          {readiness ? (
            <p className="mt-0.5 flex items-center gap-1.5 text-[13px] text-slate-500" data-testid="filing-readiness">
              <FileText className="h-3.5 w-3.5 shrink-0" />
              {L(
                `${readiness.ready} of ${readiness.total} ${readiness.total === 1 ? "item" : "items"} ready`,
                `${readiness.ready} de ${readiness.total} listos`,
                lang
              )}
            </p>
          ) : action ? (
            <p className="mt-0.5 flex items-center gap-1.5 text-[13px] text-slate-500">
              <FileText className="h-3.5 w-3.5 shrink-0" />
              {L(`${action.known} of ${action.total} ready from your Passport`, `${action.known} de ${action.total} listas en tu Pasaporte`, lang)}
            </p>
          ) : null}
        </div>
        {canStart || canResume ? (
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <button
              type="button"
              disabled={busy || disabled}
              onClick={open}
              className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-[14px] font-bold disabled:opacity-50 ${
                fullyReady || canResume
                  ? "bg-blue-600 text-white hover:bg-blue-700"
                  : "bg-blue-50 text-blue-700 hover:bg-blue-100"
              }`}
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {busy
                ? L("Opening…", "Abriendo…", lang)
                : canResume
                  ? L("Resume", "Continuar", lang)
                  : L("Submit", "Enviar", lang)}
              {!busy && <ArrowRight className="h-3.5 w-3.5" />}
            </button>
            <ChevronRight className="h-4 w-4 text-slate-300 transition-colors group-hover:text-slate-500" aria-hidden="true" />
          </div>
        ) : (
          <span
            className={`ml-auto shrink-0 rounded-full border px-2.5 py-0.5 text-[12px] font-bold ${FILING_CHIP_STYLES[filing.filing_status]}`}
          >
            {filingStatusChipLabel(filing, lang)}
          </span>
        )}
      </div>

      {!filing.supported && (
        <p className="mt-2 pl-14 text-[13px] leading-snug text-slate-500">
          {filing.filing_status === "not_available" ? filingNotAvailableCopy(lang) : filingUnsupportedCopy(lang)}
        </p>
      )}
      {canStart && stillNeeded.length > 0 && (
        <p className="mt-2 pl-14 text-[13px] leading-snug text-amber-800" data-testid="filing-still-needed">
          <span className="font-semibold">{L("Still needed: ", "Falta: ", lang)}</span>
          {stillNeeded.map((i) => L(i.label_en, i.label_es, lang)).join(", ")}
          {gate > 0 && passportHref && (
            <>
              {" · "}
              <a href={passportHref} className="font-semibold text-blue-700 hover:underline">
                {filingPassportCtaCopy(lang)}
              </a>
            </>
          )}
        </p>
      )}
      {action && action.blocked_by.length > 0 && (
        <p className="mt-1 pl-14 text-[13px] text-slate-500">
          {L("Waiting on: ", "Esperando: ", lang)}
          {action.blocked_by.join(", ")}
        </p>
      )}
      {earlyAccess && (
        <p className="mt-1.5 pl-14 text-[12px] leading-snug text-slate-500">
          <span className="font-semibold text-slate-600">{L("Early access: ", "Acceso anticipado: ", lang)}</span>
          {L(
            "Clara pauses and hands over whenever the portal differs from what it expects.",
            "Clara se detiene y te pasa el control cuando el portal no coincide con lo esperado.",
            lang
          )}
        </p>
      )}
    </div>
  );
}

const DOC_STATUS_LABEL: Record<string, [string, string]> = {
  verified: ["Complete", "Completo"],
  on_file: ["On file", "En archivo"],
  needs_attention: ["Needs attention", "Requiere atención"],
};

/** Supporting documents SmartPR has on file (Evidence Locker + Passport). */
function DocumentsOnFile({ docs, lang }: { docs: FilingReadinessSummary["documents"]; lang: Lang }) {
  if (docs.length === 0) return null;
  return (
    <ul className="mt-3 space-y-1.5 rounded-xl border border-emerald-100 bg-emerald-50/50 px-3 py-2.5" data-testid="documents-on-file">
      {docs.map((d) => {
        const done = d.status !== "needs_attention";
        return (
          <li key={d.id} className="flex items-center gap-2.5 text-[14px]">
            {done ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
            ) : (
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
            )}
            <span className="min-w-0 flex-1 leading-snug text-slate-800">{L(d.label_en, d.label_es, lang)}</span>
            <span className={`shrink-0 text-[13px] font-semibold ${done ? "text-emerald-700" : "text-amber-700"}`}>
              {L(DOC_STATUS_LABEL[d.status][0], DOC_STATUS_LABEL[d.status][1], lang)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* Pre-flight card — passport-first intake before the run launches      */
/* ------------------------------------------------------------------ */

export interface PreflightAnswers {
  account_status?: "has_account" | "no_account";
  fields?: Record<string, string>;
}

function PreflightCard({
  preflight,
  action,
  filingLabelEn,
  filingLabelEs,
  lang,
  onConfirm,
}: {
  preflight: Preflight;
  action: AgencyAction;
  filingLabelEn: string;
  filingLabelEs: string;
  lang: Lang;
  onConfirm: (answers: PreflightAnswers) => Promise<void>;
}) {
  const [accountChoice, setAccountChoice] = useState<"has_account" | "no_account" | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const items = preflight.passport_items ?? [];
  const inlineItems = items.slice(0, 5);
  // Only the portal-account question is asked up front. Sensitive values
  // (SSN, …) and documents are requested in the run, at the exact portal
  // step that needs them — the pre-flight card stays a quick confirm.
  const questions = preflight.questions.filter((q) => q.kind === "account_status");

  // Gate: SmartPR information still missing — the browser never launches
  // until these are complete (the human goes back to SmartPR fields).
  const gate = nonSensitiveMissingItems(action).length;

  const handleConfirm = async () => {
    setConfirmBusy(true);
    setConfirmError(null);
    try {
      await onConfirm({
        ...(accountChoice ? { account_status: accountChoice } : {}),
      });
      setSubmitted(true);
    } catch (e) {
      setConfirmError(
        e instanceof Error ? e.message : L("Could not start the run.", "No se pudo iniciar la ejecución.", lang)
      );
    } finally {
      setConfirmBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-[#161616]/10 bg-white p-4 shadow-sm shadow-slate-950/[0.03]">
      <p className="font-[family-name:var(--font-display)] text-lg font-medium text-[#23211c]">
        {L("Before we start — quick check", "Antes de arrancar — chequeo rápido", lang)}
      </p>
      <p className="mt-1 text-[15px] text-slate-600">
        {L(
          `Here's my plan for your ${filingLabelEn}.`,
          `Este es mi plan para tu ${filingLabelEs}.`,
          lang
        )}
      </p>

      {/* Passport first — labels only, nothing to fill in */}
      <div className="mt-2.5 rounded-xl border border-[#1e4d38]/25 bg-[#1e4d38]/[.06] p-3">
        <p className="text-[15px] font-semibold text-[#1e4d38]">
          {L(
            `Using from your Business Passport (${items.length} items):`,
            `Estoy usando de tu Pasaporte de Negocio (${items.length}):`,
            lang
          )}
        </p>
        <p className="mt-1 text-[15px] leading-snug text-[#1e4d38]/80">
          {inlineItems.map((f) => L(f.label_en, f.label_es, lang)).join(", ")}
          {items.length > inlineItems.length ? ` +${items.length - inlineItems.length}` : ""}
        </p>
        <p className="mt-1 text-[15px] font-medium text-[#1e4d38]/70">
          {L("You won't need to re-enter any of this.", "No tienes que volver a escribir nada de esto.", lang)}
        </p>
        {items.length > inlineItems.length && (
          <details className="mt-1">
            <summary className="cursor-pointer text-[15px] font-semibold text-[#1e4d38]">
              {L("See all", "Ver todo", lang)}
            </summary>
            <ul className="mt-1 space-y-0.5">
              {items.map((f, i) => (
                <li key={i} className="flex items-center gap-1.5 text-[15px] text-[#1e4d38]/80">
                  <CheckCircle2 className="h-3 w-3 shrink-0" />
                  {L(f.label_en, f.label_es, lang)}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      {/* Questions second — only the portal-account choice */}
      {questions.length > 0 && !submitted && (
        <div className="mt-2.5">
          <p className="text-[15px] font-semibold text-slate-700">
            {L("Still need from you:", "Todavía necesito de ti:", lang)}
          </p>
          <div className="mt-1.5 space-y-2.5">
            {questions.map((q, qi) => {
              if (q.kind === "account_status") {
                const portal = L(preflight.portal_name_en, preflight.portal_name_es, lang);
                return (
                  <div key={`q-${qi}`} className="rounded-lg border border-slate-200 bg-white p-2.5">
                    <p className="text-[15px] font-medium text-slate-800">
                      {L(
                        `Do you already have an account on ${portal}?`,
                        `¿Ya tienes cuenta en ${portal}?`,
                        lang
                      )}
                    </p>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      {(
                        [
                          ["has_account", L("I have an account", "Tengo cuenta", lang)],
                          ["no_account", L("Create one for me", "Crear una para mí", lang)],
                        ] as const
                      ).map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setAccountChoice(value)}
                          className={`rounded-lg border px-2.5 py-2 text-[15px] font-semibold transition ${
                            accountChoice === value
                              ? "border-[#1e4d38] bg-[#1e4d38]/[.06] text-[#1e4d38]"
                              : "border-slate-200 bg-white text-slate-700 hover:border-[#1e4d38]/40"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <p className="mt-1.5 text-[15px] leading-snug text-slate-500">
                      {L(
                        "If you don't have one, I'll create it first and pause where a password must be created — I never invent it.",
                        "Si no tienes, la creo primero y me detengo donde haya que crear la contraseña — nunca la invento.",
                        lang
                      )}
                    </p>
                  </div>
                );
              }
              return null;
            })}
          </div>
        </div>
      )}

      {/* Start — always visible */}
      {submitted ? (
        <p className="mt-3 flex items-center gap-1.5 text-[15px] font-semibold text-emerald-700">
          <CheckCircle2 className="h-4 w-4" />
          {L("Started — launching your filing…", "Empezado — lanzando tu radicación…", lang)}
        </p>
      ) : (
        <>
          {confirmError && (
            <p className="mt-2.5 text-[15px] font-medium text-rose-700">{confirmError}</p>
          )}
          {gate > 0 && (
            <p className="mt-2.5 flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[15px] font-semibold text-amber-800">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {filingGateCopy(gate, lang)}
            </p>
          )}
          <button
            type="button"
            disabled={confirmBusy}
            onClick={() => void handleConfirm()}
            className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-[#1e4d38] px-3 py-2.5 text-[15px] font-bold text-white hover:bg-[#16382a] disabled:opacity-50"
          >
            {confirmBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            {L("Start filing", "Empezar la radicación", lang)}
          </button>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Intervention card — paused runs                                      */
/* ------------------------------------------------------------------ */

export interface InterventionProps {
  lang: Lang;
  run: AgencyRunPublic;
  pendingFields: AgencyPendingField[];
  /** Ids the human already supplied once (ids only) — drives the confirm card. */
  suppliedFieldIds: string[];
  /**
   * Value-backed "asking again" subset: pending fields for which we actually
   * retain a previously-submitted value in this run. The banner renders ONLY
   * for these — never on an id alone.
   */
  askedAgainFields: AgencyPendingField[];
  /**
   * Retained values: plaintext for non-sensitive fields, sealed envelopes
   * for sensitive ones (the parent seals before they rest here). The card
   * keeps ephemeral plaintext buffers for sensitive inputs while typing.
   */
  fieldValues: Record<string, FieldValue>;
  onFieldChange: (id: string, value: string) => void;
  revealedFields: Record<string, boolean>;
  onToggleReveal: (id: string) => void;
  onFillContinue: () => void;
  canFillFields: boolean;
  validationError: string | null;
  uploadsText: string;
  onResume: () => void;
  onStop: () => void;
  onTakeover: () => void;
  hasLiveUrl: boolean;
  takeover: boolean;
  onUpload: (file: File) => void;
  uploadBusy: boolean;
  uploadMsg: string | null;
  busy: boolean;
}

/**
 * Payment handoff. No agency has an authorized SmartPR payment integration,
 * so the human pays the agency directly in its portal. Before they do, show
 * who is paid, the amount the portal shows, that SmartPR charges nothing
 * here, and where the card goes — and say plainly that SmartPR payment
 * methods or credit cannot be used in a government checkout.
 */
function PaymentHandoff({ run, lang }: { run: AgencyRunPublic; lang: Lang }) {
  const config = AGENCY_FILING_CONFIGS.find((c) => c.id === run.filing_type);
  const flowPayee = config?.agencyEn;
  const amount = run.portal_step?.amount ?? null;
  const { state: cardState } = useFilingFeeCard(run.business_id);
  const savedCard = cardState.status === "ready" ? cardState.card : null;
  const expiry = savedCard ? cardExpiryLabel(savedCard) : null;
  const rows: [string, string][] = [
    [L("Payee", "Beneficiario", lang), (lang === "es" ? config?.agencyEs : flowPayee) ?? L("The agency", "La agencia", lang)],
    [
      L("Amount", "Monto", lang),
      amount
        ? `${amount} ${L("(as shown by the portal — check it there)", "(según el portal — verifícalo allí)", lang)}`
        : L("Shown on the portal's payment page", "Aparece en la página de pago del portal", lang),
    ],
    [L("SmartPR fee for this step", "Cargo de SmartPR por este paso", lang), L("None", "Ninguno", lang)],
    [
      L("How you pay", "Cómo pagas", lang),
      L(
        "You enter the card directly in the agency portal. Clara doesn't type card details and SmartPR doesn't charge this fee.",
        "Tú escribes la tarjeta directamente en el portal de la agencia. Clara no escribe datos de tarjeta y SmartPR no cobra este cargo.",
        lang
      ),
    ],
  ];
  return (
    <div className="mt-2 rounded-lg border border-rose-200 bg-white/80 px-3 py-2" data-testid="payment-handoff">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="font-semibold text-slate-700">{k}</dt>
            <dd className="text-slate-800">{v}</dd>
          </div>
        ))}
      </dl>
      {savedCard ? (
        <div
          className="mt-2 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[13px] text-slate-800"
          data-testid="payment-handoff-card"
        >
          <span className="font-semibold">
            {L(`Use your ${cardDisplayName(savedCard)}`, `Usa tu ${cardDisplayName(savedCard)}`, lang)}
          </span>
          {expiry && (
            <span className={savedCard.expired ? " text-rose-700" : " text-slate-500"}>
              {savedCard.expired
                ? L(` — expired ${expiry}, use another card`, ` — venció ${expiry}, usa otra tarjeta`, lang)
                : L(` (exp. ${expiry})`, ` (vence ${expiry})`, lang)}
            </span>
          )}
          <span className="block text-xs text-slate-500">
            {L(
              "Saved in your Business Passport as your filing-fee card. Type it into the portal's payment form yourself.",
              "Guardada en tu Pasaporte comercial como tarjeta para cargos de radicación. Escríbela tú en el formulario de pago del portal.",
              lang
            )}
          </span>
        </div>
      ) : cardState.status === "ready" ? (
        <p className="mt-1.5 text-xs text-slate-500">
          {L("No filing-fee card saved. ", "No hay tarjeta guardada para cargos. ", lang)}
          <a href={saveCardHref(run.business_id)} target="_blank" rel="noopener" className="font-semibold text-brand hover:underline">
            {L("Save one for next time", "Guarda una para la próxima", lang)}
          </a>
        </p>
      ) : null}
      {config?.payment.feeNote && (
        <p className="mt-1.5 text-xs text-slate-500">{config.payment.feeNote}</p>
      )}
      <p className="mt-1.5 text-xs text-slate-500">
        {L(
          "The agency only accepts payment in its own portal, so SmartPR can't charge your saved card or apply SmartPR credit to this government fee.",
          "La agencia solo acepta pagos en su propio portal, así que SmartPR no puede cobrar tu tarjeta guardada ni aplicar crédito de SmartPR a este cargo del gobierno.",
          lang
        )}
      </p>
    </div>
  );
}

/** Title + instruction for a human-only portal step (no chat inputs). */
function humanStepCopy(kind: PortalStepKind, lang: Lang): { title: string; body: string } {
  switch (kind) {
    case "login":
      return {
        title: L("Sign in on the portal", "Inicia sesión en el portal", lang),
        body: L(
          "The portal wants your sign-in. Take over the browser and sign in yourself — SmartPR never asks for or stores portal passwords. Press “I'm done” when you're in and I'll continue.",
          "El portal pide tu inicio de sesión. Toma el control del navegador e inicia sesión tú mismo — SmartPR nunca pide ni guarda contraseñas del portal. Pulsa “Terminé” cuando entres y sigo yo.",
          lang
        ),
      };
    case "mfa":
      return {
        title: L("Enter the verification code", "Escribe el código de verificación", lang),
        body: L(
          "Take over the browser and type the code the portal sent you, then press “I'm done”.",
          "Toma el control del navegador y escribe el código que te envió el portal, luego pulsa “Terminé”.",
          lang
        ),
      };
    case "captcha":
      return {
        title: L("Quick human check", "Verificación humana", lang),
        body: L(
          "Take over the browser, complete the check on the portal page, then press “I'm done”.",
          "Toma el control del navegador, completa la verificación en la página del portal y luego pulsa “Terminé”.",
          lang
        ),
      };
    case "certification":
    case "signature":
      return {
        title: L("Review and certify — this one is yours", "Revisa y certifica — esto te toca a ti", lang),
        body: L(
          "Read the certification on the portal page. Take over the browser to check the box and sign with your printed name — I never certify or sign for you. Press “I'm done” when it's complete.",
          "Lee la certificación en la página del portal. Toma el control del navegador para marcar la casilla y firmar con tu nombre — nunca certifico ni firmo por ti. Pulsa “Terminé” cuando termines.",
          lang
        ),
      };
    case "payment":
      return {
        title: L("Payment — this one is yours", "Pago — esto te toca a ti", lang),
        body: L(
          "Review the amount and pay directly on the portal page. I never enter payment details or pay. Take over, then press “I'm done”.",
          "Revisa el monto y paga directamente en la página del portal. Nunca ingreso datos de pago ni pago. Toma el control y luego pulsa “Terminé”.",
          lang
        ),
      };
    case "review":
    case "submission":
      return {
        title: L("Final review — you submit", "Revisión final — tú envías", lang),
        body: L(
          "Check everything on the portal page, then submit it yourself. I never submit for you.",
          "Revisa todo en la página del portal y envíalo tú mismo. Nunca envío por ti.",
          lang
        ),
      };
    default:
      return {
        title: L("I can't tell what this page needs", "No puedo identificar qué pide esta página", lang),
        body: L(
          "Rather than guess, I've paused. Take over the browser, finish this step on the portal, then press “I'm done” and I'll pick up from there.",
          "En vez de adivinar, me detuve. Toma el control del navegador, termina este paso en el portal y luego pulsa “Terminé” y sigo desde ahí.",
          lang
        ),
      };
  }
}

function InterventionCard(props: InterventionProps) {
  const { run, pendingFields, lang } = props;
  const fileRef = useRef<HTMLInputElement | null>(null);
  const firstEmptyFieldRef = useRef<HTMLInputElement | null>(null);
  const seedKeyRef = useRef<string>("");

  /**
   * Ephemeral plaintext buffers for sensitive inputs while typing.
   * Adopted once per field-set from retained sealed envelopes (e.g. the
   * asked-again prefill); never persisted — the parent store keeps only
   * sealed envelopes. The buffers die with this card.
   */
  const [sensitiveInputs, setSensitiveInputs] = useState<Record<string, string>>({});
  const sensitiveSeedKeyRef = useRef<string>("");
  const sensitiveTouchedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const key = `${run.id}:${pendingFields.map((f) => f.id).join(",")}`;
    if (sensitiveSeedKeyRef.current !== key) {
      sensitiveSeedKeyRef.current = key;
      sensitiveTouchedRef.current.clear();
      setSensitiveInputs({});
    }
    // Adopt retained sealed values the user hasn't touched (e.g. the
    // asked-again prefill arriving after the first seed) by unsealing them
    // into the ephemeral typing buffer only.
    let cancelled = false;
    (async () => {
      const adopted: Record<string, string> = {};
      for (const f of pendingFields) {
        if (!isSensitiveField(f) || sensitiveTouchedRef.current.has(f.id)) continue;
        const v = props.fieldValues[f.id];
        if (!isSealedSensitiveValue(v)) continue;
        try {
          const plain = await unsealSensitiveValue(v);
          if (!cancelled && plain && !sensitiveTouchedRef.current.has(f.id)) {
            adopted[f.id] = plain;
          }
        } catch {
          // Corrupt envelope — leave the input empty rather than blocking.
        }
      }
      if (!cancelled && Object.keys(adopted).length > 0) {
        setSensitiveInputs((prev) => {
          const next = { ...prev };
          for (const [id, p] of Object.entries(adopted)) {
            if (!sensitiveTouchedRef.current.has(id) && !next[id]) next[id] = p;
          }
          return next;
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [run.id, pendingFields, props.fieldValues]);

  const pauseReason: AgencyPauseReason = run.pause_reason;
  /**
   * The visible portal step decides what this card may show. Only ordinary
   * data steps (form / identity) render inputs; every other step — login,
   * MFA, captcha, certification, signature, payment, review, unknown — is
   * done by the human in the browser. With no reported step, fields imply a
   * data step and anything else is treated as unknown (take over), never as
   * a login form.
   */
  const stepKind: PortalStepKind =
    run.portal_step?.kind ??
    (pendingFields.length > 0
      ? "form"
      : pauseReason === "USER_UPLOAD"
        ? "upload"
        : pauseReason === "CAPTCHA"
          ? "captcha"
          : pauseReason === "PAYMENT"
            ? "payment"
            : "unknown");
  const stepTitle = run.portal_step?.title ?? null;
  const stepMissing = run.portal_step?.missing ?? [];
  /** Fields the human already supplied once that the agent is asking for
   * again — these get a confirm banner instead of blank inputs. */
  // Banner renders ONLY for fields with an actually-retained prior value
  // (computed by the parent) — never on a bare supplied id.
  const askedAgain = props.askedAgainFields ?? [];
  /** Text-field pause: the assistant card is the only place to type. */
  const fieldsPause = INLINE_STEPS.has(stepKind) && pendingFields.length > 0;
  const portalValidationMessages = useMemo(
    () => collectPortalValidationMessages(pendingFields),
    [pendingFields]
  );
  const showValidationBanner =
    portalValidationMessages.length > 0 ||
    pendingFields.some((f) => fieldHasValidationIssue(f));
  const isUpload = stepKind === "upload";
  /** Human-only step: the card explains it and offers Take over — no inputs. */
  const humanStep = !fieldsPause && !isUpload;

  // Seed non-sensitive values from the passport snapshot whenever a new
  // fields pause appears. Seeded values merge into fieldValues (local state
  // only — never into chat text or events).
  useEffect(() => {
    if (pendingFields.length === 0) return;
    const seedKey = `${run.id}:${pauseReason || ""}:${pendingFields.map((f) => f.id).join(",")}`;
    if (seedKeyRef.current === seedKey) return;
    seedKeyRef.current = seedKey;
    // Never seed a field the portal just rejected: the passport value is
    // exactly what failed validation (e.g. a PO box on a street-address
    // field), so re-offering it would loop.
    const seedable = pendingFields.filter((f) => !f.error);
    const seeded = prefillFromPassport(seedable, run.passport_snapshot);
    for (const [id, value] of Object.entries(seeded)) {
      if (value) props.onFieldChange(id, value);
    }
  }, [run.id, pauseReason, pendingFields, run.passport_snapshot]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-focus the first empty required field when a fields pause appears.
  useEffect(() => {
    if (!fieldsPause || props.takeover) return;
    const handle = window.setTimeout(() => {
      // preventScroll: focusing must never scroll the page or the browser
      // panel — the chat's own stick-to-bottom decides what is in view.
      firstEmptyFieldRef.current?.focus({ preventScroll: true });
    }, 50);
    return () => window.clearTimeout(handle);
  }, [fieldsPause, props.takeover, pendingFields, run.id]);

  const humanCopy = humanStep ? humanStepCopy(stepKind, lang) : null;

  return (
    <AssistantBubble id="agency-intervention" tone="action">
      <div className="flex items-start gap-2">
        <Hand className="mt-0.5 h-4 w-4 shrink-0 text-rose-700" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-bold uppercase tracking-[0.18em] text-rose-800">
            {fieldsPause
              ? L("Item needed", "Falta un dato", lang)
              : L("Your turn in the browser", "Te toca en el navegador", lang)}
          </p>
          <p className="text-[15px] font-bold text-[#161616]">
            {humanCopy ? humanCopy.title : isUpload ? L("Documents needed", "Documentos necesarios", lang) : L("One more item needed", "Falta un dato", lang)}
          </p>
          {/* Ties this request to the page visible in the browser. */}
          {stepTitle && (
            <p className="mt-0.5 text-[13px] text-slate-600">
              {L("On the portal:", "En el portal:", lang)}{" "}
              <span className="font-semibold text-slate-800">{stepTitle}</span>
            </p>
          )}

          {props.validationError && (
            <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[15px] font-medium text-rose-800">
              {props.validationError}
            </div>
          )}

          {showValidationBanner && (
            <div
              role="alert"
              className="mt-2 flex gap-2 rounded-lg border border-rose-300 bg-rose-50 px-2.5 py-2 text-[15px] leading-snug text-rose-950"
            >
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
              <div>
                <div className="font-bold text-rose-900">
                  {L(
                    "Portal rejected a value — fix below",
                    "El portal rechazó un valor — corríjalo abajo",
                    lang
                  )}
                </div>
                {portalValidationMessages.length > 0 ? (
                  <p className="mt-1 text-rose-900/90">
                    {portalValidationMessages.join(" · ")}
                  </p>
                ) : null}
              </div>
            </div>
          )}

          {run.pause_streak >= 3 && (
            <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[15px] font-medium text-red-800">
              {L(
                `Still stuck on this step after ${run.pause_streak} tries. If fields are listed, fill them and continue — otherwise take over only for captcha or odd UI, then press “I'm done”.`,
                `Sigo atascado en este paso después de ${run.pause_streak} intentos. Si hay campos, llénalos y continúa — si no, toma el control solo para captcha o pantallas raras, luego pulsa “Terminé”.`,
                lang
              )}
            </div>
          )}

          {askedAgain.length > 0 && !showValidationBanner && (
            <div className="mt-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-[15px] font-medium text-sky-900">
              {L(
                "I kept what you entered last time — check it and continue.",
                "Guardé lo que escribiste la vez pasada — revísalo y continúa.",
                lang
              )}
            </div>
          )}

          {humanCopy && (
            <>
              <p className="mt-1.5 text-[15px] leading-snug text-slate-700">{humanCopy.body}</p>
              {stepKind === "payment" && <PaymentHandoff run={run} lang={lang} />}
              {stepMissing.length > 0 && (
                <div className="mt-2 rounded-lg border border-rose-200 bg-white/70 px-3 py-2">
                  <p className="text-[13px] font-semibold text-slate-800">
                    {L("Still empty on this page:", "Todavía vacío en esta página:", lang)}
                  </p>
                  <ul className="mt-1 list-disc pl-5 text-[15px] text-slate-800">
                    {stepMissing.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}

          {isUpload && (
            <p className="mt-1.5 text-[15px] leading-snug text-slate-600">
              {L(
                `${props.uploadsText}. Max 5 MB per file — upload into the Evidence Locker, then Resume.`,
                `${props.uploadsText}. Máx. 5 MB por archivo — súbelo al Casillero de evidencia y luego Reanudar.`,
                lang
              )}
            </p>
          )}

          {fieldsPause && (
            <form
              className="mt-2.5 space-y-2"
              onSubmit={(e) => {
                // Enter in any field submits, same as Fill & continue.
                e.preventDefault();
                if (!props.busy && props.canFillFields) props.onFillContinue();
              }}
            >
              <p className="text-[15px] leading-snug text-slate-700">
                {L(
                  "Type it here and I'll enter it on the portal page shown in the browser. Never stored.",
                  "Escríbelo aquí y lo pondré en la página del portal que ves en el navegador. No se guarda.",
                  lang
                )}
              </p>
              {pendingFields.map((field, index) => {
                const isSensitive = isSensitiveField(field);
                const revealed = Boolean(props.revealedFields[field.id]);
                // Sensitive inputs type into the card's ephemeral buffer; the
                // parent keeps only the sealed envelope. Never compare or
                // render sealed envelopes as text.
                const currentValue: FieldValue = isSensitive
                  ? (sensitiveInputs[field.id] ?? "")
                  : props.fieldValues[field.id];
                const emptyRequired =
                  !field.optional && !fieldValuePresent(currentValue);
                const isFirstEmpty =
                  emptyRequired &&
                  pendingFields.findIndex(
                    (f) =>
                      !f.optional &&
                      !fieldValuePresent(
                        isSensitiveField(f)
                          ? (sensitiveInputs[f.id] ?? "")
                          : props.fieldValues[f.id]
                      )
                  ) === index;
                // Never type="password": inline requests are never
                // credentials, and a password input is what makes browser
                // password managers offer to save/suggest. Sensitive values
                // (SSN, …) are masked visually instead.
                const inputType =
                  field.type === "tel" ? "tel" : field.type === "number" ? "number" : "text";
                return (
                  <label key={field.id} className="block">
                    <span className="mb-1 block text-[13px] font-semibold text-slate-700">
                      {field.label}
                      {field.optional ? (
                        <span className="font-normal text-slate-400">
                          {L(" (optional)", " (opcional)", lang)}
                        </span>
                      ) : null}
                    </span>
                    <div className="relative">
                      <input
                        ref={isFirstEmpty ? firstEmptyFieldRef : undefined}
                        type={inputType}
                        name={`mita-${run.id.slice(0, 8)}-${field.id}`}
                        autoComplete="off"
                        autoCorrect="off"
                        spellCheck={false}
                        // Password-manager opt-outs (1Password, LastPass,
                        // Bitwarden, Dashlane) — belt and braces on top of
                        // never rendering a password input.
                        data-1p-ignore=""
                        data-lpignore="true"
                        data-bwignore=""
                        data-form-type="other"
                        style={
                          isSensitive && !revealed
                            ? ({ WebkitTextSecurity: "disc" } as React.CSSProperties)
                            : undefined
                        }
                        inputMode={
                          field.type === "email"
                            ? "email"
                            : field.type === "tel" || /ssn|itin|tax_id/i.test(field.id)
                              ? "numeric"
                              : undefined
                        }
                        value={
                          isSensitive
                            ? (sensitiveInputs[field.id] ?? "")
                            : typeof currentValue === "string"
                              ? currentValue
                              : ""
                        }
                        onChange={(e) => {
                          const next = e.target.value;
                          if (isSensitive) {
                            // Keep plaintext only in this card's ephemeral
                            // buffer while typing; the parent seals it for
                            // retention.
                            sensitiveTouchedRef.current.add(field.id);
                            setSensitiveInputs((prev) => ({
                              ...prev,
                              [field.id]: next,
                            }));
                          }
                          props.onFieldChange(field.id, next);
                        }}
                        className={`w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[15px] text-slate-900 placeholder:text-slate-400 focus:border-[#1e4d38] focus:outline-none focus:ring-1 focus:ring-[#1e4d38] ${
                          isSensitive ? "pr-9" : ""
                        }`}
                      />
                      {isSensitive && (
                        <button
                          type="button"
                          data-no-autoscroll
                          onClick={() => props.onToggleReveal(field.id)}
                          className="absolute inset-y-0 right-0 flex items-center px-2 text-slate-500 hover:text-slate-800"
                          aria-label={
                            revealed
                              ? L("Hide value", "Ocultar valor", lang)
                              : L("Show value", "Mostrar valor", lang)
                          }
                        >
                          {revealed ? (
                            <EyeOff className="h-3.5 w-3.5" />
                          ) : (
                            <Eye className="h-3.5 w-3.5" />
                          )}
                        </button>
                      )}
                    </div>
                    {field.error ? (
                      <p className="mt-1 text-xs font-medium leading-snug text-rose-700">
                        {field.error}
                      </p>
                    ) : null}
                    {field.hint ? (
                      <p
                        className={`mt-1 text-xs leading-snug ${
                          !field.error && VALIDATION_HINT_RE.test(field.hint)
                            ? "font-medium text-rose-700"
                            : "text-slate-500"
                        }`}
                      >
                        {field.hint}
                      </p>
                    ) : null}
                  </label>
                );
              })}
              <button
                type="submit"
                disabled={props.busy || !props.canFillFields}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-[#1e4d38] px-3 py-2 text-[15px] font-bold text-white hover:bg-[#16382a] disabled:opacity-50"
              >
                <Play className="h-3.5 w-3.5" />
                {L("Fill & continue", "Llenar y continuar", lang)}
                <kbd className="ml-1 hidden rounded border border-white/30 px-1 text-xs font-medium text-white/80 sm:inline">
                  Enter
                </kbd>
              </button>
            </form>
          )}

          {isUpload && (
            <div className="mt-2.5 space-y-2">
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,image/*,.doc,.docx"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) props.onUpload(file);
                }}
              />
              <button
                type="button"
                disabled={props.uploadBusy}
                onClick={() => fileRef.current?.click()}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-2 text-[15px] font-semibold text-indigo-800 disabled:opacity-50"
              >
                <Upload className="h-3.5 w-3.5" />
                {props.uploadBusy
                  ? L("Uploading…", "Subiendo…", lang)
                  : L("Upload to Evidence Locker", "Subir al Casillero de evidencia", lang)}
              </button>
              {props.uploadMsg && <p className="text-[15px] text-slate-600">{props.uploadMsg}</p>}
            </div>
          )}

          {(humanStep || isUpload) && props.hasLiveUrl && !props.takeover && (
            <button
              type="button"
              onClick={props.onTakeover}
              className="mt-2.5 inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-[#1e4d38] px-3 py-2 text-[15px] font-bold text-white hover:bg-[#16382a]"
            >
              <KeyRound className="h-3.5 w-3.5" />
              {L("Take over the browser", "Tomar el control del navegador", lang)}
            </button>
          )}
          {humanStep && props.takeover && (
            <p className="mt-2.5 rounded-lg bg-white/70 px-3 py-2 text-[15px] text-slate-700">
              {L(
                "You're in control — finish this step in the browser, then press “I'm done” above the browser.",
                "Tienes el control — termina este paso en el navegador y luego pulsa “Terminé” sobre el navegador.",
                lang
              )}
            </p>
          )}

          {fieldsPause && props.hasLiveUrl && !props.takeover && (
            <button
              type="button"
              onClick={props.onTakeover}
              className="mt-2 w-full text-center text-[15px] font-medium text-slate-700 underline-offset-2 hover:text-[#1e4d38] hover:underline"
            >
              {L(
                "Browser showing something else? Take over instead",
                "¿El navegador muestra otra cosa? Toma el control",
                lang
              )}
            </button>
          )}

          <div className="mt-3 flex gap-2">
            {(!fieldsPause || isUpload) && (
              <button
                type="button"
                disabled={props.busy}
                onClick={props.onResume}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full border border-[#1e4d38]/40 bg-white px-3 py-2 text-[15px] font-bold text-[#1e4d38] hover:bg-[#1e4d38]/[.06] disabled:opacity-50"
              >
                <Play className="h-3.5 w-3.5" />
                {humanStep
                  ? L("I did it — continue", "Listo — continuar", lang)
                  : L("Resume", "Reanudar", lang)}
              </button>
            )}
            <button
              type="button"
              disabled={props.busy}
              onClick={props.onStop}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-[15px] font-semibold text-slate-700 disabled:opacity-50"
            >
              <Square className="h-3.5 w-3.5" />
              {L("Stop", "Detener", lang)}
            </button>
          </div>
        </div>
      </div>
    </AssistantBubble>
  );
}

/* ------------------------------------------------------------------ */
/* Review card — ready for final review                                 */
/* ------------------------------------------------------------------ */

function ReviewCard({
  lang,
  knownCount,
  onReviewInBrowser,
  onClose,
  busy,
}: {
  lang: Lang;
  knownCount: number | null;
  onReviewInBrowser: () => void;
  onClose: () => void;
  busy: boolean;
}) {
  return (
    <AssistantBubble tone="success">
      <div className="flex items-start gap-2">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-bold text-[#161616]">
            {L(
              "Your application is prepared and ready for your final review.",
              "Tu solicitud está preparada y lista para tu revisión final.",
              lang
            )}
          </p>
          <p className="mt-1.5 text-[15px] leading-snug text-slate-600">
            {knownCount !== null
              ? L(
                  `I filled ${knownCount} fields from your Business Passport.`,
                  `Llené ${knownCount} campos de tu Pasaporte de Negocio.`,
                  lang
                )
              : L(
                  "I filled in everything I could from your Business Passport.",
                  "Llené todo lo que pude de tu Pasaporte de Negocio.",
                  lang
                )}
          </p>
          <p className="mt-1.5 text-[15px] leading-snug text-slate-700">
            {L(
              "Submitting is yours: take over the browser, review every page, and press the portal's Submit button yourself. Press “I'm done” afterwards and I'll record the confirmation.",
              "Enviar te toca a ti: toma el control del navegador, revisa cada página y pulsa tú el botón Enviar del portal. Luego pulsa “Terminé” y registro la confirmación.",
              lang
            )}
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={onReviewInBrowser}
            className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-[#1e4d38] px-3 py-2 text-[15px] font-bold text-white hover:bg-[#16382a] disabled:opacity-50"
          >
            <KeyRound className="h-3.5 w-3.5" />
            {L("Take over to review & submit", "Tomar el control para revisar y enviar", lang)}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-[15px] font-semibold text-slate-700 disabled:opacity-50"
          >
            <Square className="h-3.5 w-3.5" />
            {L("Close run", "Cerrar ejecución", lang)}
          </button>
        </div>
      </div>
    </AssistantBubble>
  );
}

/* Submitted card — authorized filing completed on the portal            */
/* ------------------------------------------------------------------ */

function SubmittedCard({
  lang,
  confirmation,
  onDone,
  busy,
}: {
  lang: Lang;
  confirmation: string | null;
  onDone: () => void;
  busy: boolean;
}) {
  return (
    <AssistantBubble tone="success">
      <div className="flex items-start gap-2">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-bold text-[#161616]">
            {L("Filed — you're all set.", "Enviado — listo.", lang)}
          </p>
          {confirmation && (
            <p className="mt-1.5 text-[15px] font-medium text-slate-700">
              {L(
                `Confirmation: ${confirmation}`,
                `Confirmación: ${confirmation}`,
                lang
              )}
            </p>
          )}
          <p className="mt-1.5 text-[15px] leading-snug text-slate-600">
            {L(
              "You submitted this filing on the portal — I recorded the confirmation it showed.",
              "Enviaste este trámite en el portal — registré la confirmación que mostró.",
              lang
            )}
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={onDone}
            className="mt-2.5 inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-[#1e4d38] px-3 py-2 text-[15px] font-bold text-white hover:bg-[#16382a] disabled:opacity-50"
          >
            {L("Back to filings", "Volver a los trámites", lang)}
          </button>
        </div>
      </div>
    </AssistantBubble>
  );
}

/* ------------------------------------------------------------------ */
/* Main chat thread                                                     */
/* ------------------------------------------------------------------ */

export interface AgencyChatProps {
  lang: Lang;
  /** Short public business id — used to link missing-information cards to the Business Passport. */
  businessId: string;
  msgs: SessionMsg[];
  milestones: ChatMilestone[];
  run: AgencyRunPublic | null;
  runActive: boolean;
  /** Last few agent status updates — rendered as a persistent recent-activity list. */
  transientHistory: string[];
  scrollKey: string;
  /**
   * Bumped by actions outside the chat (e.g. "I'm done" in the browser
   * panel) that must jump the thread to the newest activity.
   */
  scrollToLatestSignal?: number;
  /** Start pre-flight for a specific SmartPR filing (obligation-joined option). */
  onStartFiling: (filing: FilingOption) => void;
  /** Reopen the existing run behind an in-progress filing (never starts over). */
  onResumeFiling: (filing: FilingOption) => void;
  filingBusyId: string | null;
  /** Pre-flight confirm → POST /api/agency-actions with the answers. */
  onConfirmPreflight: (msg: PreflightMsg, answers: PreflightAnswers) => Promise<void>;
  /** Pre-flight evidence attach — uploads straight to the Evidence Locker. */
  onUploadEvidence: (file: File, tags: string[]) => void;
  uploadBusy: boolean;
  intervention: InterventionProps | null;
  review: {
    knownCount: number | null;
    onReviewInBrowser: () => void;
    onClose: () => void;
    busy: boolean;
  } | null;
  submitted: {
    confirmation: string | null;
    onDone: () => void;
    busy: boolean;
  } | null;
  terminalNote: { textEn: string; textEs: string; tone: "info" | "warn" } | null;
  onStop: () => void;
  busy: boolean;
  stoppedOrFailed: boolean;
  onNewRun: () => void;
  runFailed: boolean;
  /** Business / project name shown above the filing list. */
  projectName?: string | null;
  /** Free-text question from the chat input (general SmartPR assistant, not the browser agent). */
  onAsk: (text: string) => void;
  askBusy: boolean;
  /** "Show missing items" quick action. */
  onShowMissing: () => void;
  /** "Prepare documents" quick action target. */
  prepareHref: string;
}

const QUICK_ACTION =
  "inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-[13px] font-semibold text-blue-700 hover:border-blue-300 hover:bg-blue-50";

/**
 * Stable busy key for a filing card. Dept. of State can surface two
 * objective variants for the same obligation — the objective distinguishes
 * them so the spinner lands on the right card.
 */
export function filingBusyKey(filing: FilingOption): string {
  return `${filing.id}:${filing.obligation_id}:${filing.action?.objective_en ?? ""}`;
}

export function AgencyChat(props: AgencyChatProps) {
  const { lang } = props;
  const [draft, setDraftState] = useState("");
  const [composerNote, setComposerNote] = useState<string | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const setDraft = (text: string) => {
    setDraftState(text);
    if (composerNote) setComposerNote(null);
    requestAnimationFrame(() => {
      const el = composerRef.current;
      if (el && document.activeElement !== el && text) {
        el.focus();
        el.setSelectionRange(text.length, text.length);
      }
    });
  };
  const scrollBoxRef = useRef<HTMLDivElement>(null);

  /**
   * Stick-to-bottom: while true, any growth of the thread (new milestone,
   * status line, card) scrolls to the newest activity. Only an explicit
   * scroll-up by the human (wheel / touch / keys) releases it; reaching the
   * bottom again — or pressing any action button in the chat — re-arms it.
   * Programmatic smooth scrolls never release it, which is what broke the
   * old "only when already near the bottom" check after a click.
   */
  // Off at entry: opening Clara shows the thread from its first message.
  // It arms once the user acts in the chat, a run's cards arrive, or a
  // restored session asks to jump to the newest activity.
  const stickRef = useRef(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // Chat auto-scroll is always container-local: only the message list moves,
  // never the window or an outer ancestor — so the browser panel and the
  // field cards stay anchored while the human fills them out.
  /**
   * Pin the chat to its newest message — instantly, then again after the
   * next two frames, so content that is still growing (a card mounting,
   * fonts, a status line appearing) is never left clipped below the fold.
   * Only the message list moves; never the page or the browser panel.
   */
  const pinToBottom = () => {
    const box = scrollBoxRef.current;
    if (!box) return;
    box.scrollTop = box.scrollHeight;
    requestAnimationFrame(() => {
      if (!stickRef.current) return;
      box.scrollTop = box.scrollHeight;
      requestAnimationFrame(() => {
        if (stickRef.current) box.scrollTop = box.scrollHeight;
      });
    });
  };

  useEffect(() => {
    scrollBoxRef.current?.scrollTo({ top: 0 });
  }, []);
  useEffect(() => {
    const box = scrollBoxRef.current;
    const content = contentRef.current;
    if (!box || !content) return;
    // Messages that grow after rendering keep the view pinned while sticky.
    const ro = new ResizeObserver(() => {
      if (stickRef.current) box.scrollTop = box.scrollHeight;
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, []);
  const releaseStick = () => {
    stickRef.current = false;
  };
  const onChatScroll = () => {
    const box = scrollBoxRef.current;
    if (!box) return;
    if (box.scrollHeight - box.scrollTop - box.clientHeight < 40) stickRef.current = true;
  };
  const onChatClickCapture = (e: React.MouseEvent) => {
    const btn = (e.target as HTMLElement).closest("button");
    if (!btn || btn.hasAttribute("data-no-autoscroll")) return;
    stickRef.current = true;
    window.setTimeout(pinToBottom, 60);
  };

  useEffect(() => {
    if (stickRef.current) pinToBottom();
  }, [props.scrollKey]);

  // Hand-backs from outside the chat always re-arm stick-to-bottom and jump
  // to the newest activity (the thread may shrink first as the card closes,
  // so scroll again once the new status lands).
  useEffect(() => {
    if (!props.scrollToLatestSignal) return;
    stickRef.current = true;
    pinToBottom();
    const t = window.setTimeout(pinToBottom, 400);
    return () => window.clearTimeout(t);
  }, [props.scrollToLatestSignal]);

  // The newest pre-flight card is the human's next step after pressing
  // Start. Pressing Start locks the page into the workspace (see page.tsx),
  // so the chat box is the scroller — track the card so the effect below
  // scrolls it to the top of the list.
  const lastPreflightId = useMemo(() => {
    for (let i = props.msgs.length - 1; i >= 0; i--) {
      if (props.msgs[i].type === "preflight") return props.msgs[i].id;
    }
    return null;
  }, [props.msgs]);

  // Actionable cards (pre-flight / fill fields / review / submitted) always
  // scroll into view, even if the human scrolled up — the thing they must
  // act on is never lost below the fold.
  const actionableKey = props.intervention
    ? `intervention:${props.intervention.run.id}:${props.intervention.pendingFields
        .map((f) => f.id)
        .join(",")}`
    : props.review
      ? `review:${props.run?.id ?? "noid"}`
      : props.submitted
        ? `submitted:${props.run?.id ?? "noid"}`
        : lastPreflightId
          ? `preflight:${lastPreflightId}`
          : null;
  const seenActionableRef = useRef<string | null>(null);
  useEffect(() => {
    if (!actionableKey || seenActionableRef.current === actionableKey) return;
    seenActionableRef.current = actionableKey;
    // Let the card mount first, then bring it into view.
    const t = window.setTimeout(() => {
      if (actionableKey.startsWith("preflight:")) {
        // Show the pre-flight card from its top so it can be read; the
        // human's Start click re-arms stick-to-bottom. Container-local
        // (scrollIntoView would also scroll overflow-hidden ancestors).
        const box = scrollBoxRef.current;
        const el = document.getElementById(
          `agency-msg-${actionableKey.slice("preflight:".length)}`
        );
        if (box && el) {
          stickRef.current = false;
          const top =
            box.scrollTop + el.getBoundingClientRect().top - box.getBoundingClientRect().top - 16;
          box.scrollTo({ top, behavior: "smooth" });
        }
      } else {
        stickRef.current = true;
        pinToBottom();
      }
    }, 60);
    return () => window.clearTimeout(t);
  }, [actionableKey]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollBoxRef}
        onScroll={onChatScroll}
        onWheel={(e) => {
          if (e.deltaY < 0) releaseStick();
        }}
        onTouchMove={releaseStick}
        onKeyDown={(e) => {
          if (e.key === "PageUp" || e.key === "Home" || (e.key === "ArrowUp" && e.target === e.currentTarget)) {
            releaseStick();
          }
        }}
        onClickCapture={onChatClickCapture}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 md:px-5"
      >
        <div ref={contentRef} className="space-y-4">
        {props.msgs.map((msg) => {
          if (msg.type === "filing-picker") {
            const readiness = msg.readiness ?? null;
            const readinessFor = (f: FilingOption) =>
              readiness?.filings.find((r) => r.key === filingReadinessKey(f)) ?? null;
            const cards = msg.groups.flatMap((g) => g.filings);
            // Filings that can open come first; ones that can't stay visible below.
            const openable = cards.filter((f) => f.supported && f.filing_status !== "submitted");
            const other = cards.filter((f) => !openable.includes(f));
            const hasDocs = (readiness?.documents.length ?? 0) > 0;
            const card = (filing: FilingOption) => (
              <FilingCard
                key={`${filing.id}:${filing.obligation_id}`}
                filing={filing}
                readiness={readinessFor(filing)}
                lang={lang}
                busy={props.filingBusyId === filingBusyKey(filing)}
                disabled={props.runActive || props.filingBusyId !== null}
                onStart={() => props.onStartFiling(filing)}
                onResume={() => props.onResumeFiling(filing)}
                passportHref={`/businesses/${props.businessId}#business-passport`}
              />
            );
            return (
              <div key={msg.id} className="space-y-3" data-testid="filing-picker">
                {props.projectName && (
                  <p className="text-[12px] font-bold uppercase tracking-wider text-slate-400">{props.projectName}</p>
                )}
                <AssistantBubble>
                  <p className="text-[15px] leading-snug text-slate-800">
                    {hasDocs
                      ? L(
                          "Based on the documents you've completed, you're ready to start submissions with the following agencies. I've mapped each filing to the required documents we have on file.",
                          "Según los documentos que completaste, puedes empezar a radicar con las siguientes agencias. Relacioné cada trámite con los documentos requeridos que tenemos en archivo.",
                          lang
                        )
                      : filingPickerIntro(lang)}
                  </p>
                  {readiness && <DocumentsOnFile docs={readiness.documents} lang={lang} />}
                  {!msg.loading && !msg.error && openable.length > 0 && (
                    <p className="mt-3 text-[15px] leading-snug text-slate-700">
                      {L(
                        "You can submit to the agencies below. Select one to open it in the browser. SmartPR will guide you through the process and use your information to help complete the filing — you review and submit on the portal.",
                        "Puedes radicar con las agencias de abajo. Elige una para abrirla en el navegador. SmartPR te guía y usa tu información para ayudarte a completar el trámite — tú revisas y envías en el portal.",
                        lang
                      )}
                    </p>
                  )}
                </AssistantBubble>
                {msg.loading ? (
                  <p className="flex items-center gap-2 pl-11 text-[15px] text-slate-500">
                    <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                    {L("Finding your filings…", "Buscando tus trámites…", lang)}
                  </p>
                ) : msg.error ? (
                  <p className="pl-11 text-[15px] font-medium text-rose-700">{msg.error}</p>
                ) : cards.length === 0 ? (
                  <p className="pl-11 text-[15px] leading-snug text-slate-500">
                    {L(
                      "There's nothing I can file for this business yet.",
                      "Todavía no hay nada que pueda tramitar para este negocio.",
                      lang
                    )}
                  </p>
                ) : (
                  <>
                    <div className="space-y-2">{openable.map(card)}</div>
                    {other.length > 0 && (
                      <div data-testid="filings-unavailable">
                        <p className="mb-2 mt-1 pl-1 text-[12px] font-bold uppercase tracking-wider text-slate-400">
                          {L("Not available for browser filing yet", "Aún no disponibles para radicar en el navegador", lang)}
                        </p>
                        <div className="space-y-2">{other.map(card)}</div>
                      </div>
                    )}
                  </>
                )}
                {!props.run && !msg.loading && (
                  <div className="rounded-2xl border border-slate-200 bg-white p-3.5" data-testid="assist-panel">
                    <div className="flex items-start gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600" aria-hidden="true">
                        <ClipboardList className="h-4 w-4" />
                      </span>
                      <div>
                        <p className="text-[14px] font-bold text-[#161616]">
                          {L("Need to prepare more documents?", "¿Necesitas preparar más documentos?", lang)}
                        </p>
                        <p className="text-[13px] leading-snug text-slate-600">
                          {L(
                            "I can help identify missing items, explain any requirement, or help prepare supporting materials before you submit.",
                            "Puedo ayudarte a identificar lo que falta, explicar cualquier requisito o preparar documentos de apoyo antes de radicar.",
                            lang
                          )}
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button type="button" onClick={props.onShowMissing} className={QUICK_ACTION}>
                        <ListChecks className="h-4 w-4" />
                        {L("Show missing items", "Ver lo que falta", lang)}
                      </button>
                      <button
                        type="button"
                        onClick={() => setDraft(L("Explain the requirement for ", "Explícame el requisito de ", lang))}
                        className={QUICK_ACTION}
                      >
                        <FileText className="h-4 w-4" />
                        {L("Explain a requirement", "Explicar un requisito", lang)}
                      </button>
                      <a href={props.prepareHref} className={QUICK_ACTION}>
                        <Sparkles className="h-4 w-4" />
                        {L("Prepare documents", "Preparar documentos", lang)}
                      </a>
                    </div>
                  </div>
                )}
              </div>
            );
          }
          if (msg.type === "user") {
            return (
              <div key={msg.id} className="flex justify-end">
                <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-tr-md bg-blue-600 px-4 py-2.5 text-[15px] leading-snug text-white">
                  {msg.text}
                </p>
              </div>
            );
          }
          if (msg.type === "goal-brief") {
            const b = msg.brief;
            const known = b.known_fields?.length ?? 0;
            const expected = b.user_input_expected ?? [];
            return (
              <AssistantBubble key={msg.id}>
                <p className="font-[family-name:var(--font-display)] text-lg font-medium text-[#23211c]">
                  {L(
                    `I'm starting your ${msg.filingLabelEn}.`,
                    `Estoy empezando tu ${msg.filingLabelEs}.`,
                    lang
                  )}
                </p>
                <p className="mt-1.5 text-[15px] leading-snug text-slate-600">
                  {L(b.goal_en, b.goal_es, lang)}
                </p>
                <p className="mt-1.5 text-[15px] leading-snug text-slate-600">
                  {L(
                    `I already have ${known} pieces of information from your Business Passport.`,
                    `Ya tengo ${known} piezas de información de tu Pasaporte de Negocio.`,
                    lang
                  )}
                </p>
                {expected.length > 0 && (
                  <p className="mt-1.5 text-[15px] text-slate-500">
                    <span className="font-semibold">{L("I'll ask you for: ", "Te voy a pedir: ", lang)}</span>
                    {expected.map((f) => L(f.label_en, f.label_es, lang)).join(", ")}
                  </p>
                )}
                {b.expected_outcome_en && (
                  <p className="mt-1.5 text-[15px] text-slate-500">
                    <span className="font-semibold">{L("Expected outcome: ", "Resultado esperado: ", lang)}</span>
                    {L(b.expected_outcome_en, b.expected_outcome_es, lang)}
                  </p>
                )}
              </AssistantBubble>
            );
          }
          if (msg.type === "preflight") {
            return (
              <AssistantBubble key={msg.id} id={`agency-msg-${msg.id}`}>
                <PreflightCard
                  preflight={msg.preflight}
                  action={msg.action}
                  filingLabelEn={msg.filingLabelEn}
                  filingLabelEs={msg.filingLabelEs}
                  lang={lang}
                  onConfirm={(answers) => props.onConfirmPreflight(msg, answers)}
                />
              </AssistantBubble>
            );
          }
          return (
            <AssistantBubble
              key={msg.id}
              tone={msg.tone === "warn" ? "warn" : msg.tone === "success" ? "success" : "neutral"}
            >
              <div className="flex items-start gap-2">
                {msg.tone === "warn" ? (
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                ) : msg.tone === "success" ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                ) : (
                  <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#1e4d38] font-[family-name:var(--font-display)] text-xs leading-none text-white">
                    M
                  </span>
                )}
                <p className="whitespace-pre-line text-[15px] leading-snug text-slate-700">
                  {L(msg.textEn, msg.textEs, lang)}
                </p>
              </div>
            </AssistantBubble>
          );
        })}

        {props.milestones.map((m) => (
          <MilestoneBubble key={m.id} milestone={m} lang={lang} />
        ))}

        {props.intervention && <InterventionCard {...props.intervention} />}

        {props.review && <ReviewCard lang={lang} {...props.review} />}
        {props.submitted && <SubmittedCard lang={lang} {...props.submitted} />}

        {props.terminalNote && (
          <AssistantBubble tone={props.terminalNote.tone === "warn" ? "warn" : "neutral"}>
            <div className="flex items-start gap-2">
              {props.terminalNote.tone === "warn" ? (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              ) : (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              )}
              <p className="text-[15px] leading-snug text-slate-700">
                {L(props.terminalNote.textEn, props.terminalNote.textEs, lang)}
              </p>
            </div>
          </AssistantBubble>
        )}

        {props.transientHistory.length > 0 && (
          <TransientHistory labels={props.transientHistory} />
        )}
        </div>
      </div>

      {!props.runActive && (
        <form
          className="border-t border-slate-100 px-4 pt-3"
          data-testid="chat-composer"
          onSubmit={(e) => {
            e.preventDefault();
            const text = draft.trim();
            if (!text || props.askBusy) return;
            if (looksLikeSecret(text)) {
              setComposerNote(
                L(
                  "Don't share passwords, verification codes or full ID numbers here. Enter those only in the agency portal.",
                  "No compartas contraseñas, códigos de verificación ni números de identificación completos aquí. Escríbelos solo en el portal de la agencia.",
                  lang
                )
              );
              return;
            }
            setComposerNote(null);
            setDraftState("");
            stickRef.current = true;
            props.onAsk(text);
          }}
        >
          <div className="flex items-end gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 focus-within:border-blue-400">
            <textarea
              ref={composerRef}
              value={draft}
              rows={1}
              onChange={(e) => {
                setDraftState(e.target.value);
                if (composerNote) setComposerNote(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder={L("Ask a question or tell me what you'd like to do…", "Haz una pregunta o dime qué quieres hacer…", lang)}
              aria-label={L("Message SmartPR", "Mensaje a SmartPR", lang)}
              autoComplete="off"
              data-1p-ignore="true"
              data-lpignore="true"
              data-bwignore="true"
              data-form-type="other"
              className="max-h-32 min-h-[1.75rem] flex-1 resize-none bg-transparent py-1 text-[15px] leading-snug text-slate-800 outline-none placeholder:text-slate-400"
            />
            <button
              type="submit"
              disabled={!draft.trim() || props.askBusy}
              aria-label={L("Send", "Enviar", lang)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400"
            >
              {props.askBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
            </button>
          </div>
          {composerNote && (
            <p className="mt-1.5 text-[13px] font-medium text-amber-800" role="alert">
              {composerNote}
            </p>
          )}
        </form>
      )}

      <div className="flex items-center gap-2 border-t border-slate-100 px-4 py-3 empty:hidden">
        {props.stoppedOrFailed ? (
          <button
            type="button"
            disabled={props.busy}
            onClick={props.onNewRun}
            className="inline-flex items-center gap-1.5 rounded-full bg-[#1e4d38] px-5 py-2 text-[15px] font-bold text-white hover:bg-[#16382a] disabled:opacity-50"
          >
            {props.runFailed
              ? L("Try again", "Intentar de nuevo", lang)
              : L("New run", "Nueva ejecución", lang)}
          </button>
        ) : (
          props.run && (
            <button
              type="button"
              disabled={props.busy}
              onClick={props.onStop}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-4 py-2 text-[15px] font-semibold text-slate-700 disabled:opacity-50"
            >
              <Square className="h-3.5 w-3.5" />
              {L("Stop", "Detener", lang)}
            </button>
          )
        )}
      </div>
    </div>
  );
}

