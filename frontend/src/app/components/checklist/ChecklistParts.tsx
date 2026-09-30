"use client";

// Shared pieces of the checklist presentation used by every requirement
// group (business, construction, registrations, energy): one-line summary,
// up to three one-line questions, status pills, and an (i) that holds the
// longer rationale instead of printing it inline.

import { useState, type ReactNode } from "react";
import { Info } from "lucide-react";
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
}

function QuestionLine({ q, language }: { q: SummaryQuestion; language: Language }) {
  const [text, setText] = useState("");
  return (
    <li className="ck-q" data-testid={`summary-q-${q.id}`}>
      <span className="ck-q-text">{q.text}</span>
      {q.why && <InfoTip text={q.why} language={language} />}
      <span className="ck-q-actions">
        {q.options?.map((o) => (
          <button type="button" key={o.label} onClick={o.onClick}>{o.label}</button>
        ))}
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
    </li>
  );
}

export function ChecklistSummary({
  line,
  readiness,
  questions,
  language,
}: {
  line: string;
  readiness?: { satisfied: number; total: number } | null;
  questions: SummaryQuestion[];
  language: Language;
}) {
  const es = language === "es";
  return (
    <section className="ck-summary" data-testid="requirements-summary">
      <p className="ck-summary-line">{line}</p>
      {readiness && readiness.total > 0 && (
        <p className="ck-summary-readiness">
          {es ? "Preparación" : "Readiness"}: {readiness.satisfied}/{readiness.total} {es ? "documentos listos" : "documents ready"}
        </p>
      )}
      {questions.length > 0 && (
        <ol className="ck-questions" aria-label={es ? "Preguntas por responder" : "Questions to answer"}>
          {questions.slice(0, 3).map((q) => <QuestionLine key={q.id} q={q} language={language} />)}
        </ol>
      )}
    </section>
  );
}

/** "Show full reasoning" — raw trace for auditors, collapsed by default. */
export function FullReasoning({ language, children }: { language: Language; children: ReactNode }) {
  return (
    <details className="ck-full">
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
