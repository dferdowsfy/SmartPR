// Regulatory process graph: typed nodes + edges built from KB data.
//
// Pure: the KB is passed in, so the same code runs in Next.js and in node tests
// (same convention as rulesEngine.ts). `loadEnergyProcessGraph()` in kb.ts
// wires the shipped JSON.
//
// Edges (subject kind object):
//   Project        has_project_type            ProjectType   (computed per project by the engine)
//   ProjectType    may_require                 RegulatoryProcess
//   ProjectType    may_qualify_for             IncentiveLink
//   Process        administered_by             Agency
//   Process        requires                    Requirement
//   Requirement    satisfied_by                EvidenceType (DOC_* tag, same vocabulary as the evidence locker)
//   Requirement    derived_from                RegulatorySource
//   Process        prerequisite_for            Process      (edge points prerequisite → dependent)
//   Incentive      has_eligibility_requirement Requirement
//   Incentive      administered_by             Agency
//   Process        aliases_document            legacy KB document (keeps permit-centric rules working)

import type {
  AgencyRef,
  Condition,
  EvidenceType,
  GraphEdge,
  IncentiveLink,
  ProcessKB,
  ProjectType,
  RegulatoryProcess,
  RegulatorySource,
  Requirement,
} from "./types.ts";

export interface IncentiveCatalogEntry { id: string; name: string; description?: string; administering_agency_id?: string }

export interface ProcessGraph {
  kb: ProcessKB;
  sources: Map<string, RegulatorySource>;
  agencies: Map<string, AgencyRef>;
  processes: Map<string, RegulatoryProcess>;
  requirements: Map<string, Requirement>;
  evidence: Map<string, EvidenceType>;
  projectTypes: Map<string, ProjectType>;
  incentives: Map<string, IncentiveLink>;
  incentiveCatalog: Map<string, IncentiveCatalogEntry>;
  edges: GraphEdge[];
  /** legacy KB document id → process ids that alias it. */
  legacyDocumentIndex: Map<string, string[]>;
}

export interface BuildGraphInput {
  kb: ProcessKB;
  sources: RegulatorySource[];
  /** Shared agency registry (kb/agencies.json). Process-local agencies (kb.agencies) fill gaps. */
  agencies: AgencyRef[];
  incentiveCatalog?: IncentiveCatalogEntry[];
}

function index<T extends { id: string }>(rows: T[], label: string): Map<string, T> {
  const m = new Map<string, T>();
  for (const r of rows) {
    if (m.has(r.id)) throw new Error(`Duplicate ${label} id: ${r.id}`);
    m.set(r.id, r);
  }
  return m;
}

export function buildProcessGraph(input: BuildGraphInput): ProcessGraph {
  const { kb } = input;
  const sources = index(input.sources, "source");
  const agencies = new Map<string, AgencyRef>();
  for (const a of input.agencies) agencies.set(a.id, a);
  for (const a of kb.agencies) if (!agencies.has(a.id)) agencies.set(a.id, a);
  const processes = index(kb.processes, "process");
  const requirements = index(kb.requirements, "requirement");
  const evidence = index(kb.evidence_types, "evidence type");
  const projectTypes = index(kb.project_types, "project type");
  const incentives = index(kb.incentives, "incentive");
  const incentiveCatalog = new Map((input.incentiveCatalog ?? []).map((p) => [p.id, p]));

  const edges: GraphEdge[] = [];
  const problems: string[] = [];
  const need = (ok: boolean, msg: string) => { if (!ok) problems.push(msg); };

  for (const pt of kb.project_types) {
    for (const p of pt.may_require) { need(processes.has(p), `${pt.id} may_require unknown ${p}`); edges.push({ from: pt.id, kind: "may_require", to: p }); }
    for (const i of pt.may_qualify_for) { need(incentives.has(i), `${pt.id} may_qualify_for unknown ${i}`); edges.push({ from: pt.id, kind: "may_qualify_for", to: i }); }
  }
  const legacyDocumentIndex = new Map<string, string[]>();
  for (const p of kb.processes) {
    for (const a of p.administered_by) { need(agencies.has(a), `${p.id} administered_by unknown agency ${a}`); edges.push({ from: p.id, kind: "administered_by", to: a }); }
    for (const r of p.requirement_ids) { need(requirements.has(r), `${p.id} requires unknown ${r}`); edges.push({ from: p.id, kind: "requires", to: r }); }
    for (const pre of p.prerequisites) { need(processes.has(pre.process_id), `${p.id} prerequisite unknown ${pre.process_id}`); edges.push({ from: pre.process_id, kind: "prerequisite_for", to: p.id }); }
    for (const s of p.source_ids) need(sources.has(s), `${p.id} cites unknown source ${s}`);
    for (const rule of p.applicability) need(sources.has(rule.source_id), `${rule.id} cites unknown source ${rule.source_id}`);
    for (const x of p.exceptions ?? []) need(sources.has(x.source_id), `${x.id} cites unknown source ${x.source_id}`);
    if (p.follows_process) need(processes.has(p.follows_process), `${p.id} follows unknown ${p.follows_process}`);
    for (const d of p.legacy_document_ids ?? []) {
      edges.push({ from: p.id, kind: "aliases_document", to: d });
      legacyDocumentIndex.set(d, [...(legacyDocumentIndex.get(d) ?? []), p.id]);
    }
  }
  for (const r of kb.requirements) {
    need(sources.has(r.source_id), `${r.id} cites unknown source ${r.source_id}`);
    edges.push({ from: r.id, kind: "derived_from", to: r.source_id });
    for (const s of r.supporting_source_ids ?? []) { need(sources.has(s), `${r.id} cites unknown source ${s}`); edges.push({ from: r.id, kind: "derived_from", to: s }); }
    for (const e of r.evidence_ids) { need(evidence.has(e), `${r.id} satisfied_by unknown evidence ${e}`); edges.push({ from: r.id, kind: "satisfied_by", to: e }); }
  }
  for (const inc of kb.incentives) {
    for (const a of inc.administered_by) { need(agencies.has(a), `${inc.id} administered_by unknown agency ${a}`); edges.push({ from: inc.id, kind: "administered_by", to: a }); }
    for (const r of inc.eligibility_requirement_ids) { need(requirements.has(r), `${inc.id} unknown requirement ${r}`); edges.push({ from: inc.id, kind: "has_eligibility_requirement", to: r }); }
    for (const s of inc.source_ids) need(sources.has(s), `${inc.id} cites unknown source ${s}`);
  }
  // Every condition must read a declared (or derived) fact, so a typo in KB
  // data can never silently turn a trigger into "unknown" forever.
  const factKeys = new Set([...kb.facts.map((f) => f.key), ...(kb.derived_facts ?? []).map((d) => d.key)]);
  const checkCond = (c: Condition | undefined, where: string): void => {
    if (!c) return;
    if ("all" in c) c.all.forEach((x) => checkCond(x, where));
    else if ("any" in c) c.any.forEach((x) => checkCond(x, where));
    else if ("not" in c) checkCond(c.not, where);
    else need(factKeys.has(c.fact), `${where} reads undeclared fact ${c.fact}`);
  };
  const stageIds = new Set((kb.stages ?? []).map((st) => st.id));
  for (const d of kb.derived_facts ?? []) {
    for (const c of d.cases) { checkCond(c.when, `${d.key}/${c.id}`); need(sources.has(c.source_id), `${d.key}/${c.id} cites unknown source ${c.source_id}`); }
    for (const f of d.ask_via) need(factKeys.has(f) && f !== d.key, `${d.key} ask_via unknown fact ${f}`);
  }
  for (const pt of kb.project_types) {
    checkCond(pt.classifier, pt.id);
    checkCond(pt.signals, pt.id);
    for (const f of pt.ask ?? []) need(factKeys.has(f), `${pt.id} asks unknown fact ${f}`);
  }
  for (const p of kb.processes) {
    checkCond(p.gate, `${p.id} gate`);
    for (const f of [...(p.gate_ask ?? []), ...(p.ask ?? [])]) need(factKeys.has(f), `${p.id} asks unknown fact ${f}`);
    for (const r of p.applicability) { checkCond(r.trigger, r.id); for (const f of r.ask ?? []) need(factKeys.has(f), `${r.id} asks unknown fact ${f}`); }
    for (const x of p.exceptions ?? []) checkCond(x.when, x.id);
    for (const pre of p.prerequisites) checkCond(pre.when, `${p.id} prerequisite ${pre.process_id}`);
    if (p.stage) need(stageIds.has(p.stage), `${p.id} unknown stage ${p.stage}`);
    if (p.gate_source_id) need(sources.has(p.gate_source_id), `${p.id} gate cites unknown source ${p.gate_source_id}`);
  }
  for (const r of kb.requirements) checkCond(r.applies_when, r.id);
  for (const inc of kb.incentives) checkCond(inc.eligibility, inc.id);
  checkCond(kb.incentive_questions_when, "incentive_questions_when");
  if (problems.length) throw new Error(`Invalid regulatory process KB:\n- ${problems.join("\n- ")}`);

  return { kb, sources, agencies, processes, requirements, evidence, projectTypes, incentives, incentiveCatalog, edges, legacyDocumentIndex };
}

/**
 * Merge several KB packs (one per regulated domain, e.g. energy, telecom)
 * into one graph input. New domains are added as data packs; duplicate ids
 * across packs are rejected by buildProcessGraph's index().
 */
export function mergeProcessKBs(packs: ProcessKB[]): ProcessKB {
  if (packs.length === 1) return packs[0];
  const cat = <K extends keyof ProcessKB>(k: K) => packs.flatMap((p) => (p[k] as unknown[] | undefined) ?? []);
  const facts = new Map<string, ProcessKB["facts"][number]>();
  for (const f of cat("facts") as ProcessKB["facts"]) {
    const prev = facts.get(f.key);
    if (prev && prev.type !== f.type) throw new Error(`Fact ${f.key} declared with conflicting types across packs`);
    if (!prev) facts.set(f.key, f);
  }
  return {
    version: packs.map((p) => p.version).join("+"),
    domain: packs.map((p) => p.domain).join("+"),
    jurisdiction: packs[0].jurisdiction,
    agencies: cat("agencies") as ProcessKB["agencies"],
    facts: [...facts.values()],
    evidence_types: cat("evidence_types") as ProcessKB["evidence_types"],
    requirements: cat("requirements") as ProcessKB["requirements"],
    project_types: cat("project_types") as ProcessKB["project_types"],
    processes: cat("processes") as ProcessKB["processes"],
    incentives: cat("incentives") as ProcessKB["incentives"],
    derived_facts: cat("derived_facts") as NonNullable<ProcessKB["derived_facts"]>,
    stages: cat("stages") as NonNullable<ProcessKB["stages"]>,
    incentive_questions_when: packs.some((p) => p.incentive_questions_when)
      ? { any: packs.map((p) => p.incentive_questions_when).filter((c): c is Condition => !!c) }
      : undefined,
  };
}

export function edgesFrom(graph: ProcessGraph, from: string, kind: GraphEdge["kind"]): string[] {
  return graph.edges.filter((e) => e.from === from && e.kind === kind).map((e) => e.to);
}

/** Legacy permit-centric requirement → the general process that owns it (if any). */
export function processesForLegacyDocument(graph: ProcessGraph, documentId: string): RegulatoryProcess[] {
  return (graph.legacyDocumentIndex.get(documentId) ?? []).map((id) => graph.processes.get(id)!).filter(Boolean);
}
