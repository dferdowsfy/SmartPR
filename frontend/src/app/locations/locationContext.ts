// ============================================================================
// Location → requirements-engine context (pure).
//
// The map determines location FACTS. The rules engine decides what they MEAN.
// This module only translates a confirmed Passport location (and its
// explainable geography records) into:
//
//   1. LocationContext — a structured, serializable description of the point
//      for project/passport context, APIs, and future graph writers.
//   2. Engine facts — `projectFacts` + `factMeta` entries the existing
//      rules engine can match with ordinary `project_fact` rules, e.g.
//        fact_key "location.flood_zone.ae"   expected "true"
//        fact_key "location.municipality"    expected "guaynabo"
//      No permitting rule lives here, and nothing is concluded here.
//   3. Graph edges — Property/Business → located_at → Location → within /
//      intersects → Geography, for the knowledge graph.
//
// Admissibility: only boundary facts determined by SPATIAL_INTERSECTION or
// OFFICIAL_RECORD become engine facts. Geocoder-derived text (address,
// "municipality" returned by a search provider) is display metadata and never
// becomes a fact that can trigger a requirement. Facts carry source
// "location" and the location id, so the engine admits them only for an
// evaluation bound to that same location (see rulesEngine isFactAdmissible).
//
// Nothing here is persisted as a requirement: requirements are re-evaluated
// against the current graph and datasets every time a project is evaluated.
// ============================================================================

import type { EngineInput, FactMeta } from "../rulesEngine.ts";
import {
  COORDINATE_SYSTEM,
  currentGeography,
  isWithinPuertoRico,
  locationAddressLine,
  type AddressSource,
  type CoordinateSource,
  type DeterminationMethod,
  type LocationGeography,
  type PassportLocation,
} from "./geo.ts";

/** Determination methods whose results may drive regulatory reasoning. */
export const AUTHORITATIVE_METHODS: readonly DeterminationMethod[] = ["SPATIAL_INTERSECTION", "OFFICIAL_RECORD"];

export function isAuthoritative(method: DeterminationMethod): boolean {
  return AUTHORITATIVE_METHODS.includes(method);
}

export interface LocationContextGeography {
  type: string;
  code: string | null;
  name: string | null;
  determination_method: DeterminationMethod;
  /** True when the rules engine may use this determination. */
  authoritative: boolean;
  source: {
    id: string;
    name: string | null;
    version: string | null;
    url: string | null;
  };
  determined_at: string;
}

export interface LocationContext {
  location_id: string;
  business_id: string;
  name: string | null;
  is_primary: boolean;
  coordinates: {
    latitude: number;
    longitude: number;
    coordinate_system: typeof COORDINATE_SYSTEM;
    source: CoordinateSource;
    confirmed_at: string;
  };
  /** Provider- or user-supplied address metadata. Informational only. */
  address: {
    formatted: string | null;
    municipality: string | null;
    postal_code: string | null;
    country_code: string | null;
    source: AddressSource;
  };
  /**
   * Municipality as established by an authoritative determination (spatial
   * intersection with a municipal boundary dataset, or an official record).
   * Null until such a determination exists — address text never fills it.
   */
  municipality: LocationContextGeography | null;
  geographies: LocationContextGeography[];
  within_puerto_rico_bounds: boolean;
}

function toContextGeography(g: LocationGeography): LocationContextGeography {
  return {
    type: g.geography_type,
    code: g.geography_code,
    name: g.geography_name,
    determination_method: g.determination_method,
    authoritative: isAuthoritative(g.determination_method),
    source: {
      id: g.source_id,
      name: g.source_name,
      version: g.source_version,
      url: g.source_url,
    },
    determined_at: g.determined_at,
  };
}

export function buildLocationContext(
  location: PassportLocation,
  geographies: readonly LocationGeography[]
): LocationContext {
  const own = geographies.filter((g) => g.location_id === location.id);
  const muni = currentGeography(own, "municipality");
  return {
    location_id: location.id,
    business_id: location.business_id,
    name: location.name,
    is_primary: location.is_primary,
    coordinates: {
      latitude: location.latitude,
      longitude: location.longitude,
      coordinate_system: COORDINATE_SYSTEM,
      source: location.coordinate_source,
      confirmed_at: location.confirmed_at,
    },
    address: {
      formatted: locationAddressLine(location) || null,
      municipality: location.municipality,
      postal_code: location.postal_code,
      country_code: location.country_code,
      source: location.address_source,
    },
    municipality: muni && isAuthoritative(muni.determination_method) ? toContextGeography(muni) : null,
    geographies: own.map(toContextGeography),
    within_puerto_rico_bounds: isWithinPuertoRico(location.latitude, location.longitude),
  };
}

/** Lowercase, underscore-joined token usable inside a fact key. */
export function factToken(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export interface LocationEngineFacts {
  projectFacts: Record<string, unknown>;
  factMeta: Record<string, FactMeta>;
  /** The location these facts are bound to (EngineInput.locationId). */
  locationId: string;
}

/**
 * Engine facts for a location. Keys are namespaced `location.*` so they never
 * collide with intake project facts. Boundary facts appear twice:
 *   location.<type>          = code (or name) of the most authoritative match
 *   location.<type>.<token>  = true for EVERY intersecting feature
 * which lets ordinary equality/contains `project_fact` rules express both
 * "municipality is Guaynabo" and "intersects flood zone AE".
 */
export function locationEngineFacts(ctx: LocationContext): LocationEngineFacts {
  const projectFacts: Record<string, unknown> = {
    "location.id": ctx.location_id,
    "location.latitude": ctx.coordinates.latitude,
    "location.longitude": ctx.coordinates.longitude,
    "location.within_puerto_rico_bounds": ctx.within_puerto_rico_bounds,
  };
  const authoritative = ctx.geographies.filter((g) => g.authoritative);
  const byType = new Map<string, LocationContextGeography[]>();
  for (const g of authoritative) {
    const type = factToken(g.type);
    if (!type) continue;
    byType.set(type, [...(byType.get(type) ?? []), g]);
  }
  for (const [type, list] of byType) {
    const primary = type === "municipality" && ctx.municipality ? ctx.municipality : list[0];
    const label = primary.code ?? primary.name;
    if (label) projectFacts[`location.${type}`] = label;
    for (const g of list) {
      for (const raw of [g.code, g.name]) {
        const token = raw ? factToken(raw) : "";
        if (token) projectFacts[`location.${type}.${token}`] = true;
      }
    }
  }
  const factMeta: Record<string, FactMeta> = {};
  for (const key of Object.keys(projectFacts)) {
    factMeta[key] = {
      source: "location",
      scope: "property",
      locationId: ctx.location_id,
      businessId: ctx.business_id,
      confirmedInCurrentIntake: false,
      timestamp: ctx.coordinates.confirmed_at,
    };
  }
  return { projectFacts, factMeta, locationId: ctx.location_id };
}

/**
 * Merge location facts into an engine input without overriding anything the
 * caller already set (intake facts win over location facts on key collision,
 * which cannot happen for `location.*` keys but is kept as a guarantee).
 */
export function withLocationContext(input: EngineInput, ctx: LocationContext | null): EngineInput {
  if (!ctx) return input;
  const facts = locationEngineFacts(ctx);
  return {
    ...input,
    locationId: facts.locationId,
    projectFacts: { ...facts.projectFacts, ...(input.projectFacts ?? {}) },
    factMeta: { ...facts.factMeta, ...(input.factMeta ?? {}) },
  };
}

// ---------------------------------------------------------------------------
// Knowledge-graph projection
// ---------------------------------------------------------------------------

export interface LocationGraphEdge {
  from: { type: "Business" | "Location"; id: string };
  relation: "located_at" | "within" | "intersects";
  to: { type: "Location" | "Geography"; id: string; label?: string | null };
  /** Provenance of the edge — required for every geographic determination. */
  evidence?: {
    determination_method: DeterminationMethod;
    source_id: string;
    source_version: string | null;
    determined_at: string;
  };
}

/** Types that partition space (a point is `within` exactly one of them). */
const PARTITION_TYPES = new Set(["municipality", "barrio", "parcel", "zoning_district"]);

/**
 * Graph edges for a location. Only authoritative determinations produce
 * within/intersects edges; the graph never receives a geocoder's guess.
 * (The Regulatory Zone → triggers → Requirement → derived_from → Regulation
 * edges live in the regulatory graph and are not produced here.)
 */
export function locationGraphEdges(ctx: LocationContext): LocationGraphEdge[] {
  const edges: LocationGraphEdge[] = [
    {
      from: { type: "Business", id: ctx.business_id },
      relation: "located_at",
      to: { type: "Location", id: ctx.location_id, label: ctx.name },
    },
  ];
  for (const g of ctx.geographies) {
    if (!g.authoritative) continue;
    const key = g.code ?? g.name;
    if (!key) continue;
    edges.push({
      from: { type: "Location", id: ctx.location_id },
      relation: PARTITION_TYPES.has(g.type) ? "within" : "intersects",
      to: { type: "Geography", id: `${g.type}:${g.source.id}:${key}`, label: g.name ?? g.code },
      evidence: {
        determination_method: g.determination_method,
        source_id: g.source.id,
        source_version: g.source.version,
        determined_at: g.determined_at,
      },
    });
  }
  return edges;
}
