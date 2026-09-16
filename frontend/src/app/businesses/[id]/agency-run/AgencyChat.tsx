"use client";

/**
 * AgencyChat — chat-primary thread for the agency assistant.
 *
 * The chat is the primary surface for the whole run: agency picker, action
 * cards, goal brief, milestone messages, one in-place transient status,
 * intervention cards (secure inputs, values never rendered), and review card.
 * The live browser is secondary (AgencyBrowser) and never required.
 */
import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle, Bot, Building2, CheckCircle2, ChevronDown, Eye, EyeOff,
  Hand, KeyRound, Landmark, Loader2, Play, Square, Stamp, Upload,
} from "lucide-react";
import type { Lang } from "../../../forms/engine/types";
import type {
  AgencyFilingType,
  AgencyPauseReason,
  AgencyPendingField,
  AgencyRunPublic,
} from "../../../../lib/agency-runs/types";
import { AGENCY_FILING_CONFIGS } from "../../../../lib/agency-runs/filingTypes";
import { prefillFromPassport } from "../../../../lib/agency-runs/prefillFromPassport";
import {
  actionStatusChipLabel,
  gateCopy,
  interventionHeading,
  type AgencyAction,
  type ChatMilestone,
  type GoalBrief,
} from "./chatContracts";

const L = (en: string, es: string, lang: Lang) => (lang === "es" ? es : en);

/* ------------------------------------------------------------------ */
/* Session messages — ephemeral chat content around the run lifecycle   */
/* ------------------------------------------------------------------ */

export interface AgencyPickerMsg {
  id: string;
  type: "agency-picker";
}
export interface ActionListMsg {
  id: string;
  type: "action-list";
  agencyId: string;
  agencyNameEn: string;
  agencyNameEs: string;
  introEn: string;
  introEs: string;
  actions: AgencyAction[];
}
export interface GoalBriefMsg {
  id: string;
  type: "goal-brief";
  brief: GoalBrief;
  filingLabelEn: string;
  filingLabelEs: string;
}
export interface LegacyPickerMsg {
  id: string;
  type: "legacy-picker";
}
export interface TextMsg {
  id: string;
  type: "text";
  textEn: string;
  textEs: string;
  tone: "info" | "warn" | "success";
}
export type SessionMsg =
  | AgencyPickerMsg
  | ActionListMsg
  | GoalBriefMsg
  | LegacyPickerMsg
  | TextMsg;

export interface AgencyOption {
  id: string;
  nameEn: string;
  nameEs: string;
}

/* ------------------------------------------------------------------ */
/* Small pieces                                                         */
/* ------------------------------------------------------------------ */

function AssistantBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand">
        <Bot className="h-4 w-4 text-white" />
      </span>
      <div className="min-w-0 flex-1 rounded-2xl rounded-tl-md border border-slate-200 bg-white px-4 py-3 shadow-sm shadow-slate-950/[0.03]">
        {children}
      </div>
    </div>
  );
}

function MilestoneIcon({ tone }: { tone: ChatMilestone["tone"] }) {
  if (tone === "success") return <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />;
  if (tone === "action") return <Hand className="h-4 w-4 shrink-0 text-amber-600" />;
  if (tone === "warn") return <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />;
  return <CheckCircle2 className="h-4 w-4 shrink-0 text-brand" />;
}

function MilestoneBubble({ milestone, lang }: { milestone: ChatMilestone; lang: Lang }) {
  const [open, setOpen] = useState(false);
  const hasDetails = (milestone.details?.length ?? 0) > 0;
  return (
    <AssistantBubble>
      <div className="flex items-start gap-2">
        <MilestoneIcon tone={milestone.tone} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[#161616]">
            {L(milestone.heading_en, milestone.heading_es, lang)}
          </p>
          {milestone.body_en && milestone.tone !== "info" ? (
            <p className="mt-1 text-sm leading-snug text-slate-600">
              {L(milestone.body_en, milestone.body_es ?? milestone.body_en, lang)}
            </p>
          ) : null}
          {hasDetails && (
            <div className="mt-2">
              <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className="inline-flex items-center gap-1 text-xs font-semibold text-brand"
                aria-expanded={open}
              >
                {L("View details", "Ver detalles", lang)}
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
              </button>
              {open && (
                <ul className="mt-2 space-y-1.5 rounded-xl bg-slate-50 p-3">
                  {milestone.details!.map((d, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-slate-700">
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

/** The SINGLE transient status indicator — one node that updates in place. */
function TransientStatus({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2.5 pl-11">
      <span className="relative flex h-2.5 w-2.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-60" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-brand" />
      </span>
      <p className="text-sm text-slate-500">{label}</p>
    </div>
  );
}

function agencyIcon(id: string) {
  if (id === "HACIENDA_SURI") return <Landmark className="h-5 w-5 text-brand" />;
  if (id === "DEPT_STATE") return <Building2 className="h-5 w-5 text-brand" />;
  return <Stamp className="h-5 w-5 text-brand" />;
}

const ACTION_CHIP_STYLES: Record<AgencyAction["status"], string> = {
  ready: "border-emerald-200 bg-emerald-50 text-emerald-800",
  blocked: "border-amber-200 bg-amber-50 text-amber-900",
  not_required: "border-slate-200 bg-slate-100 text-slate-500",
  completed: "border-sky-200 bg-sky-50 text-sky-800",
};

function ActionCard({
  action,
  lang,
  onStart,
  busy,
  disabled,
}: {
  action: AgencyAction;
  lang: Lang;
  onStart: () => void;
  busy: boolean;
  disabled: boolean;
}) {
  const missing = action.missing_items ?? [];
  return (
    <div className="rounded-xl border border-slate-200 bg-[#fbf8f2] p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-bold text-[#161616]">
          {L(action.title_en, action.title_es, lang)}
        </p>
        <span
          className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${ACTION_CHIP_STYLES[action.status]}`}
        >
          {actionStatusChipLabel(action, lang)}
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        {L(
          `${action.known} of ${action.total} ready from your Passport`,
          `${action.known} de ${action.total} listas en tu Pasaporte`,
          lang
        )}
      </p>
      {action.objective_en && (
        <p className="mt-1 text-xs text-slate-600">
          {L(action.objective_en, action.objective_es ?? action.objective_en, lang)}
        </p>
      )}
      {missing.length > 0 && action.status === "blocked" && (
        <p className="mt-1.5 text-xs text-slate-600">
          <span className="font-semibold">{L("Still needed:", "Falta:", lang)} </span>
          {missing
            .slice(0, 3)
            .map((m) => L(m.label_en, m.label_es, lang))
            .join(", ")}
          {missing.length > 3 ? ` +${missing.length - 3}` : ""}
        </p>
      )}
      {action.blocked_by.length > 0 && (
        <p className="mt-1 text-xs text-slate-500">
          {L("Waiting on: ", "Esperando: ", lang)}
          {action.blocked_by.join(", ")}
        </p>
      )}
      {action.status === "ready" && (
        <button
          type="button"
          disabled={busy || disabled}
          onClick={onStart}
          className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          {busy ? L("Starting…", "Iniciando…", lang) : L("Start", "Empezar", lang)}
        </button>
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
  fieldValues: Record<string, string>;
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

  const pauseReason: AgencyPauseReason = run.pause_reason;
  /** Text-field pause: the assistant card is the only place to type. */
  const fieldsPause =
    pendingFields.length > 0 || pauseReason === "USER_LOGIN";
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
    <AssistantBubble>
      <div className="flex items-start gap-2">
        <Hand className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-[#161616]">
            {interventionHeading(pauseReason, lang)}
          </p>

          {props.validationError && (
            <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-800">
              {props.validationError}
            </div>
          )}

          {run.pause_streak >= 3 && (
            <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-800">
              {L(
                `Still stuck on this step after ${run.pause_streak} tries. If fields are listed, fill them and continue — otherwise take over only for captcha or odd UI, then press “I'm done”.`,
                `Sigo atascado en este paso después de ${run.pause_streak} intentos. Si hay campos, llénalos y continúa — si no, toma el control solo para captcha o pantallas raras, luego pulsa “Terminé”.`,
                lang
              )}
            </div>
          )}

          {gateBody && (
            <p className="mt-1.5 text-sm leading-snug text-slate-600">{gateBody}</p>
          )}

          {isUpload && (
            <p className="mt-1.5 text-sm leading-snug text-slate-600">
              {L(
                `${props.uploadsText}. Max 5 MB per file — upload into the Evidence Locker, then Resume.`,
                `${props.uploadsText}. Máx. 5 MB por archivo — súbelo al Casillero de evidencia y luego Reanudar.`,
                lang
              )}
            </p>
          )}

          {fieldsPause && (
            <div className="mt-2.5 space-y-2">
              <p className="text-[11px] leading-snug text-amber-900/80">
                {L(
                  "Type only here — the live browser is view-only while I wait. Non-sensitive values are prefilled from your passport when possible. Your entries are never stored.",
                  "Escribe solo aquí — el navegador en vivo es solo lectura mientras espero. Los valores no sensibles se rellenan desde tu pasaporte cuando es posible. Tus entradas nunca se almacenan.",
                  lang
                )}
              </p>
              {pendingFields.map((field, index) => {
                const isSensitive = field.sensitive || field.type === "password";
                const revealed = Boolean(props.revealedFields[field.id]);
                const emptyRequired =
                  !field.optional && !(props.fieldValues[field.id] || "").trim();
                const isFirstEmpty =
                  emptyRequired &&
                  pendingFields.findIndex(
                    (f) => !f.optional && !(props.fieldValues[f.id] || "").trim()
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
                    <span className="sr-only">
                      {field.label}
                      {field.optional ? L(" (optional)", " (opcional)", lang) : ""}
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
                        value={props.fieldValues[field.id] || ""}
                        onChange={(e) => props.onFieldChange(field.id, e.target.value)}
                        placeholder={
                          field.optional
                            ? `${field.label}${L(" (optional)", " (opcional)", lang)}`
                            : field.label
                        }
                        className={`w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand ${
                          isSensitive ? "pr-9" : ""
                        }`}
                      />
                      {isSensitive && (
                        <button
                          type="button"
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
                    {field.hint ? (
                      <p className="mt-1 text-[10px] leading-snug text-amber-900/70">
                        {field.hint}
                      </p>
                    ) : null}
                  </label>
                );
              })}
              <button
                type="button"
                disabled={props.busy || !props.canFillFields}
                onClick={props.onFillContinue}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
              >
                <Play className="h-3.5 w-3.5" />
                {L("Fill & continue", "Llenar y continuar", lang)}
              </button>
            </div>
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
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-800 disabled:opacity-50"
              >
                <Upload className="h-3.5 w-3.5" />
                {props.uploadBusy
                  ? L("Uploading…", "Subiendo…", lang)
                  : L("Upload to Evidence Locker", "Subir al Casillero de evidencia", lang)}
              </button>
              {props.uploadMsg && <p className="text-xs text-slate-600">{props.uploadMsg}</p>}
            </div>
          )}

          {(isGate || isUpload) && props.hasLiveUrl && !props.takeover && (
            <button
              type="button"
              onClick={props.onTakeover}
              className="mt-2.5 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white"
            >
              <KeyRound className="h-3.5 w-3.5" />
              {L("Take over the browser", "Tomar el control del navegador", lang)}
            </button>
          )}

          {fieldsPause && props.hasLiveUrl && !props.takeover && (
            <button
              type="button"
              onClick={props.onTakeover}
              className="mt-2 w-full text-center text-[11px] font-medium text-slate-500 underline-offset-2 hover:text-brand hover:underline"
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
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
              >
                <Play className="h-3.5 w-3.5" />
                {L("Resume", "Reanudar", lang)}
              </button>
            )}
            <button
              type="button"
              disabled={props.busy}
              onClick={props.onStop}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50"
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
    <AssistantBubble>
      <div className="flex items-start gap-2">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-[#161616]">
            {L(
              "Your application is prepared and ready for final review.",
              "Tu solicitud está preparada y lista para revisión final.",
              lang
            )}
          </p>
          <p className="mt-1.5 text-sm leading-snug text-slate-600">
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
          <p className="mt-1.5 text-xs font-medium text-slate-500">{gateCopy(lang)}</p>
          <button
            type="button"
            disabled={busy}
            onClick={onReviewInBrowser}
            className="mt-2.5 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
          >
            <Eye className="h-3.5 w-3.5" />
            {L("Review in browser", "Revisar en el navegador", lang)}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50"
          >
            <Square className="h-3.5 w-3.5" />
            {L("Close run", "Cerrar ejecución", lang)}
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
  msgs: SessionMsg[];
  milestones: ChatMilestone[];
  run: AgencyRunPublic | null;
  runActive: boolean;
  transientLabel: string | null;
  scrollKey: string;
  agencies: AgencyOption[];
  actionsLoading: boolean;
  actionsLoadingAgency: string | null;
  onSelectAgency: (agencyId: string) => void;
  onStartAction: (action: AgencyAction) => void;
  actionBusyId: string | null;
  filingType: AgencyFilingType;
  onFilingTypeChange: (t: AgencyFilingType) => void;
  onLegacyStart: () => void;
  legacyBusy: boolean;
  intervention: InterventionProps | null;
  review: {
    knownCount: number | null;
    onReviewInBrowser: () => void;
    onClose: () => void;
    busy: boolean;
  } | null;
  terminalNote: { textEn: string; textEs: string; tone: "info" | "warn" } | null;
  onStop: () => void;
  busy: boolean;
  stoppedOrFailed: boolean;
  onNewRun: () => void;
  runFailed: boolean;
}

export function AgencyChat(props: AgencyChatProps) {
  const { lang } = props;
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [props.scrollKey]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 md:px-5">
        {props.msgs.map((msg) => {
          if (msg.type === "agency-picker") {
            return (
              <AssistantBubble key={msg.id}>
                <p className="text-sm leading-snug text-slate-700">
                  {L(
                    "Which agency should I work with? I'll check what's outstanding for this business.",
                    "¿Con qué agencia bregamos? Voy a chequear qué está pendiente para este negocio.",
                    lang
                  )}
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  {props.agencies.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      disabled={props.runActive}
                      onClick={() => props.onSelectAgency(a.id)}
                      className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-[#fbf8f2] px-3 py-3 text-left transition hover:border-brand/50 hover:bg-brand/[0.04] disabled:opacity-50 disabled:hover:border-slate-200 disabled:hover:bg-[#fbf8f2]"
                    >
                      {agencyIcon(a.id)}
                      <span className="text-sm font-bold text-[#161616]">
                        {L(a.nameEn, a.nameEs, lang)}
                      </span>
                      {props.actionsLoading && props.actionsLoadingAgency === a.id && (
                        <Loader2 className="ml-auto h-4 w-4 animate-spin text-brand" />
                      )}
                    </button>
                  ))}
                </div>
              </AssistantBubble>
            );
          }
          if (msg.type === "action-list") {
            return (
              <AssistantBubble key={msg.id}>
                <p className="text-sm leading-snug text-slate-700">
                  {L(msg.introEn, msg.introEs, lang)}
                </p>
                <div className="mt-3 space-y-2">
                  {msg.actions.map((action) => (
                    <ActionCard
                      key={action.id}
                      action={action}
                      lang={lang}
                      busy={props.actionBusyId === action.id}
                      disabled={props.runActive || props.actionBusyId !== null}
                      onStart={() => props.onStartAction(action)}
                    />
                  ))}
                </div>
              </AssistantBubble>
            );
          }
          if (msg.type === "goal-brief") {
            const b = msg.brief;
            const known = b.known_fields?.length ?? 0;
            const expected = b.user_input_expected ?? [];
            return (
              <AssistantBubble key={msg.id}>
                <p className="text-sm font-bold text-[#161616]">
                  {L(
                    `I'm starting your ${msg.filingLabelEn}.`,
                    `Estoy empezando tu ${msg.filingLabelEs}.`,
                    lang
                  )}
                </p>
                <p className="mt-1.5 text-sm leading-snug text-slate-600">
                  {L(b.goal_en, b.goal_es, lang)}
                </p>
                <p className="mt-1.5 text-sm leading-snug text-slate-600">
                  {L(
                    `I already have ${known} pieces of information from your Business Passport.`,
                    `Ya tengo ${known} piezas de información de tu Pasaporte de Negocio.`,
                    lang
                  )}
                </p>
                {expected.length > 0 && (
                  <p className="mt-1.5 text-xs text-slate-500">
                    <span className="font-semibold">{L("I'll ask you for: ", "Te voy a pedir: ", lang)}</span>
                    {expected.map((f) => L(f.label_en, f.label_es, lang)).join(", ")}
                  </p>
                )}
                {b.expected_outcome_en && (
                  <p className="mt-1.5 text-xs text-slate-500">
                    <span className="font-semibold">{L("Expected outcome: ", "Resultado esperado: ", lang)}</span>
                    {L(b.expected_outcome_en, b.expected_outcome_es, lang)}
                  </p>
                )}
              </AssistantBubble>
            );
          }
          if (msg.type === "legacy-picker") {
            return (
              <AssistantBubble key={msg.id}>
                <p className="text-sm leading-snug text-slate-700">
                  {L(
                    "The agency catalog isn't available right now — pick the filing directly:",
                    "El catálogo de agencias no está disponible ahora — elige el trámite directamente:",
                    lang
                  )}
                </p>
                <label className="mt-3 block">
                  <span className="mb-1 block text-xs font-bold text-slate-600">
                    {L("Filing type", "Tipo de trámite", lang)}
                  </span>
                  <select
                    value={props.filingType}
                    onChange={(e) => props.onFilingTypeChange(e.target.value as AgencyFilingType)}
                    disabled={props.runActive}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-[#161616] disabled:opacity-50"
                  >
                    {AGENCY_FILING_CONFIGS.filter((c) => c.enabled).map((c) => (
                      <option key={c.id} value={c.id} disabled={c.requiresExistingAccount}>
                        {L(c.labelEn, c.labelEs, lang)}
                        {c.requiresExistingAccount
                          ? L(" — requires an existing portal account", " — requiere una cuenta existente en el portal", lang)
                          : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  disabled={props.legacyBusy || props.runActive}
                  onClick={props.onLegacyStart}
                  className="mt-3 inline-flex items-center gap-2 rounded-lg bg-brand px-5 py-2.5 text-sm font-medium text-[#f6f3ea] disabled:opacity-50"
                >
                  {props.legacyBusy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                  {props.legacyBusy
                    ? L("Starting…", "Iniciando…", lang)
                    : L("Start agency run", "Iniciar ejecución con agencia", lang)}
                </button>
              </AssistantBubble>
            );
          }
          return (
            <AssistantBubble key={msg.id}>
              <div className="flex items-start gap-2">
                {msg.tone === "warn" ? (
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                ) : msg.tone === "success" ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                ) : (
                  <Bot className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
                )}
                <p className="text-sm leading-snug text-slate-700">
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

        {props.terminalNote && (
          <AssistantBubble>
            <div className="flex items-start gap-2">
              {props.terminalNote.tone === "warn" ? (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              ) : (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              )}
              <p className="text-sm leading-snug text-slate-700">
                {L(props.terminalNote.textEn, props.terminalNote.textEs, lang)}
              </p>
            </div>
          </AssistantBubble>
        )}

        {props.transientLabel && <TransientStatus label={props.transientLabel} />}

        <div ref={chatEndRef} />
      </div>

      <div className="flex items-center gap-2 border-t border-slate-100 px-4 py-3">
        {props.stoppedOrFailed ? (
          <button
            type="button"
            disabled={props.busy}
            onClick={props.onNewRun}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
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
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50"
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

