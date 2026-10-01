"use client";

import { ClaraModal } from "./ClaraModal";
import { TeachClaraForm } from "./TeachClaraForm";
import type { GuidedSubject } from "./guidedFormModel";
import { useRequirementActionsEnv } from "./requirementActionsContext";

type Language = "en" | "es";

/** Teach Clara for one requirement row (⋯ menu / guided form / Clara's run panel). */
export function TeachClaraDialog({ subject, language, onClose }: { subject: GuidedSubject; language: Language; onClose: () => void }) {
  const es = language === "es";
  const { businessId } = useRequirementActionsEnv();
  const liveHref = businessId
    ? `/businesses/${encodeURIComponent(businessId)}/teach?${new URLSearchParams({
        ...(subject.portalUrl ? { url: subject.portalUrl } : {}),
        form: subject.name,
        requirement: subject.key,
        ...(subject.agency ? { portal: subject.agency } : {}),
      })}`
    : null;
  return (
    <ClaraModal
      title={es ? "Enséñale a Clara" : "Teach Clara"}
      subtitle={[subject.name, subject.agency].filter(Boolean).join(" · ")}
      onClose={onClose}
      testId="teach-clara-dialog"
      wide
    >
      <TeachClaraForm
        target={{ requirementKey: subject.key, requirementName: subject.name, agency: subject.agency ?? null, portalUrl: subject.portalUrl ?? null }}
        language={language}
        liveHref={liveHref}
      />
    </ClaraModal>
  );
}
