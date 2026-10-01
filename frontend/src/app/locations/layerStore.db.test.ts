// site_layer_cache against a real PostgreSQL: the production DDL, the upsert,
// the load-by-key query and the stale/fresh round trip through resolveSiteLayers.
// Skipped unless LOCATIONS_TEST_DATABASE_URL names a server whose user may CREATE DATABASE.
//
//   LOCATIONS_TEST_DATABASE_URL=postgresql://postgres@localhost:5432/postgres \
//     npx tsx --test src/app/locations/layerStore.db.test.ts
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { splitSqlStatements } from "../graph/sqlStatements.ts";
import { LOCATIONS_SCHEMA_SQL } from "./schema.ts";
import { createPgLayerStore } from "./layerStore.ts";
import { LayerCache, resolveSiteLayers, type FetchLike } from "./layerService.ts";
import { parseFemaFlood } from "./layers.ts";

const ADMIN_URL = process.env.LOCATIONS_TEST_DATABASE_URL;
const skip = ADMIN_URL ? false : "LOCATIONS_TEST_DATABASE_URL not set";
const DB = `smartpr_layercache_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
let admin: Pool;
let pool: Pool;

before(async () => {
  if (!ADMIN_URL) return;
  admin = new Pool({ connectionString: ADMIN_URL });
  await admin.query(`CREATE DATABASE ${DB}`);
  const url = new URL(ADMIN_URL);
  url.pathname = `/${DB}`;
  pool = new Pool({ connectionString: url.toString() });
  for (const s of splitSqlStatements(LOCATIONS_SCHEMA_SQL)) if (/site_layer_cache/.test(s)) await pool.query(s);
});
after(async () => {
  await pool?.end();
  if (admin) {
    await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin.end();
  }
});

const AT = new Date("2026-10-01T12:00:00.000Z");
const flood = (zone: string) => parseFemaFlood({ features: [{ attributes: { FLD_ZONE: zone, SFHA_TF: zone === "X" ? "F" : "T" } }] }, null, AT.toISOString());

test("save upserts by key, load returns only the requested keys with their timestamps", { skip }, async () => {
  const store = createPgLayerStore(pool, async () => {});
  const key = "flood_zone:18.44360,-66.20100";
  await store.save([{ key, at: AT.getTime(), latitude: 18.4436, longitude: -66.201, result: flood("AE") }]);
  await store.save([{ key, at: AT.getTime() + 60_000, latitude: 18.4436, longitude: -66.201, result: flood("VE") }]);
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM site_layer_cache`);
  assert.equal(rows[0].n, 1, "second save replaced the first");
  const got = await store.load([key, "flood_zone:0,0"]);
  assert.equal(got.length, 1);
  assert.equal(got[0].key, key);
  assert.equal(got[0].result.code, "VE");
  assert.equal(got[0].at, AT.getTime() + 60_000);
  assert.deepEqual(await store.load([]), []);
});

test("resolveSiteLayers: stored answer survives a 'restart' and serves a FEMA outage as stale", { skip }, async () => {
  const store = createPgLayerStore(pool, async () => {});
  const ok: FetchLike = async (url) => ({
    ok: true,
    status: 200,
    json: async () => (url.includes("/MapServer/28/") ? { features: [{ attributes: { FLD_ZONE: "AE", SFHA_TF: "T" } }] } : { features: [] }),
  });
  await resolveSiteLayers(18.45, -66.25, { fetchImpl: ok, cache: new LayerCache(), store, now: () => AT });
  const down: FetchLike = async () => ({ ok: false, status: 503, json: async () => ({}) });
  const later = new Date(AT.getTime() + 5 * 24 * 3600_000);
  const l = await resolveSiteLayers(18.45, -66.25, { fetchImpl: down, cache: new LayerCache(), store, retryDelayMs: 0, now: () => later });
  const f = l.results.find((r) => r.layer === "flood_zone")!;
  assert.equal(f.code, "AE");
  assert.equal(f.retrieval, "stale_cache");
});

test("a store whose database is unreachable fails soft and never throws", { skip }, async () => {
  const dead = new Pool({ connectionString: "postgresql://nobody@127.0.0.1:1/none", connectionTimeoutMillis: 300 });
  dead.on("error", () => {});
  let failures = 0;
  const store = createPgLayerStore(dead, async () => {}, () => failures++);
  assert.deepEqual(await store.load(["k"]), []);
  await store.save([{ key: "k", at: 1, latitude: 1, longitude: 1, result: flood("X") }]);
  assert.equal(failures, 2);
  await dead.end().catch(() => undefined);
});
