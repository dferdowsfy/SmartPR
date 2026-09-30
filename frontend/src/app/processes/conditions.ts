// Three-valued (Kleene) condition evaluator for regulatory-process triggers.
//
//   true  — the condition holds on the known facts
//   false — the condition fails on the known facts
//   null  — a controlling fact is unknown; `unknownFacts` names it
//
// Strict operators (eq, neq, in, gte, gt, lte, lt, contains, known) are
// UNKNOWN when the fact is missing, so an unknown controlling fact keeps the
// decision open (NEEDS_FACT). Lenient operators (stated, stated_in,
// stated_contains) are FALSE when the fact is missing: they only add positive
// signals and never hold a decision open.

import type { Condition, FactMap, FactValue } from "./types.ts";

export type Tri = boolean | null;

export interface ConditionResult {
  value: Tri;
  /** Facts whose absence made (part of) the result unknown. */
  unknownFacts: string[];
  /** Facts that were read and known — used for explanation paths. */
  usedFacts: string[];
}

function isMissing(v: FactValue | undefined): v is undefined {
  return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
}

function norm(v: unknown): unknown {
  return typeof v === "string" ? v.trim().toLowerCase() : v;
}

function asList(v: FactValue | undefined): unknown[] {
  if (Array.isArray(v)) return v.map(norm);
  return v === undefined ? [] : [norm(v)];
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function truthy(v: FactValue | undefined): boolean {
  if (isMissing(v)) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return !["false", "no", "none", "0"].includes(v.trim().toLowerCase());
  return true;
}

function leaf(fact: string, op: string, expected: FactValue | undefined, facts: FactMap): Tri {
  const actual = facts[fact];
  const missing = isMissing(actual);
  switch (op) {
    case "stated":
      return truthy(actual);
    case "stated_in":
      return !missing && asList(expected).includes(norm(actual));
    case "stated_contains": {
      if (missing) return false;
      const have = asList(actual);
      return asList(expected).some((e) => have.includes(e));
    }
    case "known":
      return !missing;
  }
  if (missing) return null;
  switch (op) {
    case "eq":
      return norm(actual) === norm(expected);
    case "neq":
      return norm(actual) !== norm(expected);
    case "in":
      return asList(expected).includes(norm(actual));
    case "contains": {
      const have = asList(actual);
      return asList(expected).some((e) => have.includes(e));
    }
    case "gte": case "gt": case "lte": case "lt": {
      const a = num(actual);
      const e = num(expected);
      if (a === null || e === null) return null;
      if (op === "gte") return a >= e;
      if (op === "gt") return a > e;
      if (op === "lte") return a <= e;
      return a < e;
    }
    default:
      throw new Error(`Unknown condition operator: ${op}`);
  }
}

export function evaluateCondition(cond: Condition | undefined, facts: FactMap): ConditionResult {
  const unknown = new Set<string>();
  const used = new Set<string>();

  const walk = (c: Condition): Tri => {
    if ("all" in c) {
      const vals = c.all.map(walk);
      if (vals.includes(false)) return false;
      return vals.includes(null) ? null : true;
    }
    if ("any" in c) {
      const vals = c.any.map(walk);
      if (vals.includes(true)) return true;
      return vals.includes(null) ? null : false;
    }
    if ("not" in c) {
      const v = walk(c.not);
      return v === null ? null : !v;
    }
    const v = leaf(c.fact, c.op, c.value, facts);
    if (v === null) unknown.add(c.fact);
    else if (!isMissing(facts[c.fact])) used.add(c.fact);
    return v;
  };

  if (!cond) return { value: true, unknownFacts: [], usedFacts: [] };
  const value = walk(cond);
  return { value, unknownFacts: value === null ? [...unknown] : [], usedFacts: [...used] };
}
