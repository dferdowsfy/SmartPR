"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Check, HelpCircle, Lightbulb } from "lucide-react";
import { normalizeProjectProfileForIncentives, type ExistingSmartPrProfile } from "../../incentives/profile";
import { OpportunitiesDrawer } from "./OpportunitiesDrawer";
import type { IncentiveAssessment, IncentiveEligibilityResult, ProjectFactValue } from "../../incentives/types";

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

  const opportunities = assessment?.opportunities ?? [];
  const topMatches = opportunities.slice(0, 2);
  const questionCount = assessment?.followUpQuestions.length ?? 0;

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
          .inc-mobile-trigger{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;position:sticky;top:8px;z-index:40;background:var(--accent,#0f766e);color:#fff;border:none;border-radius:12px;padding:12px 16px;font-size:13.5px;font-weight:700;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.15)}
          .inc-mobile-trigger:hover{background:#0c5f59}
        }
      `}</style>

      <button type="button" className="inc-mobile-trigger" onClick={() => setShowAll(true)}>
        <span className="inc-mobile-trigger-label">
          <Lightbulb size={15} aria-hidden="true" style={{ marginRight: 6, verticalAlign: "-2px" }} />
          {loading ? (es ? "Evaluando oportunidades…" : "Evaluating opportunities…") : `${opportunities.length} ${es ? "oportunidades" : "opportunities"}`}
        </span>
        <ArrowRight size={14} aria-hidden="true" />
      </button>

      <div className="inc-card">
        <div className="inc-head">
          <div className="inc-head-title"><Lightbulb size={15} aria-hidden="true" /> {es ? "Oportunidades" : "Opportunities"}</div>
          {!loading && <span className="inc-count">{opportunities.length} {es ? "identificadas" : "identified"}</span>}
        </div>

        {loading && <div className="inc-loading">{es ? "Evaluando…" : "Evaluating…"}</div>}

        {!loading && topMatches.length === 0 && (
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

        {!loading && opportunities.length > 0 && (
          <button type="button" className="inc-viewall" onClick={() => setShowAll(true)}>
            {es ? "Ver todas las oportunidades" : "View all opportunities"} <ArrowRight size={13} aria-hidden="true" />
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
