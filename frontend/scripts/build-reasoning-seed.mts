#!/usr/bin/env npx tsx
/**
 * Converts the intake relationship registry
 * (src/app/ai/intake/relationshipRegistry.ts) into jurisdiction-pack JSON
 * seed files, so deterministic fact derivations and contradictions become
 * versioned graph nodes instead of living only in a TS module:
 *
 *   src/kb/intake_facts.json         -> intake_fact nodes
 *   src/kb/fact_derivations.json     -> fact_derivation nodes (one per effect)
 *   src/kb/fact_contradictions.json  -> fact_contradiction nodes
 *
 * The registry remains the AUTHORITATIVE source the fixpoint machine
 * (relationships.ts) executes — this script is a deterministic projection,
 * and edgeParity.test.ts asserts the projection stays in sync. A future
 * stage can point the machine at the graph nodes directly.
 *
 * Deterministic: re-running produces byte-identical output. Run after any
 * edit to relationshipRegistry.ts:
 *   npx tsx scripts/build-reasoning-seed.mts
 */
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  INTAKE_RELATIONSHIPS,
  INTAKE_CONTRADICTIONS,
} from "../src/app/ai/intake/relationshipRegistry.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const kbDir = join(root, "src", "kb");

/** Deterministic JSON: sorted object keys, stable for diffs. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

const addr = (type: string, key: string) => `${type}:${key}`;
const factId = (address: string) => `IF_${address.replace(/:/g, "__")}`;
const humanize = (key: string) =>
  key
    .replace(/^Q_/, "")
    .replace(/_/g, " ")
    .replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());

const facts = new Map<string, Record<string, unknown>>();
const seeFact = (type: string, key: string) => {
  const address = addr(type, key);
  if (!facts.has(address)) {
    facts.set(address, {
      id: factId(address),
      fact_address: address,
      fact_type: type,
      fact_key: key,
      label: humanize(key),
    });
  }
  return factId(address);
};

const derivations: Record<string, unknown>[] = [];
for (const rel of INTAKE_RELATIONSHIPS) {
  const sourceId = seeFact(rel.source.type, rel.source.key);
  rel.effects.forEach((effect, i) => {
    const targetId = seeFact(effect.target.type, effect.target.key);
    derivations.push({
      id: `${rel.id}__e${i}`,
      relationship_id: rel.id,
      source_fact_id: sourceId,
      condition_operator: rel.condition.operator,
      ...(rel.condition.value !== undefined ? { condition_value: stable(rel.condition.value) } : {}),
      target_fact_id: targetId,
      ...(effect.value !== undefined ? { target_value: stable(effect.value) } : {}),
      derive_kind: effect.derive ? effect.derive.kind : "literal",
      ...(effect.derive && effect.derive.kind === "value_map"
        ? { derive_map: stable(effect.derive.map) }
        : {}),
      certainty: effect.certainty,
      relationship: effect.relationship,
      note: rel.note ?? "",
    });
  });
}

const contradictions: Record<string, unknown>[] = [];
for (const c of INTAKE_CONTRADICTIONS) {
  const factIds: string[] = [];
  const when = c.when.map((w) => {
    const address = addr(w.ref.type, w.ref.key);
    factIds.push(seeFact(w.ref.type, w.ref.key));
    return {
      fact_address: address,
      operator: w.operator,
      ...(w.value !== undefined ? { value: w.value } : {}),
    };
  });
  contradictions.push({
    id: c.id,
    message: c.message,
    when: stable(when),
    fact_ids: [...new Set(factIds)],
  });
}

const write = (name: string, rows: Record<string, unknown>[]) => {
  writeFileSync(join(kbDir, name), JSON.stringify(rows, null, 2) + "\n");
  console.log(`${name}: ${rows.length} rows`);
};

write("intake_facts.json", [...facts.values()]);
write("fact_derivations.json", derivations);
write("fact_contradictions.json", contradictions);
