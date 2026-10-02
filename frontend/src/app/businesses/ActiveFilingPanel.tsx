"use client";

/**
 * Business page — the active filing (primary focus) and the
 * Passport-vs-location municipality notice. Pure presentation over
 * activeFilingFor / municipalityConflict; the Continue target reuses the
 * page's existing destinations (requirement row, Clara, intake resume).
 */
import Link from "next/link";
import { AlertTriangle, ArrowRight } from "lucide-react";
import type { Lang } from "../forms/engine/types";
import type { ActiveFiling, FilingStage, MunicipalityConflict } from "./activeFiling";

const L = (en: string, es: string, lang: Lang) => (lang === "es" ? es : en);

const STAGE: Record<FilingStage, { en: string; es: string; cls: string; note: { en: string; es: string } }> = {
  action_needed: {
    en: "Action needed", es: "Acción requerida", cls: "bg-rose-50 text-rose-700 border-rose-200",
    note: { en: "This filing can't move forward until the items below are done.", es: "Este trámite no avanza hasta completar lo de abajo." },
  },
  in_progress: {
    en: "In progress", es: "En progreso", cls: "bg-sky-50 text-sky-700 border-sky-200",
    note: { en: "Work is underway on this filing's requirements.", es: "Se está trabajando en los requisitos de este trámite." },
  },
  upcoming: {
    en: "Upcoming", es: "Próximo", cls: "bg-slate-100 text-slate-700 border-slate-200",
    note: { en: "Nothing is overdue; the remaining items have later dates.", es: "Nada está vencido; lo que queda tiene fechas más adelante." },
  },
  ready_for_review: {
    en: "Ready for review", es: "Listo para revisar", cls: "bg-amber-50 text-amber-800 border-amber-200",
    note: { en: "Clara filled the agency form and stopped before the submit step. Review it in the portal — nothing has been submitted.", es: "Clara llenó el formulario de la agencia y se detuvo antes de enviar. Revísalo en el portal — no se ha enviado nada." },
  },
  ready_for_submission: {
    en: "Ready for submission", es: "Listo para enviar", cls: "bg-emerald-50 text-emerald-700 border-emerald-200",
    note: { en: "SmartPR's checklist for this filing is complete. You still submit it to the agency, and approval is the agency's decision.", es: "La lista de SmartPR para este trámite está completa. Aún debes enviarlo a la agencia, y la aprobación la decide la agencia." },
  },
  submitted_waiting: {
    en: "Submitted · waiting on agency", es: "Enviado · esperando a la agencia", cls: "bg-violet-50 text-violet-700 border-violet-200",
    note: { en: "Submitted through Clara. SmartPR doesn't receive the agency's decision — check the agency portal for approval.", es: "Enviado con Clara. SmartPR no recibe la decisión de la agencia — revisa el portal de la agencia para la aprobación." },
  },
};

export function ActiveFilingPanel({
  lang, filing, businessId, onOpenRequirement, municipalityFlag,
}: {
  lang: Lang;
  filing: ActiveFiling | null;
  businessId: string;
  onOpenRequirement: () => void;
  /** Passport municipality when it conflicts with the saved location. */
  municipalityFlag: string | null;
}) {
  if (!filing) {
    return (
      <section className="rounded-2xl border border-[#D9DCE1] bg-white p-5" data-testid="active-filing" data-stage="none">
        <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">{L("Active filing", "Trámite activo", lang)}</div>
        <p className="mt-1 text-base font-bold text-[#161616]">{L("No filing in progress", "No hay trámites en curso", lang)}</p>
        <p className="mt-1 text-sm text-slate-600">{L("Start a new filing or renewal to track its requirements here.", "Empieza un trámite o renovación para seguir sus requisitos aquí.", lang)}</p>
        <Link href={`/businesses/${businessId}/matters/new`} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-[#f6f3ea]">
          {L("Start New Filing / Renewal", "Comenzar trámite / renovación", lang)} <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </section>
    );
  }
  const st = STAGE[filing.stage];
  const m = filing.matter as ActiveFiling["matter"] & { submission_id?: string | null };
  const clara = filing.stage === "ready_for_review" || filing.stage === "submitted_waiting";
  const next = filing.next;
  const continueHref = clara
    ? `/businesses/${businessId}/agency-run`
    : next
      ? `#obligation-${next.item.id}`
      : m.submission_id
        ? `/?entry=new-business&resume=${m.submission_id}`
        : "#all-requirements";
  const continueOpensList = !clara && (next || !m.submission_id);

  return (
    <section className="rounded-2xl border-2 border-brand/25 bg-white p-4 sm:p-5" data-testid="active-filing" data-stage={filing.stage} aria-labelledby="active-filing-title">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">{L("Active filing", "Trámite activo", lang)}</span>
        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${st.cls}`} data-testid="active-filing-stage" title={L(st.note.en, st.note.es, lang)}>{L(st.en, st.es, lang)}</span>
      </div>
      <h2 id="active-filing-title" className="mt-1 text-lg font-bold leading-tight text-[#161616]">{filing.matter.title}</h2>
      <p className="sr-only">{L(st.note.en, st.note.es, lang)}</p>

      <div className="mt-3">
        <div className="flex items-baseline justify-between text-sm">
          <span className="text-slate-600">
            {filing.total
              ? L(`${filing.done} of ${filing.total} requirements done`, `${filing.done} de ${filing.total} requisitos listos`, lang)
              : L("No requirements linked yet", "Aún no hay requisitos vinculados", lang)}
            {municipalityFlag && filing.total > 0 && <span className="ml-1 text-amber-800" title={L("May change once the municipality mismatch is resolved", "Puede cambiar al resolver el municipio", lang)}>*</span>}
          </span>
          {filing.pct != null && <span className="font-bold text-[#161616]">{filing.pct}%</span>}
        </div>
        {filing.pct != null && (
          <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-[#ECEAE4]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={filing.pct} aria-label={L("Filing readiness", "Preparación del trámite", lang)}>
            <div className="h-full rounded-full bg-brand" style={{ width: `${filing.pct}%` }} />
          </div>
        )}
      </div>

      <p className="mt-3 text-sm" data-testid="active-filing-next">
        <span className="font-semibold text-slate-500">{L("Next: ", "Próximo: ", lang)}</span>
        <span className="font-semibold text-[#161616]">
          {clara ? L(st.en, st.es, lang) : next ? next.item.name : L("Submit to the agency", "Enviar a la agencia", lang)}
        </span>
        {next && !clara && next.why && <span className="block text-xs text-slate-500 line-clamp-2">{L(next.why.en, next.why.es, lang)}</span>}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <a
          href={continueHref}
          onClick={continueOpensList ? onOpenRequirement : undefined}
          className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-[#f6f3ea] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
          data-testid="active-filing-continue"
        >
          {clara ? L("Continue in Clara", "Continuar en Clara", lang) : L("Continue", "Continuar", lang)}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </a>
        {filing.blockers.length > 0 && (
          <a href="#all-requirements" onClick={onOpenRequirement} className="text-sm font-semibold text-brand hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand" data-testid="active-filing-view-requirements">
            {L(`View requirements (${filing.blockers.length})`, `Ver requisitos (${filing.blockers.length})`, lang)}
          </a>
        )}
      </div>
    </section>
  );
}

export function MunicipalityNotice({
  lang, conflict, affected, onResolve, onReviewPassport,
}: {
  lang: Lang;
  conflict: MunicipalityConflict;
  affected: string[];
  /** Opens the property-location section (where the mismatch is resolved). */
  onResolve: () => void;
  onReviewPassport: () => void;
}) {
  return (
    <section role="alert" className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3" data-testid="municipality-conflict">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-sm text-amber-900">
          <span className="font-bold">{L("Municipality mismatch: ", "Municipio no coincide: ", lang)}</span>
          {L(`Passport says ${conflict.passport}, saved location is in ${conflict.location}.`, `El Pasaporte dice ${conflict.passport}; la ubicación guardada está en ${conflict.location}.`, lang)}
        </p>
        <button type="button" onClick={onResolve} className="shrink-0 rounded-lg border border-amber-400 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-600" data-testid="resolve-mismatch">
          {L("Resolve mismatch", "Resolver", lang)}
        </button>
      </div>
      <details className="mt-1.5 text-xs text-amber-900" data-testid="mismatch-details">
        <summary className="cursor-pointer font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-600">{L("Why this matters", "Por qué importa", lang)}</summary>
        <p className="mt-1">
          {L(
            `Location-specific requirements were evaluated with the Passport municipality (${conflict.passport}). Overall readiness and the active filing's checklist may change once you confirm which is right. Nothing is changed automatically.`,
            `Los requisitos que dependen de la ubicación se evaluaron con el municipio del Pasaporte (${conflict.passport}). La preparación general y la lista del trámite activo pueden cambiar cuando confirmes cuál es el correcto. No se cambia nada automáticamente.`,
            lang
          )}
          {conflict.locationName ? L(` Saved location: ${conflict.locationName}.`, ` Ubicación guardada: ${conflict.locationName}.`, lang) : ""}
        </p>
        {affected.length > 0 && <p className="mt-1 font-semibold">{L("May be affected:", "Pueden cambiar:", lang)} {affected.join(", ")}</p>}
        <button type="button" onClick={onReviewPassport} className="mt-1.5 font-semibold underline focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-600">{L("Or edit the Passport municipality", "O editar el municipio del Pasaporte", lang)}</button>
      </details>
    </section>
  );
}
