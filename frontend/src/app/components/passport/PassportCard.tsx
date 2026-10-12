"use client";

// Sidebar card on the requirements page: the Business Passport is filled in
// once and SmartPR copies it into every form on the list. Shows how complete
// it is, what's still missing, and opens the editor (CoreApplicationDetails in
// Passport mode) in a modal so the user never leaves the list.

import { CheckCircle2, IdCard } from "lucide-react";
import { ClaraModal } from "../clara/ClaraModal";
import { CoreApplicationDetails } from "../../forms/engine/CoreApplicationDetails";
import type { CanonicalApplicationData } from "../../forms/engine/types";
import { passportSummary } from "./passportSummary";

type Language = "en" | "es";

export function PassportEditor({ canonical, language, onChange, onClose }: { canonical: CanonicalApplicationData; language: Language; onChange: (next: CanonicalApplicationData) => void; onClose: () => void }) {
  const es = language === "es";
  const sum = passportSummary(canonical, language);
  return (
    <ClaraModal
      title={es ? "Pasaporte de Negocio" : "Business Passport"}
      onClose={onClose}
      testId="passport-editor"
      wide
      footer={
        <>
          <span className="cl-progress">{es ? `${sum.done} de ${sum.total} datos` : `${sum.done} of ${sum.total} details`} · {es ? "Se guarda solo" : "Saves as you type"}</span>
          <button type="button" className="cl-btn" onClick={onClose} data-testid="passport-done">
            <CheckCircle2 size={15} aria-hidden="true" /> {es ? "Listo — actualizar mis formularios" : "Done — update my forms"}
          </button>
        </>
      }
    >
      <CoreApplicationDetails
        passportMode
        canonical={canonical}
        lang={language}
        onChange={onChange}
        banner={{ en: "Fill it in once. SmartPR copies these details into every form, worksheet and package on your list — fields you've typed in a form yourself are kept.", es: "Llénalo una vez. SmartPR copia estos datos en cada formulario, hoja de trabajo y paquete de tu lista — lo que escribiste tú en un formulario se mantiene." }}
      />
    </ClaraModal>
  );
}

export function PassportCard({ canonical, language, onEdit }: { canonical: CanonicalApplicationData; language: Language; onEdit: () => void }) {
  const es = language === "es";
  const sum = passportSummary(canonical, language);
  const pct = sum.total ? Math.round((sum.done / sum.total) * 100) : 0;
  const complete = sum.done === sum.total;
  const shown = sum.missing.slice(0, 3);
  return (
    <section className="rq-passport-card" data-testid="sidebar-passport">
      <h2><IdCard size={15} aria-hidden="true" /> {es ? "Pasaporte de Negocio" : "Business Passport"}</h2>
      <p>
        {es
          ? "Llénalo una vez. SmartPR usa estos datos para llenar cada formulario de esta lista — no los vuelves a escribir."
          : "Fill it in once. SmartPR uses it to pre-fill every form on this list — you never type it twice."}
      </p>
      <div className="rq-passport-meter" role="progressbar" aria-valuemin={0} aria-valuemax={sum.total} aria-valuenow={sum.done} aria-label={es ? "Datos del pasaporte" : "Passport details"}>
        <span style={{ width: `${pct}%` }} />
      </div>
      <p className="rq-passport-count" data-testid="passport-count">
        {complete
          ? <><CheckCircle2 size={14} aria-hidden="true" /> {es ? "Completo — tus formularios ya vienen llenos" : "Complete — your forms come pre-filled"}</>
          : es ? `${sum.done} de ${sum.total} datos` : `${sum.done} of ${sum.total} details`}
      </p>
      {!complete && (
        <p className="rq-passport-missing">
          {es ? "Falta: " : "Missing: "}{shown.join(", ")}{sum.missing.length > shown.length ? (es ? ` y ${sum.missing.length - shown.length} más` : ` and ${sum.missing.length - shown.length} more`) : ""}
        </p>
      )}
      <button type="button" className={`rq-std-btn ${complete ? "rq-std-ask" : "rq-std-clara"}`} onClick={onEdit} data-testid="passport-edit">
        <IdCard size={14} aria-hidden="true" /> {complete ? (es ? "Revisar pasaporte" : "Review passport") : (es ? "Completar pasaporte" : "Complete your passport")}
      </button>
    </section>
  );
}
