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
  AlertTriangle, Building2, CheckCircle2, ChevronDown, ClipboardList, Eye, EyeOff,
  Hand, KeyRound, Landmark, Loader2, Play, Send, Square, Stamp, Upload,
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
import {
  filingGateCopy,
  filingPassportCtaCopy,
  filingPickerIntro,
  filingStatusChipLabel,
  filingUnsupportedCopy,
  gateCopy,
  interventionHeading,
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
export type SessionMsg =
  | FilingPickerMsg
  | GoalBriefMsg
  | PreflightMsg
  | TextMsg;

/* ------------------------------------------------------------------ */
/* Small pieces                                                         */
/* ------------------------------------------------------------------ */

/**
 * Criticality tones for chat bubbles. Background carries the level; text
 * stays near-black on every tone so each notification reads at a glance.
 * - action (hand — Mita needs you): strongest, rose
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

function agencyIcon(id: string) {
  if (id === "HACIENDA_SURI") return <Landmark className="h-5 w-5 text-[#1e4d38]" />;
  if (id === "DEPT_STATE") return <Building2 className="h-5 w-5 text-[#1e4d38]" />;
  return <Stamp className="h-5 w-5 text-[#1e4d38]" />;
}

const FILING_CHIP_STYLES: Record<FilingStatus, string> = {
  ready_to_start: "border-[#1e4d38]/30 bg-[#1e4d38]/[.07] text-[#1e4d38]",
  missing_information: "border-amber-200 bg-amber-50 text-amber-900",
  in_progress: "border-sky-200 bg-sky-50 text-sky-800",
  submitted: "border-slate-200 bg-slate-100 text-slate-600",
  blocked: "border-amber-200 bg-amber-50 text-amber-900",
  unsupported: "border-slate-200 bg-slate-100 text-slate-500",
};

/**
 * One filing option card. SmartPR decided this filing needs to happen;
 * the card only lets the human start it when SmartPR has everything it
 * needs. Unsupported options render disabled — never a launch button.
 * Missing-information options link to the Business Passport where the
 * missing facts get filled in — a card with no action is a dead end.
 */
function FilingCard({
  filing,
  lang,
  onStart,
  busy,
  disabled,
  passportHref,
}: {
  filing: FilingOption;
  lang: Lang;
  onStart: () => void;
  busy: boolean;
  disabled: boolean;
  passportHref: string | null;
}) {
  const action = filing.action;
  // Informational count: passport fields still missing. The human can
  // start anyway — the assistant asks for these during the run.
  const gate = action ? nonSensitiveMissingItems(action).length : 0;
  // Supported + ready or missing-information filings get the Start button.
  // Unsupported, blocked, submitted, and in-progress filings never do.
  const canStart =
    filing.supported &&
    (filing.filing_status === "ready_to_start" ||
      filing.filing_status === "missing_information");
  return (
    <div className="rounded-2xl border border-[#161616]/10 bg-white p-4 shadow-sm shadow-slate-950/[0.03]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-[family-name:var(--font-display)] text-lg font-medium text-[#23211c]">
          {L(filing.title_en, filing.title_es, lang)}
        </p>
        <span
          className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[13px] font-bold ${FILING_CHIP_STYLES[filing.filing_status]}`}
        >
          {filingStatusChipLabel(filing, lang)}
        </span>
      </div>
      {filing.supported && (
        <p className="mt-1 text-[15px] text-slate-500">
          <span className="font-semibold">{L("SmartPR requirement: ", "Requisito de SmartPR: ", lang)}</span>
          {filing.obligation_name}
        </p>
      )}
      {!filing.supported && (
        <p className="mt-1 text-[15px] text-slate-500">{filingUnsupportedCopy(lang)}</p>
      )}
      {action && (
        <p className="mt-1 text-[15px] text-slate-500">
          {L(
            `${action.known} of ${action.total} ready from your Passport`,
            `${action.known} de ${action.total} listas en tu Pasaporte`,
            lang
          )}
        </p>
      )}
      {filing.filing_status === "missing_information" && gate > 0 && (
        <p className="mt-1.5 text-[15px] font-semibold text-amber-800">
          {filingGateCopy(gate, lang)}
        </p>
      )}
      {action && action.blocked_by.length > 0 && (
        <p className="mt-1 text-[15px] text-slate-500">
          {L("Waiting on: ", "Esperando: ", lang)}
          {action.blocked_by.join(", ")}
        </p>
      )}
      {canStart && (
        <button
          type="button"
          disabled={busy || disabled}
          onClick={onStart}
          className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-[#1e4d38] px-5 py-2 text-[15px] font-bold text-white hover:bg-[#16382a] disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          {busy ? L("Starting…", "Iniciando…", lang) : L("Start", "Empezar", lang)}
        </button>
      )}
      {/* Passport completion stays available as a secondary action —
          filling the passport up front means fewer interruptions mid-run. */}
      {filing.filing_status === "missing_information" && gate > 0 && passportHref && (
        <a
          href={passportHref}
          className="ml-2 mt-3 inline-flex items-center gap-1.5 rounded-full border border-[#1e4d38]/40 bg-[#1e4d38]/[.06] px-4 py-2 text-[15px] font-semibold text-[#1e4d38] hover:bg-[#1e4d38]/[.12]"
        >
          <ClipboardList className="h-3.5 w-3.5" />
          {filingPassportCtaCopy(lang)}
        </a>
      )}
    </div>
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
  /** Fields the human already supplied once that the agent is asking for
   * again — these get a confirm banner instead of blank inputs. */
  // Banner renders ONLY for fields with an actually-retained prior value
  // (computed by the parent) — never on a bare supplied id.
  const askedAgain = props.askedAgainFields ?? [];
  /** Text-field pause: the assistant card is the only place to type. */
  const fieldsPause =
    pendingFields.length > 0 || pauseReason === "USER_LOGIN";
  const portalValidationMessages = useMemo(
    () => collectPortalValidationMessages(pendingFields),
    [pendingFields]
  );
  const showValidationBanner =
    portalValidationMessages.length > 0 ||
    pendingFields.some((f) => fieldHasValidationIssue(f));
  const isUpload = pauseReason === "USER_UPLOAD";
  const isGate = pauseReason === "CAPTCHA" || pauseReason === "PAYMENT";

  // Seed non-sensitive values from the passport snapshot whenever a new
  // fields pause appears. Seeded values merge into fieldValues (local state
  // only — never into chat text or events).
  useEffect(() => {
    if (pendingFields.length === 0) return;
    const seedKey = `${run.id}:${pauseReason || ""}:${pendingFields.map((f) => f.id).join(",")}`;
    if (seedKeyRef.current === seedKey) return;
    seedKeyRef.current = seedKey;
    const seeded = prefillFromPassport(pendingFields, run.passport_snapshot);
    for (const [id, value] of Object.entries(seeded)) {
      if (value) props.onFieldChange(id, value);
    }
  }, [run.id, pauseReason, pendingFields, run.passport_snapshot]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-focus the first empty required field when a fields pause appears.
  useEffect(() => {
    if (!fieldsPause || props.takeover) return;
    const handle = window.setTimeout(() => {
      firstEmptyFieldRef.current?.focus();
    }, 50);
    return () => window.clearTimeout(handle);
  }, [fieldsPause, props.takeover, pendingFields, run.id]);

  const gateBody = isGate
    ? pauseReason === "CAPTCHA"
      ? L(
          "This one needs a human touch. Take over the browser, complete the captcha or challenge directly on the portal page, then press “I'm done” to hand it back to me.",
          "Esto necesita un toque humano. Toma el control del navegador, completa el captcha o el desafío directamente en la página del portal, luego pulsa “Terminé” para devolvérmelo.",
          lang
        )
      : L(
          "Payment is always yours to make — I never touch it. Take over the browser and pay directly on the portal page, then press “I'm done” to hand it back to me.",
          "El pago siempre lo haces tú — yo nunca lo toco. Toma el control del navegador y paga directamente en la página del portal, luego pulsa “Terminé” para devolvérmelo.",
          lang
        )
    : null;

  return (
    <AssistantBubble id="agency-intervention" tone="action">
      <div className="flex items-start gap-2">
        <Hand className="mt-0.5 h-4 w-4 shrink-0 text-rose-700" />
        <div className="min-w-0 flex-1">
          {pendingFields.length > 0 && (
            <p className="text-[13px] font-bold uppercase tracking-[0.18em] text-rose-800">
              {L("Item needed", "Falta un dato", lang)}
            </p>
          )}
          <p className="text-[15px] font-bold text-[#161616]">
            {interventionHeading(pauseReason, lang)}
          </p>

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

          {gateBody && (
            <p className="mt-1.5 text-[15px] leading-snug text-slate-600">{gateBody}</p>
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
                const inputType = isSensitive
                  ? revealed
                    ? "text"
                    : "password"
                  : field.type === "email"
                    ? "email"
                    : field.type === "tel"
                      ? "tel"
                      : field.type === "number"
                        ? "number"
                        : "text";
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
                        autoComplete={
                          field.id === "email" || field.id.endsWith("_email")
                            ? "username"
                            : field.id === "password"
                              ? "current-password"
                              : field.id === "mfa"
                                ? "one-time-code"
                                : "off"
                        }
                        inputMode={
                          field.id === "mfa" ||
                          field.type === "tel" ||
                          /ssn|itin|tax_id/i.test(field.id)
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

          {(isGate || isUpload) && props.hasLiveUrl && !props.takeover && (
            <button
              type="button"
              onClick={props.onTakeover}
              className="mt-2.5 inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-[#1e4d38] px-3 py-2 text-[15px] font-bold text-white hover:bg-[#16382a]"
            >
              <KeyRound className="h-3.5 w-3.5" />
              {L("Take over the browser", "Tomar el control del navegador", lang)}
            </button>
          )}

          {fieldsPause && props.hasLiveUrl && !props.takeover && (
            <button
              type="button"
              onClick={props.onTakeover}
              className="mt-2 w-full text-center text-[15px] font-medium text-slate-700 underline-offset-2 hover:text-[#1e4d38] hover:underline"
            >
              {L(
                "Need to solve a captcha or weird UI? Take over instead",
                "¿Necesitas resolver un captcha o una pantalla rara? Toma el control",
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
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full bg-[#1e4d38] px-3 py-2 text-[15px] font-bold text-white hover:bg-[#16382a] disabled:opacity-50"
              >
                <Play className="h-3.5 w-3.5" />
                {L("Resume", "Reanudar", lang)}
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
  onAuthorize,
  authorizeBusy,
  authorizeError,
  busy,
}: {
  lang: Lang;
  knownCount: number | null;
  onReviewInBrowser: () => void;
  onClose: () => void;
  onAuthorize: () => void;
  authorizeBusy: boolean;
  authorizeError: string | null;
  busy: boolean;
}) {
  const [attested, setAttested] = useState(false);
  return (
    <AssistantBubble tone="success">
      <div className="flex items-start gap-2">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-bold text-[#161616]">
            {L(
              "Your application is prepared and ready for final review.",
              "Tu solicitud está preparada y lista para revisión final.",
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
          <p className="mt-1.5 text-[15px] font-medium text-slate-500">{gateCopy(lang)}</p>
          <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5">
            <input
              type="checkbox"
              checked={attested}
              onChange={(e) => setAttested(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-700"
            />
            <span className="text-[13px] leading-snug text-slate-600">
              {L(
                "I authorize SmartPR to submit this filing on my behalf. I confirm the information is true and correct.",
                "Autorizo a SmartPR a enviar este trámite por mí. Confirmo que la información es cierta y correcta.",
                lang
              )}
            </span>
          </label>
          {authorizeError && (
            <p className="mt-2 text-[13px] font-medium text-rose-700">{authorizeError}</p>
          )}
          <button
            type="button"
            disabled={busy || authorizeBusy || !attested}
            onClick={onAuthorize}
            className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-2 text-[15px] font-semibold text-white disabled:opacity-50"
          >
            {authorizeBusy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
            {authorizeBusy
              ? L("Submitting…", "Enviando…", lang)
              : L("File it for me", "Envíalo por mí", lang)}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onReviewInBrowser}
            className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-[15px] font-semibold text-slate-700 disabled:opacity-50"
          >
            <Eye className="h-3.5 w-3.5" />
            {L("Review in browser", "Revisar en el navegador", lang)}
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
              "SmartPR submitted this filing on the portal on your behalf — no need to visit the portal yourself.",
              "SmartPR envió este trámite en el portal por ti — no necesitas visitar el portal tú mismo.",
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
    onAuthorize: () => void;
    authorizeBusy: boolean;
    authorizeError: string | null;
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
}

/**
 * Stable busy key for a filing card. Dept. of State can surface two
 * objective variants for the same obligation — the objective distinguishes
 * them so the spinner lands on the right card.
 */
function filingBusyKey(filing: FilingOption): string {
  return `${filing.id}:${filing.obligation_id}:${filing.action?.objective_en ?? ""}`;
}

export function AgencyChat(props: AgencyChatProps) {
  const { lang } = props;
  const scrollBoxRef = useRef<HTMLDivElement>(null);

  // Chat auto-scroll is always container-local: only the message list moves,
  // never the window or an outer ancestor — so the browser panel and the
  // field cards stay anchored while the human fills them out.
  const scrollChatToBottom = (behavior: ScrollBehavior) => {
    const box = scrollBoxRef.current;
    if (!box) return;
    box.scrollTo({ top: box.scrollHeight, behavior });
  };

  /**
   * Stick-to-bottom: while true, any growth of the thread (new milestone,
   * status line, card) scrolls to the newest activity. Only an explicit
   * scroll-up by the human (wheel / touch / keys) releases it; reaching the
   * bottom again — or pressing any action button in the chat — re-arms it.
   * Programmatic smooth scrolls never release it, which is what broke the
   * old "only when already near the bottom" check after a click.
   */
  const stickRef = useRef(true);
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = scrollBoxRef.current;
    const content = contentRef.current;
    if (!box || !content) return;
    const ro = new ResizeObserver(() => {
      if (stickRef.current) box.scrollTo({ top: box.scrollHeight, behavior: "smooth" });
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
    window.setTimeout(() => scrollChatToBottom("smooth"), 120);
  };

  useEffect(() => {
    if (stickRef.current) scrollChatToBottom("smooth");
  }, [props.scrollKey]);

  // Hand-backs from outside the chat always re-arm stick-to-bottom and jump
  // to the newest activity (the thread may shrink first as the card closes,
  // so scroll again once the new status lands).
  useEffect(() => {
    if (!props.scrollToLatestSignal) return;
    stickRef.current = true;
    scrollChatToBottom("smooth");
    const t = window.setTimeout(() => scrollChatToBottom("smooth"), 400);
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
        scrollChatToBottom("smooth");
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
            return (
              <AssistantBubble key={msg.id}>
                <p className="text-[15px] leading-snug text-slate-700">
                  {filingPickerIntro(lang)}
                </p>
                {msg.loading ? (
                  <p className="mt-3 flex items-center gap-2 text-[15px] text-slate-500">
                    <Loader2 className="h-4 w-4 animate-spin text-[#1e4d38]" />
                    {L("Finding your filings…", "Buscando tus trámites…", lang)}
                  </p>
                ) : msg.error ? (
                  <p className="mt-3 text-[15px] font-medium text-rose-700">{msg.error}</p>
                ) : msg.groups.length === 0 ? (
                  <p className="mt-3 text-[15px] leading-snug text-slate-500">
                    {L(
                      "There's nothing I can file for this business yet.",
                      "Todavía no hay nada que pueda tramitar para este negocio.",
                      lang
                    )}
                  </p>
                ) : (
                  <div className="mt-3 space-y-4">
                    {msg.groups.map((group) => (
                      <div key={group.agency_id}>
                        <div className="flex items-center gap-2">
                          {agencyIcon(group.agency_id)}
                          <p className="text-[15px] font-extrabold uppercase tracking-wider text-slate-500">
                            {L(group.agency_name_en, group.agency_name_es, lang)}
                          </p>
                          {group.demo && (
                            <span className="rounded-md bg-amber-300 px-1.5 py-0.5 text-xs font-extrabold uppercase tracking-wide text-black">
                              Demo
                            </span>
                          )}
                        </div>
                        <div className="mt-2 space-y-2">
                          {group.filings.map((filing) => (
                            <FilingCard
                              key={`${filing.id}:${filing.obligation_id}`}
                              filing={filing}
                              lang={lang}
                              busy={props.filingBusyId === filingBusyKey(filing)}
                              disabled={props.runActive || props.filingBusyId !== null}
                              onStart={() => props.onStartFiling(filing)}
                              passportHref={`/businesses/${props.businessId}#business-passport`}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </AssistantBubble>
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
                <p className="text-[15px] leading-snug text-slate-700">
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

      <div className="flex items-center gap-2 border-t border-slate-100 px-4 py-3">
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

