// Passport Locations schema — appended to the idempotent runtime bootstrap
// (graph/store.ts applySchema) after COMPLIANCE_SCHEMA_SQL, and mirrored in
// data/locations_schema.sql for explicit migration/review (a test keeps the
// two in sync).
//
// Everything is additive: new tables, one nullable FK column on matters, and
// guarded DO blocks. No existing row is rewritten or removed.
//
//   businesses 1─* locations 1─* location_geographies
//   matters *─1 locations            (project → the location it concerns)
//   facilities *─1 locations         (enterprise, only when that table exists)
//   geo_datasets 1─* geo_features    (versioned reference polygons; PostGIS)
//
// PostGIS is used when the extension is already installed: a generated
// geometry(Point, 4326) column + GiST index on locations, and the
// geo_features polygon table. It is never installed from here — installing
// an extension needs elevated privileges and is an explicit one-time step
// (see data/locations_schema.sql). Canonical latitude/longitude columns are
// always present, with or without PostGIS.
export const LOCATIONS_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS locations (
  id UUID PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
  created_by_user_id UUID NOT NULL,
  updated_by_user_id UUID,
  name TEXT,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  latitude DOUBLE PRECISION NOT NULL CHECK (latitude >= -90 AND latitude <= 90),
  longitude DOUBLE PRECISION NOT NULL CHECK (longitude >= -180 AND longitude <= 180),
  coordinate_system TEXT NOT NULL DEFAULT 'EPSG:4326' CHECK (coordinate_system = 'EPSG:4326'),
  coordinate_source TEXT NOT NULL DEFAULT 'MAP_PIN' CHECK (coordinate_source IN ('MAP_PIN','MANUAL_ENTRY','GEOCODED_ADDRESS')),
  address_line_1 TEXT,
  address_line_2 TEXT,
  city TEXT,
  municipality TEXT,
  state_or_region TEXT,
  postal_code TEXT,
  country_code TEXT CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$'),
  formatted_address TEXT,
  address_source TEXT NOT NULL DEFAULT 'NONE' CHECK (address_source IN ('NONE','USER_PROVIDED','PROVIDER_GEOCODE','PROVIDER_REVERSE_GEOCODE')),
  place_source TEXT,
  place_source_id TEXT,
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_locations_business ON locations (business_id, created_at);
CREATE INDEX IF NOT EXISTS idx_locations_workspace ON locations (workspace_id);
-- At most one primary location per business.
CREATE UNIQUE INDEX IF NOT EXISTS uq_locations_primary ON locations (business_id) WHERE is_primary;

-- Explainable geographic facts about a location. Each row says HOW it was
-- determined and FROM WHICH dataset/version. Superseded rows are kept for
-- history (a changed pin or a newer dataset supersedes, never deletes).
CREATE TABLE IF NOT EXISTS location_geographies (
  id UUID PRIMARY KEY,
  location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  geography_type TEXT NOT NULL CHECK (geography_type ~ '^[a-z][a-z0-9_]{1,62}$'),
  geography_code TEXT,
  geography_name TEXT,
  determination_method TEXT NOT NULL CHECK (determination_method IN ('SPATIAL_INTERSECTION','OFFICIAL_RECORD','PROVIDER_GEOCODE','USER_PROVIDED')),
  source_id TEXT NOT NULL,
  source_name TEXT,
  source_version TEXT,
  source_url TEXT,
  determined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  superseded_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  CHECK (geography_code IS NOT NULL OR geography_name IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_location_geographies_current ON location_geographies (location_id, geography_type) WHERE superseded_at IS NULL;
-- One current determination per (location, source, type, feature): makes
-- concurrent re-determination (e.g. lazy backfill on read) race-safe.
CREATE UNIQUE INDEX IF NOT EXISTS uq_location_geographies_current
  ON location_geographies (location_id, source_id, geography_type, COALESCE(geography_code, geography_name))
  WHERE superseded_at IS NULL;

-- Versioned reference datasets for spatial lookup (municipal boundaries,
-- barrios, zoning, FEMA flood zones, ...). Global reference data, not
-- tenant data. Empty until a real dataset is loaded — never seeded with
-- placeholder boundaries.
CREATE TABLE IF NOT EXISTS geo_datasets (
  id TEXT PRIMARY KEY,
  geography_type TEXT NOT NULL CHECK (geography_type ~ '^[a-z][a-z0-9_]{1,62}$'),
  name TEXT NOT NULL,
  publisher TEXT,
  source_url TEXT,
  version TEXT NOT NULL,
  license TEXT,
  retrieved_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Shared request-slot schedule for rate-limited geocoding providers (the
-- public Nominatim allows 1 request/second for the whole application, not per
-- server instance). See lib/geocoding/slots.ts.
CREATE TABLE IF NOT EXISTS geocoding_throttle (
  id TEXT PRIMARY KEY,
  next_slot TIMESTAMPTZ NOT NULL
);

-- Projects (matters) reference a Passport location by stable id instead of
-- copying address data. SET NULL keeps the project if a location is removed.
ALTER TABLE matters ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES locations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_matters_location ON matters (location_id) WHERE location_id IS NOT NULL;

-- A project may only reference a location of its own business.
CREATE OR REPLACE FUNCTION smartpr_matter_location_same_business() RETURNS trigger AS $$
BEGIN
  IF NEW.location_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM locations l WHERE l.id = NEW.location_id AND l.business_id = NEW.business_id
  ) THEN
    RAISE EXCEPTION 'matter % cannot reference location % of another business', NEW.id, NEW.location_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_matters_location_same_business ON matters;
CREATE TRIGGER trg_matters_location_same_business
  BEFORE INSERT OR UPDATE OF location_id, business_id ON matters
  FOR EACH ROW EXECUTE FUNCTION smartpr_matter_location_same_business();

-- Enterprise facilities (data/enterprise_schema.sql) can point at the
-- location that carries their coordinates. Only when that table exists.
DO $$
BEGIN
  IF to_regclass('public.facilities') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.facilities ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES locations(id) ON DELETE SET NULL';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_facilities_location ON public.facilities (location_id) WHERE location_id IS NOT NULL';
  END IF;
END $$;

-- PostGIS (only when already installed): point geometry on locations and
-- the polygon feature table. Functions are schema-qualified with wherever
-- the extension lives (public, or extensions on Supabase).
DO $$
DECLARE gis text;
BEGIN
  SELECT n.nspname INTO gis FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'postgis';
  IF gis IS NULL THEN
    RETURN;
  END IF;
  EXECUTE format(
    'ALTER TABLE locations ADD COLUMN IF NOT EXISTS geom %1$I.geometry(Point, 4326) GENERATED ALWAYS AS (%1$I.ST_SetSRID(%1$I.ST_MakePoint(longitude, latitude), 4326)) STORED',
    gis);
  EXECUTE 'CREATE INDEX IF NOT EXISTS idx_locations_geom ON locations USING GIST (geom)';
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS geo_features (
       id UUID PRIMARY KEY,
       dataset_id TEXT NOT NULL REFERENCES geo_datasets(id) ON DELETE CASCADE,
       geography_type TEXT NOT NULL,
       code TEXT,
       name TEXT,
       geom %1$I.geometry(MultiPolygon, 4326) NOT NULL,
       properties JSONB NOT NULL DEFAULT ''{}''::jsonb,
       CHECK (code IS NOT NULL OR name IS NOT NULL)
     )', gis);
  EXECUTE 'CREATE INDEX IF NOT EXISTS idx_geo_features_geom ON geo_features USING GIST (geom)';
  EXECUTE 'CREATE INDEX IF NOT EXISTS idx_geo_features_dataset ON geo_features (dataset_id)';
END $$;

-- Row Level Security (Supabase only: requires auth.uid()). Defense in depth
-- for PostgREST access; the app authorizes every request server-side and
-- queries through its privileged pool, which owns these tables.
DO $$
BEGIN
  IF to_regprocedure('auth.uid()') IS NULL THEN
    RETURN;
  END IF;
  ALTER TABLE locations ENABLE ROW LEVEL SECURITY;
  ALTER TABLE location_geographies ENABLE ROW LEVEL SECURITY;
  ALTER TABLE geo_datasets ENABLE ROW LEVEL SECURITY;
  -- Read: owner or any workspace member. Write: owner or an edit-capable
  -- workspace role (OWNER/ADMIN/MEMBER — mirrors canEditWorkspace; VIEWER reads only).
  DROP POLICY IF EXISTS smartpr_locations_member ON locations;
  DROP POLICY IF EXISTS smartpr_locations_read ON locations;
  DROP POLICY IF EXISTS smartpr_locations_write ON locations;
  CREATE POLICY smartpr_locations_read ON locations FOR SELECT TO authenticated
    USING (EXISTS (
      SELECT 1 FROM businesses b
      LEFT JOIN workspace_members wm ON wm.workspace_id = b.workspace_id AND wm.user_id = auth.uid()
      WHERE b.id = locations.business_id AND b.archived = false AND (b.user_id = auth.uid() OR wm.user_id IS NOT NULL)));
  CREATE POLICY smartpr_locations_write ON locations FOR ALL TO authenticated
    USING (EXISTS (
      SELECT 1 FROM businesses b
      LEFT JOIN workspace_members wm ON wm.workspace_id = b.workspace_id AND wm.user_id = auth.uid()
      WHERE b.id = locations.business_id AND b.archived = false
        AND (b.user_id = auth.uid() OR wm.role IN ('OWNER','ADMIN','MEMBER'))))
    WITH CHECK (EXISTS (
      SELECT 1 FROM businesses b
      LEFT JOIN workspace_members wm ON wm.workspace_id = b.workspace_id AND wm.user_id = auth.uid()
      WHERE b.id = locations.business_id AND b.archived = false
        AND (b.user_id = auth.uid() OR wm.role IN ('OWNER','ADMIN','MEMBER'))));
  DROP POLICY IF EXISTS smartpr_location_geographies_member ON location_geographies;
  CREATE POLICY smartpr_location_geographies_member ON location_geographies FOR SELECT TO authenticated
    USING (EXISTS (
      SELECT 1 FROM locations l
      JOIN businesses b ON b.id = l.business_id
      LEFT JOIN workspace_members wm ON wm.workspace_id = b.workspace_id AND wm.user_id = auth.uid()
      WHERE l.id = location_geographies.location_id AND b.archived = false AND (b.user_id = auth.uid() OR wm.user_id IS NOT NULL)));
  DROP POLICY IF EXISTS smartpr_geo_datasets_read ON geo_datasets;
  CREATE POLICY smartpr_geo_datasets_read ON geo_datasets FOR SELECT TO authenticated USING (true);
  IF to_regclass('public.geo_features') IS NOT NULL THEN
    ALTER TABLE geo_features ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS smartpr_geo_features_read ON geo_features;
    CREATE POLICY smartpr_geo_features_read ON geo_features FOR SELECT TO authenticated USING (true);
  END IF;
END $$;
`;
