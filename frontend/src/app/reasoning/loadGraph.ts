/** Build a ReasoningGraph from graph nodes (admin DTOs, or the bundled seed). */
import { buildSeedNodes } from "../rk/seed-data";
import type { ReasoningGraph } from "./scenarioReasoning";

interface NodeLike { nodeType: string; entityId: string; data: Record<string, unknown>; status?: string }

export function reasoningGraphFromNodes(nodes: NodeLike[]): ReasoningGraph {
  const g: ReasoningGraph = { scenarios: [], conditions: [], variants: [], mappings: [], documents: [], evidenceTypes: [], sources: [], nodeStatus: {} };
  const bucket: Record<string, keyof Omit<ReasoningGraph, "nodeStatus">> = {
    scenario: "scenarios", decision_condition: "conditions", process_variant: "variants", scenario_mapping: "mappings",
    document: "documents", evidence_type: "evidenceTypes", regulatory_source: "sources",
  };
  for (const n of nodes) {
    const b = bucket[n.nodeType];
    if (!b) continue;
    g[b].push({ ...n.data, id: n.entityId });
    if (n.status) g.nodeStatus![n.entityId] = n.status;
  }
  return g;
}

let bundled: ReasoningGraph | null = null;
/** The bundled knowledge base's reasoning graph (cached). */
export function bundledReasoningGraph(): ReasoningGraph {
  return (bundled ??= reasoningGraphFromNodes(buildSeedNodes().map((n) => ({ nodeType: n.nodeType, entityId: n.entityId, data: n.data, status: "active" }))));
}
