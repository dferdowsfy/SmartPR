// Loads the shipped regulatory-process KB packs into one ProcessGraph.
// A new regulated domain (telecom, environmental, healthcare, utilities…) is
// added as another JSON pack in PROCESS_PACKS plus its sources — no engine code.
import processesJson from "../../kb/regulatory_processes.json";
import sourcesJson from "../../kb/regulatory_sources.json";
import agenciesJson from "../../kb/agencies.json";
import incentiveProgramsJson from "../../kb/incentive_programs.json";
import { buildProcessGraph, mergeProcessKBs, type ProcessGraph } from "./graph.ts";
import type { AgencyRef, ProcessKB, RegulatorySource } from "./types.ts";

export const PROCESS_PACKS: ProcessKB[] = [processesJson as unknown as ProcessKB];

let cached: ProcessGraph | null = null;

export function loadEnergyProcessGraph(): ProcessGraph {
  if (cached) return cached;
  cached = buildProcessGraph({
    kb: mergeProcessKBs(PROCESS_PACKS),
    sources: sourcesJson as unknown as RegulatorySource[],
    agencies: agenciesJson as unknown as AgencyRef[],
    incentiveCatalog: incentiveProgramsJson as unknown as { id: string; name: string; description?: string }[],
  });
  return cached;
}
