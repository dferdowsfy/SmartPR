"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Check, HelpCircle, Lightbulb } from "lucide-react";
import { normalizeProjectProfileForIncentives, type ExistingSmartPrProfile } from "../../incentives/profile";
import { OpportunitiesDrawer } from "./OpportunitiesDrawer";
import type { IncentiveAssessment, IncentiveEligibilityResult, ProjectFactValue } from "../../incentives/types";
import type { IncentiveEvaluation } from "../../processes/engine";
import { unifiedIncentives, shortAgency } from "../../processes/presentation";
import { relevantIncentiveOpportunities } from "../../incentives/relevance";

type Language = "en" | "es";

const NO_VERIFIED_EVIDENCE: string[] = [];

/** Same four honest tiers as the drawer/workflow — kept in one place would
 * be nicer, but this file and OpportunitiesDrawer both need it and neither
 * should import from the removed inline panel. */
export function statusPresentation(item: IncentiveEligibilityResult, language: Language): { label: string; tone: string } {
  const es = language === "es";
  if (item.eligibility === "likely_eligible") {
    return item.confidenceScore >= 100
      ? { label: es ? "Coincidencia sólida" : "Strong match", tone: "strong" }
      : { label: es ? "Probablemente elegible" : "Likely eligible", tone: "likely" };
  }
  if (item.eligibility === "potentially_eligible") {
    return item.criteriaSatisfied.length > 0
      ? { label: es ? "Coincidencia posible" : "Possible match", tone: "possible" }
      : { label: es ? "Falta información" : "More information needed", tone: "info" };
  }
  return item.eligibility === "unlikely_eligible"
    ? { label: es ? "Poco probable" : "Unlikely eligible", tone: "low" }
    : { label: es ? "No elegible" : "Not eligible", tone: "no" };
}

export function IncentivesSidebar({
  profile,
  facts,
  language,
  initialAssessment = null,
  pursuedIncentives,
  onAssessmentChange,
  onFactChange,
  onReview,
  onRemovePursued,
  variant = "sidebar",
  extraIncentives = [],
}: {
  profile: ExistingSmartPrProfile;
  facts: Record<string, ProjectFactValue>;
  language: Language;
  initialAssessment?: IncentiveAssessment | null;
  pursuedIncentives: IncentiveEligibilityResult[];
  onAssessmentChange?: (assessment: IncentiveAssessment) => void;
  onFactChange: (key: string, value: ProjectFactValue) => void;
  onReview: (result: IncentiveEligibilityResult) => void;
  onRemovePursued: (programId: string) => void;
  /** "section": one small collapsed "Possible incentives (optional)" block in
   * the requirements list — the single place incentives render. */
  variant?: "sidebar" | "section";
  /** Process-graph incentives (energy); shown only when their program is not already listed. */
  extraIncentives?: IncentiveEvaluation[];
}) {
  const es = language === "es";
  const normalizedProfile = useMemo(() => normalizeProjectProfileForIncentives(profile, facts), [profile, facts]);
  const [assessment, setAssessment] = useState<IncentiveAssessment | null>(initialAssessment);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      void fetch("/api/incentives/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: normalizedProfile, verifiedEvidenceTypeIds: NO_VERIFIED_EVIDENCE }),
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) throw new Error("evaluation_failed");
          return response.json() as Promise<IncentiveAssessment>;
        })
        .then((data) => {
          setAssessment(data);
          onAssessmentChange?.(data);
        })
        .catch((reason) => {
          if (reason instanceof DOMException && reason.name === "AbortError") return;
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalizedProfile]);

  // On mobile the trigger is position:fixed below the sticky stepper bar.
  // The bar's height varies by breakpoint, so measure it and expose the
  // offset as a CSS var the media query below consumes. Also measure the
  // trigger itself so the main column can reserve space for it.
  useEffect(() => {
    if (variant === "section") return;
    const bar = document.querySelector(".spr-stepper-bar-sticky");
    if (!bar) return;
    const apply = () => {
      document.documentElement.style.setProperty(
        "--inc-trigger-top",
        `${Math.ceil(bar.getBoundingClientRect().height) + 8}px`
      );
      const trigger = document.querySelector(".inc-mobile-trigger");
      if (trigger) {
        document.documentElement.style.setProperty(
          "--inc-trigger-h",
          `${Math.ceil(trigger.getBoundingClientRect().height)}px`
        );
      }
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(bar);
    window.addEventListener("resize", apply);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", apply);
    };
  }, [variant]);

  const opportunities = assessment?.opportunities ?? [];
  const questionCount = assessment?.followUpQuestions.length ?? 0;
  // Only programs with a real signal for this project; the drawer keeps the full list.
  const relevant = relevantIncentiveOpportunities(opportunities);
  const { extra } = unifiedIncentives(relevant, extraIncentives);
  const count = relevant.length + extra.length;
  const topMatches = relevant.slice(0, 2);
  const topExtra = extra.slice(0, Math.max(0, 2 - topMatches.length));

  if (variant === "section") {
    return (
      <details className="rq-group ck-group rq-group-incentives" data-testid="req-group-incentives">
        <style>{`
          .rq-group-incentives .inc-pursued-chip{display:inline-flex;align-items:center;gap:4px;border-radius:999px;padding:3px 8px;font-size:var(--rq-text-sm,14px);font-weight:700;margin-left:8px;background:#e7f5f1;color:#0f766e;vertical-align:middle}
          .rq-group-incentives .inc-improve{display:flex;align-items:center;gap:7px;margin-top:10px;border:1px dashed var(--border,#d9d4ca);background:var(--surface-2,#faf8f2);border-radius:10px;padding:9px 11px;font:inherit;font-size:var(--rq-text-sm,14px);color:var(--muted,#69665f);cursor:pointer;text-align:left}
          .rq-group-incentives .inc-pursuing-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 0}
          .rq-group-incentives .inc-pursuing-remove{background:none;border:none;padding:0;cursor:pointer;color:var(--muted,#69665f);font-size:var(--rq-text-sm,14px);text-decoration:underline}
          .rq-group-incentives .ck-rows{margin-top:8px}
        `}</style>
        <summary className="rq-group-head">
          <Lightbulb size={14} aria-hidden="true" /> {es ? "Posibles incentivos (opcional)" : "Possible incentives (optional)"}
          <span className="rq-critical-count">{loading && count === 0 ? "…" : count}</span>
        </summary>
        <p className="rq-group-sub">{es ? "No son requisitos. Revisa si te interesan." : "Not requirements. Review them if you are interested."}</p>
        {!loading && count === 0 && <p className="rq-group-sub">{es ? "Aún no hay coincidencias publicadas para este perfil." : "No published matches for this profile yet."}</p>}
        <div role="list" className="ck-rows">
          {relevant.map((item) => {
            const status = statusPresentation(item, language);
            const isPursued = pursuedIncentives.some((p) => p.programId === item.programId);
            return (
              <div role="listitem" key={item.programId} className="ck-row" data-testid={`incentive-${item.programId}`}>
                <div className="ck-row-head ck-row-static">
                  <span className="ck-name">{item.programName}{isPursued && <span className="inc-pursued-chip"><Check size={11} aria-hidden="true" /> {es ? "Añadido" : "Added"}</span>}</span>
                  <span className={`ck-pill ck-pill-inc-${status.tone}`}>{status.label}</span>
                  <button type="button" className="ck-action" onClick={() => onReview(item)}>{es ? "Revisar" : "Review"} <ArrowRight size={12} aria-hidden="true" /></button>
                </div>
              </div>
            );
          })}
          {extra.map((i) => (
            <div role="listitem" key={i.incentive_id} className="ck-row" data-testid={`incentive-${i.incentive_id}`}>
              <div className="ck-row-head ck-row-static">
                <span className="ck-name">{i.program_name ?? i.name}</span>
                <span className="ck-agency">{i.agencies.map(shortAgency).join(" / ")}</span>
                <span className="ck-pill ck-pill-may_apply">{i.state === "POTENTIALLY_ELIGIBLE" ? (es ? "Posiblemente elegible" : "Possibly eligible") : (es ? "Falta información" : "More information needed")}</span>
                <a className="ck-source-link" href={i.citation.url} target="_blank" rel="noreferrer">{es ? "Fuente" : "Source"}</a>
              </div>
            </div>
          ))}
        </div>
        {!loading && questionCount > 0 && (
          <button type="button" className="inc-improve" onClick={() => setShowAll(true)}>
            <HelpCircle size={15} aria-hidden="true" />
            {es
              ? `Responde ${questionCount} pregunta${questionCount === 1 ? "" : "s"} para mejorar las coincidencias`
              : `Answer ${questionCount} question${questionCount === 1 ? "" : "s"} to improve matches`}
          </button>
        )}
        {pursuedIncentives.length > 0 && (
          <div className="ck-block">
            <div className="ck-label">{es ? "Persiguiendo" : "Pursuing"} · {pursuedIncentives.length}</div>
            {pursuedIncentives.map((item) => (
              <div key={item.programId} className="inc-pursuing-row">
                <button type="button" className="ck-action" onClick={() => onReview(item)}>{item.programName}</button>
                <button type="button" className="inc-pursuing-remove" onClick={() => onRemovePursued(item.programId)}>{es ? "Eliminar" : "Remove"}</button>
              </div>
            ))}
          </div>
        )}
        {showAll && (
          <OpportunitiesDrawer
            assessment={assessment}
            language={language}
            facts={facts}
            onFactChange={onFactChange}
            onReview={(result) => { onReview(result); setShowAll(false); }}
            onClose={() => setShowAll(false)}
          />
        )}
      </details>
    );
  }

  return (
    <aside className="inc-sidebar" aria-label={es ? "Oportunidades" : "Opportunities"}>
      <style>{`
        .inc-sidebar{position:sticky;top:92px;max-height:calc(75vh - 92px);display:flex;flex-direction:column;gap:14px;overflow-y:auto;padding-bottom:4px}
        .inc-card{background:var(--surface,#fff);border:1px solid var(--border,#d9d4ca);border-radius:var(--radius,16px);padding:16px;overflow:hidden;flex:none}
        .inc-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}
        .inc-head-title{display:flex;align-items:center;gap:6px;font-family:var(--font-display,Georgia,serif);font-size:16px;color:var(--ink,#171714)}
        .inc-count{white-space:nowrap;border:1px solid color-mix(in srgb,var(--accent,#0f766e) 55%,transparent);border-radius:999px;padding:3px 9px;color:var(--accent,#0f766e);font-size:11px;font-weight:700}
        .inc-loading{font-size:12.5px;color:var(--muted,#69665f)}
        .inc-empty{font-size:12.5px;color:var(--muted,#69665f);line-height:1.5}
        .inc-match{border:1px solid var(--border,#d9d4ca);border-radius:12px;padding:12px;margin-bottom:10px}
        .inc-match:last-child{margin-bottom:0}
        .inc-match-name{font-size:13px;font-weight:650;color:var(--ink,#171714);line-height:1.35;margin-bottom:4px}
        .inc-match-benefit{font-size:12px;color:var(--muted,#69665f);line-height:1.45;margin-bottom:8px}
        .inc-status{display:inline-block;border-radius:999px;padding:3px 8px;font-size:10.5px;font-weight:800;margin-bottom:8px}
        .inc-status.strong{background:#e7f5f1;color:#0f766e}
        .inc-status.likely{background:#e7f5f1;color:#0f766e}
        .inc-status.possible{background:#fff5df;color:#9a6700}
        .inc-status.info{background:#fff5df;color:#9a6700}
        .inc-review{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--border,#d9d4ca);background:var(--surface,#fff);border-radius:8px;padding:6px 11px;font-size:12px;font-weight:650;color:var(--accent,#0f766e);cursor:pointer}
        .inc-pursued-chip{display:inline-flex;align-items:center;gap:4px;border-radius:999px;padding:3px 8px;font-size:10.5px;font-weight:800;margin-left:6px;background:#e7f5f1;color:#0f766e;vertical-align:middle}
        .inc-review:hover{border-color:var(--accent,#0f766e)}
        .inc-pursuing{border-top:1px solid var(--border,#d9d4ca);padding-top:12px;margin-top:2px}
        .inc-pursuing-head{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:var(--muted,#69665f);margin-bottom:8px}
        .inc-pursuing-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 0;font-size:12.5px}
        .inc-pursuing-row button{background:none;border:none;padding:0;cursor:pointer;color:var(--ink,#171714);text-align:left;font-size:12.5px;font-weight:600}
        .inc-pursuing-row button:hover{color:var(--accent,#0f766e)}
        .inc-pursuing-remove{background:none;border:none;padding:0;cursor:pointer;color:var(--muted,#69665f);font-size:11px;text-decoration:underline;flex:none}
        .inc-viewall{display:flex;align-items:center;justify-content:center;gap:6px;width:100%;margin-top:12px;border:1px solid var(--border,#d9d4ca);background:var(--surface,#fff);border-radius:10px;padding:9px;font-size:12.5px;font-weight:650;color:var(--ink,#171714);cursor:pointer}
        .inc-viewall:hover{border-color:var(--accent,#0f766e);color:var(--accent,#0f766e)}
        .inc-improve{display:flex;align-items:center;gap:7px;width:100%;margin-top:10px;border:1px dashed var(--border,#d9d4ca);background:var(--surface-2,#faf8f2);border-radius:10px;padding:9px 11px;font-size:12px;color:var(--muted,#69665f);cursor:pointer;text-align:left}
        .inc-improve:hover{color:var(--ink,#171714);border-color:var(--accent,#0f766e)}
        .inc-improve svg{flex:none;color:var(--accent,#0f766e)}
        .inc-mobile-trigger{display:none}
        @media(max-width:960px){
          .inc-sidebar{position:static;max-height:none;overflow:visible;display:block}
          .inc-sidebar>.inc-card{display:none}
          .inc-mobile-trigger{display:flex;align-items:center;justify-content:space-between;gap:10px;position:fixed;top:var(--inc-trigger-top,84px);left:12px;right:12px;width:auto;z-index:60;background:var(--accent,#0f766e);color:#fff;border:none;border-radius:12px;padding:12px 16px;font-size:13.5px;font-weight:700;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.15)}
          .inc-mobile-trigger:hover{background:#0c5f59}
          .spr-requirements-main{padding-top:calc(var(--inc-trigger-h,48px) + 8px)}
        }
      `}</style>

      <button type="button" className="inc-mobile-trigger" onClick={() => setShowAll(true)}>
        <span className="inc-mobile-trigger-label">
          <Lightbulb size={15} aria-hidden="true" style={{ marginRight: 6, verticalAlign: "-2px" }} />
          {loading ? (es ? "Evaluando incentivos…" : "Evaluating incentives…") : `${count} ${es ? "incentivos" : "incentives"}`}
        </span>
        <ArrowRight size={14} aria-hidden="true" />
      </button>

      <div className="inc-card">
        <div className="inc-head">
          <div className="inc-head-title"><Lightbulb size={15} aria-hidden="true" /> {es ? "Incentivos" : "Incentives"}</div>
          {!loading && <span className="inc-count">{count} {es ? "identificados" : "identified"}</span>}
        </div>

        {loading && <div className="inc-loading">{es ? "Evaluando…" : "Evaluating…"}</div>}

        {!loading && count === 0 && (
          <div className="inc-empty">{es
            ? "Aún no hay coincidencias publicadas para este perfil."
            : "No published matches for this profile yet."}</div>
        )}

        {!loading && topMatches.map((item) => {
          const status = statusPresentation(item, language);
          const benefit = item.potentialBenefit[0]?.amountDescription || item.potentialBenefit[0]?.description || "";
          const isPursued = pursuedIncentives.some((p) => p.programId === item.programId);
          return (
            <div key={item.programId} className="inc-match">
              <div className={`inc-status ${status.tone}`}>{status.label}</div>
              <div className="inc-match-name">{item.programName}
                {isPursued && <span className="inc-pursued-chip"><Check size={11} aria-hidden="true" /> {es ? "Añadido" : "Added"}</span>}
              </div>
              {benefit && <div className="inc-match-benefit">{benefit}</div>}
              <button type="button" className="inc-review" onClick={() => onReview(item)}>
                {es ? "Revisar" : "Review"} <ArrowRight size={12} aria-hidden="true" />
              </button>
            </div>
          );
        })}

        {!loading && topExtra.map((i) => (
          <div key={i.incentive_id} className="inc-match" data-testid={`incentive-${i.incentive_id}`}>
            <div className={`inc-status ${i.state === "POTENTIALLY_ELIGIBLE" ? "possible" : "info"}`}>
              {i.state === "POTENTIALLY_ELIGIBLE" ? (es ? "Posiblemente elegible" : "Possibly eligible") : (es ? "Falta información" : "More information needed")}
            </div>
            <div className="inc-match-name">{i.program_name ?? i.name}</div>
            <div className="inc-match-benefit">{i.agencies.map(shortAgency).join(" / ")}</div>
            <a className="inc-review" href={i.citation.url} target="_blank" rel="noreferrer">{es ? "Fuente" : "Source"} <ArrowRight size={12} aria-hidden="true" /></a>
          </div>
        ))}

        {!loading && (opportunities.length > 0 || count > 0) && (
          <button type="button" className="inc-viewall" onClick={() => setShowAll(true)} data-testid="view-incentives">
            {es ? "Ver incentivos" : "View incentives"} <ArrowRight size={13} aria-hidden="true" />
          </button>
        )}

        {!loading && questionCount > 0 && (
          <button type="button" className="inc-improve" onClick={() => setShowAll(true)}>
            <HelpCircle size={15} aria-hidden="true" />
            {es
              ? `Responde ${questionCount} pregunta${questionCount === 1 ? "" : "s"} para mejorar las coincidencias`
              : `Answer ${questionCount} question${questionCount === 1 ? "" : "s"} to improve matches`}
          </button>
        )}
      </div>

      {pursuedIncentives.length > 0 && (
        <div className="inc-card inc-pursuing">
          <div className="inc-pursuing-head"><Check size={12} aria-hidden="true" /> {es ? "Persiguiendo" : "Pursuing"} · {pursuedIncentives.length}</div>
          {pursuedIncentives.map((item) => (
            <div key={item.programId} className="inc-pursuing-row">
              <button type="button" onClick={() => onReview(item)}>{item.programName}</button>
              <button type="button" className="inc-pursuing-remove" onClick={() => onRemovePursued(item.programId)}>{es ? "Eliminar" : "Remove"}</button>
            </div>
          ))}
        </div>
      )}

      {showAll && (
        <OpportunitiesDrawer
          assessment={assessment}
          language={language}
          facts={facts}
          onFactChange={onFactChange}
          onReview={(result) => { onReview(result); setShowAll(false); }}
          onClose={() => setShowAll(false)}
        />
      )}
    </aside>
  );
}
