// ============================================================================
// Knowledge Graph Reasoning Paths — public barrel.
// See docs/reasoning-paths-design.md.
//
// Re-exports the frozen contract (types.ts), the evaluator (§4), and the
// validator (§5). loadReasoningGraph returns the seeded graph (seed.ts,
// authored separately per design §6).
//
// NOTE on module cycles: evaluator.ts and validate.ts import loadReasoningGraph
// from this barrel so test harnesses can redirect the graph with a single
// import swap here. The binding is only dereferenced inside function bodies at
// call time — never at module scope — so the cycle is safe.
// ============================================================================

export * from "./types";

export { evaluateReasoningPaths } from "./evaluator";
export { validateReasoningGraph } from "./validate";

import { REASONING_GRAPH } from "./seed";
import type { ReasoningGraph } from "./types";

/** Returns the seeded reasoning graph (conditions, scenarios, variants). */
export function loadReasoningGraph(): ReasoningGraph {
  return REASONING_GRAPH;
}
