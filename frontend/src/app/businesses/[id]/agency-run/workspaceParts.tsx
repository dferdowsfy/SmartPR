"use client";

/**
 * Building blocks of the Clara workspace's Teach / Fill modes: chat
 * bubbles, the requirement context card, the masked one-time secure input
 * card, the Business Passport panel and the live browser panel.
 */
import { useRef, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, CircleDashed, Eye, EyeOff, KeyRound, Loader2, Lock, Monitor, ShieldCheck } from "lucide-react";
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
    <div className="h-full overflow-y-auto p-4" data-testid="ws-passport-panel">
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

export function BrowserPanel({ liveUrl, lang, note }: { liveUrl: string | null; lang: Lang; note?: ReactNode }) {
  return (
    <div className="flex h-full flex-col" data-testid="ws-browser-panel">
      {note && <div className="shrink-0 border-b border-white/10 px-3 py-2 text-[13px] text-[#cfc6b4]">{note}</div>}
      {liveUrl ? (
        <iframe src={liveUrl} title={L("Clara's browser", "Navegador de Clara", lang)} className="min-h-0 w-full flex-1 bg-black" allow="clipboard-read; clipboard-write" data-testid="ws-live-view" />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-[14px] text-[#b9b0a0]">
          <Monitor className="h-7 w-7" aria-hidden="true" />
          {L("The portal browser opens here when Clara starts.", "El navegador del portal se abre aquí cuando Clara empieza.", lang)}
        </div>
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
