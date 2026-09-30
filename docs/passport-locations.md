# Passport Locations (geospatial foundation)

The Business Passport's **Property / Location** section records the exact
physical point of a business's premises, facility, construction site or
project site. It is the foundation of SmartPR's geospatial regulatory
reasoning:

```
Saved location → exact coordinates → spatial lookup (versioned datasets)
  → municipality / barrio / parcel / zoning / flood / environmental / utility overlays
  → knowledge graph → current rules → requirements → gap analysis → readiness
```

**The map determines location facts. The rules engine decides what they
mean.** No permitting rule lives in the map, the picker, or the location
store, and no LLM is ever asked whether a point falls inside a boundary.

## Where it lives

| Surface | File |
| --- | --- |
| Passport section (inside `BusinessPassportPanel`) | `frontend/src/app/businesses/PassportLocationSection.tsx` |
| Add / edit dialog (search, map, drag, manual lat/lng, confirm) | `frontend/src/app/businesses/LocationPickerDialog.tsx` |
| Map component (MapLibre GL) | `frontend/src/app/components/map/PassportMap.tsx` |
| Domain model + validation (pure) | `frontend/src/app/locations/geo.ts` |
| Engine / graph context (pure) | `frontend/src/app/locations/locationContext.ts` |
| Persistence, tenancy, enrichment | `frontend/src/app/locations/store.ts` |
| Runtime schema (bootstrap) | `frontend/src/app/locations/schema.ts` |
| Migration (explicit) | `data/locations_schema.sql` |
| Geocoding provider abstraction | `frontend/src/lib/geocoding/index.ts` |

## Data model

```
businesses 1─* locations 1─* location_geographies
matters    *─1 locations            (a project references a location by id)
facilities *─1 locations            (enterprise; only where that table exists)
geo_datasets 1─* geo_features       (versioned reference polygons; PostGIS)
```

**`locations`** — a confirmed point. `latitude` / `longitude` (WGS84,
`EPSG:4326`, 7 decimals ≈ 1 cm) are canonical and always present, with or
without PostGIS. Address columns (`formatted_address`, `address_line_1/2`,
`city`, `municipality`, `state_or_region`, `postal_code`, `country_code`)
are metadata whose provenance is `address_source`:
`NONE | USER_PROVIDED | PROVIDER_GEOCODE | PROVIDER_REVERSE_GEOCODE`.
`coordinate_source` records how the point was chosen:
`MAP_PIN | MANUAL_ENTRY | GEOCODED_ADDRESS`. `is_primary` (one per business,
enforced by a partial unique index). Ownership: `business_id` (FK, cascade),
`workspace_id`, `created_by_user_id`, `updated_by_user_id` — always derived
server-side. With PostGIS: generated `geom geometry(Point, 4326)` + GiST index.

**`location_geographies`** — one explainable geographic fact per row:
`geography_type` (open, pattern-checked: `municipality`, `barrio`, `parcel`,
`zoning_district`, `flood_zone`, `historic_district`, `coastal_zone`,
`environmental_zone`, `planning_zone`, `utility_service_area`,
`special_overlay`, …), `geography_code` / `geography_name`,
`determination_method` (`SPATIAL_INTERSECTION | OFFICIAL_RECORD |
USER_PROVIDED | PROVIDER_GEOCODE`), `source_id`, `source_name`,
`source_version`, `source_url`, `determined_at`, `superseded_at`, `metadata`.
Moving a pin supersedes (never deletes) every current fact about the old point.

**`geo_datasets` / `geo_features`** — global reference data for spatial
lookup (not tenant data). Each dataset has an id, publisher, source URL,
**version**, license and retrieval date; features are `MultiPolygon, 4326`
with a GiST index. **Both are empty until real data is loaded.**

**Property vs. Location.** A Location is a point + address + boundaries.
SmartPR has no Property model yet; property facts (occupancy, owner, cadastral
number entered by the user) remain Passport fields (`property.*`). A future
`properties` table (parcel, ownership/lease, structures, permit history)
should reference `locations.id` rather than duplicating coordinates.

## Provenance rules (never invent)

- The UI shows Barrio / Parcel / Zoning / other overlays **only** from a
  `SPATIAL_INTERSECTION` or `OFFICIAL_RECORD` determination (or clearly
  labeled user entry); otherwise "Not yet determined".
- Municipality from an address lookup is shown as
  "From address lookup — not boundary-verified" and is **never** an engine
  fact. The authoritative municipality comes from spatial intersection with a
  municipal-boundary dataset.
- Every determination can answer "Why?": the dataset, its version, the
  source URL, and when it was checked.

## Spatial enrichment

`enrichLocationFromDatasets()` runs after a location is created or moved:
when PostGIS and `geo_features` exist, it records every active dataset
feature that `ST_Covers` the point as a `SPATIAL_INTERSECTION` geography with
the dataset's source/version, superseding earlier spatial determinations.
Without PostGIS or without data it is a no-op. Enrichment failures never
block saving the point.

Loading a dataset (example shape):

```sql
INSERT INTO geo_datasets (id, geography_type, name, publisher, source_url, version, license, retrieved_at)
VALUES ('pr-municipios-<source>-<version>', 'municipality', '<name>', '<publisher>', '<url>', '<version>', '<license>', now());
INSERT INTO geo_features (id, dataset_id, geography_type, code, name, geom)
SELECT gen_random_uuid(), 'pr-municipios-<source>-<version>', 'municipality', <code>, <name>,
       ST_Multi(ST_Transform(<geom>, 4326))
  FROM <staging table>;
```

To re-evaluate existing locations against a newly loaded dataset, call
`enrichLocationFromDatasets(pool, locationId)` for each location (a batch
job is a natural follow-up). Mark superseded dataset versions `active=false`.

### Datasets still to add

None are bundled — each needs an authoritative source, license review and a
loader:

- Municipal boundaries (78 municipios) and barrios — e.g. US Census TIGER/Line
  (county-equivalent and county-subdivision layers for PR).
- Parcels / cadastral — CRIM catastro.
- Zoning / land-use districts and planning overlays — Junta de Planificación
  (calificación, special planning areas).
- Flood zones — FEMA National Flood Hazard Layer (effective FIRM panels).
- Coastal zone management boundary, environmental / protected areas
  (DRNA, Programa de Manejo de la Zona Costanera).
- Historic districts — Oficina Estatal de Conservación Histórica / ICP.
- Utility and interconnection territories — LUMA / PREPA / NEPR where
  published.

## Requirements engine integration

`locationContextForMatter()` loads a project's location (fresh, on every
evaluation). `withLocationContext(engineInput, ctx)` merges it into the
existing `EngineInput`:

- `locationId` binds the evaluation to that location.
- `projectFacts` gains `location.*` keys: `location.id`,
  `location.latitude`, `location.longitude`,
  `location.within_puerto_rico_bounds`, and for every **authoritative**
  geography: `location.<type>` = code (or name) and
  `location.<type>.<token>` = `true` for each intersecting feature.
- `factMeta` marks each as `source: "location"`, `scope: "property"`,
  `locationId`.

The engine admits `source: "location"` facts only for project rules and only
when `meta.locationId === input.locationId` (fail closed; blocked attempts
land in `debug.provenanceBlocked`). Future rules are ordinary data, e.g.

```
rule_type: project_fact, fact_key: location.flood_zone.ae, expected_answer: "true"
rule_type: project_fact, fact_key: location.municipality.guaynabo, expected_answer: "true"
```

Requirements are **never stored on a location**; they are re-derived from the
current graph and current datasets each time a project is evaluated. The
production KB has no location rules today, and tests prove adding location
context changes no existing requirement.

`GET /api/matters/:id/location` returns the context and engine facts;
`PUT /api/matters/:id/location {location_id}` assigns (or clears with `null`)
a saved location of the project's own business.

## Knowledge graph

`locationGraphEdges(ctx)` projects: `Business —located_at→ Location`,
`Location —within→ Geography` (partitioning types: municipality, barrio,
parcel, zoning) and `Location —intersects→ Geography` (overlays), each with
evidence (method, dataset id, version, timestamp). Only authoritative
determinations become edges. Regulatory Zone → triggers → Requirement →
derived_from → Regulation edges belong to the regulatory graph.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/businesses/:id/locations` | `listLocationsForPassport` |
| POST | `/api/businesses/:id/locations` | `createLocation` (201; `warnings: ["outside_puerto_rico"]` when applicable) |
| GET | `/api/businesses/:id/locations/:locationId` | `getLocation` |
| PATCH | `/api/businesses/:id/locations/:locationId` | `updateLocation` (full replace of editable fields; `is_primary: true` promotes) |
| DELETE | `/api/businesses/:id/locations/:locationId` | `deleteLocation` (projects keep existing, location unassigned) |
| GET / PUT | `/api/matters/:id/location` | context / `assignLocationToProject` |
| GET | `/api/geocode?q=` · `?lat=&lng=` | server-side search / reverse geocoding |

Coordinates are validated server-side (latitude −90…90, longitude −180…180,
plain decimals only) and by database CHECK constraints. Points outside Puerto
Rico are accepted with a warning — the schema is not Puerto-Rico-only.

## Security / tenancy

- Every query is scoped through a business the caller owns or whose
  workspace they belong to (same rule as `/api/businesses/:id`). Unknown and
  foreign ids both answer 404; location ids are random UUIDs.
- A project can only reference a location of its own business — enforced in
  the store and by the `trg_matters_location_same_business` trigger.
- Supabase RLS (when `auth.uid()` exists) is enabled on `locations`,
  `location_geographies`, `geo_datasets`, `geo_features` with membership
  policies — defense in depth for PostgREST; the app's privileged pool owns
  the tables.
- Audit (`audit_events`, where the enterprise schema is installed):
  `location_created`, `location_updated`, `location_deleted`,
  `project_location_assigned` — ids and changed field names only, never
  coordinates or address text.

## Map and geocoding providers

- **Map: MapLibre GL JS** (BSD, vendor-neutral, strong touch/pinch support).
  Basemap = a style URL: `NEXT_PUBLIC_MAP_STYLE_URL`, default OpenFreeMap
  "liberty" (free, no key). Panning is limited to the Puerto Rico region.
- **Geocoding: optional, server-side.** `MAP_GEOCODING_PROVIDER=nominatim`
  enables a Nominatim-compatible adapter (`MAP_GEOCODING_BASE_URL`,
  `MAP_GEOCODING_API_KEY`, `MAP_GEOCODING_USER_AGENT`, `MAP_GEOCODING_EMAIL`);
  search is bounded to Puerto Rico. Unset = address search shows "not
  available" and users place the pin or type coordinates. Keys never reach
  the browser. OSMF's public Nominatim is for low volume only — use a
  self-hosted or commercial Nominatim-compatible endpoint in production.

## Deployment

1. Deploy — the runtime bootstrap creates the tables (idempotent).
2. Recommended once: run `data/locations_schema.sql` (enables PostGIS where
   permitted, then applies the same statements), or enable PostGIS in
   Supabase → Database → Extensions and redeploy/re-run.
3. Optionally configure geocoding and a basemap style.

## Tests

`npm run test:locations` (pure tests + a PostgreSQL/PostGIS integration
suite when `LOCATIONS_TEST_DATABASE_URL` is set; CI runs it against a
`postgis/postgis` service) and `npm run test:locations:e2e` (browser flow;
dev server running).
