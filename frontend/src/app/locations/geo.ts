// ============================================================================
// Passport Locations — pure domain model (no DB, no network, no React).
//
// A LOCATION is a confirmed physical point (WGS84 / EPSG:4326) plus whatever
// address metadata was available when the user confirmed it. It belongs to a
// business's Passport; a business may have many (main office, plant,
// warehouse, solar site). Projects (matters) reference a location by its
// stable id instead of copying address data.
//
// Geographic / regulatory facts about the point (municipality polygon, barrio,
// parcel, zoning, flood zone, ...) are NOT columns here: they are
// LocationGeography records, each carrying how it was determined and from
// which dataset/version, so every determination stays explainable and can be
// re-derived when a dataset changes. Nothing in this module guesses them.
//
// Coordinates are the authoritative fact. Address text from a geocoder is
// provider-derived metadata and is labeled as such (address_source).
// ============================================================================

/** Canonical coordinate reference system for every stored point. */
export const COORDINATE_SYSTEM = "EPSG:4326" as const;

/**
 * Decimal places kept for stored coordinates. 7 decimals ≈ 1.1 cm at the
 * equator — well beyond the precision of a map tap, so rounding never moves a
 * confirmed pin in any meaningful way while keeping values stable across
 * save/reload round trips.
 */
export const COORDINATE_DECIMALS = 7;

/**
 * Loose bounding box around Puerto Rico, including Vieques, Culebra, Mona and
 * Desecheo. Used only to WARN when a confirmed point is clearly outside the
 * territory SmartPR currently serves — never to reject it. The database is
 * deliberately not Puerto-Rico-only.
 */
export const PUERTO_RICO_BOUNDS = {
  south: 17.8,
  west: -68.05,
  north: 18.62,
  east: -65.15,
} as const;

/** Map center used when there is no saved point yet. */
export const PUERTO_RICO_CENTER = { latitude: 18.2208, longitude: -66.5901 } as const;

/** How the confirmed coordinates were chosen. */
export const COORDINATE_SOURCES = ["MAP_PIN", "MANUAL_ENTRY", "GEOCODED_ADDRESS"] as const;
export type CoordinateSource = (typeof COORDINATE_SOURCES)[number];

/**
 * Where the stored address text came from. Coordinates remain authoritative in
 * every case; this only labels the provenance of the address metadata.
 */
export const ADDRESS_SOURCES = [
  "NONE",
  "USER_PROVIDED",
  "PROVIDER_GEOCODE",
  "PROVIDER_REVERSE_GEOCODE",
] as const;
export type AddressSource = (typeof ADDRESS_SOURCES)[number];

/**
 * Geography types SmartPR anticipates. The column is open text (validated by
 * pattern) so new overlay types never need a migration; this list is what
 * the UI knows how to label.
 */
export const KNOWN_GEOGRAPHY_TYPES = [
  "municipality",
  "barrio",
  "parcel",
  "zoning_district",
  "flood_zone",
  "historic_district",
  "coastal_zone",
  "environmental_zone",
  "planning_zone",
  "utility_service_area",
  "special_overlay",
] as const;
export type KnownGeographyType = (typeof KNOWN_GEOGRAPHY_TYPES)[number];
export type GeographyType = KnownGeographyType | (string & {});

/** Pattern every geography_type must match (mirrors the DB CHECK). */
export const GEOGRAPHY_TYPE_PATTERN = /^[a-z][a-z0-9_]{1,62}$/;

/**
 * How a geography fact was determined. SPATIAL_INTERSECTION (point-in-polygon
 * against a versioned dataset) is the only method that makes a regulatory
 * boundary determination authoritative. PROVIDER_GEOCODE is informational.
 */
export const DETERMINATION_METHODS = [
  "SPATIAL_INTERSECTION",
  "OFFICIAL_RECORD",
  "PROVIDER_GEOCODE",
  "USER_PROVIDED",
] as const;
export type DeterminationMethod = (typeof DETERMINATION_METHODS)[number];

/** A persisted location, as returned by the API. */
export interface PassportLocation {
  id: string;
  business_id: string;
  name: string | null;
  is_primary: boolean;
  latitude: number;
  longitude: number;
  coordinate_system: typeof COORDINATE_SYSTEM;
  coordinate_source: CoordinateSource;
  address_line_1: string | null;
  address_line_2: string | null;
  city: string | null;
  /** Provider- or user-supplied municipality text (see address_source). */
  municipality: string | null;
  state_or_region: string | null;
  postal_code: string | null;
  country_code: string | null;
  formatted_address: string | null;
  address_source: AddressSource;
  place_source: string | null;
  place_source_id: string | null;
  confirmed_at: string;
  created_at: string;
  updated_at: string;
}

/** One explainable geographic fact about a location. */
export interface LocationGeography {
  id: string;
  location_id: string;
  geography_type: GeographyType;
  geography_code: string | null;
  geography_name: string | null;
  determination_method: DeterminationMethod;
  /** Dataset / provider identifier (e.g. a geo_datasets.id). */
  source_id: string;
  source_name: string | null;
  source_version: string | null;
  source_url: string | null;
  determined_at: string;
  metadata: Record<string, unknown>;
}

export type PassportLocationWithGeographies = PassportLocation & {
  geographies: LocationGeography[];
};

// ---------------------------------------------------------------------------
// Coordinate validation
// ---------------------------------------------------------------------------

export type CoordinateError =
  | "latitude_required"
  | "longitude_required"
  | "latitude_invalid"
  | "longitude_invalid"
  | "latitude_out_of_range"
  | "longitude_out_of_range";

function toFiniteNumber(raw: unknown): number | null | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    // Plain decimal only: no hex, exponents, or trailing junk ("18.4abc").
    if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(trimmed)) return null;
    const value = Number(trimmed);
    return Number.isFinite(value) ? value : null;
  }
  return null;
}

export function roundCoordinate(value: number): number {
  const factor = 10 ** COORDINATE_DECIMALS;
  const rounded = Math.round(value * factor) / factor;
  // Normalize -0 so a stored 0 never renders as "-0".
  return Object.is(rounded, -0) ? 0 : rounded;
}

/**
 * Validate a latitude/longitude pair. Accepts numbers or plain decimal
 * strings (manual entry). Returns rounded values or the list of problems.
 */
export function validateCoordinates(
  latitude: unknown,
  longitude: unknown
): { ok: true; latitude: number; longitude: number } | { ok: false; errors: CoordinateError[] } {
  const errors: CoordinateError[] = [];
  const lat = toFiniteNumber(latitude);
  const lng = toFiniteNumber(longitude);
  if (lat === undefined) errors.push("latitude_required");
  else if (lat === null) errors.push("latitude_invalid");
  else if (lat < -90 || lat > 90) errors.push("latitude_out_of_range");
  if (lng === undefined) errors.push("longitude_required");
  else if (lng === null) errors.push("longitude_invalid");
  else if (lng < -180 || lng > 180) errors.push("longitude_out_of_range");
  if (errors.length || typeof lat !== "number" || typeof lng !== "number") {
    return { ok: false, errors };
  }
  return { ok: true, latitude: roundCoordinate(lat), longitude: roundCoordinate(lng) };
}

export function isWithinPuertoRico(latitude: number, longitude: number): boolean {
  const b = PUERTO_RICO_BOUNDS;
  return latitude >= b.south && latitude <= b.north && longitude >= b.west && longitude <= b.east;
}

/** Fixed-precision display string, e.g. "18.3912300, -66.1178400". */
export function formatCoordinate(value: number, decimals = 6): string {
  return roundCoordinate(value).toFixed(decimals);
}

// ---------------------------------------------------------------------------
// Request-body parsing (server side; the browser is never trusted)
// ---------------------------------------------------------------------------

/** Validated, normalized write payload for create/update. */
export interface LocationWriteInput {
  name: string | null;
  is_primary: boolean | undefined;
  latitude: number;
  longitude: number;
  coordinate_source: CoordinateSource;
  address_line_1: string | null;
  address_line_2: string | null;
  city: string | null;
  municipality: string | null;
  state_or_region: string | null;
  postal_code: string | null;
  country_code: string | null;
  formatted_address: string | null;
  address_source: AddressSource;
  place_source: string | null;
  place_source_id: string | null;
}

export type LocationInputError = CoordinateError | "invalid_body" | `invalid_${string}`;

const TEXT_LIMITS: Record<string, number> = {
  name: 120,
  address_line_1: 200,
  address_line_2: 200,
  city: 100,
  municipality: 100,
  state_or_region: 100,
  postal_code: 20,
  // country_code is validated as exactly two letters (never truncated).
  country_code: 10,
  formatted_address: 400,
  place_source: 60,
  place_source_id: 200,
};

function cleanText(raw: unknown, key: string, errors: LocationInputError[]): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") {
    errors.push(`invalid_${key}`);
    return null;
  }
  // Collapse control characters/whitespace runs; empty means "not provided".
  const text = raw.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return null;
  const limit = TEXT_LIMITS[key] ?? 200;
  return text.length > limit ? text.slice(0, limit) : text;
}

function oneOf<T extends string>(raw: unknown, allowed: readonly T[], fallback: T): T | null {
  if (raw === undefined || raw === null || raw === "") return fallback;
  return typeof raw === "string" && (allowed as readonly string[]).includes(raw) ? (raw as T) : null;
}

/**
 * Parse and validate an untrusted create/update body. Tenant and ownership
 * fields (business_id, workspace_id, user ids) are intentionally ignored even
 * if present: ownership is always derived server-side.
 */
export function parseLocationInput(
  body: unknown
): { ok: true; value: LocationWriteInput } | { ok: false; errors: LocationInputError[] } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, errors: ["invalid_body"] };
  }
  const b = body as Record<string, unknown>;
  const errors: LocationInputError[] = [];
  const coords = validateCoordinates(b.latitude, b.longitude);
  if (!coords.ok) errors.push(...coords.errors);

  const coordinateSource = oneOf(b.coordinate_source, COORDINATE_SOURCES, "MAP_PIN");
  if (!coordinateSource) errors.push("invalid_coordinate_source");
  let addressSource = oneOf(b.address_source, ADDRESS_SOURCES, "NONE");
  if (!addressSource) errors.push("invalid_address_source");

  if (b.is_primary !== undefined && typeof b.is_primary !== "boolean") errors.push("invalid_is_primary");

  const text = (key: string) => cleanText(b[key], key, errors);
  let countryCode = text("country_code");
  if (countryCode && !/^[A-Za-z]{2}$/.test(countryCode)) {
    errors.push("invalid_country_code");
    countryCode = null;
  }

  const value: Omit<LocationWriteInput, "latitude" | "longitude"> = {
    name: text("name"),
    is_primary: typeof b.is_primary === "boolean" ? b.is_primary : undefined,
    coordinate_source: coordinateSource ?? "MAP_PIN",
    address_line_1: text("address_line_1"),
    address_line_2: text("address_line_2"),
    city: text("city"),
    municipality: text("municipality"),
    state_or_region: text("state_or_region"),
    postal_code: text("postal_code"),
    country_code: countryCode ? countryCode.toUpperCase() : null,
    formatted_address: text("formatted_address"),
    address_source: addressSource ?? "NONE",
    place_source: text("place_source"),
    place_source_id: text("place_source_id"),
  };

  if (errors.length || !coords.ok) return { ok: false, errors };

  // An address source with no address text is meaningless; one without a
  // declared source is labeled user-provided rather than silently unlabeled.
  const hasAddress = Boolean(
    value.formatted_address || value.address_line_1 || value.city || value.municipality || value.postal_code
  );
  if (!hasAddress) addressSource = "NONE";
  else if (addressSource === "NONE") addressSource = "USER_PROVIDED";

  return {
    ok: true,
    value: { ...value, address_source: addressSource ?? "NONE", latitude: coords.latitude, longitude: coords.longitude },
  };
}

// ---------------------------------------------------------------------------
// Presentation helpers (shared by UI + context builders)
// ---------------------------------------------------------------------------

/** Current (non-superseded) geography of a type, preferring authoritative methods. */
export function currentGeography(
  geographies: readonly LocationGeography[],
  type: GeographyType
): LocationGeography | null {
  const rank: Record<DeterminationMethod, number> = {
    SPATIAL_INTERSECTION: 0,
    OFFICIAL_RECORD: 1,
    USER_PROVIDED: 2,
    PROVIDER_GEOCODE: 3,
  };
  const matches = geographies.filter((g) => g.geography_type === type);
  if (!matches.length) return null;
  return [...matches].sort(
    (a, b) =>
      rank[a.determination_method] - rank[b.determination_method] ||
      String(b.determined_at).localeCompare(String(a.determined_at))
  )[0];
}

/** One-line address from whatever parts were stored. Empty string if none. */
export function locationAddressLine(location: Pick<
  PassportLocation,
  "formatted_address" | "address_line_1" | "address_line_2" | "city" | "municipality" | "state_or_region" | "postal_code"
>): string {
  if (location.formatted_address) return location.formatted_address;
  return [
    location.address_line_1,
    location.address_line_2,
    location.city || location.municipality,
    location.state_or_region,
    location.postal_code,
  ]
    .filter((part) => Boolean(part && String(part).trim()))
    .join(", ");
}
