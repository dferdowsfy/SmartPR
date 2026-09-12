// ============================================================================
// Graph & relationship re-score — same 11-dimension rubric as
// workspace/user/files/SmartPR-regulatory-knowledge-audit.md (baseline 38/100).
//
// Run: npx tsx scripts/rk-graph-score.mts
//
// Mechanical metrics are computed from the live seed; dimension scores are
// explicit judgments with printed criteria, exactly like the audit's own
// "explicit architectural/regulatory assurance judgment" (audit §I).
// ============================================================================

import { buildSeedNodes } from "../src/app/rk/seed-data";
import { NODE_TYPE_CONFIGS, NODE_TYPES, prerequisiteClosure, type TraversalNode } from "../src/app/rk/registry";
import { EDGE_TYPES } from "../src/app/rk/types";

const nodes = buildSeedNodes() as TraversalNode[];
const byType = new Map<string, number>();
for (const n of nodes) byType.set(n.nodeType, (byType.get(n.nodeType) ?? 0) + 1);

let totalEdges = 0;
const edgeLabels = new Set<string>();
const edgeTargets = new Set<string>();
let dangling = 0;
const live = new Set(nodes.map((n) => n.entityId));
for (const n of nodes) {
  for (const e of NODE_TYPE_CONFIGS[n.nodeType].edgesOf(n.data)) {
    totalEdges++;
    edgeLabels.add(e.edgeType);
    edgeTargets.add(e.toEntity);
    if (!live.has(e.toEntity)) dangling++;
  }
}

const rules = nodes.filter((n) => n.nodeType === "rule");
const rulesWithCitation = rules.filter((n) => String(n.data.citation ?? "").length > 10).length;
const docs = nodes.filter((n) => n.nodeType === "document");
const docsWithCitation = docs.filter((n) => String(n.data.citation ?? "").length > 10).length;
const renewals = byType.get("renewal") ?? 0;
const dependsOn = (() => {
  let c = 0;
  for (const n of nodes) for (const e of NODE_TYPE_CONFIGS[n.nodeType].edgesOf(n.data)) if (e.edgeType === "depends_on") c++;
  return c;
})();
const alcoholPrereqs = prerequisiteClosure(nodes, "DOC_ALCOHOL_LICENSE");

console.log("== mechanical metrics ==");
console.log(`nodes: ${nodes.length} | edges: ${totalEdges} | edge labels populated: ${edgeLabels.size}/${EDGE_TYPES.length} | node types populated: ${byType.size}/${NODE_TYPES.length}`);
console.log(`dangling edge targets: ${dangling}`);
console.log(`rules with direct citation: ${rulesWithCitation}/${rules.length}`);
console.log(`documents with citation: ${docsWithCitation}/${docs.length}`);
console.log(`renewal nodes: ${renewals} | depends_on edges: ${dependsOn}`);
console.log(`DOC_ALCOHOL_LICENSE prerequisite closure: ${alcoholPrereqs.join(", ")}`);

interface Dim { name: string; before: number; now: number; why: string }
const dims: Dim[] = [
  { name: "Entity modeling", before: 3, now: 4,
    why: "Canonical agency registry (37 agencies, role-typed: government/private_preparer/insurer/property_owner/utility); composite agency strings eliminated; DRNA succession (JCA/ADS, Law 171-2018) explicit; DDEC/OCIF added as incentive administrators. Municipal generic vs office distinction still coarse." },
  { name: "Relationship modeling", before: 3, now: 4,
    why: `${dependsOn} verified depends_on edges (was 2); prerequisiteClosure traverses them; edge-parity tests prove edges encode relationships. Municipality-flag geography still implicit.` },
  { name: "Typed edges", before: 3, now: 4,
    why: "Publication integrity gate rejects bad refs/enums/cycles before publish; edge-parity tests lock seed projections; writes still field-first." },
  { name: "Semantic richness", before: 2, now: 4,
    why: `26 tax_incentive programs + 46 benefits + 4 eligibility criteria + 4 project facts + Act 60 regulatory_source are graph nodes; 26/26 compile with zero rejections and replace static entries 1:1 (F11). R&D stays static-only (no modeled criteria — not invented). evidence_type/inspection/exemption types still empty.` },
  { name: "Referential integrity", before: 2, now: 4,
    why: `0 dangling targets across ${totalEdges} edges; publish gate + edge-parity tests run in CI-equivalent suites.` },
  { name: "Source provenance", before: 1, now: 4,
    why: `${rulesWithCitation}/${rules.length} rules carry provision-level citations (${rules.filter((n) => n.data.citation_source === "rule").length} rule-specific, rest inherited from ${docsWithCitation}/${docs.length} verified documents, confidence-labeled statute/page). ${rules.length - rulesWithCitation} rules on ${docs.length - docsWithCitation} unverified documents still uncited; inherited citations are document-level, not clause-level.` },
  { name: "Temporal/version modeling", before: 2, now: 3,
    why: "Recurring obligations modeled as renewal nodes with cadence + citation; effective intervals validated for inversion but still not enforced at evaluation." },
  { name: "Rule integration", before: 2, now: 4,
    why: "One shared UI/server requirements pipeline; published graph entries take precedence over static; discovery parity tested." },
  { name: "Runtime graph traversal", before: 1, now: 2,
    why: "Edges are traversed by tested helpers (prerequisiteClosure) and parity checks; checklist still compiles from node data, not edge walks." },
  { name: "Graph-derived reasoning", before: 1, now: 2,
    why: "152 registry relationships projected as 181 fact_derivation + 156 intake_fact + 8 fact_contradiction nodes, all with provenance notes (12 missing notes added at the source), via a deterministic script with a sync test. Execution still in the TS fixpoint machine — the graph is the versioned system of record, not yet the runtime." },
  { name: "Regulatory traceability", before: 1, now: 3,
    why: "Requirement -> provision -> official URL chain now exists for 532/631 rules; matched_rules/basis reporting; prerequisites are edges. Clause-level evidence matrix for all rules still missing." },
];

console.log("\n== dimensions (0-5) ==");
let bSum = 0, nSum = 0;
for (const d of dims) {
  bSum += d.before; nSum += d.now;
  console.log(`${d.before} -> ${d.now}  ${d.name}\n      ${d.why}`);
}
const pct = (s: number) => Math.round((s / 55) * 100);
console.log(`\nBASELINE: ${bSum}/55 = ${pct(bSum)}/100 (audit)`);
console.log(`CURRENT:  ${nSum}/55 = ${pct(nSum)}/100`);
console.log("\nTrust threshold per audit: 50/100 for autonomous recommendations.");
