// Ordered process sequence for sequential regimes (e.g. utility-scale:
// site → offtake → certification → studies → agreements → construction →
// commissioning/COD). Stages come from KB data (`stages` + process `stage`);
// processes without a stage (e.g. customer-side DG) are never sequenced, so
// the DG view is unchanged.
import type { ProcessAssessment, ProcessEvaluation } from "./engine.ts";
import type { ProcessState } from "./types.ts";

export interface SequenceProcess {
  process_id: string;
  name: string;
  state: ProcessState;
  /** Names of in-play prerequisites (conditional ones are flagged). */
  waits_on: { name: string; conditional: boolean; blocking: boolean }[];
  needs_expert_validation: boolean;
}

export interface SequenceStep {
  step: number;
  stage_id: string;
  name: string;
  name_es?: string;
  processes: SequenceProcess[];
}

const IN_SEQUENCE: ProcessState[] = ["REQUIRED", "POTENTIALLY_REQUIRED", "NEEDS_FACT"];

export function needsExpertValidation(p: ProcessEvaluation): boolean {
  return p.citation?.status === "needs_expert_validation" || p.requirements.some((r) => r.citation.status === "needs_expert_validation");
}

/** Null unless at least two applicable (required / potentially required) processes carry a stage. */
export function processSequence(assessment: ProcessAssessment | null | undefined): SequenceStep[] | null {
  if (!assessment) return null;
  const staged = assessment.processes.filter((p) => p.stage && IN_SEQUENCE.includes(p.state));
  if (staged.filter((p) => p.state !== "NEEDS_FACT").length < 2) return null;
  const byStage = new Map<string, { stage: NonNullable<ProcessEvaluation["stage"]>; items: ProcessEvaluation[] }>();
  for (const p of staged) {
    const cur = byStage.get(p.stage!.id) ?? { stage: p.stage!, items: [] };
    cur.items.push(p);
    byStage.set(p.stage!.id, cur);
  }
  return [...byStage.values()]
    .sort((a, b) => a.stage.order - b.stage.order)
    .map((g, i) => ({
      step: i + 1,
      stage_id: g.stage.id,
      name: g.stage.name,
      name_es: g.stage.name_es,
      // Within a stage, a process that another one waits on is listed first.
      processes: [...g.items].sort((x, y) => inStagePrereqs(x, g.items) - inStagePrereqs(y, g.items)).map((p) => ({
        process_id: p.process_id,
        name: p.name,
        state: p.state,
        waits_on: p.prerequisites.map((x) => ({ name: x.name, conditional: x.conditional, blocking: x.blocking })),
        needs_expert_validation: needsExpertValidation(p),
      })),
    }));
}

function inStagePrereqs(p: ProcessEvaluation, items: ProcessEvaluation[]): number {
  return p.prerequisites.filter((x) => items.some((i) => i.process_id === x.process_id)).length;
}

/** Step number of each sequenced process (for card badges). */
export function stepIndex(steps: SequenceStep[] | null): Map<string, SequenceStep> {
  const m = new Map<string, SequenceStep>();
  for (const s of steps ?? []) for (const p of s.processes) m.set(p.process_id, s);
  return m;
}
