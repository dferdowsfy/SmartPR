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
import { COMPATIBILITY_TEXT, DECISION_TEXT, REQUIREMENT_TEXT, type ApprovalFinding, type EvidenceGap, type LandUseAnalysis, type PathStep, type RequirementStatus } from "../../locations/landUse";

const L = (en: string, es: string, lang: Lang) => (lang === "es" ? es : en);

export interface ActivityInput { text: string; construction: string | null; use: string | null; answers?: Record<string, string> | null }

const DECISION_TONE: Record<string, string> = { supported_permitted: "ok", conditional_or_discretionary: "attention", supported_prohibited: "hazard", undetermined: "unknown" };

/**
 * Project decision summary — the lead of the report. Every line comes from
 * land_use.decision (one reasoning result), which the approvals list, copy
 * text and exports also read.
 */
export function DecisionSummary({ lu, lang }: { lu: LandUseAnalysis; lang: Lang }) {
  const d = lu.decision;
  if (!d) return null;
  const c = d.compatibility;
  const gaps = d.unresolved;
  return (
    <section className="spr-prd-section spr-dec" aria-labelledby="spr-dec-title" data-testid="decision-summary" data-compatibility={c.status}>
      <h3 id="spr-dec-title">{L("Project decision summary", "Resumen de decisión del proyecto", lang)}</h3>
      <dl className="spr-dec-grid">
        <div data-testid="decision-scope"><dt>{L("Proposed use and construction scope", "Uso propuesto y alcance de obra", lang)}</dt><dd>{d.scope[lang]}</dd></div>
        <div data-testid="decision-compatibility"><dt>{L("Compatibility", "Compatibilidad", lang)}</dt>
          <dd><span className={`spr-srp-pill spr-srp-tone-${DECISION_TONE[c.status]}`} data-testid="decision-status">{c.label[lang]}</span>
            <span className={`spr-prv-basis ${c.basis === "rule" ? "spr-prv-basis-rule" : "spr-prv-basis-question"}`}>{c.basis === "rule" ? L("Rule-based conclusion", "Conclusión basada en reglas", lang) : L("No conclusion — evidence missing", "Sin conclusión — falta evidencia", lang)}</span>
            <p>{c.reason[lang]}</p></dd></div>
        <div data-testid="decision-constraints"><dt>{L("Material constraints & exposure (mapped)", "Restricciones y exposición importantes (mapeadas)", lang)}</dt>
          <dd>{d.constraints.length ? <ul>{d.constraints.map((x) => <li key={x.id} data-constraint={x.id}><strong>{x.label[lang]}</strong> — {x.detail[lang]}</li>)}</ul> : <p>{L("None mapped in the layers checked (not a clearance).", "Nada mapeado en las capas verificadas (no es una autorización).", lang)}</p>}</dd></div>
        <div data-testid="decision-unresolved"><dt>{L("Unresolved questions", "Preguntas sin resolver", lang)}</dt>
          <dd>{gaps.length ? <ul>{gaps.map((g) => <li key={g.id} data-gap={g.id}><strong>{g.label[lang]}</strong> — {L("blocks", "bloquea", lang)}: {g.blocks[lang]}</li>)}</ul> : <p>{L("None.", "Ninguna.", lang)}</p>}</dd></div>
        <div data-testid="decision-pathway"><dt>{L("Likely approval pathway", "Ruta probable de aprobaciones", lang)}</dt>
          <dd><p>{d.pathway.summary[lang]}</p><p className="spr-dec-note" data-testid="pathway-completeness">{d.pathway.completeness[lang]}</p></dd></div>
        <div data-testid="decision-next"><dt>{L("Immediate next action", "Próxima acción inmediata", lang)}</dt><dd><strong>{d.pathway.nextAction[lang]}</strong></dd></div>
      </dl>
      <details className="spr-dec-more">
        <summary>{L("Governing rules, overlays and sequence", "Reglas aplicables, zonas sobrepuestas y secuencia", lang)}</summary>
        <GoverningRules lu={lu} lang={lang} />
        <h4>{L("Sequence", "Secuencia", lang)}</h4>
        <ol className="spr-dec-steps">{d.pathway.steps.map((x, i) => <li key={i}>{x[lang]}</li>)}</ol>
      </details>
    </section>
  );
}

export function GoverningRules({ lu, lang }: { lu: LandUseAnalysis; lang: Lang }) {
  const gv = lu.decision?.governing;
  if (!gv) return null;
  const ST = { identified: L("identified", "identificado", lang), unresolved: L("unresolved", "sin resolver", lang), unknown: L("not researched", "no investigado", lang) };
  return (
    <div className="spr-dec-gov" data-testid="governing-rules">
      <p>{L("Municipal plan", "Plan municipal", lang)}: {gv.plan ?? L("not recorded in SmartPR", "no registrado en SmartPR", lang)} · {L("governing regulation", "reglamento aplicable", lang)}: <strong>{ST[gv.rules]}</strong>{gv.rulesText ? ` (${gv.rulesText})` : ""} · {L("permit office", "oficina de permisos", lang)}: <strong>{ST[gv.permitAuthority]}</strong></p>
      <h4>{L("Zoning districts on the parcel", "Distritos en la parcela", lang)}</h4>
      <ul>{gv.districts.map((x) => <li key={x.code} data-district={x.code}><strong>{x.code}{x.share !== null ? ` · ${Math.round(x.share * 1000) / 10}%` : ""}</strong> — {x.meaning[lang]} <em>{x.effect[lang]}</em></li>)}</ul>
      {gv.overlays.length > 0 && (<>
        <h4>{L("Overlays", "Zonas sobrepuestas", lang)}</h4>
        <ul>{gv.overlays.map((o) => <li key={o.code} data-overlay={o.code} data-provisions={o.provisions}><strong>{o.code}{o.share !== null ? ` · ${Math.round(o.share * 1000) / 10}%` : ""}</strong> — {o.meaning[lang]} {o.effectText[lang]}{o.basis ? <small> {L("Basis", "Base", lang)}: {o.basis}</small> : null}{o.provisions !== "encoded" ? <small> {L("Provisions not obtained", "Disposiciones no obtenidas", lang)}{o.obtainFrom ? ` — ${L("obtain from", "obtener de", lang)} ${o.obtainFrom}` : ""}.</small> : null}</li>)}</ul>
      </>)}
      {gv.standards && <p className="spr-dec-note">{gv.standards[lang]}</p>}
    </div>
  );
}

export function EvidenceGaps({ gaps, lang }: { gaps: EvidenceGap[]; lang: Lang }) {
  if (!gaps.length) return null;
  return (
    <ul className="spr-gaps" data-testid="evidence-gaps">
      {gaps.map((g) => (
        <li key={g.id} data-gap={g.id} data-kind={g.kind}>
          <strong>{g.label[lang]}</strong>
          <dl>
            <div><dt>{L("Missing", "Falta", lang)}</dt><dd>{g.missing[lang]}</dd></div>
            <div><dt>{L("Why it matters", "Por qué importa", lang)}</dt><dd>{g.why[lang]}</dd></div>
            <div><dt>{L("Research task", "Tarea", lang)}</dt><dd>{g.obtain[lang]}{g.from ? <small> — {g.from}</small> : null}</dd></div>
            <div><dt>{L("Blocks", "Bloquea", lang)}</dt><dd>{g.blocks[lang]}</dd></div>
          </dl>
        </li>
      ))}
    </ul>
  );
}

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
  const [submitted, setSubmitted] = useState(0);
  if (value.text !== lastValue) { setLastValue(value.text); setDraft(value.text); }
  const a = analysis?.activity;
  const facts = a ? [
    a.useName && `${L("Use", "Uso", lang)}: ${a.useName}`,
    a.construction && `${L("Work", "Obra", lang)}: ${({ new: L("new construction", "construcción nueva", lang), addition: L("expansion", "ampliación", lang), substantial_improvement: L("substantial improvement", "mejora sustancial", lang), renovation: L("renovation", "remodelación", lang), none: L("existing building", "edificio existente", lang), demolition: L("demolition", "demolición", lang) } as Record<string, string>)[a.construction]}`,
    a.changeOfUse && L("change of use", "cambio de uso", lang),
    a.facts.rooms && `${a.facts.rooms} ${L("rooms", "habitaciones", lang)}`,
    a.facts.units && `${a.facts.units} ${L("units", "unidades", lang)}`,
    a.facts.stories && `${a.facts.stories} ${L("stories", "pisos", lang)}`,
    a.facts.area_sqft ? `${a.facts.area_sqft.toLocaleString("en-US")} ${L("sq ft", "pies²", lang)} (${a.facts.area_m2?.toLocaleString("en-US")} m²)` : a.facts.area_m2 && `${a.facts.area_m2.toLocaleString("en-US")} m²`,
    a.components.pool && L("pool", "piscina", lang),
    a.components.demolition && L("demolition", "demolición", lang),
    a.facts.kw && `${a.facts.kw.toLocaleString("en-US")} kW`,
  ].filter(Boolean) as string[] : [];
  return (
    <section className="spr-prd-section spr-lua" aria-labelledby="spr-lua-title" data-testid="proposed-activity">
      <h3 id="spr-lua-title">{L("What do you want to do with this property?", "¿Qué quieres hacer con esta propiedad?", lang)}</h3>
      <form className="spr-lua-form" onSubmit={(e) => { e.preventDefault(); setSubmitted((n) => n + 1); onChange({ text: draft.trim(), construction: null, use: null, answers: null }); }}>
        <label htmlFor="spr-lua-input" className="sr-only">{L("Proposed activity", "Actividad propuesta", lang)}</label>
        <textarea id="spr-lua-input" rows={2} maxLength={400} value={draft} onChange={(e) => setDraft(e.target.value)}
          placeholder={L("e.g. Build a 120-room hotel · Open a restaurant · Convert the building into apartments", "p. ej. Construir un hotel de 120 habitaciones · Abrir un restaurante · Convertir el edificio en apartamentos", lang)} data-testid="activity-input" />
        <button type="submit" className="spr-loc-btn primary" disabled={!draft.trim()} data-testid="activity-analyze"><Search aria-hidden="true" /> {L("Evaluate", "Evaluar", lang)}</button>
      </form>
      {submitted > 0 && analysis && (
        <p className="spr-lua-status" role="status" aria-live="polite" data-testid="activity-status" key={submitted}>
          {a?.use
            ? L(`Evaluated: ${a.useName} — ${(analysis.decision ? analysis.decision.compatibility.label : DECISION_TEXT.undetermined).en}. See the decision summary above.`, `Evaluado: ${a.useName} — ${(analysis.decision ? analysis.decision.compatibility.label : DECISION_TEXT.undetermined).es}. Vea el resumen de decisión arriba.`, lang)
            : L("We couldn't match that to a land use we have rules for. Pick the closest option below, or rephrase (e.g. \"agrotourism cabins\", \"restaurant\", \"single-family house\").", "No pudimos asociar eso a un uso con reglas. Elija la opción más cercana abajo o reformule (p. ej. «cabañas de agroturismo», «restaurante», «casa unifamiliar»).", lang)}
        </p>
      )}
      {facts.length > 0 && <p className="spr-lua-facts" data-testid="activity-facts">{L("Understood", "Entendido", lang)}: {facts.join(" · ")}</p>}
      {analysis?.questions.map((q) => (
        <div key={q.id} className="spr-lua-q" role="group" aria-label={q.text[lang]} data-testid={`activity-question-${q.id}`}>
          <p><CircleHelp aria-hidden="true" /> {q.text[lang]}</p>
          <div>{q.options.map((o) => (
            <button key={o.value} type="button" className="spr-loc-btn" data-answer={o.value} onClick={() => onChange(q.id === "use" || q.id === "construction" ? { ...value, [q.id]: o.value } : { ...value, answers: { ...(value.answers ?? {}), [q.id]: o.value } })}>{o.label[lang]}</button>
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
      <div className={`spr-luc-verdict spr-srp-tone-${lu.decision ? DECISION_TONE[lu.decision.compatibility.status] : OUTCOME_TONE[c.outcome]}`}>
        <span className="spr-luc-use">{lu.activity.useName ?? L("Proposed activity", "Actividad propuesta", lang)}</span>
        <strong data-testid="compatibility-outcome">{lu.decision ? lu.decision.compatibility.label[lang] : COMPATIBILITY_TEXT[c.outcome][lang]}</strong>
        <span className="spr-luc-conf">{L("Confidence", "Confianza", lang)}: {({ high: L("High", "Alta", lang), medium: L("Medium", "Media", lang), low: L("Low", "Baja", lang) })[c.confidence]}</span>
      </div>
      {lu.decision?.compatibility.ruleReading && (
        <p className="spr-luc-base" data-testid="rule-reading">{L("Rule reading (kept separate from the conclusion)", "Lectura de la regla (aparte de la conclusión)", lang)}: {lu.decision.compatibility.ruleReading[lang]}</p>
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

const REQ_TONE: Record<RequirementStatus, string> = { required: "hazard", potentially_required: "attention", unresolved: "info" };
const reqOf = (a: ApprovalFinding): RequirementStatus => a.requirement ?? (a.status === "confirmed" ? "required" : a.status === "likely" ? "potentially_required" : "unresolved");

export function ApprovalsSection({ lu, lang }: { lu: LandUseAnalysis; lang: Lang }) {
  const order: RequirementStatus[] = ["required", "potentially_required", "unresolved"];
  const list = [...lu.approvals].sort((a, b) => order.indexOf(reqOf(a)) - order.indexOf(reqOf(b)));
  return (
    <section className="spr-prd-section spr-lur" aria-labelledby="spr-lur-title" data-testid="required-approvals">
      <h3 id="spr-lur-title">{L("Potential approvals", "Aprobaciones posibles", lang)}</h3>
      {lu.decision && <p className="spr-dec-note" data-testid="approvals-completeness">{lu.decision.pathway.completeness[lang]}</p>}
      {!list.length && <p className="spr-prd-because">{L("No approvals triggered by the rules SmartPR has for this activity and site.", "Ninguna aprobación activada por las reglas que SmartPR tiene para esta actividad y lugar.", lang)}</p>}
      <ul>
        {list.map((a) => {
          const rq = reqOf(a);
          return (
          <li key={a.id} className={`spr-lur-item${a.constraint === "protection" ? " spr-lur-protection" : ""}`} data-rule={a.ruleId} data-status={a.status} data-requirement={rq}>
            <div className="spr-lur-head">
              <strong>{a.name}</strong>
              <span className={`spr-srp-pill spr-srp-tone-${REQ_TONE[rq]}`}>{REQUIREMENT_TEXT[rq][lang]}</span>
              {a.constraint === "protection" && <span className="spr-prv-basis spr-prv-constraint-protection">{L("Protection constraint", "Restricción de protección", lang)}</span>}
            </div>
            <dl>
              <div><dt>{L("Project fact that triggers it", "Dato del proyecto que lo activa", lang)}</dt><dd>{a.needs ? L(`Unknown — depends on ${a.needs.en}.`, `Desconocido — depende de ${a.needs.es}.`, lang) : a.trigger}</dd></div>
              {a.agency && <div><dt>{L("Responsible authority", "Autoridad responsable", lang)}</dt><dd>{a.agency}</dd></div>}
              {(a.citation || a.sources.length > 0) && <div><dt>{L("Provision", "Disposición", lang)}</dt><dd>{a.sources.map((x, i) => <span key={i}>{i > 0 && "; "}{x.url ? <a href={x.url} target="_blank" rel="noreferrer">{x.name}</a> : x.name}</span>)}{a.citation ? <small> — {a.citation}</small> : null}</dd></div>}
              {a.citationGap && <div data-testid="citation-gap"><dt>{L("Evidence gap", "Brecha de evidencia", lang)}</dt><dd>{a.citationGap[lang]}</dd></div>}
              {(a.prerequisites?.length ?? 0) > 0 && <div><dt>{L("Prerequisites", "Requisitos previos", lang)}</dt><dd><ul>{a.prerequisites!.map((e, i) => <li key={i}>{e}</li>)}</ul></dd></div>}
              {a.sequence && <div><dt>{L("Sequence", "Secuencia", lang)}</dt><dd>{a.sequence}</dd></div>}
              {a.evidence.length > 0 && <div><dt>{L("Likely evidence", "Evidencia probable", lang)}</dt><dd><ul>{a.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul></dd></div>}
            </dl>
            <details><summary>{L("Why?", "¿Por qué?", lang)}</summary><PathView path={a.path} lang={lang} /></details>
          </li>
          );
        })}
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
  if (!lu.unresolved.length && !extra.length && !lu.decision?.unresolved.length) return null;
  const K = { missing_fact: L("Missing fact", "Dato faltante", lang), missing_rule: L("Missing rule", "Regla faltante", lang), unable_to_verify: L("Unable to verify", "No se pudo verificar", lang), data_conflict: L("Data conflict", "Conflicto de datos", lang) };
  return (
    <section className="spr-prd-section" aria-labelledby="spr-luu-title" data-testid="unresolved-items">
      <h3 id="spr-luu-title">{L("Unresolved items & research tasks", "Asuntos sin resolver y tareas", lang)}</h3>
      {lu.decision && <EvidenceGaps gaps={lu.decision.unresolved} lang={lang} />}
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
