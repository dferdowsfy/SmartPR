"use client";

// ENERGY section of the project requirements view. Everything shown here is
// computed by the regulatory process graph (src/app/processes) from the
// project's extracted facts — no answers are hardcoded in the UI. Incentives
// render in a visually separate block and are never counted as requirements.

import { useMemo, useState } from "react";
import { Zap, ExternalLink, HelpCircle, Gift } from "lucide-react";
import { loadEnergyProcessGraph } from "../../processes/kb";
import { evaluateProcesses, type ClarifyingQuestion, type IncentiveEvaluation, type ProcessEvaluation, type RequirementEvaluation } from "../../processes/engine";
import { energyFactsFromProjectContext, hasEnergySignal } from "../../processes/energyFacts";
import type { ProjectContext, ProjectContextFact, ProjectContextKey } from "../../ai/intake/projectContext";
import type { ProcessState } from "../../processes/types";

type Language = "en" | "es";

const STATE_COPY: Record<ProcessState, { en: string; es: string; tone: string }> = {
  REQUIRED: { en: "Required", es: "Requerido", tone: "required" },
  POTENTIALLY_REQUIRED: { en: "Potentially required", es: "Posiblemente requerido", tone: "potential" },
  NEEDS_FACT: { en: "Needs a fact", es: "Falta un dato", tone: "needs" },
  NOT_REQUIRED: { en: "Not triggered by current facts", es: "No aplica según los datos actuales", tone: "not" },
};

const REQ_STATE_COPY: Record<RequirementEvaluation["state"], { en: string; es: string }> = {
  SATISFIED: { en: "Evidence uploaded", es: "Evidencia cargada" },
  MISSING: { en: "Missing evidence", es: "Falta evidencia" },
  AGENCY_STEP: { en: "Agency step", es: "Paso de la agencia" },
  NEEDS_FACT: { en: "Depends on a fact", es: "Depende de un dato" },
};

export function EnergyProcessesSection({
  projectContext,
  municipality,
  providedEvidenceIds,
  legacyDocumentIds,
  language,
  onAnswer,
}: {
  projectContext: ProjectContext;
  municipality?: string | null;
  /** DOC_* ids with uploaded evidence (requirement uploads / locker tags). */
  providedEvidenceIds: string[];
  /** Document ids already shown as requirement cards above. */
  legacyDocumentIds: string[];
  language: Language;
  onAnswer: (key: ProjectContextKey, fact: ProjectContextFact) => void;
}) {
  const es = language === "es";
  const graph = useMemo(() => loadEnergyProcessGraph(), []);
  const { facts, evidence } = useMemo(
    () => energyFactsFromProjectContext(projectContext, graph.kb, { municipality }),
    [projectContext, graph, municipality]
  );
  const assessment = useMemo(
    () => (hasEnergySignal(facts) ? evaluateProcesses(graph, facts, { factEvidence: evidence, providedEvidenceIds }) : null),
    [graph, facts, evidence, providedEvidenceIds]
  );
  if (!assessment || (assessment.processes.length === 0 && assessment.incentives.length === 0)) return null;

  const shown = assessment.processes.filter((p) => p.state !== "NOT_REQUIRED");
  const notTriggered = assessment.processes.filter((p) => p.state === "NOT_REQUIRED");
  const legacy = new Set(legacyDocumentIds);

  return (
    <section className="rq-group rq-group-energy" data-testid="req-group-energy">
      <div className="rq-group-head">
        <Zap size={13} /> {es ? "Energía" : "Energy"}
        <span className="rq-critical-count">{shown.length}</span>
      </div>
      <p className="rq-group-sub">
        {es
          ? "Procesos energéticos que pueden aplicar a este proyecto, derivados de fuentes oficiales (Negociado de Energía, LUMA, leyes de PR)."
          : "Energy-sector processes that may apply to this project, derived from official sources (Energy Bureau, LUMA, Puerto Rico law)."}
        {assessment.readiness && (
          <strong className="rq-energy-readiness">
            {" "}
            {es ? "Preparación" : "Readiness"}: {Math.round(assessment.readiness.score * 100)}% ({assessment.readiness.satisfied}/{assessment.readiness.total})
          </strong>
        )}
      </p>

      {assessment.questions.length > 0 && (
        <div className="rq-energy-questions" data-testid="energy-questions">
          <div className="rq-energy-subhead"><HelpCircle size={12} /> {es ? "Para decidir, necesitamos saber" : "To decide, we need to know"}</div>
          {assessment.questions.map((q) => (
            <EnergyQuestion key={q.fact} q={q} language={language} onAnswer={onAnswer} />
          ))}
        </div>
      )}

      <div className="rq-list">
        {shown.map((p) => (
          <EnergyProcessCard key={p.process_id} p={p} language={language} alsoListedAbove={p.legacy_document_ids.some((d) => legacy.has(d))} />
        ))}
      </div>

      {notTriggered.length > 0 && (
        <details className="rq-energy-not">
          <summary>{es ? "Evaluados y no activados" : "Checked and not triggered"} ({notTriggered.length})</summary>
          <ul>
            {notTriggered.map((p) => (
              <li key={p.process_id}>
                <strong>{p.name}</strong> — {p.reason}
                {p.citation && (
                  <> (<a href={p.citation.url} target="_blank" rel="noreferrer">{p.citation.title}{p.citation.locator ? `, ${p.citation.locator}` : ""}</a>)</>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      {assessment.incentives.length > 0 && (
        <div className="rq-energy-incentives" data-testid="energy-incentives">
          <div className="rq-energy-subhead"><Gift size={12} /> {es ? "Incentivos opcionales — posible elegibilidad (no son requisitos)" : "Optional incentives — potential eligibility (not requirements)"}</div>
          {assessment.incentives.map((i) => (
            <EnergyIncentiveCard key={i.incentive_id} i={i} language={language} />
          ))}
        </div>
      )}
    </section>
  );
}

function EnergyQuestion({ q, language, onAnswer }: { q: ClarifyingQuestion; language: Language; onAnswer: (key: ProjectContextKey, fact: ProjectContextFact) => void }) {
  const es = language === "es";
  const [text, setText] = useState("");
  const evidence = es ? "Confirmado por el usuario en la sección de energía." : "Confirmed by user in the energy section.";
  const answer = (value: string | number | boolean) => onAnswer(q.fact as ProjectContextKey, { value, confidence: 1, evidence });
  return (
    <div className="rq-energy-q" data-testid={`energy-q-${q.fact}`}>
      <div className="rq-energy-q-text">{q.question}</div>
      <div className="rq-energy-q-why">{q.why}</div>
      <div className="rq-energy-q-actions">
        {q.type === "boolean" && (
          <>
            <button type="button" onClick={() => answer(true)}>{es ? "Sí" : "Yes"}</button>
            <button type="button" onClick={() => answer(false)}>No</button>
          </>
        )}
        {q.type === "enum" && q.options?.map((o) => (
          <button type="button" key={o} onClick={() => answer(o)}>{o.replace(/_/g, " ")}</button>
        ))}
        {(q.type === "number" || q.type === "string" || q.type === "list") && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const t = text.trim();
              if (!t) return;
              if (q.type === "number") {
                const n = Number(t.replace(/[^0-9.]/g, ""));
                if (Number.isFinite(n)) answer(n);
              } else answer(t);
            }}
          >
            <input value={text} onChange={(e) => setText(e.target.value)} inputMode={q.type === "number" ? "decimal" : "text"} aria-label={q.question} />
            <button type="submit">{es ? "Guardar" : "Save"}</button>
          </form>
        )}
      </div>
    </div>
  );
}

function EnergyProcessCard({ p, language, alsoListedAbove }: { p: ProcessEvaluation; language: Language; alsoListedAbove: boolean }) {
  const es = language === "es";
  const st = STATE_COPY[p.state];
  return (
    <article className={`rq-energy-card rq-energy-${st.tone}`} data-testid={`energy-process-${p.process_id}`}>
      <header>
        <span className={`rq-energy-badge rq-energy-badge-${st.tone}`}>{es ? st.es : st.en}</span>
        <span className="rq-energy-type">{p.process_type}</span>
        <h4>{p.name}</h4>
        <div className="rq-energy-agency">
          {es ? "Administra" : "Administered by"}: {p.agencies.map((a) => a.name).join(" · ")}
          {p.oversight.length > 0 && <> — {es ? "supervisión" : "oversight"}: {p.oversight.map((a) => a.name).join(" · ")}</>}
        </div>
      </header>
      <p className="rq-energy-reason">{p.reason}</p>
      {p.state === "NEEDS_FACT" && p.missing_facts.length > 0 && (
        <p className="rq-energy-missing-facts">{es ? "Dato pendiente" : "Pending fact"}: {p.missing_facts.join(", ").replace(/_/g, " ")}</p>
      )}
      {alsoListedAbove && (
        <p className="rq-energy-alias">{es ? "También aparece arriba como tarjeta de requisito." : "Also listed above as a requirement card."}</p>
      )}
      <details>
        <summary>{es ? "¿Por qué aplica?" : "Why does this apply?"}</summary>
        <ol className="rq-energy-path">
          {p.explanation.map((s, i) => (
            <li key={i} className={`rq-energy-step-${s.kind}`}>
              <em>{s.kind}</em> {s.url ? <a href={s.url} target="_blank" rel="noreferrer">{s.label} <ExternalLink size={10} /></a> : s.label}
              {s.detail && <div className="rq-energy-step-detail">{s.detail}</div>}
            </li>
          ))}
        </ol>
        {p.citation && (
          <div className="rq-energy-source">
            {es ? "Fuente" : "Source"}: <a href={p.citation.url} target="_blank" rel="noreferrer">{p.citation.title}</a>
            {p.citation.citation && <> — {p.citation.citation}</>} · {es ? "confianza" : "confidence"} {p.citation.confidence} · {p.citation.status.replace(/_/g, " ")} · {es ? "verificado" : "verified"} {p.citation.date_last_verified}
          </div>
        )}
      </details>
      {p.requirements.length > 0 && (
        <ul className="rq-energy-reqs">
          {p.requirements.map((r) => (
            <li key={r.id} className={`rq-energy-req-${r.state.toLowerCase()}`}>
              <span className="rq-energy-req-state">{es ? REQ_STATE_COPY[r.state].es : REQ_STATE_COPY[r.state].en}</span>{" "}
              {r.name}
              {r.state === "MISSING" && r.missing_evidence_ids.length > 0 && (
                <span className="rq-energy-req-ev"> ({r.missing_evidence_ids.join(", ")})</span>
              )}
              {" "}
              <a href={r.citation.url} target="_blank" rel="noreferrer" title={r.citation.controlling_language}>
                {r.citation.locator ?? r.citation.title}
              </a>
              {r.citation.confidence !== "high" && <span className="rq-energy-conf"> · {r.citation.confidence} {es ? "confianza" : "confidence"}</span>}
            </li>
          ))}
        </ul>
      )}
      {p.prerequisites.length > 0 && (
        <div className="rq-energy-prereqs">
          {es ? "Prerrequisitos" : "Prerequisites"}:{" "}
          {p.prerequisites.map((pre) => `${pre.name} (${es ? STATE_COPY[pre.state as ProcessState]?.es ?? pre.state : STATE_COPY[pre.state as ProcessState]?.en ?? pre.state})`).join("; ")}
        </div>
      )}
      {p.readiness && (
        <div className="rq-energy-proc-readiness">{es ? "Preparación" : "Readiness"}: {p.readiness.satisfied}/{p.readiness.total}</div>
      )}
      {p.jurisdiction_note && <div className="rq-energy-jurisdiction">{p.jurisdiction_note}</div>}
    </article>
  );
}

function EnergyIncentiveCard({ i, language }: { i: IncentiveEvaluation; language: Language }) {
  const es = language === "es";
  const label =
    i.state === "POTENTIALLY_ELIGIBLE" ? (es ? "Posiblemente elegible" : "Potentially eligible")
    : i.state === "NEEDS_FACT" ? (es ? "Falta información" : "More information needed")
    : es ? "No elegible según los datos" : "Not eligible on current facts";
  return (
    <article className={`rq-energy-incentive rq-energy-incentive-${i.state.toLowerCase()}`} data-testid={`energy-incentive-${i.incentive_id}`}>
      <header>
        <span className="rq-energy-badge rq-energy-badge-incentive">{label}</span>
        <h4>{i.name}</h4>
        <div className="rq-energy-agency">{es ? "Administra" : "Administered by"}: {i.agencies.map((a) => a.name).join(" · ")}</div>
      </header>
      <p className="rq-energy-reason">{i.reason}</p>
      {i.eligibility_requirements.length > 0 && (
        <ul className="rq-energy-reqs">
          {i.eligibility_requirements.map((r) => (
            <li key={r.id}>{r.name}</li>
          ))}
        </ul>
      )}
      <div className="rq-energy-source">
        {es ? "Fuente" : "Source"}: <a href={i.citation.url} target="_blank" rel="noreferrer">{i.citation.title}</a>
        {i.citation.locator && <> — {i.citation.locator}</>} · {es ? "confianza" : "confidence"} {i.confidence}
      </div>
      {i.notes && <div className="rq-energy-jurisdiction">{i.notes}</div>}
    </article>
  );
}
