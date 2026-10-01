"use client";

// "Fill with Clara" on a row Clara learned (record-first Teach): plans a
// strict replay of exactly the recorded steps and opens the replay view,
// where the person confirms, watches, and takes over at every pause. One
// click from the row; the dialog only shows while it opens (or why it can't).

import { useEffect, useRef, useState } from "react";
import { GraduationCap, Loader2 } from "lucide-react";
import { ClaraModal } from "./ClaraModal";
import type { GuidedSubject } from "./guidedFormModel";
import { useRequirementActionsEnv } from "./requirementActionsContext";
import type { LearnedRoutineSummary } from "../../../lib/agency-runs/teach/learnedRoutineMatch";

/** "1 step" / "2 steps" — no "step(s)". */
const pl = (n: number, one: string, many: string) => (n === 1 ? one : many);

type Language = "en" | "es";

export function LearnedFillDialog({ routine, subject, language, onClose, onReteach, businessId: businessOverride }: { routine: LearnedRoutineSummary; subject: GuidedSubject; language: Language; onClose: () => void; onReteach: () => void; businessId?: string | null }) {
  const es = language === "es";
  const T = (en: string, sp: string) => (es ? sp : en);
  const env = useRequirementActionsEnv();
  const businessId = businessOverride ?? env.businessId;
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current || !businessId) return;
    started.current = true;
    (async () => {
      try {
        const res = await fetch("/api/replays", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ skill_ref: routine.ref, business_id: businessId }) });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          const m = (body as { message?: string }).message;
          throw new Error(res.status === 409 ? T("The portal changed since Clara learned this — teach her again.", "El portal cambió desde que Clara lo aprendió — enséñale otra vez.") : m || T("Clara couldn't start. Try again.", "Clara no pudo empezar. Intenta otra vez."));
        }
        window.location.href = `/businesses/${encodeURIComponent(businessId)}/replay/${encodeURIComponent(body.replay.id)}`;
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  }, [businessId, routine.ref]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <ClaraModal title={T("Fill with Clara", "Llenar con Clara")} subtitle={[subject.name, routine.portal_host].filter(Boolean).join(" · ")} onClose={onClose} testId="learned-fill-dialog">
      <div className="tr" data-testid="learned-fill">
        <p className="tr-lead">
          <GraduationCap size={18} aria-hidden="true" />
          <span>
            {T(
              `Clara follows exactly the ${routine.steps} ${pl(routine.steps, "step", "steps")} you taught her and stops at the ${routine.pauses} ${pl(routine.pauses, "pause", "pauses")}. She never presses Submit.`,
              `Clara sigue exactamente ${pl(routine.steps, "el", "los")} ${routine.steps} ${pl(routine.steps, "paso", "pasos")} que le enseñaste y se detiene en ${pl(routine.pauses, "la", "las")} ${routine.pauses} ${pl(routine.pauses, "pausa", "pausas")}. Nunca toca Enviar.`
            )}
          </span>
        </p>
        {!businessId ? (
          <p className="tr-note">{T("Save this business to your account first — Clara fills it from the business's info.", "Primero guarda este negocio en tu cuenta — Clara lo llena con la información del negocio.")}</p>
        ) : error ? (
          <>
            <p className="tc-error" role="alert">{error}</p>
            <div className="tr-actions">
              <button type="button" className="tc-primary" onClick={onReteach} data-testid="learned-reteach">{T("Re-teach Clara", "Enséñale otra vez")}</button>
              <button type="button" className="tr-link" onClick={onClose}>{T("Close", "Cerrar")}</button>
            </div>
          </>
        ) : (
          <p className="tr-status"><Loader2 size={16} className="tc-spin" aria-hidden="true" /> {T("Opening Clara's browser…", "Abriendo el navegador de Clara…")}</p>
        )}
      </div>
    </ClaraModal>
  );
}
