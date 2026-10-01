"use client";

// "Fill with Clara" on a row Clara can't file by herself yet: open Clara with
// the requirement's context and say plainly what she CAN do here, instead of
// hiding the action. "Teach Clara" goes straight to the Clara workspace
// (teach mode) for this requirement — no second explanatory step.

import { ClipboardList, GraduationCap, MessageCircle } from "lucide-react";
import { ClaraModal } from "./ClaraModal";
import type { GuidedSubject } from "./guidedFormModel";
import { openSmartPRChat } from "../chat/openChat";

type Language = "en" | "es";

export function ClaraExplainDialog({ subject, language, onClose, onGuidedForm, onTeach }: { subject: GuidedSubject; language: Language; onClose: () => void; onGuidedForm: () => void; onTeach: () => void }) {
  const es = language === "es";
  const where = subject.agency ? (es ? ` en ${subject.agency}` : ` with ${subject.agency}`) : "";
  return (
    <ClaraModal
      title={es ? "Llenar con Clara" : "Fill with Clara"}
      subtitle={subject.name}
      onClose={onClose}
      testId="clara-explain"
    >
      <p>
        {es
          ? `Clara todavía no puede radicar este trámite${where} por su cuenta. Esto es lo que sí puede hacer:`
          : `Clara can't file this${where} on her own yet. Here's what she can do:`}
      </p>
      <div className="cl-explain-options">
        <button type="button" className="cl-btn" onClick={() => { onClose(); onGuidedForm(); }}>
          <ClipboardList size={16} aria-hidden="true" /> {es ? "Preparar la información en SmartPR" : "Prepare the information in SmartPR"}
        </button>
        <button type="button" className="cl-btn cl-btn-ghost" onClick={() => { onClose(); onTeach(); }} data-testid="clara-explain-teach" title={es ? "Abre a Clara en el portal: hazlo una vez y ella aprende la rutina" : "Opens Clara on the portal: do it once and she learns the routine"}>
          <GraduationCap size={16} aria-hidden="true" /> {es ? "Enséñale a Clara" : "Teach Clara"}
        </button>
        <button type="button" className="cl-btn cl-btn-ghost" onClick={() => { onClose(); openSmartPRChat(es ? `¿Cómo completo: ${subject.name}?` : `How do I complete: ${subject.name}?`); }}>
          <MessageCircle size={16} aria-hidden="true" /> {es ? "Preguntarle a Clara" : "Ask Clara"}
        </button>
      </div>
    </ClaraModal>
  );
}
