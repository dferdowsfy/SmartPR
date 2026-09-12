// F09: a published snapshot must not change discovery — same question keys,
// same answer options, same profile-stage exclusions as the bundled graph.
//
// Run: npx tsx --test src/app/rk/discoveryParity.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  discoveryQuestionsForBusinessType,
  applyKbSnapshot,
  kbMeta,
  KB,
} from "../kb.ts";
import { buildSeedNodes } from "./seed-data.ts";
import { compileKb } from "./compile.ts";

const TYPES = ["Restaurant", "Bar", "Contractor"];

test("published snapshot discovery matches bundled discovery exactly", () => {
  const bundled = new Map(
    TYPES.map((t) => [t, discoveryQuestionsForBusinessType(t)])
  );
  for (const [t, qs] of bundled) {
    assert.ok(qs && qs.length > 0, `bundled discovery has questions for ${t}`);
  }

  // Compile the seed exactly as publishBatch() would, then apply it the way
  // initKbFromServer() does on the client.
  const compiled = compileKb(
    buildSeedNodes().map((n) => ({
      entityId: n.entityId,
      nodeType: n.nodeType,
      data: n.data as Record<string, unknown>,
    })),
    { version: 1, batchId: "test" }
  );

  // Save module state so the swap is reversible inside this test file.
  const saved = {
    municipalities: KB.municipalities,
    businessTypes: KB.businessTypes,
    questions: KB.questions,
    documents: KB.documents,
    rules: KB.rules,
    source: kbMeta.source,
    btq: kbMeta.btq,
  };
  try {
    assert.equal(applyKbSnapshot(compiled as never), true);
    assert.equal(kbMeta.source, "snapshot");
    for (const t of TYPES) {
      const fromSnapshot = discoveryQuestionsForBusinessType(t);
      assert.deepEqual(
        fromSnapshot,
        bundled.get(t),
        `snapshot discovery for ${t} matches bundled keys/options`
      );
    }
  } finally {
    KB.municipalities = saved.municipalities;
    KB.businessTypes = saved.businessTypes;
    KB.questions = saved.questions;
    KB.documents = saved.documents;
    KB.rules = saved.rules;
    kbMeta.source = saved.source;
    kbMeta.btq = saved.btq;
  }
});
