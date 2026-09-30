// UI entry point: project context (+ discovery answers) → process assessment.
import type { ProjectContext } from "../ai/intake/projectContext.ts";
import { evaluateProcesses, type ProcessAssessment } from "./engine.ts";
import { energyFactsFromProjectContext, hasEnergySignal } from "./energyFacts.ts";
import { loadEnergyProcessGraph } from "./kb.ts";
import type { ProcessGraph } from "./graph.ts";

export function computeEnergyAssessment(input: {
  projectContext: ProjectContext | null | undefined;
  municipality?: string | null;
  answers?: Record<string, unknown> | null;
  providedEvidenceIds?: Iterable<string>;
  graph?: ProcessGraph;
}): { graph: ProcessGraph; assessment: ProcessAssessment | null } {
  const graph = input.graph ?? loadEnergyProcessGraph();
  const { facts, evidence } = energyFactsFromProjectContext(input.projectContext, graph.kb, {
    municipality: input.municipality,
    answers: input.answers,
  });
  if (!hasEnergySignal(facts)) return { graph, assessment: null };
  const assessment = evaluateProcesses(graph, facts, { factEvidence: evidence, providedEvidenceIds: input.providedEvidenceIds });
  if (assessment.processes.length === 0 && assessment.incentives.length === 0) return { graph, assessment: null };
  return { graph, assessment };
}
