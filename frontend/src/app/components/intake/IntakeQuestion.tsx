"use client";

import { CheckCircle, XCircle } from "lucide-react";
import { L } from "../../i18n";

type Language = "en" | "es";

export interface IntakeQuestionOption {
  value: string;
  /** Already translated label. */
  label: string;
}

/**
 * The single question interaction for the whole product. Every intake
 * question — guided yes/no, multiple-choice, or municipality-flag follow-up —
 * renders through here so the UX cannot drift back into per-flow button
 * paradigms (e.g. "Applies / Does Not Apply"). Yes/No is the primary
 * interaction everywhere; "Not Sure" is an optional quiet escape hatch.
 */
export function IntakeQuestion({
  language,
  questionNumber,
  questionTotal,
  title,
  contextTitle,
  contextBody,
  options,
  onAnswer,
  onNotSure,
}: {
  language: Language;
  questionNumber: number;
  questionTotal: number;
  title: string;
  contextTitle?: string;
  contextBody?: string;
  /** Multiple-choice options; when omitted the question is Yes/No. */
  options?: IntakeQuestionOption[];
  onAnswer: (value: boolean | string) => void;
  /** Tertiary escape hatch rendered quietly under the answer row. Omit to hide. */
  onNotSure?: () => void;
}) {
  const es = language === "es";
  return (
    <div className="spr-follow-up">
      <div className="spr-kicker">{L("Question", language)} {questionNumber} {L("of", language)} {questionTotal}</div>
      <h2>{title}</h2>
      {contextBody && (
        <p className="spr-question-context">
          {contextTitle && <strong>{contextTitle}</strong>}
          <span>{contextBody}</span>
        </p>
      )}
      {options ? (
        <div className={`spr-answer-row ${options.length >= 3 ? "spr-answer-row-three" : ""}`}>
          {options.map((option) => (
            <button key={option.value} onClick={() => onAnswer(option.value)}>
              {option.label}
            </button>
          ))}
        </div>
      ) : (
        <div className="spr-answer-row">
          <button onClick={() => onAnswer(true)}><CheckCircle className="i" /> {es ? "Sí" : "Yes"}</button>
          <button onClick={() => onAnswer(false)}><XCircle className="i" /> {es ? "No" : "No"}</button>
        </div>
      )}
      {onNotSure && (
        <button type="button" onClick={onNotSure} className="spr-not-sure">
          {L("Not Sure", language)}
        </button>
      )}
    </div>
  );
}
