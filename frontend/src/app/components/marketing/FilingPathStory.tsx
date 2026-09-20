"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Building, Building2, Check, HeartPulse, Landmark, Lightbulb, Receipt, ShieldCheck } from "lucide-react";
import styles from "./filingPath.module.css";

type Language = "EN" | "ES";

const STEP_ICONS: Array<typeof Building2> = [
  Building2, // entity registration
  Receipt, // federal tax registration
  Landmark, // Puerto Rico tax registration (Hacienda)
  Building, // municipal registration
  ShieldCheck, // permits & use requirements
  HeartPulse, // health & fire requirements
  Check, // review & submission
];


type Token = { text: string; mark: boolean; start: number; end: number };

/** Splits `sentence` into ordered, non-overlapping segments, tagging the ones
 * that match an entry in `marks`. Segments partition the sentence exactly,
 * so cumulative lengths double as reveal offsets for the typing animation. */
function tokenize(sentence: string, marks: string[]): Token[] {
  const lower = sentence.toLowerCase();
  const hits: { start: number; end: number }[] = [];
  for (const mark of marks) {
    const i = lower.indexOf(mark.toLowerCase());
    if (i < 0) continue;
    hits.push({ start: i, end: i + mark.length });
  }
  hits.sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const hit of hits) {
    const last = merged[merged.length - 1];
    if (last && hit.start <= last.end) last.end = Math.max(last.end, hit.end);
    else merged.push({ ...hit });
  }
  const parts: { text: string; mark: boolean }[] = [];
  let cursor = 0;
  for (const hit of merged) {
    if (hit.start > cursor) parts.push({ text: sentence.slice(cursor, hit.start), mark: false });
    parts.push({ text: sentence.slice(hit.start, hit.end), mark: true });
    cursor = hit.end;
  }
  if (cursor < sentence.length) parts.push({ text: sentence.slice(cursor), mark: false });
  let offset = 0;
  return parts.map((part) => {
    const start = offset;
    offset += part.text.length;
    return { ...part, start, end: offset };
  });
}

const copy = {
  EN: {
    mapped: "Your filing path, mapped.",
    summary: "7 agencies · 7 filings",
    sentence: "I want to open a restaurant in Bayamón with 10 employees and outdoor seating.",
    marks: ["restaurant", "Bayamón", "10 employees", "outdoor seating"],
    chips: ["Restaurant", "Bayamón", "10 employees", "Outdoor seating"],
    parseReading: "Reading your business",
    parseDetails: (n: number) => `${n} details identified`,
    parseAgencies: (n: number) => `${n} agencies apply`,
    parseMapped: "Filing sequence mapped",
    agencies: [
      "Department of State",
      "IRS",
      "Hacienda",
      "Municipio de Bayamón",
      "OGPe",
      "Department of Health",
      "Fire Bureau",
    ],
    path: [
      { title: "Entity registration", detail: "Department of State · Corporation or LLC registration" },
      { title: "Federal tax registration", detail: "IRS · Employer Identification Number (EIN)" },
      { title: "Puerto Rico tax registration", detail: "Hacienda · SURI registration and applicable tax accounts" },
      { title: "Municipal registration", detail: "Municipio de Bayamón · Municipal patent / applicable local registration" },
      { title: "Permits & use requirements", detail: "OGPe · Permiso Único and applicable use requirements" },
      { title: "Health & fire requirements", detail: "Department of Health · Fire Bureau / applicable inspections" },
      { title: "Review & submission", detail: "SmartPR review before you submit" },
    ],
    incentivesLabel: "Possible incentives",
    incentives: [
      "Municipal tax exemption",
      "Small business incentives (Act 60)",
      "Job creation incentive",
    ],
    incentivesNote: "Example only — actual eligibility depends on your full business profile.",
  },
  ES: {
    mapped: "Su ruta de radicación, trazada.",
    summary: "7 agencias · 7 trámites",
    sentence: "Quiero abrir un restaurante en Bayamón con 10 empleados y asientos al aire libre.",
    marks: ["restaurante", "Bayamón", "10 empleados", "asientos al aire libre"],
    chips: ["Restaurante", "Bayamón", "10 empleados", "Asientos al aire libre"],
    parseReading: "Leyendo su negocio",
    parseDetails: (n: number) => `${n} detalles identificados`,
    parseAgencies: (n: number) => `${n} agencias aplican`,
    parseMapped: "Ruta de radicación trazada",
    agencies: [
      "Departamento de Estado",
      "IRS",
      "Hacienda",
      "Municipio de Bayamón",
      "OGPe",
      "Departamento de Salud",
      "Negociado de Bomberos",
    ],
    path: [
      { title: "Registro de entidad", detail: "Departamento de Estado · Registro de corporación o LLC" },
      { title: "Registro contributivo federal", detail: "IRS · Número de identificación patronal (EIN)" },
      { title: "Registro contributivo de Puerto Rico", detail: "Hacienda · Registro en SURI y cuentas contributivas aplicables" },
      { title: "Registro municipal", detail: "Municipio de Bayamón · Patente municipal / registro local aplicable" },
      { title: "Permisos y requisitos de uso", detail: "OGPe · Permiso Único y requisitos de uso aplicables" },
      { title: "Requisitos de salud y bomberos", detail: "Departamento de Salud · Negociado de Bomberos / inspecciones aplicables" },
      { title: "Revisión y radicación", detail: "Revisión de SmartPR antes de presentar" },
    ],
    incentivesLabel: "Posibles incentivos",
    incentives: [
      "Exención de patente municipal",
      "Incentivos para pequeños negocios (Ley 60)",
      "Incentivo por creación de empleos",
    ],
    incentivesNote: "Solo un ejemplo — la elegibilidad real depende del perfil completo de su negocio.",
  },
} as const;

export default function FilingPathStory({ language }: { language: Language }) {
  const c = copy[language];
  const tokens = useMemo(() => tokenize(c.sentence, [...c.marks]), [c]);
  const markTokens = useMemo(() => tokens.filter((t) => t.mark), [tokens]);

  const sectionRef = useRef<HTMLElement | null>(null);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  // Tracks whether the current effect run is a language toggle (a settings
  // change, not a visit).
  const prevLanguageRef = useRef<Language | null>(null);

  const [typedCount, setTypedCount] = useState(0);
  const [caretDone, setCaretDone] = useState(false);
  const [parseOn, setParseOn] = useState(false);
  const [parseSettled, setParseSettled] = useState(false);
  const [parseLabel, setParseLabel] = useState<string>(c.parseReading);
  const [markedCount, setMarkedCount] = useState(0);
  const [liftedCount, setLiftedCount] = useState(0);
  const [agenciesShown, setAgenciesShown] = useState(0);
  const [stepsShown, setStepsShown] = useState(0);
  const [incentivesShown, setIncentivesShown] = useState(0);

  // The typewriter is a content reveal the site owner explicitly wants visible,
  // so the JS timeline always runs: with `prefers-reduced-motion` the CSS
  // keyframe flourishes (caret blink, float, pulse, smoke) are still disabled
  // by the media query in the stylesheet, but the sentence itself types out
  // instead of appearing instantly. Assistive tech gets the full sentence
  // immediately via the sr-only paragraph below.
  const effTypedCount = typedCount;
  const effCaretDone = caretDone;
  const effParseOn = parseOn;
  const effParseSettled = parseSettled;
  const effParseLabel = parseLabel;
  const effMarkedCount = markedCount;
  const effLiftedCount = liftedCount;
  const effAgenciesShown = agenciesShown;
  const effStepsShown = stepsShown;
  const effIncentivesShown = incentivesShown;

  const reset = () => {
    setTypedCount(0);
    setCaretDone(false);
    setParseOn(false);
    setParseSettled(false);
    setParseLabel(c.parseReading);
    setMarkedCount(0);
    setLiftedCount(0);
    setAgenciesShown(0);
    setStepsShown(0);
    setIncentivesShown(0);
  };

  useEffect(() => {
    const section = sectionRef.current;
    const anchor = anchorRef.current;
    if (!section || !anchor) return;
    const compactLayout = window.matchMedia("(max-width: 959px)").matches;

    // A language toggle is a settings change, not a new visit: show the
    // finished panel immediately instead of replaying the reveal from blank.
    const languageSwitched =
      prevLanguageRef.current !== null && prevLanguageRef.current !== language;
    prevLanguageRef.current = language;

    let armed = !languageSwitched;
    if (languageSwitched) {
      setTypedCount(c.sentence.length);
      setCaretDone(true);
      setParseOn(true);
      setParseSettled(true);
      setParseLabel(c.parseMapped);
      setMarkedCount(markTokens.length);
      setLiftedCount(markTokens.length);
      setAgenciesShown(c.agencies.length);
      setStepsShown(c.path.length);
      setIncentivesShown(c.incentives.length);
    }

    let runId = 0;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const pause = (ms: number, id: number) =>
      new Promise<void>((resolve) => {
        timers.push(setTimeout(resolve, ms));
      }).then(() => id === runId);

    // One cinematic speed for every play. The typing itself is deliberately
    // paced (~50/75ms per character) so it reads as typing rather than a
    // flicker; the earlier double-speed "catch up" play is gone because the
    // reveal no longer burns itself at page load.
    async function run() {
      const id = ++runId;
      reset();
      if (!(await pause(500, id))) return;

      for (const token of tokens) {
        for (let i = token.start + 1; i <= token.end; i++) {
          setTypedCount(i);
          if (!(await pause(token.mark ? 75 : 50, id))) return;
        }
      }
      setCaretDone(true);
      if (!(await pause(420, id))) return;

      setParseOn(true);
      for (let i = 1; i <= markTokens.length; i++) {
        setMarkedCount(i);
        if (!(await pause(230, id))) return;
      }
      if (!(await pause(180, id))) return;
      setParseLabel(c.parseDetails(markTokens.length));
      setParseSettled(true);
      if (!(await pause(320, id))) return;

      for (let i = 1; i <= markTokens.length; i++) {
        setLiftedCount(i);
        if (!(await pause(150, id))) return;
      }
      if (!(await pause(280, id))) return;

      setParseLabel(c.parseAgencies(c.agencies.length));
      for (let i = 1; i <= c.agencies.length; i++) {
        setAgenciesShown(i);
        if (!(await pause(70, id))) return;
      }
      if (!(await pause(360, id))) return;

      setParseLabel(c.parseMapped);
      for (let i = 1; i <= c.path.length; i++) {
        setStepsShown(i);
        if (!(await pause(430, id))) return;
      }
      if (!(await pause(300, id))) return;

      for (let i = 1; i <= c.incentives.length; i++) {
        setIncentivesShown(i);
        if (!(await pause(150, id))) return;
      }
    }

    // The reveal plays when the human is actually looking at the panel — not
    // at page load while they're still reading the hero. With a short hero
    // the sentence can already sit inside the viewport on load; starting the
    // sequence then burns the whole typing effect unseen. So the first play
    // waits for the user's first scroll (or, if they never scroll, a short
    // fallback delay), and any later scroll back into view replays it.
    let userScrolled = window.scrollY > 40;
    let played = false;
    let scrollRestarted = false;
    const anchorInView = () => {
      const r = anchor.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      return r.top < vh * 0.9 && r.bottom > vh * 0.1;
    };
    const tryPlay = () => {
      if (!armed || played) return;
      if (anchorInView()) {
        played = true;
        void run();
      }
    };
    const onScroll = () => {
      if (window.scrollY > 40) userScrolled = true;
      if (!userScrolled || !anchorInView()) return;
      if (!played) {
        tryPlay();
      } else if (!scrollRestarted) {
        // The fallback below may have started the reveal before the human
        // looked at the panel; the first real scroll restarts it from blank
        // so they see the typing from the beginning.
        scrollRestarted = true;
        void run();
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    // The panel never sits blank forever: if it's visible at load and the
    // user doesn't scroll, the reveal starts on its own after a beat.
    timers.push(setTimeout(tryPlay, 4000));

    const player = new IntersectionObserver(
      ([entry]) => {
        // Observer-driven plays only happen once the user has scrolled the
        // section into view themselves; the at-load case is handled by the
        // scroll listener + fallback above.
        if (entry.isIntersecting && armed && !played && userScrolled) {
          played = true;
          void run();
        }
      },
      { threshold: 0, rootMargin: compactLayout ? "0px 0px -10% 0px" : "0px 0px -50% 0px" },
    );
    player.observe(anchor);

    const rearm = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting && played) {
          played = false;
          armed = true;
          runId++;
          timers.splice(0).forEach(clearTimeout);
          reset();
        }
      },
      { threshold: 0 },
    );
    rearm.observe(section);

    return () => {
      runId++;
      timers.splice(0).forEach(clearTimeout);
      player.disconnect();
      rearm.disconnect();
      window.removeEventListener("scroll", onScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  return (
    <section id="how-it-works" ref={sectionRef} className={styles.pin} aria-labelledby="filing-path-title">
      <div className={styles.frame}>
        <div className={styles.headingRow}>
          <h2 id="filing-path-title" className={styles.heading}>{c.mapped}</h2>
          <span className={styles.summary}>{c.summary}</span>
        </div>

        {/* Full sentence for assistive tech / no-JS; the animated version below is aria-hidden. */}
        <p className={styles.srOnly}>{c.sentence}</p>

        <div ref={anchorRef} className={styles.sentence} aria-hidden="true">
          {tokens.map((token, i) => {
            const markIndex = markTokens.indexOf(token);
            const revealed = token.text.slice(0, Math.max(0, effTypedCount - token.start));
            if (!revealed) return null;
            const isMarked = token.mark && markIndex < effMarkedCount;
            const isLifted = token.mark && markIndex < effLiftedCount;
            return (
              <span
                key={i}
                className={
                  token.mark
                    ? `${styles.tok} ${styles.key} ${isMarked ? styles.marked : ""} ${isLifted ? styles.lifted : ""}`
                    : styles.tok
                }
              >
                {revealed}
              </span>
            );
          })}
          <span className={`${styles.caret} ${effCaretDone ? styles.caretDone : ""}`} />
        </div>

        <div
          className={`${styles.parse} ${effParseOn ? styles.on : ""} ${effParseSettled ? styles.settled : ""}`}
          aria-hidden="true"
        >
          <span className={styles.pulse} />
          <span>{effParseLabel}</span>
        </div>

        <div className={styles.chips} aria-hidden="true">
          {c.chips.map((label, i) => (
            <div key={label} className={`${styles.chip} ${i < effLiftedCount ? styles.in : ""}`}>
              {label}
            </div>
          ))}
        </div>

        <p className={styles.agencies}>
          {c.agencies.map((agency, i) => (
            <span key={agency} className={`${styles.ag} ${i < effAgenciesShown ? styles.in : ""}`}>
              {agency}
              {i < c.agencies.length - 1 ? <span className={styles.dot}>•</span> : null}
            </span>
          ))}
        </p>

        <div className={styles.stepsWrap}>
          <ol className={styles.steps}>
            {c.path.map((step, i) => {
              const Icon = STEP_ICONS[i];
              return (
                <li key={step.title} className={`${styles.step} ${i < effStepsShown ? styles.in : ""}`}>
                  <div className={styles.node}>
                    <Icon size={16} strokeWidth={1.5} aria-hidden="true" />
                  </div>
                  {/* A plain CSS line between fixed-position circles — always
                      geometrically correct, no measurement involved. */}
                  {i < c.path.length - 1 ? <span className={styles.connector} aria-hidden="true" /> : null}
                  <h3>{step.title}</h3>
                  <p>{step.detail}</p>
                </li>
              );
            })}
          </ol>
        </div>

        <div className={styles.incentivesWrap}>
          <p className={styles.incentivesLabel}>{c.incentivesLabel}</p>
          <ul className={styles.incentives}>
            {c.incentives.map((incentive, i) => (
              <li key={incentive} className={`${styles.incentive} ${i < effIncentivesShown ? styles.in : ""}`}>
                <Lightbulb size={13} strokeWidth={1.75} aria-hidden="true" />
                <span>{incentive}</span>
              </li>
            ))}
          </ul>
          <p className={styles.incentivesNote}>{c.incentivesNote}</p>
        </div>
      </div>
    </section>
  );
}
