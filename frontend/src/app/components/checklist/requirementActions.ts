// The standard requirement actions: every row shows the same controls in the
// same place — "Fill with Clara" · "Complete" · "View details" · ⋯ — whatever
// the agency. The row's own capabilities (the RowActionsModel built from its
// forms, uploads, Clara filing, portals and taught routines) decide only what
// each control DOES, never its label or position.
import type { RowActionsModel, RowCta, RowCtaKind } from "./rowActionModel";
import { isExternalCta } from "./rowActionModel";

type Language = "en" | "es";

/** What "Complete" does for this row. */
export type CompleteRoute = "smartpr_form" | "government" | "clara" | "upload" | "instructions" | "blocked";
/** What "Fill with Clara" does for this row. */
export type ClaraRoute = "learned" | "file" | "explain";

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
  /** Opens Clara with this requirement's context and what she can do here. */
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
  clara: { en: "Fill with Clara", es: "Llenar con Clara" },
  complete: { en: "Complete", es: "Completar" },
  details: { en: "View details", es: "Ver detalles" },
  done: { en: "Completed", es: "Completado" },
} as const;

export function standardRequirementActions(model: RowActionsModel, ctx: StandardActionContext, language: Language): RequirementActions {
  const es = language === "es";
  const all = [model.primary, ...model.more].filter((c): c is RowCta => !!c);
  const claraCta = all.find((c) => c.id === "learned") ?? all.find((c) => c.kind === "assist") ?? null;

  const clara: StandardAction<ClaraRoute> = claraCta
    ? {
        route: claraCta.id === "learned" ? "learned" : "file",
        title: claraCta.title,
        onClick: claraCta.onClick,
        href: claraCta.href,
        external: isExternalCta(claraCta),
      }
    : {
        route: "explain",
        title: es ? "Llenar con Clara — mira lo que Clara puede hacer aquí" : "Fill with Clara — see what Clara can do here",
        onClick: ctx.onExplainClara,
      };

  const rest = all.filter((c) => c !== claraCta);
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
  } else if (claraCta) {
    complete = { ...clara, route: "clara" };
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
  return { clara, complete, onViewDetails: ctx.onViewDetails, overflow, done: model.done, learned: model.learned };
}
