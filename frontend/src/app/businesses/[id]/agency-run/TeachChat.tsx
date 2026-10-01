"use client";

/**
 * Teach Clara — chat-first. The person walks the agency portal once in
 * Clara's live browser (the secondary panel); the chat shows the stage, one
 * line per screen, Clara's mapping questions, the human-only steps and a
 * masked one-time input for passwords / SSNs / codes. Then the person
 * reviews the routine in the chat — names it, corrects mappings and steps —
 * Clara validates it, and it is saved as a learned routine (mapping and
 * procedure only, never the business's values).
 *
 * Same server contract as the record-first dialog (/api/teach-sessions …).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Circle, GraduationCap, Hand, Loader2, Pencil, RotateCcw, Square, Trash2, XCircle } from "lucide-react";
import type { Lang } from "../../../forms/engine/types";
import { PASSPORT_CATALOG } from "../../../../lib/agency-runs/teach/passportCatalog";
import type { LearnedRoutineSummary } from "../../../../lib/agency-runs/teach/learnedRoutineMatch";
import {
  GATE_EXPLAIN,
  GATE_LABEL,
  TEACH_STAGE,
  defaultRoutineName,
  secureCardFor,
  teachNarrative,
  type SecretFieldView,
  type TeachStage,
  type TeachStepView,
} from "../../../../lib/agency-runs/teach/workspaceChat";
import { claraWorkspaceHref, type ClaraWorkspaceContext } from "../../../components/clara/claraWorkspaceLink";
import { TeachClaraForm } from "../../../components/clara/TeachClaraForm";
import { ClaraBubble, L, SecureInputCard, UnavailableCard, api, errText, ghostBtn, pick, primaryBtn, type Bi, type PassportFieldView } from "./workspaceParts";

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
  steps: TeachStepView[];
  questions: Question[];
  actions: { seq: number; kind: string; screenshot: string | null }[];
  stage: TeachStage;
  secret_fields: SecretFieldView[];
  current_gate: string | null;
  worker_status: string;
}
interface Check { id: string; ok: boolean; severity: "error" | "warning"; title: Bi; fix: Bi | null }
interface Validation { status: "pass" | "issues"; checks: Check[]; errors: number; warnings: number; llm: { status: string; notes: Bi[] } }

export interface RecorderStatus {
  ok: boolean;
  reason: string | null;
  busy: boolean;
  message: Bi | null;
  operator_hint: string | null;
}

type Phase = "checking" | "sign_in" | "unavailable" | "need_url" | "ready" | "starting" | "recording" | "finishing" | "review" | "saving" | "saved";

const EDITABLE_GATES = ["login", "mfa", "upload", "payment", "signature", "certification", "identity"];

export function TeachChat({
  lang,
  ctx,
  businessId,
  signedIn,
  recorder,
  existing,
  passport,
  onRecheck,
  onLiveUrl,
  onShowBrowser,
  onSaved,
}: {
  lang: Lang;
  ctx: ClaraWorkspaceContext;
  businessId: string | null;
  signedIn: boolean | null;
  recorder: RecorderStatus | null;
  existing: LearnedRoutineSummary | null;
  passport: PassportFieldView[] | null;
  onRecheck: () => void;
  onLiveUrl: (url: string | null) => void;
  onShowBrowser: () => void;
  onSaved: (r: LearnedRoutineSummary) => void;
}) {
  const T = (en: string, es: string) => L(en, es, lang);
  // Before the person acts, the phase follows sign-in + recorder status; after, it's theirs.
  const [manualPhase, setPhase] = useState<Phase | null>(null);
  const [portalUrl, setPortalUrl] = useState(ctx.portalUrl ?? existing?.start_url ?? "");
  const [session, setSession] = useState<SessionView | null>(null);
  const [validation, setValidation] = useState<Validation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [routineName, setRoutineName] = useState("");
  const [saved, setSaved] = useState<LearnedRoutineSummary | null>(null);
  const [secureSent, setSecureSent] = useState(0);
  const [editing, setEditing] = useState(false);
  const [describing, setDescribing] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const autoPhase: Phase =
    signedIn === null || recorder === null ? "checking" : !signedIn ? "sign_in" : !recorder.ok ? "unavailable" : /^https:\/\//i.test(portalUrl) ? "ready" : "need_url";
  const phase: Phase = manualPhase ?? autoPhase;

  const host = useMemo(() => {
    try {
      return new URL(portalUrl).hostname;
    } catch {
      return null;
    }
  }, [portalUrl]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [phase, session?.steps.length, session?.questions.length, validation, saved]);

  const start = useCallback(async () => {
    setError(null);
    const url = portalUrl.trim();
    if (!/^https:\/\//i.test(url)) {
      setPhase("need_url");
      return setError(T("Use the portal's full https:// address.", "Usa la dirección completa del portal (https://)."));
    }
    setPhase("starting");
    const r = await api<{ session?: SessionView; message?: Bi | string; reason?: string; operator_hint?: string | null; error?: string }>("/api/teach-sessions", {
      start_url: url,
      form: ctx.name,
      portal_name: ctx.agency ?? "",
      business_id: businessId,
      requirement_key: ctx.requirementKey,
      agency: ctx.agency,
    });
    if (r.ok && r.data.session) {
      setSession(r.data.session);
      setValidation(null);
      onLiveUrl(r.data.session.live_url);
      onShowBrowser();
      setPhase("recording");
      return;
    }
    if (r.status === 401) return setPhase("sign_in");
    if (r.data.error === "teach_unavailable") {
      onRecheck();
      return setPhase(null);
    }
    setError(errText(r.data, lang, T("The recording couldn't start. Try again.", "No se pudo empezar a grabar. Intenta otra vez.")));
    setPhase(/^https:\/\//i.test(url) ? "ready" : "need_url");
  }, [portalUrl, ctx, businessId, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live: pull the walkthrough while recording.
  useEffect(() => {
    if (phase !== "recording" || !session) return;
    const id = session.id;
    let stop = false;
    const tick = async () => {
      const r = await api<{ session?: SessionView }>(`/api/teach-sessions/${encodeURIComponent(id)}`).catch(() => null);
      if (stop) return;
      if (r?.ok && r.data.session) {
        setSession(r.data.session);
        if (r.data.session.worker_status !== "running" && r.data.session.status === "recording") {
          setError(T("The portal browser closed (it times out after a while). Finish with what was recorded, or record again.", "El navegador del portal se cerró (se cierra después de un rato). Termina con lo grabado o graba otra vez."));
        }
      } else if (r && !r.ok) {
        setError(errText(r.data, lang, T("Lost touch with the recording browser.", "Se perdió el contacto con el navegador de grabación.")));
      }
    };
    const t = window.setInterval(tick, 1500);
    return () => {
      stop = true;
      window.clearInterval(t);
    };
  }, [phase, session?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // The person's part (sign-in, code, CAPTCHA …) happens in the browser: show it.
  useEffect(() => {
    if (session?.stage === "your_turn") onShowBrowser();
  }, [session?.stage]); // eslint-disable-line react-hooks/exhaustive-deps

  const answer = async (questionId: string, ans: unknown) => {
    if (!session) return;
    const r = await api<{ session?: SessionView }>(`/api/teach-sessions/${encodeURIComponent(session.id)}/answer`, { question_id: questionId, answer: ans });
    if (r.ok && r.data.session) {
      setSession(r.data.session);
      setValidation(null);
    } else setError(errText(r.data, lang, T("Couldn't save that answer.", "No se pudo guardar esa respuesta.")));
  };

  const edit = async (body: Record<string, unknown>) => {
    if (!session) return;
    const r = await api<{ session?: SessionView }>(`/api/teach-sessions/${encodeURIComponent(session.id)}/mark`, body);
    if (r.ok && r.data.session) {
      setSession(r.data.session);
      setValidation(null);
    } else setError(errText(r.data, lang, T("Couldn't change that step.", "No se pudo cambiar ese paso.")));
  };

  const validate = async () => {
    if (!session) return;
    setBusy(true);
    setError(null);
    setPhase("finishing");
    try {
      if (session.status === "recording") {
        const f = await api<{ session?: SessionView }>(`/api/teach-sessions/${encodeURIComponent(session.id)}/finish`, {});
        if (f.ok && f.data.session) setSession(f.data.session);
        onLiveUrl(null);
      }
      const v = await api<{ session?: SessionView; validation?: Validation }>(`/api/teach-sessions/${encodeURIComponent(session.id)}/validate`, { live_check: true });
      if (!v.ok || !v.data.validation) throw new Error(errText(v.data, lang, T("Couldn't check the routine.", "No se pudo revisar la rutina.")));
      if (v.data.session) setSession(v.data.session);
      setValidation(v.data.validation);
      setRoutineName((n) => n || defaultRoutineName({ name: ctx.name, agency: ctx.agency, portalHost: host }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      setPhase("review");
    }
  };

  const save = async () => {
    if (!session) return;
    setBusy(true);
    setError(null);
    setPhase("saving");
    const r = await api<{ routine?: LearnedRoutineSummary }>(`/api/teach-sessions/${encodeURIComponent(session.id)}/save`, { learn: true, name: routineName.trim() });
    setBusy(false);
    if (!r.ok || !r.data.routine) {
      setPhase("review");
      return setError(errText(r.data, lang, T("Couldn't save. Try again.", "No se pudo guardar. Intenta otra vez.")));
    }
    setSaved(r.data.routine);
    onSaved(r.data.routine);
    setPhase("saved");
  };

  const recordAgain = async () => {
    setValidation(null);
    setSession(null);
    setEditing(false);
    await start();
  };

  const questions = session?.questions ?? [];
  const narrative = teachNarrative(session?.steps ?? []);
  const secure = session && phase === "recording" ? secureCardFor(session.current_gate, session.secret_fields ?? []) : null;
  const onFile = useMemo(() => new Set((passport ?? []).filter((f) => f.has).map((f) => f.path)), [passport]);
  const passportLoaded = Boolean(passport?.some((f) => f.has));

  // ------------------------------------------------------------------ pieces
  const questionCard = (q: Question) => (
    <ClaraBubble key={q.id} tone="ask" testId="ws-question">
      {q.kind === "mapping" && (
        <>
          <p>
            {q.proposal
              ? T(`You filled “${q.label}”. Is that the business's ${q.proposal.en.toLowerCase()} from the Passport?`, `Llenaste “${q.label}”. ¿Es ${q.proposal.es.toLowerCase()} del Pasaporte?`)
              : T(`You filled “${q.label}”. What should Clara put there for each business?`, `Llenaste “${q.label}”. ¿Qué debe poner Clara ahí para cada negocio?`)}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {q.proposal && (
              <button type="button" className={primaryBtn} onClick={() => answer(q.id, { kind: "mapping", choice: "confirm" })} data-testid="q-confirm">
                {T("Yes — use the Passport", "Sí — usar el Pasaporte")}
              </button>
            )}
            {q.canAlwaysChoose && (
              <button type="button" className={ghostBtn} onClick={() => answer(q.id, { kind: "mapping", choice: "always" })} data-testid="q-always">
                {T(`Always “${q.optionText}”`, `Siempre “${q.optionText}”`)}
              </button>
            )}
            <button type="button" className={ghostBtn} onClick={() => answer(q.id, { kind: "mapping", choice: "ask" })} data-testid="q-ask">
              {T("Ask each time", "Preguntar cada vez")}
            </button>
            <select
              aria-label={T("Another Passport detail", "Otro dato del Pasaporte")}
              defaultValue=""
              onChange={(e) => e.target.value && answer(q.id, { kind: "mapping", choice: "correct", path: e.target.value })}
              className="rounded-full border border-white/15 bg-[#1f1f1f] px-3 py-1.5 text-[14px] text-[#f4efe2]"
              data-testid="q-correct"
            >
              <option value="">{T("Another detail…", "Otro dato…")}</option>
              {PASSPORT_CATALOG.map((c) => (
                <option key={c.path} value={c.path}>{lang === "es" ? c.es : c.en}</option>
              ))}
            </select>
          </div>
        </>
      )}
      {q.kind === "gate" && (
        <>
          <p>{pick(q.reason, lang)} {T("You do this part — Clara stops here every time.", "Esta parte la haces tú — Clara se detiene aquí siempre.")}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={primaryBtn} onClick={() => answer(q.id, { kind: "yes_no", value: "yes" })} data-testid="q-yes">{T("Right", "Correcto")}</button>
            <button type="button" className={ghostBtn} onClick={() => answer(q.id, { kind: "yes_no", value: "no" })}>{T("No, Clara can do it", "No, Clara lo puede hacer")}</button>
          </div>
        </>
      )}
      {q.kind === "always_choose" && (
        <>
          <p>{T(`You picked “${q.optionText || q.label}”. Should Clara always choose that, for every business?`, `Escogiste “${q.optionText || q.label}”. ¿Clara debe escoger eso siempre, para cada negocio?`)}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={primaryBtn} onClick={() => answer(q.id, { kind: "yes_no", value: "yes" })} data-testid="q-yes">{T("Yes, always", "Sí, siempre")}</button>
            <button type="button" className={ghostBtn} onClick={() => answer(q.id, { kind: "yes_no", value: "no" })} data-testid="q-ask">{T("Ask me each time", "Pregúntame cada vez")}</button>
          </div>
        </>
      )}
      {q.kind === "branch" && (
        <>
          <p>{T(`“${q.title}” only shows up for some businesses. What decides it?`, `“${q.title}” sale solo para algunos negocios. ¿Qué lo decide?`)}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <select
              aria-label={T("Passport fact", "Dato del Pasaporte")}
              defaultValue=""
              onChange={(e) => e.target.value && answer(q.id, { kind: "branch", path: e.target.value })}
              className="rounded-full border border-white/15 bg-[#1f1f1f] px-3 py-1.5 text-[14px] text-[#f4efe2]"
            >
              <option value="">{T("A Passport fact…", "Un dato del Pasaporte…")}</option>
              {PASSPORT_CATALOG.filter((c) => c.branchable).map((c) => (
                <option key={c.path} value={c.path}>{lang === "es" ? c.es : c.en}</option>
              ))}
            </select>
            <button type="button" className={ghostBtn} onClick={() => answer(q.id, { kind: "branch", notSure: true })} data-testid="q-ask">{T("Not sure — follow the portal", "No sé — sigue el portal")}</button>
          </div>
        </>
      )}
    </ClaraBubble>
  );

  const failing = (validation?.checks ?? []).filter((c) => !c.ok);
  const pass = validation?.status === "pass";

  const reviewCard = session && (
    <ClaraBubble tone={pass ? "ok" : "gate"} testId="ws-review">
      <p className="font-semibold">
        {pass ? T("Here's the routine I learned. Check it, name it, and save.", "Esta es la rutina que aprendí. Revísala, ponle nombre y guárdala.") : T("Before I can learn this, a few things need fixing:", "Antes de aprenderlo, hay que arreglar unas cosas:")}
      </p>
      {validation && (
        <div className="mt-1 text-[13px] text-[#cfc6b4]" data-testid="ws-verdict" data-status={validation.status}>
          {pass
            ? T(`Validated: ${session.steps.length} screens, stops before the final submission.`, `Validada: ${session.steps.length} pantallas, se detiene antes del envío final.`)
            : T(`${validation.errors} to fix.`, `${validation.errors} por arreglar.`)}
        </div>
      )}
      {failing.length > 0 && (
        <ul className="mt-2 space-y-1.5" data-testid="ws-issues">
          {failing.map((c) => (
            <li key={c.id} className="flex gap-2 text-[14px]" data-testid="ws-issue" data-check={c.id}>
              {c.severity === "error" ? <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-200" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-200" />}
              <span><b>{pick(c.title, lang)}</b>{c.fix && <span className="block text-[13px] text-[#cfc6b4]">{pick(c.fix, lang)}</span>}</span>
            </li>
          ))}
        </ul>
      )}
      <label className="mt-3 block space-y-1">
        <span className="text-[13px] font-semibold text-[#cfc6b4]">{T("Routine name", "Nombre de la rutina")}</span>
        <input
          value={routineName}
          onChange={(e) => setRoutineName(e.target.value.slice(0, 120))}
          className="w-full rounded-xl border border-white/15 bg-[#1f1f1f] px-3 py-1.5 text-[15px] text-[#f4efe2]"
          data-testid="ws-routine-name"
        />
      </label>
      <ol className="mt-3 space-y-2" data-testid="ws-review-steps">
        {session.steps.filter((s) => s.observed || s.gate).map((s, i) => (
          <li key={s.id} className="rounded-xl border border-white/10 bg-black/20 p-2.5" data-testid="ws-review-step">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] text-[#9a917f]">{i + 1}.</span>
              <b className="min-w-0 flex-1 text-[14px]">{s.title}</b>
              {editing ? (
                <>
                  <select
                    aria-label={T("Who does this screen", "Quién hace esta pantalla")}
                    value={s.gate && EDITABLE_GATES.includes(s.gate) ? s.gate : ""}
                    onChange={(e) => void edit({ step_id: s.id, gate: e.target.value || null })}
                    disabled={s.gate === "submit" || s.gate === "captcha"}
                    className="rounded-full border border-white/15 bg-[#1f1f1f] px-2.5 py-1 text-[13px] text-[#f4efe2]"
                  >
                    <option value="">{T("Clara fills it", "Clara la llena")}</option>
                    {EDITABLE_GATES.map((g) => <option key={g} value={g}>{T(`I do this: ${GATE_LABEL[g].en}`, `Lo hago yo: ${GATE_LABEL[g].es}`)}</option>)}
                  </select>
                  <button type="button" className="rounded-full p-1.5 text-[#cfc6b4] hover:bg-white/10" onClick={() => void edit({ remove_step: s.id })} aria-label={T("Remove screen", "Quitar pantalla")} data-testid="ws-remove-step">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </>
              ) : (
                s.gate && <span className="inline-flex items-center gap-1 rounded-full bg-amber-200/10 px-2 py-0.5 text-[12px] text-amber-100"><Hand className="h-3 w-3" />{pick(GATE_LABEL[s.gate], lang)}</span>
              )}
            </div>
            {s.fields.length > 0 && (
              <ul className="mt-1.5 space-y-1">
                {s.fields.map((f) => {
                  const missing = f.binding.kind === "passport" && passportLoaded && f.binding.path && !onFile.has(f.binding.path);
                  return (
                    <li key={f.key} className="flex flex-wrap items-center gap-2 text-[13px]" data-testid="ws-review-field" data-binding={f.binding.kind}>
                      <span className="min-w-0 flex-1 text-[#ece6d8]">{f.label}</span>
                      {editing ? (
                        <select
                          aria-label={T(`What fills “${f.label}”`, `Con qué se llena “${f.label}”`)}
                          value={f.binding.kind === "passport" ? f.binding.path : f.binding.kind === "ask" ? "__ask" : ""}
                          onChange={(e) => void edit({ rebind: { step_id: s.id, field_key: f.key, path: e.target.value === "__ask" ? null : e.target.value } })}
                          className="rounded-full border border-white/15 bg-[#1f1f1f] px-2.5 py-1 text-[13px] text-[#f4efe2]"
                          data-testid="ws-edit-binding"
                        >
                          {f.binding.kind === "pending" && <option value="">{T("Choose…", "Escoge…")}</option>}
                          {f.binding.kind === "always" && <option value="">{T(`Always “${f.binding.option}”`, `Siempre “${f.binding.option}”`)}</option>}
                          <option value="__ask">{T("Ask each time", "Preguntar cada vez")}</option>
                          {PASSPORT_CATALOG.map((c) => <option key={c.path} value={c.path}>{lang === "es" ? c.es : c.en}</option>)}
                        </select>
                      ) : (
                        <span className={`rounded-full px-2 py-0.5 ${f.binding.kind === "passport" ? "bg-[#1e4d38]/50 text-[#cfeedd]" : f.binding.kind === "pending" ? "bg-amber-200/10 text-amber-100" : "bg-white/10 text-[#e8e1d0]"}`}>
                          {f.binding.kind === "passport" ? pick(f.binding.name, lang) : f.binding.kind === "ask" ? T("Ask each time", "Preguntar cada vez") : f.binding.kind === "always" ? T(`Always “${f.binding.option}”`, `Siempre “${f.binding.option}”`) : T("Which detail?", "¿Qué dato?")}
                        </span>
                      )}
                      {missing && <span className="text-[12px] text-amber-200" data-testid="ws-missing-passport">{T("not on file — Clara will ask", "no está guardado — Clara preguntará")}</span>}
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        ))}
      </ol>
      <p className="mt-2 text-[12px] text-[#9fd3b4]">
        {T("Saved: screens, controls, which Passport detail goes where, your pauses. Never saved: what you typed, passwords, codes, screenshots.", "Se guarda: pantallas, controles, qué dato del Pasaporte va dónde, tus pausas. Nunca se guarda: lo que escribiste, contraseñas, códigos, capturas.")}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {pass && questions.length === 0 && !editing ? (
          <button type="button" className={primaryBtn} onClick={save} disabled={busy || !routineName.trim()} data-testid="ws-save">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <GraduationCap className="h-4 w-4" />} {T("Save routine", "Guardar rutina")}
          </button>
        ) : (
          <button type="button" className={primaryBtn} onClick={() => { setEditing(false); void validate(); }} disabled={busy} data-testid="ws-check-again">
            <RotateCcw className="h-4 w-4" /> {T("Check again", "Revisar otra vez")}
          </button>
        )}
        <button type="button" className={ghostBtn} onClick={() => setEditing((e) => !e)} data-testid="ws-edit-steps">
          <Pencil className="h-4 w-4" /> {editing ? T("Done editing", "Listo") : T("Correct mappings & steps", "Corregir datos y pasos")}
        </button>
        <button type="button" className={ghostBtn} onClick={recordAgain} disabled={busy} data-testid="ws-record-again">
          <RotateCcw className="h-4 w-4" /> {T("Record again", "Grabar otra vez")}
        </button>
      </div>
    </ClaraBubble>
  );

  // ------------------------------------------------------------------ render
  return (
    <div className="space-y-3" data-testid="ws-teach" data-phase={phase}>
      <ClaraBubble>
        <p>
          {existing
            ? T(
                `I already know “${existing.name}” (version ${existing.version}). Walk it again and I'll save a new version — the old one stays until the new one passes validation.`,
                `Ya conozco “${existing.name}” (versión ${existing.version}). Recórrelo otra vez y guardo una versión nueva — la anterior se queda hasta que la nueva pase la validación.`
              )
            : T(
                "Teach me this filing once. I'll open the agency portal in a browser next to this chat; you do it like you normally would and I'll learn the steps and which Business Passport detail goes in each field — never the values you type.",
                "Enséñame este trámite una vez. Abro el portal de la agencia en un navegador al lado de este chat; tú lo haces como siempre y yo aprendo los pasos y qué dato del Pasaporte del negocio va en cada campo — nunca los valores que escribes."
              )}
        </p>
      </ClaraBubble>

      {phase === "checking" && (
        <ClaraBubble testId="ws-checking">
          <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
          {T("Checking that my recording browser is connected…", "Verificando que mi navegador de grabación está conectado…")}
        </ClaraBubble>
      )}

      {phase === "sign_in" && (
        <ClaraBubble tone="gate" testId="ws-sign-in">
          {T("Sign in first — what I learn is saved to your account.", "Entra a tu cuenta primero — lo que aprendo se guarda en tu cuenta.")}{" "}
          <a className="underline" href={`/login?next=${encodeURIComponent(typeof window !== "undefined" ? window.location.pathname + window.location.search : "/")}`}>{T("Sign in", "Entrar")}</a>
        </ClaraBubble>
      )}

      {phase === "unavailable" && recorder && (
        <UnavailableCard lang={lang} reason={recorder.reason} message={pick(recorder.message, lang) || T("My recording browser isn't available right now.", "Mi navegador de grabación no está disponible ahora.")} hint={recorder.operator_hint} onRetry={() => { setPhase(null); onRecheck(); }}>
          <button type="button" className={ghostBtn} onClick={() => setDescribing((d) => !d)} data-testid="ws-describe-instead">{T("Describe the steps instead", "Describir los pasos")}</button>
        </UnavailableCard>
      )}
      {phase === "unavailable" && describing && (
        <div className="ml-9" data-testid="ws-describe">
          <TeachClaraForm target={{ requirementKey: ctx.requirementKey, requirementName: ctx.name, agency: ctx.agency, portalUrl: portalUrl || null }} language={lang === "es" ? "es" : "en"} tone="dark" variant="edit" />
        </div>
      )}

      {(phase === "need_url" || phase === "ready") && (
        <ClaraBubble testId={phase === "need_url" ? "ws-need-url" : "ws-ready"}>
          {phase === "need_url" ? (
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                void start();
              }}
            >
              <p>{T("Where is this filed? Paste the portal's address and I'll open it.", "¿Dónde se radica? Pega la dirección del portal y lo abro.")}</p>
              <input value={portalUrl} onChange={(e) => setPortalUrl(e.target.value)} placeholder="https://…" className="w-full rounded-xl border border-white/15 bg-[#1f1f1f] px-3 py-1.5 text-[15px] text-[#f4efe2]" data-testid="ws-portal-url" />
              <button type="submit" className={primaryBtn} disabled={!/^https:\/\//i.test(portalUrl.trim())} data-testid="ws-start">
                <Circle className="h-3.5 w-3.5 fill-rose-400 text-rose-400" /> {T("Open the portal and start", "Abrir el portal y empezar")}
              </button>
            </form>
          ) : (
            <div className="space-y-2">
              <p>
                {T(`Ready when you are. I'll open ${host ?? "the portal"} and record. Stop at the review screen — don't press the final Submit; that stays yours.`, `Cuando quieras. Abro ${host ?? "el portal"} y grabo. Detente en la pantalla de revisión — no le des al Enviar final; eso queda en tus manos.`)}
              </p>
              {recorder?.busy && <p className="text-[13px] text-amber-200">{T("Heads up: my browser is finishing another session; if it's still busy I'll tell you.", "Ojo: mi navegador está terminando otra sesión; si sigue ocupado te aviso.")}</p>}
              <div className="flex flex-wrap gap-2">
                <button type="button" className={primaryBtn} onClick={() => void start()} data-testid="ws-start">
                  <Circle className="h-3.5 w-3.5 fill-rose-400 text-rose-400" /> {T("Open the portal and start", "Abrir el portal y empezar")}
                </button>
                <button type="button" className={ghostBtn} onClick={() => setPhase("need_url")}>{T("Use a different address", "Usar otra dirección")}</button>
              </div>
            </div>
          )}
        </ClaraBubble>
      )}

      {phase === "starting" && (
        <ClaraBubble testId="ws-starting">
          <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
          {T("Opening the portal in my browser…", "Abriendo el portal en mi navegador…")}
        </ClaraBubble>
      )}

      {session && phase !== "starting" && (
        <>
          <ClaraBubble testId="ws-recording-started">
            {T(`I opened ${host ?? "the portal"} in the browser panel. Go ahead — I'm watching the screens, not your values.`, `Abrí ${host ?? "el portal"} en el panel del navegador. Adelante — miro las pantallas, no tus valores.`)}
          </ClaraBubble>
          {narrative.map((n) => (
            <ClaraBubble key={n.id} tone={n.tone} testId="ws-screen-line">
              {pick(n.text, lang)}
            </ClaraBubble>
          ))}
        </>
      )}

      {phase === "recording" && session && (
        <>
          {questions.slice(0, 1).map(questionCard)}
          {questions.length > 1 && <p className="ml-9 text-[13px] text-[#9a917f]">{T(`${questions.length - 1} more after this one.`, `${questions.length - 1} más después de esta.`)}</p>}
          {session.current_gate && session.current_gate !== "submit" && (
            <ClaraBubble tone="gate" testId="ws-your-turn" >
              {pick(GATE_EXPLAIN[session.current_gate], lang) || T("This part is yours.", "Esta parte es tuya.")}
            </ClaraBubble>
          )}
          {secure && (
            <SecureInputCard key={`${session.current_gate}-${secure.fields.map((f) => f.selector).join("|")}`} lang={lang} gate={secure.gate} fields={secure.fields} endpoint={`/api/teach-sessions/${encodeURIComponent(session.id)}/secure-input`} onSent={() => setSecureSent((n) => n + 1)} />
          )}
          {secureSent > 0 && <p className="ml-9 text-[12px] text-[#9fd3b4]" data-testid="ws-secure-count">{T(`${secureSent} sensitive value(s) sent straight to the portal — none kept.`, `${secureSent} valor(es) sensible(s) enviado(s) directo al portal — ninguno guardado.`)}</p>}
          <div className="sticky bottom-0 ml-9 flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-[#1b1b1b]/95 p-2.5 backdrop-blur" data-testid="ws-recording">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-500/15 px-2.5 py-1 text-[13px] font-semibold text-rose-100" data-testid="ws-stage" data-stage={session.stage}>
              <span className="h-2 w-2 animate-pulse rounded-full bg-rose-400" aria-hidden="true" />
              {pick(TEACH_STAGE[session.stage] ?? TEACH_STAGE.recording, lang)}
            </span>
            <span className="text-[13px] text-[#b9b0a0]">{T(`${session.steps.filter((s) => s.observed).length} screens`, `${session.steps.filter((s) => s.observed).length} pantallas`)}</span>
            <button type="button" className={`${primaryBtn} ml-auto`} onClick={validate} disabled={busy || session.actions.length === 0} data-testid="ws-finish">
              <Square className="h-3.5 w-3.5" /> {T("I'm at the review screen — finish", "Llegué a la revisión — terminar")}
            </button>
          </div>
        </>
      )}

      {phase === "finishing" && (
        <ClaraBubble testId="ws-validating">
          <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
          {T("Closing the portal browser and checking that this is a complete, repeatable filing…", "Cerrando el navegador del portal y revisando que sea un trámite completo y repetible…")}
        </ClaraBubble>
      )}

      {(phase === "review" || phase === "saving") && (
        <>
          {questions.map(questionCard)}
          {reviewCard}
        </>
      )}

      {phase === "saved" && saved && (
        <ClaraBubble tone="ok" testId="ws-saved">
          <p className="flex items-center gap-2 font-semibold"><CheckCircle2 className="h-5 w-5 text-[#9fd3b4]" /> {T(`Learned: “${saved.name}” (version ${saved.version}).`, `Aprendido: “${saved.name}” (versión ${saved.version}).`)}</p>
          <p className="mt-1">
            {T(
              `Next time, “Fill with Clara” follows these ${saved.steps} steps on ${saved.portal_host} with that business's own Passport, pauses at your ${saved.pauses} part(s), and never submits. If the portal changes, I stop and ask you to teach me again.`,
              `La próxima vez, “Llenar con Clara” sigue estos ${saved.steps} pasos en ${saved.portal_host} con el Pasaporte de ese negocio, se detiene en tus ${saved.pauses} parte(s) y nunca envía. Si el portal cambia, me detengo y te pido que me enseñes otra vez.`
            )}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {businessId && (
              <a className={primaryBtn} href={claraWorkspaceHref("fill", businessId, { key: ctx.requirementKey, name: ctx.name, agency: ctx.agency, portalUrl: ctx.portalUrl ?? saved.start_url }, { routineRef: saved.ref })} data-testid="ws-fill-now">
                {T("Fill with Clara now", "Llenar con Clara ahora")}
              </a>
            )}
          </div>
        </ClaraBubble>
      )}

      {error && (
        <ClaraBubble tone="stop" testId="ws-error">
          {error}
        </ClaraBubble>
      )}
      <div ref={endRef} />
    </div>
  );
}
