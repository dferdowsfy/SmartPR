"use client";

/**
 * Semantic-intake UI pieces.
 *
 * ExistingPassportCard — an existing business's Passport is loaded: its
 *   identity is known, shown collapsed, never asked again. The description is
 *   treated as a new project of that business.
 * ScenarioQuestions — the knowledge graph's next controlling question, one
 *   at a time. Only questions whose branch the scenario actually reaches.
 */
import { useState } from "react";
import { CheckCircle } from "lucide-react";
import type { PassportDelta, PassportKnownItem, ScenarioEvaluation, ScenarioQuestion } from "../../ai/intake/scenario";

type Lang = "en" | "es";
const T = (lang: Lang, en: string, es: string) => (lang === "es" ? es : en);

export function ExistingPassportCard({
  name,
  projectTitle,
  known,
  deltas,
  lang,
}: {
  name: string;
  projectTitle: string | null;
  known: PassportKnownItem[];
  deltas: PassportDelta[];
  lang: Lang;
}) {
  return (
    <div className="spr-scn-passport" data-testid="existing-passport-card">
      <div className="spr-scn-passport-head">
        <span className="spr-scn-passport-name">{name} —</span>
        <span className="spr-scn-passport-ok">
          <CheckCircle style={{ width: 13, height: 13 }} />
          {T(lang, "Business Passport linked", "Pasaporte comercial vinculado")}
        </span>
      </div>
      <p className="spr-scn-project">
        {T(lang, "New project", "Proyecto nuevo")}:{" "}
        <b>{projectTitle ?? T(lang, "describe it above", "descríbelo arriba")}</b>
      </p>
      {deltas.length > 0 && (
        <ul className="spr-scn-deltas">
          {deltas.map((d) => (
            <li key={d.kind}>{d.message}</li>
          ))}
        </ul>
      )}
      {known.length > 0 && (
        <details className="spr-scn-known" data-testid="passport-known">
          <summary>
            {T(lang, "Already known from your Business Passport", "Ya sabemos por tu Pasaporte comercial")} · {known.length}
          </summary>
          <dl>
            {known.map((k) => (
              <div key={k.key} style={{ display: "contents" }}>
                <dt>{k.label}</dt>
                <dd>{k.value}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </div>
  );
}

function QuestionInput({
  q,
  lang,
  onAnswer,
  onSkip,
}: {
  q: ScenarioQuestion;
  lang: Lang;
  onAnswer: (answer: string | boolean | string[]) => void;
  onSkip: () => void;
}) {
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const notSure = (
    <button type="button" className="spr-scn-q-btn" onClick={onSkip}>
      {T(lang, "Not sure", "No estoy seguro")}
    </button>
  );
  if (q.kind === "boolean") {
    return (
      <div className="spr-scn-q-row">
        <button type="button" className="spr-scn-q-btn primary" onClick={() => onAnswer(true)}>{T(lang, "Yes", "Sí")}</button>
        <button type="button" className="spr-scn-q-btn" onClick={() => onAnswer(false)}>{T(lang, "No", "No")}</button>
        {notSure}
      </div>
    );
  }
  if (q.kind === "choice") {
    return (
      <div className="spr-scn-q-row">
        {(q.options ?? []).map((o) => (
          <button
            key={o.value}
            type="button"
            className="spr-scn-q-btn"
            onClick={() => (o.value === "unknown" ? onSkip() : onAnswer(o.value))}
          >
            {o.label}
          </button>
        ))}
        {!(q.options ?? []).some((o) => o.value === "unknown") && notSure}
      </div>
    );
  }
  if (q.kind === "multi") {
    return (
      <div>
        <div className="spr-scn-q-row">
          {(q.options ?? []).map((o) => {
            const on = picked.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                className="spr-scn-q-btn"
                aria-pressed={on}
                onClick={() => setPicked((cur) => (on ? cur.filter((v) => v !== o.value) : [...cur, o.value]))}
              >
                {o.label}
              </button>
            );
          })}
        </div>
        <div className="spr-scn-q-row" style={{ marginTop: 8 }}>
          <button type="button" className="spr-scn-q-btn primary" onClick={() => onAnswer(picked)}>
            {picked.length ? T(lang, "Continue", "Continuar") : T(lang, "None of these", "Ninguno")}
          </button>
          {notSure}
        </div>
      </div>
    );
  }
  return (
    <form
      className="spr-scn-q-row"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) onAnswer(text.trim());
      }}
    >
      <input
        type="text"
        value={text}
        placeholder={q.placeholder}
        aria-label={q.text}
        onChange={(e) => setText(e.target.value)}
        autoComplete="off"
      />
      <button type="submit" className="spr-scn-q-btn primary" disabled={!text.trim()}>
        {T(lang, "Continue", "Continuar")}
      </button>
      {notSure}
    </form>
  );
}

export function ScenarioQuestions({
  evaluation,
  heading,
  lang,
  onAnswer,
  onSkip,
}: {
  evaluation: ScenarioEvaluation;
  heading: string;
  lang: Lang;
  onAnswer: (q: ScenarioQuestion, answer: string | boolean | string[]) => void;
  onSkip: (q: ScenarioQuestion) => void;
}) {
  const q = evaluation.questions[0];
  const waiting = evaluation.controlling.filter((c) => !evaluation.questions.some((x) => x.controls === c.id));
  if (!q && evaluation.controlling.length === 0) return null;
  return (
    <section className="spr-scn-questions" data-testid="scenario-questions" aria-live="polite">
      <h3>{heading}</h3>
      {q ? (
        <div key={q.id} data-testid={`scenario-question-${q.id}`}>
          <p className="spr-scn-q-text">{q.text}</p>
          <p className="spr-scn-q-why">{q.whyWeAsk}</p>
          <QuestionInput q={q} lang={lang} onAnswer={(a) => onAnswer(q, a)} onSkip={() => onSkip(q)} />
          {evaluation.questions.length > 1 && (
            <p className="spr-scn-q-progress" style={{ marginTop: 8 }}>
              {T(lang, `${evaluation.questions.length - 1} more after this`, `${evaluation.questions.length - 1} más después de esta`)}
            </p>
          )}
        </div>
      ) : (
        <p className="spr-scn-q-why">
          {T(lang, "Nothing else to ask right now.", "No hay nada más que preguntar por ahora.")}
        </p>
      )}
      {waiting.length > 0 && (
        <p className="spr-scn-later">
          {T(lang, "Depending on your answers, SmartPR may also need: ", "Según tus respuestas, SmartPR también podría necesitar: ")}
          {waiting.map((c) => c.label.toLowerCase()).join(", ")}.
        </p>
      )}
    </section>
  );
}
