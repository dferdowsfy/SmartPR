"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Bot, CheckCircle2, ChevronDown, ClipboardList, Clock, CloudUpload, ArrowRight, ExternalLink, Lock, Upload } from "lucide-react";
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
/** Clara-first filing: for requirements filed at an external portal, the
 * card launches the Clara filing workspace (in-app) instead of kicking the
 * user out to a government website in a new tab. The workspace lists the
 * filings Clara can work through with the user — the user approves every
 * step and sensitive/human-only steps stay in their hands. */
export interface RequirementPortalFiling {
  /** Visible button label, already localized by the caller
   * (e.g. "File with Clara" / "Radicar con Clara"). */
  label: string;
  /** In-app route to the Clara filing workspace for this business,
   * e.g. `/businesses/{id}/agency-run`. Same-tab navigation. */
  href: string;
  /** Localized caption under the button, e.g. "Work through this filing
   * with Clara — you stay in control of every step." */
  hint: string;
  /** Optional async hook that runs before navigating into Clara — e.g.
   * syncing intake-computed requirements into persisted obligations so the
   * filing picker has something to show. Navigation proceeds after it
   * settles; a failure never blocks entry. */
  onBeforeNavigate?: () => Promise<void>;
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
   * hidden inside the "Why do I need this?" disclosure. Omitted when
   * `portalFiling` is set: portal filings launch Clara instead of opening
   * the government site in a new tab. */
  download?: RequirementDownload;
  /** Clara-first portal filing — rendered in place of `download` for
   * requirements filed at an external portal. */
  portalFiling?: RequirementPortalFiling;
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
  portalFiling,
  extra,
  id,
  contextLabel,
  secondaryOnCompleted,
}: RequirementCardProps) {
  const router = useRouter();
  /** Busy while the pre-navigation hook (e.g. obligation sync) runs. */
  const [claraBusy, setClaraBusy] = useState(false);
  const handleClaraClick = portalFiling?.onBeforeNavigate
    ? (e: React.MouseEvent<HTMLAnchorElement>) => {
        e.preventDefault();
        if (claraBusy) return;
        setClaraBusy(true);
        const href = portalFiling.href;
        const go = () => router.push(href);
        // Never trap the user on a hung sync: enter Clara after 8s regardless.
        const timeout = new Promise((resolve) => setTimeout(resolve, 8000));
        void Promise.race([portalFiling.onBeforeNavigate!(), timeout]).then(go, go);
      }
    : undefined;
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
          {portalFiling && action.kind !== "completed" && (
            <>
              <a
                href={portalFiling.href}
                className="rq-download-btn rq-clara-btn"
                onClick={handleClaraClick}
                aria-disabled={claraBusy || undefined}
                style={claraBusy ? { opacity: 0.6, pointerEvents: "none" } : undefined}
              >
                <Bot size={15} />
                <span>{portalFiling.label}</span>
              </a>
              <span className="rq-downloaded-hint">{portalFiling.hint}</span>
            </>
          )}
          {download && !portalFiling && action.kind !== "completed" && (
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

      <details className="rq-why">
        <summary>
          {whyLabel} <ChevronDown size={13} className="rq-why-chevron" />
        </summary>
        <div className="rq-why-body">{why}</div>
      </details>

      {extra && <div className="rq-card-extra">{extra}</div>}
    </div>
  );
}
