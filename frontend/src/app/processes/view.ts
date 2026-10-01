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
  /** `location.*` facts of the confirmed site + their explanations (map layers). */
  location?: { facts: Record<string, unknown>; details?: Record<string, { en: string; es: string }> } | null;
  providedEvidenceIds?: Iterable<string>;
  graph?: ProcessGraph;
}): { graph: ProcessGraph; assessment: ProcessAssessment | null } {
  const graph = input.graph ?? loadEnergyProcessGraph();
  // Map-layer facts answer siting questions of an energy project; they never
  // make a non-energy request look like one.
  const stated = energyFactsFromProjectContext(input.projectContext, graph.kb, {
    municipality: input.municipality,
    answers: input.answers,
  });
  if (!hasEnergySignal(stated.facts)) return { graph, assessment: null };
  const { facts, evidence } = input.location
    ? energyFactsFromProjectContext(input.projectContext, graph.kb, { municipality: input.municipality, answers: input.answers, location: input.location })
    : stated;
  const assessment = evaluateProcesses(graph, facts, { factEvidence: evidence, providedEvidenceIds: input.providedEvidenceIds });
  if (assessment.processes.length === 0 && assessment.incentives.length === 0) return { graph, assessment: null };
  return { graph, assessment };
}
