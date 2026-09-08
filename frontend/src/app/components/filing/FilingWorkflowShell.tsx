"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Sparkles,
} from "lucide-react";
import { TopNav } from "../../history/ui";

export type FilingStage = "intake" | "requirements" | "deliverables";

export interface LiveMetric {
  label: string;
  value: number | string;
  emphasis?: boolean;
}

export interface IntelligenceSignal {
  label: string;
  state: "confirmed" | "potential" | "needs-info" | "not-applicable";
}

export interface SmartPRLiveData {
  statusText: string;
  progress?: number | null;
  progressLabel?: string;
  readiness?: number | null;
  metrics: LiveMetric[];
  agencies?: string[];
  signals?: IntelligenceSignal[];
  potentialRequirements?: string[];
  nextAction: string;
  whyAsking?: string | null;
}

interface FilingWorkflowShellProps {
  businessName?: string | null;
  businessId?: string | null;
  municipality?: string | null;
  matterTitle: string;
  matterStatus: string;
  stage: FilingStage;
  availableStages: FilingStage[];
  language: "en" | "es";
  onLanguageChange: (language: "en" | "es") => void;
  onStageChange: (stage: FilingStage) => void;
  intelligence: SmartPRLiveData;
  /** Overrides the default SmartPR Live sidebar when provided. Pass `null`
   * (not `undefined`) to render no sidebar at all and let the main content
   * take the full width — used by the Requirements page, which surfaces its
   * own compact readiness control instead of a persistent sidebar. */
  sidebar?: ReactNode | null;
  /** Content rendered on the right of the workflow-progress row, in place of
   * the business-profile/language controls (which live in the row above).
   * The Requirements page uses this for its compact readiness control. */
  stepperRight?: ReactNode;
  /** When false, the header does not collapse into a compact sticky bar on
   * scroll — it scrolls away normally. Defaults to true. */
  stickyHeader?: boolean;
  children: ReactNode;
}

const stages: Array<{ key: FilingStage; label: string; labelEs: string }> = [
  { key: "intake", label: "Intake", labelEs: "Perfil" },
  { key: "requirements", label: "Requirements", labelEs: "Requisitos" },
  { key: "deliverables", label: "Deliverables", labelEs: "Entregables" },
];

function WorkflowStepper({
  stage,
  availableStages,
  language,
  onChange,
}: {
  stage: FilingStage;
  availableStages: FilingStage[];
  language: "en" | "es";
  onChange: (stage: FilingStage) => void;
}) {
  const activeIndex = stages.findIndex((item) => item.key === stage);

  return (
    <nav className="spr-workflow-stepper" aria-label={language === "es" ? "Progreso de la radicación" : "Filing progress"}>
      {stages.map((item, index) => {
        const complete = index < activeIndex;
        const active = item.key === stage;
        const enabled = availableStages.includes(item.key);
        return (
          <div className={`spr-workflow-step-wrap ${complete ? "complete" : ""}`} key={item.key}>
            <button
              type="button"
              className={`spr-workflow-step ${active ? "active" : ""} ${complete ? "complete" : ""}`}
              aria-current={active ? "step" : undefined}
              disabled={!enabled}
              onClick={() => onChange(item.key)}
            >
              <span className="spr-workflow-step-icon">{complete ? <Check size={14} /> : index + 1}</span>
              <span>{language === "es" ? item.labelEs : item.label}</span>
            </button>
            {index < stages.length - 1 && <span className="spr-workflow-connector" aria-hidden="true" />}
          </div>
        );
      })}
    </nav>
  );
}

function SignalIcon({ state }: { state: IntelligenceSignal["state"] }) {
  if (state === "confirmed") return <CheckCircle2 size={15} />;
  if (state === "potential") return <Sparkles size={15} />;
  if (state === "not-applicable") return <Check size={15} />;
  return <CircleHelp size={15} />;
}

export function SmartPRLivePanel({ data, language }: { data: SmartPRLiveData; language: "en" | "es" }) {
  const [expanded, setExpanded] = useState(false);
  const copy = language === "es" ? {
    live: "SmartPR en vivo",
    readiness: "Preparación para comenzar",
    agencies: "Agencias identificadas",
    knows: "Lo que SmartPR sabe",
    potential: "Potencial — requiere información",
    why: "Por qué preguntamos",
    next: "Próxima acción",
  } : {
    live: "SmartPR Live",
    readiness: "Launch readiness",
    agencies: "Agencies identified",
    knows: "What SmartPR knows",
    potential: "Potential — needs information",
    why: "Why we're asking",
    next: "Next action",
  };

  return (
    <aside className={`spr-smartpr-live ${expanded ? "expanded" : "collapsed"}`} aria-label="SmartPR live intelligence">
      <button type="button" className="spr-live-mobile-toggle" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
        <span><span className="spr-live-dot" /> {copy.live}</span>
        <ChevronDown size={17} />
      </button>

      <div className="spr-live-body">
        <div className="spr-live-heading"><span className="spr-live-dot" /> {copy.live}</div>
        <p className="spr-live-status">{data.statusText}</p>

        {data.readiness != null ? (
          <div className="spr-live-readiness">
            <div><span>{copy.readiness}</span><strong>{Math.round(data.readiness)}%</strong></div>
            <div className="spr-live-progress"><span style={{ width: `${Math.max(0, Math.min(100, data.readiness))}%` }} /></div>
          </div>
        ) : data.progress != null ? (
          <div className="spr-live-readiness context">
            <div><span>{data.progressLabel || "Business context"}</span><strong>{Math.round(data.progress)}%</strong></div>
            <div className="spr-live-progress"><span style={{ width: `${Math.max(0, Math.min(100, data.progress))}%` }} /></div>
          </div>
        ) : null}

        <div className="spr-live-metrics">
          {data.metrics.map((metric) => (
            <div className={metric.emphasis ? "emphasis" : ""} key={metric.label}>
              <strong>{metric.value}</strong>
              <span>{metric.label}</span>
            </div>
          ))}
        </div>

        {!!data.agencies?.length && (
          <section className="spr-live-section">
            <h2>{copy.agencies}</h2>
            <div className="spr-live-agencies">{data.agencies.slice(0, 6).map((agency) => <span key={agency}>{agency}</span>)}</div>
          </section>
        )}

        {!!data.signals?.length && (
          <section className="spr-live-section">
            <h2>{copy.knows}</h2>
            <ul className="spr-live-signals">
              {data.signals.map((signal) => (
                <li className={signal.state} key={`${signal.state}-${signal.label}`}>
                  <SignalIcon state={signal.state} />
                  <span>{signal.label}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {!!data.potentialRequirements?.length && (
          <section className="spr-live-section">
            <h2>{copy.potential}</h2>
            <ul className="spr-live-potential">
              {data.potentialRequirements.slice(0, 3).map((item) => <li key={item}><AlertTriangle size={14} /> {item}</li>)}
            </ul>
          </section>
        )}

        {data.whyAsking && (
          <section className="spr-live-section spr-live-why">
            <h2>{copy.why}</h2>
            <p>{data.whyAsking}</p>
          </section>
        )}

        <section className="spr-live-next">
          <h2>{copy.next}</h2>
          <p>{data.nextAction}</p>
        </section>
      </div>
    </aside>
  );
}

export function FilingWorkflowShell({
  businessName,
  businessId,
  municipality,
  matterTitle,
  matterStatus,
  stage,
  availableStages,
  language,
  onLanguageChange,
  onStageChange,
  intelligence,
  sidebar,
  stepperRight,
  stickyHeader = true,
  children,
}: FilingWorkflowShellProps) {
  const [compact, setCompact] = useState(false);
  const compactRef = useRef(false);
  useEffect(() => {
    if (!stickyHeader) return;
    let frame: number | null = null;
    const updateCompactState = () => {
      frame = null;
      const enterThreshold = window.innerWidth <= 640 ? 180 : 96;
      const exitThreshold = 12;
      const nextCompact = compactRef.current
        ? window.scrollY > exitThreshold
        : window.scrollY > enterThreshold;
      if (nextCompact === compactRef.current) return;
      compactRef.current = nextCompact;
      setCompact(nextCompact);
    };
    const onScroll = () => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(updateCompactState);
    };
    updateCompactState();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [stickyHeader]);

  const displayName = businessName && businessName.trim() && businessName !== "Untitled business"
    ? businessName
    : language === "es" ? "Negocio nuevo" : "New Business";
  const labels = language === "es" ? {
    profile: "Perfil del negocio",
  } : {
    profile: "Business profile",
  };

  const actions = (
    <div className="spr-matter-actions">
      {businessId && <Link href={`/businesses/${businessId}`} className="spr-business-profile-link">{labels.profile}</Link>}
    </div>
  );

  const showSidebar = sidebar !== null;
  const stickyClass = stickyHeader ? `spr-filing-sticky${compact ? " compact" : ""}` : "spr-filing-static";
  const collapseInert = stickyHeader && compact;

  const stepperBar = (
    <div className="spr-stepper-bar">
      <WorkflowStepper stage={stage} availableStages={availableStages} language={language} onChange={onStageChange} />
      {stepperRight}
    </div>
  );

  return (
    <div className="spr-product-shell">
      <div className={stickyClass}>
        {/* Keep account nav outside the collapsing overflow region so the
            avatar menu is never clipped by matter chrome / compact collapse. */}
        <TopNav active="businesses" />
        <div className="spr-filing-chrome">
          <div className="spr-matter-header-collapse" inert={collapseInert ? true : undefined} aria-hidden={collapseInert}>
            <header className="spr-matter-header">
              <div className="spr-matter-identity">
                <span className="spr-matter-icon"><Building2 size={18} /></span>
                <div>
                  <div className="spr-matter-name-row">
                    <h1>{displayName}</h1>
                    <span className="spr-matter-status">{matterStatus}</span>
                  </div>
                  <p>{matterTitle}{municipality ? ` · ${municipality}` : ""}</p>
                </div>
              </div>
              {actions}
            </header>
          </div>
          {/* When the header is sticky as a whole, the stepper bar lives
              inside it as before. When it isn't (Requirements), the stepper
              bar is hoisted out below so it can stick on its own — a sticky
              element can only stay pinned within its own parent's box, and
              this short header box isn't tall enough to cover the page. */}
          {stickyHeader && stepperBar}
        </div>
      </div>
      {!stickyHeader && <div className="spr-stepper-bar-sticky">{stepperBar}</div>}

      <div className={`spr-workflow-grid${showSidebar ? "" : " single"}`}>
        <section className="spr-main-workarea">{children}</section>
        {showSidebar ? (sidebar ?? <SmartPRLivePanel data={intelligence} language={language} />) : null}
      </div>
    </div>
  );
}
