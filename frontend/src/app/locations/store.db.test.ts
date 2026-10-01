// Passport Locations — database integration tests (real PostgreSQL).
//
// Creates throwaway databases on the server named by
// LOCATIONS_TEST_DATABASE_URL (a URL whose user may CREATE DATABASE), and
// drops them afterwards. Skipped when the variable is unset.
//
//   LOCATIONS_TEST_DATABASE_URL=postgresql://postgres@localhost:5432/postgres \
//     npx tsx --test src/app/locations/store.db.test.ts
//
// The PostGIS suite runs when the server has the postgis extension available.
import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";

const ADMIN_URL = process.env.LOCATIONS_TEST_DATABASE_URL;
const skip = ADMIN_URL ? false : "LOCATIONS_TEST_DATABASE_URL not set";
if (ADMIN_URL && process.env.LOCATIONS_TEST_SSL !== "1") process.env.PGSSL_DISABLE = "1";

function dbUrl(name: string): string {
  const url = new URL(ADMIN_URL!);
  url.pathname = `/${name}`;
  return url.toString();
}

const suffix = `${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
const MAIN_DB = `smartpr_loc_test_${suffix}`;
const GIS_DB = `smartpr_loc_gis_${suffix}`;

const USER_A = randomUUID(); // owns business A
const USER_B = randomUUID(); // owns business B (another tenant)
const USER_C = randomUUID(); // member of workspace W (not owner of business W)
const USER_W = randomUUID(); // owner of workspace W / business W
const USER_V = randomUUID(); // VIEWER in workspace W (read-only)
const BIZ_A = randomUUID();
const BIZ_B = randomUUID();
const BIZ_W = randomUUID();
const WS = randomUUID();
const MATTER_A = randomUUID();
const MATTER_B = randomUUID();
const PASSPORT_A = { version: 1, business: { legalName: "Caribe Precision Manufacturing, LLC" } };

let admin: Pool;
let store: typeof import("./store.ts");
let pool: Pool;

async function seedPreLocationsSchema(p: Pool) {
  // Replay the schema as it exists before this feature (execution +
  // compliance), exactly as ensureSchema applied it: statement by statement.
  const { SCHEMA_SQL } = await import("../graph/store.ts");
  const { COMPLIANCE_SCHEMA_SQL } = await import("../compliance/schema.ts");
  const { splitSqlStatements } = await import("../graph/sqlStatements.ts");
  for (const statement of splitSqlStatements(`${SCHEMA_SQL}\n${COMPLIANCE_SCHEMA_SQL}`)) {
    await p.query(statement).catch(() => {}); // pre-existing statement failures are not this feature's
  }
  await p.query(`INSERT INTO workspaces (id, owner_user_id, name) VALUES ($1, $2, 'W')`, [WS, USER_W]);
  await p.query(
    `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'OWNER'), ($1, $3, 'MEMBER'), ($1, $4, 'VIEWER')`,
    [WS, USER_W, USER_C, USER_V]
  );
  await p.query(
    `INSERT INTO businesses (id, user_id, name, passport_json, public_id) VALUES
       ($1, $2, 'A', $3::jsonb, 'bizaaaaa'), ($4, $5, 'B', '{}'::jsonb, 'bizbbbbb')`,
    [BIZ_A, USER_A, JSON.stringify(PASSPORT_A), BIZ_B, USER_B]
  );
  await p.query(`INSERT INTO businesses (id, user_id, name, workspace_id, public_id) VALUES ($1, $2, 'W', $3, 'bizwwwww')`, [
    BIZ_W,
    USER_W,
    WS,
  ]);
  await p.query(
    `INSERT INTO matters (id, business_id, user_id, matter_type, title) VALUES
       ($1, $2, $3, 'NEW_BUSINESS_FORMATION', 'Plant permits'), ($4, $5, $6, 'NEW_BUSINESS_FORMATION', 'B project')`,
    [MATTER_A, BIZ_A, USER_A, MATTER_B, BIZ_B, USER_B]
  );
  // Enterprise audit table (same shape as data/enterprise_schema.sql).
  await p.query(`CREATE TABLE audit_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(),
    actor_user_id uuid, workspace_id uuid, action text NOT NULL, target_type text, target_id text,
    before jsonb, "after" jsonb, ip text, user_agent text, correlation_id text, source text, reason text)`);
}

const input = (over: Record<string, unknown> = {}) => {
  // Built through the same parser the API uses.
  const parsed = geo.parseLocationInput({ latitude: 18.39123, longitude: -66.11784, ...over });
  if (!parsed.ok) throw new Error(parsed.errors.join(","));
  return parsed.value;
};
let geo: typeof import("./geo.ts");

describe("Passport locations on PostgreSQL", { skip }, () => {
  before(async () => {
    admin = new Pool({ connectionString: ADMIN_URL, ssl: process.env.PGSSL_DISABLE ? undefined : { rejectUnauthorized: false } });
    await admin.query(`CREATE DATABASE ${MAIN_DB}`);
    process.env.DATABASE_URL = dbUrl(MAIN_DB);
    const db = await import("../graph/db.ts");
    pool = db.getPool()!;
    geo = await import("./geo.ts");
    await seedPreLocationsSchema(pool);
    store = await import("./store.ts");
  });

  after(async () => {
    await pool?.end().catch(() => {});
    await admin?.query(`DROP DATABASE IF EXISTS ${MAIN_DB} WITH (FORCE)`).catch(() => {});
  });

  test("migration succeeds from the current schema and preserves existing Passport data", async () => {
    const { ensureSchema, schemaFailures } = await import("../graph/store.ts");
    await ensureSchema();
    const ours = schemaFailures().filter((f) => /location|geo_|smartpr_matter/i.test(f.statement));
    assert.deepEqual(ours, [], JSON.stringify(ours));
    const { rows } = await pool.query(`SELECT passport_json FROM businesses WHERE id=$1`, [BIZ_A]);
    assert.deepEqual(rows[0].passport_json, PASSPORT_A);
    const m = await pool.query(`SELECT title, location_id FROM matters WHERE id=$1`, [MATTER_A]);
    assert.equal(m.rows[0].title, "Plant permits");
    assert.equal(m.rows[0].location_id, null);
    // Idempotent: a second bootstrap (next deploy) changes nothing and fails nothing new.
    const { splitSqlStatements } = await import("../graph/sqlStatements.ts");
    const { LOCATIONS_SCHEMA_SQL } = await import("./schema.ts");
    for (const s of splitSqlStatements(LOCATIONS_SCHEMA_SQL)) await pool.query(s);
  });

  let first: Awaited<ReturnType<typeof store.createLocation>>;

  test("user can create a Passport location; coordinates persist exactly", async () => {
    const bizA = await store.accessibleBusiness(pool, "bizaaaaa", USER_A);
    assert.ok(bizA);
    first = await store.createLocation(
      pool,
      bizA,
      USER_A,
      input({
        name: "Guaynabo Manufacturing Facility",
        latitude: 18.391230123,
        longitude: -66.117840456,
        formatted_address: "123 Example Street, Guaynabo, PR",
        municipality: "Guaynabo",
        address_source: "PROVIDER_REVERSE_GEOCODE",
        place_source: "nominatim",
      })
    );
    assert.match(first.id, /^[0-9a-f-]{36}$/);
    assert.equal(first.latitude, 18.3912301);
    assert.equal(first.longitude, -66.1178405);
    assert.equal(first.is_primary, true, "a business's first location is its primary");
    assert.equal(first.business_id, BIZ_A);
    assert.equal(first.coordinate_system, "EPSG:4326");
    // The only geography recorded is the deterministic Census boundary lookup.
    assert.deepEqual(
      first.geographies.map((g) => [g.geography_type, g.geography_name, g.determination_method, g.source_version]).sort(),
      [
        ["barrio", "Pueblo Viejo", "SPATIAL_INTERSECTION", "TIGER2024"],
        ["municipality", "Guaynabo", "SPATIAL_INTERSECTION", "TIGER2024"],
      ]
    );
    assert.equal(first.geographies.find((g) => g.geography_type === "municipality")?.geography_code, "061");
    const raw = await pool.query(`SELECT created_by_user_id, workspace_id FROM locations WHERE id=$1`, [first.id]);
    assert.equal(raw.rows[0].created_by_user_id, USER_A);
  });

  test("the saved location reloads with the same values", async () => {
    const bizA = (await store.accessibleBusiness(pool, BIZ_A, USER_A))!;
    const list = await store.listLocationsForBusiness(pool, bizA);
    assert.equal(list.length, 1);
    assert.equal(list[0].id, first.id);
    assert.equal(list[0].latitude, 18.3912301);
    assert.equal(list[0].longitude, -66.1178405);
    assert.equal(list[0].formatted_address, "123 Example Street, Guaynabo, PR");
    assert.equal(list[0].address_source, "PROVIDER_REVERSE_GEOCODE");
  });

  test("coordinates-only save works (reverse geocoding failed or found nothing)", async () => {
    const bizW = (await store.accessibleBusiness(pool, BIZ_W, USER_W))!;
    const loc = await store.createLocation(pool, bizW, USER_W, input({ latitude: 18.0111, longitude: -66.6141 }));
    assert.equal(loc.address_source, "NONE");
    assert.equal(loc.formatted_address, null);
    assert.equal(loc.latitude, 18.0111);
  });

  test("user can edit a location; moving the pin supersedes old geography facts", async () => {
    const bizA = (await store.accessibleBusiness(pool, BIZ_A, USER_A))!;
    await pool.query(
      `INSERT INTO location_geographies (id, location_id, geography_type, geography_name, determination_method, source_id)
       VALUES ($1, $2, 'barrio', 'Pueblo Viejo', 'USER_PROVIDED', 'user')`,
      [randomUUID(), first.id]
    );
    const renamed = await store.updateLocation(pool, bizA, USER_A, first.id, input({
      name: "Plant 1",
      latitude: 18.3912301,
      longitude: -66.1178405,
      formatted_address: "123 Example Street, Guaynabo, PR",
      municipality: "Guaynabo",
      address_source: "PROVIDER_REVERSE_GEOCODE",
      place_source: "nominatim",
    }));
    assert.ok(renamed);
    assert.equal(renamed.moved, false);
    assert.deepEqual(renamed.changed, ["name"]);
    assert.equal(renamed.location.geographies.length, 3, "a rename keeps geography facts (user barrio + Census municipio/barrio)");

    const moved = await store.updateLocation(pool, bizA, USER_A, first.id, input({ name: "Plant 1", latitude: 18.4, longitude: -66.12 }));
    assert.ok(moved);
    assert.equal(moved.moved, true);
    assert.equal(moved.location.latitude, 18.4);
    assert.ok(
      moved.location.geographies.every((g) => g.source_id.startsWith("census-tiger-")),
      "facts about the old point no longer apply; only the new point's Census determination is current"
    );
    assert.ok(moved.location.geographies.some((g) => g.geography_type === "municipality"));
    const history = await pool.query(
      `SELECT superseded_at FROM location_geographies WHERE location_id=$1 AND source_id='user'`,
      [first.id]
    );
    assert.equal(history.rows.length, 1);
    assert.ok(history.rows[0].superseded_at, "history is kept, not deleted");
    assert.equal(moved.location.id, first.id, "the id is stable across edits");
  });

  test("a user cannot read, list, update or delete another tenant's location", async () => {
    assert.equal(await store.accessibleBusiness(pool, BIZ_A, USER_B), null);
    assert.equal(await store.accessibleBusiness(pool, "bizaaaaa", USER_B), null);
    const bizB = (await store.accessibleBusiness(pool, BIZ_B, USER_B))!;
    // Reaching A's location through B's own business must fail too.
    assert.equal(await store.getLocation(pool, bizB, first.id), null);
    assert.equal(await store.updateLocation(pool, bizB, USER_B, first.id, input({ latitude: 1, longitude: 1 })), null);
    assert.equal((await store.deleteLocation(pool, bizB, first.id)).deleted, false);
    assert.deepEqual(await store.listLocationsForBusiness(pool, bizB), []);
    const intact = await pool.query(`SELECT latitude FROM locations WHERE id=$1`, [first.id]);
    assert.equal(intact.rows[0].latitude, 18.4);
    // Unknown and malformed ids look exactly like foreign ones.
    const bizA = (await store.accessibleBusiness(pool, BIZ_A, USER_A))!;
    assert.equal(await store.getLocation(pool, bizA, randomUUID()), null);
    assert.equal(await store.getLocation(pool, bizA, "1 OR 1=1"), null);
  });

  test("workspace members share access to the workspace's business locations", async () => {
    const asMember = await store.accessibleBusiness(pool, BIZ_W, USER_C);
    assert.ok(asMember);
    assert.equal(asMember.workspace_id, WS);
    assert.equal(asMember.can_edit, true, "MEMBER may edit");
    assert.equal((await store.accessibleBusiness(pool, BIZ_W, USER_W))?.can_edit, true, "owner may edit");
    assert.equal((await store.listLocationsForBusiness(pool, asMember)).length, 1);
  });

  test("workspace viewers can read locations but may not mutate them", async () => {
    const asViewer = await store.accessibleBusiness(pool, BIZ_W, USER_V);
    assert.ok(asViewer, "viewers can see the business");
    assert.equal(asViewer.can_edit, false, "VIEWER may not edit (canEditWorkspace)");
    assert.equal((await store.listLocationsForBusiness(pool, asViewer)).length, 1);
    const matterW = randomUUID();
    await pool.query(
      `INSERT INTO matters (id, business_id, user_id, matter_type, title) VALUES ($1, $2, $3, 'NEW_BUSINESS_FORMATION', 'W project')`,
      [matterW, BIZ_W, USER_W]
    );
    assert.equal((await store.accessibleMatter(pool, matterW, USER_V))?.can_edit, false);
    assert.equal((await store.accessibleMatter(pool, matterW, USER_C))?.can_edit, true);
  });

  let second: Awaited<ReturnType<typeof store.createLocation>>;

  test("multiple locations per business, exactly one primary", async () => {
    const bizA = (await store.accessibleBusiness(pool, BIZ_A, USER_A))!;
    second = await store.createLocation(pool, bizA, USER_A, input({ name: "Warehouse", latitude: 18.3985, longitude: -66.1557, is_primary: true }));
    const third = await store.createLocation(pool, bizA, USER_A, input({ name: "Solar site", latitude: 18.0111, longitude: -66.6141 }));
    assert.equal(third.is_primary, false);
    const list = await store.listLocationsForBusiness(pool, bizA);
    assert.equal(list.length, 3);
    assert.deepEqual(list.filter((l) => l.is_primary).map((l) => l.id), [second.id]);
    assert.equal(new Set(list.map((l) => l.id)).size, 3);
    await assert.rejects(
      pool.query(`UPDATE locations SET is_primary=true WHERE id=$1`, [first.id]),
      /uq_locations_primary/,
      "the database itself enforces a single primary"
    );
  });

  test("projects reference locations by stable id, only within their own business", async () => {
    const matterA = await store.accessibleMatter(pool, MATTER_A, USER_A);
    assert.ok(matterA);
    assert.equal(await store.accessibleMatter(pool, MATTER_A, USER_B), null, "another tenant cannot see the project");
    assert.deepEqual(await store.assignLocationToMatter(pool, matterA, second.id), { ok: true });
    const reread = await store.accessibleMatter(pool, MATTER_A, USER_A);
    assert.equal(reread?.location_id, second.id);

    // Another business's location: rejected by the app and by the DB trigger.
    const bizB = (await store.accessibleBusiness(pool, BIZ_B, USER_B))!;
    const locB = await store.createLocation(pool, bizB, USER_B, input());
    assert.deepEqual(await store.assignLocationToMatter(pool, matterA, locB.id), { ok: false, error: "location_not_found" });
    await assert.rejects(
      pool.query(`UPDATE matters SET location_id=$2 WHERE id=$1`, [MATTER_A, locB.id]),
      /cannot reference location/
    );
    const matterB = (await store.accessibleMatter(pool, MATTER_B, USER_B))!;
    assert.deepEqual(await store.assignLocationToMatter(pool, matterB, second.id), { ok: false, error: "location_not_found" });
  });

  test("the project's location context is exposed for the requirements engine", async () => {
    const matterA = (await store.accessibleMatter(pool, MATTER_A, USER_A))!;
    const ctx = await store.locationContextForMatter(pool, matterA);
    assert.ok(ctx);
    assert.equal(ctx.location_id, second.id);
    assert.equal(ctx.business_id, BIZ_A);
    assert.equal(ctx.coordinates.latitude, 18.3985);
    const { locationEngineFacts, withLocationContext } = await import("./locationContext.ts");
    assert.equal(locationEngineFacts(ctx).projectFacts["location.id"], second.id);
    assert.equal(withLocationContext({ answers: {} }, ctx).locationId, second.id);
  });

  test("map-layer determinations (FEMA flood zone, JP calificación, CRIM parcel) become location facts with provenance", async () => {
    const { parseFemaFlood, parseJpCalificacion, parseCrimParcel } = await import("./layers.ts");
    const { readFileSync } = await import("node:fs");
    const fx = JSON.parse(readFileSync(new URL("./fixtures/arcgisLayers.json", import.meta.url), "utf8"));
    const at = "2026-09-30T21:30:00.000Z";
    const jp = parseJpCalificacion(fx.responses["jp_calif:toa_baja_ae"], at);
    const layers = {
      latitude: 18.3985,
      longitude: -66.1,
      resolved_at: at,
      results: [
        parseFemaFlood(fx.responses["fema_zones:toa_baja_ae"], fx.responses["fema_panels:toa_baja_ae"], at),
        jp.zoning,
        jp.land_class,
        parseCrimParcel(fx.responses["crim:toa_baja_ae"], at),
      ],
    };
    const written = await store.recordLayerDeterminations(pool, second.id, layers);
    assert.ok(written >= 6, `rows written: ${written}`);
    // Re-recording supersedes instead of duplicating.
    await store.recordLayerDeterminations(pool, second.id, layers);
    const cur = await pool.query(
      `SELECT geography_type, geography_code, source_id, source_version, metadata FROM location_geographies
        WHERE location_id=$1 AND superseded_at IS NULL AND geography_type='flood_zone' ORDER BY geography_code`,
      [second.id]
    );
    assert.deepEqual(cur.rows.map((r) => r.geography_code), ["AE", "SFHA"]);
    assert.equal(cur.rows[0].source_id, "fema-nfhl-s_fld_haz_ar");
    assert.match(cur.rows[0].source_version, /72000C0330J · 2009-11-18/);
    assert.equal(cur.rows[0].metadata.dataset_date, "2009-11-18");
    const matterA = (await store.accessibleMatter(pool, MATTER_A, USER_A))!;
    const ctx = (await store.locationContextForMatter(pool, matterA))!;
    const { locationEngineFacts } = await import("./locationContext.ts");
    const facts = locationEngineFacts(ctx).projectFacts;
    assert.equal(facts["location.flood_zone.ae"], true);
    assert.equal(facts["location.flood_zone.sfha"], true);
    assert.equal(facts["location.land_class.srep"], true);
    assert.equal(facts["location.parcel_id"], "038-000-010-13");
  });

  test("deleting a location keeps the project (location unassigned) and promotes a new primary", async () => {
    const bizA = (await store.accessibleBusiness(pool, BIZ_A, USER_A))!;
    const result = await store.deleteLocation(pool, bizA, second.id);
    assert.deepEqual(result, { deleted: true, wasPrimary: true, unassignedProjects: 1 });
    const m = await pool.query(`SELECT title, location_id FROM matters WHERE id=$1`, [MATTER_A]);
    assert.equal(m.rows[0].title, "Plant permits");
    assert.equal(m.rows[0].location_id, null);
    const list = await store.listLocationsForBusiness(pool, bizA);
    assert.deepEqual(list.filter((l) => l.is_primary).map((l) => l.id), [first.id], "oldest remaining becomes primary");
  });

  test("mutations are audited without copying coordinates or address text", async () => {
    await store.auditLocationEvent(pool, {
      action: "location_updated",
      actorUserId: USER_A,
      workspaceId: null,
      targetType: "location",
      targetId: first.id,
      detail: { business_id: BIZ_A, fields_changed: ["name"], moved: false },
    });
    const { rows } = await pool.query(`SELECT action, target_id, "after" FROM audit_events WHERE target_id=$1`, [first.id]);
    assert.equal(rows[0].action, "location_updated");
    assert.doesNotMatch(JSON.stringify(rows[0].after), /18\.39|66\.11|Example Street/);
  });

  test("geocoding slots are shared across instances through the database", async () => {
    const { pgSlotReserver } = await import("../../lib/geocoding/slots.ts");
    // Two reservers = two server instances sharing one limiter row.
    const a = pgSlotReserver(pool, "test-limiter", 1100);
    const b = pgSlotReserver(pool, "test-limiter", 1100);
    const waits = (await Promise.all([a(), b(), a(), b()])).map((w) => w ?? -1).sort((x, y) => x - y);
    // Distinct slots 1.1 s apart (allowing a little DB clock progression).
    for (let i = 0; i < waits.length; i++) {
      assert.ok(Math.abs(waits[i] - i * 1100) < 250, `slot ${i}: waited ${waits[i]}ms`);
    }
  });

  test("the database rejects out-of-range coordinates even if app validation were bypassed", async () => {
    await assert.rejects(
      pool.query(`INSERT INTO locations (id, business_id, created_by_user_id, latitude, longitude) VALUES ($1,$2,$3,91,0)`, [
        randomUUID(),
        BIZ_A,
        USER_A,
      ]),
      /check constraint/
    );
  });
});

describe("Spatial enrichment with PostGIS", { skip }, () => {
  let gisPool: Pool | null = null;
  let available = false;

  before(async () => {
    const probe = new Pool({ connectionString: ADMIN_URL, ssl: process.env.PGSSL_DISABLE ? undefined : { rejectUnauthorized: false } });
    const { rows } = await probe.query(`SELECT 1 FROM pg_available_extensions WHERE name='postgis'`);
    available = rows.length > 0;
    if (available) await probe.query(`CREATE DATABASE ${GIS_DB}`);
    await probe.end();
    if (!available) return;
    gisPool = new Pool({ connectionString: dbUrl(GIS_DB), ssl: process.env.PGSSL_DISABLE ? undefined : { rejectUnauthorized: false } });
    await gisPool.query(`CREATE EXTENSION postgis`);
    await seedPreLocationsSchema(gisPool);
    const { splitSqlStatements } = await import("../graph/sqlStatements.ts");
    const { LOCATIONS_SCHEMA_SQL } = await import("./schema.ts");
    for (const s of splitSqlStatements(LOCATIONS_SCHEMA_SQL)) await gisPool.query(s);
    geo = await import("./geo.ts");
    store = await import("./store.ts");
  });

  after(async () => {
    await gisPool?.end().catch(() => {});
    if (available) {
      const cleanup = new Pool({ connectionString: ADMIN_URL, ssl: process.env.PGSSL_DISABLE ? undefined : { rejectUnauthorized: false } });
      await cleanup.query(`DROP DATABASE IF EXISTS ${GIS_DB} WITH (FORCE)`).catch(() => {});
      await cleanup.end();
    }
  });

  test("a point inside a loaded boundary gets an explainable SPATIAL_INTERSECTION record", async (t) => {
    if (!available) return t.skip("postgis not available on the test server");
    const p = gisPool!;
    const cols = await p.query(`SELECT 1 FROM information_schema.columns WHERE table_name='locations' AND column_name='geom'`);
    assert.equal(cols.rows.length, 1, "geometry column created when PostGIS exists");
    const bizA = (await store.accessibleBusiness(p, BIZ_A, USER_A))!;

    const fixtureRows = <T extends { source_id: string }>(gs: T[]): T[] => gs.filter((g) => g.source_id === "test-fixture-municipios");
    // No datasets loaded → nothing determined from datasets (never invented).
    const bare = await store.createLocation(p, bizA, USER_A, input({ latitude: 18.39, longitude: -66.11 }));
    assert.deepEqual(fixtureRows(bare.geographies), []);

    // TEST FIXTURE ONLY: a synthetic square, not a real boundary.
    await p.query(`INSERT INTO geo_datasets (id, geography_type, name, publisher, source_url, version)
                   VALUES ('test-fixture-municipios', 'municipality', 'Test fixture boundaries', 'SmartPR tests', 'https://example.test/fixture', 'fixture-1')`);
    await p.query(
      `INSERT INTO geo_features (id, dataset_id, geography_type, code, name, geom)
       VALUES ($1, 'test-fixture-municipios', 'municipality', 'T01', 'Fixture Municipio',
               ST_Multi(ST_MakeEnvelope(-66.2, 18.3, -66.0, 18.5, 4326)))`,
      [randomUUID()]
    );
    const inside = await store.createLocation(p, bizA, USER_A, input({ latitude: 18.39123, longitude: -66.11784 }));
    assert.equal(fixtureRows(inside.geographies).length, 1);
    const g = fixtureRows(inside.geographies)[0];
    assert.equal(g.geography_type, "municipality");
    assert.equal(g.geography_name, "Fixture Municipio");
    assert.equal(g.determination_method, "SPATIAL_INTERSECTION");
    assert.equal(g.source_id, "test-fixture-municipios");
    assert.equal(g.source_version, "fixture-1");
    assert.equal(g.source_url, "https://example.test/fixture");

    const { buildLocationContext, locationEngineFacts } = await import("./locationContext.ts");
    const facts = locationEngineFacts(buildLocationContext(inside, inside.geographies)).projectFacts;
    assert.equal(facts["location.municipality.fixture_municipio"], true);
    assert.equal(facts["location.municipality.guaynabo"], true, "the Census determination is a fact too");

    const outside = await store.createLocation(p, bizA, USER_A, input({ latitude: 18.0111, longitude: -66.6141 }));
    assert.deepEqual(fixtureRows(outside.geographies), []);

    // Moving the pin out of the boundary supersedes the determination.
    const moved = await store.updateLocation(p, bizA, USER_A, inside.id, input({ latitude: 18.0111, longitude: -66.6141 }));
    assert.deepEqual(fixtureRows(moved?.location.geographies ?? []), []);
    // Re-evaluation against the current dataset is repeatable.
    await store.updateLocation(p, bizA, USER_A, inside.id, input({ latitude: 18.39123, longitude: -66.11784 }));
    assert.equal(await store.enrichLocationFromDatasets(p, inside.id), 1);
    const current = await p.query(
      `SELECT count(*)::int AS n FROM location_geographies
        WHERE location_id=$1 AND superseded_at IS NULL AND source_id='test-fixture-municipios'`,
      [inside.id]
    );
    assert.equal(current.rows[0].n, 1, "re-running enrichment never duplicates current facts");
  });
});
