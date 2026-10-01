"use client";

// Shared pieces of the checklist presentation used by every requirement
// group (business, construction, registrations, energy): one-line summary,
// up to three one-line questions, status pills, and an (i) that holds the
// longer rationale instead of printing it inline.

import { useState, type ReactNode } from "react";
import { CheckCircle, Info } from "lucide-react";
import { CHECKLIST_STATUS_LABELS, type ChecklistStatus } from "../../processes/presentation";

type Language = "en" | "es";

export function StatusPill({ status, language, label }: { status: ChecklistStatus; language: Language; label?: string }) {
  return <span className={`ck-pill ck-pill-${status}`} data-status={status}>{label ?? CHECKLIST_STATUS_LABELS[status][language]}</span>;
}

/** Small (i) that reveals a longer explanation on click (keyboard accessible). */
export function InfoTip({ text, language }: { text: string; language: Language }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  return (
    <span className="ck-info">
      <button type="button" className="ck-info-btn" aria-expanded={open} aria-label={language === "es" ? "Más información" : "More information"} onClick={() => setOpen((o) => !o)}>
        <Info size={14} aria-hidden="true" />
      </button>
      {open && <span className="ck-info-text" role="note">{text}</span>}
    </span>
  );
}

export interface SummaryQuestion {
  id: string;
  text: string;
  why?: string;
  /** Buttons (enum / boolean). */
  options?: { label: string; onClick: () => void }[];
  /** Free-text / number answer. */
  input?: { numeric: boolean; onSubmit: (value: string) => void };
  /** Multi-select (list facts): toggle chips, then Save. */
  multi?: { options: { value: string; label: string }[]; onSubmit: (values: string[]) => void };
}

export function QuestionLine({ q, language, standalone = false }: { q: SummaryQuestion; language: Language; standalone?: boolean }) {
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const toggle = (v: string) => setPicked((cur) => (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]));
  return (
    <div role={standalone ? "group" : "listitem"} aria-label={standalone ? q.text : undefined} className={`ck-q ${standalone ? "ck-row-question" : ""}`} data-testid={standalone ? "row-question" : `summary-q-${q.id}`}>
      <span className="ck-q-text">{q.text}</span>
      {q.why && <InfoTip text={q.why} language={language} />}
      <span className="ck-q-actions">
        {q.options?.map((o) => (
          <button type="button" key={o.label} onClick={o.onClick}>{o.label}</button>
        ))}
        {q.multi && (
          <span className="ck-q-multi" role="group" aria-label={q.text}>
            {q.multi.options.map((o) => (
              <button
                type="button"
                key={o.value}
                className={`ck-chip ${picked.includes(o.value) ? "ck-chip-on" : ""}`}
                aria-pressed={picked.includes(o.value)}
                onClick={() => toggle(o.value)}
              >
                {o.label}
              </button>
            ))}
            <button type="button" className="ck-q-save" disabled={picked.length === 0} onClick={() => q.multi!.onSubmit(picked)}>
              {language === "es" ? "Guardar" : "Save"}
            </button>
          </span>
        )}
        {q.input && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const v = text.trim();
              if (v) q.input!.onSubmit(v);
            }}
          >
            <input value={text} onChange={(e) => setText(e.target.value)} inputMode={q.input.numeric ? "decimal" : "text"} aria-label={q.text} />
            <button type="submit">{language === "es" ? "Guardar" : "Save"}</button>
          </form>
        )}
      </span>
    </div>
  );
}

export function ChecklistSummary({
  line,
  readiness,
  questions,
  answered,
  language,
  location,
}: {
  line: string;
  /** Location line under the summary ("Rules for: …" / pending Location action). */
  location?: ReactNode;
  readiness?: { satisfied: number; total: number } | null;
  questions: SummaryQuestion[];
  /** Already-answered questions stay visible with their selected answer. */
  answered?: { id: string; text: string; valueLabel: string; onChange: () => void }[];
  language: Language;
}) {
  const es = language === "es";
  return (
    <section className="ck-summary" data-testid="requirements-summary">
      <p className="ck-summary-line">{line}</p>
      {location}
      {readiness && readiness.total > 0 && (
        <p className="ck-summary-readiness">
          {es ? "Preparación" : "Readiness"}: {readiness.satisfied}/{readiness.total} {es ? "documentos listos" : "documents ready"}
        </p>
      )}
      {questions.length > 0 && (
        <div role="list" className="ck-questions" aria-label={es ? "Preguntas por responder" : "Questions to answer"}>
          {questions.map((q) => <QuestionLine key={q.id} q={q} language={language} />)}
        </div>
      )}
      {answered && answered.length > 0 && (
        <ul className="spr-answered-list ck-answered" aria-label={es ? "Preguntas respondidas" : "Answered questions"}>
          {answered.map((a) => (
            <li key={a.id}>
              <CheckCircle className="i" style={{ width: 14, height: 14 }} />
              <span className="spr-answered-text">{a.text}</span>
              <span className="spr-answered-value">{a.valueLabel}</span>
              <button type="button" className="spr-answered-change" onClick={a.onChange}>
                {es ? "Cambiar" : "Change"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** "Show full reasoning" — raw trace for auditors, collapsed by default. */
export function FullReasoning({ language, children, open = false }: { language: Language; children: ReactNode; open?: boolean }) {
  return (
    <details className="ck-full" open={open || undefined}>
      <summary>{language === "es" ? "Ver razonamiento completo" : "Show full reasoning"}</summary>
      <div className="ck-full-body">{children}</div>
    </details>
  );
}

export function ConfidenceBadge({ confidence, language }: { confidence: "high" | "medium" | "low"; language: Language }) {
  const label = language === "es"
    ? { high: "confianza alta", medium: "confianza media", low: "confianza baja" }[confidence]
    : { high: "high confidence", medium: "medium confidence", low: "low confidence" }[confidence];
  return <span className={`ck-conf ck-conf-${confidence}`}>{label}</span>;
}
