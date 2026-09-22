"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./filingAssistant.module.css";

type Language = "EN" | "ES";

const copy = {
  EN: {
    eyebrow: "Assisted live filing",
    beta: "Beta",
    title: "Skip the government maze.",
    lead: "The assistant opens the government website for you and fills in the forms with your business info. You watch it work, step by step. When it needs something only you can do — your login, a certification, a payment, or your approval — it stops and asks. At the end, you review everything and click submit yourself.",
    points: [
      "Opens the real government site and fills it in for you.",
      "Stops and asks when it needs you — your login, a captcha, or a payment.",
      "You review and submit. Nothing gets filed without you.",
    ],
    chatAlt:
      "Preview of the SmartPR filing assistant chat: it opens the government website, fills in the form from the business profile, pauses to ask for the user's login, and waits for the user to review and submit.",
    chatTitle: "Filing assistant",
    chatSub: "Government filing · Merchant registration",
    m1: "Opening the government website…",
    m2: "Filling in your business name, address, and contact info…",
    m3: "Uploading your lease agreement…",
    paused: "Paused — I need your login to keep going.",
    takeover: "Take over",
    resume: "Resume",
    ready: "Ready for your review — you click submit.",
  },
  ES: {
    eyebrow: "Trámite asistido en vivo",
    beta: "Beta",
    title: "Sáltate el revolú del gobierno.",
    lead: "El asistente abre la página del gobierno por ti y llena los formularios con los datos de tu negocio. Lo ves trabajar paso a paso. Cuando necesita algo que solo tú puedes hacer — tu inicio de sesión, una certificación, un pago o tu aprobación — se detiene y te avisa. Al final, revisas todo y lo envías tú mismo.",
    points: [
      "Abre la página real del gobierno y la llena por ti.",
      "Se detiene y te avisa cuando te necesita — tu inicio de sesión, un captcha o un pago.",
      "Revisas y envías tú. Nada se radica sin ti.",
    ],
    chatAlt:
      "Vista previa del chat del asistente de trámite de SmartPR: abre la página del gobierno, llena el formulario con los datos del negocio, se detiene para pedir el inicio de sesión del usuario y espera a que el usuario revise y envíe.",
    chatTitle: "Asistente de trámite",
    chatSub: "Trámite del gobierno · Registro de comerciante",
    m1: "Abriendo la página del gobierno…",
    m2: "Llenando el nombre, la dirección y el contacto de tu negocio…",
    m3: "Subiendo tu contrato de arrendamiento…",
    paused: "En pausa — necesito que inicies sesión para seguir.",
    takeover: "Tomar el control",
    resume: "Continuar",
    ready: "Listo para tu revisión — tú le das a enviar.",
  },
} as const;

type ScriptStep =
  | { kind: "msg"; text: string }
  | { kind: "pause"; text: string; takeover: string; resume: string }
  | { kind: "ready"; text: string };

// Fast typing: ~90 chars/sec, short gaps, quick loop — the window is never blank.
const TYPE_TICK_MS = 22;
const CHARS_PER_TICK = 2;
const STEP_GAP_MS = 320;
const PAUSE_HOLD_MS = 1100;
const PRESS_MS = 350;
const END_HOLD_MS = 2800;

function firstChunk(text: string): string {
  return text.slice(0, CHARS_PER_TICK);
}

export default function FilingAssistant({
  language,
  cta,
  onStart,
}: {
  language: Language;
  cta: string;
  onStart: () => void;
}) {
  const c = copy[language];

  const [reducedMotion, setReducedMotion] = useState<boolean>(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  const steps = useMemo<ScriptStep[]>(
    () => [
      { kind: "msg", text: c.m1 },
      { kind: "msg", text: c.m2 },
      { kind: "msg", text: c.m3 },
      {
        kind: "pause",
        text: c.paused,
        takeover: c.takeover,
        resume: c.resume,
      },
      { kind: "ready", text: c.ready },
    ],
    [c],
  );

  const active = !reducedMotion;
  const [doneCount, setDoneCount] = useState<number>(() =>
    active ? 0 : steps.length,
  );
  const [typed, setTyped] = useState<string>(() =>
    active ? firstChunk(c.m1) : "",
  );
  const [resumePressed, setResumePressed] = useState<boolean>(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (!active) {
      setDoneCount(steps.length);
      setTyped("");
      setResumePressed(false);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let step = 0;
    let chars = CHARS_PER_TICK;

    // Reset and start immediately — the first message is already partially
    // typed in initial state, so the window is never blank.
    setDoneCount(0);
    setResumePressed(false);
    const first = steps[0];
    setTyped(first.kind === "pause" ? "" : firstChunk(first.text));

    const later = (fn: () => void, ms: number) => {
      timer = setTimeout(() => {
        if (!cancelled) fn();
      }, ms);
    };

    const advanceAfterStep = () => {
      chars = CHARS_PER_TICK;
      step += 1;
      if (step >= steps.length) {
        later(() => {
          step = 0;
          setDoneCount(0);
          setResumePressed(false);
          const f = steps[0];
          setTyped(f.kind === "pause" ? "" : firstChunk(f.text));
          later(runStep, 80);
        }, END_HOLD_MS);
      } else {
        later(runStep, STEP_GAP_MS);
      }
    };

    const runStep = (): void => {
      const s = steps[step];
      if (!s) return;
      if (s.kind === "pause") {
        setDoneCount(step + 1);
        setTyped("");
        later(() => {
          // Simulate the user clicking "Resume" before continuing.
          setResumePressed(true);
          later(() => {
            setResumePressed(false);
            advanceAfterStep();
          }, PRESS_MS);
        }, PAUSE_HOLD_MS);
        return;
      }
      if (chars >= s.text.length) {
        setDoneCount(step + 1);
        setTyped("");
        advanceAfterStep();
        return;
      }
      chars = Math.min(chars + CHARS_PER_TICK, s.text.length);
      setTyped(s.text.slice(0, chars));
      if (chars >= s.text.length) {
        setDoneCount(step + 1);
        setTyped("");
        advanceAfterStep();
      } else {
        later(runStep, TYPE_TICK_MS);
      }
    };

    runStep();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [steps, active]);

  return (
    <div className={styles.wrap}>
      <div className={styles.copy}>
        <p className={styles.eyebrow}>
          {c.eyebrow} <span className={styles.betaPill}>{c.beta}</span>
        </p>
        <h2>{c.title}</h2>
        <p className={styles.lead}>{c.lead}</p>
        <ul className={styles.points}>
          {c.points.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        <div className={styles.cta}>
          <button type="button" className={styles.primary} onClick={onStart}>
            {cta}
          </button>
        </div>
      </div>
      <div className={styles.chatCol}>
        <div className={styles.chat} role="img" aria-label={c.chatAlt}>
          <div className={styles.chatHead} aria-hidden="true">
            <span className={styles.chatAvatar} />
            <div className={styles.chatHeadText}>
              <p className={styles.chatTitle}>{c.chatTitle}</p>
              <p className={styles.chatSub}>{c.chatSub}</p>
            </div>
            <span className={styles.betaPill}>{c.beta}</span>
          </div>
          <div className={styles.chatBody} aria-hidden="true">
            {steps.map((s, i) => {
              if (i < doneCount) {
                if (s.kind === "pause") {
                  return (
                    <div
                      key={i}
                      className={`${styles.pauseCard} ${styles.stepIn}`}
                    >
                      <p>{s.text}</p>
                      <div className={styles.pauseBtns}>
                        <span className={styles.pauseBtnPrimary}>
                          {s.takeover}
                        </span>
                        <span
                          className={`${styles.pauseBtn} ${
                            resumePressed ? styles.pauseBtnPressed : ""
                          }`}
                        >
                          {s.resume}
                        </span>
                      </div>
                    </div>
                  );
                }
                return (
                  <div
                    key={i}
                    className={`${styles.msg} ${
                      s.kind === "ready" ? styles.readyMsg : ""
                    }`}
                  >
                    {s.kind === "ready" ? (
                      <span className={styles.check}>✓</span>
                    ) : (
                      <span className={styles.pulse} />
                    )}
                    <span>{s.text}</span>
                  </div>
                );
              }
              if (i === doneCount && s.kind !== "pause") {
                return (
                  <div
                    key={`typing-${i}`}
                    className={`${styles.msg} ${styles.stepIn} ${
                      s.kind === "ready" ? styles.readyMsg : ""
                    }`}
                  >
                    {s.kind === "ready" ? (
                      <span className={styles.check}>✓</span>
                    ) : (
                      <span className={styles.pulse} />
                    )}
                    <span>
                      {typed}
                      <span className={styles.caret} />
                    </span>
                  </div>
                );
              }
              return null;
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
