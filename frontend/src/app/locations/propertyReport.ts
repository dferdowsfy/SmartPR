// ============================================================================
// Property & Site Report — ONE model for the intake preview, the expanded
// report drawer, exports, and the versioned copy saved to the Business
// Passport. Pure: built from the confirmed IntakeSite (+ its point layers)
// and the whole-parcel findings. Adds no queries and draws no approval
// conclusions: every statement is a sourced finding, an explicit gap, or a
// deterministic, source-backed preparation step.
//
// Finding states (never collapsed — missing data is never "no restriction"):
//   sourced        a source answered and something is mapped
//   none_mapped    a source answered: nothing mapped here
//   unavailable    a source did not answer (down / timeout / error)
//   stale          the answer is for another point or too old — hidden from
//                  findings, listed as a gap
//   not_performed  SmartPR has no verified source for this check yet
//   loading        requested for this exact location, not back yet
// ============================================================================

import { floodMapSummary, layerAnswered, type SiteLayerId, type SiteLayerResult } from "./layers.ts";
import { siteLayersCurrent, type IntakeSite } from "./intakeLocation.ts";
import { toPrStatePlane, type ParcelFindings } from "./parcel.ts";
import { siteAddressParts } from "./siteAddress.ts";
import type { exportableReview } from "./propertyReview.ts";

export type Bi = { en: string; es: string };
export type ReportFindingState = "sourced" | "none_mapped" | "unavailable" | "stale" | "not_performed" | "loading";
export type ReportTone = "ok" | "info" | "attention" | "hazard" | "unknown";
export type ReportScope = "parcel" | "point" | "municipality";
export type ReportGroup = "land" | "flood" | "environment";
/**
 * What kind of constraint a finding is:
 *   protection     a conservation / protection designation (protected area,
 *                  conservation district, specially-protected rustic land,
 *                  regulatory floodway). It restricts what can happen on the
 *                  land; extra paperwork does not remove it.
 *   documentation  a review or study that is typically satisfied with
 *                  additional documentation (floodplain review, coastal
 *                  consistency, historic review, geotechnical study).
 *   information    context; no constraint determined.
 */
export type ConstraintClass = "protection" | "documentation" | "information";
/** Where a statement comes from — always shown, never mixed. */
export type StatementBasis = "official" | "rule" | "ai" | "professional";

export interface ReportSource {
  name: string;
  url: string | null;
  /** Date of the data behind the answer (FIRM effective date, JP vigencia, CRIM edition). */
  dataset_date: string | null;
  version: string | null;
}

export interface ReportFinding {
  id: string;
  group: ReportGroup;
  title: Bi;
  /** Short value ("Zone X", "R-G · A-B"); null when nothing determined. */
  value: Bi | null;
  /** One plain-language line. */
  detail: Bi | null;
  /** What it means in everyday words ("Low flood risk area"). Null when not determined. */
  plain?: Bi | null;
  /** Short chip text for the compact preview ("Low flood risk"). */
  pill?: Bi | null;
  state: ReportFindingState;
  tone: ReportTone;
  scope: ReportScope;
  sources: ReportSource[];
  /** When SmartPR looked this up (ISO). */
  looked_up_at: string | null;
  /** The point the answer is for — always the confirmed site (see belongsToSite). */
  point: { latitude: number; longitude: number } | null;
  /** Shown in the compact preview. */
  key: boolean;
  /** Official map finding (never AI). */
  basis: "official";
  constraint: ConstraintClass;
}

export interface ReportStep {
  id: string;
  text: Bi;
  /** Why this step appears (the finding it follows from). */
  because: Bi;
  sources: ReportSource[];
  /** Deterministic rule result (fixed logic over official findings). */
  basis: "rule";
  constraint: ConstraintClass;
}

export interface PropertyReportContext {
  /** What the user already described in intake (never asked again). */
  activity: string | null;
  businessType: string | null;
  projectTypes: string[];
  /** Location-dependent requirements the rules engine already produced. */
  locationRequirements: Array<{ title: string; reason: string | null }>;
}

export interface PropertyReport {
  schema: "smartpr.property-report/v1";
  /** Content fingerprint: same location + same answers → same id. */
  fingerprint: string;
  location_revision: number;
  generated_at: string;
  property: {
    title: string;
    address: { primary: string; secondary: string; formatted: string | null };
    municipality: string;
    barrio: string | null;
    latitude: number;
    longitude: number;
    coordinate_source: IntakeSite["coordinate_source"];
    precision: "parcel" | "point" | "address";
    near_boundary: boolean;
    catastro: { value: string | null; state: ReportFindingState; source: ReportSource | null };
    boundary: { state: ReportFindingState; geometry: unknown | null; area_m2: number | null; source: ReportSource | null };
    technical: {
      nad83_state_plane: { x: number; y: number; epsg: 32161; note: Bi };
      municipality_fips: string | null;
      barrio_geoid: string | null;
      location_id: string | null;
    };
  };
  findings: ReportFinding[];
  next_steps: {
    activity: Bi;
    missing: Bi[];
    unresolved: Bi[];
    steps: ReportStep[];
    location_requirements: Array<{ title: string; reason: string | null }>;
  };
  sources: ReportSource[];
  /** AI explanations of verified findings (none are generated yet; kept separate when they are). */
  ai_explanations: Array<{ finding_id: string; text: Bi; model: string }>;
  disclaimer: Bi;
}

// ---------------------------------------------------------------------------

const bi = (en: string, es: string = en): Bi => ({ en, es });
const fmtArea = (m2: number) => Math.round(m2 * 10) / 10;

const RC_2023: ReportSource = {
  name: "Reglamento Conjunto para la Evaluación y Expedición de Permisos (2023)",
  url: "https://jp.pr.gov/reglamentos/",
  dataset_date: "2023-06-16",
  version: "2023",
};
const RP_13: ReportSource = {
  name: "Reglamento de Planificación Núm. 13 — Áreas Especiales de Riesgo a Inundación",
  url: "https://jp.pr.gov/reglamentos/",
  dataset_date: null,
  version: null,
};
const PMZC: ReportSource = {
  name: "Programa de Manejo de la Zona Costanera de Puerto Rico (JP / DRNA)",
  url: "https://www.drna.pr.gov/",
  dataset_date: null,
  version: null,
};

function sourceOf(r: SiteLayerResult): ReportSource {
  return { name: r.source.name, url: r.source.url ?? null, dataset_date: r.source.dataset_date ?? null, version: r.source.version ?? null };
}

function layerState(r: SiteLayerResult | undefined, current: boolean, loading: boolean): ReportFindingState {
  if (!current) return loading ? "loading" : "stale";
  if (!r) return "not_performed";
  if (r.status === "resolved") return "sourced";
  if (r.status === "none") return "none_mapped";
  // The source answered but nothing usable is mapped (road / water polygon,
  // special-plan area): checked, not "unavailable".
  if (layerAnswered(r)) return "none_mapped";
  return "unavailable";
}

/** Short djb2 hash (fingerprints only, not security). */
function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

const STATE_TEXT: Record<ReportFindingState, Bi> = {
  sourced: bi("Source confirmed", "Fuente confirmada"),
  none_mapped: bi("Nothing mapped here — not the same as no restriction", "Nada mapeado aquí — no equivale a ausencia de restricciones"),
  unavailable: bi("Source unavailable — not checked", "Fuente no disponible — no verificado"),
  stale: bi("Outdated — refreshing for this location", "Desactualizado — actualizando para esta ubicación"),
  not_performed: bi("Check not performed", "Verificación no realizada"),
  loading: bi("Checking…", "Verificando…"),
};
export const findingStateText = (s: ReportFindingState) => STATE_TEXT[s];

/**
 * Build the report. `parcel` is used only when it was looked up for the
 * site's exact coordinates; anything else is treated as stale.
 */
export function buildPropertyReport(input: {
  site: IntakeSite;
  parcel: ParcelFindings | null;
  parcelLoading?: boolean;
  revision: number;
  context: PropertyReportContext;
  now?: Date;
}): PropertyReport {
  const { site, context } = input;
  const now = (input.now ?? new Date()).toISOString();
  const current = siteLayersCurrent(site);
  const layersLoading = !current && !site.layers;
  const by = new Map((current ? site.layers!.results : []).map((r) => [r.layer, r]));
  const parcel = input.parcel && Math.abs(input.parcel.latitude - site.latitude) < 1e-7 && Math.abs(input.parcel.longitude - site.longitude) < 1e-7 ? input.parcel : null;
  const parcelState = (s: "sourced" | "none_mapped" | "unavailable" | undefined): ReportFindingState => (parcel && s ? s : input.parcelLoading ? "loading" : input.parcel ? "stale" : "not_performed");
  const pt = { latitude: site.latitude, longitude: site.longitude };
  const at = (r?: SiteLayerResult) => r?.retrieved_at ?? (current ? site.layers!.resolved_at : null);
  const findings: ReportFinding[] = [];
  const add = (f: Omit<ReportFinding, "point" | "basis" | "constraint"> & { constraint?: ConstraintClass }) =>
    findings.push({ ...f, constraint: f.constraint ?? "information", point: pt, basis: "official" });
  const layer = (id: SiteLayerId) => by.get(id);

  // ---- Land & zoning -------------------------------------------------------
  const zParcel = parcel?.zoning;
  const zPoint = layer("zoning");
  if (zParcel && zParcel.status === "sourced") {
    const base = zParcel.districts;
    const codes = base.map((d) => d.code).join(" · ");
    const multi = base.length > 1;
    add({
      id: "zoning",
      group: "land",
      title: bi("Calificación (zoning)", "Calificación"),
      value: bi(codes),
      detail: multi
        ? bi(`${base.length} districts are mapped inside this parcel (edge slivers under ~3 m excluded): ${base.map((d) => `${d.code}${d.name ? ` (${d.name})` : ""}`).join(", ")}. Verify which districts cover the area you will use.`,
             `${base.length} distritos están mapeados dentro de esta parcela (se excluyen franjas de borde menores de ~3 m): ${base.map((d) => `${d.code}${d.name ? ` (${d.name})` : ""}`).join(", ")}. Verifique qué distritos cubren el área que usará.`)
        : bi(`${base[0]!.code}${base[0]!.name ? ` — ${base[0]!.name}` : ""}`),
      state: "sourced",
      tone: multi ? "attention" : "info",
      scope: zParcel.scope,
      sources: [{ name: zParcel.source.name, url: zParcel.source.url, dataset_date: base[0]?.effective ?? zParcel.source.dataset_date, version: base[0]?.resolution ?? null }],
      looked_up_at: parcel!.retrieved_at,
      key: true,
    });
    const overlays = base.filter((d) => d.overlay);
    if (overlays.length) {
      add({
        id: "zoning_overlay",
        group: "land",
        title: bi("Overlay districts", "Distritos sobrepuestos"),
        value: bi(overlays.map((d) => d.overlay!.code).join(" · ")),
        detail: bi(overlays.map((d) => `${d.overlay!.code}${d.overlay!.name ? ` — ${d.overlay!.name}` : ""}`).join("; ")),
        state: "sourced", tone: "attention", scope: zParcel.scope,
        sources: [{ name: zParcel.source.name, url: zParcel.source.url, dataset_date: null, version: null }],
        looked_up_at: parcel!.retrieved_at, key: false,
      });
    }
  } else {
    const st = zParcel ? (zParcel.status === "none_mapped" ? "none_mapped" : "unavailable") : layerState(zPoint, current, layersLoading);
    add({
      id: "zoning",
      group: "land",
      title: bi("Calificación (zoning)", "Calificación"),
      value: zPoint?.status === "resolved" && current ? bi(zPoint.code ?? "") : null,
      detail: zPoint?.status === "resolved" && current
        ? bi(`At the pin: ${zPoint.code}${zPoint.name ? ` — ${zPoint.name}` : ""}. Whole-parcel districts not determined.`, `En el pin: ${zPoint.code}${zPoint.name ? ` — ${zPoint.name}` : ""}. No se determinaron los distritos de toda la parcela.`)
        : st === "none_mapped"
          ? bi("No calificación polygon here (special-plan area or unmapped). Zoning is unknown, not absent.", "No hay polígono de calificación aquí (área de plan especial o sin mapear). La calificación es desconocida, no inexistente.")
          : null,
      state: zPoint?.status === "resolved" && current ? "sourced" : st,
      tone: zPoint?.status === "resolved" && current ? "info" : "unknown",
      scope: "point",
      sources: zPoint ? [sourceOf(zPoint)] : [],
      looked_up_at: at(zPoint),
      key: true,
    });
  }

  const lc = layer("land_class");
  add({
    id: "land_class",
    group: "land",
    title: bi("Land classification (JP calificación layer)", "Clasificación del suelo (capa de calificación JP)"),
    value: lc?.status === "resolved" && current ? bi(`${lc.code}${lc.name ? ` — ${lc.name}` : ""}`) : null,
    detail: bi("Point-based; read from the JP calificación map, not from the PUT.", "Basado en el punto; tomado del mapa de calificación de la JP, no del PUT."),
    state: layerState(lc, current, layersLoading),
    tone: lc?.status === "resolved" ? "info" : "unknown",
    scope: "point",
    sources: lc ? [sourceOf(lc)] : [],
    looked_up_at: at(lc),
    key: false,
  });
  // No verified PUT / municipal plan datasets are wired yet: say so.
  add({
    id: "put", group: "land",
    title: bi("PUT classification (Plan de Uso de Terrenos)", "Clasificación del PUT (Plan de Uso de Terrenos)"),
    value: null,
    detail: bi("Not verified — SmartPR does not yet read the PUT dataset.", "No verificado — SmartPR aún no lee el conjunto de datos del PUT."),
    state: "not_performed", tone: "unknown", scope: "parcel", sources: [], looked_up_at: null, key: false,
  });
  add({
    id: "municipal_plan", group: "land",
    title: bi("Municipal plan (Plan Territorial)", "Plan Territorial municipal"),
    value: null,
    detail: bi(`Not verified — check whether ${site.municipality.name} has an autonomous-municipality plan that governs this site.`, `No verificado — confirme si ${site.municipality.name} tiene un plan de municipio autónomo que rige este lugar.`),
    state: "not_performed", tone: "unknown", scope: "municipality", sources: [], looked_up_at: null, key: false,
  });
  add({
    id: "permitted_uses", group: "land",
    title: bi("Permitted uses, conditions & exceptions", "Usos permitidos, condiciones y excepciones"),
    value: null,
    detail: bi(
      "Not explained yet: SmartPR only explains permitted uses after confirming the regulation version in force for the districts above. Uses are evaluated against official rules, not inferred from a code.",
      "Aún no se explican: SmartPR solo explica los usos permitidos después de confirmar la versión vigente del reglamento para los distritos anteriores. Los usos se evalúan según las reglas oficiales, no se infieren de un código."
    ),
    state: "not_performed", tone: "unknown", scope: "parcel", sources: [RC_2023], looked_up_at: null, key: false,
  });

  // ---- Flood & water --------------------------------------------------------
  const fz = layer("flood_zone");
  const fm = current ? floodMapSummary(site.layers) : null;
  const fParcel = parcel?.flood;
  const parcelZones = fParcel?.status === "sourced" ? fParcel.zones : [];
  const sfha = parcelZones.some((z) => z.sfha) || !!fm?.sfha;
  const floodValue = parcelZones.length ? parcelZones.map((z) => z.zone).join(" · ") : fm ? fm.zone : null;
  add({
    id: "flood_zone",
    group: "flood",
    title: bi("FEMA flood zone (effective FIRM)", "Zona inundable FEMA (FIRM vigente)"),
    value: floodValue ? bi(`Zone ${floodValue}`, `Zona ${floodValue}`) : null,
    detail: floodValue
      ? sfha
        ? bi("Special Flood Hazard Area mapped on this site.", "Área Especial de Riesgo a Inundación mapeada en este lugar.")
        : bi(`${parcelZones.length > 1 ? "Several zones mapped on the parcel. " : ""}Minimal or moderate mapped flood hazard. This does not mean zero flood risk or project approval.`,
             `${parcelZones.length > 1 ? "Varias zonas mapeadas en la parcela. " : ""}Riesgo de inundación mapeado mínimo o moderado. No significa riesgo cero ni aprobación del proyecto.`)
      : null,
    state: parcelZones.length || fm ? "sourced" : fParcel ? (fParcel.status === "none_mapped" ? "none_mapped" : layerState(fz, current, layersLoading)) : layerState(fz, current, layersLoading),
    tone: floodValue ? (sfha ? "hazard" : "ok") : "unknown",
    scope: parcelZones.length ? "parcel" : "point",
    sources: [
      ...(fz ? [{ ...sourceOf(fz), dataset_date: fm?.effectiveDate ?? fz.source.dataset_date ?? null, version: fm?.firmPanel ? `FIRM panel ${fm.firmPanel}` : fz.source.version ?? null }] : []),
    ],
    looked_up_at: parcelZones.length ? parcel!.retrieved_at : at(fz),
    key: true,
  });
  const floodwayKnown = parcelZones.length > 0 || fm;
  const floodway = parcelZones.some((z) => z.floodway) || !!fm?.floodway;
  add({
    id: "floodway",
    group: "flood",
    title: bi("Regulatory floodway", "Cauce mayor (floodway)"),
    value: floodwayKnown ? (floodway ? bi("Mapped", "Mapeado") : bi("Not mapped", "No mapeado")) : null,
    detail: floodway ? bi("A regulatory floodway is mapped on this site.", "Hay un cauce mayor reglamentario mapeado en este lugar.") : null,
    state: floodwayKnown ? (floodway ? "sourced" : "none_mapped") : layerState(fz, current, layersLoading),
    tone: floodway ? "hazard" : floodwayKnown ? "ok" : "unknown",
    scope: parcelZones.length ? "parcel" : "point",
    sources: fz ? [sourceOf(fz)] : [],
    looked_up_at: parcelZones.length ? parcel!.retrieved_at : at(fz),
    key: false,
  });
  const adv = layer("flood_advisory");
  add({
    id: "flood_advisory",
    group: "flood",
    title: bi("Advisory flood areas (JP, separate from FEMA)", "Áreas de inundación de asesoramiento (JP, aparte de FEMA)"),
    value: adv?.status === "resolved" && current ? bi(adv.name ?? adv.code ?? "") : adv?.status === "none" && current ? bi("None mapped at the pin", "Ninguna mapeada en el pin") : null,
    detail: null,
    state: layerState(adv, current, layersLoading),
    tone: adv?.status === "resolved" ? "attention" : adv?.status === "none" ? "ok" : "unknown",
    scope: "point",
    sources: adv ? [sourceOf(adv)] : [],
    looked_up_at: at(adv),
    key: false,
  });

  // ---- Environment & terrain -----------------------------------------------
  const env = (id: SiteLayerId, title: Bi, resolvedTone: ReportTone, valueOf: (r: SiteLayerResult) => Bi, noneText: Bi, keyFinding = false) => {
    const r = layer(id);
    const st = layerState(r, current, layersLoading);
    add({
      id, group: "environment", title,
      value: st === "sourced" ? valueOf(r!) : st === "none_mapped" ? noneText : null,
      detail: r?.approximate && st === "sourced" ? bi("Approximate — derived from a proxy dataset.", "Aproximado — derivado de un conjunto de datos sustituto.") : null,
      state: st,
      tone: st === "sourced" ? resolvedTone : st === "none_mapped" ? "ok" : "unknown",
      scope: "point",
      sources: r ? [sourceOf(r)] : [],
      looked_up_at: at(r),
      key: keyFinding,
    });
  };
  const terrain = layer("terrain");
  env("terrain", bi("Landslide susceptibility", "Susceptibilidad a deslizamientos"),
    terrain?.tags.includes("LANDSLIDE_HIGH") ? "hazard" : terrain?.tags.includes("LANDSLIDE_MODERATE") ? "attention" : "ok",
    (r) => bi(r.code ?? "", ({ Low: "Baja", Moderate: "Moderada", High: "Alta", "Very High": "Muy alta", "Extremely High": "Extremadamente alta" } as Record<string, string>)[r.code ?? ""] ?? r.code ?? ""),
    bi("Not mapped", "No mapeada"), true);
  env("coastal_zone", bi("Coastal zone", "Zona costanera"), "attention", (r) => bi(r.approximate ? "Inside (approximate)" : "Inside the coastal zone", r.approximate ? "Dentro (aproximado)" : "Dentro de la zona costanera"), bi("Outside the mapped boundary", "Fuera del límite mapeado"), true);
  env("historic_zone", bi("Historic zone", "Zona histórica"), "attention", (r) => bi(r.name ?? "Inside a historic zone", r.name ?? "Dentro de una zona histórica"), bi("None mapped at the pin", "Ninguna mapeada en el pin"));
  env("protected_area", bi("Protected natural area", "Área natural protegida"), "hazard", (r) => bi(r.name ?? "Inside a protected area", r.name ?? "Dentro de un área protegida"), bi("None mapped at the pin", "Ninguna mapeada en el pin"));
  add({
    id: "soils", group: "environment",
    title: bi("Soils", "Suelos"), value: null,
    detail: bi("Not checked — no soils source is connected yet.", "No verificado — aún no hay una fuente de suelos conectada."),
    state: "not_performed", tone: "unknown", scope: "parcel", sources: [], looked_up_at: null, key: false,
  });

  // ---- Property -----------------------------------------------------------
  const addr = siteAddressParts(site);
  const crim = layer("parcel");
  const boundary = parcel?.boundary;
  const catastroValue = boundary?.value?.catastro ?? (crim?.status === "resolved" && current ? crim.code : null);
  const catSource: ReportSource | null = boundary?.value ? { name: boundary.source.name, url: boundary.source.url, dataset_date: boundary.source.dataset_date, version: null } : crim ? sourceOf(crim) : null;
  const sp = toPrStatePlane(site.latitude, site.longitude);

  // ---- Next steps -----------------------------------------------------------
  const activityText = [context.activity, context.businessType].filter(Boolean).join(" — ");
  const activity = activityText
    ? bi(`Findings below are read for the activity you described: ${activityText}.`, `Los hallazgos se leen para la actividad que describió: ${activityText}.`)
    : bi("Add what you plan to do in the intake description above; SmartPR reads the findings against that activity.", "Añada lo que planifica hacer en la descripción de arriba; SmartPR lee los hallazgos según esa actividad.");
  const missing: Bi[] = [];
  if (site.coordinate_source === "GEOCODED_ADDRESS") missing.push(bi("The pin comes from the address search — move it onto the exact property if needed.", "El pin viene de la búsqueda de dirección — muévalo a la propiedad exacta si hace falta."));
  if (site.near_boundary) missing.push(bi("The pin is near a municipal boundary — confirm it is inside the right municipio.", "El pin está cerca de un límite municipal — confirme que está en el municipio correcto."));
  if (!boundary?.value) missing.push(bi("Parcel boundary not determined — findings are for the pin, not the whole lot.", "No se determinó el límite de la parcela — los hallazgos son del pin, no de todo el solar."));
  if (!context.activity && !context.businessType) missing.push(bi("The planned activity has not been described yet.", "Aún no se ha descrito la actividad planificada."));
  const unresolved: Bi[] = findings
    .filter((f) => f.state !== "sourced" && f.state !== "none_mapped")
    .map((f) => bi(`${f.title.en}: ${STATE_TEXT[f.state].en}`, `${f.title.es}: ${STATE_TEXT[f.state].es}`));

  // ---- Plain language (deterministic wording for official values) --------
  const FAMILY_TEXT: Record<string, Bi> = {
    conservation: bi("conservation land", "terreno de conservación"),
    residential: bi("residential", "residencial"),
    commercial: bi("commercial", "comercial"),
    industrial: bi("industrial", "industrial"),
    agricultural: bi("agricultural", "agrícola"),
    rural: bi("rural", "rural"),
    tourism: bi("tourism", "turístico"),
    public: bi("public / institutional", "público / institucional"),
    road: bi("road right-of-way", "servidumbre vial"),
  };
  const zf = findings.find((f) => f.id === "zoning");
  if (zf && zf.state === "sourced") {
    const ds = zParcel?.status === "sourced" ? zParcel.districts : zPoint ? [{ code: zPoint.code ?? "", name: zPoint.name, family: zPoint.tags[0] ?? null }] : [];
    const fams = [...new Set(ds.map((d) => d.family).filter((x): x is string => !!x && !!FAMILY_TEXT[x]))];
    const named = ds.map((d) => `${d.code}${d.name ? ` (${d.name})` : ""}`).join(", ");
    const famText = (l: "en" | "es") => fams.map((f) => FAMILY_TEXT[f]![l]).join(l === "es" ? " y " : " and ");
    const roadOnly = ds.length > 1 && ds.some((d) => d.family === "road");
    zf.plain = bi(
      `${fams.length ? `Zoned ${famText("en")}` : "Zoning district mapped"}: ${named}.${roadOnly ? " The road district usually covers only the edge of the lot along the street." : ""}${fams.includes("conservation") ? " Conservation districts restrict development." : ""}`,
      `${fams.length ? `Calificación ${famText("es")}` : "Distrito de calificación mapeado"}: ${named}.${roadOnly ? " El distrito vial suele cubrir solo el borde del solar junto a la calle." : ""}${fams.includes("conservation") ? " Los distritos de conservación restringen el desarrollo." : ""}`
    );
    const main = fams.filter((f) => f !== "road");
    zf.pill = main.length ? bi(main.map((f) => FAMILY_TEXT[f]!.en).join(" + ").replace(/^./, (c) => c.toUpperCase()), main.map((f) => FAMILY_TEXT[f]!.es).join(" + ").replace(/^./, (c) => c.toUpperCase())) : bi(`Zoning ${ds.map((d) => d.code).join(", ")}`, `Calificación ${ds.map((d) => d.code).join(", ")}`);
  }
  const ff = findings.find((f) => f.id === "flood_zone");
  if (ff && ff.state === "sourced") {
    const zones = parcelZones.length ? parcelZones.map((z) => ({ zone: z.zone, sub: z.subtype ?? "" })) : fm ? [{ zone: fm.zone, sub: "" }] : [];
    const worst = (z: { zone: string; sub: string }) => /^V/.test(z.zone) ? 3 : /^A/.test(z.zone) ? 2 : /0\.2/.test(z.sub) ? 1 : /^D/.test(z.zone) ? 1 : 0;
    const top = [...zones].sort((a, b) => worst(b) - worst(a))[0];
    if (top) {
      const lvl = worst(top);
      const [en, es, pe, ps] =
        /^V/.test(top.zone) ? [`High-risk coastal flood area with wave action (FEMA Zone ${top.zone}).`, `Área costera de alto riesgo de inundación con oleaje (Zona ${top.zone} de FEMA).`, "High coastal flood risk", "Alto riesgo de inundación costera"]
        : /^A/.test(top.zone) ? [`High flood risk: inside FEMA's 1%-annual-chance flood area (Zone ${top.zone}).`, `Alto riesgo de inundación: dentro del área de 1% de probabilidad anual de FEMA (Zona ${top.zone}).`, "High flood risk", "Alto riesgo de inundación"]
        : /^D/.test(top.zone) ? [`Flood risk not determined by FEMA (Zone D).`, `Riesgo de inundación no determinado por FEMA (Zona D).`, "Flood risk undetermined", "Riesgo de inundación indeterminado"]
        : lvl === 1 ? [`Moderate flood risk: FEMA's 0.2%-annual-chance area (shaded Zone X).`, `Riesgo moderado de inundación: área de 0.2% de probabilidad anual de FEMA (Zona X sombreada).`, "Moderate flood risk", "Riesgo moderado de inundación"]
        : [`Low flood risk: outside FEMA's mapped high-risk flood areas (Zone X). Low risk is not no risk.`, `Bajo riesgo de inundación: fuera de las áreas de alto riesgo mapeadas por FEMA (Zona X). Bajo riesgo no es riesgo cero.`, "Low flood risk", "Bajo riesgo de inundación"];
      ff.plain = bi(en, es);
      ff.pill = bi(pe, ps);
    }
  }
  const tf = findings.find((f) => f.id === "terrain");
  if (tf && tf.state === "sourced" && tf.value) {
    tf.plain = bi(`${tf.value.en} landslide susceptibility at the pin (USGS).${tf.tone === "hazard" ? " Plan a geotechnical evaluation before earthwork." : tf.tone === "attention" ? " Slopes may need attention during design." : ""}`, `Susceptibilidad ${tf.value.es.toLowerCase()} a deslizamientos en el pin (USGS).${tf.tone === "hazard" ? " Planifique una evaluación geotécnica antes de mover tierra." : tf.tone === "attention" ? " Las pendientes pueden requerir atención en el diseño." : ""}`);
    tf.pill = bi(`${tf.value.en} landslide risk`, `Riesgo ${tf.value.es.toLowerCase()} de deslizamiento`);
  }
  const cf = findings.find((f) => f.id === "coastal_zone");
  if (cf && cf.state === "sourced") { cf.plain = bi("Inside the coastal zone — coastal-zone review may apply to work here.", "Dentro de la zona costanera — puede aplicar revisión de zona costanera."); cf.pill = bi("Coastal zone", "Zona costanera"); }
  else if (cf && cf.state === "none_mapped") { cf.plain = bi("Not in the mapped coastal zone.", "Fuera de la zona costanera mapeada."); cf.pill = bi("Not coastal", "No costero"); }
  const lf = findings.find((f) => f.id === "land_class");
  if (lf && lf.state === "sourced" && lc) {
    const fam = lc.tags[0];
    lf.plain = fam === "SREP" ? bi("Specially protected rustic land — development is heavily restricted.", "Suelo rústico especialmente protegido — el desarrollo está muy restringido.")
      : fam === "SRC" ? bi("Common rustic (rural) land.", "Suelo rústico común.")
      : fam === "SU" ? bi("Urban land.", "Suelo urbano.")
      : null;
    lf.pill = fam === "SREP" ? bi("Protected rustic land", "Suelo rústico protegido") : null;
  }
  const af = findings.find((f) => f.id === "flood_advisory");
  if (af && af.state === "sourced") { af.plain = bi("JP's advisory map shows a flood area here. It is separate from FEMA's effective map — ask the reviewing agency which applies.", "El mapa de asesoramiento de la JP muestra un área inundable aquí. Es distinto del mapa vigente de FEMA — pregunte a la agencia cuál aplica."); af.pill = bi("Advisory flood area", "Área inundable (asesoría)"); }
  for (const id of ["historic_zone", "protected_area"]) {
    const f = findings.find((x) => x.id === id);
    if (f?.state === "sourced") f.pill = f.title;
  }

  // ---- Constraint classes (deterministic, from official findings) --------
  const fid = (id: string) => findings.find((f) => f.id === id);
  const zParcelDistricts = parcel?.zoning.status === "sourced" ? parcel.zoning.districts : [];
  const conservationDistricts = zParcelDistricts.filter((d) => d.family === "conservation");
  const pointConservation = zPoint?.status === "resolved" && current && zPoint.tags.includes("conservation");
  const protectedLand = lc?.status === "resolved" && current && lc.tags.includes("SREP");
  const classify = (id: string, c: ConstraintClass) => { const f = fid(id); if (f && f.state === "sourced") f.constraint = c; };
  if (conservationDistricts.length || pointConservation) classify("zoning", "protection");
  if (protectedLand) classify("land_class", "protection");
  // Protection designations read red everywhere (preview pills, drawer, PDF).
  for (const f of findings) if (f.constraint === "protection") f.tone = "hazard";
  if (floodway) classify("floodway", "protection");
  classify("protected_area", "protection");
  if (sfha) classify("flood_zone", "documentation");
  classify("coastal_zone", "documentation");
  classify("historic_zone", "documentation");
  if (layer("terrain")?.tags.includes("LANDSLIDE_HIGH")) classify("terrain", "documentation");

  const steps: ReportStep[] = [];
  const step = (s: Omit<ReportStep, "basis">) => steps.push({ ...s, basis: "rule" });
  const PROTECTION_NOTE = bi(
    "This is a protection designation. It restricts what may be done on the affected land, and additional documents do not remove it. Any change to a designation is decided by the responsible agency through its own process, and no outcome is assured.",
    "Esta es una designación de protección. Restringe lo que puede hacerse en el terreno afectado y documentos adicionales no la eliminan. Cualquier cambio a una designación lo decide la agencia responsable mediante su propio proceso, sin resultado asegurado."
  );
  const zoningF = fid("zoning")!;
  if (conservationDistricts.length || pointConservation) {
    const names = conservationDistricts.length ? conservationDistricts.map((d) => `${d.code}${d.name ? ` (${d.name})` : ""}`).join(", ") : `${zPoint!.code}`;
    step({
      id: "protection_zoning",
      text: bi(`Part of this parcel is in a conservation district (${names}). Treat the affected area as restricted; confirm with the Junta de Planificación which uses, if any, it allows before planning work there.`,
               `Parte de esta parcela está en un distrito de conservación (${names}). Trate el área afectada como restringida; confirme con la Junta de Planificación qué usos permite, si alguno, antes de planificar obras allí.`),
      because: PROTECTION_NOTE,
      sources: [RC_2023, ...zoningF.sources],
      constraint: "protection",
    });
  }
  if (protectedLand) {
    step({
      id: "protection_land_class",
      text: bi("The pin is on land classified as Specially Protected Rustic Land (SREP). Development there is restricted by the classification itself.", "El pin está en Suelo Rústico Especialmente Protegido (SREP). El desarrollo allí está restringido por la propia clasificación."),
      because: PROTECTION_NOTE, sources: fid("land_class")!.sources, constraint: "protection",
    });
  }
  if (fid("protected_area")?.state === "sourced") {
    step({
      id: "protection_area",
      text: bi("The pin is inside a protected natural area. Activities there are governed by the designation and its managing agency (DRNA); do not plan land disturbance without that agency's written position.", "El pin está dentro de un área natural protegida. Las actividades allí se rigen por la designación y su agencia administradora (DRNA); no planifique movimientos de terreno sin la posición escrita de esa agencia."),
      because: PROTECTION_NOTE, sources: fid("protected_area")!.sources, constraint: "protection",
    });
  }
  if (floodway) {
    step({
      id: "protection_floodway",
      text: bi("A regulatory floodway is mapped on this site. Encroachments in a floodway are prohibited unless an engineering analysis shows no rise in flood levels; plan the project outside the floodway.", "Hay un cauce mayor reglamentario mapeado en este lugar. Las intrusiones en un cauce mayor están prohibidas salvo que un análisis de ingeniería demuestre que no aumentan los niveles de inundación; planifique el proyecto fuera del cauce mayor."),
      because: PROTECTION_NOTE, sources: [RP_13, ...(fid("floodway")?.sources ?? [])], constraint: "protection",
    });
  }
  if (zoningF.state === "sourced") {
    step({
      id: "verify_use",
      text: bi(`Confirm the planned activity is allowed in ${zoningF.value!.en} under the regulation in force, including any conditions or exceptions.`, `Confirme que la actividad planificada está permitida en ${zoningF.value!.es} según el reglamento vigente, incluidas condiciones o excepciones.`),
      because: bi("Zoning (calificación) is mapped for this site.", "La calificación está mapeada para este lugar."),
      sources: [RC_2023],
      constraint: "information",
    });
  } else {
    step({
      id: "resolve_zoning",
      text: bi("Obtain the site's calificación from the Junta de Planificación before relying on any use determination.", "Obtenga la calificación del lugar de la Junta de Planificación antes de depender de cualquier determinación de uso."),
      because: bi("Zoning could not be determined from the official map.", "No se pudo determinar la calificación del mapa oficial."),
      sources: [RC_2023],
      constraint: "information",
    });
  }
  if (sfha && !floodway) {
    step({
      id: "flood_review",
      text: bi("Plan for floodplain review of any construction or substantial improvement (e.g. elevation certificate and design to the base flood elevation).", "Prevea una revisión de zona inundable para cualquier construcción o mejora sustancial (p. ej., certificado de elevación y diseño a la elevación de inundación base)."),
      because: bi("A Special Flood Hazard Area is mapped.", "Hay un Área Especial de Riesgo a Inundación mapeada."),
      sources: [RP_13, ...(fid("flood_zone")?.sources ?? [])],
      constraint: "documentation",
    });
  }
  if (fid("coastal_zone")?.state === "sourced") {
    step({
      id: "coastal_review",
      text: bi("Expect coastal-zone consistency review for work on this site.", "Prevea una revisión de compatibilidad con la zona costanera para obras en este lugar."),
      because: bi("The site is inside the mapped coastal zone.", "El lugar está dentro de la zona costanera mapeada."),
      sources: [PMZC],
      constraint: "documentation",
    });
  }
  if (fid("historic_zone")?.state === "sourced") {
    step({
      id: "historic_zone_review",
      text: bi("Include the historic-zone review in your plans before exterior or structural work.", "Incluya la revisión de zona histórica antes de obras exteriores o estructurales."),
      because: bi("Historic zone mapped at the pin.", "Zona histórica mapeada en el pin."),
      sources: fid("historic_zone")!.sources,
      constraint: "documentation",
    });
  }
  if (fid("terrain")?.constraint === "documentation") {
    step({
      id: "geotech",
      text: bi("High landslide susceptibility is mapped: budget for a geotechnical evaluation before earthwork or foundations.", "Hay alta susceptibilidad a deslizamientos mapeada: prevea una evaluación geotécnica antes de movimientos de tierra o cimientos."),
      because: bi("USGS landslide susceptibility at the pin.", "Susceptibilidad a deslizamientos del USGS en el pin."),
      sources: fid("terrain")!.sources,
      constraint: "documentation",
    });
  }
  // Conflicting data: two sources disagree about the same thing.
  const pointZone = zPoint?.status === "resolved" && current ? zPoint.code : null;
  if (pointZone && zParcelDistricts.length && !zParcelDistricts.some((d) => d.code === pointZone)) {
    missing.push(bi(`Conflicting zoning data: the point layer says ${pointZone} but the parcel query returned ${zParcelDistricts.map((d) => d.code).join(", ")}. Confirm with the Junta de Planificación.`,
                    `Datos de calificación en conflicto: la capa del punto indica ${pointZone} pero la consulta de la parcela devolvió ${zParcelDistricts.map((d) => d.code).join(", ")}. Confirme con la Junta de Planificación.`));
  }
  const advR = layer("flood_advisory");
  if (advR?.status === "resolved" && current && fm && !fm.sfha) {
    missing.push(bi(`Flood sources differ: the JP advisory map shows ${advR.code ?? "a flood area"} at the pin, while the effective FEMA map shows Zone ${fm.zone}. Advisory maps are not the effective FIRM; ask the reviewing agency which one it will apply.`,
                    `Las fuentes de inundación difieren: el mapa de asesoramiento de la JP muestra ${advR.code ?? "un área inundable"} en el pin, mientras el mapa vigente de FEMA muestra la Zona ${fm.zone}. Los mapas de asesoramiento no son el FIRM vigente; pregunte a la agencia evaluadora cuál aplicará.`));
  }
  if (fm && parcelZones.length && !parcelZones.some((z) => z.zone === fm.zone)) {
    missing.push(bi(`Conflicting flood data: the pin is in Zone ${fm.zone} but the parcel query returned ${parcelZones.map((z) => z.zone).join(", ")}.`,
                    `Datos de inundación en conflicto: el pin está en la Zona ${fm.zone} pero la consulta de la parcela devolvió ${parcelZones.map((z) => z.zone).join(", ")}.`));
  }

  const all = [...findings.flatMap((f) => f.sources), ...steps.flatMap((s) => s.sources), ...(catSource ? [catSource] : [])];
  const sources = all.filter((s, i) => all.findIndex((o) => o.name === s.name && o.dataset_date === s.dataset_date) === i);

  const fingerprint = hash(JSON.stringify([
    site.latitude.toFixed(7), site.longitude.toFixed(7), current ? site.layers!.resolved_at : null, parcel?.retrieved_at ?? null,
    context, findings.map((f) => [f.id, f.state, f.value?.en]),
  ]));

  return {
    schema: "smartpr.property-report/v1",
    fingerprint,
    location_revision: input.revision,
    generated_at: now,
    property: {
      title: [addr.primary.split(",")[0], site.municipality.name].filter((v, i, a) => v && a.indexOf(v) === i).reverse().join(" · "),
      address: { primary: addr.primary, secondary: addr.secondary, formatted: site.formatted_address },
      municipality: site.municipality.name,
      barrio: site.barrio?.name ?? null,
      latitude: site.latitude,
      longitude: site.longitude,
      coordinate_source: site.coordinate_source,
      precision: boundary?.value ? "parcel" : site.coordinate_source === "GEOCODED_ADDRESS" ? "address" : "point",
      near_boundary: site.near_boundary,
      catastro: { value: catastroValue, state: catastroValue ? "sourced" : parcelState(boundary?.status), source: catSource },
      boundary: {
        state: parcelState(boundary?.status),
        geometry: boundary?.value?.geometry ?? null,
        area_m2: boundary?.value ? fmtArea(boundary.value.area_m2) : null,
        source: boundary ? { name: boundary.source.name, url: boundary.source.url, dataset_date: boundary.source.dataset_date, version: null } : null,
      },
      technical: {
        nad83_state_plane: {
          x: Math.round(sp.x * 100) / 100,
          y: Math.round(sp.y * 100) / 100,
          epsg: 32161,
          note: bi("Computed from the WGS84 pin (NAD83 and WGS84 differ by about 1 m here).", "Calculado del pin WGS84 (NAD83 y WGS84 difieren cerca de 1 m aquí)."),
        },
        municipality_fips: site.municipality.fips,
        barrio_geoid: site.barrio?.geoid ?? null,
        location_id: site.location_id,
      },
    },
    findings,
    ai_explanations: [],
    next_steps: { activity, missing, unresolved, steps, location_requirements: context.locationRequirements },
    sources,
    disclaimer: bi("Reference information from official map sources, not a survey or a permit decision. No permission or approval is implied.", "Información de referencia de fuentes cartográficas oficiales; no es una mensura ni una decisión de permiso. No implica permiso ni aprobación."),
  };
}

/** Every finding belongs to the report's own (confirmed) location. */
export function belongsToSite(report: PropertyReport): boolean {
  return report.findings.every((f) => !f.point || (Math.abs(f.point.latitude - report.property.latitude) < 1e-7 && Math.abs(f.point.longitude - report.property.longitude) < 1e-7));
}

/** Plain-text summary for "Copy summary". */
export function reportSummaryText(r: PropertyReport, lang: "en" | "es", review: ReturnType<typeof exportableReview> = null): string {
  const t = (b: Bi | null) => (b ? b[lang] : "—");
  const L = (en: string, es: string) => (lang === "es" ? es : en);
  const lines = [
    `${L("Property & Site Report", "Informe de propiedad y lugar")} — ${r.property.title}`,
    `${r.property.address.primary}, ${r.property.address.secondary}`,
    `${L("Coordinates", "Coordenadas")}: ${r.property.latitude.toFixed(6)}, ${r.property.longitude.toFixed(6)}`,
    `${L("Catastro", "Catastro")}: ${r.property.catastro.value ?? t(STATE_TEXT[r.property.catastro.state])}`,
    ...(r.property.boundary.area_m2 ? [`${L("Approximate area", "Área aproximada")}: ${r.property.boundary.area_m2.toLocaleString("en-US")} m² (${L("mapped boundary, not a survey", "límite mapeado, no mensura")})`] : []),
    "",
    ...r.findings.map((f) => `• ${f.constraint === "protection" ? L("[PROTECTION] ", "[PROTECCIÓN] ") : f.constraint === "documentation" ? L("[REVIEW/DOCS] ", "[REVISIÓN/DOCS] ") : ""}${t(f.title)}: ${f.value ? t(f.value) : t(STATE_TEXT[f.state])}${f.scope === "parcel" ? L(" (whole parcel)", " (toda la parcela)") : f.scope === "point" ? L(" (at the pin)", " (en el pin)") : ""}`),
    "",
    L("Next steps", "Próximos pasos") + ":",
    ...r.next_steps.steps.map((s) => `- ${t(s.text)} [${s.sources.map((x) => x.name).join("; ")}]`),
    ...(r.next_steps.missing.length ? ["", L("Still needed", "Aún falta") + ":", ...r.next_steps.missing.map((m) => `- ${t(m)}`)] : []),
    ...(review ? [
      "",
      `${L("Professional review", "Revisión profesional")}: ${review.status_text[lang]}${review.reviewed_at ? ` (${review.reviewed_by?.name ?? ""} ${review.reviewed_at.slice(0, 10)})` : ""} — ${review.disclaimer[lang]}`,
      ...review.notes.map((n) => `- ${L("Note", "Nota")}${n.finding_id ? ` [${n.finding_id}]` : ""}: ${n.text}`),
      ...review.open_questions.map((q) => `- ${L("Open question", "Pregunta pendiente")}${q.finding_id ? ` [${q.finding_id}]` : ""}: ${q.text}`),
      ...review.resolved_questions.map((q) => `- ${L("Resolved", "Resuelta")}: ${q.text} → ${q.resolution}`),
    ] : []),
    "",
    `${L("Generated", "Generado")}: ${r.generated_at}`,
    t(r.disclaimer),
  ];
  return lines.join("\n");
}

/** Defensive restore of a saved report (Passport / snapshot). */
export function restorePropertyReport(raw: unknown): PropertyReport | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as PropertyReport;
  if (r.schema !== "smartpr.property-report/v1" || !r.property || !Array.isArray(r.findings)) return null;
  return r;
}
