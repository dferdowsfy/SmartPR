"use client";

import { Check, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
  title,
  contextTitle,
  contextBody,
  options,
  onAnswer,
  onNotSure,
}: {
  language: Language;
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
  // The chosen answer stays visibly selected for a beat before the engine
  // moves on, so the user registers what they picked.
  const [picked, setPicked] = useState<boolean | string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const choose = (value: boolean | string) => {
    if (picked !== null) return;
    setPicked(value);
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    timer.current = setTimeout(() => onAnswer(value), reduce ? 60 : 200);
  };
  const cls = (value: boolean | string) => `spr-answer-choice${picked === value ? " selected" : ""}`;
  return (
    <div className="spr-follow-up">
      <div className="spr-kicker">{es ? "Pregunta por confirmar" : "Question to confirm"}</div>
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
            <button key={option.value} type="button" className={cls(option.value)} aria-pressed={picked === option.value} disabled={picked !== null && picked !== option.value} onClick={() => choose(option.value)}>
              {picked === option.value && <Check className="i" aria-hidden="true" />} {option.label}
            </button>
          ))}
        </div>
      ) : (
        <div className="spr-answer-row spr-answer-yesno" role="group" aria-label={title}>
          <button type="button" className={cls(true)} aria-pressed={picked === true} disabled={picked === false} onClick={() => choose(true)}><Check className="i" aria-hidden="true" /> {es ? "Sí" : "Yes"}</button>
          <button type="button" className={cls(false)} aria-pressed={picked === false} disabled={picked === true} onClick={() => choose(false)}><X className="i" aria-hidden="true" /> No</button>
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
