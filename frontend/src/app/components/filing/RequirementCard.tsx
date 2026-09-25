"use client";

import { useRef, type ReactNode } from "react";
import { CheckCircle2, ChevronDown, ClipboardList, Clock, CloudUpload, ArrowRight, ExternalLink, Lock, Upload, Sparkles, FileText } from "lucide-react";
import type { IconTone } from "./requirementCopy";

export type RequirementActionKind = "upload" | "form" | "waiting" | "completed" | "none";

export interface RequirementAction {
  kind: RequirementActionKind;
  label: string;
  helper?: string;
  onClick?: () => void;
  /** True when completing the document requires a paid plan — the button
   * shows a lock instead of the arrow. The modal opens on the upgrade panel. */
  locked?: boolean;
}

export interface RequirementSecondaryAction {
  /** Accessible label only (e.g. "Already have your EIN?") — the visible
   * button text is just `label`, matching the reference design's quiet
   * "OR [upload button]" pattern rather than a restated question. */
  prompt: string;
  /** e.g. "Upload EIN confirmation" */
  label: string;
  onClick: () => void;
}

export interface RequirementBadge {
  label: string;
  tone: "amber" | "blue" | "gray";
}

export interface RequirementDownload {
  /** Visible button label, already localized by the caller
   * (e.g. "Download form" / "Open again"). */
  label: string;
  url: string;
  /** True once the user has clicked through at least once. */
  downloaded: boolean;
  /** Localized nudge shown after download, e.g. "Got it? Upload the
   * finished document when you're back." */
  downloadedHint: string;
  onDownload: () => void;
}
/** Inline Yes/No prompt for an unanswered trigger question — rendered in
 * the action column when a requirement is conditional only because the
 * triggering answer is still unknown. */
export interface RequirementAnswerPrompt {
  /** Localized question text, e.g. "Does the business handle hazardous materials?" */
  prompt: string;
  yesLabel: string;
  noLabel: string;
  onYes: () => void;
  onNo: () => void;
}

export interface RequirementAnswerPrompt {
  /** The question to answer inline, already localized (e.g. "Do you lease
   * your commercial space?"). Only ever shown when the answer is genuinely
   * unknown — answering writes a real discovery answer. */
  prompt: string;
  yesLabel: string;
  noLabel: string;
  onYes: () => void;
  onNo: () => void;
}

/** One line of the card's fact strip: source, evidence, readiness, … */
export interface RequirementFact {
  label: string;
  value: string;
}

/**
 * How this requirement gets filed. Clara-first: "File with Clara" (supported),
 * "Prepare with Clara" + agency site (partially supported), or "View filing
 * instructions" + agency site (unsupported). Replaces the old "File online"
 * link as the filing action.
 */
export interface RequirementFiling {
  kind: "file" | "prepare" | "instructions";
  label: string;
  /** Opens Clara / a sign-in page. Instructions without a URL open the card's details. */
  onClick?: () => void;
  href?: string;
  hint?: string;
  agencySite?: { label: string; url: string } | null;
}

export interface RequirementCardProps {
  index: number;
  icon: ReactNode;
  iconTone: IconTone;
  name: string;
  agency?: string | null;
  description: string;
  badge?: RequirementBadge | null;
  whyLabel: string;
  why: ReactNode;
  action: RequirementAction;
  /** "OR [Upload ___]" — shown under the primary action whenever SmartPR can
   * prepare the requirement for the user but the user may also already hold
   * the document. Omitted once the requirement is completed, or when upload
   * is already the primary (only) action. */
  secondary?: RequirementSecondaryAction;
  /** When true, the secondary action still renders for a completed
   * requirement — e.g. uploading the agency-issued document after the
   * SmartPR-prepared form is done. */
  secondaryOnCompleted?: boolean;
  /** Visible "Download form / File online" button rendered in the action
   * column — the direct official destination for this requirement, never
   * hidden inside the "Why do I need this?" disclosure. */
  download?: RequirementDownload;
  facts?: RequirementFact[];
  filing?: RequirementFiling | null;
  /** "More information needed" inline Yes/No — rendered in the action
   * column when the requirement is conditional only because the triggering
   * answer is still unknown. Answering writes a real discovery answer and
   * reruns the engine; it never invents one. */
  answerPrompt?: RequirementAnswerPrompt;
  /** Extraction panels, AI findings, multi-stage processing — rendered full
   * width below the card's three zones, unchanged in substance from before. */
  extra?: ReactNode;
  id?: string;
  /** e.g. "Added for International Trading Incentive" — set only when an
   * incentive pursuit is what put this requirement on the list. */
  contextLabel?: string | null;
}

function ActionButton({ action }: { action: RequirementAction }) {
  if (action.kind === "completed") {
    // A completed form requirement reopens the prepared form (view the PDF,
    // edit the answers, or mark it submitted) when clicked.
    if (action.onClick) {
      return (
        <button type="button" className="rq-completed rq-completed-clickable" onClick={action.onClick}>
          <CheckCircle2 size={15} /> {action.label}
        </button>
      );
    }
    return (
      <span className="rq-completed">
        <CheckCircle2 size={15} /> {action.label}
      </span>
    );
  }
  if (action.kind === "waiting") {
    return (
      <span className="rq-waiting">
        <Clock size={15} /> {action.label}
      </span>
    );
  }
  if (action.kind === "none") return null;

  const isForm = action.kind === "form";

  return (
    <button type="button" className={`rq-cta rq-cta-${action.kind}`} onClick={action.onClick}>
      {action.kind === "upload" && <Upload size={15} />}
      {isForm && <ClipboardList size={15} />}
      <span>{action.label}</span>
      {isForm && action.locked ? <Lock size={15} aria-hidden="true" /> : isForm ? <ArrowRight size={15} /> : null}
    </button>
  );
}

export function RequirementCard({
  index,
  icon,
  iconTone,
  name,
  agency,
  description,
  badge,
  whyLabel,
  why,
  action,
  answerPrompt,
  secondary,
  download,
  extra,
  id,
  contextLabel,
  secondaryOnCompleted,
  facts,
  filing,
}: RequirementCardProps) {
  const whyRef = useRef<HTMLDetailsElement>(null);
  const openInstructions = () => {
    if (whyRef.current) {
      whyRef.current.open = true;
      whyRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  };
  return (
    <div id={id} className="rq-card">
      <div className="rq-card-row">
        <div className="rq-card-left">
          <span className="rq-card-num">{index}</span>
          <span className={`rq-card-icon rq-icon-${iconTone}`}>{icon}</span>
        </div>

        <div className="rq-card-center">
          <div className="rq-card-title-row">
            <h3>{name}</h3>
            {agency && <span className="tag agency">{agency}</span>}
            {badge && <span className={`rq-badge rq-badge-${badge.tone}`}>{badge.label}</span>}
          </div>
          {contextLabel && <div className="rq-context-label">{contextLabel}</div>}
          <p className="rq-card-desc">{description}</p>
          {facts && facts.length > 0 && (
            <dl className="rq-facts">
              {facts.map((f) => (
                <div key={f.label} className="rq-fact">
                  <dt>{f.label}</dt>
                  <dd>{f.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>

        <div className="rq-card-right">
          <ActionButton action={action} />
          {answerPrompt && (
            <div className="rq-answer-prompt" role="group" aria-label={answerPrompt.prompt}>
              <div className="rq-answer-prompt-q">{answerPrompt.prompt}</div>
              <div className="rq-answer-prompt-btns">
                <button type="button" className="rq-answer-btn rq-answer-yes" onClick={answerPrompt.onYes}>
                  {answerPrompt.yesLabel}
                </button>
                <button type="button" className="rq-answer-btn rq-answer-no" onClick={answerPrompt.onNo}>
                  {answerPrompt.noLabel}
                </button>
              </div>
            </div>
          )}
          {filing && action.kind !== "completed" && (
            <div className="rq-filing" data-filing={filing.kind}>
              {filing.href ? (
                <a
                  className={`rq-filing-btn rq-filing-${filing.kind}`}
                  href={filing.href}
                  onClick={filing.onClick}
                  target={filing.kind === "instructions" ? "_blank" : undefined}
                  rel={filing.kind === "instructions" ? "noopener noreferrer" : undefined}
                >
                  {filing.kind === "instructions" ? <FileText size={15} /> : <Sparkles size={15} />}
                  <span>{filing.label}</span>
                </a>
              ) : (
                <button
                  type="button"
                  className={`rq-filing-btn rq-filing-${filing.kind}`}
                  onClick={filing.onClick ?? (filing.kind === "instructions" ? openInstructions : undefined)}
                >
                  {filing.kind === "instructions" ? <FileText size={15} /> : <Sparkles size={15} />}
                  <span>{filing.label}</span>
                </button>
              )}
              {filing.hint && <span className="rq-cta-helper">{filing.hint}</span>}
              {filing.agencySite && (
                <a className="rq-agency-site" href={filing.agencySite.url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink size={13} /> {filing.agencySite.label}
                </a>
              )}
            </div>
          )}
          {!filing && download && action.kind !== "completed" && (
            <>
              <a
                href={download.url}
                target="_blank"
                rel="noopener noreferrer"
                className="rq-download-btn"
                onClick={download.onDownload}
              >
                {download.downloaded ? <CheckCircle2 size={15} /> : <ExternalLink size={15} />}
                <span>{download.label}</span>
              </a>
              {download.downloaded && (
                <span className="rq-downloaded-hint">{download.downloadedHint}</span>
              )}
            </>
          )}
          {action.helper && (action.kind === "form" || action.kind === "upload") && (
            <span className="rq-cta-helper">{action.helper}</span>
          )}
          {secondary && (action.kind !== "completed" || secondaryOnCompleted) && (
            <>
              <span className="rq-or">OR</span>
              <button type="button" className="rq-secondary-btn" onClick={secondary.onClick} aria-label={secondary.prompt}>
                <CloudUpload size={15} />
                <span>{secondary.label}</span>
              </button>
            </>
          )}
        </div>
      </div>

      <details className="rq-why" ref={whyRef}>
        <summary>
          {whyLabel} <ChevronDown size={13} className="rq-why-chevron" />
        </summary>
        <div className="rq-why-body">{why}</div>
      </details>

      {extra && <div className="rq-card-extra">{extra}</div>}
    </div>
  );
}
