// The fixpoint machine executes graph-compiled relationships. This test pins
// the round-trip: graph nodes -> compileGraphRelationships() must rebuild
// EXACTLY the authored registry (and likewise for contradictions). If the
// projection ever drops or alters an executable field, this fails loudly
// instead of silently changing intake behavior.
// Run: npx tsx --test src/app/ai/intake/graphRelationships.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  compileGraphContradictions,
  compileGraphRelationships,
} from "./graphRelationships.ts";
import {
  INTAKE_CONTRADICTIONS,
  INTAKE_RELATIONSHIPS,
} from "./relationshipRegistry.ts";
import { resolveFacts, type SeedFact } from "./relationships.ts";
import { ACTIVE_JURISDICTION } from "../../jurisdictions/index.ts";

/** Drop undefined-valued keys so `{a: 1}` and `{a: 1, b: undefined}` compare equal. */
const normalize = (v: unknown): unknown => JSON.parse(JSON.stringify(v));

test("graph nodes rebuild the authored relationship registry exactly", () => {
  const compiled = compileGraphRelationships();
  assert.equal(compiled.length, INTAKE_RELATIONSHIPS.length);
  assert.deepEqual(normalize(compiled), normalize(INTAKE_RELATIONSHIPS));
});

test("graph nodes rebuild the authored contradiction list exactly", () => {
  const compiled = compileGraphContradictions();
  assert.equal(compiled.length, INTAKE_CONTRADICTIONS.length);
  assert.deepEqual(normalize(compiled), normalize(INTAKE_CONTRADICTIONS));
});

test("resolveFacts behaves identically on graph-compiled vs registry input", () => {
  const kb = ACTIVE_JURISDICTION.kb;
  const seeds: SeedFact[] = [
    { ref: { type: "question", key: "Q_ALCOHOL_SOLD" }, value: true, origin: "user" },
    { ref: { type: "profile", key: "number_of_employees" }, value: 10, origin: "user" },
    { ref: { type: "business_type", key: "bar" }, value: "bar", origin: "user" },
  ];
  const viaGraph = resolveFacts(seeds, { kb });
  const viaRegistry = resolveFacts(seeds, {
    kb,
    relationships: INTAKE_RELATIONSHIPS,
    contradictions: INTAKE_CONTRADICTIONS,
  });
  assert.deepEqual(normalize(viaGraph), normalize(viaRegistry));
});
