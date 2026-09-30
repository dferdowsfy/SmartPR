// ============================================================================
// Regulatory process reasoning engine.
//
// Graph traversal only — no domain logic lives here:
//   project facts → project-type classification (has_project_type)
//   → candidate processes (may_require) → applicability (gate, exceptions,
//   source-backed trigger rules) → requirements (requires) → evidence
//   (satisfied_by) → gaps + readiness → explanation path
//   (fact → trigger → classification → process → source → agency).
// Incentives (may_qualify_for) are evaluated separately and never become
// requirements.
// ============================================================================

import { evaluateCondition, type ConditionResult } from "./conditions.ts";
import type { ProcessGraph } from "./graph.ts";
import type {
  AgencyRef,
  Condition,
  Confidence,
  EvidenceState,
  FactDefinition,
  FactEvidence,
  FactMap,
  IncentiveState,
  ProcessKB,
  ProcessState,
  ProcessType,
  RegulatoryProcess,
  Requirement,
  SourceStatus,
} from "./types.ts";

export interface CitationView {
  source_id: string;
  title: string;
  authority: string;
  citation?: string;
  url: string;
  locator?: string;
  controlling_language?: string;
  confidence: Confidence;
  status: SourceStatus;
  date_last_verified: string;
  effective_date?: string | null;
}

export type ExplanationStepKind =
  | "fact" | "trigger" | "exception" | "gate" | "classification" | "process" | "source" | "agency" | "jurisdiction" | "dependency";

export interface ExplanationStep {
  kind: ExplanationStepKind;
  label: string;
  detail?: string;
  url?: string;
}

export interface ProjectTypeMatch {
  id: string;
  name: string;
  status: "has_type" | "possible";
  facts: string[];
}

export interface RequirementEvaluation {
  id: string;
  name: string;
  kind: "evidence" | "agency_step";
  state: EvidenceState | "AGENCY_STEP" | "NEEDS_FACT";
  evidence_ids: string[];
  provided_evidence_ids: string[];
  missing_evidence_ids: string[];
  missing_facts: string[];
  citation: CitationView;
  notes?: string;
}

export interface PrerequisiteView {
  process_id: string;
  name: string;
  state: ProcessState | "NOT_EVALUATED";
  note?: string;
  /** Required prerequisite with outstanding evidence. */
  blocking: boolean;
  /** Applies only if a still-unknown fact turns out a certain way. */
  conditional: boolean;
}

export interface ProcessEvaluation {
  process_id: string;
  name: string;
  process_type: ProcessType;
  domain: string;
  state: ProcessState;
  /** Voluntary program: REQUIRED means "required if you enroll", never mandatory. */
  voluntary: boolean;
  voluntary_note?: string;
  reason: string;
  decided_by: { kind: "rule" | "exception" | "gate" | "follows" | "none"; id?: string };
  citation?: CitationView;
  via_project_types: string[];
  agencies: AgencyRef[];
  oversight: AgencyRef[];
  missing_facts: string[];
  requirements: RequirementEvaluation[];
  prerequisites: PrerequisiteView[];
  readiness: { satisfied: number; total: number; score: number } | null;
  legacy_document_ids: string[];
  jurisdiction_note?: string;
  /** Lifecycle stage (KB `stages`), for sequential processes. */
  stage?: { id: string; name: string; name_es?: string; order: number };
  explanation: ExplanationStep[];
}

export interface IncentiveEvaluation {
  incentive_id: string;
  name: string;
  program_id?: string;
  program_name?: string;
  state: IncentiveState;
  reason: string;
  agencies: AgencyRef[];
  missing_facts: string[];
  eligibility_requirements: RequirementEvaluation[];
  citation: CitationView;
  confidence: Confidence;
  status: SourceStatus;
  notes?: string;
}

export interface ClarifyingQuestion {
  fact: string;
  question: string;
  why: string;
  type: FactDefinition["type"];
  options?: string[];
  /** value → plain-English label, for every option. */
  option_labels?: Record<string, string>;
  /** Process / incentive ids whose decision this fact controls. */
  resolves: string[];
}

export interface Gap {
  kind: "missing_evidence" | "needs_fact" | "blocked_by_prerequisite";
  process_id: string;
  requirement_id?: string;
  evidence_ids?: string[];
  facts?: string[];
  message: string;
}

export interface ProcessAssessment {
  facts: FactMap;
  /** Readiness counts evidence for REQUIRED processes only — never potentially
   * required processes or incentives. */
  project_types: ProjectTypeMatch[];
  processes: ProcessEvaluation[];
  incentives: IncentiveEvaluation[];
  questions: ClarifyingQuestion[];
  gaps: Gap[];
  readiness: { satisfied: number; total: number; score: number } | null;
}

export interface EvaluateOptions {
  factEvidence?: FactEvidence;
  /** DOC_* evidence ids already uploaded / tagged in the evidence locker. */
  providedEvidenceIds?: Iterable<string>;
  maxQuestions?: number;
}

const STATE_ORDER: Record<ProcessState, number> = { REQUIRED: 0, NEEDS_FACT: 1, POTENTIALLY_REQUIRED: 2, NOT_REQUIRED: 3 };

function citationFor(graph: ProcessGraph, sourceId: string, extra: { locator?: string; controlling_language?: string; confidence?: Confidence; status?: SourceStatus }): CitationView {
  const s = graph.sources.get(sourceId);
  if (!s) throw new Error(`Unknown source ${sourceId}`);
  return {
    source_id: s.id,
    title: s.title,
    authority: s.authority,
    citation: s.citation,
    url: s.url,
    locator: extra.locator,
    controlling_language: extra.controlling_language,
    // A rule can never be more certain than its source.
    confidence: weaker(extra.confidence ?? s.confidence, s.confidence),
    status: extra.status ?? s.status,
    date_last_verified: s.date_last_verified,
    effective_date: s.effective_date,
  };
}

function weaker(a: Confidence, b: Confidence): Confidence {
  const r = { high: 2, medium: 1, low: 0 } as const;
  return r[a] <= r[b] ? a : b;
}

function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

/**
 * Apply KB `derived_facts`: each derived key is recomputed from the input
 * facts (any stale value passed in is discarded). First case that holds wins;
 * if none holds the derived fact stays unknown.
 */
export function deriveFacts(kb: Pick<ProcessKB, "derived_facts">, input: FactMap): { facts: FactMap; evidence: FactEvidence } {
  const facts: FactMap = { ...input };
  const evidence: FactEvidence = {};
  for (const d of kb.derived_facts ?? []) delete facts[d.key];
  for (const d of kb.derived_facts ?? []) {
    const hit = d.cases.find((c) => evaluateCondition(c.when, facts).value === true);
    if (hit) {
      facts[d.key] = hit.value;
      evidence[d.key] = { origin: `derived:${hit.id}`, quote: hit.summary };
    }
  }
  return { facts, evidence };
}

export function evaluateProcesses(graph: ProcessGraph, inputFacts: FactMap, opts: EvaluateOptions = {}): ProcessAssessment {
  const provided = new Set(opts.providedEvidenceIds ?? []);
  const derived = deriveFacts(graph.kb, inputFacts);
  const facts = derived.facts;
  const factEvidence = { ...(opts.factEvidence ?? {}), ...derived.evidence };
  const factDefs = new Map(graph.kb.facts.map((f) => [f.key, f]));
  const derivedDefs = new Map((graph.kb.derived_facts ?? []).map((d) => [d.key, d]));
  const stageDefs = new Map((graph.kb.stages ?? []).map((st) => [st.id, st]));
  /** Derived facts are never asked directly: route to their askable inputs. */
  const expandAsk = (keys: string[]): string[] =>
    uniq(keys.flatMap((k) => { const d = derivedDefs.get(k); return d ? d.ask_via.filter((f) => facts[f] === undefined) : [k]; }));
  const agencyList = (ids: string[] = []) => ids.map((id) => graph.agencies.get(id)).filter((a): a is AgencyRef => !!a);

  const factStep = (key: string): ExplanationStep => {
    const def = factDefs.get(key);
    const v = facts[key];
    const ev = factEvidence[key];
    return {
      kind: "fact",
      label: `${def?.label ?? derivedDefs.get(key)?.label ?? key}: ${Array.isArray(v) ? v.join(", ") : String(v)}`,
      detail: ev?.quote ? `"${ev.quote}"` : ev?.origin,
    };
  };

  // 1. has_project_type
  const projectTypes: ProjectTypeMatch[] = [];
  for (const pt of graph.kb.project_types) {
    const c = evaluateCondition(pt.classifier, facts);
    if (c.value === true) {
      projectTypes.push({ id: pt.id, name: pt.name, status: "has_type", facts: c.usedFacts });
    } else if (c.value === null && pt.signals) {
      const s = evaluateCondition(pt.signals, facts);
      if (s.value === true) projectTypes.push({ id: pt.id, name: pt.name, status: "possible", facts: s.usedFacts });
    }
  }

  // 2. may_require → candidates
  const via = new Map<string, string[]>();
  for (const m of projectTypes) {
    for (const pid of graph.projectTypes.get(m.id)!.may_require) via.set(pid, [...(via.get(pid) ?? []), m.id]);
  }

  // 3. applicability per candidate (memoized for follows_process)
  type Decision = Pick<ProcessEvaluation, "state" | "reason" | "decided_by" | "citation" | "missing_facts"> & { used: string[]; summary?: string };
  const decisions = new Map<string, Decision>();

  const decide = (p: RegulatoryProcess): Decision => {
    const hit = decisions.get(p.id);
    if (hit) return hit;
    const d = decideUncached(p);
    decisions.set(p.id, d);
    return d;
  };

  const ruleAsk = (ask: string[] | undefined, r: ConditionResult) => (ask !== undefined ? ask.filter((f) => r.unknownFacts.includes(f) || facts[f] === undefined) : r.unknownFacts);

  const decideUncached = (p: RegulatoryProcess): Decision => {
    if (p.follows_process) {
      const parent = graph.processes.get(p.follows_process)!;
      const pd = via.has(parent.id) ? decide(parent) : null;
      if (!pd || pd.state === "NOT_REQUIRED") {
        return { state: "NOT_REQUIRED", reason: `Only applies once "${parent.name}" is required.`, decided_by: { kind: "follows", id: parent.id }, missing_facts: [], used: [] };
      }
      if (pd.state === "NEEDS_FACT") {
        return { state: "NEEDS_FACT", reason: `Depends on whether "${parent.name}" is required.`, decided_by: { kind: "follows", id: parent.id }, missing_facts: pd.missing_facts, used: [] };
      }
      if (pd.state === "POTENTIALLY_REQUIRED") {
        return { state: "POTENTIALLY_REQUIRED", reason: `Follows "${parent.name}", which may apply.`, decided_by: { kind: "follows", id: parent.id }, missing_facts: [], used: pd.used };
      }
    }
    const used: string[] = [];
    if (p.gate) {
      const g = evaluateCondition(p.gate, facts);
      const gateCitation = p.gate_source_id
        ? citationFor(graph, p.gate_source_id, { locator: p.gate_locator, controlling_language: p.gate_controlling_language })
        : undefined;
      if (g.value === false) {
        return { state: "NOT_REQUIRED", reason: p.gate_reason ?? "Threshold condition not met.", decided_by: { kind: "gate" }, citation: gateCitation, missing_facts: [], used: g.usedFacts };
      }
      if (g.value === null) {
        const ask = (p.gate_ask ?? g.unknownFacts).filter((f) => facts[f] === undefined);
        return { state: "NEEDS_FACT", reason: p.gate_reason ?? "A controlling fact is unknown.", decided_by: { kind: "gate" }, citation: gateCitation, missing_facts: ask.length ? ask : g.unknownFacts, used: g.usedFacts };
      }
      used.push(...g.usedFacts);
    }
    const unknownExceptionFacts: string[] = [];
    for (const x of p.exceptions ?? []) {
      const r = evaluateCondition(x.when, facts);
      if (r.value === true) {
        return { state: "NOT_REQUIRED", reason: x.reason, decided_by: { kind: "exception", id: x.id }, citation: citationFor(graph, x.source_id, x), missing_facts: [], used: uniq([...used, ...r.usedFacts]) };
      }
      if (r.value === null) unknownExceptionFacts.push(...r.unknownFacts);
    }
    let potential: { rule: RegulatoryProcess["applicability"][number]; r: ConditionResult } | null = null;
    const unknownRuleFacts: string[] = [];
    for (const rule of p.applicability) {
      const r = evaluateCondition(rule.trigger, facts);
      if (r.value === true && rule.outcome === "REQUIRED") {
        if (unknownExceptionFacts.length) {
          return {
            state: "NEEDS_FACT",
            reason: `${rule.trigger_summary} An exception may still apply.`,
            decided_by: { kind: "rule", id: rule.id },
            citation: citationFor(graph, rule.source_id, rule),
            missing_facts: uniq(unknownExceptionFacts),
            used: uniq([...used, ...r.usedFacts]),
            summary: rule.trigger_summary,
          };
        }
        return { state: "REQUIRED", reason: rule.trigger_summary, decided_by: { kind: "rule", id: rule.id }, citation: citationFor(graph, rule.source_id, rule), missing_facts: [], used: uniq([...used, ...r.usedFacts]), summary: rule.trigger_summary };
      }
      if (r.value === true && !potential) potential = { rule, r };
      if (r.value === null) unknownRuleFacts.push(...ruleAsk(rule.ask, r));
    }
    if (potential) {
      return {
        state: "POTENTIALLY_REQUIRED",
        reason: potential.rule.trigger_summary,
        decided_by: { kind: "rule", id: potential.rule.id },
        citation: citationFor(graph, potential.rule.source_id, potential.rule),
        missing_facts: [],
        used: uniq([...used, ...potential.r.usedFacts]),
        summary: potential.rule.trigger_summary,
      };
    }
    const hasUnknownRule = p.applicability.some((rule) => evaluateCondition(rule.trigger, facts).value === null);
    if (hasUnknownRule) {
      const ask = uniq(unknownRuleFacts.length ? unknownRuleFacts : (p.ask ?? []).filter((f) => facts[f] === undefined));
      return { state: "NEEDS_FACT", reason: "A controlling fact is unknown.", decided_by: { kind: "none" }, missing_facts: ask, used };
    }
    return { state: "NOT_REQUIRED", reason: "No applicability trigger is met by the known facts.", decided_by: { kind: "none" }, missing_facts: [], used };
  };

  const evalRequirement = (req: Requirement): RequirementEvaluation | null => {
    const aw = evaluateCondition(req.applies_when, facts);
    if (aw.value === false) return null;
    const kind = req.kind ?? "evidence";
    const providedIds = req.evidence_ids.filter((e) => provided.has(e));
    const missingIds = req.evidence_ids.filter((e) => !provided.has(e));
    let state: RequirementEvaluation["state"];
    if (aw.value === null) state = "NEEDS_FACT";
    else if (kind === "agency_step") state = "AGENCY_STEP";
    else state = missingIds.length === 0 ? "SATISFIED" : "MISSING";
    return {
      id: req.id,
      name: req.name,
      kind,
      state,
      evidence_ids: req.evidence_ids,
      provided_evidence_ids: providedIds,
      missing_evidence_ids: kind === "agency_step" ? [] : missingIds,
      missing_facts: expandAsk(aw.unknownFacts),
      citation: citationFor(graph, req.source_id, req),
      notes: req.notes,
    };
  };

  const readinessOf = (reqs: RequirementEvaluation[]) => {
    const scored = reqs.filter((r) => r.kind === "evidence" && r.state !== "NEEDS_FACT");
    if (!scored.length) return null;
    const satisfied = scored.filter((r) => r.state === "SATISFIED").length;
    return { satisfied, total: scored.length, score: Math.round((satisfied / scored.length) * 100) / 100 };
  };

  const evaluations: ProcessEvaluation[] = [];
  for (const [pid, types] of via) {
    const p = graph.processes.get(pid)!;
    const d = decide(p);
    const active = d.state === "REQUIRED" || d.state === "POTENTIALLY_REQUIRED";
    const requirements = active
      ? p.requirement_ids.map((id) => evalRequirement(graph.requirements.get(id)!)).filter((r): r is RequirementEvaluation => !!r)
      : [];
    const agencies = agencyList(p.administered_by);
    const explanation: ExplanationStep[] = [];
    for (const f of d.used) explanation.push(factStep(f));
    if (d.summary) explanation.push({ kind: "trigger", label: d.summary, detail: d.decided_by.id });
    else if (d.decided_by.kind !== "none") explanation.push({ kind: d.decided_by.kind === "exception" ? "exception" : d.decided_by.kind === "gate" ? "gate" : "dependency", label: d.reason, detail: d.decided_by.id });
    for (const t of types) {
      const m = projectTypes.find((x) => x.id === t)!;
      explanation.push({ kind: "classification", label: `${m.status === "possible" ? "Possibly " : ""}${m.name}`, detail: t });
    }
    explanation.push({ kind: "process", label: p.name, detail: `${p.process_type} · ${d.state}` });
    if (d.citation) {
      explanation.push({
        kind: "source",
        label: `${d.citation.title}${d.citation.locator ? ` — ${d.citation.locator}` : ""}`,
        detail: d.citation.controlling_language ? `"${d.citation.controlling_language}" (${d.citation.confidence} confidence, ${d.citation.status})` : `${d.citation.confidence} confidence`,
        url: d.citation.url,
      });
    }
    for (const a of agencies) explanation.push({ kind: "agency", label: a.name, url: a.url ?? undefined });
    if (p.jurisdiction_note) {
      const muni = facts.municipality;
      explanation.push({ kind: "jurisdiction", label: muni ? `Municipality: ${String(muni)}` : "Municipality not stated", detail: p.jurisdiction_note });
    }
    evaluations.push({
      process_id: p.id,
      name: p.name,
      process_type: p.process_type,
      domain: p.domain,
      state: d.state,
      voluntary: !!p.voluntary,
      voluntary_note: p.voluntary_note,
      reason: d.reason,
      decided_by: d.decided_by,
      citation: d.citation,
      via_project_types: types,
      agencies,
      oversight: agencyList(p.oversight_by),
      missing_facts: expandAsk(d.missing_facts),
      requirements,
      prerequisites: [],
      readiness: d.state === "REQUIRED" ? readinessOf(requirements) : null,
      legacy_document_ids: p.legacy_document_ids ?? [],
      jurisdiction_note: p.jurisdiction_note,
      ...(p.stage && stageDefs.has(p.stage) ? { stage: stageDefs.get(p.stage)! } : {}),
      explanation,
    });
  }

  // 4. prerequisite_for — only prerequisites that are themselves in play.
  const byId = new Map(evaluations.map((e) => [e.process_id, e]));
  for (const e of evaluations) {
    if (e.state === "NOT_REQUIRED") continue;
    const p = graph.processes.get(e.process_id)!;
    for (const pre of p.prerequisites) {
      const pe = byId.get(pre.process_id);
      if (!pe || pe.state === "NOT_REQUIRED") continue;
      const w = evaluateCondition(pre.when, facts);
      if (w.value === false) continue;
      const conditional = w.value === null;
      const blocking = !conditional && pe.state === "REQUIRED" && !!pe.readiness && pe.readiness.score < 1;
      e.prerequisites.push({ process_id: pe.process_id, name: pe.name, state: pe.state, note: pre.note, blocking, conditional });
      e.explanation.push({ kind: "dependency", label: `${conditional ? "Conditional prerequisite" : "Prerequisite"}: ${pe.name} (${pe.state})`, detail: pre.note });
    }
  }
  evaluations.sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.name.localeCompare(b.name));

  // 5. incentives — separate category
  const incentiveCandidates = uniq(projectTypes.flatMap((m) => graph.projectTypes.get(m.id)!.may_qualify_for));
  const incDecisions = new Map<string, { state: IncentiveState; reason: string; missing: string[] }>();
  const decideIncentive = (id: string): { state: IncentiveState; reason: string; missing: string[] } => {
    const hit = incDecisions.get(id);
    if (hit) return hit;
    const inc = graph.incentives.get(id)!;
    let out: { state: IncentiveState; reason: string; missing: string[] };
    const parent = inc.requires_incentive ? decideIncentive(inc.requires_incentive) : null;
    if (parent && parent.state !== "POTENTIALLY_ELIGIBLE") {
      out = { state: parent.state, reason: `Requires "${graph.incentives.get(inc.requires_incentive!)!.name}".`, missing: parent.missing };
    } else {
      const r = evaluateCondition(inc.eligibility, facts);
      if (r.value === true) out = { state: "POTENTIALLY_ELIGIBLE", reason: inc.eligibility_summary, missing: [] };
      else if (r.value === false) out = { state: "NOT_ELIGIBLE", reason: inc.ineligible_reason ?? "Eligibility conditions are not met by the known facts.", missing: [] };
      else out = { state: "NEEDS_FACT", reason: inc.eligibility_summary, missing: expandAsk(uniq((inc.ask ?? r.unknownFacts).filter((f) => facts[f] === undefined))) };
    }
    incDecisions.set(id, out);
    return out;
  };
  const incentives: IncentiveEvaluation[] = incentiveCandidates.map((id) => {
    const inc = graph.incentives.get(id)!;
    const d = decideIncentive(id);
    const program = inc.program_id ? graph.incentiveCatalog.get(inc.program_id) : undefined;
    return {
      incentive_id: inc.id,
      name: inc.name,
      program_id: inc.program_id,
      program_name: program?.name,
      state: d.state,
      reason: d.reason,
      agencies: agencyList(inc.administered_by),
      missing_facts: d.missing,
      eligibility_requirements:
        d.state === "NOT_ELIGIBLE"
          ? []
          : inc.eligibility_requirement_ids.map((rid) => evalRequirement(graph.requirements.get(rid)!)).filter((r): r is RequirementEvaluation => !!r),
      citation: citationFor(graph, inc.source_ids[0], { locator: inc.locator, controlling_language: inc.controlling_language, confidence: inc.confidence, status: inc.status }),
      confidence: inc.confidence,
      status: inc.status,
      notes: inc.notes,
    };
  });

  // 6. gaps
  const gaps: Gap[] = [];
  for (const e of evaluations) {
    if (e.state === "NEEDS_FACT") {
      gaps.push({ kind: "needs_fact", process_id: e.process_id, facts: e.missing_facts, message: `${e.name}: need ${e.missing_facts.join(", ") || "more information"} to decide.` });
    }
    if (e.state !== "REQUIRED") continue;
    for (const r of e.requirements) {
      if (r.state === "MISSING") gaps.push({ kind: "missing_evidence", process_id: e.process_id, requirement_id: r.id, evidence_ids: r.missing_evidence_ids, message: `${e.name}: ${r.name}` });
      if (r.state === "NEEDS_FACT") gaps.push({ kind: "needs_fact", process_id: e.process_id, requirement_id: r.id, facts: r.missing_facts, message: `${e.name}: ${r.name} depends on ${r.missing_facts.join(", ")}` });
    }
    for (const pre of e.prerequisites) {
      if (pre.blocking) gaps.push({ kind: "blocked_by_prerequisite", process_id: e.process_id, message: `${e.name} waits on ${pre.name}` });
    }
  }

  // 7. material clarifying questions — facts that control an open decision.
  const weight = new Map<string, { w: number; resolves: Set<string> }>();
  const bump = (fact: string, by: number, id: string) => {
    if (facts[fact] !== undefined) return;
    const cur = weight.get(fact) ?? { w: 0, resolves: new Set<string>() };
    cur.w += by;
    cur.resolves.add(id);
    weight.set(fact, cur);
  };
  for (const e of evaluations) {
    if (e.state === "NEEDS_FACT") e.missing_facts.forEach((f) => bump(f, 3, e.process_id));
    if (e.state === "REQUIRED") e.requirements.forEach((r) => r.missing_facts.forEach((f) => bump(f, 1, r.id)));
  }
  // Incentive questions only when the KB's interest condition holds (never by default).
  const incentiveInterest = !!graph.kb.incentive_questions_when && evaluateCondition(graph.kb.incentive_questions_when, facts).value === true;
  for (const i of incentives) {
    if (i.state === "NEEDS_FACT" && incentiveInterest) i.missing_facts.forEach((f) => bump(f, 2, i.incentive_id));
  }
  // A project type that is only "possible" asks the facts that would confirm it.
  for (const m of projectTypes) {
    if (m.status !== "possible") continue;
    for (const f of expandAsk(graph.projectTypes.get(m.id)!.ask ?? [])) bump(f, 2, m.id);
  }
  const prio = (f: string) => factDefs.get(f)?.question_priority ?? 0;
  const questions: ClarifyingQuestion[] = [...weight.entries()]
    .sort((a, b) => b[1].w - a[1].w || prio(b[0]) - prio(a[0]) || b[1].resolves.size - a[1].resolves.size || a[0].localeCompare(b[0]))
    .slice(0, opts.maxQuestions ?? 3)
    .map(([fact, { resolves }]) => {
      const def = factDefs.get(fact);
      return {
        fact,
        question: def ? questionFor(def, facts) : fact,
        why: def?.why ?? "",
        type: def?.type ?? "string",
        options: def?.options,
        option_labels: def?.options ? Object.fromEntries(def.options.map((o) => [o, optionLabel(def, o)])) : undefined,
        resolves: [...resolves],
      };
    });

  const required = evaluations.filter((e) => e.state === "REQUIRED" && !e.voluntary && e.readiness);
  const satisfied = required.reduce((n, e) => n + e.readiness!.satisfied, 0);
  const total = required.reduce((n, e) => n + e.readiness!.total, 0);

  return {
    facts,
    project_types: projectTypes,
    processes: evaluations,
    incentives,
    questions,
    gaps,
    readiness: total ? { satisfied, total, score: Math.round((satisfied / total) * 100) / 100 } : null,
  };
}

/** Context-aware question text: first matching variant, with {fact} interpolation. */
export function questionFor(def: FactDefinition, facts: FactMap): string {
  const variant = (def.question_variants ?? []).find((v) => evaluateCondition(v.when, facts).value === true);
  const text = variant?.question ?? def.question;
  return text.replace(/\{([a-z_]+)\}/g, (m, key: string) => {
    const v = facts[key];
    return v === undefined ? m : Array.isArray(v) ? v.join(", ") : String(v);
  });
}

/** Plain-English label for an option value (KB label, else humanized). */
export function optionLabel(def: FactDefinition | undefined, value: string): string {
  const l = def?.option_labels?.[value];
  if (l) return l;
  const h = value.replace(/_/g, " ");
  return h.charAt(0).toUpperCase() + h.slice(1);
}

/** Compact, source-backed text explanation for one process (audit / tests). */
export function explainProcess(e: ProcessEvaluation): string {
  return e.explanation.map((s) => `${s.kind}: ${s.label}${s.detail ? ` (${s.detail})` : ""}${s.url ? ` <${s.url}>` : ""}`).join("\n  → ");
}

export type { Condition };

/**
 * Legacy alias adapter: map document ids produced by the permit-centric rules
 * engine (e.g. DOC_LUMA_INTERCONNECTION) to the general process that owns
 * them, so existing requirement cards and the process view stay linked.
 */
export function linkLegacyDocuments(
  graph: ProcessGraph,
  documentIds: Iterable<string>,
  assessment?: ProcessAssessment
): { document_id: string; process_id: string; process_name: string; state?: ProcessState }[] {
  const out: { document_id: string; process_id: string; process_name: string; state?: ProcessState }[] = [];
  for (const doc of documentIds) {
    for (const pid of graph.legacyDocumentIndex.get(doc) ?? []) {
      const p = graph.processes.get(pid)!;
      out.push({ document_id: doc, process_id: pid, process_name: p.name, state: assessment?.processes.find((e) => e.process_id === pid)?.state });
    }
  }
  return out;
}
