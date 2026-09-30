// ============================================================================
// Passport Locations — server-side persistence.
//
// Tenant isolation: every read and write is scoped through the business the
// caller can access (owner, or member of the business's workspace — the same
// rule as /api/businesses/[id]). Ownership columns are derived here, never
// taken from the request. A location that does not exist and a location that
// belongs to someone else are indistinguishable to the caller (both null).
// ============================================================================

import { randomUUID } from "crypto";
import type { Pool, PoolClient } from "pg";
import { writeAuditEvent } from "../../lib/enterprise-permissions";
import { resolveBusinessUuid } from "../graph/store";
import {
  COORDINATE_SYSTEM,
  type LocationGeography,
  type LocationWriteInput,
  type PassportLocation,
  type PassportLocationWithGeographies,
} from "./geo";
import { buildLocationContext, type LocationContext } from "./locationContext";

type Db = Pool | PoolClient;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export interface AccessibleBusiness {
  id: string;
  workspace_id: string | null;
}

/** Resolve a business id (public id or UUID) the user may access, else null. */
export async function accessibleBusiness(
  db: Db,
  rawBusinessId: string,
  userId: string
): Promise<AccessibleBusiness | null> {
  const uuid = await resolveBusinessUuid(db, rawBusinessId);
  if (!uuid) return null;
  const { rows } = await db.query<AccessibleBusiness>(
    `SELECT b.id, b.workspace_id FROM businesses b
       LEFT JOIN workspace_members wm ON wm.workspace_id=b.workspace_id AND wm.user_id=$2
      WHERE b.id=$1 AND b.archived=false AND (b.user_id=$2 OR wm.user_id IS NOT NULL)`,
    [uuid, userId]
  );
  return rows[0] ?? null;
}

const LOCATION_COLUMNS = `l.id, l.business_id, l.name, l.is_primary, l.latitude, l.longitude,
  l.coordinate_system, l.coordinate_source, l.address_line_1, l.address_line_2, l.city,
  l.municipality, l.state_or_region, l.postal_code, l.country_code, l.formatted_address,
  l.address_source, l.place_source, l.place_source_id, l.confirmed_at, l.created_at, l.updated_at`;

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value ?? "");
}

function toLocation(row: Record<string, unknown>): PassportLocation {
  return {
    id: String(row.id),
    business_id: String(row.business_id),
    name: (row.name as string | null) ?? null,
    is_primary: row.is_primary === true,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    coordinate_system: COORDINATE_SYSTEM,
    coordinate_source: row.coordinate_source as PassportLocation["coordinate_source"],
    address_line_1: (row.address_line_1 as string | null) ?? null,
    address_line_2: (row.address_line_2 as string | null) ?? null,
    city: (row.city as string | null) ?? null,
    municipality: (row.municipality as string | null) ?? null,
    state_or_region: (row.state_or_region as string | null) ?? null,
    postal_code: (row.postal_code as string | null) ?? null,
    country_code: (row.country_code as string | null) ?? null,
    formatted_address: (row.formatted_address as string | null) ?? null,
    address_source: row.address_source as PassportLocation["address_source"],
    place_source: (row.place_source as string | null) ?? null,
    place_source_id: (row.place_source_id as string | null) ?? null,
    confirmed_at: iso(row.confirmed_at),
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  };
}

function toGeography(row: Record<string, unknown>): LocationGeography {
  return {
    id: String(row.id),
    location_id: String(row.location_id),
    geography_type: String(row.geography_type),
    geography_code: (row.geography_code as string | null) ?? null,
    geography_name: (row.geography_name as string | null) ?? null,
    determination_method: row.determination_method as LocationGeography["determination_method"],
    source_id: String(row.source_id),
    source_name: (row.source_name as string | null) ?? null,
    source_version: (row.source_version as string | null) ?? null,
    source_url: (row.source_url as string | null) ?? null,
    determined_at: iso(row.determined_at),
    metadata: (row.metadata as Record<string, unknown>) ?? {},
  };
}

async function currentGeographies(db: Db, locationIds: string[]): Promise<LocationGeography[]> {
  if (!locationIds.length) return [];
  const { rows } = await db.query(
    `SELECT id, location_id, geography_type, geography_code, geography_name, determination_method,
            source_id, source_name, source_version, source_url, determined_at, metadata
       FROM location_geographies
      WHERE location_id = ANY($1::uuid[]) AND superseded_at IS NULL
      ORDER BY geography_type, determined_at DESC`,
    [locationIds]
  );
  return rows.map(toGeography);
}

function attach(locations: PassportLocation[], geographies: LocationGeography[]): PassportLocationWithGeographies[] {
  return locations.map((l) => ({ ...l, geographies: geographies.filter((g) => g.location_id === l.id) }));
}

/** All locations of an accessible business, primary first. */
export async function listLocationsForBusiness(
  db: Db,
  business: AccessibleBusiness
): Promise<PassportLocationWithGeographies[]> {
  const { rows } = await db.query(
    `SELECT ${LOCATION_COLUMNS} FROM locations l
      WHERE l.business_id=$1 ORDER BY l.is_primary DESC, l.created_at ASC, l.id ASC`,
    [business.id]
  );
  const locations = rows.map(toLocation);
  return attach(locations, await currentGeographies(db, locations.map((l) => l.id)));
}

/** One location, only if it belongs to the (already authorized) business. */
export async function getLocation(
  db: Db,
  business: AccessibleBusiness,
  locationId: string
): Promise<PassportLocationWithGeographies | null> {
  if (!isUuid(locationId)) return null;
  const { rows } = await db.query(
    `SELECT ${LOCATION_COLUMNS} FROM locations l WHERE l.id=$1 AND l.business_id=$2`,
    [locationId, business.id]
  );
  if (!rows[0]) return null;
  const location = toLocation(rows[0]);
  return attach([location], await currentGeographies(db, [location.id]))[0];
}

// ---------------------------------------------------------------------------
// Audit (best-effort; only where the audit_events table exists)
// ---------------------------------------------------------------------------

let auditTableKnown: Promise<boolean> | null = null;

async function auditAvailable(db: Db): Promise<boolean> {
  if (!auditTableKnown) {
    auditTableKnown = db
      .query<{ ok: boolean }>(`SELECT to_regclass('public.audit_events') IS NOT NULL AS ok`)
      .then((r) => r.rows[0]?.ok === true)
      .catch(() => {
        auditTableKnown = null;
        return false;
      });
  }
  return auditTableKnown;
}

export type LocationAuditAction =
  | "location_created"
  | "location_updated"
  | "location_deleted"
  | "project_location_assigned";

/**
 * Audit a location mutation. Records identifiers and which fields changed —
 * never the coordinates or address text themselves (a home-based business's
 * pin is personal data; the audit trail does not need to replicate it).
 */
export async function auditLocationEvent(
  db: Pool,
  event: {
    action: LocationAuditAction;
    actorUserId: string;
    workspaceId: string | null;
    targetType: "location" | "matter";
    targetId: string;
    detail: Record<string, unknown>;
  }
): Promise<void> {
  if (!(await auditAvailable(db))) return;
  await writeAuditEvent(db, {
    actorUserId: event.actorUserId,
    workspaceId: event.workspaceId,
    action: event.action,
    targetType: event.targetType,
    targetId: event.targetId,
    after: event.detail,
    source: "ui",
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

async function inTransaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

const WRITE_FIELDS = [
  "name",
  "latitude",
  "longitude",
  "coordinate_source",
  "address_line_1",
  "address_line_2",
  "city",
  "municipality",
  "state_or_region",
  "postal_code",
  "country_code",
  "formatted_address",
  "address_source",
  "place_source",
  "place_source_id",
] as const satisfies readonly (keyof LocationWriteInput)[];

function writeValues(input: LocationWriteInput): unknown[] {
  return WRITE_FIELDS.map((key) => input[key]);
}

/** createLocation — the first location of a business becomes its primary. */
export async function createLocation(
  pool: Pool,
  business: AccessibleBusiness,
  userId: string,
  input: LocationWriteInput
): Promise<PassportLocationWithGeographies> {
  const id = randomUUID();
  await inTransaction(pool, async (client) => {
    // Serialize primary-flag changes per business.
    await client.query(`SELECT id FROM businesses WHERE id=$1 FOR UPDATE`, [business.id]);
    const { rows } = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM locations WHERE business_id=$1`,
      [business.id]
    );
    const makePrimary = input.is_primary ?? rows[0].n === 0;
    if (makePrimary) {
      await client.query(`UPDATE locations SET is_primary=false, updated_at=now() WHERE business_id=$1 AND is_primary`, [
        business.id,
      ]);
    }
    const cols = WRITE_FIELDS.join(", ");
    const params = WRITE_FIELDS.map((_, i) => `$${i + 6}`).join(", ");
    await client.query(
      `INSERT INTO locations (id, business_id, workspace_id, created_by_user_id, is_primary, ${cols})
       VALUES ($1, $2, $3, $4, $5, ${params})`,
      [id, business.id, business.workspace_id, userId, makePrimary, ...writeValues(input)]
    );
  });
  await enrichLocationFromDatasets(pool, id);
  const created = await getLocation(pool, business, id);
  if (!created) throw new Error("location_create_readback_failed");
  return created;
}

/**
 * updateLocation — replaces the editable fields. When the point moves, every
 * current geography determination is superseded (it described the old point)
 * and spatial enrichment re-runs for the new one.
 */
export async function updateLocation(
  pool: Pool,
  business: AccessibleBusiness,
  userId: string,
  locationId: string,
  input: LocationWriteInput
): Promise<{ location: PassportLocationWithGeographies; moved: boolean; changed: string[] } | null> {
  if (!isUuid(locationId)) return null;
  const result = await inTransaction(pool, async (client) => {
    await client.query(`SELECT id FROM businesses WHERE id=$1 FOR UPDATE`, [business.id]);
    const { rows } = await client.query(
      `SELECT ${LOCATION_COLUMNS} FROM locations l WHERE l.id=$1 AND l.business_id=$2 FOR UPDATE`,
      [locationId, business.id]
    );
    if (!rows[0]) return null;
    const before = toLocation(rows[0]);
    const moved = before.latitude !== input.latitude || before.longitude !== input.longitude;
    const changed: string[] = WRITE_FIELDS.filter((key) => before[key] !== input[key]);
    if (input.is_primary === true && !before.is_primary) {
      await client.query(`UPDATE locations SET is_primary=false, updated_at=now() WHERE business_id=$1 AND is_primary`, [
        business.id,
      ]);
      changed.push("is_primary");
    }
    const assignments = WRITE_FIELDS.map((key, i) => `${key}=$${i + 4}`).join(", ");
    await client.query(
      `UPDATE locations SET ${assignments},
              is_primary = CASE WHEN $3::boolean THEN true ELSE is_primary END,
              updated_by_user_id=$${WRITE_FIELDS.length + 4},
              confirmed_at = CASE WHEN $${WRITE_FIELDS.length + 5}::boolean THEN now() ELSE confirmed_at END,
              updated_at=now()
        WHERE id=$1 AND business_id=$2`,
      [locationId, business.id, input.is_primary === true, ...writeValues(input), userId, moved]
    );
    if (moved) {
      await client.query(
        `UPDATE location_geographies SET superseded_at=now() WHERE location_id=$1 AND superseded_at IS NULL`,
        [locationId]
      );
    }
    return { moved, changed };
  });
  if (!result) return null;
  if (result.moved) await enrichLocationFromDatasets(pool, locationId);
  const location = await getLocation(pool, business, locationId);
  return location ? { location, ...result } : null;
}

/** deleteLocation — projects keep existing (their location_id becomes null). */
export async function deleteLocation(
  pool: Pool,
  business: AccessibleBusiness,
  locationId: string
): Promise<{ deleted: boolean; wasPrimary: boolean; unassignedProjects: number }> {
  if (!isUuid(locationId)) return { deleted: false, wasPrimary: false, unassignedProjects: 0 };
  return inTransaction(pool, async (client) => {
    await client.query(`SELECT id FROM businesses WHERE id=$1 FOR UPDATE`, [business.id]);
    const projects = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM matters WHERE location_id=$1 AND business_id=$2`,
      [locationId, business.id]
    );
    const { rows } = await client.query<{ is_primary: boolean }>(
      `DELETE FROM locations WHERE id=$1 AND business_id=$2 RETURNING is_primary`,
      [locationId, business.id]
    );
    if (!rows[0]) return { deleted: false, wasPrimary: false, unassignedProjects: 0 };
    if (rows[0].is_primary) {
      // Keep "primary" meaningful: promote the oldest remaining location.
      await client.query(
        `UPDATE locations SET is_primary=true, updated_at=now()
          WHERE id = (SELECT id FROM locations WHERE business_id=$1 ORDER BY created_at ASC, id ASC LIMIT 1)`,
        [business.id]
      );
    }
    return { deleted: true, wasPrimary: rows[0].is_primary, unassignedProjects: projects.rows[0]?.n ?? 0 };
  });
}

// ---------------------------------------------------------------------------
// Projects (matters) ↔ locations
// ---------------------------------------------------------------------------

export interface AccessibleMatter {
  id: string;
  business_id: string;
  workspace_id: string | null;
  location_id: string | null;
}

/**
 * A matter the user can access through its business (owner or workspace
 * member), else null. Having created the matter is not enough: someone who
 * lost access to the business must not read its location data.
 */
export async function accessibleMatter(db: Db, matterId: string, userId: string): Promise<AccessibleMatter | null> {
  if (!isUuid(matterId)) return null;
  const { rows } = await db.query<AccessibleMatter>(
    `SELECT m.id, m.business_id, b.workspace_id, m.location_id
       FROM matters m
       JOIN businesses b ON b.id = m.business_id
       LEFT JOIN workspace_members wm ON wm.workspace_id=b.workspace_id AND wm.user_id=$2
      WHERE m.id=$1 AND b.archived=false AND (b.user_id=$2 OR wm.user_id IS NOT NULL)`,
    [matterId, userId]
  );
  return rows[0] ?? null;
}

/**
 * assignLocationToProject — bind a project to one of ITS business's saved
 * locations (or clear it with null). A location of another business — even
 * one the user can otherwise access — is rejected; the DB trigger enforces
 * the same invariant.
 */
export async function assignLocationToMatter(
  db: Db,
  matter: AccessibleMatter,
  locationId: string | null
): Promise<{ ok: true } | { ok: false; error: "location_not_found" }> {
  if (locationId !== null) {
    if (!isUuid(locationId)) return { ok: false, error: "location_not_found" };
    const { rows } = await db.query(`SELECT 1 FROM locations WHERE id=$1 AND business_id=$2`, [
      locationId,
      matter.business_id,
    ]);
    if (!rows[0]) return { ok: false, error: "location_not_found" };
  }
  await db.query(`UPDATE matters SET location_id=$2, updated_at=now() WHERE id=$1 AND business_id=$3`, [
    matter.id,
    locationId,
    matter.business_id,
  ]);
  return { ok: true };
}

/**
 * The structured location context for a project, for the requirements
 * engine (see locationContext.ts withLocationContext). Loaded fresh on every
 * evaluation: geography determinations reflect the current datasets, and no
 * requirement is ever stored on the location.
 */
export async function locationContextForMatter(db: Db, matter: AccessibleMatter): Promise<LocationContext | null> {
  if (!matter.location_id) return null;
  const location = await getLocation(db, { id: matter.business_id, workspace_id: matter.workspace_id }, matter.location_id);
  return location ? buildLocationContext(location, location.geographies) : null;
}

// ---------------------------------------------------------------------------
// Spatial enrichment (PostGIS + loaded datasets only)
// ---------------------------------------------------------------------------

/** Schema where PostGIS lives, when geo_features exists; else null. */
async function spatialSchema(db: Db): Promise<string | null> {
  const { rows } = await db.query<{ schema: string | null; features: boolean }>(
    `SELECT (SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace
              WHERE e.extname='postgis') AS schema,
            to_regclass('public.geo_features') IS NOT NULL AS features`
  );
  const row = rows[0];
  return row?.schema && row.features ? row.schema : null;
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Determine which loaded, active dataset features cover the location's point
 * and record each as a SPATIAL_INTERSECTION geography with the dataset's
 * source and version. Previous spatial determinations for the location are
 * superseded (kept for history). A no-op without PostGIS or without data —
 * SmartPR never fills boundaries it has not actually computed.
 *
 * Best-effort: an enrichment failure never fails the save of the point.
 */
export async function enrichLocationFromDatasets(pool: Pool, locationId: string): Promise<number> {
  try {
    const gis = await spatialSchema(pool);
    if (!gis) return 0;
    return await inTransaction(pool, async (client) => {
      await client.query(
        `UPDATE location_geographies SET superseded_at=now()
          WHERE location_id=$1 AND determination_method='SPATIAL_INTERSECTION' AND superseded_at IS NULL`,
        [locationId]
      );
      const { rowCount } = await client.query(
        `INSERT INTO location_geographies
           (id, location_id, geography_type, geography_code, geography_name, determination_method,
            source_id, source_name, source_version, source_url, determined_at, metadata)
         SELECT gen_random_uuid(), l.id, f.geography_type, f.code, f.name, 'SPATIAL_INTERSECTION',
                d.id, d.name, d.version, d.source_url, now(),
                jsonb_build_object('feature_id', f.id, 'predicate', 'ST_Covers', 'dataset_publisher', d.publisher)
           FROM locations l
           JOIN geo_features f ON ${quoteIdent(gis)}.ST_Covers(f.geom, l.geom)
           JOIN geo_datasets d ON d.id = f.dataset_id AND d.active
          WHERE l.id = $1`,
        [locationId]
      );
      return rowCount ?? 0;
    });
  } catch (err) {
    console.error("[locations] spatial enrichment failed:", (err as Error).message);
    return 0;
  }
}
