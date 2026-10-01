"use client";

/**
 * Teach Clara — show Clara a filing once so she can do it again from any
 * business's info (Teach Clara spec §5).
 *
 *  1. Setup: which site and which form.
 *  2. Walkthrough: the person files in their own browser session (live view
 *     beside the questions) and signs in themselves. Clara records the
 *     screens — structure only, never what was typed — and asks as she goes:
 *     "remember this as the legal name?", "always choose this?", "is this a
 *     step only you do?".
 *  3. Review: a plain-language card of what she learned. Save it (private
 *     for most people; the shared library for the SmartPR team) or send it
 *     for review.
 */
import Link from "next/link";
import { Suspense, use, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, GraduationCap, Hand, Loader2, Plus, Split } from "lucide-react";
import { useLang } from "../../../useLang";
import type { Lang } from "../../../forms/engine/types";
import { SkillCardView } from "../../../components/skills/SkillCardView";
import { TeachClaraForm } from "../../../components/clara/TeachClaraForm";
import type { SkillCard } from "../../../../lib/agency-runs/skills/skillCard";
import { GATE_NAMES } from "../../../../lib/agency-runs/skills/skillCard";
import { PASSPORT_CATALOG } from "../../../../lib/agency-runs/teach/passportCatalog";
import type { TeachSessionView } from "../../../../lib/agency-runs/teach/teachSessions";
import type { TeachGate, TeachQuestion } from "../../../../lib/agency-runs/teach/teachSession";

const L = (en: string, es: string, lang: Lang) => (lang === "es" ? es : en);
const GATES: TeachGate[] = ["login", "mfa", "captcha", "certification", "signature", "payment", "submit", "upload", "identity"];

type Preview = { session: TeachSessionView; card: SkillCard; blockers: string[]; errors: { path: string; message: string }[] };
type Msg = string | { en: string; es: string } | undefined;

function msgText(m: Msg, lang: Lang, fallback: string): string {
  if (!m) return fallback;
  return typeof m === "string" ? m : L(m.en, m.es, lang);
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json" }, cache: "no-store" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error("request failed"), { body });
  return body as T;
}

const btn = "rounded-full px-3.5 py-1.5 text-[14px] font-semibold transition disabled:opacity-50";
const primary = `${btn} bg-[#fbf8f2] text-[#161616] hover:bg-white`;
const ghost = `${btn} border border-white/15 text-[#e8e1d0] hover:bg-white/10`;

function YesNoNotSure(props: { lang: Lang; onAnswer: (v: "yes" | "no" | "not_sure") => void; disabled?: boolean }) {
  const { lang } = props;
  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" className={primary} disabled={props.disabled} onClick={() => props.onAnswer("yes")}>{L("Yes", "Sí", lang)}</button>
      <button type="button" className={ghost} disabled={props.disabled} onClick={() => props.onAnswer("no")}>No</button>
      <button type="button" className={ghost} disabled={props.disabled} onClick={() => props.onAnswer("not_sure")}>{L("Not Sure", "No estoy seguro", lang)}</button>
    </div>
  );
}

function FieldPicker(props: { lang: Lang; branchableFirst?: boolean; onPick: (path: string) => void; onAsk?: () => void; disabled?: boolean }) {
  const { lang } = props;
  const [path, setPath] = useState("");
  const entries = useMemo(
    () => (props.branchableFirst ? [...PASSPORT_CATALOG].sort((a, b) => Number(!!b.branchable) - Number(!!a.branchable)) : PASSPORT_CATALOG),
    [props.branchableFirst]
  );
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={path}
        onChange={(e) => setPath(e.target.value)}
        className="min-w-0 max-w-full rounded-xl border border-white/15 bg-[#1f1f1f] px-3 py-1.5 text-[14px] text-[#f4efe2]"
        aria-label={L("Which of the business's details?", "¿Cuál dato del negocio?", lang)}
      >
        <option value="">{L("Choose one of the business's details…", "Escoge un dato del negocio…", lang)}</option>
        {entries.map((e) => (
          <option key={e.path} value={e.path}>{L(e.en, e.es, lang)}</option>
        ))}
      </select>
      <button type="button" className={primary} disabled={!path || props.disabled} onClick={() => props.onPick(path)}>
        {L("Use this", "Usar este", lang)}
      </button>
      {props.onAsk && (
        <button type="button" className={ghost} disabled={props.disabled} onClick={props.onAsk}>
          {L("Ask me each time", "Pregúntame cada vez", lang)}
        </button>
      )}
    </div>
  );
}

function QuestionCard(props: { q: TeachQuestion; lang: Lang; busy: boolean; answer: (questionId: string, answer: unknown) => void }) {
  const { q, lang, busy, answer } = props;
  const [correcting, setCorrecting] = useState(false);
  const [equals, setEquals] = useState("");
  const card = "rounded-2xl border border-white/10 bg-white/[0.05] p-4 space-y-3";

  if (q.kind === "mapping") {
    const p = q.proposal;
    return (
      <div className={card}>
        <p className="text-[12px] font-bold uppercase tracking-[0.12em] text-[#9a917f]">&ldquo;{q.label}&rdquo;</p>
        {p && !correcting ? (
          <>
            <p className="text-[15px] text-[#f4efe2]">
              {p.confidence === "high"
                ? L(`This looks like "${p.en}" from the business's info. Remember it that way?`, `Esto parece "${p.es}" de la información del negocio. ¿Lo recuerdo así?`, lang)
                : L(`Could this be "${p.en}" from the business's info?`, `¿Será "${p.es}" de la información del negocio?`, lang)}
            </p>
            <YesNoNotSure
              lang={lang}
              disabled={busy}
              onAnswer={(v) => {
                if (v === "yes") answer(q.id, { kind: "mapping", choice: "confirm" });
                else if (v === "no") setCorrecting(true);
                else answer(q.id, { kind: "mapping", choice: "ask" });
              }}
            />
          </>
        ) : (
          <>
            <p className="text-[15px] text-[#f4efe2]">
              {L("Which of the business's details goes here?", "¿Cuál dato del negocio va aquí?", lang)}
            </p>
            <FieldPicker
              lang={lang}
              disabled={busy}
              onPick={(path) => answer(q.id, { kind: "mapping", choice: "correct", path })}
              onAsk={() => answer(q.id, { kind: "mapping", choice: "ask" })}
            />
          </>
        )}
        {q.canAlwaysChoose && (
          <button type="button" className="text-[13px] font-semibold text-[#9fd3b4] underline-offset-2 hover:underline" disabled={busy} onClick={() => answer(q.id, { kind: "mapping", choice: "always" })}>
            {L(`It's always "${q.optionText}" — pick that every time`, `Siempre es "${q.optionText}" — escógelo cada vez`, lang)}
          </button>
        )}
      </div>
    );
  }

  if (q.kind === "always_choose") {
    return (
      <div className={card}>
        <p className="text-[15px] text-[#f4efe2]">
          {L(`You picked "${q.optionText || q.label}". Should I always choose this?`, `Escogiste "${q.optionText || q.label}". ¿Lo escojo siempre?`, lang)}
        </p>
        <YesNoNotSure lang={lang} disabled={busy} onAnswer={(v) => answer(q.id, { kind: "yes_no", value: v })} />
      </div>
    );
  }

  if (q.kind === "gate") {
    return (
      <div className={`${card} border-amber-300/30`}>
        <p className="flex items-center gap-2 text-[15px] text-amber-100">
          <Hand className="h-4 w-4 shrink-0" />
          {L(q.reason.en, q.reason.es, lang)}
        </p>
        <p className="text-[14px] text-[#e8e1d0]">
          {L("This part is always yours — Clara stops here and hands it to you. Right?", "Esta parte siempre te toca a ti — Clara se detiene aquí y te la pasa. ¿Correcto?", lang)}
        </p>
        <YesNoNotSure lang={lang} disabled={busy} onAnswer={(v) => answer(q.id, { kind: "yes_no", value: v })} />
      </div>
    );
  }

  return (
    <div className={card}>
      <p className="flex items-center gap-2 text-[15px] text-[#f4efe2]">
        <Split className="h-4 w-4 shrink-0" />
        {L(`"${q.title}" only shows up sometimes. What decides it?`, `"${q.title}" solo aparece a veces. ¿De qué depende?`, lang)}
      </p>
      <input
        value={equals}
        onChange={(e) => setEquals(e.target.value)}
        placeholder={L("When it is… (optional, e.g. Yes or llc)", "Cuando es… (opcional, p. ej. Sí o llc)", lang)}
        className="w-full rounded-xl border border-white/15 bg-[#1f1f1f] px-3 py-1.5 text-[14px] text-[#f4efe2]"
      />
      <FieldPicker
        lang={lang}
        branchableFirst
        disabled={busy}
        onPick={(path) => {
          const raw = equals.trim();
          const v = /^(yes|s[ií]|true)$/i.test(raw) ? true : /^(no|false)$/i.test(raw) ? false : raw || undefined;
          answer(q.id, { kind: "branch", path, ...(v === undefined ? {} : { equals: v }) });
        }}
      />
      <button type="button" className={ghost} disabled={busy} onClick={() => answer(q.id, { kind: "branch", notSure: true })}>
        {L("Not Sure", "No estoy seguro", lang)}
      </button>
    </div>
  );
}

export default function TeachPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: businessId } = use(params);
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#161616]" />}>
      <TeachFlow businessId={businessId} />
    </Suspense>
  );
}

function TeachFlow({ businessId }: { businessId: string }) {
  const lang = useLang();
  const search = useSearchParams();
  const [startUrl, setStartUrl] = useState(() => search.get("url") ?? "");
  const [form, setForm] = useState(() => search.get("form") ?? "");
  const [portal, setPortal] = useState(() => search.get("portal") ?? "");
  const [session, setSession] = useState<TeachSessionView | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [saved, setSaved] = useState<{ id: string; scope: string; status: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addTitle, setAddTitle] = useState("");
  const [addGate, setAddGate] = useState<TeachGate | "">("");
  const [isAdmin, setIsAdmin] = useState(false);
  // Record-first (Darius, 2026-09-30): recording the filing live leads;
  // typed steps are the secondary way (and the fallback when the live
  // recorder — the self-hosted browser worker — isn't connected).
  const [mode, setMode] = useState<"describe" | "live">(() => (search.get("mode") === "describe" ? "describe" : "live"));
  const [liveAvailable, setLiveAvailable] = useState<boolean | null>(null);
  const requirementKey = search.get("requirement") || form || "filing";

  useEffect(() => {
    fetch("/api/me", { cache: "no-store" }).then((r) => r.json()).then((me) => setIsAdmin(Boolean(me?.user?.isAdmin))).catch(() => undefined);
    fetch("/api/clara-playbooks", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => setLiveAvailable(Boolean(b?.live_recorder)))
      .catch(() => setLiveAvailable(false));
  }, []);

  const fail = useCallback(
    (err: unknown) => {
      const body = (err as { body?: { message?: Msg; error?: string } }).body;
      setError(msgText(body?.message, lang, L("Something went wrong. Try again.", "Algo falló. Intenta otra vez.", lang)));
    },
    [lang]
  );

  // Poll while recording.
  useEffect(() => {
    if (!session || session.status !== "recording") return;
    const handle = window.setInterval(async () => {
      try {
        const { session: next } = await api<{ session: TeachSessionView }>(`/api/teach-sessions/${session.id}`);
        setSession(next);
      } catch {
        // transient; next tick retries
      }
    }, 1500);
    return () => window.clearInterval(handle);
  }, [session]);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const { session: s } = await api<{ session: TeachSessionView }>("/api/teach-sessions", {
        method: "POST",
        body: JSON.stringify({ start_url: startUrl, form, portal_name: portal, business_id: businessId, requirement_key: search.get("requirement") }),
      });
      setSession(s);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const answer = async (questionId: string, ans: unknown) => {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      const { session: s } = await api<{ session: TeachSessionView }>(`/api/teach-sessions/${session.id}/answer`, {
        method: "POST",
        body: JSON.stringify({ question_id: questionId, answer: ans }),
      });
      setSession(s);
      if (preview) setPreview(await api<Preview>(`/api/teach-sessions/${session.id}/finish`));
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const mark = async (body: Record<string, unknown>) => {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      const { session: s } = await api<{ session: TeachSessionView }>(`/api/teach-sessions/${session.id}/mark`, { method: "POST", body: JSON.stringify(body) });
      setSession(s);
      if (preview) setPreview(await api<Preview>(`/api/teach-sessions/${session.id}/finish`));
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      const p = await api<Preview>(`/api/teach-sessions/${session.id}/finish`, { method: "POST", body: "{}" });
      setSession(p.session);
      setPreview(p);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const save = async (submit: boolean) => {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      const { skill } = await api<{ skill: { id: string; scope: string; status: string } }>(`/api/teach-sessions/${session.id}/save`, {
        method: "POST",
        body: JSON.stringify({ submit }),
      });
      setSaved(skill);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const questions = session?.questions ?? [];
  const current = session?.steps.at(-1) ?? null;

  return (
    <div className="min-h-screen bg-[#161616] text-[#e8e1d0]">
      <main className="mx-auto max-w-7xl space-y-4 px-4 py-4 sm:px-6">
        <header className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2.5">
          <Link href={`/businesses/${encodeURIComponent(businessId)}/agency-run`} className={`${ghost} inline-flex items-center gap-1.5`}>
            <ArrowLeft className="h-3.5 w-3.5" />
            {L("Back to filing", "Volver al trámite", lang)}
          </Link>
          <GraduationCap className="h-5 w-5 text-[#9fd3b4]" />
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-[#9a917f]">
              {isAdmin ? L("Teach Clara · shared library", "Enséñale a Clara · biblioteca compartida", lang) : L("Teach Clara · just for you", "Enséñale a Clara · solo para ti", lang)}
            </p>
            <h1 className="truncate font-[family-name:var(--font-display)] text-[18px] text-[#f4efe2]">
              {session ? `${session.portal_name} — ${session.form}` : L("Teach Clara a filing once", "Enséñale a Clara un trámite una vez", lang)}
            </h1>
          </div>
        </header>

        {error && <p role="alert" className="rounded-2xl border border-rose-300/40 bg-rose-500/10 px-4 py-3 text-[14px] text-rose-100">{error}</p>}

        {!session && (
          <div className="mx-auto flex max-w-2xl gap-1 rounded-full bg-black/30 p-1" role="tablist" aria-label={L("How to teach Clara", "Cómo enseñarle a Clara", lang)}>
            {([
              ["live", L("Record it", "Grabarlo", lang)],
              ["describe", L("Type the steps", "Escribir los pasos", lang)],
            ] as const).map(([m, label]) => (
              <button key={m} type="button" role="tab" aria-selected={mode === m} data-testid={`teach-mode-${m}`} onClick={() => setMode(m)}
                className={`flex-1 rounded-full px-3 py-1.5 text-[15px] font-semibold transition ${mode === m ? "bg-[#fbf8f2] text-[#161616]" : "text-[#cfc6b4] hover:text-white"}`}>
                {label}
              </button>
            ))}
          </div>
        )}

        {!session && mode === "describe" && (
          <section className="mx-auto max-w-2xl rounded-2xl border border-white/10 bg-white/[0.04] p-5">
            <TeachClaraForm
              target={{ requirementKey, requirementName: form || L("This filing", "Este trámite", lang), agency: portal || null, portalUrl: startUrl || null }}
              language={lang}
              tone="dark"
            />
          </section>
        )}

        {!session && mode === "live" && liveAvailable === false && (
          <p className="mx-auto max-w-2xl rounded-2xl border border-amber-300/30 bg-amber-500/10 px-4 py-3 text-[15px] text-amber-100" data-testid="teach-live-unavailable">
            {L(
              "Live walkthroughs need Clara's browser, which isn't connected on this server yet. Describe the steps instead — Clara uses them the same way.",
              "El recorrido en vivo necesita el navegador de Clara, que todavía no está conectado en este servidor. Describe los pasos — Clara los usa igual.",
              lang
            )}
          </p>
        )}

        {!session && mode === "live" && (
          <section className="mx-auto max-w-2xl space-y-4 rounded-2xl border border-white/10 bg-white/[0.04] p-5">
            <p className="text-[15px] leading-relaxed text-[#e8e1d0]">
              {L(
                "Do the filing once, the way you normally would. Clara watches which screens come up and where each answer goes, and asks you a few quick questions along the way. Next time, she fills it in from the business's info and stops wherever you're needed.",
                "Haz el trámite una vez, como siempre lo haces. Clara se fija en qué pantallas salen y dónde va cada respuesta, y te hace unas preguntas rápidas en el camino. La próxima vez, ella lo llena con la información del negocio y se detiene donde te necesite.",
                lang
              )}
            </p>
            <ul className="space-y-1 text-[14px] text-[#cfc6b4]">
              <li>• {L("You sign in yourself. Clara never sees your password.", "Tú entras a tu cuenta. Clara nunca ve tu contraseña.", lang)}</li>
              <li>• {L("Clara remembers where things go — never what you typed.", "Clara recuerda dónde va cada cosa — nunca lo que escribiste.", lang)}</li>
              <li>• {L("Payment, signatures and the final submit always stay with you.", "El pago, las firmas y el envío final siempre te tocan a ti.", lang)}</li>
            </ul>
            <label className="block space-y-1">
              <span className="text-[13px] font-semibold text-[#b9b0a0]">{L("Agency website", "Página de la agencia", lang)}</span>
              <input value={startUrl} onChange={(e) => setStartUrl(e.target.value)} placeholder="https://…pr.gov" className="w-full rounded-xl border border-white/15 bg-[#1f1f1f] px-3 py-2 text-[15px] text-[#f4efe2]" />
            </label>
            <label className="block space-y-1">
              <span className="text-[13px] font-semibold text-[#b9b0a0]">{L("Which form?", "¿Qué formulario?", lang)}</span>
              <input value={form} onChange={(e) => setForm(e.target.value)} placeholder={L("e.g. Patente Municipal", "p. ej. Patente Municipal", lang)} className="w-full rounded-xl border border-white/15 bg-[#1f1f1f] px-3 py-2 text-[15px] text-[#f4efe2]" />
            </label>
            <label className="block space-y-1">
              <span className="text-[13px] font-semibold text-[#b9b0a0]">{L("Agency or portal name (optional)", "Nombre de la agencia o portal (opcional)", lang)}</span>
              <input value={portal} onChange={(e) => setPortal(e.target.value)} className="w-full rounded-xl border border-white/15 bg-[#1f1f1f] px-3 py-2 text-[15px] text-[#f4efe2]" />
            </label>
            <button type="button" className={primary} disabled={busy || !startUrl.trim() || !form.trim() || liveAvailable === false} onClick={start}>
              {busy ? <Loader2 className="inline h-4 w-4 animate-spin" /> : L("Open the site and start", "Abrir la página y empezar", lang)}
            </button>
          </section>
        )}

        {session && !preview && (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
            <section className="h-[72vh] overflow-hidden rounded-2xl border border-white/10 bg-black lg:sticky lg:top-4">
              {session.live_url ? (
                <iframe title={L("Your browser", "Tu navegador", lang)} src={session.live_url} className="h-full w-full" allow="clipboard-read; clipboard-write" />
              ) : (
                <p className="p-6 text-[14px] text-[#b9b0a0]">{L("Opening the site…", "Abriendo la página…", lang)}</p>
              )}
            </section>
            <aside className="space-y-3">
              <p className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-[14px] text-[#cfc6b4]">
                {L(
                  "Go ahead and file in the window. Sign in yourself when the site asks. Answer Clara's questions here whenever you like.",
                  "Adelante, haz el trámite en la ventana. Entra tú a la cuenta cuando la página lo pida. Contesta las preguntas de Clara aquí cuando quieras.",
                  lang
                )}
              </p>
              {questions.map((q) => (
                <QuestionCard key={q.id} q={q} lang={lang} busy={busy} answer={answer} />
              ))}

              <div className="space-y-2 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <p className="text-[13px] font-bold uppercase tracking-[0.12em] text-[#9a917f]">{L("Screens so far", "Pantallas hasta ahora", lang)}</p>
                <ol className="space-y-2">
                  {session.steps.map((s) => (
                    <li key={s.id} className="space-y-1 text-[14px]">
                      <p className="text-[#f4efe2]">
                        {s.title}
                        {s.gate && <span className="ml-2 rounded-full border border-amber-300/40 px-2 py-0.5 text-[11px] font-bold text-amber-200">{L(GATE_NAMES[s.gate]?.en ?? s.gate, GATE_NAMES[s.gate]?.es ?? s.gate, lang)}</span>}
                        {s.conditional && <span className="ml-2 text-[11px] font-bold text-sky-200">{L("sometimes", "a veces", lang)}</span>}
                      </p>
                      {s.id === current?.id && (
                        <div className="flex flex-wrap gap-2">
                          <select
                            aria-label={L("This screen is a step only I do", "Esta pantalla es un paso que solo hago yo", lang)}
                            value=""
                            onChange={(e) => e.target.value && mark({ step_id: s.id, gate: e.target.value === "none" ? null : e.target.value })}
                            className="rounded-full border border-white/15 bg-[#1f1f1f] px-2.5 py-1 text-[12px] text-[#e8e1d0]"
                            disabled={busy}
                          >
                            <option value="">{L("Only I do this step…", "Este paso lo hago yo…", lang)}</option>
                            {GATES.map((g) => (
                              <option key={g} value={g}>{L(GATE_NAMES[g].en, GATE_NAMES[g].es, lang)}</option>
                            ))}
                            {s.gate && <option value="none">{L("Clara can do this screen", "Clara puede hacer esta pantalla", lang)}</option>}
                          </select>
                          {!s.conditional && session.steps.length > 1 && (
                            <button type="button" className={`${ghost} !px-2.5 !py-1 !text-[12px]`} disabled={busy} onClick={() => mark({ step_id: s.id, conditional: true })}>
                              {L("Only shows up sometimes", "Solo aparece a veces", lang)}
                            </button>
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              </div>

              <div className="space-y-2 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <p className="text-[13px] text-[#cfc6b4]">{L("Skipped a screen (like payment)? Add it so Clara knows it's there.", "¿Te saltaste una pantalla (como el pago)? Añádela para que Clara sepa que está ahí.", lang)}</p>
                <input value={addTitle} onChange={(e) => setAddTitle(e.target.value)} placeholder={L("Screen name", "Nombre de la pantalla", lang)} className="w-full rounded-xl border border-white/15 bg-[#1f1f1f] px-3 py-1.5 text-[14px] text-[#f4efe2]" />
                <div className="flex gap-2">
                  <select value={addGate} onChange={(e) => setAddGate(e.target.value as TeachGate | "")} className="min-w-0 flex-1 rounded-xl border border-white/15 bg-[#1f1f1f] px-2 py-1.5 text-[13px] text-[#e8e1d0]">
                    <option value="">{L("Clara can do it", "Clara la puede hacer", lang)}</option>
                    {GATES.map((g) => (
                      <option key={g} value={g}>{L(`Only I do it: ${GATE_NAMES[g].en}`, `La hago yo: ${GATE_NAMES[g].es}`, lang)}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className={`${ghost} inline-flex items-center gap-1`}
                    disabled={busy || !addTitle.trim()}
                    onClick={async () => {
                      await mark({ add_step: { title: addTitle, gate: addGate || null } });
                      setAddTitle("");
                      setAddGate("");
                    }}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {L("Add", "Añadir", lang)}
                  </button>
                </div>
              </div>

              <button type="button" className={`${primary} w-full`} disabled={busy || session.steps.length === 0} onClick={finish}>
                {L("I'm done — show me what Clara learned", "Terminé — enséñame lo que Clara aprendió", lang)}
              </button>
            </aside>
          </div>
        )}

        {preview && !saved && (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
            <SkillCardView card={preview.card} lang={lang} />
            <aside className="space-y-3">
              {questions.length > 0 && (
                <p className="text-[14px] font-semibold text-amber-100">{L("A few answers are still missing:", "Todavía faltan unas respuestas:", lang)}</p>
              )}
              {questions.map((q) => (
                <QuestionCard key={q.id} q={q} lang={lang} busy={busy} answer={answer} />
              ))}
              {preview.errors.length > 0 && (
                <p className="rounded-2xl border border-rose-300/40 bg-rose-500/10 px-4 py-3 text-[14px] text-rose-100">
                  {L("Clara can't save this yet — part of it isn't safe to repeat. Mark the steps only you do and try again.", "Clara todavía no puede guardar esto — una parte no es segura para repetir. Marca los pasos que solo haces tú y vuelve a intentar.", lang)}
                </p>
              )}
              <div className="space-y-2 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                {isAdmin ? (
                  <button type="button" className={`${primary} w-full`} disabled={busy || preview.blockers.length > 0 || preview.errors.length > 0} onClick={() => save(false)}>
                    {L("Save to the shared library (draft)", "Guardar en la biblioteca compartida (borrador)", lang)}
                  </button>
                ) : (
                  <>
                    <button type="button" className={`${primary} w-full`} disabled={busy || preview.blockers.length > 0 || preview.errors.length > 0} onClick={() => save(false)}>
                      {L("Save it for me", "Guardarlo para mí", lang)}
                    </button>
                    <button type="button" className={`${ghost} w-full`} disabled={busy || preview.blockers.length > 0 || preview.errors.length > 0} onClick={() => save(true)}>
                      {L("Save and send to SmartPR for review", "Guardar y enviarlo a SmartPR para revisión", lang)}
                    </button>
                    <p className="text-[12px] text-[#b9b0a0]">
                      {L("Only you can use it until SmartPR reviews it. Once sent, it can't be edited.", "Solo tú lo puedes usar hasta que SmartPR lo revise. Una vez enviado, no se puede editar.", lang)}
                    </p>
                  </>
                )}
              </div>
            </aside>
          </div>
        )}

        {saved && (
          <section className="mx-auto max-w-xl space-y-3 rounded-2xl border border-[#2f6b4f] bg-[#1e4d38]/30 p-5 text-center">
            <p className="font-[family-name:var(--font-display)] text-[20px] text-[#f4efe2]">{L("Clara learned it.", "Clara se lo aprendió.", lang)}</p>
            <p className="text-[14px] text-[#e8e1d0]">
              {saved.scope === "shared"
                ? L("It's saved as a draft in the shared library.", "Está guardado como borrador en la biblioteca compartida.", lang)
                : saved.status === "in_review"
                  ? L("It's saved for you and sent to SmartPR for review.", "Está guardado para ti y enviado a SmartPR para revisión.", lang)
                  : L("It's saved just for you.", "Está guardado solo para ti.", lang)}
            </p>
            <Link href={`/businesses/${encodeURIComponent(businessId)}/agency-run`} className={`${primary} inline-block`}>
              {L("Back to filing", "Volver al trámite", lang)}
            </Link>
          </section>
        )}
      </main>
    </div>
  );
}
