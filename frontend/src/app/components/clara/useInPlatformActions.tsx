"use client";

// Per-row wiring for the in-platform actions: "Complete form" opens SmartPR's
// guided form; "Teach Clara" opens the Clara workspace in teach mode for the
// requirement (record the routine once); and — once Clara learned the row's
// routine — "Fill with Clara" opens the workspace in fill mode, which
// replays exactly the recorded steps (strict replay) with the business's
// Passport. Dialogs are portals so opening them never expands the row.

import { useState, type ReactNode } from "react";
import type { InPlatformHandlers, RowActionsModel, RowCta } from "../checklist/rowActionModel";
import type { GuidedSubject } from "./guidedFormModel";
import { GuidedRequirementForm } from "./GuidedRequirementForm";
import { openSmartPRChat } from "../chat/openChat";
import { useRequirementActionsEnv } from "./requirementActionsContext";
import { routineForRow } from "../../../lib/agency-runs/teach/learnedRoutineMatch";
import { claraWorkspaceHref } from "./claraWorkspaceLink";

type Language = "en" | "es";

/** Leaves the page; true tells the clicked button to keep its spinner. */
function go(href: string): true {
  window.location.assign(href);
  return true;
}

export function useInPlatformActions(subject: GuidedSubject, language: Language): {
  handlers: Required<InPlatformHandlers>;
  /** "Ask Clara" (⋯) on a row Clara can't file yet. */
  onExplainClara: () => void;
  dialogs: (model: RowActionsModel) => ReactNode;
} {
  const env = useRequirementActionsEnv();
  const [open, setOpen] = useState<"guided" | null>(null);
  const routine = routineForRow(env.routines, { key: subject.key, portalUrl: subject.portalUrl ?? null, name: subject.name });
  const teach = () => go(claraWorkspaceHref("teach", env.businessId, { ...subject, portalUrl: subject.portalUrl ?? routine?.start_url ?? null }));
  const handlers: Required<InPlatformHandlers> = {
    onGuidedForm: () => setOpen("guided"),
    onTeach: teach,
    onLearnedFill: routine && routine.status === "learned" ? () => go(claraWorkspaceHref("fill", env.businessId, { ...subject, portalUrl: subject.portalUrl ?? routine.start_url }, { routineRef: routine.ref })) : null,
    learnedStatus: routine?.status ?? null,
  };
  const dialogs = (model: RowActionsModel) => {
    if (!open) return null;
    const clara = [model.primary, ...model.more].find((c): c is RowCta => !!c && c.kind === "assist") ?? null;
    const fillWithClara = clara
      ? () => {
          if (clara.onClick) clara.onClick();
          else if (clara.href) window.location.href = clara.href;
        }
      : null;
    return <GuidedRequirementForm subject={subject} language={language} onClose={() => setOpen(null)} onFillWithClara={fillWithClara} onTeach={teach} />;
  };
  const askClara = () => openSmartPRChat(language === "es" ? `¿Cómo completo: ${subject.name}?` : `How do I complete: ${subject.name}?`);
  return { handlers, onExplainClara: askClara, dialogs };
}
