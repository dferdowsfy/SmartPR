"use client";

// Per-row wiring for the in-platform actions: "Complete form" opens SmartPR's
// guided form, "Teach Clara" opens the Teach Clara dialog. Both are dialogs
// (portals) so opening them never expands the row.

import { useState, type ReactNode } from "react";
import type { InPlatformHandlers, RowActionsModel, RowCta } from "../checklist/rowActionModel";
import type { GuidedSubject } from "./guidedFormModel";
import { GuidedRequirementForm } from "./GuidedRequirementForm";
import { TeachClaraDialog } from "./TeachClaraDialog";

type Language = "en" | "es";

export function useInPlatformActions(subject: GuidedSubject, language: Language): {
  handlers: Required<InPlatformHandlers>;
  dialogs: (model: RowActionsModel) => ReactNode;
} {
  const [open, setOpen] = useState<"guided" | "teach" | null>(null);
  const handlers = { onGuidedForm: () => setOpen("guided"), onTeach: () => setOpen("teach") };
  const dialogs = (model: RowActionsModel) => {
    if (!open) return null;
    const clara = [model.primary, ...model.more].find((c): c is RowCta => !!c && c.kind === "assist") ?? null;
    const fillWithClara = clara
      ? () => {
          if (clara.onClick) clara.onClick();
          else if (clara.href) window.location.href = clara.href;
        }
      : null;
    if (open === "guided") {
      return <GuidedRequirementForm subject={subject} language={language} onClose={() => setOpen(null)} onFillWithClara={fillWithClara} onTeach={() => setOpen("teach")} />;
    }
    return <TeachClaraDialog subject={subject} language={language} onClose={() => setOpen(null)} />;
  };
  return { handlers, dialogs };
}
