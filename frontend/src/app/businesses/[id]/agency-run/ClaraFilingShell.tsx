"use client";

/**
 * Clara — the filing workspace (two screens):
 *
 *  1. Launch: "Ready to file with Clara" — the filings THIS project can
 *     launch now (from SmartPR's requirements, Passport and filing registry
 *     via classifyWorkflows), a "Not ready yet" list, and the Passport
 *     auto-fill strip. No chat box, no browser, no URL field.
 *  2. Active filing: a collapsible workflow sidebar, the selected filing's
 *     header + 5-step stepper + Clara's progress checklist (real run state),
 *     the existing pre-flight / intervention / review cards, and the live
 *     browser. Stop Clara calls the real cancellation.
 *
 * Layout only: every action is the page's existing handler.
 */
import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowLeft, ArrowRight, Building2, Check, ChevronsLeft, ChevronsRight, CircleAlert, ExternalLink, FileText, Flame,
  HeartPulse, IdCard, Landmark, Loader2, Lock, MapPin, Sparkles, Square, Users, X,
} from "lucide-react";
import type { Lang } from "../../../forms/engine/types";
import type { FilingOption } from "../../../../lib/agency-runs/agencyActions";
import {
  FILING_STEPS, PHASE_COPY, PHASE_ORDER, agencyTone, missingCount, workflowKey,
  type AgencyTone, type ClassifiedWorkflows, type FilingProgress, type StepState,
} from "../../../../lib/agency-runs/claraWorkspaceModel";

const L = (en: string, es: string, lang: Lang) => (lang === "es" ? es : en);

const TONE: Record<AgencyTone, { fg: string; bg: string; ring: string; Icon: typeof Landmark }> = {
  ogpe: { fg: "#3B82F6", bg: "#EFF4FF", ring: "#DBE6FE", Icon: Landmark },
  health: { fg: "#10B981", bg: "#ECFDF3", ring: "#D1FAE5", Icon: HeartPulse },
  fire: { fg: "#F97316", bg: "#FFF7ED", ring: "#FFEDD5", Icon: Flame },
  hacienda: { fg: "#8B5CF6", bg: "#F5F3FF", ring: "#EDE9FE", Icon: FileText },
  state: { fg: "#14B8A6", bg: "#ECFEF9", ring: "#CCFBF1", Icon: Users },
  municipal: { fg: "#EC4899", bg: "#FDF2F8", ring: "#FCE7F3", Icon: MapPin },
  demo: { fg: "#64748B", bg: "#F8FAFC", ring: "#E2E8F0", Icon: Building2 },
};

function agencyLabel(f: FilingOption, lang: Lang) {
  return lang === "es" ? f.agency_es : f.agency_en;
}
function titleOf(f: FilingOption, lang: Lang) {
  const a = f.action;
  return a ? (lang === "es" ? a.title_es : a.title_en) : lang === "es" ? f.title_es : f.title_en;
}
function describe(f: FilingOption, lang: Lang) {
  const a = f.action;
  return (a && (lang === "es" ? a.objective_es : a.objective_en)) || L(`File ${titleOf(f, "en")} with ${f.agency_en}.`, `Radica ${titleOf(f, "es")} con ${f.agency_es}.`, lang);
}

// ------------------------------------------------------------------ header

export function ClaraHeader({ lang, onLang, onPassport, onClose, extra }: { lang: Lang; onLang: (l: Lang) => void; onPassport: () => void; onClose: () => void; extra?: ReactNode }) {
  return (
    <header className="flex shrink-0 items-start gap-3 px-5 pb-3 pt-4 sm:px-7">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#EFF4FF]" aria-hidden="true">
        <Sparkles className="h-6 w-6 text-[#2563EB]" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2">
          <span className="text-[26px] font-bold leading-none text-[#0F172A]">Clara</span>
          <span className="rounded-md bg-[#DBEAFE] px-2 py-0.5 text-[12px] font-bold tracking-wide text-[#2563EB]">BETA</span>
        </p>
        <p className="mt-1 text-[14px] text-[#64748B]">{L("Your browser filing assistant", "Tu asistente para radicar en el navegador", lang)}</p>
      </div>
      {extra}
      <div className="hidden flex-col items-center sm:flex">
        <button type="button" onClick={onPassport} className="inline-flex items-center gap-2 rounded-full border border-[#BFD3FE] bg-[#F5F8FF] px-4 py-2 text-[15px] font-semibold text-[#0F172A] hover:bg-[#EAF1FF] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]" data-testid="clara-passport-button">
          <IdCard className="h-4 w-4" aria-hidden="true" /> {L("Business Passport", "Pasaporte del negocio", lang)} <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </button>
        <span className="mt-1 text-[12px] text-[#64748B]">{L("View and manage your saved information", "Ve y administra tu información guardada", lang)}</span>
      </div>
      <button type="button" onClick={onPassport} className="rounded-full border border-[#BFD3FE] p-2 sm:hidden" aria-label={L("Business Passport", "Pasaporte del negocio", lang)}>
        <IdCard className="h-4 w-4" />
      </button>
      <div className="flex shrink-0 items-center gap-0.5 rounded-full border border-[#E5E7EB] bg-[#F8FAFC] p-1" role="group" aria-label={L("Language", "Idioma", lang)}>
        {(["en", "es"] as const).map((l) => (
          <button key={l} type="button" aria-pressed={lang === l} onClick={() => onLang(l)} className={`rounded-full px-3 py-1 text-[13px] font-bold ${lang === l ? "bg-white text-[#0F172A] shadow-sm" : "text-[#64748B]"}`}>
            {l.toUpperCase()}
          </button>
        ))}
      </div>
      <button type="button" onClick={onClose} className="rounded-full p-2 text-[#64748B] hover:bg-[#F1F5F9]" aria-label={L("Close Clara", "Cerrar Clara", lang)} data-testid="clara-close">
        <X className="h-5 w-5" />
      </button>
    </header>
  );
}

// ------------------------------------------------------------------ launch screen

function WorkflowCard({ f, lang, onSelect, busy, selected, compact }: { f: FilingOption; lang: Lang; onSelect: () => void; busy?: boolean; selected?: boolean; compact?: boolean }) {
  const t = TONE[agencyTone(f)];
  const Icon = t.Icon;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`${agencyLabel(f, lang)} — ${titleOf(f, lang)}`}
      className={`group flex w-full items-center gap-4 rounded-[20px] border text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] ${compact ? "p-3.5" : "p-5"} ${selected ? "border-[#3B82F6] bg-[#EFF4FF]" : "border-[#E5E7EB] hover:border-[#CBD5E1]"}`}
      style={selected ? undefined : { background: `linear-gradient(135deg, ${t.bg} 0%, #FFFFFF 85%)` }}
      data-testid="clara-workflow-card"
      data-key={workflowKey(f)}
    >
      <span className={`flex shrink-0 items-center justify-center rounded-full ${compact ? "h-11 w-11" : "h-14 w-14"}`} style={{ background: t.ring }} aria-hidden="true">
        <Icon className={compact ? "h-5 w-5" : "h-7 w-7"} style={{ color: t.fg }} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold" style={{ color: t.fg }}>{agencyLabel(f, lang)}</span>
        <span className={`block font-bold text-[#0F172A] ${compact ? "text-[15px]" : "text-[17px]"}`}>{titleOf(f, lang)}</span>
        <span className={`mt-0.5 block text-[#64748B] ${compact ? "line-clamp-2 text-[13px]" : "text-[14px]"}`}>{describe(f, lang)}</span>
        {f.filing_status === "in_progress" && <span className="mt-1 inline-block rounded-full bg-[#DBEAFE] px-2 py-0.5 text-[12px] font-semibold text-[#2563EB]">{L("In progress", "En curso", lang)}</span>}
      </span>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#E5E7EB] bg-white shadow-sm group-hover:border-[#93C5FD]" aria-hidden="true">
        {busy ? <Loader2 className="h-4 w-4 animate-spin text-[#2563EB]" /> : <ArrowRight className="h-4 w-4 text-[#2563EB]" />}
      </span>
    </button>
  );
}

export interface PassportCategory {
  id: string;
  label: { en: string; es: string };
  available: boolean;
}

export function ClaraLaunchScreen({
  lang, workflows, loading, error, onSelect, busyKey, categories, requirementsHref,
}: {
  lang: Lang;
  workflows: ClassifiedWorkflows;
  loading: boolean;
  error: string | null;
  onSelect: (f: FilingOption) => void;
  busyKey: string | null;
  categories: PassportCategory[];
  requirementsHref: string;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-8 sm:px-7" data-testid="clara-launch">
      <div className="mx-auto max-w-[1180px]">
        <h1 className="mt-4 text-center text-[32px] font-bold tracking-tight text-[#0F172A] sm:text-[40px]">{L("Ready to file with Clara", "Lista para radicar con Clara", lang)}</h1>
        <p className="mx-auto mt-3 max-w-2xl text-center text-[17px] leading-relaxed text-[#475569]">
          {L(
            "Based on your completed information, here are the government workflows you can file now. Your Business Passport details will be automatically used for each submission.",
            "Según la información que completaste, estos son los trámites del gobierno que puedes radicar ahora. Los datos de tu Pasaporte del negocio se usarán automáticamente en cada solicitud.",
            lang
          )}
        </p>
        {loading ? (
          <p className="mt-10 text-center text-[#64748B]"><Loader2 className="mr-2 inline h-5 w-5 animate-spin" />{L("Finding the filings for this project…", "Buscando los trámites de este proyecto…", lang)}</p>
        ) : error ? (
          <p className="mx-auto mt-8 max-w-xl rounded-2xl border border-rose-200 bg-rose-50 p-4 text-center text-[15px] text-rose-800">{error}</p>
        ) : workflows.ready.length === 0 ? (
          <div className="mx-auto mt-8 max-w-xl rounded-2xl border border-[#E5E7EB] bg-white p-6 text-center" data-testid="clara-no-workflows">
            <p className="text-[16px] font-semibold text-[#0F172A]">{L("Nothing is ready for Clara to file yet", "Todavía no hay nada listo para que Clara radique", lang)}</p>
            <p className="mt-1 text-[14px] text-[#64748B]">{L("Finish the items your requirements still need, and the filings Clara can do will appear here.", "Completa lo que todavía piden tus requisitos y aquí aparecerán los trámites que Clara puede hacer.", lang)}</p>
            <a href={requirementsHref} className="mt-3 inline-flex items-center gap-1 text-[14px] font-semibold text-[#2563EB] hover:underline">{L("View requirements", "Ver requisitos", lang)} <ExternalLink className="h-3.5 w-3.5" /></a>
          </div>
        ) : (
          <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3" role="list">
            {workflows.ready.map((f) => (
              <div role="listitem" key={workflowKey(f)}>
                <WorkflowCard f={f} lang={lang} onSelect={() => onSelect(f)} busy={busyKey === workflowKey(f)} />
              </div>
            ))}
          </div>
        )}

        {!loading && workflows.notReady.length > 0 && (
          <section className="mt-8" aria-labelledby="clara-not-ready" data-testid="clara-not-ready">
            <h2 id="clara-not-ready" className="text-[13px] font-bold uppercase tracking-[0.12em] text-[#64748B]">{L("Not ready yet", "Todavía no está listo", lang)}</h2>
            <ul className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {workflows.notReady.map((f) => {
                const n = missingCount(f);
                return (
                  <li key={workflowKey(f)} className="flex items-center gap-3 rounded-2xl border border-dashed border-[#E2E8F0] bg-[#FAFAF9] p-4" data-testid="clara-not-ready-card">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] text-[#64748B]">{agencyLabel(f, lang)}</p>
                      <p className="font-semibold text-[#334155]">{titleOf(f, lang)}</p>
                      <p className="text-[13px] text-[#B45309]">{n === 1 ? L("1 item missing", "Falta 1 dato", lang) : L(`${n} items missing`, `Faltan ${n} datos`, lang)}</p>
                    </div>
                    <a href={requirementsHref} className="shrink-0 text-[13px] font-semibold text-[#2563EB] hover:underline">{L("View missing requirements", "Ver lo que falta", lang)}</a>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <section className="mt-8 flex flex-col gap-4 rounded-[20px] border border-[#E5E7EB] bg-[#F8FAFC] p-5 md:flex-row md:items-center" data-testid="clara-autofill-strip">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#E2E8F0]" aria-hidden="true"><Lock className="h-5 w-5 text-[#334155]" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-[16px] font-bold text-[#0F172A]">{L("Your information is automatically filled", "Tu información se llena automáticamente", lang)}</p>
            <p className="text-[14px] text-[#64748B]">{L("All relevant details from your Business Passport will be securely used for each agency submission.", "Los datos relevantes de tu Pasaporte del negocio se usan de forma segura en cada solicitud a la agencia.", lang)}</p>
          </div>
          <ul className="grid shrink-0 grid-cols-2 gap-x-8 gap-y-2">
            {categories.map((c) => (
              <li key={c.id} className="flex items-center gap-2 text-[14px] text-[#334155]" data-available={c.available ? "1" : "0"}>
                <span className={`flex h-5 w-5 items-center justify-center rounded-full ${c.available ? "bg-[#059669]" : "border border-[#CBD5E1] bg-white"}`} aria-hidden="true">{c.available && <Check className="h-3 w-3 text-white" />}</span>
                {L(c.label.en, c.label.es, lang)}
                <span className="sr-only">{c.available ? L("on file", "guardado", lang) : L("not on file yet", "aún no guardado", lang)}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ active filing

const SIDEBAR_KEY = "smartpr.clara.sidebarCollapsed";

export function WorkflowSidebar({ lang, workflows, selectedKey, onSelect, onBack, busyKey }: { lang: Lang; workflows: ClassifiedWorkflows; selectedKey: string | null; onSelect: (f: FilingOption) => void; onBack: () => void; busyKey: string | null }) {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      if (sessionStorage.getItem(SIDEBAR_KEY) === "1") setCollapsed(true); // eslint-disable-line react-hooks/set-state-in-effect
    } catch {}
  }, []);
  const toggle = () =>
    setCollapsed((c) => {
      try {
        sessionStorage.setItem(SIDEBAR_KEY, c ? "0" : "1");
      } catch {}
      return !c;
    });
  return (
    <aside
      className={`hidden min-h-0 shrink-0 flex-col border-r border-[#E5E7EB] bg-white transition-[width] duration-200 ease-out lg:flex ${collapsed ? "w-14" : "w-[22%] min-w-[260px] max-w-[340px]"}`}
      aria-label={L("Available filing workflows", "Trámites disponibles", lang)}
      data-testid="clara-sidebar"
      data-collapsed={collapsed ? "1" : "0"}
    >
      {collapsed ? (
        <button type="button" onClick={toggle} className="m-2 rounded-xl p-2 text-[#64748B] hover:bg-[#F1F5F9]" aria-label={L("Show workflows", "Mostrar trámites", lang)} aria-expanded={false} data-testid="clara-sidebar-toggle">
          <ChevronsRight className="h-5 w-5" />
        </button>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-start gap-2 px-4 pb-3 pt-4">
            <div className="min-w-0 flex-1">
              <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-[#2563EB] hover:underline" data-testid="clara-back-to-workflows">
                <ArrowLeft className="h-4 w-4" /> {L("Back to workflows", "Volver a los trámites", lang)}
              </button>
              <h2 className="mt-3 text-[18px] font-bold text-[#0F172A]">{L("Available filing workflows", "Trámites disponibles", lang)}</h2>
              <p className="text-[13px] text-[#64748B]">{L("Based on your completed information", "Según la información que completaste", lang)}</p>
            </div>
            <button type="button" onClick={toggle} className="rounded-lg p-1.5 text-[#64748B] hover:bg-[#F1F5F9]" aria-label={L("Collapse workflows", "Ocultar trámites", lang)} aria-expanded={true} data-testid="clara-sidebar-toggle">
              <ChevronsLeft className="h-5 w-5" />
            </button>
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-4">
            {workflows.ready.map((f) => (
              <WorkflowCard key={workflowKey(f)} f={f} lang={lang} compact selected={selectedKey === workflowKey(f)} busy={busyKey === workflowKey(f)} onSelect={() => onSelect(f)} />
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}

function StepDot({ state, n }: { state: StepState; n: number }) {
  const base = "flex h-8 w-8 items-center justify-center rounded-full border-2 text-[13px] font-bold";
  if (state === "done") return <span className={`${base} border-[#2563EB] bg-[#2563EB] text-white`}><Check className="h-4 w-4" /></span>;
  if (state === "current") return <span className={`${base} border-[#2563EB] bg-[#2563EB] text-white ring-4 ring-[#DBEAFE]`}>{n}</span>;
  if (state === "waiting") return <span className={`${base} border-[#D97706] bg-[#FEF3C7] text-[#B45309]`}>{n}</span>;
  if (state === "error") return <span className={`${base} border-[#F43F5E] bg-[#FFE4E6] text-[#BE123C]`}>!</span>;
  return <span className={`${base} border-[#CBD5E1] bg-white text-[#94A3B8]`}>{n}</span>;
}

export function FilingStepper({ lang, progress }: { lang: Lang; progress: FilingProgress }) {
  return (
    <ol className="flex items-start" aria-label={L("Filing progress", "Progreso del trámite", lang)} data-testid="clara-stepper" data-step={progress.step}>
      {FILING_STEPS.map((s, i) => {
        const state = progress.steps[i];
        return (
          <li key={i} className="flex flex-1 flex-col items-center text-center" data-state={state} aria-current={i === progress.step ? "step" : undefined}>
            <div className="flex w-full items-center">
              <span className={`h-0.5 flex-1 ${i === 0 ? "invisible" : progress.steps[i - 1] === "done" ? "bg-[#2563EB]" : "bg-[#E2E8F0]"}`} />
              <StepDot state={state} n={i + 1} />
              <span className={`h-0.5 flex-1 ${i === FILING_STEPS.length - 1 ? "invisible" : state === "done" ? "bg-[#2563EB]" : "bg-[#E2E8F0]"}`} />
            </div>
            <span className={`mt-2 text-[13px] sm:text-[14px] ${state === "current" || state === "waiting" ? "font-semibold text-[#2563EB]" : state === "error" ? "font-semibold text-[#BE123C]" : state === "done" ? "text-[#0F172A]" : "text-[#64748B]"}`}>{L(s.en, s.es, lang)}</span>
          </li>
        );
      })}
    </ol>
  );
}

function PhaseIcon({ state }: { state: StepState }) {
  if (state === "done") return <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#059669]"><Check className="h-3.5 w-3.5 text-white" /></span>;
  if (state === "current") return <Loader2 className="h-6 w-6 animate-spin text-[#2563EB]" />;
  if (state === "waiting") return <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#FEF3C7]"><CircleAlert className="h-4 w-4 text-[#D97706]" /></span>;
  if (state === "error") return <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#FFE4E6]"><X className="h-4 w-4 text-[#E11D48]" /></span>;
  return <span className="h-6 w-6 rounded-full border-2 border-[#CBD5E1]" />;
}

export function ClaraProgressPanel({ lang, progress, businessLine, fieldsLine, portalName, children }: { lang: Lang; progress: FilingProgress; businessLine: string | null; fieldsLine: string | null; portalName: string; children?: ReactNode }) {
  const heading =
    progress.terminal === "submitted" ? L("Filed — you submitted it", "Radicado — tú lo enviaste", lang)
    : progress.terminal === "stopped" ? L("Clara stopped", "Clara se detuvo", lang)
    : progress.terminal === "failed" ? L("Clara couldn't finish this filing", "Clara no pudo terminar este trámite", lang)
    : progress.step === 4 && progress.needsYou ? L("Ready for your review", "Lista para tu revisión", lang)
    : progress.needsYou ? L("Clara needs your help", "Clara necesita tu ayuda", lang)
    : L("Clara is preparing your filing…", "Clara está preparando tu trámite…", lang);
  const detail = (p: (typeof PHASE_ORDER)[number]) =>
    p === "LOAD_PASSPORT" && businessLine ? businessLine
    : p === "MAP_FIELDS" && fieldsLine ? fieldsLine
    : p === "OPEN_PORTAL" ? L(`Launching ${portalName}`, `Abriendo ${portalName}`, lang)
    : L(PHASE_COPY[p].detail.en, PHASE_COPY[p].detail.es, lang);
  return (
    <div className="flex min-h-0 flex-col gap-4" data-testid="clara-progress">
      <div className="rounded-[20px] border border-[#E5E7EB] bg-white p-5">
        <div className="flex items-start gap-3">
          {progress.terminal || progress.needsYou ? (
            <span className={`mt-0.5 flex h-9 w-9 items-center justify-center rounded-full ${progress.terminal === "submitted" ? "bg-[#D1FAE5]" : progress.terminal ? "bg-[#FFE4E6]" : "bg-[#FEF3C7]"}`}>
              {progress.terminal === "submitted" ? <Check className="h-5 w-5 text-[#059669]" /> : <CircleAlert className={`h-5 w-5 ${progress.terminal ? "text-[#E11D48]" : "text-[#D97706]"}`} />}
            </span>
          ) : (
            <Loader2 className="mt-0.5 h-9 w-9 shrink-0 animate-spin text-[#93C5FD]" aria-hidden="true" />
          )}
          <div>
            <h3 className="text-[19px] font-bold text-[#0F172A]" aria-live="polite" data-testid="clara-progress-heading">{heading}</h3>
            <p className="text-[14px] text-[#64748B]">{L("Using your Business Passport information to automatically complete the application.", "Usando la información de tu Pasaporte del negocio para completar la solicitud automáticamente.", lang)}</p>
          </div>
        </div>
        <ol className="mt-4 space-y-3">
          {PHASE_ORDER.map((p) => (
            <li key={p} className="flex items-start gap-3" data-testid="clara-phase" data-phase={p} data-state={progress.phases[p]}>
              <PhaseIcon state={progress.phases[p]} />
              <span className="min-w-0">
                <span className={`block text-[15px] ${progress.phases[p] === "upcoming" ? "text-[#64748B]" : "font-semibold text-[#0F172A]"}`}>{L(PHASE_COPY[p].label.en, PHASE_COPY[p].label.es, lang)}</span>
                <span className="block text-[13px] text-[#64748B]">{detail(p)}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>
      {children}
      <div className="flex items-start gap-3 rounded-2xl bg-[#EFF4FF] p-4" data-testid="clara-security-note">
        <Lock className="mt-0.5 h-5 w-5 shrink-0 text-[#1E3A8A]" aria-hidden="true" />
        <div>
          <p className="text-[14px] font-semibold text-[#1E3A8A]">{L("Your information stays private", "Tu información se mantiene privada", lang)}</p>
          <p className="text-[13px] text-[#334155]">{L("Only used to complete this filing. Nothing is submitted without your approval.", "Solo se usa para completar este trámite. Nada se envía sin tu aprobación.", lang)}</p>
        </div>
      </div>
    </div>
  );
}

export function FilingHeader({ lang, filing, requirementsHref }: { lang: Lang; filing: FilingOption; requirementsHref: string }) {
  const t = TONE[agencyTone(filing)];
  const Icon = t.Icon;
  return (
    <div className="flex flex-wrap items-center gap-4" data-testid="clara-filing-header">
      <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full" style={{ background: t.ring }} aria-hidden="true">
        <Icon className="h-8 w-8" style={{ color: t.fg }} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-semibold" style={{ color: t.fg }}>{agencyLabel(filing, lang)}</p>
        <h2 className="text-[24px] font-bold leading-tight text-[#0F172A]">{titleOf(filing, lang)}</h2>
        <p className="text-[14px] text-[#64748B]">{describe(filing, lang)}</p>
      </div>
      <a href={requirementsHref} className="inline-flex items-center gap-2 rounded-full border border-[#E5E7EB] bg-white px-4 py-2 text-[14px] font-semibold text-[#0F172A] hover:bg-[#F8FAFC]" data-testid="clara-view-requirements">
        {L("View requirements", "Ver requisitos", lang)} <ExternalLink className="h-4 w-4" aria-hidden="true" />
      </a>
    </div>
  );
}

export function BrowserFrame({ lang, live, children }: { lang: Lang; live: boolean; children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[20px] border border-[#E5E7EB] bg-white" data-testid="clara-browser">
      <div className="flex shrink-0 items-center gap-2 border-b border-[#F1F5F9] px-4 py-2.5">
        <span className={`h-2.5 w-2.5 rounded-full ${live ? "bg-[#10B981]" : "bg-[#CBD5E1]"}`} aria-hidden="true" />
        <span className="flex-1 text-[14px] text-[#334155]">{L("Clara is working in a secure browser", "Clara trabaja en un navegador seguro", lang)}</span>
        {live && <span className="inline-flex items-center gap-1.5 rounded-full bg-[#D1FAE5] px-2.5 py-0.5 text-[12px] font-bold text-[#047857]"><span className="h-1.5 w-1.5 rounded-full bg-[#10B981]" />LIVE</span>}
      </div>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}

export function StopClaraButton({ lang, onStop, busy }: { lang: Lang; onStop: () => void; busy: boolean }) {
  return (
    <button type="button" onClick={onStop} disabled={busy} className="inline-flex items-center gap-2 rounded-full border-2 border-[#FDA4AF] bg-white px-5 py-2 text-[15px] font-semibold text-[#E11D48] hover:bg-[#FFF1F2] disabled:opacity-50" data-testid="clara-stop">
      <Square className="h-4 w-4 fill-[#E11D48]" aria-hidden="true" /> {L("Stop Clara", "Detener a Clara", lang)}
    </button>
  );
}

/** The Business Passport, opened over the workspace (the filing keeps running underneath). */
export function PassportDrawer({ lang, open, onClose, children, fullHref }: { lang: Lang; open: boolean; onClose: () => void; children: ReactNode; fullHref: string }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" role="dialog" aria-modal="true" aria-label={L("Business Passport", "Pasaporte del negocio", lang)} onClick={onClose}>
      <div className="flex h-full w-full max-w-md flex-col bg-white shadow-2xl" onClick={(e) => e.stopPropagation()} data-testid="clara-passport-drawer">
        <div className="flex items-center gap-2 border-b border-[#E5E7EB] px-5 py-4">
          <IdCard className="h-5 w-5 text-[#2563EB]" aria-hidden="true" />
          <h2 className="flex-1 text-[18px] font-bold text-[#0F172A]">{L("Business Passport", "Pasaporte del negocio", lang)}</h2>
          <a href={fullHref} className="text-[13px] font-semibold text-[#2563EB] hover:underline">{L("Edit", "Editar", lang)}</a>
          <button type="button" onClick={onClose} className="rounded-full p-1.5 text-[#64748B] hover:bg-[#F1F5F9]" aria-label={L("Close", "Cerrar", lang)}><X className="h-5 w-5" /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
