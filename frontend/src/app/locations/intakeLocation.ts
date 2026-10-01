// ============================================================================
// Intake location step — when does a request need a site, and what does a
// confirmed site feed into the rules engine?
//
// Pure (no React, no network) so it is unit-tested directly:
//   detectLocationNeed()  decides whether the intake should show the inline
//                         "Where is it?" card, why, and what to prefill.
//   siteEngineFacts()     turns a confirmed pin into the same `location.*`
//                         engine facts a saved Passport location produces
//                         (locationContext.locationEngineFacts), so intake and
//                         Passport evaluation share one fact model.
//
// The map determines location facts; the rules engine decides what they mean.
// Nothing here encodes a permitting rule.
// ============================================================================

import type { KBRule } from "../rulesEngine.ts";
import { isHomeBasedLocation, isMobileLocation, isOnlineOnlyLocation } from "../locationTypes.ts";
import { buildLocationContext, locationEngineFacts, type LocationEngineFacts } from "./locationContext.ts";
import { normalizeMunicipio, type CoordinateSource, type LocationGeography, type PassportLocation } from "./geo.ts";

export type LocationNeedReason =
  /** The description names a Puerto Rico municipio. */
  | "municipality_mentioned"
  /** The description (or a parsed field) carries a street address / parcel. */
  | "address_mentioned"
  /** Premises the public visits, a storefront, office, warehouse, plant… */
  | "physical_site"
  /** Construction, renovation, demolition, change of use, expansion. */
  | "construction"
  /** Energy generation / storage / interconnection project (siting). */
  | "energy_project"
  /** Food prepared or sold on site (health + use permits follow the site). */
  | "food_service"
  /** A property-only project: the property is the subject. */
  | "property_project"
  /** Rules for this request depend on location facts that are still missing. */
  | "location_rules_pending";

/** Minimal scenario shape (see ai/intake/scenario/types.ts). */
export interface LocationScenarioFacts {
  municipality?: string | null;
  address?: string | null;
  parcel?: string | null;
  projectTypes?: readonly string[] | null;
}

export interface LocationNeedInput {
  /** The user's own description (prompt), when available. */
  description?: string | null;
  /** Municipality currently held by the intake profile. */
  municipality?: string | null;
  /** Street address parsed from the narrative (profile.physical_address). */
  physicalAddress?: string | null;
  locationType?: string | null;
  /** KB business type id (BT_…) or name; used to find location-dependent rules. */
  businessTypeId?: string | null;
  projectIntent?: string | null;
  physicalLocation?: boolean | null;
  customersVisit?: boolean | null;
  foodPreparedOrSold?: boolean | null;
  /** Project-context facts (key → value). */
  projectFacts?: Record<string, unknown> | null;
  scenario?: LocationScenarioFacts | null;
  /** An energy process applies to this request. */
  energyProject?: boolean;
  /** KB municipio names (for mention detection and prefill). */
  municipalityNames: readonly string[];
  /** Another evaluator (e.g. the scenario graph) is waiting on the site's location. */
  locationFactsPending?: boolean;
  /** KB rules; rules keyed on the municipio or on `location.*` facts count as location-dependent. */
  rules?: readonly Pick<KBRule, "rule_type" | "business_type_id" | "fact_key">[];
}

export interface LocationNeed {
  needed: boolean;
  reasons: LocationNeedReason[];
  /** Location-dependent rules for this request (count), for the "pending" hint. */
  locationRuleCount: number;
  prefill: {
    /** What to put in the map search box. */
    query: string | null;
    /** KB municipio name mentioned or already selected. */
    municipality: string | null;
    /** Street address mentioned. */
    address: string | null;
  };
}

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

/**
 * First KB municipio named in the text (whole words, accent-insensitive).
 * Longer names win so "San Juan" is not read as "Juana Díaz" and
 * "Sabana Grande" beats a shorter partial.
 */
export function mentionedMunicipality(text: string | null | undefined, names: readonly string[]): string | null {
  if (!text) return null;
  const hay = ` ${fold(text).replace(/[^a-z0-9]+/g, " ")} `;
  const sorted = [...names].sort((a, b) => b.length - a.length);
  let best: { name: string; at: number } | null = null;
  for (const name of sorted) {
    const needle = ` ${fold(name).replace(/[^a-z0-9]+/g, " ").trim()} `;
    if (needle.trim().length < 3) continue;
    const at = hay.indexOf(needle);
    if (at >= 0 && (!best || at < best.at)) best = { name, at };
  }
  return best?.name ?? null;
}

// Street-address cues (EN/ES, Puerto Rico conventions): "Calle Luna 12",
// "Ave. Ponce de León 1500", "Carr. 2 km 8.5", "PR-165", "Urb. …", "Lote 4",
// "123 Main St". Deliberately conservative: a false positive only prefills
// the search box, never a fact.
const ADDRESS_PATTERNS: RegExp[] = [
  /\b(calle|c\/|avenida|ave\.?|av\.|carretera|carr\.?|camino|paseo|urb\.?|urbanizaci[oó]n|barrio|bo\.|sector|parcela|lote|solar\s+\d)\s+[\wÁÉÍÓÚÑáéíóúñ.#-]+(?:[ \t]+[\wÁÉÍÓÚÑáéíóúñ.#-]+){0,5}/i,
  /\b(?:PR|route|ruta)[- ]?\d{1,3}\b(?:[ \t,]+(?:km|k\.m\.)[ \t]*\d+(?:\.\d+)?)?/i,
  /\b\d{1,6}\s+[A-Z][\w.]*(?:\s+[A-Z][\w.]*){0,4}\s+(street|st\.?|avenue|ave\.?|road|rd\.?|boulevard|blvd\.?|drive|dr\.?|lane|ln\.?|way)\b/i,
];

/** A street address (or parcel/lot reference) in the text, trimmed; null when none. */
export function mentionedAddress(text: string | null | undefined): string | null {
  if (!text) return null;
  for (const re of ADDRESS_PATTERNS) {
    const m = text.match(re);
    if (m) return m[0].split(/\s+(?:in|en|near|cerca|at|para|for|to|and|y)\s+/i)[0].replace(/[\s,.;:]+$/, "").trim();
  }
  return null;
}

// Physical premises location types (anything with a fixed site that is not
// only a home, a vehicle, or online).
function isFixedSite(locationType: string | null | undefined): boolean {
  const lt = (locationType ?? "").trim();
  if (!lt) return false;
  return !isOnlineOnlyLocation(lt) && !isHomeBasedLocation(lt) && !isMobileLocation(lt);
}

const CONSTRUCTION_FACT_KEYS = [
  "project_type",
  "renovation",
  "new_construction",
  "expansion",
  "demolition",
  "structural_work",
  "change_of_use",
  "land_disturbance_acres",
  "footprint_change",
  "exterior_work",
];
const ENERGY_FACT_KEYS = ["generation_capacity_kw", "storage_capacity_kw", "interconnection", "energy_project_type", "solar", "net_metering"];

const truthy = (v: unknown) => v === true || (typeof v === "string" && v.trim() !== "" && v !== "false" && v !== "no") || (typeof v === "number" && v > 0);

/** Rules whose result depends on where the site is (municipio or `location.*` facts). */
export function locationDependentRules<R extends Pick<KBRule, "rule_type" | "business_type_id" | "fact_key">>(
  rules: readonly R[],
  businessTypeId: string | null | undefined
): R[] {
  return rules.filter((r) => {
    if (r.rule_type === "project_fact") return typeof r.fact_key === "string" && r.fact_key.startsWith("location.");
    if (r.rule_type === "municipality_flag") return !r.business_type_id || (!!businessTypeId && r.business_type_id === businessTypeId);
    if (r.rule_type === "municipality") return !r.business_type_id || (!!businessTypeId && r.business_type_id === businessTypeId);
    return false;
  });
}

/**
 * Should the intake ask "Where is it?" — and why. `needed` is true when the
 * request names a place, describes a physical site / construction / energy
 * project / property, or when location-dependent rules apply and no
 * municipio is known yet. An online-only business with nothing site-like in
 * the request is never asked.
 */
export function detectLocationNeed(input: LocationNeedInput): LocationNeed {
  const reasons: LocationNeedReason[] = [];
  const add = (r: LocationNeedReason) => {
    if (!reasons.includes(r)) reasons.push(r);
  };
  const names = input.municipalityNames;

  // Street names often carry a municipio's name ("Calle Loíza" in San Juan):
  // look for the municipio outside the address first.
  const textAddress = mentionedAddress(input.description);
  const mentioned =
    (textAddress ? mentionedMunicipality((input.description ?? "").replace(textAddress, " "), names) : null) ??
    mentionedMunicipality(input.description, names) ??
    (input.scenario?.municipality ? names.find((n) => normalizeMunicipio(n) === normalizeMunicipio(input.scenario!.municipality)) ?? null : null);
  if (mentioned) add("municipality_mentioned");

  const address =
    (input.physicalAddress && input.physicalAddress.trim()) ||
    (input.scenario?.address && input.scenario.address.trim()) ||
    textAddress ||
    null;
  if (address || (input.scenario?.parcel && input.scenario.parcel.trim())) add("address_mentioned");

  if (input.projectIntent === "project_only") add("property_project");

  const pf = input.projectFacts ?? {};
  if ((input.scenario?.projectTypes?.length ?? 0) > 0 || CONSTRUCTION_FACT_KEYS.some((k) => truthy(pf[k]))) add("construction");
  if (input.energyProject || ENERGY_FACT_KEYS.some((k) => truthy(pf[k]))) add("energy_project");
  if (input.foodPreparedOrSold === true && !isOnlineOnlyLocation(input.locationType)) add("food_service");
  if (input.physicalLocation === true || input.customersVisit === true || isFixedSite(input.locationType)) add("physical_site");

  const dependent = locationDependentRules(input.rules ?? [], input.businessTypeId ?? null);
  const hasMunicipality = Boolean(input.municipality && input.municipality.trim());
  if (input.locationFactsPending || (!hasMunicipality && dependent.length > 0 && (input.businessTypeId || input.projectIntent))) add("location_rules_pending");

  // Online-only with nothing site-like: no card. A pending municipio alone
  // is still answered by the plain municipality field for such businesses.
  const strong: LocationNeedReason[] = ["address_mentioned", "construction", "energy_project", "property_project"];
  const onlineOnly = isOnlineOnlyLocation(input.locationType);
  const needed = onlineOnly ? reasons.some((r) => strong.includes(r)) : reasons.length > 0;

  const municipality = mentioned ?? (hasMunicipality ? names.find((n) => normalizeMunicipio(n) === normalizeMunicipio(input.municipality)) ?? input.municipality!.trim() : null);
  const query = address ? (municipality && !fold(address).includes(fold(municipality)) ? `${address}, ${municipality}` : address) : municipality ? `${municipality}, Puerto Rico` : null;

  return {
    needed,
    reasons,
    locationRuleCount: dependent.length,
    prefill: { query, municipality, address },
  };
}

// ---------------------------------------------------------------------------
// Confirmed site → engine facts
// ---------------------------------------------------------------------------

/** A site confirmed in the intake (pin, geocoded address, or saved location). */
export interface IntakeSite {
  latitude: number;
  longitude: number;
  coordinate_source: CoordinateSource;
  formatted_address: string | null;
  /** Authoritative municipio (Census boundary point-in-polygon). */
  municipality: { name: string; fips: string | null };
  barrio: { name: string; geoid: string | null } | null;
  near_boundary: boolean;
  /** KB designations of the municipio (coastal, metro, tourism…). */
  designations: string[];
  boundary_source: { id: string; name: string | null; version: string | null; url: string | null } | null;
  /** Saved Passport location id (null until saved to a business). */
  location_id: string | null;
  confirmed_at: string;
}

/** The id the engine binds this evaluation to (saved id, else a stable synthetic one). */
export function siteLocationId(site: IntakeSite): string {
  return site.location_id ?? `intake-site:${site.latitude.toFixed(7)},${site.longitude.toFixed(7)}`;
}

/** Short label for "Rules for: …". */
export function siteLabel(site: IntakeSite): string {
  const addr = site.formatted_address?.trim();
  if (addr) {
    return fold(addr).includes(fold(site.municipality.name)) ? addr : `${addr}, ${site.municipality.name}`;
  }
  const place = site.barrio && fold(site.barrio.name) !== fold(site.municipality.name) ? `${site.barrio.name}, ${site.municipality.name}` : site.municipality.name;
  return `${place} (${site.latitude.toFixed(5)}, ${site.longitude.toFixed(5)})`;
}

/**
 * Engine facts for a confirmed intake site — identical in shape and
 * provenance to a saved Passport location's facts (source "location",
 * bound to the site's location id).
 */
export function siteEngineFacts(site: IntakeSite, businessId: string | null = null): LocationEngineFacts {
  const id = siteLocationId(site);
  const location: PassportLocation = {
    id,
    business_id: businessId ?? "intake",
    name: null,
    is_primary: false,
    latitude: site.latitude,
    longitude: site.longitude,
    coordinate_system: "EPSG:4326",
    coordinate_source: site.coordinate_source,
    address_line_1: null,
    address_line_2: null,
    city: null,
    municipality: site.municipality.name,
    state_or_region: null,
    postal_code: null,
    country_code: null,
    formatted_address: site.formatted_address,
    address_source: site.formatted_address ? "PROVIDER_REVERSE_GEOCODE" : "NONE",
    place_source: null,
    place_source_id: null,
    confirmed_at: site.confirmed_at,
    created_at: site.confirmed_at,
    updated_at: site.confirmed_at,
  };
  const src = site.boundary_source;
  const geo = (type: "municipality" | "barrio", code: string | null, name: string): LocationGeography => ({
    id: `${id}:${type}`,
    location_id: id,
    geography_type: type,
    geography_code: code,
    geography_name: name,
    determination_method: "SPATIAL_INTERSECTION",
    source_id: src?.id ?? "census-tiger",
    source_name: src?.name ?? null,
    source_version: src?.version ?? null,
    source_url: src?.url ?? null,
    determined_at: site.confirmed_at,
    metadata: { near_boundary: site.near_boundary },
  });
  const geographies: LocationGeography[] = [geo("municipality", site.municipality.fips, site.municipality.name)];
  if (site.barrio) geographies.push(geo("barrio", site.barrio.geoid, site.barrio.name));
  const facts = locationEngineFacts(buildLocationContext(location, geographies));
  // KB designations of the municipio ride along as location facts too, so a
  // future `location.designation.coastal` project rule needs no code.
  for (const d of site.designations) {
    const key = `location.designation.${d}`;
    facts.projectFacts[key] = true;
    facts.factMeta[key] = { ...facts.factMeta["location.id"] };
  }
  return facts;
}

/** Defensive restore of a persisted site (snapshots); null when malformed. */
export function restoreIntakeSite(raw: unknown): IntakeSite | null {
  if (!raw || typeof raw !== "object") return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untrusted snapshot JSON, every field is checked below
  const s = raw as Record<string, any>;
  const lat = Number(s.latitude);
  const lng = Number(s.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const muni = s.municipality && typeof s.municipality.name === "string" ? s.municipality : null;
  if (!muni) return null;
  return {
    latitude: lat,
    longitude: lng,
    coordinate_source: (["MAP_PIN", "MANUAL_ENTRY", "GEOCODED_ADDRESS"].includes(s.coordinate_source) ? s.coordinate_source : "MAP_PIN") as CoordinateSource,
    formatted_address: typeof s.formatted_address === "string" ? s.formatted_address : null,
    municipality: { name: String(muni.name), fips: typeof muni.fips === "string" ? muni.fips : null },
    barrio: s.barrio && typeof s.barrio.name === "string" ? { name: s.barrio.name, geoid: typeof s.barrio.geoid === "string" ? s.barrio.geoid : null } : null,
    near_boundary: s.near_boundary === true,
    designations: Array.isArray(s.designations) ? s.designations.filter((d: unknown) => typeof d === "string") : [],
    boundary_source: s.boundary_source && typeof s.boundary_source.id === "string" ? s.boundary_source : null,
    location_id: typeof s.location_id === "string" ? s.location_id : null,
    confirmed_at: typeof s.confirmed_at === "string" ? s.confirmed_at : new Date().toISOString(),
  };
}
