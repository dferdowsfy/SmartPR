"use client";

// The inline action area of a collapsed checklist row: one primary button,
// an overflow (⋯) menu for the rest, a check + "View" once done, or an
// "Answer" button that opens only the question. Clicks never reach the row
// toggle (stopPropagation) and run the card's own handlers.

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { ArrowRight, CheckCircle2, ClipboardList, Download, ExternalLink, FileText, HelpCircle, Lock, MoreHorizontal, Sparkles, Upload } from "lucide-react";
import type { RowActionsModel, RowCta, RowCtaKind } from "./rowActions";

type Language = "en" | "es";

const stop = (e: MouseEvent) => e.stopPropagation();

function Icon({ kind, locked }: { kind: RowCtaKind; locked?: boolean }) {
  if (locked) return <Lock size={14} aria-hidden="true" />;
  switch (kind) {
    case "form": return <ClipboardList size={14} aria-hidden="true" />;
    case "upload":
    case "confirm": return <Upload size={14} aria-hidden="true" />;
    case "assist": return <Sparkles size={14} aria-hidden="true" />;
    case "download": return <Download size={14} aria-hidden="true" />;
    case "instructions": return <FileText size={14} aria-hidden="true" />;
    case "site": return <ExternalLink size={14} aria-hidden="true" />;
    default: return <ArrowRight size={14} aria-hidden="true" />;
  }
}

function CtaControl({ c, className, role, onDone, testId = "row-cta" }: { c: RowCta; className: string; role?: string; onDone?: () => void; testId?: string }) {
  const common = {
    className,
    role,
    title: c.title !== c.label ? c.title : undefined,
    "aria-label": c.title,
    "data-testid": testId,
    "data-cta": c.kind,
  };
  const click = (e: MouseEvent) => {
    e.stopPropagation();
    c.onClick?.();
    onDone?.();
  };
  if (c.href) {
    return (
      <a {...common} href={c.href} onClick={click} target={c.external ? "_blank" : undefined} rel={c.external ? "noopener noreferrer" : undefined}>
        <Icon kind={c.kind} locked={c.locked} /> <span>{c.label}</span>
        {c.external && c.kind !== "site" && <ExternalLink size={12} aria-hidden="true" />}
      </a>
    );
  }
  return (
    <button type="button" {...common} onClick={click}>
      <Icon kind={c.kind} locked={c.locked} /> <span>{c.label}</span>
    </button>
  );
}

export function RowActions({
  model,
  language,
  onAnswer,
  answerOpen = false,
}: {
  model: RowActionsModel;
  language: Language;
  /** Opens / closes the row's question strip (answer-only rows). */
  onAnswer?: () => void;
  answerOpen?: boolean;
}) {
  const es = language === "es";
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [menu]);

  const { primary, more, done, answer } = model;
  if (!primary && !more.length && !done && !(answer && onAnswer)) return null;
  return (
    <div className="ck-line-actions" ref={ref} onClick={stop} data-testid="row-actions">
      {done && (
        done.onClick ? (
          <button type="button" className="ck-cta ck-cta-view" data-testid="row-cta" data-cta="view" onClick={(e) => { e.stopPropagation(); done.onClick!(); }}>
            <CheckCircle2 size={15} aria-hidden="true" /> <span>{done.label}</span>
          </button>
        ) : (
          <span className="ck-done" data-testid="row-done"><CheckCircle2 size={15} aria-hidden="true" /> {done.label}</span>
        )
      )}
      {!done && answer && onAnswer && (
        <button type="button" className="ck-cta ck-cta-answer" data-testid="row-cta" data-cta="answer" aria-expanded={answerOpen} onClick={(e) => { e.stopPropagation(); onAnswer(); }}>
          <HelpCircle size={14} aria-hidden="true" /> <span>{es ? "Responder" : "Answer"}</span>
        </button>
      )}
      {primary && <CtaControl c={primary} className={`ck-cta ck-cta-${primary.kind}`} />}
      {more.length > 0 && (
        <span className="ck-more">
          <button
            type="button"
            className="ck-more-btn"
            aria-haspopup="menu"
            aria-expanded={menu}
            aria-label={es ? "Más acciones" : "More actions"}
            data-testid="row-more"
            onClick={(e) => { e.stopPropagation(); setMenu((m) => !m); }}
          >
            <MoreHorizontal size={16} aria-hidden="true" />
          </button>
          {menu && (
            <span className="ck-more-menu" role="menu">
              {more.map((c) => (
                <CtaControl key={`${c.id}-${c.kind}`} c={c} className="ck-more-item" role="menuitem" testId="row-more-item" onDone={() => setMenu(false)} />
              ))}
            </span>
          )}
        </span>
      )}
    </div>
  );
}

/** Every action of a row, as plain buttons — the expanded view of the same handlers. */
export function ActionList({ model }: { model: RowActionsModel }) {
  const all = [model.primary, ...model.more].filter((c): c is RowCta => !!c);
  if (!all.length) return null;
  return (
    <div className="ck-card-actions">
      {all.map((c) => <CtaControl key={`${c.id}-${c.kind}`} c={{ ...c, label: c.title }} className="ck-action" testId="card-action" />)}
    </div>
  );
}

/** The question strip an "Answer" button opens under the row (not the details). */
export function RowQuestion({ prompt, yesLabel, noLabel, onYes, onNo }: { prompt: string; yesLabel: string; noLabel: string; onYes: () => void; onNo: () => void }) {
  return (
    <div className="ck-row-question" role="group" aria-label={prompt} data-testid="row-question">
      <span className="ck-q-text">{prompt}</span>
      <span className="ck-q-actions">
        <button type="button" onClick={onYes}>{yesLabel}</button>
        <button type="button" onClick={onNo}>{noLabel}</button>
      </span>
    </div>
  );
}
