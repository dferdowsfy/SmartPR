"use client";

/**
 * Building blocks of the Clara workspace's Teach / Fill modes: chat
 * bubbles, the requirement context card, the masked one-time secure input
 * card, the Business Passport panel and the live browser panel.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, CircleDashed, Eye, EyeOff, Hand, KeyRound, Loader2, Lock, Maximize2, Minimize2, Monitor, MousePointer2, ShieldCheck, ZoomIn, ZoomOut } from "lucide-react";
import type { Lang } from "../../../forms/engine/types";
import { secretPrompt, type SecretFieldView } from "../../../../lib/agency-runs/teach/workspaceChat";

export const L = (en: string, es: string, lang: Lang) => (lang === "es" ? es : en);
export type Bi = { en: string; es: string };
export const pick = (b: Bi | null | undefined, lang: Lang) => (b ? (lang === "es" ? b.es : b.en) : "");

export const btn = "inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[14px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-50";
export const primaryBtn = `${btn} bg-[#fbf8f2] text-[#161616] hover:bg-white`;
export const ghostBtn = `${btn} border border-white/15 text-[#e8e1d0] hover:bg-white/10`;

export async function api<T>(url: string, body?: unknown): Promise<{ ok: boolean; status: number; data: T }> {
  const res = await fetch(url, body === undefined ? { cache: "no-store" } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
  const data = (await res.json().catch(() => ({}))) as T;
  return { ok: res.ok, status: res.status, data };
}

/** A server error's person-facing message (bilingual detail first). */
export function errText(data: unknown, lang: Lang, fallback: string): string {
  const d = data as { message?: string | Bi; detail?: unknown } | null;
  const detail = d?.detail as Bi | null | undefined;
  if (detail && typeof detail === "object" && "en" in detail && "es" in detail) return pick(detail, lang);
  const m = d?.message;
  return typeof m === "string" ? m : m ? pick(m, lang) : fallback;
}

export function ClaraBubble({ children, tone = "info", testId }: { children: ReactNode; tone?: "info" | "gate" | "stop" | "ok" | "ask"; testId?: string }) {
  const ring =
    tone === "stop" ? "border-rose-300/40 bg-rose-500/10"
    : tone === "gate" ? "border-amber-300/35 bg-amber-200/[0.06]"
    : tone === "ok" ? "border-[#2f6b4f] bg-[#1e4d38]/30"
    : tone === "ask" ? "border-sky-300/30 bg-sky-300/[0.06]"
    : "border-white/10 bg-white/[0.05]";
  return (
    <div className="flex items-start gap-2.5" data-testid={testId}>
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#1e4d38] font-[family-name:var(--font-display)] text-[14px] text-white" aria-hidden="true">C</span>
      <div className={`min-w-0 flex-1 rounded-2xl rounded-tl-md border px-3.5 py-2.5 text-[15px] leading-relaxed text-[#ece6d8] ${ring}`}>{children}</div>
    </div>
  );
}

export function UserBubble({ children }: { children: ReactNode }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-tr-md bg-[#fbf8f2] px-3.5 py-2 text-[15px] text-[#161616]">{children}</div>
    </div>
  );
}

export interface WorkspaceContextInfo {
  requirementName: string;
  agency: string | null;
  goal: string | null;
  portalUrl: string | null;
  businessName: string | null;
  passportOnFile: number | null;
  passportTotal: number | null;
  evidence: string[];
}

export function ContextCard({ info, lang }: { info: WorkspaceContextInfo; lang: Lang }) {
  const host = (() => {
    try {
      return info.portalUrl ? new URL(info.portalUrl).hostname : null;
    } catch {
      return null;
    }
  })();
  const row = (k: string, v: ReactNode) => (
    <div className="flex gap-2 text-[14px]">
      <dt className="w-[120px] shrink-0 text-[#9a917f]">{k}</dt>
      <dd className="min-w-0 flex-1 break-words text-[#ece6d8]">{v}</dd>
    </div>
  );
  return (
    <dl className="mt-2 space-y-1 rounded-xl border border-white/10 bg-black/20 p-3" data-testid="ws-context">
      {row(L("Requirement", "Requisito", lang), <b>{info.requirementName}</b>)}
      {info.agency && row(L("Agency", "Agencia", lang), info.agency)}
      {row(L("Goal", "Meta", lang), info.goal || L(`File “${info.requirementName}”`, `Radicar “${info.requirementName}”`, lang))}
      {row(L("Portal", "Portal", lang), host ? <span data-testid="ws-context-portal">{host}</span> : <span className="text-amber-200">{L("Not on file yet", "Todavía no está", lang)}</span>)}
      {row(L("Business", "Negocio", lang), info.businessName ?? <span className="text-[#b9b0a0]">{L("Not saved yet — Clara records the steps only", "Sin guardar — Clara solo graba los pasos", lang)}</span>)}
      {info.passportTotal !== null && row(
        L("Passport", "Pasaporte", lang),
        <span data-testid="ws-context-passport">{L(`${info.passportOnFile} of ${info.passportTotal} details on file`, `${info.passportOnFile} de ${info.passportTotal} datos guardados`, lang)}</span>
      )}
      {row(
        L("Evidence", "Evidencia", lang),
        info.evidence.length ? <span>{info.evidence.slice(0, 3).join(", ")}{info.evidence.length > 3 ? ` +${info.evidence.length - 3}` : ""}</span> : <span className="text-[#b9b0a0]">{L("None uploaded for this requirement", "Nada subido para este requisito", lang)}</span>
      )}
    </dl>
  );
}

/**
 * Masked, one-time input for a password / SSN / verification code. The
 * value lives only in this input while typing; on send it goes to the
 * server route that types it into the live portal field, then the box is
 * cleared. It is never added to the chat, never logged, never saved.
 */
export function SecureInputCard({
  lang,
  gate,
  fields,
  endpoint,
  onSent,
}: {
  lang: Lang;
  gate: string | null;
  fields: SecretFieldView[];
  endpoint: string;
  onSent?: (field: SecretFieldView | null) => void;
}) {
  const [target, setTarget] = useState(0);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [reveal, setReveal] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const field = fields[target] ?? null;
  const prompt = secretPrompt(field, gate);
  const send = async () => {
    const el = inputRef.current;
    const value = el?.value ?? "";
    if (!value) return;
    // Clear the box before the request settles: the value exists only in this call.
    if (el) el.value = "";
    setReveal(false);
    setBusy(true);
    setNote(null);
    const r = await api<{ ok?: boolean; reason?: string | null }>(endpoint, { value, selector: field?.selector ?? null }).catch(() => null);
    setBusy(false);
    if (r?.ok && r.data.ok) {
      setNote({ ok: true, text: L(`Sent to the portal field${field?.label ? ` “${field.label}”` : ""}. It wasn't saved anywhere.`, `Enviado al campo del portal${field?.label ? ` “${field.label}”` : ""}. No se guardó en ningún lado.`, lang) });
      onSent?.(field);
      if (fields.length > target + 1) setTarget(target + 1);
    } else {
      setNote({
        ok: false,
        text: r?.data.reason === "no_field"
          ? L("I couldn't find that field on the portal's screen. Click into it in the browser, then send again — or type it there yourself.", "No encontré ese campo en la pantalla del portal. Haz clic en él en el navegador y envíalo otra vez — o escríbelo tú allí.", lang)
          : errText(r?.data, lang, L("That didn't reach the portal. Type it in the browser yourself.", "No llegó al portal. Escríbelo tú en el navegador.", lang)),
      });
    }
  };
  return (
    <form
      className="ml-9 space-y-2 rounded-2xl border border-[#2f6b4f] bg-[#10251b] p-3"
      data-testid="ws-secure-card"
      autoComplete="off"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <p className="flex items-center gap-2 text-[13px] font-bold uppercase tracking-[0.12em] text-[#9fd3b4]">
        <Lock className="h-3.5 w-3.5" aria-hidden="true" /> {L("Secure one-time input", "Entrada segura de un solo uso", lang)}
      </p>
      {fields.length > 1 && (
        <select
          aria-label={L("Which field", "Qué campo", lang)}
          value={target}
          onChange={(e) => setTarget(Number(e.target.value))}
          className="w-full rounded-xl border border-white/15 bg-[#1f1f1f] px-3 py-1.5 text-[14px] text-[#f4efe2]"
        >
          {fields.map((f, i) => (
            <option key={i} value={i}>{pick(secretPrompt(f, gate), lang)}</option>
          ))}
        </select>
      )}
      <label className="block space-y-1">
        <span className="text-[14px] text-[#f4efe2]">{pick(prompt, lang)}</span>
        <span className="flex items-center gap-2">
          <input
            ref={inputRef}
            type={reveal ? "text" : "password"}
            name="clara-one-time"
            autoComplete="one-time-code"
            spellCheck={false}
            data-lpignore="true"
            data-1p-ignore="true"
            data-testid="ws-secure-input"
            maxLength={256}
            className="min-w-0 flex-1 rounded-xl border border-white/15 bg-[#1f1f1f] px-3 py-1.5 font-mono text-[15px] text-[#f4efe2]"
          />
          <button type="button" className="rounded-full p-1.5 text-[#cfc6b4] hover:bg-white/10" onClick={() => setReveal((r) => !r)} aria-label={reveal ? L("Hide", "Ocultar", lang) : L("Show while typing", "Mostrar al escribir", lang)}>
            {reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </span>
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className={primaryBtn} disabled={busy} data-testid="ws-secure-send">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />} {L("Send to the portal", "Enviar al portal", lang)}
        </button>
        <span className="text-[12px] text-[#9fd3b4]">
          <ShieldCheck className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
          {L("Goes only to the portal field. Not saved, not shown to Clara's AI, not in the routine.", "Va solo al campo del portal. No se guarda, no se le muestra a la IA de Clara, no queda en la rutina.", lang)}
        </span>
      </div>
      {note && (
        <p className={`text-[13px] ${note.ok ? "text-[#9fd3b4]" : "text-amber-200"}`} role="status" data-testid="ws-secure-note" data-ok={note.ok ? "1" : "0"}>
          {note.text}
        </p>
      )}
    </form>
  );
}

export interface PassportFieldView {
  path: string;
  en: string;
  es: string;
  has: boolean;
  preview: string | null;
}

export function PassportPanel({ fields, loaded, lang, highlight }: { fields: PassportFieldView[] | null; loaded: boolean; lang: Lang; highlight?: Set<string> }) {
  if (!fields) {
    return <p className="p-4 text-[14px] text-[#b9b0a0]"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />{L("Loading the Business Passport…", "Cargando el Pasaporte del negocio…", lang)}</p>;
  }
  const on = fields.filter((f) => f.has).length;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4" data-testid="ws-passport-panel">
      <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-[#9a917f]">{L("Business Passport", "Pasaporte del negocio", lang)}</p>
      <p className="mb-3 text-[14px] text-[#cfc6b4]">
        {loaded
          ? L(`${on} of ${fields.length} details Clara can fill are on file. A routine stores which detail goes where — never these values.`, `${on} de ${fields.length} datos que Clara puede llenar están guardados. Una rutina guarda qué dato va dónde — nunca estos valores.`, lang)
          : L("No saved business yet: Clara records the steps and which detail goes where; she fills values later from the business's Passport.", "Todavía no hay un negocio guardado: Clara graba los pasos y qué dato va dónde; los valores los llena después del Pasaporte del negocio.", lang)}
      </p>
      <ul className="space-y-1">
        {fields.map((f) => (
          <li key={f.path} className={`flex items-start gap-2 rounded-lg px-2 py-1 text-[14px] ${highlight?.has(f.path) ? "bg-[#1e4d38]/40" : ""}`} data-has={f.has ? "1" : "0"}>
            {f.has ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#9fd3b4]" /> : <CircleDashed className="mt-0.5 h-4 w-4 shrink-0 text-[#8f8674]" />}
            <span className="min-w-0 flex-1">
              <span className="text-[#ece6d8]">{lang === "es" ? f.es : f.en}</span>
              {f.preview && <span className="block truncate text-[12px] text-[#9a917f]">{f.preview}</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Zoom steps for the live browser (1 = fit the panel). */
const BROWSER_ZOOMS = [1, 1.5, 2, 3] as const;

/**
 * noVNC scales the remote 1280×760 desktop into its frame. Ask for that
 * explicitly so a larger frame (zoom) renders larger, never clipped.
 */
export function scaledLiveUrl(url: string): string {
  if (!/\/vnc(_lite)?\.html/.test(url) || /[?&]resize=/.test(url)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}resize=scale`;
}

export function BrowserPanel({ liveUrl, lang, note, wide, onToggleWide }: { liveUrl: string | null; lang: Lang; note?: ReactNode; wide?: boolean; onToggleWide?: () => void }) {
  // The remote browser captures touches, so the page's own pinch-zoom can't
  // reach it: zoom, pan and full screen are explicit controls instead.
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState(false);
  const [full, setFull] = useState(false);
  const viewRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = viewRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBox({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [liveUrl]);
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setFull(false); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [full]);
  // Pan with the mouse (touch pans natively through the overlay).
  const drag = useRef<{ x: number; y: number; l: number; t: number } | null>(null);
  const step = (dir: 1 | -1) => {
    const i = BROWSER_ZOOMS.indexOf(zoom as (typeof BROWSER_ZOOMS)[number]);
    const next = BROWSER_ZOOMS[Math.min(BROWSER_ZOOMS.length - 1, Math.max(0, i + dir))];
    setZoom(next);
    if (next === 1) setPan(false);
  };
  const zoomed = zoom > 1;
  const ctl = "grid h-9 w-9 place-items-center rounded-full border border-white/15 bg-white/5 text-[#e8e1d3] hover:bg-white/10 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#e8d9b5]";
  return (
    <div
      className={full ? "fixed inset-0 z-[200] flex flex-col bg-[#111] pb-[env(safe-area-inset-bottom,0px)] pt-[env(safe-area-inset-top,0px)]" : "flex min-h-0 flex-1 flex-col"}
      data-testid="ws-browser-panel"
      data-full={full || undefined}
      role={full ? "dialog" : undefined}
      aria-modal={full || undefined}
      aria-label={full ? L("Clara's browser, full screen", "Navegador de Clara, pantalla completa", lang) : undefined}
    >
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-white/10 px-3 py-2 text-[13px] text-[#cfc6b4]">
        {!full && <span className="min-w-0 flex-1 basis-56">{note}</span>}
        {liveUrl && (
          <div className={`flex items-center gap-1.5 ${full ? "flex-1" : ""}`} role="group" aria-label={L("Browser view", "Vista del navegador", lang)} data-testid="ws-browser-controls">
            <button type="button" className={ctl} onClick={() => step(-1)} disabled={!zoomed} aria-label={L("Zoom out", "Alejar", lang)} data-testid="ws-zoom-out"><ZoomOut className="h-4 w-4" aria-hidden="true" /></button>
            <span className="min-w-[3.25rem] text-center text-[13px] font-semibold tabular-nums text-[#e8e1d3]" aria-live="polite" data-testid="ws-zoom-level">{zoomed ? `${Math.round(zoom * 100)}%` : L("Fit", "Ajustar", lang)}</span>
            <button type="button" className={ctl} onClick={() => step(1)} disabled={zoom === BROWSER_ZOOMS[BROWSER_ZOOMS.length - 1]} aria-label={L("Zoom in", "Acercar", lang)} data-testid="ws-zoom-in"><ZoomIn className="h-4 w-4" aria-hidden="true" /></button>
            {zoomed && (
              <button type="button" className={`${ctl} ${pan ? "!bg-[#e8d9b5] !text-[#161616]" : ""}`} onClick={() => setPan((p) => !p)} aria-pressed={pan} aria-label={pan ? L("Back to clicking in the page", "Volver a hacer clic en la página", lang) : L("Move around the page", "Moverse por la página", lang)} title={pan ? L("Click mode", "Modo clic", lang) : L("Move mode", "Modo mover", lang)} data-testid="ws-pan-toggle">
                {pan ? <MousePointer2 className="h-4 w-4" aria-hidden="true" /> : <Hand className="h-4 w-4" aria-hidden="true" />}
              </button>
            )}
            <button type="button" className={`${ctl} ${full ? "ml-auto" : ""}`} onClick={() => setFull((f) => !f)} aria-label={full ? L("Exit full screen", "Salir de pantalla completa", lang) : L("Full screen", "Pantalla completa", lang)} data-testid="ws-fullscreen">
              {full ? <Minimize2 className="h-4 w-4" aria-hidden="true" /> : <Maximize2 className="h-4 w-4" aria-hidden="true" />}
            </button>
          </div>
        )}
        {onToggleWide && !full && (
          <button type="button" onClick={onToggleWide} className="hidden shrink-0 rounded-full bg-[#fbf8f2] px-3 py-1 text-[13px] font-bold text-[#161616] hover:bg-white lg:inline-flex" data-testid="ws-expand-browser">
            {wide ? L("Show chat", "Ver chat", lang) : L("Expand browser", "Agrandar navegador", lang)}
          </button>
        )}
      </div>
      {liveUrl ? (
        <div ref={viewRef} className={`relative min-h-0 flex-1 bg-black ${zoomed ? "overflow-auto overscroll-contain" : "overflow-hidden"}`} data-testid="ws-browser-viewport">
          <div className="relative" style={zoomed && box.w ? { width: box.w * zoom, height: box.h * zoom } : { width: "100%", height: "100%" }}>
            <iframe src={scaledLiveUrl(liveUrl)} title={L("Clara's browser", "Navegador de Clara", lang)} className="absolute inset-0 h-full w-full bg-black" allow="autoplay; clipboard-read; clipboard-write; fullscreen" data-testid="ws-live-view" />
            {pan && (
              <div
                className="absolute inset-0 cursor-grab touch-pan-x touch-pan-y active:cursor-grabbing"
                data-testid="ws-pan-layer"
                onPointerDown={(e) => { if (e.pointerType !== "mouse" || !viewRef.current) return; drag.current = { x: e.clientX, y: e.clientY, l: viewRef.current.scrollLeft, t: viewRef.current.scrollTop }; }}
                onPointerMove={(e) => { const d = drag.current; if (!d || !viewRef.current) return; viewRef.current.scrollLeft = d.l - (e.clientX - d.x); viewRef.current.scrollTop = d.t - (e.clientY - d.y); }}
                onPointerUp={() => { drag.current = null; }}
                onPointerLeave={() => { drag.current = null; }}
              />
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-[14px] text-[#b9b0a0]">
          <Monitor className="h-7 w-7" aria-hidden="true" />
          {L("The portal browser opens here when Clara starts.", "El navegador del portal se abre aquí cuando Clara empieza.", lang)}
        </div>
      )}
      {zoomed && liveUrl && (
        <p className="shrink-0 border-t border-white/10 px-3 py-1.5 text-[12.5px] text-[#b9b0a0]">
          {pan
            ? L("Drag to move around the page. Tap the pointer to click and type again.", "Arrastra para moverte por la página. Toca el puntero para volver a hacer clic y escribir.", lang)
            : L("Tap the hand to move around the zoomed page.", "Toca la mano para moverte por la página ampliada.", lang)}
        </p>
      )}
    </div>
  );
}

export function UnavailableCard({ lang, message, hint, reason, onRetry, children }: { lang: Lang; message: string; hint: string | null; reason: string | null; onRetry: () => void; children?: ReactNode }) {
  return (
    <ClaraBubble tone="stop" testId="ws-unavailable">
      <p className="flex items-start gap-2" data-reason={reason ?? ""} data-testid="ws-unavailable-reason">
        <AlertTriangle className="mt-1 h-4 w-4 shrink-0 text-rose-200" aria-hidden="true" />
        <span>{message}</span>
      </p>
      {hint && <p className="mt-1.5 rounded-lg bg-black/30 px-2.5 py-1.5 font-mono text-[12px] text-[#e8d9b5]" data-testid="ws-operator-hint">{hint}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className={ghostBtn} onClick={onRetry} data-testid="ws-retry">{L("Check again", "Revisar otra vez", lang)}</button>
        {children}
      </div>
    </ClaraBubble>
  );
}

export interface PageFieldView {
  label: string;
  selector: string | null;
  kind: "text" | "password" | "ssn" | "code" | "payment" | "choice" | "next";
  options?: { label: string; selector: string | null }[];
  /** The Passport field this looks like, and whether the business has it (never the full value). */
  suggestion?: { path: string; name: Bi; on_file: boolean; status?: "ready" | "needed" | "new"; sensitive?: boolean; preview?: string | null; choice?: { options: string[]; selected: string | null } } | null;
}

/** "Primer Nombre:*" → "Primer Nombre (First name)" when a translation exists. */
export function withTranslation(label: string, tr: Record<string, string> | undefined): string {
  const t = tr?.[label];
  const clean = label.replace(/[:*\s]+$/g, "").trim();
  return t && t.toLowerCase() !== clean.toLowerCase() ? `${clean} (${t})` : label;
}

/**
 * The current portal screen, field by field, against the Business Passport:
 *
 *  ✓ Passport ready     mapped and on file — Clara fills it from the Passport
 *  Needs information    mapped but missing — add it here, saved to the Passport
 *  New Passport detail  no mapping yet — save it as a new Passport detail
 *
 * Values typed here go to the business's Passport (SSN / ITIN to the
 * protected store, masked after entry) and are reused by every later filing.
 * The routine only ever learns which portal field maps to which Passport
 * detail — never the value. Passwords, codes and payment details are
 * one-time: they go straight to the portal field and are never saved.
 */
export function PageFieldsCard({ lang, fields, endpoint, passportEndpoint, saveEndpoint, fillPageEndpoint, autoFill = false, translations, onSent, onPassportSaved }: {
  lang: Lang;
  /** POST { continue } → fill the screen from the Passport and press Continue. */
  fillPageEndpoint?: string | null;
  /** Fill + continue on its own once nothing on the screen is missing. */
  autoFill?: boolean;
  fields: PageFieldView[];
  endpoint: string;
  passportEndpoint?: string;
  /** POST { path, value } → saves to the Business Passport (null: no saved business yet). */
  saveEndpoint?: string | null;
  translations?: Record<string, string>;
  onSent?: () => void;
  onPassportSaved?: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [showOther, setShowOther] = useState(false);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [pageNote, setPageNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [auto, setAuto] = useState(autoFill);
  const autoRan = useRef(false);
  const refs = useRef<Record<string, HTMLInputElement | null>>({});
  const usable = fields.filter((f) => f.selector && f.kind !== "payment" && f.kind !== "next");
  const nextField = fields.find((f) => f.kind === "next" && f.selector) ?? null;
  const label = (f: PageFieldView) => withTranslation(f.label, translations) || L("Field", "Campo", lang);
  const statusOf = (f: PageFieldView): "ready" | "needed" | "new" | "once" => {
    const sug = f.suggestion;
    if (!sug) return "once";
    if (saved[sug.path] !== undefined || sug.on_file) return "ready";
    return sug.status === "new" ? "new" : "needed";
  };
  const ready = usable.filter((f) => statusOf(f) === "ready");
  const needed = usable.filter((f) => statusOf(f) === "needed");
  const other = usable.filter((f) => statusOf(f) === "new");
  const once = usable.filter((f) => statusOf(f) === "once");
  const note = (key: string, ok: boolean, text: string) => setNotes((n) => ({ ...n, [key]: { ok, text } }));

  /** Fill the whole screen from the Passport and press Continue (never a final submit). */
  const fillPage = async () => {
    if (!fillPageEndpoint) return;
    setBusy("__page");
    const r = await api<{ ok?: boolean; filled?: number; chosen?: number; continued?: boolean; needed?: number; reason?: string | null }>(fillPageEndpoint, { continue: true }).catch(() => null);
    setBusy(null);
    const d = r?.ok ? r.data : null;
    const n = (d?.filled ?? 0) + (d?.chosen ?? 0);
    if (d && d.ok) {
      setPageNote({ ok: true, text: d.continued
        ? L(`Filled ${n} from your Business Passport and pressed “${nextField?.label ?? "Continue"}”.`, `Llené ${n} desde tu Pasaporte del negocio y presioné “${nextField?.label ?? "Continuar"}”.`, lang)
        : L(`Filled ${n} from your Business Passport.`, `Llené ${n} desde tu Pasaporte del negocio.`, lang) });
      onSent?.();
    } else {
      setPageNote({ ok: false, text: L("Couldn't fill this screen from the Passport. Fill it in the browser and press Continue.", "No se pudo llenar esta pantalla desde el Pasaporte. Llénala en el navegador y presiona Continuar.", lang) });
    }
  };
  const fillable = ready.length > 0 || Boolean(nextField && usable.length);
  const readyToAuto = auto && Boolean(fillPageEndpoint) && needed.length === 0 && ready.length > 0;
  const fillPageRef = useRef(fillPage);
  fillPageRef.current = fillPage;
  useEffect(() => {
    // Everything this screen asks is in the Passport: fill it and continue, once per screen.
    if (!readyToAuto || autoRan.current) return;
    const t = window.setTimeout(() => {
      autoRan.current = true;
      void fillPageRef.current();
    }, 400);
    return () => window.clearTimeout(t);
  }, [readyToAuto]);
  if (!usable.length) return null;

  const fillFromPassport = async (f: PageFieldView) => {
    if (!passportEndpoint) return;
    const key = f.selector!;
    setBusy(key);
    const r = await api<{ ok?: boolean; reason?: string | null }>(passportEndpoint, { selector: f.selector }).catch(() => null);
    setBusy(null);
    const ok = Boolean(r?.ok && r.data.ok);
    note(key, ok, ok ? L("Filled on the page from the Business Passport.", "Llenado en la página desde el Pasaporte del negocio.", lang) : L("Couldn't fill it on the page — click the field in the browser and try again.", "No se pudo llenar en la página — haz clic en el campo en el navegador e intenta otra vez.", lang));
    if (ok) onSent?.();
  };
  const fillAll = async () => {
    for (const f of ready) await fillFromPassport(f);
  };
  /** One-time: straight to the portal field, never saved. */
  const sendOnce = async (f: PageFieldView) => {
    const key = f.selector!;
    const el = refs.current[key];
    const value = el?.value ?? "";
    if (!value) return;
    if (el) el.value = "";
    setBusy(key);
    const r = await api<{ ok?: boolean; reason?: string | null }>(endpoint, { value, selector: f.selector }).catch(() => null);
    setBusy(null);
    const ok = Boolean(r?.ok && r.data.ok);
    note(key, ok, ok ? L("Sent to the portal — not saved.", "Enviado al portal — no se guardó.", lang) : L("Didn't reach that field. Click it in the browser and try again, or type it there.", "No llegó a ese campo. Haz clic en él en el navegador e intenta otra vez, o escríbelo allí.", lang));
    if (ok) onSent?.();
  };
  /** Save to the Business Passport (then Clara can fill it here and in every later filing). */
  const saveToPassport = async (f: PageFieldView) => {
    if (!saveEndpoint || !f.suggestion) return;
    const key = f.selector!;
    const el = refs.current[key];
    const isChoice = f.kind === "choice";
    const value = isChoice ? picked[key] ?? "" : el?.value ?? "";
    if (!value.trim()) return;
    setBusy(key);
    const r = await api<{ ok?: boolean; preview?: string; message?: string; error?: string }>(saveEndpoint, isChoice ? { path: f.suggestion.path, option: value } : { path: f.suggestion.path, value }).catch(() => null);
    setBusy(null);
    if (r?.ok && r.data.ok) {
      if (el) el.value = "";
      setSaved((m) => ({ ...m, [f.suggestion!.path]: isChoice ? value : r.data.preview ?? "" }));
      note(key, true, "");
      onPassportSaved?.();
    } else {
      note(key, false, r?.data?.error === "protected_storage_unavailable"
        ? L("Protected storage isn't set up, so this can't be saved yet. Send it once instead.", "El almacenamiento protegido no está configurado, así que no se puede guardar todavía. Envíalo una vez.", lang)
        : r?.data?.error === "unsupported_option"
        ? L("The Business Passport doesn't track that option yet — choose it in the browser.", "El Pasaporte del negocio todavía no guarda esa opción — escógela en el navegador.", lang)
        : L("Couldn't save it to the Passport. Try again.", "No se pudo guardar en el Pasaporte. Intenta otra vez.", lang));
    }
  };

  const choicePicker = (f: PageFieldView) => (
    <span className="flex w-full flex-wrap gap-1.5" role="radiogroup" aria-label={label(f)} data-testid="ws-choice-options">
      {(f.suggestion?.choice?.options ?? f.options?.map((o) => o.label) ?? []).map((opt) => {
        const on = picked[f.selector!] === opt;
        return (
          <button key={opt} type="button" role="radio" aria-checked={on} onClick={() => setPicked((m) => ({ ...m, [f.selector!]: opt }))}
            className={`min-h-9 rounded-full border px-3 text-left text-[13px] ${on ? "border-[#e8d9b5] bg-[#e8d9b5] font-semibold text-[#161616]" : "border-white/15 text-[#ece6d8] hover:bg-white/10"}`}>
            {opt}
          </button>
        );
      })}
    </span>
  );
  const input = (f: PageFieldView, secret: boolean) => (
    <input
      ref={(el) => { refs.current[f.selector!] = el; }}
      type={secret ? "password" : "text"}
      autoComplete={secret ? "one-time-code" : "off"}
      spellCheck={false}
      data-lpignore="true"
      data-1p-ignore="true"
      maxLength={256}
      aria-label={label(f)}
      className="min-w-0 flex-1 basis-44 rounded-xl border border-white/15 bg-[#1f1f1f] px-3 py-2 text-[15px] text-[#f4efe2] focus:border-[#e8d9b5] focus:outline-none"
      data-testid="ws-page-field-input"
    />
  );
  const noteLine = (key: string) => notes[key]?.text ? <span className={`block text-[12px] ${notes[key].ok ? "text-[#9fd3b4]" : "text-amber-200"}`} role="status">{notes[key].text}</span> : null;

  return (
    <div className="ml-9 space-y-3 rounded-2xl border border-white/10 bg-[#141414] p-3" data-testid="ws-page-fields">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="text-[13px] font-bold uppercase tracking-[0.12em] text-[#cfc6b4]">{L("This page and your Passport", "Esta página y tu Pasaporte", lang)}</p>
        <span className="text-[12px] text-[#9a917f]" data-testid="ws-page-fields-summary">
          {L(`${ready.length} ready · ${needed.length} needed`, `${ready.length} listos · ${needed.length} faltan`, lang)}
        </span>
      </div>

      {fillPageEndpoint && fillable && (
        <div className="flex flex-wrap items-center gap-2" data-testid="ws-fill-page-bar">
          <button type="button" className={primaryBtn} disabled={busy !== null || needed.length > 0} onClick={() => void fillPage()} data-testid="ws-fill-page">
            {busy === "__page" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            {nextField ? L(`Fill from Passport & ${nextField.label}`, `Llenar desde el Pasaporte y ${nextField.label}`, lang) : L("Fill from Passport", "Llenar desde el Pasaporte", lang)}
          </button>
          <label className="flex items-center gap-1.5 text-[12.5px] text-[#cfc6b4]">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} className="accent-[#e8d9b5]" data-testid="ws-auto-fill" />
            {L("Do this automatically on each screen", "Hacerlo solo en cada pantalla", lang)}
          </label>
          {needed.length > 0 && <span className="w-full text-[12px] text-amber-200">{L("Add the missing details below first.", "Primero añade los datos que faltan abajo.", lang)}</span>}
          {pageNote && <span className={`w-full text-[12.5px] ${pageNote.ok ? "text-[#9fd3b4]" : "text-amber-200"}`} role="status" data-testid="ws-fill-page-note">{pageNote.text}</span>}
        </div>
      )}

      {needed.length > 0 && (
        <section className="space-y-2 rounded-xl border border-amber-300/30 bg-amber-200/[0.06] p-3" data-testid="ws-info-needed">
          <p className="text-[14px] font-semibold text-amber-100">{L("Needed for this filing", "Necesario para este trámite", lang)}</p>
          <p className="-mt-1 text-[12.5px] text-[#cfc6b4]">{L("Add it once. Clara can reuse it in future filings.", "Añádelo una vez. Clara puede reutilizarlo en futuros trámites.", lang)}</p>
          {needed.map((f) => {
            const key = f.selector!;
            const sug = f.suggestion!;
            const secret = Boolean(sug.sensitive) || f.kind !== "text";
            return (
              <form key={key} className="space-y-1" autoComplete="off" onSubmit={(e) => { e.preventDefault(); void (saveEndpoint ? saveToPassport(f) : sendOnce(f)); }} data-testid="ws-needed-field" data-path={sug.path}>
                <span className="block text-[14px] text-[#f4efe2]">
                  {pick(sug.name, lang)}
                  {secret && <Lock className="ml-1 inline h-3 w-3 text-[#9fd3b4]" aria-label={L("protected", "protegido", lang)} />}
                  <span className="ml-1 text-[12px] text-[#9a917f]">· {L("on the page:", "en la página:", lang)} {label(f)}</span>
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  {f.kind === "choice" ? choicePicker(f) : input(f, secret)}
                  {saveEndpoint ? (
                    <button type="submit" className={primaryBtn} disabled={busy === key} data-testid="ws-save-to-passport">
                      {busy === key ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} {L("Save to Passport", "Guardar en el Pasaporte", lang)}
                    </button>
                  ) : (
                    <button type="submit" className={ghostBtn} disabled={busy === key} data-testid="ws-page-field-send">{L("Send once", "Enviar una vez", lang)}</button>
                  )}
                </span>
                {secret && saveEndpoint && <span className="block text-[12px] text-[#9a917f]">{L("Saved to the protected part of the Passport and masked. Never in the routine, logs or recordings.", "Se guarda en la parte protegida del Pasaporte, oculto. Nunca en la rutina, registros ni grabaciones.", lang)}</span>}
                {!saveEndpoint && <span className="block text-[12px] text-[#9a917f]">{L("Save the business first to keep details in its Passport. For now this goes to the page only.", "Guarda el negocio primero para conservar datos en su Pasaporte. Por ahora esto va solo a la página.", lang)}</span>}
                {noteLine(key)}
              </form>
            );
          })}
        </section>
      )}

      {ready.length > 0 && (
        <section className="space-y-1.5" data-testid="ws-passport-ready">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[13px] font-semibold text-[#9fd3b4]">✓ {L("Passport ready", "Listo en el Pasaporte", lang)}</p>
            {passportEndpoint && ready.length > 1 && (
              <button type="button" className={ghostBtn} disabled={busy !== null} onClick={() => void fillAll()} data-testid="ws-fill-all-passport">
                {L(`Fill all ${ready.length} on the page`, `Llenar los ${ready.length} en la página`, lang)}
              </button>
            )}
          </div>
          {ready.map((f) => {
            const key = f.selector!;
            const sug = f.suggestion!;
            const justSaved = saved[sug.path];
            return (
              <div key={key} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg px-2 py-1.5 text-[14px] hover:bg-white/[0.03]" data-testid="ws-ready-field" data-path={sug.path}>
                <CheckCircle2 className="h-4 w-4 shrink-0 text-[#9fd3b4]" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="text-[#ece6d8]">{pick(sug.name, lang)}</span>
                  {(justSaved ?? sug.preview ?? sug.choice?.selected) && <span className="ml-2 text-[13px] text-[#cfc6b4]" data-testid="ws-ready-preview">{justSaved ?? sug.preview ?? sug.choice?.selected}</span>}
                  {justSaved !== undefined && <span className="block text-[12px] text-[#9fd3b4]" data-testid="ws-saved-note">{L("Saved to Business Passport", "Guardado en el Pasaporte del negocio", lang)}</span>}
                </span>
                {passportEndpoint && f.kind !== "choice" && (
                  <button type="button" className="rounded-full bg-[#1e4d38] px-3 py-1 text-[13px] font-semibold text-white hover:bg-[#2f6b4f] disabled:opacity-50" disabled={busy === key} onClick={() => void fillFromPassport(f)} data-testid="ws-fill-from-passport">
                    {busy === key ? <Loader2 className="inline h-3.5 w-3.5 animate-spin" /> : L("Fill on page", "Llenar en la página", lang)}
                  </button>
                )}
                {noteLine(key)}
              </div>
            );
          })}
        </section>
      )}

      {other.length > 0 && (
        <section className="space-y-2" data-testid="ws-new-details">
          <button type="button" className="text-[13px] font-semibold text-[#e8d9b5] underline-offset-4 hover:underline" aria-expanded={showOther} onClick={() => setShowOther((o) => !o)} data-testid="ws-new-details-toggle">
            {L(`New Passport details on this page (${other.length})`, `Datos nuevos para el Pasaporte en esta página (${other.length})`, lang)}
          </button>
          {showOther && other.map((f) => {
            const key = f.selector!;
            const sug = f.suggestion!;
            return (
              <form key={key} className="space-y-1 rounded-xl border border-white/10 p-2.5" autoComplete="off" onSubmit={(e) => { e.preventDefault(); void saveToPassport(f); }} data-testid="ws-new-detail" data-path={sug.path}>
                <span className="block text-[14px] text-[#f4efe2]">{label(f)}</span>
                <span className="block text-[12px] text-[#9a917f]">{L(`Clara found this field. Save it to the Passport as “${sug.name.en}”, or send it once.`, `Clara encontró este campo. Guárdalo en el Pasaporte como “${sug.name.es}”, o envíalo una vez.`, lang)}</span>
                <span className="flex flex-wrap items-center gap-2">
                  {f.kind === "choice" ? choicePicker(f) : input(f, false)}
                  {saveEndpoint && <button type="submit" className={primaryBtn} disabled={busy === key} data-testid="ws-add-new-detail">{L("Add to Passport", "Añadir al Pasaporte", lang)}</button>}
                  <button type="button" className={ghostBtn} disabled={busy === key} onClick={() => void sendOnce(f)}>{L("Send once", "Enviar una vez", lang)}</button>
                </span>
                {noteLine(key)}
              </form>
            );
          })}
        </section>
      )}

      {once.length > 0 && (
        <section className="space-y-2 rounded-xl border border-[#2f6b4f] bg-[#10251b] p-3" data-testid="ws-one-time-fields">
          <p className="flex items-center gap-2 text-[13px] font-bold uppercase tracking-[0.12em] text-[#9fd3b4]">
            <Lock className="h-3.5 w-3.5" aria-hidden="true" /> {L("One-time entries", "Datos de una sola vez", lang)}
          </p>
          <p className="text-[12px] text-[#cfc6b4]">{L("Passwords and codes go straight to the page. Never saved, never in the routine.", "Contraseñas y códigos van directo a la página. Nunca se guardan ni quedan en la rutina.", lang)}</p>
          {once.map((f) => {
            const key = f.selector!;
            return (
              <form key={key} className="space-y-1" autoComplete="off" onSubmit={(e) => { e.preventDefault(); void sendOnce(f); }} data-testid="ws-page-field" data-kind={f.kind}>
                <span className="block text-[14px] text-[#f4efe2]">{label(f)}{f.kind !== "text" && <Lock className="ml-1 inline h-3 w-3 text-[#9fd3b4]" aria-label={L("sensitive", "sensible", lang)} />}</span>
                <span className="flex items-center gap-2">
                  {input(f, f.kind !== "text")}
                  <button type="submit" className={primaryBtn} disabled={busy === key} data-testid="ws-page-field-send">
                    {busy === key ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />} {L("Send", "Enviar", lang)}
                  </button>
                </span>
                {noteLine(key)}
              </form>
            );
          })}
        </section>
      )}
    </div>
  );
}
