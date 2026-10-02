"use client";

/**
 * Business page — the active filing (primary focus) and the
 * Passport-vs-location municipality notice. Pure presentation over
 * activeFilingFor / municipalityConflict; the Continue target reuses the
 * page's existing destinations (requirement row, Clara, intake resume).
 */
import Link from "next/link";
import { AlertTriangle, ArrowRight, Building2, FileText } from "lucide-react";
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

const BLOCKER_STATUS: Record<string, { en: string; es: string }> = {
  MISSING: { en: "Not started", es: "Sin empezar" },
  OVERDUE: { en: "Overdue", es: "Vencido" },
  NEEDS_ATTENTION: { en: "Missing information", es: "Falta información" },
  UNKNOWN: { en: "Needs information", es: "Necesita información" },
  IN_PROGRESS: { en: "In progress", es: "En progreso" },
  DUE_SOON: { en: "Due soon", es: "Vence pronto" },
  UPCOMING: { en: "Upcoming", es: "Próximo" },
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
  const shownBlockers = filing.blockers.slice(0, 4);

  return (
    <section className="rounded-2xl border-2 border-brand/25 bg-white p-5" data-testid="active-filing" data-stage={filing.stage} aria-labelledby="active-filing-title">
      <div className="flex flex-wrap items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#E6F0EE] text-brand" aria-hidden="true"><FileText className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">{L("Active filing", "Trámite activo", lang)}</div>
          <h2 id="active-filing-title" className="text-lg font-bold leading-tight text-[#161616]">{filing.matter.title}</h2>
          <p className="mt-0.5 flex items-center gap-1.5 text-sm text-slate-600">
            <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
            {filing.agency ?? L("Agency not recorded", "Agencia no registrada", lang)}
          </p>
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${st.cls}`} data-testid="active-filing-stage">{L(st.en, st.es, lang)}</span>
      </div>
      <p className="mt-2 text-sm text-slate-600">{L(st.note.en, st.note.es, lang)}</p>

      <div className="mt-4">
        <div className="flex items-baseline justify-between text-sm">
          <span className="font-semibold text-[#161616]">
            {filing.total
              ? L(`${filing.done} of ${filing.total} filing requirements done`, `${filing.done} de ${filing.total} requisitos del trámite listos`, lang)
              : L("No requirements are linked to this filing yet", "Aún no hay requisitos vinculados a este trámite", lang)}
          </span>
          {filing.pct != null && <span className="font-bold text-[#161616]">{filing.pct}%</span>}
        </div>
        {filing.pct != null && (
          <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-[#ECEAE4]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={filing.pct} aria-label={L("Filing readiness", "Preparación del trámite", lang)}>
            <div className="h-full rounded-full bg-brand" style={{ width: `${filing.pct}%` }} />
          </div>
        )}
        {municipalityFlag && filing.total > 0 && (
          <p className="mt-1 text-xs font-medium text-amber-800">{L(`Evaluated with the Passport municipality (${municipalityFlag}) — may change once the conflict is resolved.`, `Evaluado con el municipio del Pasaporte (${municipalityFlag}) — puede cambiar al resolver el conflicto.`, lang)}</p>
        )}
      </div>

      {next && !clara && (
        <div className="mt-4 rounded-xl bg-[#F4F1EA] p-3" data-testid="active-filing-next">
          <div className="text-xs font-semibold text-slate-500">{L("Next step", "Próximo paso", lang)}</div>
          <div className="font-bold text-[#161616]">{next.item.name}</div>
          <p className="mt-0.5 text-sm text-slate-600">
            {next.why ? L(next.why.en, next.why.es, lang) : L("Required for this filing before it can move forward.", "Requerido para que este trámite avance.", lang)}
          </p>
        </div>
      )}

      {shownBlockers.length > 0 && (
        <ul className="mt-3 space-y-1.5" aria-label={L("Blocking this filing", "Bloquea este trámite", lang)} data-testid="active-filing-blockers">
          {shownBlockers.map((b) => {
            const label = BLOCKER_STATUS[b.status] ?? { en: b.status, es: b.status };
            return (
              <li key={b.id} className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate text-[#161616]">{b.name}</span>
                <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">{L(label.en, label.es, lang)}</span>
              </li>
            );
          })}
          {filing.blockers.length > shownBlockers.length && (
            <li className="text-xs text-slate-500">{L(`+${filing.blockers.length - shownBlockers.length} more`, `+${filing.blockers.length - shownBlockers.length} más`, lang)}</li>
          )}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <a
          href={continueHref}
          onClick={continueOpensList ? onOpenRequirement : undefined}
          className="inline-flex items-center gap-2 rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-[#f6f3ea] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
          data-testid="active-filing-continue"
        >
          {clara
            ? L("Continue in Clara", "Continuar en Clara", lang)
            : next
              ? L(`Continue: ${next.item.name}`, `Continuar: ${next.item.name}`, lang)
              : L("Continue filing", "Continuar el trámite", lang)}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </a>
        {filing.others.length > 0 && (
          <span className="text-xs text-slate-500">{L(`${filing.others.length} other active filing${filing.others.length === 1 ? "" : "s"} below`, `${filing.others.length} trámite${filing.others.length === 1 ? "" : "s"} activo${filing.others.length === 1 ? "" : "s"} más abajo`, lang)}</span>
        )}
      </div>
    </section>
  );
}

export function MunicipalityNotice({
  lang, conflict, affected, onReviewLocation, onReviewPassport,
}: {
  lang: Lang;
  conflict: MunicipalityConflict;
  affected: string[];
  onReviewLocation: () => void;
  onReviewPassport: () => void;
}) {
  return (
    <section role="alert" className="rounded-2xl border border-amber-300 bg-amber-50 p-4" data-testid="municipality-conflict">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-amber-900">{L("Municipality doesn't match", "El municipio no coincide", lang)}</h2>
          <dl className="mt-1 grid grid-cols-[auto,1fr] gap-x-2 text-sm text-amber-900">
            <dt>{L("Business Passport:", "Pasaporte del negocio:", lang)}</dt><dd className="font-semibold">{conflict.passport}</dd>
            <dt>{L("Saved location:", "Ubicación guardada:", lang)}</dt><dd className="font-semibold">{conflict.location}{conflict.locationName ? ` (${conflict.locationName})` : ""}</dd>
          </dl>
          <p className="mt-1.5 text-xs text-amber-900">
            {L(
              "Location-specific requirements were evaluated with the Passport municipality. Overall readiness, the active filing's checklist and these items may change once you confirm which one is right. Nothing is changed automatically.",
              "Los requisitos que dependen de la ubicación se evaluaron con el municipio del Pasaporte. La preparación general, la lista del trámite activo y estos requisitos pueden cambiar cuando confirmes cuál es el correcto. No se cambia nada automáticamente.",
              lang
            )}
          </p>
          {affected.length > 0 && <p className="mt-1 text-xs font-semibold text-amber-900">{L("May be affected:", "Pueden cambiar:", lang)} {affected.join(", ")}</p>}
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={onReviewLocation} className="rounded-lg border border-amber-400 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-600">{L("Review location", "Revisar ubicación", lang)}</button>
            <button type="button" onClick={onReviewPassport} className="rounded-lg border border-amber-400 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-600">{L("Review Passport", "Revisar Pasaporte", lang)}</button>
          </div>
        </div>
      </div>
    </section>
  );
}
