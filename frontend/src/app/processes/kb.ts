// Loads the shipped regulatory-process KB into a ProcessGraph.
import processesJson from "../../kb/regulatory_processes.json";
import sourcesJson from "../../kb/regulatory_sources.json";
import agenciesJson from "../../kb/agencies.json";
import incentiveProgramsJson from "../../kb/incentive_programs.json";
import { buildProcessGraph, type ProcessGraph } from "./graph.ts";
import type { AgencyRef, ProcessKB, RegulatorySource } from "./types.ts";

let cached: ProcessGraph | null = null;

export function loadEnergyProcessGraph(): ProcessGraph {
  if (cached) return cached;
  cached = buildProcessGraph({
    kb: processesJson as unknown as ProcessKB,
    sources: sourcesJson as unknown as RegulatorySource[],
    agencies: agenciesJson as unknown as AgencyRef[],
    incentiveCatalog: incentiveProgramsJson as unknown as { id: string; name: string; description?: string }[],
  });
  return cached;
}
