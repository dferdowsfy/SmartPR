// Inline row actions for the checklist view: the ONE primary action the
// expanded requirement card already offers ("Complete form", "Upload",
// "Fill with Clara", "Continue application"), shown on the collapsed
// one-line row so the user can act without expanding it. Any other action
// goes into a small overflow (⋯) menu.
//
// In-platform rule (Darius, 2026-09-30): the primary inline action ALWAYS
// keeps the user in SmartPR — an in-platform form/package ("Complete form"),
// Clara ("Fill with Clara"), or an in-platform upload. Links that leave
// SmartPR (agency portals, agency sites, official PDFs, instructions) only
// ever sit in the ⋯ menu or the row details. When a row has nothing
// in-platform of its own, the guided form generated from the requirement's
// "What you'll need" list ("Complete form") leads. "Teach Clara" is always
// reachable from the ⋯ menu.
import type {
  RequirementAction,
  RequirementAnswerPrompt,
  RequirementDownload,
  RequirementFiling,
  RequirementSecondaryAction,
} from "../filing/RequirementCard";

type Language = "en" | "es";

export type RowCtaKind = "form" | "guided" | "upload" | "assist" | "teach" | "download" | "instructions" | "site" | "portal" | "start" | "confirm" | "view";

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
  guided: { en: "Complete form", es: "Completar" },
  teach: { en: "Teach Clara", es: "Enséñale a Clara" },
  upload: { en: "Upload", es: "Subir" },
  assist: { en: "Fill with Clara", es: "Llenar con Clara" },
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
  // Clara's action reads the same on every row ("File with Clara" /
  // "Prepare with Clara" are its long titles).
  if (kind === "assist" || kind === "teach" || kind === "guided") return DEFAULT_SHORT[kind][language];
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
  } & InPlatformHandlers,
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
    return { primary: null, more: input.onTeach ? [teachClaraCta(input.onTeach, language)] : [], done: null, answer: answerPrompt };
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
  return ensureInPlatformPrimary({ primary: unique[0] ?? null, more: unique.slice(1), done: null, answer: null }, input, language);
}

/** Opens SmartPR's own guided form / Teach Clara for a row (in-platform). */
export interface InPlatformHandlers {
  /** Opens the guided in-platform form built from the requirement's "What you'll need". */
  onGuidedForm?: (() => void) | null;
  /** Opens Teach Clara for this requirement / portal. */
  onTeach?: (() => void) | null;
}

/** True when following the CTA leaves SmartPR (new tab or an off-site URL). */
export function isExternalCta(c: RowCta | null | undefined): boolean {
  if (!c) return false;
  if (c.external) return true;
  if (!c.href) return false;
  return !c.href.startsWith("/") || c.href.startsWith("//");
}

export function guidedFormCta(onClick: () => void, language: Language, title?: string): RowCta {
  const es = language === "es";
  return { id: "guided", kind: "guided", label: DEFAULT_SHORT.guided[language], title: title ?? (es ? "Completar el formulario en SmartPR" : "Complete the form in SmartPR"), onClick };
}

export function teachClaraCta(onClick: () => void, language: Language): RowCta {
  const es = language === "es";
  return { id: "teach", kind: "teach", label: DEFAULT_SHORT.teach[language], title: es ? "Enséñale a Clara cómo se radica" : "Teach Clara how this is filed", onClick };
}

/**
 * The in-platform rule, applied to any row model: an external primary moves
 * to the ⋯ menu; the first in-platform action leads instead, else the
 * guided form (when the row had something to act on). Teach Clara is added
 * last to the ⋯ menu of every open row. Done / answer rows keep their state.
 */
export function ensureInPlatformPrimary(model: RowActionsModel, handlers: InPlatformHandlers, language: Language): RowActionsModel {
  if (model.done) return model;
  const all = [model.primary, ...model.more].filter((c): c is RowCta => !!c && c.kind !== "teach");
  const internal = all.filter((c) => !isExternalCta(c));
  const external = all.filter((c) => isExternalCta(c));
  let primary: RowCta | null = model.answer ? null : internal[0] ?? null;
  const more = model.answer ? [...internal] : internal.slice(1);
  // Something to act on, but only off-site: SmartPR's guided form leads.
  if (!model.answer && !primary && external.length && handlers.onGuidedForm) primary = guidedFormCta(handlers.onGuidedForm, language);
  // A guided form never sits behind another in-platform action's ⋯ twice.
  if (primary && primary.kind !== "guided") {
    const g = more.findIndex((c) => c.kind === "guided");
    if (g !== -1) more.splice(g, 1);
  }
  more.push(...external);
  if (handlers.onTeach && (primary || more.length || model.answer)) more.push(teachClaraCta(handlers.onTeach, language));
  return { primary, more, done: null, answer: model.answer };
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
 * in-platform actions come first (same handlers as the expanded card); a
 * row with nothing in-platform gets SmartPR's guided form ("Complete form",
 * built from "What you'll need"). The official portal is ⋯-only, as is
 * Teach Clara.
 *   - question rows: "Answer" leads; the rest go in the ⋯ menu.
 *   - expert rows: only real card actions (no expert-request handler exists).
 *   - may-apply rows: card actions; the guided form only when the row has an
 *     official portal (something to file), never a bare form.
 */
export function energyRowActions(
  input: {
    status: string;
    cards: RowActionsModel;
    portal?: ProcessPortal | null;
    /** @deprecated The prepared checklist is now the guided form (onGuidedForm). */
    onStart?: (() => void) | null;
    question?: { prompt: string } | null;
  } & InPlatformHandlers,
  language: Language
): RowActionsModel {
  const { status, cards, portal, onStart, question } = input;
  const es = language === "es";
  if (cards.done) return cards;
  const fromCards = [cards.primary, ...cards.more].filter((c): c is RowCta => !!c && c.kind !== "teach");
  if (status === "expert") {
    const own = fromCards.filter((c) => c.kind !== "guided");
    return ensureInPlatformPrimary({ primary: own[0] ?? null, more: own.slice(1), done: null, answer: null }, { onTeach: input.onTeach }, language);
  }
  const own = fromCards.filter((c) => c.kind !== "guided");
  // The official portal ranks above a generic "agency site" link.
  const list = own.filter((c) => c.kind !== "site");
  if (portal?.url && !own.some((c) => c.href === portal.url)) {
    const title = (es ? portal.label_es : null) ?? portal.label;
    list.push({ id: "portal", kind: "portal", label: DEFAULT_SHORT.portal[language], title, href: portal.url, external: true });
  }
  list.push(...own.filter((c) => c.kind === "site"));
  const guided = input.onGuidedForm ?? null;
  const hasInternal = list.some((c) => !isExternalCta(c));
  if (!hasInternal && status !== "question") {
    const mayFile = status !== "may_apply" || !!portal?.url;
    if (guided && mayFile && (list.length || status !== "may_apply")) list.unshift(guidedFormCta(guided, language));
    else if (!guided && onStart && !list.length && status !== "may_apply") {
      list.push({ id: "start", kind: "start", label: DEFAULT_SHORT.start[language], title: es ? "Abrir la lista preparada" : "Open the prepared checklist", onClick: onStart });
    }
  }
  const model: RowActionsModel = status === "question" && question
    ? { primary: null, more: list, done: null, answer: question }
    : { primary: list[0] ?? null, more: list.slice(1), done: null, answer: null };
  // may-apply rows without a portal never get a bare guided form.
  return ensureInPlatformPrimary(model, { onTeach: input.onTeach, onGuidedForm: status === "may_apply" && !portal?.url ? null : guided }, language);
}
