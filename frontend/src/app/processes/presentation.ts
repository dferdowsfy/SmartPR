// Checklist presentation of a process assessment: the default view a
// developer can scan in 30 seconds. Pure and data-driven (KB short names,
// short questions, display labels); nothing here changes what applies —
// the full assessment (facts, triggers, rule ids, quotes) stays available
// behind "Show full reasoning".
import type { ClarifyingQuestion, IncentiveEvaluation, ProcessAssessment, ProcessEvaluation } from "./engine.ts";
import type { ProcessGraph } from "./graph.ts";
import type { Confidence, SourceStatus } from "./types.ts";
import { needsExpertValidation, processSequence } from "./sequence.ts";
import type { LegacySupersession } from "./legacyCards.ts";

export type Lang = "en" | "es";
export type ChecklistStatus = "required" | "question" | "may_apply" | "expert" | "optional" | "done";

export const CHECKLIST_STATUS_LABELS: Record<ChecklistStatus, { en: string; es: string }> = {
  required: { en: "Required", es: "Requerido" },
  question: { en: "Answer a question", es: "Responde una pregunta" },
  may_apply: { en: "May apply", es: "Puede aplicar" },
  expert: { en: "Needs expert check", es: "Requiere revisión experta" },
  optional: { en: "Optional", es: "Opcional" },
  done: { en: "Done", es: "Listo" },
};

export interface ChecklistSource { title: string; url: string; confidence: Confidence; status: SourceStatus; locator?: string }

export interface ChecklistItem {
  id: string;
  name: string;
  /** Short agency name(s): "LUMA", "PREB", "OGPe / Municipality". */
  agency: string;
  status: ChecklistStatus;
  /** One plain sentence: why this applies (or what decides it). */
  why: string;
  /** One plain sentence: what the process is. */
  what?: string;
  needs: string[];
  agency_steps: string[];
  before: string[];
  source: ChecklistSource | null;
  expert: boolean;
  /** Facts that would decide it (NEEDS_FACT). */
  question_facts: string[];
  process_id: string;
}

export interface ChecklistStage { id: string; step: number | null; name: string | null; items: ChecklistItem[] }

export interface ChecklistQuestion {
  fact: string;
  text: string;
  why: string;
  type: ClarifyingQuestion["type"];
  options?: { value: string; label: string }[];
}

export interface ProcessChecklist {
  summary: string;
  stages: ChecklistStage[];
  item_count: number;
  questions: ChecklistQuestion[];
  /** Checked and not applicable (processes and suppressed legacy cards), with the reason. */
  not_applicable: { name: string; reason: string; source: ChecklistSource | null }[];
  readiness: ProcessAssessment["readiness"];
}

const t = (v: { en: string; es: string } | undefined, lang: Lang) => (v ? v[lang] ?? v.en : undefined);

/** Plain names: drop inline section / form citations ("(NEPR-B03)", "(§ 9.4)"). */
export function plainName(s: string): string {
  return s.replace(/\s*\((?:[^()]*?(?:§|Art\.|NEPR-[A-Z]|DOC_|Reg\.\s*\d)[^()]*)\)/g, "").trim();
}

export function shortAgency(a: { name: string; short_name?: string }): string {
  return a.short_name ?? a.name;
}

function processName(p: ProcessEvaluation, lang: Lang): string {
  return (lang === "es" ? p.short_name_es ?? p.short_name : p.short_name) ?? p.name;
}

function statusOf(p: ProcessEvaluation): ChecklistStatus {
  if (p.voluntary) return "optional";
  if (p.state === "REQUIRED") return p.readiness && p.readiness.total > 0 && p.readiness.satisfied === p.readiness.total ? "done" : "required";
  if (p.state === "NEEDS_FACT") return "question";
  return needsExpertValidation(p) ? "expert" : "may_apply";
}

function sourceOf(p: ProcessEvaluation): ChecklistSource | null {
  const c = p.citation ?? p.requirements[0]?.citation;
  return c ? { title: c.title, url: c.url, confidence: c.confidence, status: c.status, locator: c.locator } : null;
}

export function shortQuestion(graph: ProcessGraph, fact: string, lang: Lang): string {
  const def = graph.kb.facts.find((f) => f.key === fact);
  const d = graph.kb.derived_facts?.find((x) => x.key === fact);
  return t(def?.short_question, lang) ?? def?.question ?? d?.label ?? fact.replace(/_/g, " ");
}

function checklistItem(p: ProcessEvaluation, graph: ProcessGraph, all: Map<string, ProcessEvaluation>, lang: Lang): ChecklistItem {
  const es = lang === "es";
  const status = statusOf(p);
  const what = (es ? p.summary_es ?? p.summary : p.summary) ?? undefined;
  let why: string;
  if (p.state === "NEEDS_FACT") {
    const qs = p.missing_facts.map((f) => shortQuestion(graph, f, lang));
    why = qs.length ? `${es ? "Depende de" : "Depends on"}: ${qs.join(" · ")}` : what ?? p.reason;
  } else {
    // The deciding rule's trigger summary is the plain "why" (EN); ES shows the KB summary.
    why = (es ? what : p.reason) || what || p.reason || (es ? "Aplica según los datos del proyecto." : "Applies based on the project facts.");
  }
  const agencies = [...new Set(p.agencies.map(shortAgency))];
  return {
    id: p.process_id,
    process_id: p.process_id,
    name: processName(p, lang),
    agency: agencies.join(" / "),
    status,
    why,
    what,
    needs: [...new Set(p.requirements.filter((r) => r.kind !== "agency_step").map((r) => plainName(r.name)))],
    agency_steps: [...new Set(p.requirements.filter((r) => r.kind === "agency_step").map((r) => plainName(r.name)))],
    before: p.prerequisites.map((x) => {
      const pe = all.get(x.process_id);
      const n = pe ? processName(pe, lang) : x.name;
      return x.conditional ? `${n} ${es ? "(si aplica)" : "(if applicable)"}` : n;
    }),
    source: sourceOf(p),
    expert: needsExpertValidation(p),
    question_facts: p.state === "NEEDS_FACT" ? p.missing_facts : [],
  };
}

function fmtNumber(n: number, lang: Lang): string {
  return n.toLocaleString(lang === "es" ? "es-PR" : "en-US", { maximumFractionDigits: 1 });
}

/** "Utility-scale solar + battery, 15 MW / 30 MWh, Guayama, selling to LUMA" (no counts). */
export function projectSummaryLine(assessment: ProcessAssessment, graph: ProcessGraph, lang: Lang): string {
  const f = assessment.facts;
  const d = graph.kb.display ?? {};
  const segment = typeof f.energy_market_segment === "string" ? t(d.segment_labels?.[f.energy_market_segment], lang) : undefined;
  let techKey = typeof f.generation_technology === "string" ? f.generation_technology : undefined;
  if (techKey === "solar" && f.battery_storage === true) techKey = "hybrid";
  if (!techKey && f.battery_storage === true) techKey = "storage";
  const tech = techKey ? t(d.technology_labels?.[techKey], lang) : undefined;
  const head = [segment, tech ?? (lang === "es" ? "proyecto de energía" : "energy project")].filter(Boolean).join(" ");
  const parts: string[] = [head.charAt(0).toUpperCase() + head.slice(1)];
  const size: string[] = [];
  if (typeof f.generation_capacity_kw === "number") size.push(f.generation_capacity_kw >= 1000 ? `${fmtNumber(f.generation_capacity_kw / 1000, lang)} MW` : `${fmtNumber(f.generation_capacity_kw, lang)} kW`);
  if (typeof f.storage_energy_mwh === "number") size.push(`${fmtNumber(f.storage_energy_mwh, lang)} MWh`);
  else if (typeof f.storage_capacity_kw === "number") size.push(`${fmtNumber(f.storage_capacity_kw, lang)} kW ${lang === "es" ? "de baterías" : "storage"}`);
  if (size.length) parts.push(size.join(" / "));
  if (typeof f.municipality === "string" && f.municipality) parts.push(f.municipality);
  const off = typeof f.power_offtaker === "string" ? t(d.offtaker_labels?.[f.power_offtaker], lang) : undefined;
  if (off) parts.push(off);
  return parts.join(", ");
}

export function countsLine(steps: number, questions: number, lang: Lang): string {
  const es = lang === "es";
  const s = es ? `${steps} ${steps === 1 ? "paso" : "pasos"}` : `${steps} ${steps === 1 ? "step" : "steps"}`;
  const q = questions === 0 ? "" : es ? `, ${questions} ${questions === 1 ? "pregunta" : "preguntas"} por responder` : `, ${questions} ${questions === 1 ? "question" : "questions"} to answer`;
  return `${s}${q}.`;
}

export function checklistQuestion(q: ClarifyingQuestion, lang: Lang): ChecklistQuestion {
  return {
    fact: q.fact,
    text: t(q.short_question, lang) ?? q.question,
    why: q.why,
    type: q.type,
    options: q.options?.map((o) => ({ value: o, label: t(q.short_option_labels?.[o], lang) ?? q.option_labels?.[o] ?? o })),
  };
}

const ACTIVE = new Set(["REQUIRED", "POTENTIALLY_REQUIRED", "NEEDS_FACT"]);

export function processChecklist(
  assessment: ProcessAssessment,
  graph: ProcessGraph,
  lang: Lang,
  opts: { suppressedLegacy?: LegacySupersession[]; legacyNames?: Record<string, string>; maxQuestions?: number } = {}
): ProcessChecklist {
  const es = lang === "es";
  const all = new Map(assessment.processes.map((p) => [p.process_id, p]));
  const active = assessment.processes.filter((p) => ACTIVE.has(p.state));
  const item = (p: ProcessEvaluation) => checklistItem(p, graph, all, lang);
  const seq = processSequence(assessment);
  let stages: ChecklistStage[];
  if (seq) {
    stages = seq.map((s) => ({ id: s.stage_id, step: s.step, name: es ? s.name_es ?? s.name : s.name, items: s.processes.map((sp) => item(all.get(sp.process_id)!)) }));
    const placed = new Set(seq.flatMap((s) => s.processes.map((p) => p.process_id)));
    const rest = active.filter((p) => !placed.has(p.process_id));
    if (rest.length) stages.push({ id: "other", step: stages.length + 1, name: es ? "Otros pasos" : "Other steps", items: rest.map(item) });
  } else {
    stages = active.length ? [{ id: "all", step: null, name: null, items: active.map(item) }] : [];
  }
  const questions = assessment.questions.slice(0, opts.maxQuestions ?? 3).map((q) => checklistQuestion(q, lang));
  const item_count = stages.reduce((n, s) => n + s.items.length, 0);
  const not_applicable = [
    ...assessment.processes.filter((p) => p.state === "NOT_REQUIRED").map((p) => ({ name: processName(p, lang), reason: p.reason, source: sourceOf(p) })),
    ...(opts.suppressedLegacy ?? []).filter((s) => s.suppressed).map((s) => ({
      name: opts.legacyNames?.[s.document_id] ?? s.document_id,
      reason: (es ? s.suppressed!.reason_es : undefined) ?? s.suppressed!.reason,
      source: { title: s.suppressed!.citation.title, url: s.suppressed!.citation.url, confidence: s.suppressed!.citation.confidence, status: s.suppressed!.citation.status, locator: s.suppressed!.citation.locator },
    })),
  ];
  return {
    summary: `${projectSummaryLine(assessment, graph, lang)}. ${countsLine(item_count, questions.length, lang)}`,
    stages,
    item_count,
    questions,
    not_applicable,
    readiness: assessment.readiness,
  };
}

/**
 * One incentives list for the page: the incentive engine's opportunities
 * first, then process-graph incentives whose program is not already listed
 * (matched by KB `program_id`), so Act 60 never appears twice.
 */
export function unifiedIncentives<O extends { programId: string }>(opportunities: readonly O[], energy: readonly IncentiveEvaluation[]): { opportunities: O[]; extra: IncentiveEvaluation[] } {
  const listed = new Set(opportunities.map((o) => o.programId));
  const extra = energy.filter((i) => i.state !== "NOT_ELIGIBLE" && !(i.program_id && listed.has(i.program_id)));
  return { opportunities: [...opportunities], extra };
}
