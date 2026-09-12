// ============================================================================
// Edge-traversal parity — the graph's RELATIONSHIPS are executable truth.
//
// The rules engine consumes node `data`, but the graph's value is its edges.
// These tests prove the projected edges faithfully encode every relationship
// the data claims, by traversing edges (not reading fields) and asserting
// the two views agree. If they ever diverge, the graph is lying about itself.
// ============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSeedNodes } from "./seed-data";
import { NODE_TYPE_CONFIGS, prerequisiteClosure, type TraversalNode } from "./registry";
import type { EdgeType } from "./types";

const nodes = buildSeedNodes() as TraversalNode[];

/** Traverse edges instead of reading fields: fromId -> [{edge, to}] */
function edgeIndex() {
  const idx = new Map<string, { edge: EdgeType; to: string }[]>();
  for (const n of nodes) {
    const edges = NODE_TYPE_CONFIGS[n.nodeType].edgesOf(n.data);
    idx.set(n.entityId, edges.map((e) => ({ edge: e.edgeType, to: e.toEntity })));
  }
  return idx;
}

const idx = edgeIndex();
const out = (from: string, edge: EdgeType): string[] =>
  (idx.get(from) ?? []).filter((e) => e.edge === edge).map((e) => e.to).sort();
const only = (from: string, edge: EdgeType): string | undefined => {
  const list = out(from, edge);
  return list.length ? list[0] : undefined;
};

test("rule -> document edges match requires_document_id fields", () => {
  for (const n of nodes.filter((n) => n.nodeType === "rule")) {
    const field = String(n.data.requires_document_id ?? "");
    assert.equal(only(n.entityId, "requires"), field, `${n.entityId}: requires edge`);
  }
});

test("rule -> business_type/question edges match applicability fields", () => {
  for (const n of nodes.filter((n) => n.nodeType === "rule")) {
    const bt = n.data.business_type_id ? String(n.data.business_type_id) : undefined;
    const q = n.data.question_id ? String(n.data.question_id) : undefined;
    const applies = out(n.entityId, "applies_to");
    if (bt) {
      assert.ok(applies.includes(bt), `${n.entityId}: applies_to business_type`);
    } else {
      assert.ok(!applies.some((t) => t.startsWith("BT_")), `${n.entityId}: no stray BT edge`);
    }
    if (q) assert.ok(applies.includes(q), `${n.entityId}: applies_to question`);
    else assert.ok(!applies.some((t) => t.startsWith("Q_")), `${n.entityId}: no stray Q edge`);
  }
});

test("document -> agency edges match agency_id fields", () => {
  for (const n of nodes.filter((n) => n.nodeType === "document")) {
    const ids = Array.isArray(n.data.agency_ids) ? (n.data.agency_ids as string[]).map(String) : [];
    const edges = out(n.entityId, "issued_by");
    assert.deepEqual(edges, [...ids].sort(), `${n.entityId}: issued_by matches agency_ids`);
  }
});

test("agency nodes carry roles; no composite or role-conflated agencies", () => {
  const agencies = nodes.filter((n) => n.nodeType === "agency");
  const roles = new Set(agencies.map((a) => String(a.data.role ?? "")));
  for (const r of ["government", "private_preparer", "insurer", "property_owner", "utility"]) {
    assert.ok(roles.has(r), `role present: ${r}`);
  }
  for (const a of agencies) {
    assert.ok(String(a.data.role ?? "").length > 0, `${a.entityId}: role set`);
    assert.ok(!/[/+]/g.test(String(a.data.name ?? "")), `${a.entityId}: no composite name`);
  }
  // Private actors are never modeled as government issuers.
  for (const a of agencies.filter((a) => String(a.data.role) !== "government")) {
    assert.notEqual(a.data.level, "Commonwealth", `${a.entityId}: private actor not Commonwealth-level`);
    assert.notEqual(a.data.level, "Federal", `${a.entityId}: private actor not Federal`);
    assert.notEqual(a.data.level, "Municipal", `${a.entityId}: private actor not Municipal`);
  }
  // DRNA explicitly succeeds JCA/ADS (Law 171-2018).
  const drna = agencies.find((a) => a.entityId === "drna");
  assert.ok(drna, "drna agency node exists");
  assert.ok(
    (drna.data.succeeds as string[]).some((s) => s.includes("JCA")),
    "drna succeeds JCA/ADS"
  );
});

test("multi-agency documents project one issued_by edge per involved agency", () => {
  const edges = out("DOC_NONPROFIT_REGISTRATION", "issued_by");
  assert.deepEqual(edges, ["estado", "irs"], "nonprofit: Estado registers, IRS grants exemption");
});

test("document -> document depends_on edges match declared prerequisites", () => {
  // depends_on edges have two honest sources: the canonical
  // depends_on_document_ids field and requirement_guidance dependencies
  // (the latter are conditional — e.g. EIN -> incorporation only for
  // corporations — so they stay out of the unconditional field).
  for (const n of nodes.filter((n) => n.nodeType === "document")) {
    const field = Array.isArray(n.data.depends_on_document_ids)
      ? (n.data.depends_on_document_ids as string[])
      : [];
    const guidance = n.data.requirement_guidance as
      | { dependencies?: string[]; conditionalDependencies?: { documentId?: string }[] }
      | undefined;
    const guided = [
      ...(guidance?.dependencies ?? []),
      ...(guidance?.conditionalDependencies ?? []).map((d) => d.documentId ?? ""),
    ].filter(Boolean);
    const expected = [...new Set([...field, ...guided])].sort();
    assert.deepEqual(out(n.entityId, "depends_on"), expected, `${n.entityId}: depends_on`);
  }
});

test("business_type -> industry/questions edges match reference fields", () => {
  for (const n of nodes.filter((n) => n.nodeType === "business_type")) {
    assert.equal(only(n.entityId, "belongs_to"), String(n.data.industry_id ?? ""), `${n.entityId}: belongs_to`);
    const expected = (Array.isArray(n.data.question_ids) ? (n.data.question_ids as string[]) : []).slice().sort();
    assert.deepEqual(out(n.entityId, "asks"), expected, `${n.entityId}: asks`);
  }
});

test("renewal -> document edges match document_id fields", () => {
  for (const n of nodes.filter((n) => n.nodeType === "renewal")) {
    assert.equal(only(n.entityId, "renews"), String(n.data.document_id ?? ""), `${n.entityId}: renews`);
  }
});

test("every projected edge target resolves to a live node", () => {
  const live = new Set(nodes.map((n) => n.entityId));
  const dangling: string[] = [];
  for (const [from, edges] of idx) {
    for (const e of edges) {
      if (!live.has(e.to)) dangling.push(`${from} -${e.edge}-> ${e.to}`);
    }
  }
  assert.deepEqual(dangling, [], "no dangling edge targets");
});

test("alcohol license prerequisites are traversable from the graph", () => {
  const prereqs = prerequisiteClosure(nodes, "DOC_ALCOHOL_LICENSE");
  assert.deepEqual(prereqs, ["DOC_CRIM_CLEARANCE", "DOC_ASUME_CLEARANCE", "DOC_BACKGROUND_CHECK"]);
});

test("annual report renewal is traversable from its document", () => {
  // document -> renewal is the inverse direction: find renewals pointing here
  const renewals = nodes.filter(
    (n) => n.nodeType === "renewal" && only(n.entityId, "renews") === "DOC_ANNUAL_REPORT"
  );
  assert.equal(renewals.length, 1);
  assert.equal(Number(renewals[0].data.frequency_months), 12);
});

test("prerequisiteClosure is cycle-safe", () => {
  const cyclic: TraversalNode[] = [
    { entityId: "DOC_A", nodeType: "document", data: { id: "DOC_A", depends_on_document_ids: ["DOC_B"] } },
    { entityId: "DOC_B", nodeType: "document", data: { id: "DOC_B", depends_on_document_ids: ["DOC_A"] } },
  ];
  assert.deepEqual(prerequisiteClosure(cyclic, "DOC_A"), ["DOC_B"]);
});
