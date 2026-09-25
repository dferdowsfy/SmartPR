import test from "node:test";
import assert from "node:assert/strict";
import { normalizeLinkableBusinesses } from "./linkBusiness.ts";

test("normalizeLinkableBusinesses: keeps rows with a usable public id", () => {
  const out = normalizeLinkableBusinesses({
    businesses: [
      { public_id: "biz_abc", name: "Caribe Metalworks LLC", legal_name: "Caribe Metalworks LLC", municipality: "Guaynabo" },
      { public_id: "  biz_xyz  ", name: "Hotel Vista" },
    ],
  });
  assert.equal(out.length, 2);
  assert.equal(out[0].public_id, "biz_abc");
  assert.equal(out[0].name, "Caribe Metalworks LLC");
  assert.equal(out[0].municipality, "Guaynabo");
  // Whitespace around the id is trimmed so ?business= stays usable.
  assert.equal(out[1].public_id, "biz_xyz");
  assert.equal(out[1].municipality, null);
});

test("normalizeLinkableBusinesses: drops rows without a usable public id", () => {
  const out = normalizeLinkableBusinesses({
    businesses: [
      { public_id: null, name: "Legacy row (no public id)" },
      { public_id: "", name: "Empty id" },
      { public_id: "   ", name: "Blank id" },
      { name: "Missing id key entirely" },
      "not-an-object",
      null,
      { public_id: "biz_ok", name: "Good row" },
    ],
  });
  assert.deepEqual(out.map((b) => b.public_id), ["biz_ok"]);
});

test("normalizeLinkableBusinesses: malformed payloads never throw", () => {
  assert.deepEqual(normalizeLinkableBusinesses(null), []);
  assert.deepEqual(normalizeLinkableBusinesses(undefined), []);
  assert.deepEqual(normalizeLinkableBusinesses({}), []);
  assert.deepEqual(normalizeLinkableBusinesses({ businesses: "nope" }), []);
  assert.deepEqual(normalizeLinkableBusinesses({ businesses: null }), []);
});

import { matchBusinessByName } from "./linkBusiness.ts";

test("the narrative's business name links its Passport when exactly one matches", () => {
  const list = [
    { public_id: "b1", name: "Caribe Precision", legal_name: "Caribe Precision Manufacturing LLC", municipality: "Bayamón" },
    { public_id: "b2", name: "Hotel Vista", legal_name: "Hotel Vista Inc.", municipality: "San Juan" },
  ];
  assert.equal(matchBusinessByName(list, "Caribe Precision Manufacturing, LLC")?.public_id, "b1");
  assert.equal(matchBusinessByName(list, "caribe precision manufacturing l.l.c.")?.public_id, "b1");
  assert.equal(matchBusinessByName(list, "Caribe"), null, "one shared word is not a confident match");
  assert.equal(matchBusinessByName(list, "Isla Metalworks LLC"), null);
  assert.equal(matchBusinessByName(list, null), null);
  const twins = [...list, { public_id: "b3", name: "Caribe Precision Manufacturing (Ponce)", legal_name: null }];
  assert.equal(matchBusinessByName(twins, "Caribe Precision Manufacturing LLC"), null, "two plausible matches → the picker decides");
});
