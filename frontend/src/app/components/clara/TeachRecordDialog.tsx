"use client";

/**
 * Record-first Teach Clara (Darius, 2026-09-30).
 *
 * Clicking "Teach Clara" starts a recording right away: Clara's in-app live
 * browser opens on the portal and the person simply does the filing. Every
 * action (open screen, click, type into a field, pick an option, upload,
 * wait) is captured with its selector, label and a screenshot; typed values
 * are never kept — each is bound to a Business Passport field (or "ask each
 * time"), and sign-in / codes / uploads / payment become pauses for the
 * person. Then a system check (rules + a simulated dry run + an advisory
 * model review) confirms it's a real, repeatable process; only a passing
 * routine is saved as "Learned". After that, the row's "Fill with Clara"
 * replays exactly those steps.
 *
 * Fallbacks (never the typed-steps form as the entry point):
 *  - phone / small screen → "Recording needs a desktop" + upload a screen
 *    recording (Clara reads its frames into draft steps) or copy the link;
 *  - live recorder not connected / signed out → same, with a clear reason.
 * Typed steps live behind "Edit steps" / "Describe the steps instead".
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, Circle, Clock, Copy, Film, GraduationCap, Hand, Keyboard, ListChecks, Loader2, Monitor, MousePointerClick, Pencil, RotateCcw, Square, Trash2, Upload, XCircle } from "lucide-react";
import { ClaraModal } from "./ClaraModal";
import { TeachClaraForm } from "./TeachClaraForm";
import type { GuidedSubject } from "./guidedFormModel";
import { useRequirementActionsEnv } from "./requirementActionsContext";
import { PASSPORT_CATALOG } from "../../../lib/agency-runs/teach/passportCatalog";
import type { LearnedRoutineSummary } from "../../../lib/agency-runs/teach/learnedRoutineMatch";

type Language = "en" | "es";
type Bi = { en: string; es: string };

interface ViewAction {
  seq: number;
  kind: "navigate" | "click" | "type" | "select" | "upload" | "wait";
  label: string;
  valueKind: string | null;
  waitMs: number | null;
  pause: string | null;
  submitLike: boolean;
  screenshot: string | null;
  binding: { kind: "passport"; path: string; name: Bi } | { kind: "ask" } | { kind: "always"; option: string } | { kind: "pending"; suggestion: { path: string; name: Bi } | null } | { kind: "pause"; gate: string } | null;
  stepId: string | null;
}
interface ViewStep {
  id: string;
  title: string;
  observed: boolean;
  gate: string | null;
  fields: { key: string; label: string; decided: boolean; binding: { kind: string; path?: string; name?: Bi; option?: string } }[];
  clicks?: { key: string; label: string; role: string }[];
}
type Question =
  | { id: string; kind: "mapping"; label: string; proposal: { path: string; en: string; es: string } | null; canAlwaysChoose: boolean; optionText: string }
  | { id: string; kind: "always_choose"; label: string; optionText: string }
  | { id: string; kind: "gate"; gate: string; reason: Bi }
  | { id: string; kind: "branch"; title: string };
interface SessionView {
  id: string;
  status: "recording" | "finished" | "saved";
  live_url: string | null;
  start_url: string;
  steps: ViewStep[];
  questions: Question[];
  actions: ViewAction[];
}
interface Check { id: string; ok: boolean; severity: "error" | "warning"; title: Bi; fix: Bi | null }
interface Validation { status: "pass" | "issues"; checks: Check[]; errors: number; warnings: number; llm: { status: string; notes: Bi[] } }

type Phase =
  | "checking"
  | "needs_desktop"
  | "unavailable"
  | "sign_in"
  | "need_url"
  | "starting"
  | "recording"
  | "validating"
  | "result"
  | "edit"
  | "learned"
  | "describe"
  | "reading_video";

const GATE_NAMES: Record<string, Bi> = {
  login: { en: "Sign-in", es: "Entrar" },
  mfa: { en: "Code", es: "Código" },
  captcha: { en: "CAPTCHA", es: "CAPTCHA" },
  certification: { en: "Certification", es: "Certificación" },
  signature: { en: "Signature", es: "Firma" },
  payment: { en: "Payment", es: "Pago" },
  submit: { en: "Final submit", es: "Envío final" },
  upload: { en: "Documents", es: "Documentos" },
  identity: { en: "ID number", es: "Número de identificación" },
};
const EDITABLE_GATES = ["login", "mfa", "upload", "payment", "signature", "certification", "identity"];

async function api<T>(url: string, body?: unknown): Promise<{ ok: boolean; status: number; data: T }> {
  const res = await fetch(url, body === undefined ? { cache: "no-store" } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as T;
  return { ok: res.ok, status: res.status, data };
}

function msg(data: unknown, es: boolean, fallback: string): string {
  const m = (data as { message?: string | Bi } | null)?.message;
  return typeof m === "string" ? m : m ? (es ? m.es : m.en) : fallback;
}

function isSmallScreen(): boolean {
  if (typeof window === "undefined") return false;
  const narrow = window.matchMedia?.("(max-width: 760px)").matches ?? window.innerWidth <= 760;
  const touchOnly = (window.matchMedia?.("(pointer: coarse)").matches ?? false) && window.innerWidth < 1024;
  return narrow || touchOnly;
}

/** A few frames of a screen recording, as small JPEGs (client side). */
async function videoFrames(file: File, count = 8): Promise<string[]> {
  const url = URL.createObjectURL(file);
  try {
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "auto";
    video.src = url;
    await new Promise<void>((ok, fail) => {
      video.onloadedmetadata = () => ok();
      video.onerror = () => fail(new Error("video"));
    });
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 960 / (video.videoWidth || 960));
    canvas.width = Math.round((video.videoWidth || 960) * scale);
    canvas.height = Math.round((video.videoHeight || 540) * scale);
    const ctx = canvas.getContext("2d");
    const out: string[] = [];
    for (let i = 0; i < count && ctx; i++) {
      video.currentTime = duration ? (duration * (i + 0.5)) / count : 0;
      await new Promise<void>((ok) => {
        video.onseeked = () => ok();
        setTimeout(ok, 1500);
      });
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      out.push(canvas.toDataURL("image/jpeg", 0.6));
    }
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function ActionIcon({ a }: { a: ViewAction }) {
  if (a.submitLike) return <XCircle size={15} aria-hidden="true" />;
  if (a.binding?.kind === "pause") return <Hand size={15} aria-hidden="true" />;
  switch (a.kind) {
    case "navigate": return <ArrowRight size={15} aria-hidden="true" />;
    case "click": return <MousePointerClick size={15} aria-hidden="true" />;
    case "type": return <Keyboard size={15} aria-hidden="true" />;
    case "select": return <ListChecks size={15} aria-hidden="true" />;
    case "upload": return <Upload size={15} aria-hidden="true" />;
    case "wait": return <Clock size={15} aria-hidden="true" />;
  }
}

function describe(a: ViewAction, es: boolean): string {
  const q = `“${a.label}”`;
  switch (a.kind) {
    case "navigate": return es ? `Abrió ${q}` : `Opened ${q}`;
    case "click": return a.submitLike ? (es ? `Tocó ${q} — envío final, Clara nunca lo hace` : `Clicked ${q} — final submit, Clara never does this`) : es ? `Tocó ${q}` : `Clicked ${q}`;
    case "type": return a.valueKind === "secret" ? (es ? `Escribió en ${q} (oculto)` : `Typed into ${q} (hidden)`) : es ? `Escribió en ${q}` : `Typed into ${q}`;
    case "select": return es ? `Escogió una opción en ${q}` : `Picked an option in ${q}`;
    case "upload": return es ? `Subió un archivo en ${q}` : `Uploaded a file in ${q}`;
    case "wait": return es ? `Esperó ${Math.round((a.waitMs ?? 0) / 1000)} s` : `Waited ${Math.round((a.waitMs ?? 0) / 1000)} s`;
  }
}

function BindingChip({ a, es }: { a: ViewAction; es: boolean }) {
  const b = a.binding;
  if (a.submitLike) return <span className="tr-chip tr-chip-stop">{es ? "No se repite" : "Never replayed"}</span>;
  if (!b) return null;
  if (b.kind === "pause") return <span className="tr-chip tr-chip-pause">{es ? `Pausa: ${GATE_NAMES[b.gate]?.es ?? b.gate}` : `Your part: ${GATE_NAMES[b.gate]?.en ?? b.gate}`}</span>;
  if (b.kind === "passport") return <span className="tr-chip tr-chip-bound">{es ? b.name.es : b.name.en}</span>;
  if (b.kind === "ask") return <span className="tr-chip">{es ? "Preguntar cada vez" : "Ask each time"}</span>;
  if (b.kind === "always") return <span className="tr-chip">{es ? `Siempre “${b.option}”` : `Always “${b.option}”`}</span>;
  return <span className="tr-chip tr-chip-todo">{es ? "¿Qué dato es?" : "Which detail?"}</span>;
}

export function TeachRecordDialog({
  subject,
  language,
  onClose,
  onLearned,
  businessId: businessOverride,
}: {
  subject: GuidedSubject;
  language: Language;
  onClose: () => void;
  onLearned?: (r: LearnedRoutineSummary) => void;
  businessId?: string | null;
}) {
  const es = language === "es";
  const T = (en: string, sp: string) => (es ? sp : en);
  const env = useRequirementActionsEnv();
  const businessId = businessOverride ?? env.businessId;
  // Phones / small screens get the desktop fallback straight away.
  const [phase, setPhase] = useState<Phase>(() => (isSmallScreen() ? "needs_desktop" : "checking"));
  const [portalUrl, setPortalUrl] = useState(subject.portalUrl ?? "");
  const [session, setSession] = useState<SessionView | null>(null);
  const [validation, setValidation] = useState<Validation | null>(null);
  const [routine, setRoutine] = useState<LearnedRoutineSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draftSteps, setDraftSteps] = useState<string[] | null>(null);
  const [copied, setCopied] = useState(false);
  const [showPassed, setShowPassed] = useState(false);
  const started = useRef(false);

  const start = useCallback(async (url: string) => {
    setError(null);
    setPhase("starting");
    const res = await api<{ session?: SessionView; error?: string }>("/api/teach-sessions", {
      start_url: url,
      form: subject.name,
      portal_name: subject.agency ?? "",
      business_id: businessId,
      requirement_key: subject.key,
    });
    if (res.ok && res.data.session) {
      setSession(res.data.session);
      setPhase("recording");
      return;
    }
    if (res.status === 401) return setPhase("sign_in");
    if (res.status === 503) return setPhase("unavailable");
    setError(msg(res.data, es, T("Clara couldn't open that portal.", "Clara no pudo abrir ese portal.")));
    setPhase("need_url");
  }, [businessId, es, subject.agency, subject.key, subject.name]); // eslint-disable-line react-hooks/exhaustive-deps

  // Decide where to start: record immediately when possible.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (phase === "needs_desktop") return;
    (async () => {
      const r = await api<{ signed_in?: boolean; live_recorder?: boolean }>("/api/clara-routines").catch(() => null);
      if (!r || !r.data.signed_in) return setPhase("sign_in");
      if (!r.data.live_recorder) return setPhase("unavailable");
      if (!/^https:\/\//i.test(subject.portalUrl ?? "")) return setPhase("need_url");
      await start(subject.portalUrl!);
    })();
  }, [start, subject.portalUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live: pull new actions while recording.
  useEffect(() => {
    if (phase !== "recording" || !session) return;
    const id = session.id;
    const t = window.setInterval(async () => {
      const r = await api<{ session?: SessionView }>(`/api/teach-sessions/${encodeURIComponent(id)}`).catch(() => null);
      if (r?.ok && r.data.session) setSession(r.data.session);
    }, 1500);
    return () => window.clearInterval(t);
  }, [phase, session?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const answer = async (questionId: string, ans: unknown) => {
    if (!session) return;
    const r = await api<{ session?: SessionView }>(`/api/teach-sessions/${encodeURIComponent(session.id)}/answer`, { question_id: questionId, answer: ans });
    if (r.ok && r.data.session) setSession(r.data.session);
    else setError(msg(r.data, es, T("Couldn't save that answer.", "No se pudo guardar esa respuesta.")));
  };

  const edit = async (body: Record<string, unknown>) => {
    if (!session) return;
    const r = await api<{ session?: SessionView }>(`/api/teach-sessions/${encodeURIComponent(session.id)}/mark`, body);
    if (r.ok && r.data.session) {
      setSession(r.data.session);
      setValidation(null);
    } else setError(msg(r.data, es, T("Couldn't change that step.", "No se pudo cambiar ese paso.")));
  };

  const validate = async () => {
    if (!session) return;
    setBusy(true);
    setError(null);
    setPhase("validating");
    try {
      if (session.status === "recording") {
        const f = await api<{ session?: SessionView }>(`/api/teach-sessions/${encodeURIComponent(session.id)}/finish`, {});
        if (f.ok && f.data.session) setSession(f.data.session);
      }
      const v = await api<{ session?: SessionView; validation?: Validation }>(`/api/teach-sessions/${encodeURIComponent(session.id)}/validate`, { live_check: true });
      if (!v.ok || !v.data.validation) throw new Error(msg(v.data, es, T("Couldn't check the recording.", "No se pudo revisar la grabación.")));
      if (v.data.session) setSession(v.data.session);
      setValidation(v.data.validation);
      setPhase("result");
    } catch (err) {
      setError((err as Error).message);
      setPhase("result");
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!session) return;
    setBusy(true);
    setError(null);
    const r = await api<{ routine?: LearnedRoutineSummary }>(`/api/teach-sessions/${encodeURIComponent(session.id)}/save`, { learn: true });
    setBusy(false);
    if (!r.ok || !r.data.routine) return setError(msg(r.data, es, T("Couldn't save. Try again.", "No se pudo guardar. Intenta otra vez.")));
    setRoutine(r.data.routine);
    onLearned?.(r.data.routine);
    setPhase("learned");
  };

  const recordAgain = async () => {
    setValidation(null);
    setSession(null);
    if (/^https:\/\//i.test(portalUrl)) await start(portalUrl);
    else setPhase("need_url");
  };

  const readVideo = async (file: File | null | undefined) => {
    if (!file) return;
    setError(null);
    if (!/^video\//.test(file.type)) return setError(T("Choose a screen recording (MP4, WebM or MOV).", "Escoge una grabación de pantalla (MP4, WebM o MOV)."));
    setPhase("reading_video");
    try {
      const frames = await videoFrames(file);
      const r = await api<{ steps?: string[] }>("/api/clara-recordings/steps", { frames, requirement_name: subject.name, portal_url: portalUrl || null, language });
      if (!r.ok || !r.data.steps?.length) throw new Error(msg(r.data, es, T("Clara couldn't read steps from that recording — describe them instead.", "Clara no pudo sacar los pasos de esa grabación — descríbelos tú.")));
      setDraftSteps(r.data.steps);
    } catch (err) {
      setError((err as Error).message);
      setDraftSteps(null);
    }
    setPhase("describe");
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const openQuestions = session?.questions ?? [];
  const pending = openQuestions.length;

  // ---------------------------------------------------------------- pieces
  const questionList = openQuestions.length > 0 && (
    <div className="tr-questions" data-testid="teach-questions">
      <p className="tr-h">{T("Clara's questions", "Preguntas de Clara")} <span className="tr-count">{pending}</span></p>
      {openQuestions.map((q) => (
        <div key={q.id} className="tr-q" data-testid="teach-question">
          {q.kind === "mapping" && (
            <>
              <p>{q.proposal ? T(`“${q.label}” — is this the business's ${q.proposal.en.toLowerCase()}?`, `“${q.label}” — ¿es ${q.proposal.es.toLowerCase()}?`) : T(`What goes in “${q.label}”?`, `¿Qué va en “${q.label}”?`)}</p>
              <div className="tr-q-actions">
                {q.proposal && <button type="button" className="tr-btn" onClick={() => answer(q.id, { kind: "mapping", choice: "confirm" })} data-testid="q-confirm">{T("Yes", "Sí")}</button>}
                <button type="button" className="tr-btn tr-btn-ghost" onClick={() => answer(q.id, { kind: "mapping", choice: "ask" })} data-testid="q-ask">{T("Ask each time", "Preguntar cada vez")}</button>
                <select aria-label={T("Another business detail", "Otro dato del negocio")} defaultValue="" onChange={(e) => e.target.value && answer(q.id, { kind: "mapping", choice: "correct", path: e.target.value })}>
                  <option value="">{T("Another detail…", "Otro dato…")}</option>
                  {PASSPORT_CATALOG.map((c) => <option key={c.path} value={c.path}>{es ? c.es : c.en}</option>)}
                </select>
              </div>
            </>
          )}
          {q.kind === "gate" && (
            <>
              <p>{es ? q.reason.es : q.reason.en} {T("You do this part — Clara stops here.", "Esta parte la haces tú — Clara se detiene aquí.")}</p>
              <div className="tr-q-actions">
                <button type="button" className="tr-btn" onClick={() => answer(q.id, { kind: "yes_no", value: "yes" })} data-testid="q-yes">{T("Right", "Correcto")}</button>
                <button type="button" className="tr-btn tr-btn-ghost" onClick={() => answer(q.id, { kind: "yes_no", value: "no" })}>{T("No", "No")}</button>
              </div>
            </>
          )}
          {q.kind === "always_choose" && (
            <>
              <p>{T(`Always choose “${q.optionText || q.label}”?`, `¿Siempre escoger “${q.optionText || q.label}”?`)}</p>
              <div className="tr-q-actions">
                <button type="button" className="tr-btn" onClick={() => answer(q.id, { kind: "yes_no", value: "yes" })} data-testid="q-yes">{T("Yes, always", "Sí, siempre")}</button>
                <button type="button" className="tr-btn tr-btn-ghost" onClick={() => answer(q.id, { kind: "yes_no", value: "no" })}>{T("Ask me", "Pregúntame")}</button>
              </div>
            </>
          )}
          {q.kind === "branch" && (
            <>
              <p>{T(`“${q.title}” only shows up sometimes.`, `“${q.title}” sale solo a veces.`)}</p>
              <div className="tr-q-actions">
                <button type="button" className="tr-btn tr-btn-ghost" onClick={() => answer(q.id, { kind: "branch", notSure: true })}>{T("Not sure — follow the portal", "No sé — sigue el portal")}</button>
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );

  const actionList = (
    <ol className="tr-actions-list" data-testid="teach-recorded-steps">
      {(session?.actions ?? []).length === 0 && <li className="tr-empty">{T("Waiting for your first click…", "Esperando tu primer clic…")}</li>}
      {(session?.actions ?? []).map((a) => (
        <li key={a.seq} className={`tr-action ${a.binding?.kind === "pause" ? "tr-action-pause" : ""} ${a.submitLike ? "tr-action-stop" : ""}`} data-testid="teach-recorded-step" data-kind={a.kind}>
          <ActionIcon a={a} />
          <span className="tr-action-text">{describe(a, es)}</span>
          <BindingChip a={a} es={es} />
          {a.screenshot && (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="tr-thumb" src={a.screenshot} alt="" loading="lazy" onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />
          )}
        </li>
      ))}
    </ol>
  );

  const fallbackOptions = (lead: ReactNode, testId: string) => (
    <div className="tr tr-fallback" data-testid={testId}>
      {lead}
      <div className="tr-options">
        <label className="tr-option" data-testid="teach-upload-recording">
          <Film size={20} aria-hidden="true" />
          <span>
            <b>{T("Upload a screen recording", "Sube una grabación de pantalla")}</b>
            <small>{T("Record your phone or computer screen while you file. Clara turns it into steps you check.", "Graba la pantalla del teléfono o la computadora mientras radicas. Clara la convierte en pasos que tú revisas.")}</small>
          </span>
          <input type="file" accept="video/mp4,video/webm,video/quicktime,video/*" onChange={(e) => { void readVideo(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
        <button type="button" className="tr-option" onClick={copyLink} data-testid="teach-copy-link">
          <Copy size={20} aria-hidden="true" />
          <span>
            <b>{copied ? T("Link copied", "Enlace copiado") : T("Open on a computer", "Abrir en una computadora")}</b>
            <small>{T("Copy this page's link and press Teach Clara there to record.", "Copia el enlace de esta página y toca Enséñale a Clara allí para grabar.")}</small>
          </span>
        </button>
      </div>
      {error && <p className="tc-error" role="alert">{error}</p>}
      <button type="button" className="tr-link" onClick={() => setPhase("describe")} data-testid="teach-describe-instead">
        <Pencil size={15} aria-hidden="true" /> {T("Or type the steps instead", "O escribe los pasos")}
      </button>
    </div>
  );

  // ---------------------------------------------------------------- phases
  let body: ReactNode = null;
  let footer: ReactNode = null;
  let wide: "wide" | "xl" | null = "wide";

  if (phase === "checking" || phase === "starting" || phase === "validating" || phase === "reading_video") {
    body = (
      <p className="tr-status" data-testid="teach-status">
        <Loader2 size={18} className="tc-spin" aria-hidden="true" />
        {phase === "validating"
          ? T("Checking that this is a complete, repeatable filing…", "Revisando que sea un trámite completo y repetible…")
          : phase === "reading_video"
            ? T("Reading your recording…", "Leyendo tu grabación…")
            : T("Opening Clara's browser on the portal…", "Abriendo el navegador de Clara en el portal…")}
      </p>
    );
  } else if (phase === "needs_desktop") {
    body = fallbackOptions(
      <div className="tr-lead tr-lead-warn">
        <Monitor size={20} aria-hidden="true" />
        <span>
          <b>{T("Recording needs a desktop", "Grabar requiere una computadora")}</b>
          {T(" — Clara records you doing the filing once in her browser, which needs a bigger screen.", " — Clara te graba haciendo el trámite una vez en su navegador, y eso necesita una pantalla más grande.")}
        </span>
      </div>,
      "teach-needs-desktop"
    );
    wide = null;
  } else if (phase === "unavailable" || phase === "sign_in") {
    body = fallbackOptions(
      <div className="tr-lead tr-lead-warn">
        <AlertTriangle size={20} aria-hidden="true" />
        <span>
          {phase === "sign_in" ? (
            <>
              <b>{T("Sign in to record", "Entra a tu cuenta para grabar")}</b>
              {T(" — what Clara learns is saved to your account.", " — lo que Clara aprende se guarda en tu cuenta.")}{" "}
              <a href={`/login?next=${encodeURIComponent(typeof window !== "undefined" ? window.location.pathname : "/")}`}>{T("Sign in", "Entrar")}</a>
            </>
          ) : (
            <>
              <b>{T("Live recording isn't connected here yet", "La grabación en vivo todavía no está conectada aquí")}</b>
              {T(" — it needs Clara's own browser.", " — necesita el navegador propio de Clara.")}
            </>
          )}
        </span>
      </div>,
      phase === "sign_in" ? "teach-sign-in" : "teach-unavailable"
    );
  } else if (phase === "need_url") {
    body = (
      <form className="tr" onSubmit={(e) => { e.preventDefault(); void start(portalUrl.trim()); }} data-testid="teach-need-url">
        <p className="tr-lead"><GraduationCap size={18} aria-hidden="true" /><span>{T("Where is this filed? Clara opens it and records you doing it once.", "¿Dónde se radica? Clara lo abre y te graba haciéndolo una vez.")}</span></p>
        <label className="tc-field">
          <span>{T("Portal address", "Dirección del portal")}</span>
          <input className="tr-input" value={portalUrl} onChange={(e) => setPortalUrl(e.target.value)} placeholder="https://…" data-testid="teach-portal-url" />
        </label>
        {error && <p className="tc-error" role="alert">{error}</p>}
        <div className="tr-actions"><button type="submit" className="tc-primary" disabled={!/^https:\/\//i.test(portalUrl.trim())}><Circle size={14} aria-hidden="true" /> {T("Start recording", "Empezar a grabar")}</button></div>
      </form>
    );
  } else if (phase === "recording" && session) {
    wide = "xl";
    body = (
      <div className="tr tr-recording" data-testid="teach-recording">
        <p className="tr-rec-banner" role="status">
          <span className="tr-rec-dot" aria-hidden="true" /> {T("Recording", "Grabando")} ·{" "}
          {T("Do the filing like you normally would. Stop at the review screen — don't press Submit.", "Haz el trámite como siempre. Detente en la pantalla de revisión — no toques Enviar.")}
        </p>
        <div className="tr-grid">
          <div className="tr-live">
            {session.live_url ? (
              <iframe src={session.live_url} title={T("Clara's browser", "Navegador de Clara")} allow="clipboard-read; clipboard-write" data-testid="teach-live-view" />
            ) : (
              <div className="tr-live-empty" data-testid="teach-live-view"><Monitor size={28} aria-hidden="true" /><p>{T("Clara's browser is open on the portal.", "El navegador de Clara está abierto en el portal.")}</p></div>
            )}
          </div>
          <div className="tr-side">
            <p className="tr-h">{T("What Clara saw you do", "Lo que Clara te vio hacer")} <span className="tr-count">{session.actions.length}</span></p>
            {actionList}
            {questionList}
          </div>
        </div>
      </div>
    );
    footer = (
      <>
        <span className="cl-muted">{T("Passwords, codes and typed values are never saved.", "Nunca se guardan contraseñas, códigos ni lo que escribes.")}</span>
        <span className="cl-foot-actions">
          <button type="button" className="tc-primary" onClick={validate} disabled={busy || session.actions.length === 0} data-testid="teach-finish">
            <Square size={14} aria-hidden="true" /> {T("I'm at the review screen — finish", "Llegué a la revisión — terminar")}
          </button>
        </span>
      </>
    );
  } else if (phase === "result") {
    const failing = (validation?.checks ?? []).filter((c) => !c.ok);
    const passing = (validation?.checks ?? []).filter((c) => c.ok);
    const pass = validation?.status === "pass";
    const pauses = new Set((session?.actions ?? []).filter((a) => a.binding?.kind === "pause").map((a) => a.binding && a.binding.kind === "pause" ? a.binding.gate : "")).size;
    body = (
      <div className="tr" data-testid="teach-validation">
        {validation && (
          <div className={`tr-verdict ${pass ? "tr-verdict-pass" : "tr-verdict-issues"}`} data-testid="teach-verdict" data-status={validation.status}>
            {pass ? <CheckCircle2 size={22} aria-hidden="true" /> : <AlertTriangle size={22} aria-hidden="true" />}
            <span>
              <b>{pass ? T("This is a repeatable filing", "Esto es un trámite repetible") : T(`Fix ${validation.errors} thing(s) before Clara learns this`, `Arregla ${validation.errors} cosa(s) antes de que Clara lo aprenda`)}</b>
              <small>
                {pass
                  ? T(`${session?.actions.length ?? 0} recorded actions · ${pauses} pause(s) for you · stops before Submit.`, `${session?.actions.length ?? 0} acciones grabadas · ${pauses} pausa(s) para ti · se detiene antes de Enviar.`)
                  : T("Each one has a one-line fix below.", "Cada una tiene su arreglo abajo.")}
              </small>
            </span>
          </div>
        )}
        {failing.length > 0 && (
          <ul className="tr-checks" data-testid="teach-issues">
            {failing.map((c) => (
              <li key={c.id} className={`tr-check tr-check-${c.severity}`} data-testid="teach-issue" data-check={c.id}>
                {c.severity === "error" ? <XCircle size={16} aria-hidden="true" /> : <AlertTriangle size={16} aria-hidden="true" />}
                <span><b>{es ? c.title.es : c.title.en}</b>{c.fix && <small>{es ? c.fix.es : c.fix.en}</small>}</span>
              </li>
            ))}
          </ul>
        )}
        {passing.length > 0 && (
          <div className="tr-passed">
            <button type="button" className="tr-link" onClick={() => setShowPassed((s) => !s)} aria-expanded={showPassed}>
              <CheckCircle2 size={15} aria-hidden="true" /> {T(`${passing.length} checks passed`, `${passing.length} revisiones pasaron`)}
            </button>
            {showPassed && (
              <ul className="tr-checks">
                {passing.map((c) => <li key={c.id} className="tr-check tr-check-ok"><CheckCircle2 size={16} aria-hidden="true" /><span>{es ? c.title.es : c.title.en}</span></li>)}
              </ul>
            )}
          </div>
        )}
        {validation && (
          <p className="tr-note">
            {validation.llm.status === "ok"
              ? validation.llm.notes.length
                ? T(`Clara's review: ${validation.llm.notes.map((n) => n.en).join(" ")}`, `Revisión de Clara: ${validation.llm.notes.map((n) => n.es).join(" ")}`)
                : T("Clara's review: looks like a complete filing.", "Revisión de Clara: parece un trámite completo.")
              : T("Checked with SmartPR's rules and a test replay.", "Revisado con las reglas de SmartPR y una prueba de repetición.")}
          </p>
        )}
        {questionList}
        {error && <p className="tc-error" role="alert">{error}</p>}
      </div>
    );
    footer = (
      <>
        <span className="cl-foot-actions">
          <button type="button" className="tr-link" onClick={() => setPhase("edit")} data-testid="teach-edit-steps"><Pencil size={15} aria-hidden="true" /> {T("Edit steps", "Editar pasos")}</button>
          <button type="button" className="tr-link" onClick={recordAgain} data-testid="teach-record-again"><RotateCcw size={15} aria-hidden="true" /> {T("Record again", "Grabar otra vez")}</button>
        </span>
        <span className="cl-foot-actions">
          {pass && pending === 0 ? (
            <button type="button" className="tc-primary" onClick={save} disabled={busy} data-testid="teach-save-learned">
              {busy ? <Loader2 size={15} className="tc-spin" aria-hidden="true" /> : <GraduationCap size={15} aria-hidden="true" />} {T("Save — Clara learned this", "Guardar — Clara lo aprendió")}
            </button>
          ) : (
            <button type="button" className="tc-primary" onClick={validate} disabled={busy} data-testid="teach-check-again"><RotateCcw size={15} aria-hidden="true" /> {T("Check again", "Revisar otra vez")}</button>
          )}
        </span>
      </>
    );
  } else if (phase === "edit" && session) {
    body = (
      <div className="tr" data-testid="teach-edit">
        <p className="tr-note">{T("Your recording, screen by screen. Change what a field is filled with, remove a stray click or screen, or mark a screen as yours.", "Tu grabación, pantalla por pantalla. Cambia con qué se llena un campo, quita un clic o una pantalla de más, o marca una pantalla como tuya.")}</p>
        <ol className="tr-screens">
          {session.steps.map((s) => (
            <li key={s.id} className="tr-screen" data-testid="teach-edit-screen">
              <div className="tr-screen-head">
                <b>{s.title}</b>
                <select aria-label={T("Who does this screen", "Quién hace esta pantalla")} value={s.gate && EDITABLE_GATES.includes(s.gate) ? s.gate : ""} onChange={(e) => void edit({ step_id: s.id, gate: e.target.value || null })} disabled={s.gate === "submit" || s.gate === "captcha"}>
                  <option value="">{T("Clara fills it", "Clara la llena")}</option>
                  {EDITABLE_GATES.map((g) => <option key={g} value={g}>{T(`I do this part: ${GATE_NAMES[g].en}`, `Esto lo hago yo: ${GATE_NAMES[g].es}`)}</option>)}
                </select>
                <button type="button" className="tc-icon" onClick={() => void edit({ remove_step: s.id })} aria-label={T("Remove screen", "Quitar pantalla")}><Trash2 size={15} aria-hidden="true" /></button>
              </div>
              {s.fields.map((f) => (
                <div key={f.key} className="tr-edit-row">
                  <span>{f.label}</span>
                  <select aria-label={T(`What fills “${f.label}”`, `Con qué se llena “${f.label}”`)} value={f.binding.kind === "passport" ? f.binding.path : f.binding.kind === "ask" ? "__ask" : ""} onChange={(e) => void edit({ rebind: { step_id: s.id, field_key: f.key, path: e.target.value === "__ask" ? null : e.target.value } })} data-testid="teach-edit-binding">
                    {f.binding.kind === "pending" && <option value="">{T("Choose…", "Escoge…")}</option>}
                    {f.binding.kind === "always" && <option value="">{T(`Always “${f.binding.option}”`, `Siempre “${f.binding.option}”`)}</option>}
                    <option value="__ask">{T("Ask each time", "Preguntar cada vez")}</option>
                    {PASSPORT_CATALOG.map((c) => <option key={c.path} value={c.path}>{es ? c.es : c.en}</option>)}
                  </select>
                </div>
              ))}
              {(s.clicks ?? []).map((c) => (
                <div key={c.key} className="tr-edit-row">
                  <span><MousePointerClick size={14} aria-hidden="true" /> {T(`Click “${c.label}”`, `Tocar “${c.label}”`)}</span>
                  <button type="button" className="tc-icon" onClick={() => void edit({ remove_action: { step_id: s.id, action_key: c.key } })} aria-label={T("Remove click", "Quitar clic")}><Trash2 size={14} aria-hidden="true" /></button>
                </div>
              ))}
            </li>
          ))}
        </ol>
        {error && <p className="tc-error" role="alert">{error}</p>}
      </div>
    );
    footer = (
      <>
        <button type="button" className="tr-link" onClick={() => setPhase("result")}>{T("Back", "Atrás")}</button>
        <button type="button" className="tc-primary" onClick={validate} disabled={busy} data-testid="teach-check-again"><RotateCcw size={15} aria-hidden="true" /> {T("Check again", "Revisar otra vez")}</button>
      </>
    );
  } else if (phase === "learned" && routine) {
    body = (
      <div className="tr tr-learned" data-testid="teach-learned">
        <CheckCircle2 size={32} aria-hidden="true" />
        <p className="tc-title">{T("Clara learned this", "Clara lo aprendió")}</p>
        <p>
          {T(
            `Next time, “Fill with Clara” follows exactly these ${routine.steps} step(s) on ${routine.portal_host}, stops at your ${routine.pauses} pause(s), and never presses Submit. If the portal changes, she stops and asks you to re-teach her.`,
            `La próxima vez, “Llenar con Clara” sigue exactamente estos ${routine.steps} paso(s) en ${routine.portal_host}, se detiene en tus ${routine.pauses} pausa(s) y nunca toca Enviar. Si el portal cambia, se detiene y te pide que le enseñes otra vez.`
          )}
        </p>
        <button type="button" className="tc-primary" onClick={onClose} data-testid="teach-done">{T("Done", "Listo")}</button>
      </div>
    );
    wide = null;
  } else if (phase === "describe") {
    body = (
      <div className="tr">
        {draftSteps && (
          <p className="tr-note" data-testid="teach-video-steps">
            {T("Clara read these steps from your recording. Check them and save. From a video Clara learns the steps, not the exact buttons — record on a computer once to make this a learned routine.", "Clara sacó estos pasos de tu grabación. Revísalos y guarda. De un video Clara aprende los pasos, no los botones exactos — grábalo una vez en una computadora para que sea una rutina aprendida.")}
          </p>
        )}
        {error && <p className="tc-error" role="alert">{error}</p>}
        <TeachClaraForm
          key={draftSteps?.join("|") ?? "typed"}
          target={{ requirementKey: subject.key, requirementName: subject.name, agency: subject.agency ?? null, portalUrl: portalUrl || subject.portalUrl || null }}
          language={language}
          initialSteps={draftSteps ?? undefined}
          variant="edit"
        />
      </div>
    );
  }

  return (
    <ClaraModal
      title={T("Teach Clara", "Enséñale a Clara")}
      subtitle={[subject.name, subject.agency].filter(Boolean).join(" · ")}
      onClose={onClose}
      testId="teach-clara-dialog"
      wide={wide !== null}
      size={wide === "xl" ? "xl" : undefined}
      footer={footer}
    >
      {body}
    </ClaraModal>
  );
}
