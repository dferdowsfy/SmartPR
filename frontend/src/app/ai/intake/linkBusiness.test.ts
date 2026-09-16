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
