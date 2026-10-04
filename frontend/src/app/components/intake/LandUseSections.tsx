"use client";

/**
 * Land-use intelligence sections of the expanded Property & Site Report:
 * Regulatory Flags · Proposed Activity · Land-use Compatibility · Required
 * Approvals · Required Evidence · Unresolved Items · Reasoning paths.
 * Presentation only — every value comes from the PropertyReport / land-use
 * engine (deterministic rules from the knowledge graph, with sources).
 */
import { useState } from "react";
import { ArrowDown, CheckCircle2, ChevronDown, CircleHelp, Search } from "lucide-react";
import type { Lang } from "../../forms/engine/types";
import type { PropertyReport } from "../../locations/propertyReport";
import { STATUS_TEXT } from "../../locations/propertyReport";
import { COMPATIBILITY_TEXT, type ApprovalFinding, type LandUseAnalysis, type PathStep } from "../../locations/landUse";

const L = (en: string, es: string, lang: Lang) => (lang === "es" ? es : en);

export interface ActivityInput { text: string; construction: string | null; use: string | null }

export function RegulatoryFlags({ report, lang }: { report: PropertyReport; lang: Lang }) {
  if (!report.flags?.length) return null;
  return (
    <section className="spr-prd-section spr-luf" aria-label={L("Regulatory flags", "Alertas regulatorias", lang)} data-testid="regulatory-flags">
      <p className="spr-prd-kicker">{L("Property intelligence", "Inteligencia de la propiedad", lang)}</p>
      <div className="spr-luf-grid">
        {report.flags.map((f) => (
          <div key={f.id} className={`spr-luf-card spr-srp-tone-${f.tone}`} data-flag={f.id} data-status={f.status}>
            <span className="spr-luf-label">{f.label[lang]}</span>
            <span className="spr-luf-value"><span className="spr-srp-dot" aria-hidden="true" /> {f.value[lang]}</span>
          </div>
        ))}
      </div>
      {report.complexity && (
        <details className="spr-luf-why">
          <summary>{L("How complexity is scored", "Cómo se calcula la complejidad", lang)}</summary>
          <ul>{report.complexity.factors.map((x, i) => <li key={i}>{x.factor} <small>+{x.points}</small></li>)}</ul>
          <p>{L(`Total ${report.complexity.score}: Low < 5 ≤ Moderate < 10 ≤ High.`, `Total ${report.complexity.score}: Baja < 5 ≤ Moderada < 10 ≤ Alta.`, lang)}</p>
        </details>
      )}
    </section>
  );
}

export function ProposedActivityPanel({ value, analysis, lang, onChange }: { value: ActivityInput; analysis: LandUseAnalysis | null; lang: Lang; onChange: (next: ActivityInput) => void }) {
  const [draft, setDraft] = useState(value.text);
  const [lastValue, setLastValue] = useState(value.text);
  if (value.text !== lastValue) { setLastValue(value.text); setDraft(value.text); }
  const a = analysis?.activity;
  const facts = a ? [
    a.useName && `${L("Use", "Uso", lang)}: ${a.useName}`,
    a.construction && `${L("Work", "Obra", lang)}: ${({ new: L("new construction", "construcción nueva", lang), addition: L("expansion", "ampliación", lang), substantial_improvement: L("substantial improvement", "mejora sustancial", lang), renovation: L("renovation", "remodelación", lang), none: L("existing building", "edificio existente", lang), demolition: L("demolition", "demolición", lang) } as Record<string, string>)[a.construction]}`,
    a.changeOfUse && L("change of use", "cambio de uso", lang),
    a.facts.rooms && `${a.facts.rooms} ${L("rooms", "habitaciones", lang)}`,
    a.facts.units && `${a.facts.units} ${L("units", "unidades", lang)}`,
    a.facts.stories && `${a.facts.stories} ${L("stories", "pisos", lang)}`,
    a.facts.area_m2 && `${a.facts.area_m2.toLocaleString("en-US")} m²`,
    a.facts.kw && `${a.facts.kw.toLocaleString("en-US")} kW`,
  ].filter(Boolean) as string[] : [];
  return (
    <section className="spr-prd-section spr-lua" aria-labelledby="spr-lua-title" data-testid="proposed-activity">
      <h3 id="spr-lua-title">{L("What do you want to do with this property?", "¿Qué quieres hacer con esta propiedad?", lang)}</h3>
      <form className="spr-lua-form" onSubmit={(e) => { e.preventDefault(); onChange({ text: draft.trim(), construction: null, use: null }); }}>
        <label htmlFor="spr-lua-input" className="sr-only">{L("Proposed activity", "Actividad propuesta", lang)}</label>
        <textarea id="spr-lua-input" rows={2} maxLength={400} value={draft} onChange={(e) => setDraft(e.target.value)}
          placeholder={L("e.g. Build a 120-room hotel · Open a restaurant · Convert the building into apartments", "p. ej. Construir un hotel de 120 habitaciones · Abrir un restaurante · Convertir el edificio en apartamentos", lang)} data-testid="activity-input" />
        <button type="submit" className="spr-loc-btn primary" disabled={!draft.trim()} data-testid="activity-analyze"><Search aria-hidden="true" /> {L("Evaluate", "Evaluar", lang)}</button>
      </form>
      {facts.length > 0 && <p className="spr-lua-facts" data-testid="activity-facts">{L("Understood", "Entendido", lang)}: {facts.join(" · ")}</p>}
      {analysis?.questions.map((q) => (
        <div key={q.id} className="spr-lua-q" role="group" aria-label={q.text[lang]} data-testid={`activity-question-${q.id}`}>
          <p><CircleHelp aria-hidden="true" /> {q.text[lang]}</p>
          <div>{q.options.map((o) => (
            <button key={o.value} type="button" className="spr-loc-btn" onClick={() => onChange({ ...value, [q.id === "use" ? "use" : "construction"]: o.value })}>{o.label[lang]}</button>
          ))}</div>
        </div>
      ))}
    </section>
  );
}

export function PathView({ path, lang }: { path: PathStep[]; lang: Lang }) {
  return (
    <ol className="spr-lup" data-testid="reasoning-path">
      {path.map((p, i) => (
        <li key={i} className={`spr-lup-${p.kind}`}>
          {i > 0 && <ArrowDown aria-hidden="true" className="spr-lup-arrow" />}
          <span className="spr-lup-kind">{({ activity: L("Proposed", "Propuesto", lang), parcel: L("Parcel", "Parcela", lang), district: L("Zoning", "Calificación", lang), rule: L("Rule", "Regla", lang), source: L("Source", "Fuente", lang), approval: L("Approval", "Aprobación", lang), evidence: L("Evidence", "Evidencia", lang), fact: L("Finding", "Hallazgo", lang) } as Record<string, string>)[p.kind]}</span>
          <span>{p.label}</span>
        </li>
      ))}
    </ol>
  );
}

const OUTCOME_TONE: Record<string, string> = { permitted: "ok", conditional: "attention", discretionary: "attention", professional_review: "attention", insufficient: "unknown", potentially_prohibited: "hazard" };

export function CompatibilitySection({ lu, lang }: { lu: LandUseAnalysis; lang: Lang }) {
  const c = lu.compatibility;
  return (
    <section className="spr-prd-section spr-luc" aria-labelledby="spr-luc-title" data-testid="land-use-compatibility" data-outcome={c.outcome}>
      <h3 id="spr-luc-title">{L("Land-use compatibility", "Compatibilidad de uso", lang)}</h3>
      <div className={`spr-luc-verdict spr-srp-tone-${OUTCOME_TONE[c.outcome]}`}>
        <span className="spr-luc-use">{lu.activity.useName ?? L("Proposed activity", "Actividad propuesta", lang)}</span>
        <strong data-testid="compatibility-outcome">{COMPATIBILITY_TEXT[c.outcome][lang]}</strong>
        <span className="spr-luc-conf">{L("Confidence", "Confianza", lang)}: {({ high: L("High", "Alta", lang), medium: L("Medium", "Media", lang), low: L("Low", "Baja", lang) })[c.confidence]}</span>
      </div>
      {c.baseOutcome && c.baseOutcome !== c.outcome && (
        <p className="spr-luc-base">{L("Base zoning alone", "Solo por la calificación", lang)}: <strong>{COMPATIBILITY_TEXT[c.baseOutcome][lang]}</strong></p>
      )}
      <ul className="spr-luc-reasons">{c.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
      {lu.districts.filter((d) => !d.sliver && d.conditions.length).map((d) => (
        <div key={d.code} className="spr-luc-conds">
          <h4>{L("Conditions", "Condiciones", lang)} — {d.districtName}</h4>
          <ul>{d.conditions.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </div>
      ))}
      <details className="spr-luc-why"><summary>{L("Why?", "¿Por qué?", lang)}</summary><PathView path={c.path} lang={lang} /></details>
    </section>
  );
}

const CERT: Record<ApprovalFinding["status"], { en: string; es: string; tone: string }> = {
  confirmed: { en: "Required", es: "Requerido", tone: "hazard" },
  likely: { en: "Likely required", es: "Probablemente requerido", tone: "attention" },
  review: { en: "Professional review", es: "Revisión profesional", tone: "info" },
};

export function ApprovalsSection({ lu, lang }: { lu: LandUseAnalysis; lang: Lang }) {
  const order: ApprovalFinding["status"][] = ["confirmed", "likely", "review"];
  const list = [...lu.approvals].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
  return (
    <section className="spr-prd-section spr-lur" aria-labelledby="spr-lur-title" data-testid="required-approvals">
      <h3 id="spr-lur-title">{L("Required approvals", "Aprobaciones requeridas", lang)}</h3>
      {!list.length && <p className="spr-prd-because">{L("No approvals triggered by the rules SmartPR has for this activity and site.", "Ninguna aprobación activada por las reglas que SmartPR tiene para esta actividad y lugar.", lang)}</p>}
      <ul>
        {list.map((a) => (
          <li key={a.id} className={`spr-lur-item${a.constraint === "protection" ? " spr-lur-protection" : ""}`} data-rule={a.ruleId} data-status={a.status}>
            <div className="spr-lur-head">
              <strong>{a.name}</strong>
              <span className={`spr-srp-pill spr-srp-tone-${CERT[a.status].tone}`}>{CERT[a.status][lang]}</span>
              {a.constraint === "protection" && <span className="spr-prv-basis spr-prv-constraint-protection">{L("Protection constraint", "Restricción de protección", lang)}</span>}
            </div>
            <dl>
              <div><dt>{L("Trigger", "Motivo", lang)}</dt><dd>{a.trigger}</dd></div>
              {a.agency && <div><dt>{L("Agency", "Agencia", lang)}</dt><dd>{a.agency}</dd></div>}
              {(a.citation || a.sources.length > 0) && <div><dt>{L("Authority", "Autoridad", lang)}</dt><dd>{a.sources.map((x, i) => <span key={i}>{i > 0 && "; "}{x.url ? <a href={x.url} target="_blank" rel="noreferrer">{x.name}</a> : x.name}</span>)}{a.citation ? <small> — {a.citation}</small> : null}</dd></div>}
              {a.evidence.length > 0 && <div><dt>{L("Likely evidence", "Evidencia probable", lang)}</dt><dd><ul>{a.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul></dd></div>}
            </dl>
            <details><summary>{L("Why?", "¿Por qué?", lang)}</summary><PathView path={a.path} lang={lang} /></details>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function EvidenceSection({ lu, lang }: { lu: LandUseAnalysis; lang: Lang }) {
  if (!lu.evidence.length) return null;
  return (
    <section className="spr-prd-section" aria-labelledby="spr-lue-title" data-testid="required-evidence">
      <h3 id="spr-lue-title">{L("Required documents & evidence", "Documentos y evidencia requeridos", lang)}</h3>
      <ul className="spr-lue">{lu.evidence.map((e, i) => <li key={i}><CheckCircle2 aria-hidden="true" /> {e}</li>)}</ul>
    </section>
  );
}

export function UnresolvedSection({ lu, lang, extra = [] }: { lu: LandUseAnalysis; lang: Lang; extra?: string[] }) {
  if (!lu.unresolved.length && !extra.length) return null;
  const K = { missing_fact: L("Missing fact", "Dato faltante", lang), missing_rule: L("Missing rule", "Regla faltante", lang), unable_to_verify: L("Unable to verify", "No se pudo verificar", lang), data_conflict: L("Data conflict", "Conflicto de datos", lang) };
  return (
    <section className="spr-prd-section" aria-labelledby="spr-luu-title" data-testid="unresolved-items">
      <h3 id="spr-luu-title">{L("Unresolved items", "Asuntos sin resolver", lang)}</h3>
      <ul className="spr-luu">
        {lu.unresolved.map((u, i) => <li key={i}><span className="spr-prv-basis spr-prv-basis-question">{K[u.kind]}</span> {u.text}</li>)}
        {extra.filter((x) => !lu.unresolved.some((u) => u.text === x)).map((x, i) => <li key={`x${i}`}><span className="spr-prv-basis spr-prv-basis-question">{L("Site data", "Datos del lugar", lang)}</span> {x}</li>)}
      </ul>
    </section>
  );
}

export function ReasoningDetails({ lu, lang }: { lu: LandUseAnalysis; lang: Lang }) {
  return (
    <div className="spr-lurs" data-testid="reasoning-details">
      <h4>{L("Rules evaluated", "Reglas evaluadas", lang)} ({lu.rulesEvaluated.length})</h4>
      <ul>{lu.rulesEvaluated.map((r) => <li key={r.id} data-triggered={r.triggered}>{r.triggered ? "●" : "○"} {r.name} <small>— {r.why}</small></li>)}</ul>
      {lu.coverageGaps.length > 0 && (<><h4>{L("Knowledge coverage gaps", "Brechas de cobertura del conocimiento", lang)}</h4><ul>{lu.coverageGaps.map((g, i) => <li key={i}>{g.detail}</li>)}</ul></>)}
    </div>
  );
}

export function StandardsList({ lu, lang }: { lu: LandUseAnalysis; lang: Lang }) {
  const [open, setOpen] = useState(false);
  if (!lu.standards.length) return null;
  return (
    <div className="spr-lus" data-testid="development-standards">
      <button type="button" className="spr-prd-tech-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <ChevronDown aria-hidden="true" className={open ? "open" : ""} /> {L("Development standards", "Parámetros de desarrollo", lang)} ({lu.standards.length})
      </button>
      {open && <dl className="spr-prd-facts">{lu.standards.map((s) => <div key={s.id}><dt>{s.name}</dt><dd>{s.value} <small>{s.citation}</small></dd></div>)}</dl>}
    </div>
  );
}

export { STATUS_TEXT };
