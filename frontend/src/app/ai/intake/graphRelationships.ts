// ============================================================================
// Graph-compiled intake relationships.
//
// The fixpoint machine (relationships.ts) executes THESE — compiled from the
// regulatory knowledge graph's reasoning nodes (intake_fact /
// fact_derivation / fact_contradiction), which are themselves the
// deterministic, versioned projection of relationshipRegistry.ts
// (scripts/build-reasoning-seed.mts, sync-guarded by edgeParity.test.ts).
//
// Authoring stays in the TS registry for ergonomics; the JSON seed files are
// the versioned system of record AND the runtime input. If the projection
// ever drops an executable field, the round-trip test below fails loudly
// rather than silently changing intake behavior.
// ============================================================================

import intakeFactsJson from "../../../kb/intake_facts.json";
import factDerivationsJson from "../../../kb/fact_derivations.json";
import factContradictionsJson from "../../../kb/fact_contradictions.json";
import type {
  Certainty,
  ConditionOperator,
  EffectDerivation,
  FactContradiction,
  FactRef,
  FactTargetRef,
  IntakeRelationship,
  RelationshipKind,
} from "./relationships.ts";

type Row = Record<string, unknown>;

const rows = (v: unknown): Row[] => (Array.isArray(v) ? (v as Row[]) : []);

/** "type:key" -> { type, key }. Keys never contain a colon; split on the first. */
function splitAddress(address: string): FactRef {
  const i = address.indexOf(":");
  if (i < 0) throw new Error(`graphRelationships: malformed fact address ${JSON.stringify(address)}`);
  return { type: address.slice(0, i), key: address.slice(i + 1) } as FactRef;
}

/** Projection serializes values with deterministic JSON; restore the native value. */
function restore(stable: unknown): unknown {
  return typeof stable === "string" ? (JSON.parse(stable) as unknown) : undefined;
}

function compileDerive(d: Row): EffectDerivation | undefined {
  switch (d["derive_kind"]) {
    case "literal":
      return undefined;
    case "count_bucket":
      return { kind: "count_bucket" };
    case "kb_industry":
      return { kind: "kb_industry" };
    case "value_map": {
      const map = restore(d["derive_map"]);
      if (!map || typeof map !== "object" || Array.isArray(map)) {
        throw new Error(`graphRelationships: ${String(d["id"])} has non-object derive_map`);
      }
      return { kind: "value_map", map: map as Record<string, string> };
    }
    default:
      throw new Error(`graphRelationships: ${String(d["id"])} has unknown derive_kind ${String(d["derive_kind"])}`);
  }
}

/**
 * Rebuild the executable relationship list from the graph's fact_derivation
 * nodes, preserving registry order (relationships in first-seen order,
 * effects in derivation order).
 */
export function compileGraphRelationships(): IntakeRelationship[] {
  const addressById = new Map<string, string>();
  for (const f of rows(intakeFactsJson)) {
    if (typeof f["id"] === "string" && typeof f["fact_address"] === "string") {
      addressById.set(f["id"], f["fact_address"]);
    }
  }
  const byRelId = new Map<string, IntakeRelationship>();
  const order: string[] = [];
  for (const d of rows(factDerivationsJson)) {
    const relId = d["relationship_id"];
    const sourceAddr = addressById.get(String(d["source_fact_id"]));
    const targetAddr = addressById.get(String(d["target_fact_id"]));
    if (typeof relId !== "string" || !sourceAddr || !targetAddr) {
      throw new Error(`graphRelationships: derivation ${String(d["id"])} references unknown fact`);
    }
    let rel = byRelId.get(relId);
    if (!rel) {
      rel = {
        id: relId,
        source: splitAddress(sourceAddr),
        condition: {
          operator: d["condition_operator"] as ConditionOperator,
          ...(d["condition_value"] !== undefined ? { value: restore(d["condition_value"]) } : {}),
        },
        effects: [],
        // The projection writes "" for relationships without a note; the
        // registry omits the field. Omit here too so the round-trip is exact.
        ...(typeof d["note"] === "string" && d["note"] ? { note: d["note"] } : {}),
      };
      byRelId.set(relId, rel);
      order.push(relId);
    }
    const derive = compileDerive(d);
    rel.effects.push({
      // The registry type only allows writing to profile/question targets;
      // the graph projection preserves that invariant.
      target: splitAddress(targetAddr) as FactTargetRef,
      ...(d["target_value"] !== undefined ? { value: restore(d["target_value"]) } : {}),
      ...(derive ? { derive } : {}),
      certainty: d["certainty"] as Certainty,
      relationship: d["relationship"] as RelationshipKind,
    });
  }
  return order.map((id) => byRelId.get(id) as IntakeRelationship);
}

/** Rebuild executable contradictions from the graph's fact_contradiction nodes. */
export function compileGraphContradictions(): FactContradiction[] {
  return rows(factContradictionsJson).map((c) => {
    const when = restore(c["when"]);
    if (!Array.isArray(when)) {
      throw new Error(`graphRelationships: contradiction ${String(c["id"])} has malformed when`);
    }
    return {
      id: String(c["id"]),
      when: (when as Row[]).map((w) => ({
        ref: splitAddress(String(w["fact_address"])),
        operator: w["operator"] as ConditionOperator,
        ...(w["value"] !== undefined ? { value: w["value"] } : {}),
      })),
      message: String(c["message"] ?? ""),
    };
  });
}
