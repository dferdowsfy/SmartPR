import { INCENTIVE_PROGRAM_TYPES, type IncentiveProgram, type IncentiveProgramType } from "./types.ts";
import type { NodeType } from "../rk/types";

export interface IncentiveCatalogNode {
  entityId: string;
  nodeType: NodeType;
  data: Record<string, unknown>;
}

export interface CompiledIncentiveCatalog {
  programs: IncentiveProgram[];
  rejected: { entityId: string; reasons: string[] }[];
  catalogVersion: string;
}

const s = (value: unknown): string => typeof value === "string" ? value.trim() : "";
const b = (value: unknown): boolean => value === true;
const list = (value: unknown): string[] => Array.isArray(value)
  ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "")
  : [];

function record(nodes: IncentiveCatalogNode[]): Map<string, IncentiveCatalogNode> {
  return new Map(nodes.map((node) => [node.entityId, node]));
}

function labelOf(node: IncentiveCatalogNode | undefined): string {
  return node ? s(node.data.name) || s(node.data.title) || node.entityId : "";
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function shortHash(value: unknown): string {
  const text = stableStringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function isProgramType(type: NodeType): type is IncentiveProgramType {
  return (INCENTIVE_PROGRAM_TYPES as readonly string[]).includes(type);
}

export function compileIncentiveCatalog(nodes: IncentiveCatalogNode[]): CompiledIncentiveCatalog {
  const byId = record(nodes);
  const programs: IncentiveProgram[] = [];
  const rejected: CompiledIncentiveCatalog["rejected"] = [];

  for (const node of nodes.filter(
    (item): item is IncentiveCatalogNode & { nodeType: IncentiveProgramType } => isProgramType(item.nodeType)
  )) {
    const d = node.data;
    const reasons: string[] = [];
    const agency = byId.get(s(d.administering_agency_id));
    const criterionIds = list(d.criterion_ids);
    const benefitIds = list(d.benefit_ids);
    const sourceIds = list(d.authorized_by_ids);
    const criteria = criterionIds.flatMap((id) => {
      const item = byId.get(id);
      if (!item || item.nodeType !== "eligibility_criterion") return [];
      return [{
        id,
        name: s(item.data.name) || id,
        description: s(item.data.description),
        factKey: s(item.data.fact_key),
        operator: s(item.data.operator) as IncentiveProgram["criteria"][number]["operator"],
        expectedValue: item.data.expected_value as IncentiveProgram["criteria"][number]["expectedValue"],
        expectedValues: list(item.data.expected_values),
        required: item.data.required !== false,
        material: item.data.material !== false,
        question: s(item.data.question) || null,
        answerType: (s(item.data.answer_type) || null) as IncentiveProgram["criteria"][number]["answerType"],
        answerOptions: list(item.data.answer_options),
        voluntary: b(item.data.voluntary),
        legallyRelevant: b(item.data.legally_relevant),
        evidenceTypeIds: list(item.data.evidence_type_ids),
        evidenceCanSatisfy: b(item.data.evidence_can_satisfy),
        citation: s(item.data.citation),
      }];
    });
    const benefits = benefitIds.flatMap((id) => {
      const item = byId.get(id);
      if (!item || item.nodeType !== "benefit") return [];
      return [{
        id,
        name: s(item.data.name) || id,
        description: s(item.data.description),
        benefitType: s(item.data.benefit_type),
        amountDescription: s(item.data.amount_description) || null,
        citation: s(item.data.citation),
      }];
    });
    const sources = sourceIds.flatMap((id) => {
      const item = byId.get(id);
      if (!item || item.nodeType !== "regulatory_source") return [];
      return [{
        id,
        name: s(item.data.name) || id,
        sourceType: s(item.data.source_type),
        legalStatus: s(item.data.legal_status),
        jurisdiction: s(item.data.jurisdiction),
        citation: s(item.data.citation),
        url: s(item.data.url),
        effectiveDate: s(item.data.effective_date) || null,
        lastVerifiedAt: s(item.data.last_verified_at),
        sourceVersion: s(item.data.source_version),
      }];
    });

    if (!s(d.name)) reasons.push("missing program name");
    if (!agency || agency.nodeType !== "agency") reasons.push("missing administering agency");
    if (criteria.length !== criterionIds.length) reasons.push("missing published eligibility criteria");
    if (benefits.length !== benefitIds.length || benefits.length === 0) reasons.push("missing published benefit");
    if (sources.length !== sourceIds.length || sources.length === 0) reasons.push("missing authoritative graph source");
    if (sources.some((source) => !source.url || !source.citation || !source.lastVerifiedAt || !source.sourceVersion)) {
      reasons.push("source is missing URL, citation, verification date, or version");
    }
    if (sources.some((source) => !["approved", "signed", "effective", "amended"].includes(source.legalStatus))) {
      reasons.push("source is not enacted or effective");
    }
    if (!s(d.last_verified_at) || !s(d.source_version)) reasons.push("missing program verification/version metadata");
    // F06: a program with no substantive criteria is legitimate discovery
    // content — the engine caps it at potentially_eligible and flags the
    // missing criteria honestly. But a program with neither criteria nor
    // industry/geography scope is vacuous: nothing to discover or evaluate.
    const scopeIndustryIds = list(d.industry_ids);
    const scopeMunicipalityIds = list(d.municipality_ids);
    if (criteria.length === 0 && scopeIndustryIds.length === 0 && scopeMunicipalityIds.length === 0) {
      reasons.push("program has neither eligibility criteria nor industry/geography scope");
    }
    if (reasons.length) {
      rejected.push({ entityId: node.entityId, reasons: [...new Set(reasons)] });
      continue;
    }

    const evidenceIds = [...new Set([
      ...list(d.evidence_type_ids),
      ...criteria.flatMap((criterion) => criterion.evidenceTypeIds),
    ])];
    const applicationAgency = byId.get(s(d.application_agency_id));
    const windowNode = byId.get(s(d.application_window_id));
    const industryIds = scopeIndustryIds;
    const municipalityIds = scopeMunicipalityIds;

    programs.push({
      id: node.entityId,
      name: s(d.name),
      programType: node.nodeType,
      administeringAgency: { id: agency!.entityId, name: labelOf(agency) },
      applicationAgency: applicationAgency && applicationAgency.nodeType === "agency"
        ? { id: applicationAgency.entityId, name: labelOf(applicationAgency) }
        : null,
      description: s(d.description),
      benefits,
      geography: {
        level: s(d.geography_level),
        municipalityIds,
        municipalityNames: municipalityIds.map((id) => labelOf(byId.get(id)) || id),
        notes: s(d.geography_notes) || null,
      },
      applicableIndustries: {
        ids: industryIds,
        names: industryIds.map((id) => labelOf(byId.get(id)) || id),
      },
      criteria,
      evidence: evidenceIds.map((id) => ({ id, name: labelOf(byId.get(id)) || id })),
      applicationProcess: s(d.application_process) || null,
      applicationWindow: windowNode && windowNode.nodeType === "application_window" ? {
        id: windowNode.entityId,
        name: labelOf(windowNode),
        opensAt: s(windowNode.data.opens_at) || null,
        closesAt: s(windowNode.data.closes_at) || null,
        rolling: b(windowNode.data.rolling),
        description: s(windowNode.data.description),
        lastVerifiedAt: s(windowNode.data.last_verified_at),
        citation: s(windowNode.data.citation),
      } : null,
      sources,
      status: (s(d.program_status) || "proposed") as IncentiveProgram["status"],
      effectiveFrom: s(d.effective_from) || null,
      effectiveTo: s(d.effective_to) || null,
      lastVerifiedAt: s(d.last_verified_at),
      sourceVersion: s(d.source_version),
      supersedes: s(d.supersedes) || null,
      supersededBy: s(d.superseded_by) || null,
      compatibleWith: list(d.compatible_incentive_ids),
      conflictsWith: list(d.conflicting_incentive_ids),
      prerequisiteFor: list(d.prerequisite_for_incentive_ids),
      automaticEligibility: b(d.automatic_eligibility),
    });
  }

  // Include a deterministic content fingerprint so historical project
  // assessments remain distinguishable even if an editor forgets to bump the
  // human-readable source_version field.
  const versions = programs.map((program) => `${program.id}:${program.sourceVersion}:${shortHash(program)}`).sort();
  return {
    programs,
    rejected,
    catalogVersion: versions.length ? versions.join("|") : "no-published-incentives",
  };
}

/**
 * F11: program source precedence. The published knowledge graph is
 * authoritative — a graph program with the same id REPLACES the statically
 * authored entry, so corrections and retirements made in the graph take
 * effect and stale static content can neither override nor revive what the
 * graph publishes. Static entries survive only for ids the graph does not
 * define. (Rejected, i.e. invalid, graph programs are dropped by
 * compileIncentiveCatalog before this runs, so they never suppress a static
 * entry.)
 */
export function mergeProgramCatalogs(
  graphPrograms: IncentiveProgram[],
  staticPrograms: IncentiveProgram[]
): IncentiveProgram[] {
  const graphIds = new Set(graphPrograms.map((p) => p.id));
  return [...graphPrograms, ...staticPrograms.filter((s) => !graphIds.has(s.id))];
}
