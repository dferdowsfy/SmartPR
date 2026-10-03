/**
 * Scenario-based permit reasoning (pure, client-safe).
 *
 *   Project → Scenario → Decision Conditions → Process Variant → Permit → Requirements → Evidence
 *
 * The knowledge graph decides WHAT applies:
 *  - Scenario nodes say what the person is trying to do (detected from intake facts).
 *  - Scenario Mapping nodes say: for this scenario, when ALL these conditions
 *    hold, this Process Variant applies — with source, version, effective
 *    date, last-verified date and an active/inactive flag.
 *  - Process Variants point at the EXISTING permit (document) node, which keeps
 *    owning its requirements (prerequisite documents) and evidence. Nothing
 *    here copies requirements.
 * Several scenarios and paths can apply at once (e.g. start a business AND
 * remodel → Permiso Único and PCOC). An unknown fact never counts as met:
 * the path is reported as "needs facts" with what's missing.
 *
 * Clara stays downstream: it executes HOW to file what this returns.
 */

export type Facts = Record<string, unknown>;
export type ConditionOperator = "equals" | "not_equals" | "truthy" | "falsy" | "in" | "includes";

export interface Clause {
  fact: string;
  operator: ConditionOperator;
  value?: unknown;
}

type Node = Record<string, unknown> & { id: string };

export interface ReasoningGraph {
  scenarios: Node[];
  conditions: Node[];
  variants: Node[];
  mappings: Node[];
  /** Existing permit / requirement documents (KB documents). */
  documents: Node[];
  evidenceTypes: Node[];
  sources: Node[];
  /** Graph node status by entity id (active / archived / superseded …), when known. */
  nodeStatus?: Record<string, string>;
}

export type ConditionState = "met" | "unmet" | "unknown";

export interface ReasoningPath {
  mappingId: string;
  mappingName: string;
  scenario: { id: string; code: string; name: string };
  conditions: { id: string; name: string; fact: string; state: ConditionState; actual: unknown }[];
  status: "applies" | "not_applicable" | "needs_facts";
  variant: { id: string; code: string; name: string } | null;
  permit: { id: string; name: string; agency: string } | null;
  requirements: { id: string; name: string; agency: string }[];
  evidence: { id: string; name: string }[];
  sources: { id: string; name: string; citation: string; url: string; authority: string }[];
  provenance: { citationSection: string; effectiveDate: string; version: string; lastVerifiedAt: string };
  missingFacts: string[];
  /** Plain-language "why does this apply" (or why not). */
  why: string[];
}

export interface ReasoningResult {
  scenarios: { id: string; code: string; name: string; detectedBy: string[] }[];
  paths: ReasoningPath[];
  /** Process variants that apply, deduped across scenarios (simultaneous branches). */
  applicableVariants: { id: string; name: string; permitId: string | null; viaScenarios: string[] }[];
  /** Permits (existing document ids) that apply. */
  applicablePermits: string[];
}

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

const truthy = (v: unknown) => v === true || v === "true" || v === "yes" || v === "Yes" || (typeof v === "number" && v > 0) || (Array.isArray(v) && v.length > 0);
const falsy = (v: unknown) => v === false || v === "false" || v === "no" || v === "No" || v === 0;

/** true / false, or null when the fact isn't known. */
export function evaluateClause(c: Clause, facts: Facts): boolean | null {
  const actual = facts[c.fact];
  const unknown = actual === undefined || actual === null || actual === "";
  switch (c.operator) {
    case "truthy":
      return unknown ? null : truthy(actual);
    case "falsy":
      return unknown ? null : falsy(actual) || !truthy(actual);
    case "equals":
      if (unknown) return null;
      if (typeof c.value === "boolean") return c.value ? truthy(actual) : falsy(actual);
      return str(actual).toLowerCase() === str(c.value).toLowerCase();
    case "not_equals":
      if (unknown) return null;
      if (typeof c.value === "boolean") return c.value ? !truthy(actual) : !falsy(actual);
      return str(actual).toLowerCase() !== str(c.value).toLowerCase();
    case "in":
      if (unknown) return null;
      return arr(c.value).map((x) => x.toLowerCase()).includes(str(actual).toLowerCase());
    case "includes":
      if (unknown) return null;
      return Array.isArray(actual) ? actual.map((x) => str(x).toLowerCase()).includes(str(c.value).toLowerCase()) : str(actual).toLowerCase().includes(str(c.value).toLowerCase());
    default:
      return null;
  }
}

export function describeClause(c: Clause): string {
  const name = c.fact.replace(/_/g, " ");
  if (c.operator === "truthy") return `${name} = Yes`;
  if (c.operator === "falsy") return `${name} = No`;
  const v = typeof c.value === "boolean" ? (c.value ? "Yes" : "No") : Array.isArray(c.value) ? c.value.join(" / ") : str(c.value);
  if (c.operator === "not_equals") return `${name} ≠ ${v}`;
  if (c.operator === "in") return `${name} is one of ${v}`;
  if (c.operator === "includes") return `${name} includes ${v}`;
  return `${name} = ${v}`;
}

const INACTIVE = new Set(["archived", "superseded", "rolled_back", "inactive"]);

function isActive(graph: ReasoningGraph, n: Node | undefined): boolean {
  if (!n) return false;
  const st = graph.nodeStatus?.[n.id];
  if (st && INACTIVE.has(st)) return false;
  if (n.mapping_status === "inactive" || n.status === "inactive") return false;
  return true;
}

function inForce(n: Node, asOf: string): boolean {
  const from = str(n.effective_date);
  const to = str(n.effective_to);
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from) && from > asOf) return false;
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to) && to <= asOf) return false;
  return true;
}

/** Detect scenarios: explicit `facts.scenarios` codes, or a scenario's detect_when clauses (any-of). */
export function detectScenarios(graph: ReasoningGraph, facts: Facts): ReasoningResult["scenarios"] {
  const explicit = new Set(arr(facts.scenarios).map((x) => x.toUpperCase()));
  const out: ReasoningResult["scenarios"] = [];
  for (const s of graph.scenarios) {
    if (!isActive(graph, s)) continue;
    const code = str(s.code) || s.id;
    const by: string[] = [];
    if (explicit.has(code.toUpperCase()) || explicit.has(s.id.toUpperCase())) by.push("chosen scenario");
    for (const c of (Array.isArray(s.detect_when) ? s.detect_when : []) as Clause[]) {
      if (c && typeof c === "object" && evaluateClause(c, facts) === true) by.push(describeClause(c));
    }
    if (by.length) out.push({ id: s.id, code, name: str(s.name) || code, detectedBy: by });
  }
  return out;
}

/** The permit's requirements = its prerequisite documents (depends_on closure), in discovery order. */
function requirementsOf(graph: ReasoningGraph, permitId: string): Node[] {
  const byId = new Map(graph.documents.map((d) => [d.id, d]));
  const seen = new Set([permitId]);
  const queue = arr(byId.get(permitId)?.depends_on_document_ids);
  const out: Node[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const d = byId.get(id);
    if (!d) continue;
    out.push(d);
    queue.push(...arr(d.depends_on_document_ids));
  }
  return out;
}

export function reason(graph: ReasoningGraph, facts: Facts, opts: { asOf?: string } = {}): ReasoningResult {
  const asOf = opts.asOf ?? new Date().toISOString().slice(0, 10);
  const scenarios = detectScenarios(graph, facts);
  const detected = new Map(scenarios.map((s) => [s.id, s]));
  const conds = new Map(graph.conditions.map((c) => [c.id, c]));
  const variants = new Map(graph.variants.map((v) => [v.id, v]));
  const docs = new Map(graph.documents.map((d) => [d.id, d]));
  const evidence = new Map(graph.evidenceTypes.map((e) => [e.id, e]));
  const sources = new Map(graph.sources.map((s) => [s.id, s]));
  const paths: ReasoningPath[] = [];

  for (const m of graph.mappings) {
    if (!isActive(graph, m) || !inForce(m, asOf)) continue;
    const scn = detected.get(str(m.scenario_id));
    if (!scn) continue;
    const conditions = arr(m.condition_ids).map((cid) => {
      const c = conds.get(cid);
      if (!c || !isActive(graph, c)) return { id: cid, name: c ? str(c.name) : cid, fact: c ? str(c.fact) : "", state: "unknown" as ConditionState, actual: undefined };
      const r = evaluateClause({ fact: str(c.fact), operator: str(c.operator) as ConditionOperator, value: c.value }, facts);
      return { id: cid, name: str(c.name) || describeClause({ fact: str(c.fact), operator: str(c.operator) as ConditionOperator, value: c.value }), fact: str(c.fact), state: (r === null ? "unknown" : r ? "met" : "unmet") as ConditionState, actual: facts[str(c.fact)] };
    });
    const v = variants.get(str(m.process_variant_id));
    const variantOk = Boolean(v && isActive(graph, v));
    const status: ReasoningPath["status"] = !variantOk || conditions.some((c) => c.state === "unmet") ? "not_applicable" : conditions.some((c) => c.state === "unknown") ? "needs_facts" : "applies";
    const permitId = v ? str(v.permit_document_id) : "";
    const permit = permitId ? docs.get(permitId) : undefined;
    const reqs = permit ? requirementsOf(graph, permit.id) : [];
    const evIds = [...new Set([permit, ...reqs].flatMap((d) => arr(d?.evidence_type_ids)))];
    const srcIds = [...new Set([...arr(m.source_ids), ...(v ? arr(v.source_ids) : [])])];
    const srcList = srcIds.map((id) => {
      const s = sources.get(id);
      return { id, name: s ? str(s.name || s.title) : id, citation: s ? str(s.citation) : "", url: s ? str(s.url) : "", authority: s ? str(s.authority_level) || "authoritative" : "unknown" };
    });
    const authoritative = srcList.filter((s) => s.authority !== "discovery_only");
    const why: string[] = [];
    if (status === "applies") {
      why.push(`${v ? str(v.name) : "This process"} applies because:`);
      why.push(`Scenario = ${scn.name}`);
      for (const c of conditions) why.push(c.name);
      for (const s of authoritative) why.push(`Source = ${s.name}${str(m.citation_section) ? ` — ${str(m.citation_section)}` : ""}`);
      if (!authoritative.length) why.push("Source = none authoritative yet (needs a regulation/statute citation)");
    } else if (status === "needs_facts") {
      why.push(`${v ? str(v.name) : "This process"} may apply for "${scn.name}" — SmartPR still needs: ${conditions.filter((c) => c.state === "unknown").map((c) => c.fact.replace(/_/g, " ")).join(", ")}.`);
    } else {
      const unmet = conditions.filter((c) => c.state === "unmet");
      why.push(!variantOk ? "The process variant is inactive or missing." : `Does not apply: ${unmet.map((c) => c.name).join(", ")} is not the case.`);
    }
    paths.push({
      mappingId: m.id,
      mappingName: str(m.name) || m.id,
      scenario: { id: scn.id, code: scn.code, name: scn.name },
      conditions,
      status,
      variant: v ? { id: v.id, code: str(v.code), name: str(v.name) } : null,
      permit: permit ? { id: permit.id, name: str(permit.name), agency: str(permit.agency) } : null,
      requirements: reqs.map((d) => ({ id: d.id, name: str(d.name), agency: str(d.agency) })),
      evidence: evIds.map((id) => ({ id, name: str(evidence.get(id)?.name) || id })),
      sources: srcList,
      provenance: { citationSection: str(m.citation_section), effectiveDate: str(m.effective_date), version: str(m.version), lastVerifiedAt: str(m.last_verified_at) },
      missingFacts: [...new Set(conditions.filter((c) => c.state === "unknown").map((c) => c.fact))],
      why,
    });
  }

  const applicable = new Map<string, { id: string; name: string; permitId: string | null; viaScenarios: string[] }>();
  for (const p of paths) {
    if (p.status !== "applies" || !p.variant) continue;
    const cur = applicable.get(p.variant.id) ?? { id: p.variant.id, name: p.variant.name, permitId: p.permit?.id ?? null, viaScenarios: [] };
    if (!cur.viaScenarios.includes(p.scenario.name)) cur.viaScenarios.push(p.scenario.name);
    applicable.set(p.variant.id, cur);
  }
  const variantsOut = [...applicable.values()];
  return {
    scenarios,
    paths,
    applicableVariants: variantsOut,
    applicablePermits: [...new Set(variantsOut.map((v) => v.permitId).filter((x): x is string => Boolean(x)))],
  };
}

/** Run a mapping's stored test cases ({ name, facts, expect: applies? }). */
export function runMappingTests(graph: ReasoningGraph, mappingId: string, opts: { asOf?: string } = {}) {
  const m = graph.mappings.find((x) => x.id === mappingId);
  const cases = (Array.isArray(m?.test_cases) ? m!.test_cases : []) as { name?: string; facts?: Facts; expect?: boolean }[];
  return cases.map((tc) => {
    const p = reason(graph, tc.facts ?? {}, opts).paths.find((x) => x.mappingId === mappingId);
    const applied = p?.status === "applies";
    return { name: tc.name ?? "", facts: tc.facts ?? {}, expect: tc.expect !== false, applied, pass: applied === (tc.expect !== false) };
  });
}
