// ============================================================================
// Site intelligence — what the official maps say about one pin, organized for
// people (grouped, color-coded, plain language) and for the rules engine
// (structured facts with provenance). Pure: built from the SiteLayers the
// layer service already returns; it adds no queries and no conclusions.
//
//   status   confirmed   the provider answered and the point has a value
//            not_found   the provider answered: nothing mapped at the point
//            unavailable the provider didn't answer (down / timeout) — never "none"
//            error       the provider answered with something unreadable
//
//   tone     ok          confirmed and generally non-alerting (Zone X, Low)
//            info        a classification (zoning, land class, FIRM panel)
//            attention   needs a look (advisory area, Moderate/High, coastal)
//            hazard      a material constraint (SFHA, floodway, Very High)
//            unknown     not determined — never shown as a positive result
// ============================================================================

import { layerCards, layerReasonText, type SiteLayerId, type SiteLayerResult, type SiteLayers } from "./layers.ts";

type Bi = { en: string; es: string };

export type ProviderStatus = "confirmed" | "not_found" | "unavailable" | "error";
export type PillTone = "ok" | "info" | "attention" | "hazard" | "unknown";
export type SiteGroupId = "flood" | "land" | "site" | "environment";

export interface SitePill {
  layer: SiteLayerId;
  status: ProviderStatus;
  tone: PillTone;
  /** Short, scannable: "Effective FIRM · Zone X". */
  label: Bi;
  /** Tooltip / screen-reader detail. */
  title: Bi;
}

export interface SiteDetailRow {
  label: Bi;
  value: Bi;
}

export interface SiteGroup {
  id: SiteGroupId;
  title: Bi;
  pills: SitePill[];
  /** Expanded view: one block per layer in the group. */
  details: Array<{ layer: SiteLayerId; heading: Bi; rows: SiteDetailRow[]; meaning: Bi | null; status: ProviderStatus; reason: Bi | null; retryable: boolean }>;
}

export interface SiteConsideration {
  layer: SiteLayerId;
  tone: "attention" | "hazard";
  text: Bi;
}

export interface SiteSource {
  layer: SiteLayerId;
  agency: string;
  dataset: string;
  version: string | null;
  datasetDate: string | null;
  retrievedAt: string;
  status: ProviderStatus;
  url: string;
}

/** A value with its provenance — what downstream rules and audits read. */
export interface SourcedValue<T> {
  value: T | null;
  status: ProviderStatus;
  sourceAgency: string;
  sourceDataset: string;
  sourceVersion: string | null;
  sourceDate: string | null;
  retrievedAt: string;
  reason: string | null;
}

export interface SiteContext {
  coordinates: { latitude: number; longitude: number };
  municipality: string | null;
  address: string | null;
  parcel: SourcedValue<string>;
  zoning: SourcedValue<{ code: string; name: string | null }>;
  landClassification: SourcedValue<{ code: string; label: string | null; family: string | null }>;
  effectiveFirm: SourcedValue<{ zone: string; panel: string | null; effectiveDate: string | null; bfe: number | null; sfha: boolean; floodway: boolean; lomcNearby: number | null }>;
  advisoryFlood: SourcedValue<{ zone: string | null; inSfha: boolean; inPointTwoPctArea: boolean | null; advisoryBfeMeters: number | null; depthMeters: number | null }>;
  terrain: SourcedValue<{ landslideSusceptibility: string; elevationMeters: number | null; slopePercent: number | null }>;
  coastal: SourcedValue<{ inCoastalZone: boolean; approximate: boolean }>;
  /** Phase 2 (USFWS NWI): not queried yet — null, never "no wetlands". */
  wetlands: null;
}

export interface SiteIntelligence {
  checkedAt: string;
  /** At least one provider answered. */
  anyAnswered: boolean;
  groups: SiteGroup[];
  considerations: SiteConsideration[];
  sources: SiteSource[];
  context: SiteContext;
}

// ---------------------------------------------------------------------------

const SERVICE: Record<SiteLayerId, "FEMA" | "JP" | "CRIM" | "USGS"> = {
  flood_zone: "FEMA",
  flood_advisory: "JP",
  coastal_zone: "JP",
  zoning: "JP",
  land_class: "JP",
  parcel: "CRIM",
  terrain: "USGS",
  historic_zone: "JP",
  protected_area: "JP",
};

const AGENCY: Record<SiteLayerId, string> = {
  flood_zone: "FEMA",
  flood_advisory: "FEMA / Junta de Planificación",
  coastal_zone: "Junta de Planificación",
  zoning: "Junta de Planificación",
  land_class: "Junta de Planificación",
  parcel: "CRIM",
  terrain: "USGS",
  historic_zone: "Junta de Planificación",
  protected_area: "Junta de Planificación / DRNA",
};

/** Provider status of one layer result. Unknown is never "not found". */
export function providerStatus(r: SiteLayerResult | undefined): ProviderStatus {
  if (!r) return "unavailable";
  if (r.status === "resolved") return "confirmed";
  if (r.status === "none") return "not_found";
  const reason = r.reason ?? "";
  // The service answered, but nothing is mapped at the point (e.g. a special-plan area).
  if (/^no_/.test(reason)) return "not_found";
  return layerReasonText(reason, SERVICE[r.layer]).retryable ? "unavailable" : "error";
}

function sourced<T>(r: SiteLayerResult | undefined, value: T | null): SourcedValue<T> {
  return {
    value: r?.status === "resolved" ? value : null,
    status: providerStatus(r),
    sourceAgency: r ? AGENCY[r.layer] : "",
    sourceDataset: r?.source.name ?? "",
    sourceVersion: r?.source.version ?? null,
    sourceDate: r?.source.dataset_date ?? null,
    retrievedAt: r?.retrieved_at ?? "",
    reason: r?.reason ?? null,
  };
}

const UNAVAILABLE: Bi = { en: "temporarily unavailable", es: "no disponible por ahora" };
const NOT_MAPPED: Bi = { en: "not mapped here", es: "sin mapa aquí" };

function unknownPill(layer: SiteLayerId, name: Bi, status: ProviderStatus, r: SiteLayerResult | undefined): SitePill {
  const tail = status === "not_found" ? NOT_MAPPED : status === "error" ? { en: "couldn't be read", es: "no se pudo leer" } : UNAVAILABLE;
  const why = r ? layerReasonText(r.reason, SERVICE[layer]).text : UNAVAILABLE;
  return { layer, status, tone: "unknown", label: { en: `${name.en} · ${tail.en}`, es: `${name.es} · ${tail.es}` }, title: why };
}

const LAND_FAMILY: Record<string, Bi> = {
  SREP: { en: "Protected rustic (SREP)", es: "Rústico protegido (SREP)" },
  SRC: { en: "Rustic", es: "Rústico" },
  SU: { en: "Urban", es: "Urbano" },
  SURB: { en: "Urbanizable", es: "Urbanizable" },
};

function landFamily(r: SiteLayerResult): string | null {
  return r.tags.find((t) => LAND_FAMILY[t]) ?? null;
}

/** Build the full site-intelligence view for a set of layer results. */
export function buildSiteIntelligence(layers: SiteLayers, extra: { municipality?: string | null; address?: string | null } = {}): SiteIntelligence {
  const by = new Map(layers.results.map((r) => [r.layer, r]));
  const cards = new Map(layerCards(layers).map((c) => [c.layer, c]));
  const get = (l: SiteLayerId) => by.get(l);
  const st = (l: SiteLayerId) => providerStatus(get(l));

  // ---- Flood --------------------------------------------------------------
  const eff = get("flood_zone");
  const adv = get("flood_advisory");
  const effSfha = !!eff && eff.status === "resolved" && eff.tags.includes("SFHA");
  const effFloodway = !!eff && eff.status === "resolved" && eff.tags.includes("FLOODWAY");
  const advSfha = !!adv && adv.status === "resolved" && adv.tags.includes("SFHA");
  const advModerate = !!adv && adv.status === "resolved" && adv.tags.includes("MODERATE");
  const floodPills: SitePill[] = [];
  if (eff?.status === "resolved") {
    const sub = String(eff.attributes.ZONE_SUBTY ?? "");
    const tone: PillTone = effFloodway || effSfha ? "hazard" : /0\.2|SHADED|MODERATE/i.test(sub) ? "attention" : "ok";
    floodPills.push({
      layer: "flood_zone",
      status: "confirmed",
      tone,
      label: { en: `Effective FIRM · Zone ${eff.code}${effFloodway ? " · floodway" : ""}`, es: `FIRM vigente · Zona ${eff.code}${effFloodway ? " · cauce mayor" : ""}` },
      title: { en: effSfha ? "Special Flood Hazard Area (1% annual chance)" : "Outside the Special Flood Hazard Area", es: effSfha ? "Área Especial de Riesgo de Inundación (1% anual)" : "Fuera del Área Especial de Riesgo de Inundación" },
    });
  } else floodPills.push(unknownPill("flood_zone", { en: "Effective FIRM", es: "FIRM vigente" }, st("flood_zone"), eff));
  if (adv?.status === "resolved") {
    floodPills.push({
      layer: "flood_advisory",
      status: "confirmed",
      tone: advSfha ? "hazard" : advModerate ? "attention" : "info",
      label: advSfha
        ? { en: `Advisory · Zone ${adv.code} (1% area)`, es: `Asesor · Zona ${adv.code} (área 1%)` }
        : { en: "Advisory · 0.2% flood area", es: "Asesor · área de inundación 0.2%" },
      title: { en: "FEMA Puerto Rico Advisory Flood Maps (ABFE)", es: "Mapas Asesores de Inundación de FEMA para Puerto Rico (ABFE)" },
    });
  } else if (adv?.status === "none") {
    floodPills.push({ layer: "flood_advisory", status: "not_found", tone: "ok", label: { en: "Advisory · outside flood areas", es: "Asesor · fuera de áreas inundables" }, title: { en: "Checked against the FEMA Puerto Rico Advisory Flood Maps (ABFE)", es: "Verificado contra los Mapas Asesores de FEMA (ABFE)" } });
  } else floodPills.push(unknownPill("flood_advisory", { en: "Advisory", es: "Asesor" }, st("flood_advisory"), adv));

  // ---- Land & zoning -------------------------------------------------------
  const zoning = get("zoning");
  const land = get("land_class");
  const landPills: SitePill[] = [];
  if (zoning?.status === "resolved") {
    landPills.push({ layer: "zoning", status: "confirmed", tone: "info", label: { en: `Zoning · ${zoning.code}`, es: `Calificación · ${zoning.code}` }, title: { en: zoning.name ?? "Calificación", es: zoning.name ?? "Calificación" } });
  } else landPills.push(unknownPill("zoning", { en: "Zoning", es: "Calificación" }, st("zoning"), zoning));
  if (land?.status === "resolved") {
    const fam = landFamily(land);
    const label = fam ? LAND_FAMILY[fam] : { en: String(land.code), es: String(land.code) };
    landPills.push({ layer: "land_class", status: "confirmed", tone: fam === "SREP" ? "attention" : "info", label: { en: `Land class · ${label.en}`, es: `Clasificación · ${label.es}` }, title: { en: `${land.code}${land.name ? ` — ${land.name}` : ""}`, es: `${land.code}${land.name ? ` — ${land.name}` : ""}` } });
  } else landPills.push(unknownPill("land_class", { en: "Land class", es: "Clasificación" }, st("land_class"), land));

  // ---- Site ----------------------------------------------------------------
  const parcel = get("parcel");
  const terrain = get("terrain");
  const sitePills: SitePill[] = [];
  if (parcel?.status === "resolved") {
    sitePills.push({ layer: "parcel", status: "confirmed", tone: "ok", label: { en: `Parcel · ${parcel.code}`, es: `Parcela · ${parcel.code}` }, title: { en: "CRIM cadastral parcel identified", es: "Parcela catastral del CRIM identificada" } });
  } else if (parcel?.status === "none") {
    sitePills.push({ layer: "parcel", status: "not_found", tone: "unknown", label: { en: "Parcel · none at this point", es: "Parcela · ninguna en este punto" }, title: { en: "The pin may be on a street — move it onto the lot", es: "El pin puede estar en la calle — muévelo sobre el solar" } });
  } else sitePills.push(unknownPill("parcel", { en: "Parcel", es: "Parcela" }, st("parcel"), parcel));
  const ls = terrain?.status === "resolved" ? String(terrain.code) : null;
  if (ls) {
    const tone: PillTone = ls === "Very High" || ls === "Extremely High" ? "hazard" : ls === "High" || ls === "Moderate" ? "attention" : "ok";
    const es = { Low: "Baja", Moderate: "Moderada", High: "Alta", "Very High": "Muy alta", "Extremely High": "Extremadamente alta" }[ls] ?? ls;
    sitePills.push({ layer: "terrain", status: "confirmed", tone, label: { en: `Terrain · ${ls} landslide susceptibility`, es: `Terreno · susceptibilidad a deslizamientos ${es.toLowerCase()}` }, title: { en: "USGS Puerto Rico landslide susceptibility", es: "Susceptibilidad a deslizamientos del USGS para Puerto Rico" } });
  } else sitePills.push(unknownPill("terrain", { en: "Terrain", es: "Terreno" }, st("terrain"), terrain));

  // ---- Environment -----------------------------------------------------------
  const czm = get("coastal_zone");
  const envPills: SitePill[] = [];
  if (czm?.status === "resolved") {
    envPills.push({ layer: "coastal_zone", status: "confirmed", tone: "attention", label: czm.approximate ? { en: "Coastal · near the coast (approx.)", es: "Costa · cerca de la costa (aprox.)" } : { en: "Coastal · in the coastal zone", es: "Costa · en la zona costanera" }, title: { en: "Coastal zone management area", es: "Área de manejo de la zona costanera" } });
  } else if (czm?.status === "none") {
    envPills.push({ layer: "coastal_zone", status: "not_found", tone: "ok", label: { en: "Coastal · not identified", es: "Costa · no identificada" }, title: { en: "Outside the coastal zone", es: "Fuera de la zona costanera" } });
  } else envPills.push(unknownPill("coastal_zone", { en: "Coastal", es: "Costa" }, st("coastal_zone"), czm));
  for (const [layer, en, es] of [
    ["historic_zone", "Historic zone", "Zona histórica"],
    ["protected_area", "Protected natural area", "Área natural protegida"],
  ] as const) {
    const r = get(layer);
    if (r?.status === "resolved") envPills.push({ layer, status: "confirmed", tone: "attention", label: { en, es }, title: { en: r.code ?? en, es: r.code ?? es } });
  }

  // ---- Details (expanded) --------------------------------------------------
  const detail = (layer: SiteLayerId, heading: Bi, rows: SiteDetailRow[]) => {
    const c = cards.get(layer);
    const s = st(layer);
    return { layer, heading, rows, meaning: c?.meaning ?? null, status: s, reason: s === "confirmed" ? null : c?.reason ?? (get(layer) ? layerReasonText(get(layer)!.reason).text : null), retryable: s === "unavailable" || (c?.retryable ?? false) };
  };
  const v = (x: unknown): Bi => ({ en: x === null || x === undefined || x === "" ? "—" : String(x), es: x === null || x === undefined || x === "" ? "—" : String(x) });
  const effA = eff?.attributes ?? {};
  const advA = adv?.attributes ?? {};
  const terrA = terrain?.attributes ?? {};
  const groups: SiteGroup[] = [
    {
      id: "flood",
      title: { en: "Flood", es: "Inundación" },
      pills: floodPills,
      details: [
        detail("flood_zone", { en: "Effective FEMA FIRM", es: "FIRM vigente de FEMA" }, eff?.status === "resolved" ? [
          { label: { en: "Zone", es: "Zona" }, value: v(eff.code) },
          { label: { en: "Panel", es: "Panel" }, value: v(effA.FIRM_PAN) },
          { label: { en: "Effective", es: "Vigente" }, value: v(effA.EFF_DATE) },
          { label: { en: "Base flood elevation", es: "Elevación base de inundación" }, value: typeof effA.STATIC_BFE === "number" ? v(effA.STATIC_BFE) : { en: "Not available", es: "No disponible" } },
          { label: { en: "Community", es: "Comunidad" }, value: v(effA.COMMUNITY_NAME ? `${effA.COMMUNITY_NAME}${effA.COMMUNITY_CID ? ` (CID ${effA.COMMUNITY_CID})` : ""}` : null) },
          { label: { en: "Letters of map change within 100 m", es: "Cartas de cambio de mapa a menos de 100 m" }, value: typeof effA.LOMC_COUNT === "number" ? v(effA.LOMC_COUNT) : { en: "Not checked", es: "No verificado" } },
        ] : []),
        detail("flood_advisory", { en: "FEMA Advisory (ABFE)", es: "Asesor de FEMA (ABFE)" }, adv?.status === "resolved" || adv?.status === "none" ? [
          { label: { en: "Advisory zone", es: "Zona asesora" }, value: adv.status === "none" ? { en: "Outside the advisory flood areas", es: "Fuera de las áreas inundables asesoras" } : v(adv.code) },
          { label: { en: "Advisory base flood elevation", es: "Elevación base asesora" }, value: typeof advA.ADV_BFE_M === "number" ? { en: `${advA.ADV_BFE_M} m (${advA.V_DATUM ?? "datum n/a"})`, es: `${advA.ADV_BFE_M} m (${advA.V_DATUM ?? "datum n/d"})` } : { en: "Not available", es: "No disponible" } },
          { label: { en: "Flood depth", es: "Profundidad" }, value: typeof advA.ADV_DEPTH_M === "number" ? { en: `${advA.ADV_DEPTH_M} m`, es: `${advA.ADV_DEPTH_M} m` } : { en: "Not available", es: "No disponible" } },
        ] : []),
      ],
    },
    {
      id: "land",
      title: { en: "Land & zoning", es: "Terreno y calificación" },
      pills: landPills,
      details: [
        detail("zoning", { en: "Zoning (calificación)", es: "Calificación" }, zoning?.status === "resolved" ? [{ label: { en: "District", es: "Distrito" }, value: v(`${zoning.code}${zoning.name ? ` — ${zoning.name}` : ""}`) }] : []),
        detail("land_class", { en: "Land classification (Plan de Uso de Terrenos)", es: "Clasificación del suelo (Plan de Uso de Terrenos)" }, land?.status === "resolved" ? [{ label: { en: "Classification", es: "Clasificación" }, value: v(`${land.code}${land.name ? ` — ${land.name}` : ""}`) }] : []),
      ],
    },
    {
      id: "site",
      title: { en: "Site", es: "Lugar" },
      pills: sitePills,
      details: [
        detail("parcel", { en: "Parcel (catastro)", es: "Parcela (catastro)" }, parcel?.status === "resolved" ? [
          { label: { en: "Cadastral number", es: "Número de catastro" }, value: v(parcel.code) },
          { label: { en: "Match", es: "Coincidencia" }, value: { en: "CRIM parcel identified at the pin", es: "Parcela del CRIM identificada en el pin" } },
        ] : []),
        detail("terrain", { en: "Terrain & slope", es: "Terreno y pendiente" }, terrain?.status === "resolved" || typeof terrA.ELEVATION_M === "number" ? [
          { label: { en: "Landslide susceptibility", es: "Susceptibilidad a deslizamientos" }, value: v(terrain?.status === "resolved" ? terrain.code : null) },
          { label: { en: "Elevation", es: "Elevación" }, value: typeof terrA.ELEVATION_M === "number" ? { en: `${terrA.ELEVATION_M} m`, es: `${terrA.ELEVATION_M} m` } : { en: "Not available", es: "No disponible" } },
          { label: { en: "Slope", es: "Pendiente" }, value: typeof terrA.SLOPE_PCT === "number" ? { en: `${terrA.SLOPE_PCT}%`, es: `${terrA.SLOPE_PCT}%` } : { en: "Not available", es: "No disponible" } },
        ] : []),
      ],
    },
    {
      id: "environment",
      title: { en: "Environmental", es: "Ambiental" },
      pills: envPills,
      details: [detail("coastal_zone", { en: "Coastal zone", es: "Zona costanera" }, [])],
    },
  ];

  // ---- Considerations (elevated, hazards first) ------------------------------
  const considerations: SiteConsideration[] = [];
  if (effFloodway) considerations.push({ layer: "flood_zone", tone: "hazard", text: { en: `The pin is in a regulatory floodway (FEMA Zone ${eff!.code}). Development there is tightly restricted.`, es: `El pin está en un cauce mayor regulatorio (Zona ${eff!.code} de FEMA). El desarrollo allí está muy restringido.` } });
  else if (effSfha) considerations.push({ layer: "flood_zone", tone: "hazard", text: { en: `The pin is in a FEMA Special Flood Hazard Area (Zone ${eff!.code}).`, es: `El pin está en un Área Especial de Riesgo de Inundación de FEMA (Zona ${eff!.code}).` } });
  if (advSfha && !effSfha && eff?.status === "resolved") {
    considerations.push({ layer: "flood_advisory", tone: "attention", text: { en: `FEMA advisory mapping shows a 1% flood area here (advisory Zone ${adv!.code}), beyond the effective FIRM designation (Zone ${eff.code}).`, es: `Los mapas asesores de FEMA muestran un área de inundación de 1% aquí (Zona asesora ${adv!.code}), más allá de la designación del FIRM vigente (Zona ${eff.code}).` } });
  } else if (advSfha && effSfha && adv!.code && eff!.code && adv!.code !== eff!.code) {
    considerations.push({ layer: "flood_advisory", tone: "attention", text: { en: `Effective FIRM says Zone ${eff!.code}; FEMA advisory mapping says Zone ${adv!.code}. Both are shown — neither is chosen for you.`, es: `El FIRM vigente indica Zona ${eff!.code}; los mapas asesores indican Zona ${adv!.code}. Se muestran ambos.` } });
  }
  if (ls === "Very High" || ls === "Extremely High") considerations.push({ layer: "terrain", tone: "hazard", text: { en: `${ls} landslide susceptibility (USGS). Site and engineering review may be needed.`, es: `Susceptibilidad a deslizamientos ${ls === "Very High" ? "muy alta" : "extremadamente alta"} (USGS). Puede requerirse revisión del lugar e ingeniería.` } });
  else if (ls === "High") considerations.push({ layer: "terrain", tone: "attention", text: { en: "High landslide susceptibility (USGS).", es: "Susceptibilidad a deslizamientos alta (USGS)." } });
  if (land?.status === "resolved" && landFamily(land) === "SREP") considerations.push({ layer: "land_class", tone: "attention", text: { en: `Specially protected rustic land (${land.code}). Most development is tightly limited.`, es: `Suelo rústico especialmente protegido (${land.code}). La mayoría del desarrollo está muy limitado.` } });
  considerations.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === "hazard" ? -1 : 1));

  // ---- Sources & provenance ------------------------------------------------
  // One entry per dataset (zoning and land class come from the same JP layer).
  const seenSource = new Set<string>();
  const sources: SiteSource[] = layers.results.filter((r) => !seenSource.has(r.source.url) && !!seenSource.add(r.source.url)).map((r) => ({
    layer: r.layer,
    agency: AGENCY[r.layer],
    dataset: r.source.name,
    version: r.source.version,
    datasetDate: r.source.dataset_date,
    retrievedAt: r.retrieved_at,
    status: providerStatus(r),
    url: r.source.url,
  }));

  // ---- Structured context for the rules engine / Passport -------------------
  const fam = land?.status === "resolved" ? landFamily(land) : null;
  const context: SiteContext = {
    coordinates: { latitude: layers.latitude, longitude: layers.longitude },
    municipality: extra.municipality ?? null,
    address: extra.address ?? null,
    parcel: sourced(parcel, parcel?.code ?? null),
    zoning: sourced(zoning, zoning?.code ? { code: zoning.code, name: zoning.name } : null),
    landClassification: sourced(land, land?.code ? { code: land.code, label: land.name, family: fam } : null),
    effectiveFirm: sourced(eff, eff?.code ? { zone: eff.code, panel: (effA.FIRM_PAN as string) ?? null, effectiveDate: (effA.EFF_DATE as string) ?? null, bfe: typeof effA.STATIC_BFE === "number" ? effA.STATIC_BFE : null, sfha: effSfha, floodway: effFloodway, lomcNearby: typeof effA.LOMC_COUNT === "number" ? effA.LOMC_COUNT : null } : null),
    advisoryFlood: { ...sourced(adv, adv && (adv.status === "resolved" || adv.status === "none") ? { zone: adv.code, inSfha: advSfha, inPointTwoPctArea: typeof advA.IN_02PCT_AREA === "boolean" ? advA.IN_02PCT_AREA : null, advisoryBfeMeters: typeof advA.ADV_BFE_M === "number" ? advA.ADV_BFE_M : null, depthMeters: typeof advA.ADV_DEPTH_M === "number" ? advA.ADV_DEPTH_M : null } : null), ...(adv?.status === "none" ? { value: { zone: null, inSfha: false, inPointTwoPctArea: typeof advA.IN_02PCT_AREA === "boolean" ? advA.IN_02PCT_AREA : null, advisoryBfeMeters: null, depthMeters: null } } : {}) },
    terrain: sourced(terrain, terrain?.code ? { landslideSusceptibility: terrain.code, elevationMeters: typeof terrA.ELEVATION_M === "number" ? terrA.ELEVATION_M : null, slopePercent: typeof terrA.SLOPE_PCT === "number" ? terrA.SLOPE_PCT : null } : null),
    coastal: { ...sourced(czm, czm?.status === "resolved" ? { inCoastalZone: true, approximate: czm.approximate } : null), ...(czm?.status === "none" ? { value: { inCoastalZone: false, approximate: false } } : {}) },
    wetlands: null,
  };

  return {
    checkedAt: layers.resolved_at,
    anyAnswered: layers.results.some((r) => r.status !== "unknown" || r.retrieval !== "none"),
    groups,
    considerations,
    sources,
    context,
  };
}
