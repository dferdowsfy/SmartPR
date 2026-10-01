"use client";

/**
 * Fill with Clara — chat-first strict replay of a routine Clara learned.
 * Clara finds the saved routine for this requirement, shows a preflight
 * summary (what comes from THIS business's Passport, what's missing, what
 * she'll ask, where the person is needed), then replays exactly the
 * recorded steps in the live browser (secondary panel). Pauses show up in
 * the chat: answers, a masked one-time input for passwords / SSNs / codes,
 * the human-only steps, portal drift (she stops) and the final review —
 * Clara never submits.
 *
 * Same server contract as the replay page (/api/replays …).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, GraduationCap, Hand, HelpCircle, Loader2, Play, TriangleAlert } from "lucide-react";
import type { Lang } from "../../../forms/engine/types";
import { routineForRow, type LearnedRoutineSummary } from "../../../../lib/agency-runs/teach/learnedRoutineMatch";
import { looksSensitiveLabel, pauseNeedsBrowser, replayPauseHeadline, secureCardFor, type ReplayPauseView, type SecretFieldView } from "../../../../lib/agency-runs/teach/workspaceChat";
import { claraWorkspaceHref, type ClaraWorkspaceContext } from "../../../components/clara/claraWorkspaceLink";
import { ClaraBubble, L, SecureInputCard, UnavailableCard, UserBubble, api, errText, ghostBtn, pick, primaryBtn, type Bi } from "./workspaceParts";
import type { RecorderStatus } from "./TeachChat";

interface PlanView {
  fromPassport: { step: string; field: string; source: Bi }[];
  askEachTime: { step: string; field: string }[];
  missingRequired: { step: string; field: string; source: Bi }[];
  branches: { screen: string; applies: boolean }[];
  humanSteps: { step: string; gate: string; name: Bi }[];
  health: { status: string; detail: string | null };
  summary: Bi;
}
interface ReplayView {
  id: string;
  status: "planned" | "running" | "paused" | "review" | "done" | "stopped";
  skill: { ref: string; form: string; portal: string; base_url: string; version: number; attribution: string };
  plan: PlanView;
  pause: ReplayPauseView | null;
  milestones: { at: string; stepId: string | null; text: Bi }[];
  live_url: string | null;
  secret_fields: SecretFieldView[];
}

type Phase = "loading" | "sign_in" | "no_business" | "no_routine" | "needs_reteach" | "unavailable" | "planning" | "plan" | "starting" | "replay" | "error";

export function FillChat({
  lang,
  ctx,
  businessId,
  businessName,
  signedIn,
  recorder,
  routines,
  onRecheck,
  onLiveUrl,
  onShowBrowser,
}: {
  lang: Lang;
  ctx: ClaraWorkspaceContext;
  businessId: string | null;
  businessName: string | null;
  signedIn: boolean | null;
  recorder: RecorderStatus | null;
  routines: LearnedRoutineSummary[] | null;
  onRecheck: () => void;
  onLiveUrl: (url: string | null) => void;
  onShowBrowser: () => void;
}) {
  const T = (en: string, es: string) => L(en, es, lang);
  const [stage, setPhase] = useState<Phase>("loading");
  const [replay, setReplay] = useState<ReplayView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [echo, setEcho] = useState<{ at: number; text: string }[]>([]);
  const answersRef = useRef<HTMLFormElement>(null);
  const planned = useRef(false);
  const endRef = useRef<HTMLDivElement>(null);
  const routine = useMemo(
    () => (routines ? (ctx.routineRef && routines.find((x) => x.ref === ctx.routineRef)) || routineForRow(routines, { key: ctx.requirementKey, portalUrl: ctx.portalUrl, name: ctx.name }) : null),
    [routines, ctx.routineRef, ctx.requirementKey, ctx.portalUrl, ctx.name]
  );
  // Before planning, the phase follows sign-in, the business, the routine and the browser.
  const pre: Phase | null =
    signedIn === null || routines === null ? "loading"
    : !signedIn ? "sign_in"
    : !businessId ? "no_business"
    : !routine ? "no_routine"
    : routine.status === "needs_reteach" ? "needs_reteach"
    : recorder === null ? "loading"
    : !recorder.ok && stage === "loading" ? "unavailable"
    : null;
  const phase: Phase = pre ?? stage;
  const teachHref = claraWorkspaceHref("teach", businessId, { key: ctx.requirementKey, name: ctx.name, agency: ctx.agency, portalUrl: ctx.portalUrl ?? routine?.start_url ?? null });

  const plan = useCallback(
    async (r: LearnedRoutineSummary) => {
      setPhase("planning");
      setError(null);
      const res = await api<{ replay?: ReplayView; error?: string }>("/api/replays", { skill_ref: r.ref, business_id: businessId });
      if (res.ok && res.data.replay) {
        setReplay(res.data.replay);
        return setPhase("plan");
      }
      if (res.data.error === "needs_reteach") return setPhase("needs_reteach");
      setError(errText(res.data, lang, T("I couldn't prepare the plan.", "No pude preparar el plan.")));
      setPhase("error");
    },
    [businessId, lang] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Plan the routine with this business's Passport once everything is in place.
  useEffect(() => {
    if (pre !== null || planned.current || !routine) return;
    planned.current = true;
    void Promise.resolve().then(() => plan(routine));
  }, [pre, routine, plan]);

  const act = async (path: string, body: unknown = {}, said?: string) => {
    if (!replay) return;
    setBusy(true);
    setError(null);
    if (said) setEcho((e) => [...e, { at: replay.milestones.length, text: said }]);
    const r = await api<{ replay?: ReplayView }>(`/api/replays/${encodeURIComponent(replay.id)}/${path}`, body);
    setBusy(false);
    if (r.ok && r.data.replay) {
      setReplay(r.data.replay);
      onLiveUrl(r.data.replay.live_url);
      if (pauseNeedsBrowser(r.data.replay.pause) || r.data.replay.status === "review") onShowBrowser();
      if (path === "start") setPhase("replay");
    } else {
      setError(errText(r.data, lang, T("Something went wrong. Try again.", "Algo falló. Intenta otra vez.")));
      if (path === "start") setPhase("plan");
    }
  };

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [phase, replay?.milestones.length, replay?.pause, error]);

  const p = replay?.plan;
  const pause = replay?.pause ?? null;
  const secure = pause && pause.kind === "gate" && replay ? secureCardFor(pause.gate ?? null, replay.secret_fields ?? []) : null;

  const submitAnswers = () => {
    const form = answersRef.current;
    if (!form || !pause?.fields) return;
    const answers: Record<string, string> = {};
    for (const f of pause.fields) {
      const el = form.elements.namedItem(f.key) as HTMLInputElement | null;
      if (el?.value) answers[f.key] = el.value;
      if (el) el.value = "";
    }
    const shown = pause.fields.filter((f) => answers[f.key]).map((f) => (looksSensitiveLabel(f.label) ? `${f.label}: ••••` : f.label));
    void act("continue", { answers }, T(`Answered: ${shown.join(", ")}`, `Respondí: ${shown.join(", ")}`));
  };

  return (
    <div className="space-y-3" data-testid="ws-fill" data-phase={phase}>
      <ClaraBubble>
        {T(
          `Let's fill “${ctx.name}”${businessName ? ` for ${businessName}` : ""}. I'll follow the routine you taught me, using this business's own Business Passport, and stop wherever you're needed. I never submit.`,
          `Vamos a llenar “${ctx.name}”${businessName ? ` para ${businessName}` : ""}. Sigo la rutina que me enseñaste, con el Pasaporte de este negocio, y me detengo donde me necesites. Nunca envío.`
        )}
      </ClaraBubble>

      {(phase === "loading" || phase === "planning") && (
        <ClaraBubble testId="ws-checking">
          <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
          {phase === "planning" ? T("Reading the routine and this business's Passport…", "Leyendo la rutina y el Pasaporte de este negocio…") : T("Looking for the routine I learned…", "Buscando la rutina que aprendí…")}
        </ClaraBubble>
      )}

      {phase === "sign_in" && (
        <ClaraBubble tone="gate" testId="ws-sign-in">
          {T("Sign in first — your routines are saved to your account.", "Entra a tu cuenta primero — tus rutinas se guardan en tu cuenta.")}{" "}
          <a className="underline" href={`/login?next=${encodeURIComponent(typeof window !== "undefined" ? window.location.pathname + window.location.search : "/")}`}>{T("Sign in", "Entrar")}</a>
        </ClaraBubble>
      )}

      {phase === "no_business" && (
        <ClaraBubble tone="gate" testId="ws-no-business">
          {T("Save this business first — I fill from its Business Passport, and there isn't one yet.", "Guarda este negocio primero — lleno desde su Pasaporte del negocio, y todavía no hay uno.")}
        </ClaraBubble>
      )}

      {phase === "no_routine" && (
        <ClaraBubble tone="gate" testId="ws-no-routine">
          <p>{T("I haven't learned this filing yet. Teach me once and I'll do it for every business after that.", "Todavía no he aprendido este trámite. Enséñamelo una vez y lo hago para cada negocio después.")}</p>
          <a className={`${primaryBtn} mt-2`} href={teachHref} data-testid="ws-teach-instead"><GraduationCap className="h-4 w-4" /> {T("Teach Clara", "Enséñale a Clara")}</a>
        </ClaraBubble>
      )}

      {phase === "needs_reteach" && (
        <ClaraBubble tone="stop" testId="ws-needs-reteach">
          <p>{T("The portal changed since I learned this, so I won't replay the old steps. Walk it with me once more.", "El portal cambió desde que lo aprendí, así que no voy a repetir los pasos viejos. Recórrelo conmigo otra vez.")}</p>
          <a className={`${primaryBtn} mt-2`} href={teachHref} data-testid="ws-reteach"><GraduationCap className="h-4 w-4" /> {T("Re-teach Clara", "Enséñale otra vez")}</a>
        </ClaraBubble>
      )}

      {phase === "unavailable" && recorder && (
        <UnavailableCard lang={lang} reason={recorder.reason} message={pick(recorder.message, lang) || T("My browser isn't available right now.", "Mi navegador no está disponible ahora.")} hint={recorder.operator_hint} onRetry={onRecheck} />
      )}

      {replay && p && (
        <ClaraBubble testId="ws-preflight">
          <p className="font-semibold">
            {T(`Plan for “${routine?.name ?? replay.skill.form}” (version ${replay.skill.version})`, `Plan para “${routine?.name ?? replay.skill.form}” (versión ${replay.skill.version})`)}
          </p>
          <p className="mt-1">{pick(p.summary, lang)}</p>
          {p.health.status !== "ok" && (
            <p className="mt-2 flex gap-2 text-[14px] text-amber-100"><TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />{T("The agency's site changed recently. I'll stop at the first thing that looks different.", "La página de la agencia cambió hace poco. Me detengo en lo primero que se vea distinto.")}</p>
          )}
          {p.fromPassport.length > 0 && (
            <details className="mt-2 text-[14px]" data-testid="ws-preflight-passport">
              <summary className="cursor-pointer font-semibold">{T(`From the Business Passport (${p.fromPassport.length})`, `Del Pasaporte del negocio (${p.fromPassport.length})`)}</summary>
              <ul className="mt-1 space-y-0.5">
                {p.fromPassport.map((f, i) => <li key={i} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#9fd3b4]" />{f.field} <span className="text-[#b9b0a0]">← {pick(f.source, lang)}</span></li>)}
              </ul>
            </details>
          )}
          {p.missingRequired.length > 0 && (
            <div className="mt-2 rounded-lg bg-amber-200/[0.07] p-2 text-[14px]" data-testid="ws-preflight-missing">
              <b>{T("Not in this business's Passport yet — I'll ask you:", "Todavía no está en el Pasaporte de este negocio — te lo pregunto:")}</b>
              <ul className="mt-1 list-disc pl-5">{p.missingRequired.map((f, i) => <li key={i}>{f.field} <span className="text-[#b9b0a0]">({pick(f.source, lang)})</span></li>)}</ul>
            </div>
          )}
          {p.askEachTime.length > 0 && (
            <p className="mt-2 flex gap-2 text-[14px]"><HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-sky-300" />{T("I ask each time: ", "Pregunto cada vez: ")}{p.askEachTime.map((f) => f.field).join(", ")}</p>
          )}
          {p.branches.filter((b) => b.applies).length > 0 && (
            <p className="mt-2 text-[14px] text-[#cfc6b4]">{T("Also applies to this business: ", "También aplica a este negocio: ")}{p.branches.filter((b) => b.applies).map((b) => b.screen).join(", ")}</p>
          )}
          {p.humanSteps.length > 0 && (
            <p className="mt-2 flex gap-2 text-[14px] text-amber-100"><Hand className="mt-0.5 h-4 w-4 shrink-0" />{T("You'll do: ", "Te toca: ")}{[...new Map(p.humanSteps.map((h) => [h.gate, pick(h.name, lang)])).values()].join(" · ")}</p>
          )}
          {replay.status === "planned" && (
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className={primaryBtn} disabled={busy} onClick={() => act("start", {}, T("Looks right — start.", "Se ve bien — empezar."))} data-testid="ws-replay-start">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} {T("Looks right — start", "Se ve bien — empezar")}
              </button>
            </div>
          )}
        </ClaraBubble>
      )}

      {replay && replay.status !== "planned" && (
        <>
          {replay.milestones.map((m, i) => (
            <div key={i} className="space-y-3">
              {echo.filter((e) => e.at === i).map((e, j) => <UserBubble key={j}>{e.text}</UserBubble>)}
              <ClaraBubble testId="ws-milestone">{pick(m.text, lang)}</ClaraBubble>
            </div>
          ))}
          {echo.filter((e) => e.at >= replay.milestones.length).map((e, j) => <UserBubble key={`t${j}`}>{e.text}</UserBubble>)}
        </>
      )}

      {replay && pause && (replay.status === "paused" || replay.status === "review") && (() => {
        const h = replayPauseHeadline(pause);
        return (
          <ClaraBubble tone={h.tone} testId={pause.kind === "gate" && pause.gate === "submit" ? "ws-review-gate" : "ws-pause"}>
            <div data-kind={pause.kind} data-gate={pause.gate ?? ""} data-testid="ws-pause-kind">
              <p>{pick(h.text, lang)}</p>
              {pause.kind === "drift" && pause.seen && (
                <p className="mt-1 text-[13px] text-[#e8e1d0]" data-testid="ws-drift">{T("I'm on: ", "Estoy en: ")}“{pause.seen.heading || pause.seen.title}”. {pause.detail}</p>
              )}
              {pause.kind === "portal_error" && (pause.errors ?? []).length > 0 && (
                <ul className="mt-1 list-disc pl-5 text-[13px]">{(pause.errors ?? []).map((e, i) => <li key={i}>{e}</li>)}</ul>
              )}
              {pause.kind === "ask" && (
                <form ref={answersRef} className="mt-2 space-y-2" autoComplete="off" onSubmit={(e) => { e.preventDefault(); submitAnswers(); }}>
                  {(pause.fields ?? []).map((f) => (
                    <label key={f.key} className="block space-y-1">
                      <span className="text-[14px]">{pick(f.ask, lang)}</span>
                      <input name={f.key} type={looksSensitiveLabel(f.label) ? "password" : "text"} required={f.required} autoComplete="off" className="w-full rounded-xl border border-white/15 bg-[#1f1f1f] px-3 py-1.5 text-[14px] text-[#f4efe2]" data-testid="ws-answer" />
                    </label>
                  ))}
                  <button type="submit" className={primaryBtn} disabled={busy} data-testid="ws-answer-send">{T("Fill it in", "Llénalo")}</button>
                </form>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {pause.kind === "gate" && pause.gate === "submit" ? (
                <>
                  <button type="button" className={primaryBtn} disabled={busy} onClick={() => act("continue", {}, T("I reviewed it and submitted it myself.", "Lo revisé y lo envié yo."))} data-testid="ws-submitted">{T("I submitted it myself", "Lo envié yo")}</button>
                  <button type="button" className={ghostBtn} disabled={busy} onClick={() => act("stop", {}, T("Stop here.", "Para aquí."))}>{T("Stop — I'll come back", "Parar — vuelvo luego")}</button>
                </>
              ) : pause.kind !== "ask" ? (
                <button type="button" className={primaryBtn} disabled={busy} onClick={() => act("continue", {}, T("Done — continue.", "Listo — sigue."))} data-testid="ws-continue">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {pause.kind === "drift" || pause.kind === "portal_error" ? T("I fixed it — try again", "Lo arreglé — intenta otra vez") : T("Done — continue", "Listo — seguir")}
                </button>
              ) : null}
              {(pause.kind === "drift" || pause.kind === "portal_error") && (
                <>
                  <button type="button" className={ghostBtn} disabled={busy} onClick={() => act("stop", {}, T("I'll finish it myself.", "Lo termino yo."))} data-testid="ws-stop">{T("I'll finish it", "Lo termino yo")}</button>
                  {pause.kind === "drift" && <a className={ghostBtn} href={teachHref} data-testid="ws-reteach"><GraduationCap className="h-4 w-4" /> {T("Re-teach Clara", "Enséñale otra vez")}</a>}
                </>
              )}
            </div>
          </ClaraBubble>
        );
      })()}

      {replay && secure && replay.status === "paused" && (
        <SecureInputCard key={`${replay.milestones.length}-${pause?.gate}`} lang={lang} gate={secure.gate} fields={secure.fields} endpoint={`/api/replays/${encodeURIComponent(replay.id)}/secure-input`} />
      )}

      {replay?.status === "done" && (
        <ClaraBubble tone="ok" testId="ws-done">{T("All done. You submitted it yourself — keep the confirmation number from the portal.", "Listo. Tú lo enviaste — guarda el número de confirmación del portal.")}</ClaraBubble>
      )}
      {replay?.status === "stopped" && (
        <ClaraBubble testId="ws-stopped">{T("I stopped and closed my browser. Nothing was submitted by me.", "Me detuve y cerré mi navegador. Yo no envié nada.")}</ClaraBubble>
      )}
      {replay && (replay.status === "paused" || replay.status === "running") && !(pause?.kind === "gate" && pause.gate === "submit") && (
        <button type="button" className={`${ghostBtn} ml-9`} disabled={busy} onClick={() => act("stop", {}, T("Stop — I'll take it from here.", "Para — sigo yo."))}>{T("Stop — I'll take it from here", "Parar — sigo yo")}</button>
      )}

      {error && <ClaraBubble tone="stop" testId="ws-error">{error}</ClaraBubble>}
      <div ref={endRef} />
    </div>
  );
}
