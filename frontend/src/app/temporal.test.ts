// Temporal enforcement: asOf filtering, supersession, and engine integration.
// All dates below are SYNTHETIC fixtures — no real effective dates are
// invented for the bundled KB (undated = current law as modeled).
// Run: node --experimental-strip-types --test src/app/temporal.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeAsOf, isEffectiveAt, filterEffective } from "./temporal.ts";
import { runRulesEngine, type KnowledgeBase } from "./rulesEngine.ts";
import { compileKb, type CompileNode } from "./rk/compile.ts";

test("normalizeAsOf defaults to today UTC and rejects garbage", () => {
  assert.match(normalizeAsOf(), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(normalizeAsOf("2026-09-12"), "2026-09-12");
  assert.equal(normalizeAsOf("2026-09-12T15:30:00Z"), "2026-09-12");
  assert.equal(normalizeAsOf(new Date(Date.UTC(2026, 0, 5))), "2026-01-05");
  assert.throws(() => normalizeAsOf("yesterday"), /TEMPORAL/);
  assert.throws(() => normalizeAsOf("2026-02-30"), /TEMPORAL/); // not a calendar date
  assert.throws(() => normalizeAsOf("2026-13-01"), /TEMPORAL/);
});

test("isEffectiveAt: undated is current, from is inclusive, to is exclusive", () => {
  const asOf = "2026-09-12";
  assert.equal(isEffectiveAt({ id: "u" }, asOf), true);
  assert.equal(isEffectiveAt({ id: "f", effective_from: "2026-09-12" }, asOf), true);
  assert.equal(isEffectiveAt({ id: "f", effective_from: "2026-09-13" }, asOf), false);
  assert.equal(isEffectiveAt({ id: "t", effective_to: "2026-09-12" }, asOf), false); // exclusive end
  assert.equal(isEffectiveAt({ id: "t", effective_to: "2026-09-13" }, asOf), true);
  assert.equal(
    isEffectiveAt({ id: "b", effective_from: "2020-01-01", effective_to: "2030-01-01" }, asOf), true);
});

test("inverted intervals fail loud, never silent", () => {
  assert.throws(
    () => isEffectiveAt({ id: "BAD", effective_from: "2026-09-13", effective_to: "2026-09-12" }, "2026-09-12"),
    /inverted interval/,
  );
  assert.throws(
    () => filterEffective([{ id: "BAD", effective_from: "2027-01-01", effective_to: "2026-01-01" }], "2026-06-01"),
    /TEMPORAL/,
  );
});

test("filterEffective keeps undated and drops future/expired records", () => {
  const records = [
    { id: "current" },
    { id: "future", effective_from: "2027-01-01" },
    { id: "expired", effective_to: "2020-01-01" },
    { id: "window", effective_from: "2020-01-01", effective_to: "2030-01-01" },
  ];
  assert.deepEqual(filterEffective(records, "2026-09-12").map((r) => r.id), ["current", "window"]);
});

test("supersession retires the old record only while the superseder is effective", () => {
  const records = [
    { id: "OLD" },
    { id: "NEW", effective_from: "2026-01-01", supersedes: ["OLD"] },
  ];
  // Before NEW takes effect, OLD stands alone.
  assert.deepEqual(filterEffective(records, "2025-06-01").map((r) => r.id), ["OLD"]);
  // Once NEW is effective, OLD is retired even though OLD itself is undated.
  assert.deepEqual(filterEffective(records, "2026-06-01").map((r) => r.id), ["NEW"]);
});

test("supersession by an expired record does not retire anything", () => {
  const records = [
    { id: "OLD" },
    { id: "NEW", effective_from: "2020-01-01", effective_to: "2021-01-01", supersedes: ["OLD"] },
  ];
  assert.deepEqual(filterEffective(records, "2026-09-12").map((r) => r.id), ["OLD"]);
});

test("overlapping intervals without supersession keep both records", () => {
  const records = [
    { id: "A", effective_from: "2020-01-01", effective_to: "2030-01-01" },
    { id: "B", effective_from: "2025-01-01", effective_to: "2035-01-01" },
  ];
  assert.deepEqual(filterEffective(records, "2026-09-12").map((r) => r.id), ["A", "B"]);
});

test("supersession cycles fail loud", () => {
  const records = [
    { id: "A", supersedes: ["B"] },
    { id: "B", supersedes: ["A"] },
  ];
  assert.throws(() => filterEffective(records, "2026-09-12"), /supersession cycle/);
  const indirect = [
    { id: "A", supersedes: ["B"] },
    { id: "B", supersedes: ["C"] },
    { id: "C", supersedes: ["A"] },
  ];
  assert.throws(() => filterEffective(indirect, "2026-09-12"), /supersession cycle/);
});

test("supersession chains retire transitively effective predecessors", () => {
  const records = [
    { id: "V1" },
    { id: "V2", effective_from: "2025-01-01", supersedes: ["V1"] },
    { id: "V3", effective_from: "2026-01-01", supersedes: ["V2"] },
  ];
  assert.deepEqual(filterEffective(records, "2026-09-12").map((r) => r.id), ["V3"]);
});

// --- Engine integration (synthetic KB) -------------------------------------

function synthKb(rules: KnowledgeBase["rules"]): KnowledgeBase {
  return {
    municipalities: [],
    businessTypes: [{ id: "bt1", industry_id: "i1", name: "Bar", description: "Bar" }],
    questions: [{ id: "Q_X", question: "X?", type: "boolean" }],
    documents: [{ id: "DOC_X", name: "Doc X", agency: "Agency", category: "State" }],
    rules,
  };
}
const baseRule = {
  id: "R1", rule_type: "question_trigger" as const, business_type_id: null,
  question_id: "Q_X", expected_answer: "true", municipality_flag: null,
  requires_document_id: "DOC_X",
};
const input = { answers: { Q_X: true }, asOf: "2026-09-12" };

test("engine: future rules do not fire, expired rules do not fire", () => {
  const kb = synthKb([
    { ...baseRule, id: "R_FUTURE", effective_from: "2027-01-01" },
    { ...baseRule, id: "R_EXPIRED", effective_to: "2020-01-01" },
    { ...baseRule, id: "R_NOW" },
  ]);
  const res = runRulesEngine(kb, input);
  assert.deepEqual(res.requirements.map((r) => r.source_rule_id), ["R_NOW"]);
});

test("engine: asOf selects which dated rule fires", () => {
  const kb = synthKb([
    { ...baseRule, id: "R_OLD" },
    { ...baseRule, id: "R_NEW", effective_from: "2026-01-01", supersedes: ["R_OLD"] },
  ]);
  const before = runRulesEngine(kb, { answers: { Q_X: true }, asOf: "2025-06-01" });
  assert.deepEqual(before.requirements.map((r) => r.source_rule_id), ["R_OLD"]);
  const after = runRulesEngine(kb, { answers: { Q_X: true }, asOf: "2026-06-01" });
  assert.deepEqual(after.requirements.map((r) => r.source_rule_id), ["R_NEW"]);
});

test("engine: default asOf is today and undated bundled rules are unaffected", () => {
  const kb = synthKb([{ ...baseRule }]);
  const res = runRulesEngine(kb, { answers: { Q_X: true } });
  assert.deepEqual(res.requirements.map((r) => r.source_rule_id), ["R1"]);
});

// --- compileKb integration (synthetic nodes) --------------------------------

function node(nodeType: "rule" | "document", data: Record<string, unknown>): CompileNode {
  return { entityId: String(data.id), nodeType, data };
}

test("compileKb filters rules and documents by asOf at pack compilation", () => {
  const nodes: CompileNode[] = [
    node("rule", { ...baseRule, id: "R_OK" }),
    node("rule", { ...baseRule, id: "R_FUTURE", effective_from: "2027-01-01" }),
    node("rule", { ...baseRule, id: "R_OLD", effective_to: "2020-01-01" }),
    node("rule", { ...baseRule, id: "R_SUPERSEDED" }),
    node("rule", { ...baseRule, id: "R_NEW", effective_from: "2026-01-01", supersedes: ["R_SUPERSEDED"] }),
    node("document", { id: "DOC_X", name: "Doc X", agency: "Agency", category: "State" }),
    node("document", { id: "DOC_GONE", name: "Gone", agency: "Agency", category: "State", effective_to: "2020-01-01" }),
  ];
  const compiled = compileKb(nodes, { version: 1, batchId: null }, "2026-09-12");
  assert.deepEqual(compiled.rules.map((r: { id: string }) => r.id).sort(), ["R_NEW", "R_OK"]);
  assert.deepEqual(compiled.documents.map((d: { id: string }) => d.id), ["DOC_X"]);
});

test("compileKb with no asOf keeps undated bundled rows (golden parity safe)", () => {
  const nodes: CompileNode[] = [
    node("rule", { ...baseRule, id: "R1" }),
    node("document", { id: "DOC_X", name: "Doc X", agency: "Agency", category: "State" }),
  ];
  const compiled = compileKb(nodes, { version: 1, batchId: null });
  assert.equal(compiled.rules.length, 1);
  assert.equal(compiled.documents.length, 1);
});
