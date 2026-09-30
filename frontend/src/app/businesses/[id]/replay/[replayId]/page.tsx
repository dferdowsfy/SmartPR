"use client";

/**
 * Replay a learned filing (Teach Clara spec §6): preflight plan → the
 * person confirms → Clara fills from the business's info in the person's
 * own browser session, pausing wherever they're needed → the person
 * reviews and submits. Milestones only, never a play-by-play, never values.
 */
import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2, Hand, HelpCircle, Loader2, TriangleAlert } from "lucide-react";
import { useLang } from "../../../../useLang";
import type { Lang } from "../../../../forms/engine/types";
import type { ReplayView } from "../../../../../lib/agency-runs/replay/replaySessions";

const L = (en: string, es: string, lang: Lang) => (lang === "es" ? es : en);
const btn = "rounded-full px-3.5 py-1.5 text-[14px] font-semibold transition disabled:opacity-50";
const primary = `${btn} bg-[#fbf8f2] text-[#161616] hover:bg-white`;
const ghost = `${btn} border border-white/15 text-[#e8e1d0] hover:bg-white/10`;

async function api(url: string, body?: unknown): Promise<ReplayView> {
  const res = await fetch(url, body === undefined ? { cache: "no-store" } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error("failed"), { body: json });
  return json.replay as ReplayView;
}

const ATTRIBUTION = {
  smartpr: { en: "Taught by the SmartPR team", es: "Enseñado por el equipo de SmartPR" },
  partner: { en: "Taught by a SmartPR partner, reviewed by SmartPR", es: "Enseñado por un profesional y revisado por SmartPR" },
  you: { en: "Taught by you", es: "Enseñado por ti" },
};

export default function ReplayPage({ params }: { params: Promise<{ id: string; replayId: string }> }) {
  const { id: businessId, replayId } = use(params);
  const lang = useLang();
  const [replay, setReplay] = useState<ReplayView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  useEffect(() => {
    api(`/api/replays/${replayId}`).then(setReplay).catch(() => setError(L("This replay isn't available.", "Esta gestión no está disponible.", lang)));
  }, [replayId, lang]);

  const act = useCallback(
    async (path: string, body: unknown = {}) => {
      setBusy(true);
      setError(null);
      try {
        setReplay(await api(`/api/replays/${replayId}/${path}`, body));
        setAnswers({});
      } catch (err) {
        const m = (err as { body?: { message?: string } }).body?.message;
        setError(m ?? L("Something went wrong. Try again.", "Algo falló. Intenta otra vez.", lang));
      } finally {
        setBusy(false);
      }
    },
    [replayId, lang]
  );

  if (!replay) {
    return <div className="min-h-screen bg-[#161616] p-6 text-[#e8e1d0]">{error ?? <Loader2 className="h-5 w-5 animate-spin" />}</div>;
  }
  const { plan, pause } = replay;
  const back = `/businesses/${encodeURIComponent(businessId)}/agency-run`;

  return (
    <div className="min-h-screen bg-[#161616] text-[#e8e1d0]">
      <main className="mx-auto max-w-7xl space-y-4 px-4 py-4 sm:px-6">
        <header className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2.5">
          <Link href={back} className={`${ghost} inline-flex items-center gap-1.5`}>
            <ArrowLeft className="h-3.5 w-3.5" />
            {L("Back to filing", "Volver al trámite", lang)}
          </Link>
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-[#9a917f]">{L(ATTRIBUTION[replay.skill.attribution].en, ATTRIBUTION[replay.skill.attribution].es, lang)}</p>
            <h1 className="truncate font-[family-name:var(--font-display)] text-[18px] text-[#f4efe2]">{replay.skill.portal} — {replay.skill.form}</h1>
          </div>
        </header>

        {error && <p role="alert" className="rounded-2xl border border-rose-300/40 bg-rose-500/10 px-4 py-3 text-[14px] text-rose-100">{error}</p>}

        {replay.status === "planned" && (
          <section className="mx-auto max-w-2xl space-y-4 rounded-2xl border border-white/10 bg-white/[0.04] p-5">
            <h2 className="font-[family-name:var(--font-display)] text-[20px] text-[#f4efe2]">{L("Clara already knows this form", "Clara ya conoce este formulario", lang)}</h2>
            <p className="text-[15px]">{L(plan.summary.en, plan.summary.es, lang)}</p>
            {plan.health.status !== "ok" && (
              <p className="flex gap-2 rounded-xl border border-amber-300/40 bg-amber-50/[0.05] p-3 text-[14px] text-amber-100">
                <TriangleAlert className="h-4 w-4 shrink-0" />
                {L("The agency's site changed recently. Clara will stop at the first thing that looks different.", "La página de la agencia cambió hace poco. Clara se va a detener en lo primero que se vea distinto.", lang)}
              </p>
            )}
            {plan.fromPassport.length > 0 && (
              <details className="text-[14px]">
                <summary className="cursor-pointer font-semibold">{L(`From the business's info (${plan.fromPassport.length})`, `De la información del negocio (${plan.fromPassport.length})`, lang)}</summary>
                <ul className="mt-2 space-y-1">
                  {plan.fromPassport.map((f, i) => (
                    <li key={i} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#9fd3b4]" />{f.field} <span className="text-[#b9b0a0]">← {L(f.source.en, f.source.es, lang)}</span></li>
                  ))}
                </ul>
              </details>
            )}
            {plan.askEachTime.length + plan.missingRequired.length > 0 && (
              <p className="flex gap-2 text-[14px]"><HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-sky-300" />
                {L("I'll ask you: ", "Te voy a preguntar: ", lang)}
                {[...plan.askEachTime, ...plan.missingRequired].map((f) => f.field).join(", ")}
              </p>
            )}
            {plan.branches.filter((b) => b.applies).length > 0 && (
              <p className="text-[14px] text-[#cfc6b4]">{L("Also applies to this business: ", "También aplica a este negocio: ", lang)}{plan.branches.filter((b) => b.applies).map((b) => b.screen).join(", ")}</p>
            )}
            <p className="flex gap-2 text-[14px] text-amber-100"><Hand className="mt-0.5 h-4 w-4 shrink-0" />
              {L("You'll do: ", "Te toca: ", lang)}{[...new Map(plan.humanSteps.map((h) => [h.gate, L(h.name.en, h.name.es, lang)])).values()].join(" · ")}
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={primary} disabled={busy} onClick={() => act("start")}>{busy ? <Loader2 className="inline h-4 w-4 animate-spin" /> : L("Looks right — start", "Se ve bien — empezar", lang)}</button>
              <Link href={back} className={ghost}>{L("Not now", "Ahora no", lang)}</Link>
            </div>
          </section>
        )}

        {replay.status !== "planned" && (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
            <section className="h-[72vh] overflow-hidden rounded-2xl border border-white/10 bg-black lg:sticky lg:top-4">
              {replay.live_url ? <iframe title={L("Your browser", "Tu navegador", lang)} src={replay.live_url} className="h-full w-full" /> : <p className="p-6 text-[14px] text-[#b9b0a0]">{L("The browser is closed.", "El navegador está cerrado.", lang)}</p>}
            </section>
            <aside className="space-y-3">
              {pause && (
                <div className={`space-y-3 rounded-2xl border p-4 ${pause.kind === "drift" || pause.kind === "portal_error" ? "border-rose-300/40 bg-rose-500/10" : "border-amber-300/30 bg-white/[0.05]"}`}>
                  {pause.kind === "gate" && (
                    <>
                      <p className="flex gap-2 text-[15px] text-amber-100"><Hand className="mt-0.5 h-4 w-4 shrink-0" />{L(pause.handoff.en, pause.handoff.es, lang)}</p>
                      {pause.gate === "submit" && <p className="text-[14px]">{L("Clara never submits. Check every screen in the browser, then press the portal's submit button yourself.", "Clara nunca envía. Revisa cada pantalla en el navegador y dale tú al botón de enviar del portal.", lang)}</p>}
                      <button type="button" className={primary} disabled={busy} onClick={() => act("continue")}>{L("Done — continue", "Listo — seguir", lang)}</button>
                    </>
                  )}
                  {pause.kind === "navigate" && (
                    <>
                      <p className="text-[15px]">{L(pause.handoff.en, pause.handoff.es, lang)}</p>
                      <button type="button" className={primary} disabled={busy} onClick={() => act("continue")}>{L("Done — continue", "Listo — seguir", lang)}</button>
                    </>
                  )}
                  {pause.kind === "ask" && (
                    <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); act("continue", { answers }); }}>
                      {pause.fields.map((f) => (
                        <label key={f.key} className="block space-y-1">
                          <span className="text-[14px] text-[#f4efe2]">{L(f.ask.en, f.ask.es, lang)}</span>
                          <input value={answers[f.key] ?? ""} onChange={(e) => setAnswers((a) => ({ ...a, [f.key]: e.target.value }))} required={f.required} className="w-full rounded-xl border border-white/15 bg-[#1f1f1f] px-3 py-1.5 text-[14px] text-[#f4efe2]" />
                        </label>
                      ))}
                      <button type="submit" className={primary} disabled={busy}>{L("Fill it in", "Llénalo", lang)}</button>
                    </form>
                  )}
                  {pause.kind === "option_missing" && (
                    <>
                      <p className="text-[15px]">{L(`"${pause.field}" doesn't list the business's answer. Pick it yourself in the browser.`, `"${pause.field}" no tiene la respuesta del negocio. Escógela tú en el navegador.`, lang)}</p>
                      <button type="button" className={primary} disabled={busy} onClick={() => act("continue")}>{L("Done — continue", "Listo — seguir", lang)}</button>
                    </>
                  )}
                  {(pause.kind === "drift" || pause.kind === "portal_error") && (
                    <>
                      <p className="flex gap-2 text-[15px] text-rose-100"><TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                        {pause.kind === "drift"
                          ? L("The site looks different from what I learned, so I stopped without touching anything.", "La página se ve distinta a lo que aprendí, así que me detuve sin tocar nada.", lang)
                          : L("The portal didn't move on from that screen.", "El portal no pasó de esa pantalla.", lang)}
                      </p>
                      {pause.kind === "drift" && <p className="text-[13px] text-[#e8e1d0]">{L("I'm on: ", "Estoy en: ", lang)}&ldquo;{pause.seen.heading || pause.seen.title}&rdquo;. {L("I expected: ", "Esperaba: ", lang)}&ldquo;{pause.expected}&rdquo; {pause.detail}</p>}
                      {pause.kind === "portal_error" && pause.errors.length > 0 && <ul className="list-disc pl-5 text-[13px]">{pause.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
                      <p className="text-[13px] text-[#cfc6b4]">{L("You can finish in the browser yourself, or fix it and tell me to continue.", "Puedes terminar tú en el navegador, o arreglarlo y me dices para seguir.", lang)}</p>
                      <div className="flex gap-2">
                        <button type="button" className={primary} disabled={busy} onClick={() => act("continue")}>{L("Try again", "Intentar de nuevo", lang)}</button>
                        <button type="button" className={ghost} disabled={busy} onClick={() => act("stop")}>{L("I'll finish it", "Lo termino yo", lang)}</button>
                      </div>
                    </>
                  )}
                </div>
              )}
              {replay.status === "done" && <p className="rounded-2xl border border-[#2f6b4f] bg-[#1e4d38]/30 p-4 text-[15px]">{L("All done. You submitted it yourself — keep the confirmation number from the portal.", "Listo. Tú lo enviaste — guarda el número de confirmación del portal.", lang)}</p>}
              <ol className="space-y-1.5 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-[14px]">
                {replay.milestones.map((m, i) => <li key={i} className="text-[#e8e1d0]">• {L(m.text.en, m.text.es, lang)}</li>)}
              </ol>
              {replay.status !== "done" && replay.status !== "stopped" && (
                <button type="button" className={`${ghost} w-full`} disabled={busy} onClick={() => act("stop")}>{L("Stop — I'll take it from here", "Parar — sigo yo", lang)}</button>
              )}
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}
