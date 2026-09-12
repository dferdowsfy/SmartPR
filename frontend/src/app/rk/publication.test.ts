// Regression tests for graph publication hardening (F07, F08, F18).
//
// Run: npx tsx --test src/app/rk/publication.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { buildSeedNodes } from "./seed-data.ts";
import { validatePublicationGraph, type CompileNode } from "./compile.ts";
import { NODE_TYPE_CONFIGS, validateNodeData } from "./registry.ts";

const seed = (): CompileNode[] =>
  buildSeedNodes().map((n) => ({
    entityId: n.entityId,
    nodeType: n.nodeType,
    data: n.data as Record<string, unknown>,
  }));

test("seed publication preserves the monthly Room Tax renewal (F07)", () => {
  const renewals = seed().filter((n) => n.nodeType === "renewal");
  const roomTax = renewals.find((n) => n.data.document_id === "DOC_ROOM_TAX_RETURN");
  assert.ok(roomTax, "a renewal node exists for DOC_ROOM_TAX_RETURN");
  assert.equal(roomTax.data.frequency_months, 1);
  assert.match(String(roomTax.data.citation ?? ""), /272-2003/);
  assert.equal(roomTax.data.id, roomTax.entityId, "data.id matches the entity id");
});

test("the full seed graph passes the publication integrity gate (F08)", () => {
  const problems = validatePublicationGraph(seed());
  assert.deepEqual(problems, []);
});

test("gate rejects a rule referencing a missing document", () => {
  const nodes = seed();
  const rule = nodes.find((n) => n.nodeType === "rule")!;
  const bad: CompileNode = {
    entityId: "RULE_BAD_REF",
    nodeType: "rule",
    data: { ...rule.data, id: "RULE_BAD_REF", requires_document_id: "DOC_NOPE_MISSING" },
  };
  const problems = validatePublicationGraph([...nodes, bad]);
  assert.ok(problems.some((p) => p.includes("RULE_BAD_REF") && p.includes("DOC_NOPE_MISSING")));
});

test("gate rejects a rule referencing a wrong-typed node", () => {
  const nodes = seed();
  const muni = nodes.find((n) => n.nodeType === "municipality")!;
  const bad: CompileNode = {
    entityId: "RULE_WRONG_TYPE",
    nodeType: "rule",
    data: { id: "RULE_WRONG_TYPE", rule_type: "business_type", requires_document_id: muni.entityId },
  };
  const problems = validatePublicationGraph([...nodes, bad]);
  assert.ok(problems.some((p) => p.includes("RULE_WRONG_TYPE") && p.includes("municipality")));
});

test("gate rejects unknown rule types, flags, and entity types", () => {
  const nodes = seed();
  const bad: CompileNode = {
    entityId: "RULE_BAD_ENUMS",
    nodeType: "rule",
    data: {
      id: "RULE_BAD_ENUMS",
      rule_type: "teleportation",
      requires_document_id: "DOC_EIN",
      municipality_flag: "atlantis",
      excluded_entity_types: ["corporation_ish"],
    },
  };
  const problems = validatePublicationGraph([...nodes, bad]);
  assert.ok(problems.some((p) => p.includes("unknown rule_type")));
  assert.ok(problems.some((p) => p.includes("unknown municipality_flag")));
  assert.ok(problems.some((p) => p.includes("unknown excluded entity type")));
});

test("gate rejects data.id / entity_id mismatches and duplicate entity ids", () => {
  const nodes = seed();
  const doc = nodes.find((n) => n.nodeType === "document")!;
  const mismatch: CompileNode = {
    entityId: "DOC_MISMATCH",
    nodeType: "document",
    data: { ...doc.data, id: "DOC_SOMETHING_ELSE" },
  };
  const dup: CompileNode = { ...doc, data: { ...doc.data } };
  const problems = validatePublicationGraph([...nodes, mismatch, dup]);
  assert.ok(problems.some((p) => p.includes("DOC_MISMATCH") && p.includes("does not match")));
  assert.ok(problems.some((p) => p.includes("duplicate entity id")));
});

test("gate rejects self edges and inverted effective intervals", () => {
  const nodes = seed();
  const doc = nodes.find((n) => n.nodeType === "document")!;
  const bad: CompileNode = {
    entityId: doc.entityId,
    nodeType: "document",
    data: {
      ...doc.data,
      depends_on_document_ids: [doc.entityId],
      effective_from: "2026-01-01",
      effective_until: "2025-01-01",
    },
  };
  const filtered = nodes.filter((n) => n.entityId !== doc.entityId);
  const problems = validatePublicationGraph([...filtered, bad]);
  assert.ok(problems.some((p) => p.includes("self edge")));
  assert.ok(problems.some((p) => p.includes("effective_from")));
});

test("projected edges are deduplicated at emission (F18)", () => {
  // DOC_EIN lists DOC_CERT_INCORPORATION in several conditional dependencies;
  // the graph must contain that edge exactly once.
  const nodes = seed();
  const ein = nodes.find((n) => n.entityId === "DOC_EIN")!;
  const edges = NODE_TYPE_CONFIGS.document.edgesOf(ein.data);
  const key = (e: { edgeType: string; toEntity: string }) => `${e.edgeType}→${e.toEntity}`;
  const seen = new Set(edges.map(key));
  assert.equal(seen.size, edges.length, "no duplicate projected edges");
  assert.equal(
    edges.filter((e) => e.edgeType === "depends_on" && e.toEntity === "DOC_CERT_INCORPORATION").length,
    1
  );
});

test("validateNodeData accepts a scope-only incentive program (F06 discovery-only)", () => {
  // PR_ACT60_TOURISM has industry scope but no substantive criteria; the
  // engine caps it at potentially_eligible. Publication validation must agree
  // with compileIncentiveCatalog instead of demanding criteria.
  const nodes = seed();
  const program = nodes.find(
    (n) => n.nodeType === "tax_incentive" && (n.data.criterion_ids as unknown[] ?? []).length === 0
      && (n.data.industry_ids as unknown[] ?? []).length > 0
  )!;
  const problems = validateNodeData(program.nodeType, program.data);
  assert.ok(
    !problems.some((p) => p.toLowerCase().includes("eligibility criterion")),
    `scope-only program should not be flagged for criteria: ${JSON.stringify(problems)}`
  );
});

test("validateNodeData rejects a vacuous incentive program (F06)", () => {
  // Neither criteria nor industry/geography scope: nothing to discover or
  // evaluate, so the program must not be publishable.
  const nodes = seed();
  const program = nodes.find((n) => n.nodeType === "tax_incentive")!;
  const vacuous = { ...program.data, criterion_ids: [], industry_ids: [], municipality_ids: [] };
  const problems = validateNodeData(program.nodeType, vacuous);
  assert.ok(
    problems.some((p) => p.includes("eligibility criterion") && p.includes("scope")),
    `vacuous program must be rejected: ${JSON.stringify(problems)}`
  );
});

test("validateNodeData accepts an incentive program with substantive criteria (F06)", () => {
  const nodes = seed();
  const program = nodes.find(
    (n) => n.nodeType === "tax_incentive" && (n.data.criterion_ids as unknown[] ?? []).length > 0
  )!;
  const problems = validateNodeData(program.nodeType, program.data);
  assert.ok(
    !problems.some((p) => p.toLowerCase().includes("eligibility criterion")),
    `program with criteria should not be flagged: ${JSON.stringify(problems)}`
  );
});
