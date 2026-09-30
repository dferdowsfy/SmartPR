"use client";

// ENERGY section of the project requirements view, as a checklist: numbered
// stages, one line per process (name · who handles it · status). Clicking a
// line shows a one-sentence why, what you'll need, what comes before it and
// one source; the raw trace (facts, triggers, rule ids, quotes) sits behind
// "Show full reasoning". Everything is computed by the regulatory process
// graph (src/app/processes) — nothing is hardcoded here. Incentives render
// once, in the page's "Possible incentives" section, never here.

import { useState } from "react";
import { ChevronDown, ExternalLink, Zap } from "lucide-react";
import type { ProcessAssessment, ProcessEvaluation } from "../../processes/engine";
import type { ProcessGraph } from "../../processes/graph";
import type { LegacySupersession } from "../../processes/legacyCards";
import type { ProjectContextFact, ProjectContextKey } from "../../ai/intake/projectContext";
import { processChecklist, type ChecklistItem, type ProcessChecklist } from "../../processes/presentation";
import { ConfidenceBadge, FullReasoning, StatusPill, type SummaryQuestion } from "../checklist/ChecklistParts";

/** Legacy requirement card rendered through its energy process (upload path kept). */
export interface EnergyLegacyCard { name: string; actionLabel?: string; onAction?: () => void }

type Language = "en" | "es";

/** Energy clarifying questions as one-line summary questions (≤ 3, ranked by the engine). */
export function energySummaryQuestions(
  checklist: ProcessChecklist,
  language: Language,
  onAnswer: (key: ProjectContextKey, fact: ProjectContextFact) => void
): SummaryQuestion[] {
  const evidence = language === "es" ? "Confirmado por el usuario en la lista de requisitos." : "Confirmed by user in the requirements checklist.";
  const answer = (fact: string, value: string | number | boolean) => onAnswer(fact as ProjectContextKey, { value, confidence: 1, evidence });
  return checklist.questions.map((q) => ({
    id: q.fact,
    text: q.text,
    why: q.why,
    options:
      q.type === "boolean"
        ? [{ label: language === "es" ? "Sí" : "Yes", onClick: () => answer(q.fact, true) }, { label: "No", onClick: () => answer(q.fact, false) }]
        : q.type === "enum"
          ? q.options?.map((o) => ({ label: o.label, onClick: () => answer(q.fact, o.value) }))
          : undefined,
    input:
      q.type === "number" || q.type === "string" || q.type === "list"
        ? {
            numeric: q.type === "number",
            onSubmit: (v: string) => {
              if (q.type !== "number") return answer(q.fact, v);
              const n = Number(v.replace(/[^0-9.]/g, ""));
              if (Number.isFinite(n)) answer(q.fact, n);
            },
          }
        : undefined,
  }));
}

export function EnergyProcessesSection({
  assessment,
  graph,
  checklist: given,
  legacyCards,
  suppressedLegacy = [],
  language,
  startIndex = 0,
}: {
  /** Computed by the caller (processes/view.ts) so legacy cards can be deduped. */
  assessment: ProcessAssessment;
  graph: ProcessGraph;
  /** Precomputed checklist (the page also uses it for the summary line). */
  checklist?: ProcessChecklist;
  /** Legacy cards superseded by an energy process, keyed by document id. */
  legacyCards: Record<string, EnergyLegacyCard>;
  /** Legacy cards that do not apply at all (listed under "Checked — doesn't apply"). */
  suppressedLegacy?: LegacySupersession[];
  language: Language;
  /** Flat (unstaged) lists continue the page's numbering after this many lines. */
  startIndex?: number;
}) {
  const es = language === "es";
  const checklist = given ?? processChecklist(assessment, graph, language, { suppressedLegacy });
  const byId = new Map(assessment.processes.map((p) => [p.process_id, p]));
  const flat = checklist.stages.length === 1 && checklist.stages[0].step === null;
  let n = startIndex;
  return (
    <section className="rq-group rq-group-energy ck-group" data-testid="req-group-energy">
      <div className="rq-group-head">
        <Zap size={14} /> {es ? "Energía — orden del proceso" : "Energy — process order"}
        <span className="rq-critical-count">{checklist.item_count}</span>
      </div>
      {!flat && (
        <p className="rq-group-sub">{es ? "Orden típico; algunos pasos pueden correr en paralelo." : "Typical order; some steps can run in parallel."}</p>
      )}
      <ol className={`ck-stages ${flat ? "ck-stages-flat" : ""}`} data-testid="energy-sequence">
        {checklist.stages.map((s) =>
          flat ? (
            s.items.map((it) => (
              <EnergyRow key={it.id} item={it} num={++n} p={byId.get(it.process_id)!} legacy={legacyFor(byId.get(it.process_id)!, legacyCards)} language={language} />
            ))
          ) : (
            <li key={s.id} className="ck-stage" data-testid={`energy-step-${s.step}`}>
              <div className="ck-stage-head"><span className="ck-num">{s.step}</span> {s.name}</div>
              <ul className="ck-rows">
                {s.items.map((it) => (
                  <EnergyRow key={it.id} item={it} p={byId.get(it.process_id)!} legacy={legacyFor(byId.get(it.process_id)!, legacyCards)} language={language} />
                ))}
              </ul>
            </li>
          )
        )}
      </ol>

      {checklist.not_applicable.length > 0 && (
        <details className="ck-not" data-testid="energy-not-applicable">
          <summary>{es ? "Revisados — no aplican" : "Checked — doesn't apply"} ({checklist.not_applicable.length})</summary>
          <ul>
            {checklist.not_applicable.map((x) => (
              <li key={x.name}>
                <strong>{x.name}</strong> — {x.reason}
                {x.source && <> (<a href={x.source.url} target="_blank" rel="noreferrer">{x.source.title}</a>)</>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function legacyFor(p: ProcessEvaluation, cards: Record<string, EnergyLegacyCard>): EnergyLegacyCard[] {
  return p.legacy_document_ids.map((d) => cards[d]).filter((c): c is EnergyLegacyCard => !!c);
}

function EnergyRow({ item, p, num, legacy, language }: { item: ChecklistItem; p: ProcessEvaluation; num?: number; legacy: EnergyLegacyCard[]; language: Language }) {
  const es = language === "es";
  const [open, setOpen] = useState(false);
  return (
    <li className={`ck-row ${open ? "ck-row-open" : ""}`} data-testid={`energy-process-${item.id}`}>
      <button type="button" className="ck-row-head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {num !== undefined && <span className="ck-num">{num}</span>}
        <span className="ck-name">{item.name}</span>
        {item.agency && <span className="ck-agency">{item.agency}</span>}
        <StatusPill status={item.status} language={language} />
        <ChevronDown size={16} className="ck-chevron" aria-hidden="true" />
      </button>
      {open && (
        <div className="ck-row-body">
          <p className="ck-why">{item.why}</p>
          {item.what && item.what !== item.why && <p className="ck-what">{item.what}</p>}
          {p.voluntary && p.voluntary_note && <p className="ck-what">{p.voluntary_note}</p>}
          {item.needs.length > 0 && (
            <div className="ck-block">
              <div className="ck-label">{es ? "Lo que necesitarás" : "What you'll need"}</div>
              <ul>{item.needs.map((x) => <li key={x}>{x}</li>)}</ul>
            </div>
          )}
          {item.agency_steps.length > 0 && (
            <div className="ck-block">
              <div className="ck-label">{es ? "Lo que hace la agencia" : "What the agency does"}</div>
              <ul>{item.agency_steps.map((x) => <li key={x}>{x}</li>)}</ul>
            </div>
          )}
          {item.before.length > 0 && (
            <div className="ck-block">
              <div className="ck-label">{es ? "Antes de esto" : "Before this"}</div>
              <div>{item.before.join(" · ")}</div>
            </div>
          )}
          {legacy.map((c) => c.onAction && c.actionLabel ? (
            <button key={c.name} type="button" className="ck-action" onClick={c.onAction}>{c.actionLabel}</button>
          ) : null)}
          {item.source && (
            <div className="ck-source">
              {es ? "Fuente" : "Source"}: <a href={item.source.url} target="_blank" rel="noreferrer">{item.source.title} <ExternalLink size={11} /></a>{" "}
              <ConfidenceBadge confidence={item.source.confidence} language={language} />
              {item.expert && <span className="ck-expert">{es ? "requiere revisión experta" : "needs expert check"}</span>}
            </div>
          )}
          <FullReasoning language={language}>
            <RawTrace p={p} legacy={legacy} language={language} />
          </FullReasoning>
        </div>
      )}
    </li>
  );
}

/** Auditor view: every fact, trigger, rule id, quote and citation — unchanged data. */
function RawTrace({ p, legacy, language }: { p: ProcessEvaluation; legacy: EnergyLegacyCard[]; language: Language }) {
  const es = language === "es";
  return (
    <>
      <dl className="ck-trace">
        <div><dt>{es ? "Proceso" : "Process"}</dt><dd>{p.name} ({p.process_id} · {p.process_type} · {p.state})</dd></div>
        <div><dt>{es ? "Decidido por" : "Decided by"}</dt><dd>{p.decided_by.kind}{p.decided_by.id ? ` ${p.decided_by.id}` : ""} — {p.reason}</dd></div>
        <div><dt>{es ? "Administra" : "Administered by"}</dt><dd>{p.agencies.map((a) => a.name).join(" · ")}{p.oversight.some((o) => !p.agencies.some((a) => a.id === o.id)) ? ` — ${es ? "supervisión" : "oversight"}: ${p.oversight.filter((o) => !p.agencies.some((a) => a.id === o.id)).map((a) => a.name).join(" · ")}` : ""}</dd></div>
        {p.missing_facts.length > 0 && <div><dt>{es ? "Datos pendientes" : "Pending facts"}</dt><dd>{p.missing_facts.join(", ")}</dd></div>}
        {p.readiness && <div><dt>{es ? "Preparación" : "Readiness"}</dt><dd>{p.readiness.satisfied}/{p.readiness.total}</dd></div>}
        {legacy.length > 0 && <div><dt>{es ? "Incluye" : "Covers"}</dt><dd>{legacy.map((c) => c.name).join(" · ")}</dd></div>}
        {p.jurisdiction_note && <div><dt>{es ? "Jurisdicción" : "Jurisdiction"}</dt><dd>{p.jurisdiction_note}</dd></div>}
      </dl>
      <ul className="ck-trace-steps">
        {p.explanation.map((s, i) => (
          <li key={i}>
            <span className="ck-trace-kind">{s.kind}</span> {s.url ? <a href={s.url} target="_blank" rel="noreferrer">{s.label}</a> : s.label}
            {s.detail && <div className="ck-trace-detail">{s.detail}</div>}
          </li>
        ))}
      </ul>
      {p.citation && (
        <div className="ck-trace-detail">
          {p.citation.title}{p.citation.locator ? `, ${p.citation.locator}` : ""}{p.citation.citation ? ` — ${p.citation.citation}` : ""} · {p.citation.confidence} · {p.citation.status.replace(/_/g, " ")} · {es ? "verificado" : "verified"} {p.citation.date_last_verified}
        </div>
      )}
      {p.requirements.length > 0 && (
        <ul className="ck-trace-steps">
          {p.requirements.map((r) => (
            <li key={r.id}>
              <span className="ck-trace-kind">{r.state}</span> {r.name} ({r.id}{r.evidence_ids.length ? ` · ${r.evidence_ids.join(", ")}` : ""}) —{" "}
              <a href={r.citation.url} target="_blank" rel="noreferrer" title={r.citation.controlling_language}>{r.citation.locator ?? r.citation.title}</a> · {r.citation.confidence} · {r.citation.status.replace(/_/g, " ")}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
