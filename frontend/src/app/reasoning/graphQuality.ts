/**
 * Graph-quality checks for the scenario reasoning layer (pure).
 * Warnings only — nothing here changes what applies.
 */
import { type ReasoningGraph } from "./scenarioReasoning";

type Node = Record<string, unknown> & { id: string };
export type QualitySeverity = "error" | "warning" | "info";
export interface QualityIssue {
  code:
    | "orphan" | "variant_no_permit" | "permit_no_requirements" | "missing_citation"
    | "discovery_only_source" | "conflicting_conditions" | "duplicate_mapping"
    | "overlapping_mapping" | "expired_source" | "inactive_reference" | "missing_reference";
  severity: QualitySeverity;
  nodeId: string;
  message: string;
}

const str = (v: unknown) => (v == null ? "" : String(v));
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
const INACTIVE = new Set(["inactive", "archived", "superseded", "rolled_back"]);

export function checkGraphQuality(g: ReasoningGraph, opts: { asOf?: string } = {}): QualityIssue[] {
  const asOf = opts.asOf ?? new Date().toISOString().slice(0, 10);
  const out: QualityIssue[] = [];
  const add = (code: QualityIssue["code"], severity: QualitySeverity, nodeId: string, message: string) => out.push({ code, severity, nodeId, message });
  const all = new Map<string, Node>();
  for (const n of [...g.scenarios, ...g.conditions, ...g.variants, ...g.mappings, ...g.documents, ...g.sources]) all.set(n.id, n);
  const inactive = (n: Node | undefined) => !n || INACTIVE.has(str(g.nodeStatus?.[n.id])) || n.mapping_status === "inactive";
  const active = g.mappings.filter((m) => !inactive(m));

  // References: missing / inactive.
  for (const m of g.mappings) {
    const refs = [str(m.scenario_id), str(m.process_variant_id), ...arr(m.condition_ids), ...arr(m.source_ids)].filter(Boolean);
    for (const r of refs) {
      const n = all.get(r);
      if (!n) add("missing_reference", "error", m.id, `${m.id} references ${r}, which does not exist.`);
      else if (!inactive(m) && inactive(n)) add("inactive_reference", "error", m.id, `Active mapping ${m.id} references inactive ${r}.`);
    }
    if (!arr(m.source_ids).length || !str(m.citation_section) || /to confirm/i.test(str(m.citation_section)))
      add("missing_citation", "warning", m.id, `${m.id} has no confirmed citation section${str(m.citation_section) ? ` ("${str(m.citation_section)}")` : ""}.`);
    const srcs = arr(m.source_ids).map((s) => all.get(s)).filter(Boolean) as Node[];
    if (srcs.length && srcs.every((s) => str(s.authority_level) === "discovery_only"))
      add("discovery_only_source", "error", m.id, `${m.id} cites only discovery sources — link an authoritative regulation or statute.`);
  }

  // Orphans.
  const usedScn = new Set(g.mappings.map((m) => str(m.scenario_id)));
  const usedCond = new Set(g.mappings.flatMap((m) => arr(m.condition_ids)));
  const usedVar = new Set(g.mappings.map((m) => str(m.process_variant_id)));
  for (const s of g.scenarios) if (!usedScn.has(s.id)) add("orphan", "warning", s.id, `Scenario ${str(s.name) || s.id} has no mapping to any process variant.`);
  for (const c of g.conditions) if (!usedCond.has(c.id)) add("orphan", "info", c.id, `Condition ${str(c.name) || c.id} is not used by any mapping.`);
  for (const v of g.variants) if (!usedVar.has(v.id)) add("orphan", "warning", v.id, `Process variant ${str(v.name) || v.id} is not reachable from any scenario.`);

  // Variants → permits → requirements.
  const docs = new Map(g.documents.map((d) => [d.id, d]));
  const checkedPermits = new Set<string>();
  for (const v of g.variants) {
    const pid = str(v.permit_document_id);
    if (!pid) { add("variant_no_permit", "error", v.id, `Process variant ${str(v.name) || v.id} has no permit.`); continue; }
    const p = docs.get(pid);
    if (!p) { add("missing_reference", "error", v.id, `${v.id} points at permit ${pid}, which does not exist.`); continue; }
    if (checkedPermits.has(pid)) continue;
    checkedPermits.add(pid);
    if (!arr(p.depends_on_document_ids).length && !arr(p.evidence_type_ids).length)
      add("permit_no_requirements", "warning", pid, `Permit ${str(p.name) || pid} has no requirements or evidence linked.`);
  }

  // Conflicting conditions within one mapping (same fact, incompatible tests).
  const conds = new Map(g.conditions.map((c) => [c.id, c]));
  const sig = (c: Node) => `${str(c.fact)}|${str(c.operator)}|${JSON.stringify(c.value ?? null)}`;
  const polarity = (c: Node): string | null => {
    const op = str(c.operator);
    if (op === "truthy" || (op === "equals" && c.value === true)) return "T";
    if (op === "falsy" || (op === "equals" && c.value === false)) return "F";
    if (op === "equals") return `=${JSON.stringify(c.value)}`;
    return null;
  };
  for (const m of g.mappings) {
    const byFact = new Map<string, Set<string>>();
    for (const cid of arr(m.condition_ids)) {
      const c = conds.get(cid); if (!c) continue;
      const p = polarity(c); if (!p) continue;
      const s = byFact.get(str(c.fact)) ?? new Set(); s.add(p); byFact.set(str(c.fact), s);
    }
    for (const [fact, ps] of byFact) if (ps.size > 1) add("conflicting_conditions", "error", m.id, `${m.id} requires contradictory values for "${fact}" — it can never apply.`);
  }

  // Duplicate / overlapping mappings.
  const condKey = (m: Node) => arr(m.condition_ids).map((id) => (conds.get(id) ? sig(conds.get(id)!) : id)).sort();
  for (let i = 0; i < active.length; i++) for (let j = i + 1; j < active.length; j++) {
    const a = active[i], b = active[j];
    if (str(a.scenario_id) !== str(b.scenario_id)) continue;
    const ka = condKey(a), kb = condKey(b);
    const same = ka.length === kb.length && ka.every((x, k) => x === kb[k]);
    if (same && str(a.process_variant_id) === str(b.process_variant_id)) { add("duplicate_mapping", "warning", b.id, `${b.id} duplicates ${a.id}.`); continue; }
    const subset = (x: string[], y: string[]) => x.every((k) => y.includes(k));
    if (!(subset(ka, kb) || subset(kb, ka))) continue;
    const va = g.variants.find((v) => v.id === str(a.process_variant_id));
    const vb = g.variants.find((v) => v.id === str(b.process_variant_id));
    if (va && vb && str(va.process_family) && str(va.process_family) === str(vb.process_family) && va.id !== vb.id)
      add("overlapping_mapping", "warning", b.id, `${a.id} and ${b.id} can both fire for the same facts but pick different ${str(va.process_family)} variants (${str(va.code)} vs ${str(vb.code)}).`);
  }

  // Expired / superseded sources used by active mappings.
  const usedSrc = new Set(active.flatMap((m) => arr(m.source_ids)));
  for (const s of g.sources) {
    if (!usedSrc.has(s.id)) continue;
    const to = str(s.effective_to || s.expires_at);
    if (str(s.legal_status) === "superseded" || str(s.legal_status) === "repealed" || inactive(s) || (to && to < asOf))
      add("expired_source", "error", s.id, `Source ${str(s.name) || s.id} is expired or superseded but cited by active mappings.`);
  }
  return out;
}
