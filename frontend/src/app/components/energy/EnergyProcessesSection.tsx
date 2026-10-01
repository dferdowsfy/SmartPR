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
import type { RegulatoryProcess } from "../../processes/types";
import type { ProjectContextFact, ProjectContextKey } from "../../ai/intake/projectContext";
import { checklistQuestion, processChecklist, type ChecklistItem, type ChecklistQuestion, type ProcessChecklist } from "../../processes/presentation";
import { ConfidenceBadge, FullReasoning, QuestionLine, StatusPill, type SummaryQuestion } from "../checklist/ChecklistParts";
import { ActionList, RowActions, RowName } from "../checklist/RowActions";
import { EMPTY_ROW_ACTIONS, energyRowActions, mergeRowActions, type RowActionsModel } from "../checklist/rowActionModel";
import { useInPlatformActions } from "../clara/useInPlatformActions";

/** Legacy requirement card rendered through its energy process (upload path kept). */
export interface EnergyLegacyCard {
  name: string;
  actionLabel?: string;
  onAction?: () => void;
  /** The card's inline row actions (same handlers as the card). */
  rowActions?: RowActionsModel;
  /** Built for a document the process owns (the rules engine did not emit it):
   * its actions show on the row, but it is not a superseded legacy card. */
  processOwned?: boolean;
}

type Language = "en" | "es";

/** Energy clarifying questions as one-line summary questions (≤ 3, ranked by the engine). */
export function energySummaryQuestions(
  checklist: ProcessChecklist,
  language: Language,
  onAnswer: (key: ProjectContextKey, fact: ProjectContextFact) => void
): SummaryQuestion[] {
  return checklist.questions.map((q) => summaryQuestionFor(q, language, onAnswer));
}

/** One clarifying question as an answerable line (buttons, chips or input). */
export function summaryQuestionFor(
  q: ChecklistQuestion,
  language: Language,
  onAnswer: (key: ProjectContextKey, fact: ProjectContextFact) => void
): SummaryQuestion {
  const evidence = language === "es" ? "Confirmado por el usuario durante la admisión." : "Confirmed by user during intake.";
  const answer = (fact: string, value: string | number | boolean) => onAnswer(fact as ProjectContextKey, { value, confidence: 1, evidence });
  return ({
    id: q.fact,
    text: q.text,
    why: q.why,
    options:
      q.type === "boolean"
        ? [{ label: language === "es" ? "Sí" : "Yes", onClick: () => answer(q.fact, true) }, { label: "No", onClick: () => answer(q.fact, false) }]
        : q.type === "enum"
          ? q.options?.map((o) => ({ label: o.label, onClick: () => answer(q.fact, o.value) }))
          : undefined,
    // List facts with published options are multi-select chips; the fact
    // is stored comma-separated, as the intake model writes it.
    multi:
      q.type === "list" && q.options?.length
        ? { options: q.options, onSubmit: (values: string[]) => answer(q.fact, values.join(",")) }
        : undefined,
    input:
      q.type === "number" || q.type === "string" || (q.type === "list" && !q.options?.length)
        ? {
            numeric: q.type === "number",
            onSubmit: (v: string) => {
              if (q.type !== "number") return answer(q.fact, v);
              const n = Number(v.replace(/[^0-9.]/g, ""));
              if (Number.isFinite(n)) answer(q.fact, n);
            },
          }
        : undefined,
  });
}

export function EnergyProcessesSection({
  assessment,
  graph,
  checklist: given,
  legacyCards,
  suppressedLegacy = [],
  language,
  defaultOpen = [],
  onAnswer,
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
  /** Process ids whose row (and full reasoning) start expanded — deep links and tests. */
  defaultOpen?: string[];
  /** Answers a row's question in place ("Answer" on answer-only rows). */
  onAnswer?: (key: ProjectContextKey, fact: ProjectContextFact) => void;
}) {
  const es = language === "es";
  const checklist = given ?? processChecklist(assessment, graph, language, { suppressedLegacy });
  const byId = new Map(assessment.processes.map((p) => [p.process_id, p]));
  const flat = checklist.stages.length === 1 && checklist.stages[0].step === null;
  // The first open question that decides a row, as an answerable line.
  const questionFor = (p: ProcessEvaluation): SummaryQuestion | null => {
    if (!onAnswer || p.state !== "NEEDS_FACT") return null;
    const q = assessment.questions.find((x) => p.missing_facts.includes(x.fact)) ?? assessment.questions.find((x) => x.resolves.includes(p.process_id));
    return q ? summaryQuestionFor(checklistQuestion(q, language), language, onAnswer) : null;
  };
  // Numbering restarts at 1 in every group of the page.
  let n = 0;
  return (
    <section className="rq-group rq-group-energy ck-group" data-testid="req-group-energy">
      <div className="rq-group-head">
        <Zap size={14} /> {es ? "Energía — orden del proceso" : "Energy — process order"}
        <span className="rq-critical-count">{checklist.item_count}</span>
      </div>
      {!flat && (
        <p className="rq-group-sub">{es ? "Orden típico; algunos pasos pueden correr en paralelo." : "Typical order; some steps can run in parallel."}</p>
      )}
      {/* Rows carry their own number badge, so lists are role="list" divs,
          never <ol>/<li>: no second (browser or copy/paste) number. */}
      <div role="list" className={`ck-stages ${flat ? "ck-stages-flat" : ""}`} data-testid="energy-sequence">
        {checklist.stages.map((s) =>
          flat ? (
            s.items.map((it) => (
              <EnergyRow key={it.id} item={it} num={++n} startOpen={defaultOpen.includes(it.process_id)} question={questionFor(byId.get(it.process_id)!)} portal={graph.processes.get(it.process_id)?.portal ?? null} p={byId.get(it.process_id)!} legacy={legacyFor(byId.get(it.process_id)!, legacyCards)} language={language} />
            ))
          ) : (
            <div role="listitem" key={s.id} className="ck-stage" data-testid={`energy-step-${s.step}`}>
              <div className="ck-stage-head"><span className="ck-num">{s.step}</span> {s.name}</div>
              <div role="list" className="ck-rows">
                {s.items.map((it) => (
                  <EnergyRow key={it.id} item={it} startOpen={defaultOpen.includes(it.process_id)} question={questionFor(byId.get(it.process_id)!)} portal={graph.processes.get(it.process_id)?.portal ?? null} p={byId.get(it.process_id)!} legacy={legacyFor(byId.get(it.process_id)!, legacyCards)} language={language} />
                ))}
              </div>
            </div>
          )
        )}
      </div>

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

function EnergyRow({ item, p, num, legacy: allCards, portal = null, language, startOpen = false, question = null }: { item: ChecklistItem; p: ProcessEvaluation; num?: number; legacy: EnergyLegacyCard[]; portal?: RegulatoryProcess["portal"] | null; language: Language; startOpen?: boolean; question?: SummaryQuestion | null }) {
  const es = language === "es";
  const [open, setOpen] = useState(startOpen);
  const [askOpen, setAskOpen] = useState(false);
  // An expert-check row does not get actions invented for it: only a
  // superseded card's own actions (none built from the process documents).
  const legacy = item.status === "expert" ? allCards.filter((c) => !c.processOwned) : allCards;
  const needs = item.needs.filter((x) => x.trim());
  // Inline actions: the covered cards' own in-platform actions (same
  // handlers as the expanded view), else SmartPR's guided form built from
  // "What you'll need" ("Complete form"); answer rows lead with "Answer".
  // The official portal and Teach Clara sit in the ⋯ menu. Rows with nothing
  // to do (May apply without a portal, expert checks) get no primary.
  const inPlatform = useInPlatformActions(
    { key: item.process_id, name: item.name, agency: item.agency ?? null, needs, portalUrl: portal?.url ?? null, portalLabel: portal ? ((es ? portal.label_es : null) ?? portal.label) : null },
    language
  );
  const actions: RowActionsModel = energyRowActions({
    status: item.status,
    cards: mergeRowActions(legacy.map((c) => c.rowActions ?? EMPTY_ROW_ACTIONS)),
    portal,
    question: question ? { prompt: question.text } : null,
    ...inPlatform.handlers,
  }, language);
  return (
    <div role="listitem" className={`ck-row ${open ? "ck-row-open" : ""}`} data-testid={`energy-process-${item.id}`}>
      <div className="ck-card-line">
        <button type="button" className="ck-row-head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {num !== undefined && <span className="ck-num">{num}</span>}
          <RowName name={item.name} model={actions} language={language} />
          {item.agency && <span className="ck-agency">{item.agency}</span>}
          <StatusPill status={item.status} language={language} />
          <ChevronDown size={16} className="ck-chevron" aria-hidden="true" />
        </button>
        <RowActions model={actions} language={language} onAnswer={() => setAskOpen((q) => !q)} answerOpen={askOpen} />
      </div>
      {askOpen && question && <QuestionLine q={question} language={language} standalone />}
      {inPlatform.dialogs(actions)}
      {open && (
        <div className="ck-row-body">
          <p className="ck-why">{item.why}</p>
          {item.what && item.what !== item.why && <p className="ck-what">{item.what}</p>}
          {p.voluntary && p.voluntary_note && <p className="ck-what">{p.voluntary_note}</p>}
          {item.needs.length > 0 && (
            <div className="ck-block">
              <div className="ck-label">{es ? "Lo que necesitarás" : "What you'll need"}</div>
              <ul>{item.needs.filter((x) => x.trim()).map((x) => <li key={x}>{x}</li>)}</ul>
            </div>
          )}
          {item.agency_steps.length > 0 && (
            <div className="ck-block">
              <div className="ck-label">{es ? "Lo que hace la agencia" : "What the agency does"}</div>
              <ul>{item.agency_steps.filter((x) => x.trim()).map((x) => <li key={x}>{x}</li>)}</ul>
            </div>
          )}
          {item.before.length > 0 && (
            <div className="ck-block">
              <div className="ck-label">{es ? "Antes de esto" : "Before this"}</div>
              <div>{item.before.join(" · ")}</div>
            </div>
          )}
          {/* SmartPR's guided form — the same handler as the row's inline "Complete form". */}
          {actions.primary?.kind === "guided" && (
            <div className="ck-card-actions">
              <button type="button" className="ck-action" data-testid="card-action" data-cta="guided" onClick={actions.primary.onClick}>
                {es ? "Completar el formulario en SmartPR" : "Complete the form in SmartPR"}
              </button>
            </div>
          )}
          {/* The covered cards' actions — the same handlers as the row's inline button. */}
          {legacy.map((c) => c.rowActions
            ? <ActionList key={c.name} model={c.rowActions} />
            : c.onAction && c.actionLabel ? <button key={c.name} type="button" className="ck-action" onClick={c.onAction}>{c.actionLabel}</button> : null)}
          {portal && item.status !== "expert" && !legacy.some((c) => [c.rowActions?.primary, ...(c.rowActions?.more ?? [])].some((x) => x?.href === portal.url)) && (
            <div className="ck-card-actions">
              <a className="ck-action" data-testid="card-action" data-cta="portal" href={portal.url} target="_blank" rel="noopener noreferrer">
                {(es ? portal.label_es : null) ?? portal.label} <ExternalLink size={11} />
              </a>
            </div>
          )}
          {item.source && (
            <div className="ck-source">
              {es ? "Fuente" : "Source"}: <a href={item.source.url} target="_blank" rel="noreferrer">{item.source.title} <ExternalLink size={11} /></a>{" "}
              <ConfidenceBadge confidence={item.source.confidence} language={language} />
              {item.expert && <span className="ck-expert">{es ? "requiere revisión experta" : "needs expert check"}</span>}
            </div>
          )}
          <FullReasoning language={language} open={startOpen}>
            <ProcessReasoning p={p} legacy={allCards.filter((c) => !c.processOwned)} language={language} />
          </FullReasoning>
        </div>
      )}
    </div>
  );
}

/** One line of the auditor trace; null when it would carry no text. */
interface TraceLine { kind: string; text: string; href?: string; detail?: string; title?: string }

function traceText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

/**
 * The auditor trace as plain lines: every fact, trigger, classification,
 * source, agency, dependency and requirement (rule ids, evidence ids,
 * quotes, citations). A line with no text is dropped instead of rendering
 * as an empty bullet, and nothing is rendered as a list item, so copying
 * the page never yields blank or doubled list markers.
 */
export function processTraceLines(p: ProcessEvaluation): TraceLine[] {
  const lines: TraceLine[] = [];
  for (const s of p.explanation) {
    const text = traceText(s.label);
    const detail = traceText(s.detail) || undefined;
    if (!text && !detail) continue;
    lines.push({ kind: s.kind, text: text || detail!, href: s.url || undefined, detail: text ? detail : undefined });
  }
  for (const r of p.requirements) {
    const name = traceText(r.name);
    if (!name) continue;
    const ids = [r.id, ...r.evidence_ids].filter(Boolean).join(" · ");
    const cite = [traceText(r.citation?.locator) || traceText(r.citation?.title), traceText(r.citation?.confidence), traceText(r.citation?.status).replace(/_/g, " ")].filter(Boolean).join(" · ");
    lines.push({ kind: r.state, text: `${name} (${ids})`, detail: cite || undefined, href: r.citation?.url || undefined, title: r.citation?.controlling_language || undefined });
  }
  return lines;
}

/** Auditor view: every fact, trigger, rule id, quote and citation — unchanged data. */
export function ProcessReasoning({ p, legacy = [], language }: { p: ProcessEvaluation; legacy?: EnergyLegacyCard[]; language: Language }) {
  const es = language === "es";
  const lines = processTraceLines(p);
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
        {p.citation && (
          <div><dt>{es ? "Fuente" : "Source"}</dt><dd>{p.citation.title}{p.citation.locator ? `, ${p.citation.locator}` : ""}{p.citation.citation ? ` — ${p.citation.citation}` : ""} · {p.citation.confidence} · {p.citation.status.replace(/_/g, " ")} · {es ? "verificado" : "verified"} {p.citation.date_last_verified}</dd></div>
        )}
      </dl>
      {lines.length > 0 && (
        <div className="ck-trace-steps" data-testid="trace-lines">
          {lines.map((l, i) => (
            <p key={i} className="ck-trace-line">
              <span className="ck-trace-kind">{l.kind}</span>{" "}
              {l.href ? <a href={l.href} target="_blank" rel="noreferrer" title={l.title}>{l.text}</a> : l.text}
              {l.detail && <span className="ck-trace-detail"> — {l.detail}</span>}
            </p>
          ))}
        </div>
      )}
    </>
  );
}
