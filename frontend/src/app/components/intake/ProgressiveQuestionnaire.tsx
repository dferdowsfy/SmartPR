"use client";

/**
 * Progressive interview for the intake's conditional questions.
 *
 * Presentation only: which question is active, which are answered and what
 * an answer does stay with the intake engine (SmartPRIntake). This component
 * keeps the path visible — answered questions collapse into compact rows in
 * the order they were asked, the active question opens directly under them,
 * and "Change" reopens a question in its own slot.
 *
 * Question states: active · answered · editing (active again in its earlier
 * slot) · not applicable (dropped by the engine → removed from the path).
 * Every row is keyed by the question's stable id, never an index.
 */
import { CheckCircle2 } from "lucide-react";
import { useState, type ReactNode } from "react";

type Language = "en" | "es";

export interface AnsweredItem {
  id: string;
  text: string;
  valueLabel: string;
  badge?: string;
  onChange: () => void;
}

/** Recent answers shown as rows; older ones fold under "View previous answers". */
const RECENT = 3;

export function ProgressiveQuestionnaire({
  language,
  remaining,
  answered,
  active,
}: {
  language: Language;
  /** Questions still to answer (including the active one). */
  remaining: number;
  answered: AnsweredItem[];
  /** The active question: its stable id + the rendered question card. */
  active: { id: string; node: ReactNode } | null;
}) {
  const es = language === "es";
  const [showOlder, setShowOlder] = useState(false);

  // Path order = the order questions were first seen. A reopened question
  // keeps its slot (inline editing); new questions append under the path.
  const [seen, setSeen] = useState<string[]>([]);
  const ids = [...answered.map((a) => a.id), ...(active ? [active.id] : [])];
  const present = new Set(ids);
  const order = [...seen.filter((id) => present.has(id)), ...ids.filter((id) => !seen.includes(id))];
  if (order.length !== seen.length || order.some((id, i) => id !== seen[i])) setSeen(order);

  // Questions answered at some point: active again = editing.
  const [everAnswered, setEverAnswered] = useState<string[]>([]);
  const newlyAnswered = answered.map((a) => a.id).filter((id) => !everAnswered.includes(id));
  if (newlyAnswered.length) setEverAnswered([...everAnswered, ...newlyAnswered]);

  const byId = new Map(answered.map((a) => [a.id, a]));
  const path = order.filter((id) => byId.has(id) || id === active?.id);
  const activeAt = active ? path.indexOf(active.id) : -1;
  // Fold answers older than the last RECENT before the active one (or the end).
  const anchor = activeAt >= 0 ? activeAt : path.length;
  const foldBefore = showOlder ? 0 : Math.max(0, anchor - RECENT);
  const older = path.slice(0, foldBefore);

  return (
    <section className="spr-pq" aria-labelledby="spr-pq-title" data-testid="progressive-questionnaire">
      <header className="spr-pq-head">
        <div>
          <h3 id="spr-pq-title" className="spr-pq-title">{es ? "Unos detalles para completar tus requisitos" : "A few details to finish your requirements"}</h3>
          <p className="spr-pq-sub">{es ? "Tus respuestas ayudan a SmartPR a determinar qué requisitos aplican a este proyecto." : "Your answers help SmartPR determine which requirements apply to this project."}</p>
        </div>
        {remaining > 0 && (
          <span className="spr-pq-count" data-testid="questions-remaining">
            {es ? `${remaining} ${remaining === 1 ? "pendiente" : "pendientes"}` : `${remaining} remaining`}
          </span>
        )}
      </header>

      {older.length > 0 && (
        <button type="button" className="spr-pq-older" onClick={() => setShowOlder(true)} data-testid="questions-view-previous">
          {es ? `Ver respuestas anteriores (${older.length})` : `View previous answers (${older.length})`}
        </button>
      )}

      <ol className="spr-pq-path">
        {path.slice(foldBefore).map((id) => {
          if (id === active?.id) {
            return (
              <li key={id} className="spr-pq-item spr-pq-active" data-state={everAnswered.includes(id) ? "editing" : "active"} data-qid={id}>
                {active.node}
              </li>
            );
          }
          const a = byId.get(id)!;
          return (
            <li key={id} className="spr-pq-item spr-pq-answered" data-state="answered" data-qid={id} data-testid="answered-question">
              <CheckCircle2 className="spr-pq-check" aria-hidden="true" />
              <span className="spr-pq-q">{a.text}</span>
              {a.badge && <span className="spr-confirm-badge">{a.badge}</span>}
              <span className="spr-pq-a">{a.valueLabel}</span>
              <button type="button" className="spr-pq-change" onClick={a.onChange} aria-label={`${es ? "Cambiar" : "Change"}: ${a.text}`}>
                {es ? "Cambiar" : "Change"}
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
