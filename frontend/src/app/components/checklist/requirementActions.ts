// The standard requirement actions: every row shows the same controls in the
// same place — [Clara slot] · "Complete" · "View details" · ⋯ — whatever
// the agency. The row's own capabilities (the RowActionsModel built from its
// forms, uploads, portals and taught routines) decide only what each control
// DOES, never its label or position.
//
// Clara rule (Darius, 2026-10-12): Clara FILES — she submits finished
// filings from the filing hub; she never fills a requirement. The Clara
// slot on a requirement row is therefore always empty, Complete never
// routes to Clara, and "Ask Clara" is the only Clara entry on a row
// (in ⋯).
import type { RowActionsModel, RowCta, RowCtaKind } from "./rowActionModel";
import { isExternalCta } from "./rowActionModel";

type Language = "en" | "es";

/** What "Complete" does for this row. */
export type CompleteRoute = "smartpr_form" | "government" | "clara" | "upload" | "instructions" | "blocked";
/** What the row's Clara slot does. Since 2026-10-12 always "explain". */
export type ClaraRoute = "learned" | "file" | "explain";
// "explain" = no Clara button on the row (Complete is the one action: the
// Passport-prefilled form, which hands off to Clara's filing hub once the
// filing is ready); "Ask Clara" sits in ⋯ instead. "learned"/"file" are
// retained for type compatibility with older callers and are no longer
// produced here.

export interface StandardAction<R extends string> {
  route: R;
  /** Tooltip / accessible description of what this row's action does. */
  title: string;
  onClick?: () => void;
  href?: string;
  external?: boolean;
  locked?: boolean;
}

export interface RequirementActions {
  clara: StandardAction<ClaraRoute>;
  complete: StandardAction<CompleteRoute>;
  onViewDetails: () => void;
  /** Everything else the row can do (agency site, portal, Teach Clara, …). */
  overflow: RowCta[];
  /** Completed rows show a check in the Complete slot. */
  done: RowActionsModel["done"];
  learned: RowActionsModel["learned"];
}

export interface StandardActionContext {
  onViewDetails: () => void;
  /** Asks Clara about this requirement (⋯ "Ask Clara" when she can't file it). */
  onExplainClara: () => void;
  /** Opens the row's unanswered question (answer rows). */
  onAnswer?: (() => void) | null;
  /** Why the row can't be completed yet (e.g. "Waiting on the Permiso Único"). */
  blockedReason?: string | null;
}

const COMPLETE_ROUTE: Partial<Record<RowCtaKind, CompleteRoute>> = {
  form: "smartpr_form",
  guided: "smartpr_form",
  upload: "upload",
  confirm: "upload",
  download: "government",
  portal: "government",
  site: "government",
  instructions: "instructions",
  start: "instructions",
  view: "instructions",
};

export const STANDARD_LABELS = {
  clara: { en: "File with Clara", es: "Radicar con Clara" },
  complete: { en: "Complete", es: "Completar" },
  // Rows SmartPR can't complete in-platform, only take proof of: say so.
  upload: { en: "Upload", es: "Subir" },
  details: { en: "View details", es: "Ver detalles" },
  done: { en: "Completed", es: "Completado" },
} as const;

export function standardRequirementActions(model: RowActionsModel, ctx: StandardActionContext, language: Language): RequirementActions {
  const es = language === "es";
  const all = [model.primary, ...model.more].filter((c): c is RowCta => !!c);

  // Clara rule (2026-10-12): the row's Clara slot is always empty — Clara
  // files finished filings from the filing hub, never from a requirement
  // row. Clara CTAs in the model (assist / learned) are dropped here too,
  // so they can't leak into Complete or the ⋯ menu.
  const clara: StandardAction<ClaraRoute> = {
    route: "explain",
    title: es ? "Radicar con Clara — disponible cuando la radicación esté lista" : "File with Clara — available once the filing is ready",
    onClick: ctx.onExplainClara,
  };

  const rest = all.filter((c) => c.id !== "learned" && c.kind !== "assist");
  const completable = rest.filter((c) => c.kind !== "teach" && COMPLETE_ROUTE[c.kind]);
  // In-platform first: SmartPR forms, uploads. Off-site links only lead when
  // nothing in SmartPR (or Clara) can, and never past a known blocker.
  const internal = completable.find((c) => !isExternalCta(c)) ?? null;
  const external = completable.find((c) => isExternalCta(c)) ?? null;

  let complete: StandardAction<CompleteRoute>;
  let completeCta: RowCta | null = null;
  if (model.answer) {
    complete = {
      route: "blocked",
      title: `${es ? "Primero contesta" : "Answer first"}: ${model.answer.prompt}`,
      onClick: ctx.onAnswer ?? ctx.onViewDetails,
    };
  } else if (internal) {
    completeCta = internal;
    complete = { route: COMPLETE_ROUTE[internal.kind]!, title: internal.title, onClick: internal.onClick, href: internal.href, locked: internal.locked };
  } else if (ctx.blockedReason) {
    complete = { route: "blocked", title: ctx.blockedReason, onClick: ctx.onViewDetails };
  } else if (external && COMPLETE_ROUTE[external.kind] === "government") {
    completeCta = external;
    complete = { route: "government", title: external.title, onClick: external.onClick, href: external.href, external: true };
  } else {
    // Manual / offline: the details panel holds the instructions (and any official link).
    complete = {
      route: "instructions",
      title: external?.title ?? (es ? "Ver cómo completar este requisito" : "See how to complete this requirement"),
      onClick: ctx.onViewDetails,
    };
  }

  const overflow = rest.filter((c) => c !== completeCta);
  if (clara.route === "explain") {
    overflow.push({ id: "ask", kind: "assist", label: es ? "Preguntarle a Clara" : "Ask Clara", title: es ? "Preguntarle a Clara" : "Ask Clara", onClick: ctx.onExplainClara });
  }
  return { clara, complete, onViewDetails: ctx.onViewDetails, overflow, done: model.done, learned: model.learned };
}
