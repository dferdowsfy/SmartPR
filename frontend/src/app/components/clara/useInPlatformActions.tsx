"use client";

// Per-row wiring for the in-platform actions: "Complete form" opens SmartPR's
// guided form, "Teach Clara" opens the record-first Teach Clara dialog, and —
// once Clara learned the row's routine — "Fill with Clara" replays exactly
// the recorded steps (strict replay). Dialogs are portals so opening them
// never expands the row.

import { useState, type ReactNode } from "react";
import type { InPlatformHandlers, RowActionsModel, RowCta } from "../checklist/rowActionModel";
import type { GuidedSubject } from "./guidedFormModel";
import { GuidedRequirementForm } from "./GuidedRequirementForm";
import { TeachRecordDialog } from "./TeachRecordDialog";
import { LearnedFillDialog } from "./LearnedFillDialog";
import { useRequirementActionsEnv } from "./requirementActionsContext";
import { routineForRow } from "../../../lib/agency-runs/teach/learnedRoutineMatch";

type Language = "en" | "es";

export function useInPlatformActions(subject: GuidedSubject, language: Language): {
  handlers: Required<InPlatformHandlers>;
  dialogs: (model: RowActionsModel) => ReactNode;
} {
  const env = useRequirementActionsEnv();
  const [open, setOpen] = useState<"guided" | "teach" | "fill" | null>(null);
  const routine = routineForRow(env.routines, { key: subject.key, portalUrl: subject.portalUrl ?? null, name: subject.name });
  const handlers: Required<InPlatformHandlers> = {
    onGuidedForm: () => setOpen("guided"),
    onTeach: () => setOpen("teach"),
    onLearnedFill: routine && routine.status === "learned" ? () => setOpen("fill") : null,
    learnedStatus: routine?.status ?? null,
  };
  const dialogs = (model: RowActionsModel) => {
    if (!open) return null;
    if (open === "fill" && routine) {
      return <LearnedFillDialog routine={routine} subject={subject} language={language} onClose={() => setOpen(null)} onReteach={() => setOpen("teach")} />;
    }
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
    return <TeachRecordDialog subject={subject} language={language} onClose={() => setOpen(null)} onLearned={(r) => env.addRoutine(r)} />;
  };
  return { handlers, dialogs };
}
