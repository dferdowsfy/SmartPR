// Tests for short public business ids: generator shape, uniqueness guard,
// and the resolution helper against an in-memory fake pool.
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateShortId, looksLikeShortId } from "../src/lib/shortId.ts";
import { resolveBusinessUuid, ensureUniquePublicId } from "../src/app/graph/store.ts";

test("generateShortId produces 8 readable characters without ambiguous glyphs", () => {
  for (let i = 0; i < 50; i += 1) {
    const id = generateShortId();
    assert.equal(id.length, 8);
    assert.match(id, /^[2-9a-hj-np-z]{8}$/);
    assert.ok(!/[01OlI]/.test(id), `ambiguous glyph in ${id}`);
  }
});

test("generateShortId is unique across a batch", () => {
  const ids = new Set(Array.from({ length: 200 }, () => generateShortId()));
  assert.equal(ids.size, 200);
});

test("looksLikeShortId distinguishes short ids from UUIDs", () => {
  assert.equal(looksLikeShortId("k7d2mq9x"), true);
  assert.equal(looksLikeShortId("123e4567-e89b-12d3-a456-426614174000"), false);
  assert.equal(looksLikeShortId(null), false);
  assert.equal(looksLikeShortId(""), false);
});

// --- store helpers, with a fake pool so no database is required ---

type Row = Record<string, string | null>;

// Minimal stand-in for the pg pool/client used by the helpers under test.
function fakeDb(rows: Row[]) {
  return {
    async query(text: string, params: unknown[]) {
      if (text.includes("public_id = $1 OR id::text = $1")) {
        const raw = String(params[0]);
        const hit = rows.find((r) => r.public_id === raw || r.id === raw);
        return { rows: hit ? [{ id: hit.id }] : [] };
      }
      if (text.includes("SELECT 1 FROM businesses WHERE public_id")) {
        const hit = rows.find((r) => r.public_id === params[0]);
        return { rows: hit ? [{ "?column?": 1 }] : [] };
      }
      throw new Error(`unexpected query: ${text}`);
    },
  };
}

test("resolveBusinessUuid passes UUIDs through", async () => {
  const uuid = "123e4567-e89b-12d3-a456-426614174000";
  const db = fakeDb([{ id: uuid, public_id: null }]);
  assert.equal(await resolveBusinessUuid(db as never, uuid), uuid);
});

test("resolveBusinessUuid maps a short public id to the UUID", async () => {
  const uuid = "123e4567-e89b-12d3-a456-426614174000";
  const db = fakeDb([{ id: uuid, public_id: "k7d2mq9x" }]);
  assert.equal(await resolveBusinessUuid(db as never, "k7d2mq9x"), uuid);
});

test("resolveBusinessUuid returns null for an unknown id", async () => {
  const db = fakeDb([]);
  assert.equal(await resolveBusinessUuid(db as never, "zzzzzzzz"), null);
  assert.equal(await resolveBusinessUuid(db as never, "123e4567-e89b-12d3-a456-426614174000"), null);
});

test("ensureUniquePublicId avoids collisions", async () => {
  const db = fakeDb([{ id: "a", public_id: "taken0001" }]);
  for (let i = 0; i < 20; i += 1) {
    const id = await ensureUniquePublicId(db as never);
    assert.notEqual(id, "taken0001");
    assert.ok(looksLikeShortId(id));
  }
});
