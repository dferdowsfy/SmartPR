"use client";

// The inline action area of a collapsed checklist row: one primary button,
// an overflow (⋯) menu for the rest, a check + "View" once done, or an
// "Answer" button that opens only the question. Clicks never reach the row
// toggle (stopPropagation) and run the card's own handlers.

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { ArrowRight, CheckCircle2, ClipboardList, Download, ExternalLink, FileText, GraduationCap, HelpCircle, ListChecks, Lock, Loader2, MessageCircle, MoreHorizontal, Sparkles, Upload } from "lucide-react";
import type { RowActionsModel, RowCta, RowCtaKind } from "./rowActionModel";
import { STANDARD_LABELS, type RequirementActions } from "./requirementActions";
import { usePendingAction } from "./usePendingAction";

type Language = "en" | "es";

const stop = (e: MouseEvent) => e.stopPropagation();

function Icon({ kind, locked, ask }: { kind: RowCtaKind; locked?: boolean; ask?: boolean }) {
  if (ask) return <MessageCircle size={14} aria-hidden="true" />;
  if (locked) return <Lock size={14} aria-hidden="true" />;
  switch (kind) {
    case "form":
    case "guided": return <ClipboardList size={14} aria-hidden="true" />;
    case "teach": return <GraduationCap size={14} aria-hidden="true" />;
    case "upload":
    case "confirm": return <Upload size={14} aria-hidden="true" />;
    case "assist": return <Sparkles size={14} aria-hidden="true" />;
    case "download": return <Download size={14} aria-hidden="true" />;
    case "instructions": return <FileText size={14} aria-hidden="true" />;
    case "site":
    case "portal": return <ExternalLink size={14} aria-hidden="true" />;
    case "start": return <ListChecks size={14} aria-hidden="true" />;
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
        <Icon kind={c.kind} locked={c.locked} ask={c.id === "ask"} /> <span>{c.label}</span>
        {c.external && c.kind !== "site" && c.kind !== "portal" && <ExternalLink size={12} aria-hidden="true" />}
      </a>
    );
  }
  return (
    <button type="button" {...common} onClick={click}>
      <Icon kind={c.kind} locked={c.locked} ask={c.id === "ask"} /> <span>{c.label}</span>
    </button>
  );
}

/**
 * The row's title, with the "Clara learned this" chip under it when the row
 * has a validated taught routine. The chip lives with the title (not with the
 * action buttons) so the actions column keeps its fixed width and never
 * overflows the row; long names truncate.
 */
export function RowName({ name, model, language }: { name: string; model: RowActionsModel; language: Language }) {
  const es = language === "es";
  const learned = model.done ? undefined : model.learned;
  if (!learned) return <span className="ck-name">{name}</span>;
  const label = learned === "learned" ? (es ? "Clara lo aprendió" : "Clara learned this") : (es ? "Hay que enseñarle otra vez" : "Needs re-teaching");
  const tip = learned === "learned" ? (es ? "Clara sigue exactamente los pasos que le enseñaste" : "Clara follows exactly the steps you taught her") : (es ? "El portal cambió — enséñale otra vez" : "The portal changed — teach her again");
  return (
    <span className="ck-name-stack">
      <span className="ck-name">{name}</span>
      <span className={`ck-learned ck-learned-${learned}`} data-testid="row-learned" title={tip}>
        <GraduationCap size={13} aria-hidden="true" /> {label}
      </span>
    </span>
  );
}

function useMenu() {
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
  return { menu, setMenu, ref };
}

/**
 * The standard action column, identical on every requirement row:
 * [Clara slot] · Complete · ⋯ (View details is the first ⋯ item); Complete
 * reads "Upload" when uploading proof is all SmartPR can do for the row. Positions
 * never change; each row's own capabilities decide only what a click does
 * (the route is exposed as data-route and in the tooltip). The Clara slot
 * is always empty on requirement rows (Clara rule, 2026-10-12): Clara files
 * finished filings from the filing hub — she never fills a requirement.
 */
export function StandardRowActions({ actions, language, answerOpen = false }: { actions: RequirementActions; language: Language; answerOpen?: boolean }) {
  const lang = language;
  const { menu, setMenu, ref } = useMenu();
  const { clara, complete, done, overflow } = actions;
  const { pending, run: runPending } = usePendingAction<"clara" | "complete">();
  const run = (key: "clara" | "complete", a: { onClick?: () => void; href?: string; route?: string; external?: boolean }) => (e: MouseEvent) => {
    e.stopPropagation();
    if (pending) {
      e.preventDefault();
      return;
    }
    // Quick, or needs the click's user gesture (file picker, new tab): run now, no spinner.
    if (a.route === "upload" || a.route === "blocked" || a.route === "government" || a.external) {
      a.onClick?.();
      return;
    }
    if (a.href && !a.onClick) runPending(key, () => undefined, { deferred: false });
    else runPending(key, a.onClick, { deferred: !a.href });
  };
  const opening = <><Loader2 size={14} className="rq-spin" aria-hidden="true" /> <span>{lang === "es" ? "Abriendo…" : "Opening…"}</span></>;
  const link = (a: { href?: string; external?: boolean }) =>
    a.href ? { href: a.href, target: a.external ? "_blank" : undefined, rel: a.external ? "noopener noreferrer" : undefined } : null;
  const claraLink = link(clara);
  const completeLink = link(complete);
  const claraInner = pending === "clara" ? opening : <><Sparkles size={14} aria-hidden="true" /> <span>{STANDARD_LABELS.clara[lang]}</span></>;
  const isUpload = complete.route === "upload";
  const completeInner = pending === "complete" ? opening : <>{complete.locked ? <Lock size={14} aria-hidden="true" /> : isUpload ? <Upload size={14} aria-hidden="true" /> : <CheckCircle2 size={14} aria-hidden="true" />} <span>{(isUpload ? STANDARD_LABELS.upload : STANDARD_LABELS.complete)[lang]}</span></>;
  return (
    <div className="rq-std-actions" ref={ref} onClick={stop} data-testid="row-actions">
      {clara.route === "explain" ? (
        // Clara can't file this row: no button (Complete leads to the form
        // that hands off to her); the empty slot keeps rows aligned.
        <span className="rq-std-btn rq-std-clara rq-std-slot" aria-hidden="true" data-testid="row-clara" data-route="explain" />
      ) : claraLink ? (
        <a {...claraLink} className="rq-std-btn rq-std-clara" title={clara.title} data-testid="row-clara" data-route={clara.route} aria-busy={pending === "clara" || undefined} onClick={run("clara", clara)}>{claraInner}</a>
      ) : (
        <button type="button" className="rq-std-btn rq-std-clara" title={clara.title} data-testid="row-clara" data-route={clara.route} aria-busy={pending === "clara" || undefined} onClick={run("clara", clara)}>{claraInner}</button>
      )}
      {done ? (
        <button type="button" className="rq-std-btn rq-std-complete rq-std-done" data-testid="row-complete" data-route="done" disabled={!done.onClick} onClick={(e) => { e.stopPropagation(); done.onClick?.(); }}>
          <CheckCircle2 size={14} aria-hidden="true" /> <span>{STANDARD_LABELS.done[lang]}</span>
        </button>
      ) : completeLink ? (
        <a {...completeLink} className="rq-std-btn rq-std-complete" title={complete.title} data-testid="row-complete" data-route={complete.route} aria-busy={pending === "complete" || undefined} onClick={run("complete", complete)}>{completeInner}</a>
      ) : (
        <button type="button" className="rq-std-btn rq-std-complete" title={complete.title} data-testid="row-complete" data-route={complete.route} aria-expanded={complete.route === "blocked" ? answerOpen : undefined} aria-busy={pending === "complete" || undefined} onClick={run("complete", complete)}>{completeInner}</button>
      )}
      <span className="ck-more rq-std-more">
        <button
          type="button"
          className="ck-more-btn"
          aria-haspopup="menu"
          aria-expanded={menu}
          aria-label={lang === "es" ? "Más acciones" : "More actions"}
          data-testid="row-more"
          onClick={(e) => { e.stopPropagation(); setMenu((m) => !m); }}
        >
          <MoreHorizontal size={16} aria-hidden="true" />
        </button>
        {menu && (
          <span className="ck-more-menu" role="menu">
            <button type="button" role="menuitem" className="ck-more-item rq-std-more-details" data-testid="row-details" onClick={(e) => { e.stopPropagation(); setMenu(false); actions.onViewDetails(); }}>
              <FileText size={14} aria-hidden="true" /> <span>{STANDARD_LABELS.details[lang]}</span>
            </button>
            {overflow.map((c) => (
              <CtaControl key={`${c.id}-${c.kind}`} c={{ ...c, label: c.title }} className="ck-more-item" role="menuitem" testId="row-more-item" onDone={() => setMenu(false)} />
            ))}
          </span>
        )}
      </span>
    </div>
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
  const { menu, setMenu, ref } = useMenu();

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
