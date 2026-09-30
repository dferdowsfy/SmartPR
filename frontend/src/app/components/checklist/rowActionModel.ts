// Inline row actions for the checklist view: the ONE primary action the
// expanded requirement card already offers ("Complete form", "Upload",
// "File with Clara", "Download", "Continue application"), shown on the
// collapsed one-line row so the user can act without expanding it. Any
// other action goes into a small overflow (⋯) menu. Every entry runs the
// very same handler (or link) as the expanded card — nothing new is wired.
import type {
  RequirementAction,
  RequirementAnswerPrompt,
  RequirementDownload,
  RequirementFiling,
  RequirementSecondaryAction,
} from "../filing/RequirementCard";

type Language = "en" | "es";

export type RowCtaKind = "form" | "upload" | "assist" | "download" | "instructions" | "site" | "portal" | "start" | "confirm" | "view";

export interface RowCta {
  id: string;
  kind: RowCtaKind;
  /** Short visible label. */
  label: string;
  /** Full label (tooltip / accessible name) when the short one abbreviates it. */
  title: string;
  onClick?: () => void;
  href?: string;
  /** Link opens a new tab (agency sites, official PDFs). */
  external?: boolean;
  locked?: boolean;
}

export interface RowActionsModel {
  primary: RowCta | null;
  more: RowCta[];
  /** Completed: a check plus "View" (clickable when the card can reopen it). */
  done: { label: string; onClick?: () => void } | null;
  /** The row only needs an answer: an "Answer" button opens just the question. */
  answer: { prompt: string } | null;
}

export const EMPTY_ROW_ACTIONS: RowActionsModel = { primary: null, more: [], done: null, answer: null };

const MAX = 16;

const DEFAULT_SHORT: Record<RowCtaKind, { en: string; es: string }> = {
  form: { en: "Complete form", es: "Completar" },
  upload: { en: "Upload", es: "Subir" },
  assist: { en: "File with Clara", es: "Radicar con Clara" },
  download: { en: "Download", es: "Descargar" },
  instructions: { en: "Instructions", es: "Instrucciones" },
  site: { en: "Agency site", es: "Sitio de la agencia" },
  portal: { en: "Open portal", es: "Abrir portal" },
  start: { en: "Start", es: "Empezar" },
  confirm: { en: "Confirm", es: "Confirmar" },
  view: { en: "View", es: "Ver" },
};

/** "Complete Patente Municipal registration form" → "Complete form"; short labels pass through. */
export function shortCtaLabel(label: string, kind: RowCtaKind, language: Language): string {
  const t = label.trim();
  if (t && t.length <= MAX) return t;
  if (kind === "form") {
    if (/^(continue|continuar)/i.test(t)) return language === "es" ? "Continuar" : "Continue";
    if (/^(review|revisar)/i.test(t)) return language === "es" ? "Revisar" : "Review";
  }
  return DEFAULT_SHORT[kind][language];
}

function cta(id: string, kind: RowCtaKind, label: string, language: Language, rest: Partial<RowCta>): RowCta {
  const full = label.trim() || DEFAULT_SHORT[kind][language];
  return { id, kind, label: shortCtaLabel(full, kind, language), title: full, ...rest };
}

export function requirementRowActions(
  input: {
    action: RequirementAction;
    filing?: RequirementFiling | null;
    download?: RequirementDownload;
    secondary?: RequirementSecondaryAction;
    secondaryOnCompleted?: boolean;
    answerPrompt?: RequirementAnswerPrompt;
    /** "Verify existing": confirming the document already held comes first. */
    verifyExisting?: boolean;
  },
  language: Language
): RowActionsModel {
  const { action, filing, download, secondary, secondaryOnCompleted, answerPrompt, verifyExisting } = input;
  const es = language === "es";
  const secondaryCta = (kind: RowCtaKind, label?: string) =>
    secondary ? cta("secondary", kind, label ?? secondary.label, language, { onClick: secondary.onClick, title: secondary.label }) : null;

  if (action.kind === "completed") {
    const more = secondaryOnCompleted && secondary ? [cta("secondary", "upload", secondary.label, language, { onClick: secondary.onClick })] : [];
    return { primary: null, more, done: { label: action.onClick ? (es ? "Ver" : "View") : es ? "Listo" : "Done", onClick: action.onClick }, answer: null };
  }
  if (answerPrompt && (action.kind === "none" || !action.onClick)) {
    return { primary: null, more: [], done: null, answer: answerPrompt };
  }

  const list: RowCta[] = [];
  const primaryAction =
    (action.kind === "form" || action.kind === "upload") && action.onClick
      ? cta("action", action.kind, action.label, language, { onClick: action.onClick, locked: action.locked })
      : null;
  const filingCta =
    filing && (filing.kind === "file" || filing.kind === "prepare") && (filing.onClick || filing.href)
      ? cta("filing", "assist", filing.label, language, { onClick: filing.onClick, href: filing.href })
      : null;
  // Instructions without a link only open the card's details — that is the
  // row toggle, not an action, so it stays in the expanded card.
  const instructionsCta = filing && filing.kind === "instructions" && filing.href
    ? cta("filing", "instructions", filing.label, language, { href: filing.href, external: true })
    : null;
  const siteCta = filing?.agencySite
    ? cta("site", "site", filing.agencySite.label, language, { href: filing.agencySite.url, external: true })
    : null;
  const downloadCta = !filing && download
    ? cta("download", "download", download.label, language, { href: download.url, external: true, onClick: download.onDownload })
    : null;

  if (verifyExisting) {
    // Already held: "Confirm" (upload the document you hold) leads; a
    // started application ("Continue application") leads instead.
    const resuming = primaryAction && /continue|continuar|review|revisar/i.test(action.label);
    const confirm = secondaryCta("confirm", es ? "Confirmar" : "Confirm");
    if (resuming) list.push(primaryAction!);
    if (confirm) list.push(confirm);
    if (primaryAction && !resuming) list.push(primaryAction);
    for (const c of [filingCta, downloadCta, instructionsCta, siteCta]) if (c) list.push(c);
  } else {
    for (const c of [primaryAction, filingCta, downloadCta, instructionsCta, secondaryCta("upload"), siteCta]) if (c) list.push(c);
  }
  // One entry per handler, primary first.
  const seen = new Set<string>();
  const unique = list.filter((c) => {
    const key = `${c.id}:${c.kind}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { primary: unique[0] ?? null, more: unique.slice(1), done: null, answer: null };
}

/** Actions for an energy process row: the legacy cards it covers, merged. */
export function mergeRowActions(models: RowActionsModel[]): RowActionsModel {
  const live = models.filter((m) => m.primary || m.more.length || m.done || m.answer);
  if (!live.length) return EMPTY_ROW_ACTIONS;
  const open = live.filter((m) => !m.done);
  if (!open.length) return { primary: null, more: live.flatMap((m) => m.more), done: live[0].done, answer: null };
  const ctas = open.flatMap((m) => [m.primary, ...m.more]).filter((c): c is RowCta => !!c);
  return { primary: ctas[0] ?? null, more: ctas.slice(1), done: null, answer: ctas.length ? null : open.find((m) => m.answer)?.answer ?? null };
}

/** An energy process's official filing portal (regulatory_processes.json `portal`). */
export interface ProcessPortal { url: string; label: string; label_es?: string }

/**
 * Inline actions for an energy process row. The covered legacy cards' own
 * actions come first (same handlers as the expanded card); a process with an
 * official portal adds "Open portal"; a process with only a list of what to
 * prepare gets "Start", which opens that prepared checklist under the row.
 *   - question rows: "Answer" leads; the rest go in the ⋯ menu.
 *   - expert rows: only real card actions (no expert-request handler exists).
 *   - may-apply rows: card actions and the portal, never a bare "Start".
 */
export function energyRowActions(
  input: {
    status: string;
    cards: RowActionsModel;
    portal?: ProcessPortal | null;
    /** Opens the prepared checklist ("What you'll need") under the row. */
    onStart?: (() => void) | null;
    question?: { prompt: string } | null;
  },
  language: Language
): RowActionsModel {
  const { status, cards, portal, onStart, question } = input;
  const es = language === "es";
  if (cards.done) return cards;
  const fromCards = [cards.primary, ...cards.more].filter((c): c is RowCta => !!c);
  if (status === "expert") return { primary: fromCards[0] ?? null, more: fromCards.slice(1), done: null, answer: null };
  // The official portal ranks above a generic "agency site" link.
  const list = fromCards.filter((c) => c.kind !== "site");
  if (portal?.url && !fromCards.some((c) => c.href === portal.url)) {
    const title = (es ? portal.label_es : null) ?? portal.label;
    list.push({ id: "portal", kind: "portal", label: DEFAULT_SHORT.portal[language], title, href: portal.url, external: true });
  }
  list.push(...fromCards.filter((c) => c.kind === "site"));
  if (onStart && !list.length && status !== "may_apply" && status !== "question") {
    list.push({ id: "start", kind: "start", label: DEFAULT_SHORT.start[language], title: es ? "Abrir la lista preparada" : "Open the prepared checklist", onClick: onStart });
  }
  if (status === "question" && question) return { primary: null, more: list, done: null, answer: question };
  return { primary: list[0] ?? null, more: list.slice(1), done: null, answer: null };
}
