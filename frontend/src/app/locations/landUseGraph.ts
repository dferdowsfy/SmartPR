/** Land-use graph from knowledge-graph nodes (admin DTOs or the bundled seed). */
import { buildSeedNodes } from "../rk/seed-data";
import { reason, type ReasoningGraph } from "../reasoning/scenarioReasoning";

import { reasoningGraphFromNodes } from "../reasoning/loadGraph";
import type { IntakeSite } from "./intakeLocation";
import { siteLayersCurrent } from "./intakeLocation";
import type { ParcelFindings, ExtraFinding } from "./parcel";
import { analyzeLandUse, parseProposedActivity, type LandUseAnalysis, type LandUseGraph, type ProposedActivity, type SourceRef, type ParcelFacts } from "./landUse";
interface NodeLike { nodeType: string; entityId: string; data: Record<string, unknown>; status?: string }
const INACTIVE = new Set(["archived", "superseded", "rolled_back", "inactive"]);

export function landUseGraphFromNodes(nodes: NodeLike[]): LandUseGraph {
  const g: LandUseGraph = { zoningDistricts: [], landUses: [], usePermissions: [], developmentStandards: [], siteRules: [], documents: [], sources: [] };
  const bucket: Record<string, keyof LandUseGraph> = {
    zoning_district: "zoningDistricts", land_use: "landUses", use_permission: "usePermissions", development_standard: "developmentStandards",
    site_rule: "siteRules", document: "documents", regulatory_source: "sources",
  };
  for (const n of nodes) {
    const b = bucket[n.nodeType];
    if (!b || (n.status && INACTIVE.has(n.status))) continue;
    g[b].push({ ...n.data, id: n.entityId });
  }
  return g;
}

let bundled: { lu: LandUseGraph; rg: ReasoningGraph } | null = null;
export function bundledLandUseGraphs() {
  if (!bundled) {
    const nodes = buildSeedNodes().map((n) => ({ nodeType: n.nodeType, entityId: n.entityId, data: n.data, status: "active" }));
    bundled = { lu: landUseGraphFromNodes(nodes), rg: reasoningGraphFromNodes(nodes) };
  }
  return bundled;
}

/**
 * Permit paths from the existing scenario graph for this activity
 * (START_NEW_BUSINESS / REMODEL / NEW_CONSTRUCTION → Permiso Único / PCOC).
 */
export function scenarioPathsForActivity(rg: ReasoningGraph, a: ProposedActivity) {
  const residential = a.use === "LU_MULTIFAMILY" || a.use === "LU_SINGLE_FAMILY";
  const construction = a.construction === null ? undefined : ["new", "addition", "substantial_improvement", "renovation"].includes(a.construction);
  const facts: Record<string, unknown> = {
    project_intent: residential || a.use === "LU_SOLAR_UTILITY" || a.use === "LU_SUBDIVISION" || a.use === "LU_DEMOLITION" ? "project_only" : "new_business",
    existing_premises: a.construction === null ? undefined : a.construction !== "new",
    construction_required: construction,
    new_construction: a.construction === null ? undefined : a.construction === "new",
    project_types: a.construction === "new" ? ["new_construction"] : a.construction === "renovation" || a.construction === "addition" ? ["renovation"] : [],
    new_use_requested: a.changeOfUse || undefined,
    home_based: false,
    residential,
    subdivision: a.use === "LU_SUBDIVISION" || undefined,
  };
  for (const k of Object.keys(facts)) if (facts[k] === undefined) delete facts[k];
  const r = reason(rg, facts);
  const docs = new Map(rg.documents.map((d) => [d.id, d]));
  return r.paths.filter((p) => p.status === "applies").map((p) => ({
    id: p.mappingId,
    name: `${p.scenario.name} → ${p.variant?.name ?? ""}`,
    permitId: p.permit?.id ?? null,
    permitName: p.permit ? String(docs.get(p.permit.id)?.name ?? p.permit.name) : null,
    sources: p.sources.map((x): SourceRef => ({ id: x.id, name: x.name, citation: x.citation, url: x.url || null })),
    citation: p.provenance.citationSection,
  }));
}

// ---------------------------------------------------------------------------
// Parcel facts for the engine, from the confirmed site + whole-parcel findings
// ---------------------------------------------------------------------------


const yn = (e: ExtraFinding | undefined): "yes" | "no" | "unable" => (!e || e.status === "unable" ? "unable" : e.status === "verified" ? "yes" : "no");

export function parcelFactsFor(site: IntakeSite, parcel: ParcelFindings | null): ParcelFacts {
  const current = siteLayersCurrent(site);
  const by = new Map((current ? site.layers!.results : []).map((r) => [r.layer, r]));
  const p = parcel && Math.abs(parcel.latitude - site.latitude) < 1e-7 && Math.abs(parcel.longitude - site.longitude) < 1e-7 ? parcel : null;
  const zPoint = by.get("zoning");
  const districts = p?.zoning.status === "sourced"
    ? p.zoning.districts.map((d) => ({ code: d.code, name: d.name, share: p.areas_reliable?.zoning ? d.share ?? null : null, area_m2: p.areas_reliable?.zoning ? d.area_m2 ?? null : null, overlays: (d.overlays ?? []).map((o) => o.code) }))
    : zPoint?.status === "resolved" && zPoint.code ? [{ code: zPoint.code, name: zPoint.name, share: null, area_m2: null, overlays: [] }] : [];
  const fl = by.get("flood_zone");
  const floodZones = p?.flood.status === "sourced"
    ? p.flood.zones.map((z) => ({ zone: z.zone, sfha: z.sfha, floodway: z.floodway, share: p.areas_reliable?.flood ? z.share ?? null : null }))
    : fl?.status === "resolved" && fl.code ? [{ zone: fl.code, sfha: fl.tags.includes("SFHA"), floodway: fl.tags.includes("FLOODWAY"), share: null }] : [];
  const cz = by.get("coastal_zone");
  const ex = p?.extras ?? {};
  const pointYes = (id: "historic_zone" | "protected_area"): "yes" | "no" | "unable" => { const r = by.get(id); return !r || r.status === "unknown" ? "unable" : r.status === "resolved" ? "yes" : "no"; };
  const either = (a: "yes" | "no" | "unable", b: "yes" | "no" | "unable") => (a === "yes" || b === "yes" ? "yes" : a === "no" || b === "no" ? "no" : "unable");
  return {
    catastro: p?.boundary.value?.catastro ?? (by.get("parcel")?.status === "resolved" ? by.get("parcel")!.code : null),
    municipality: site.municipality.name,
    districts,
    zoningStatus: districts.length ? "verified" : p?.zoning.status === "none_mapped" ? "no_mapped" : "unable",
    flood: { zones: floodZones, status: floodZones.length ? "verified" : p?.flood.status === "none_mapped" ? "no_mapped" : "unable" },
    coastal: !cz || cz.status === "unknown" ? "unable" : cz.status === "resolved" ? "inside" : "outside",
    wetlands: yn(ex.wetlands),
    protectedArea: either(yn(ex.protected_area), pointYes("protected_area")),
    reserve: yn(ex.natural_reserve),
    archaeology: yn(ex.archaeology),
    historic: either(either(yn(ex.historic_zone), yn(ex.historic_site)), pointYes("historic_zone")),
    landslideHigh: by.get("terrain")?.tags.includes("LANDSLIDE_HIGH") ?? false,
    soilSlopeMaxPct: (() => { const m = ex.soils?.status === "verified" ? /(\d+)\s*(?:-|–|to)\s*(\d+)\s*(?:%|percent)/i.exec(ex.soils.value ?? "") : null; return m ? Number(m[2]) : null; })(),
    landClass: ex.put?.status === "verified" ? ex.put.value : by.get("land_class")?.status === "resolved" ? by.get("land_class")!.code : null,
  };
}

/** One call for the UI / tests: description → full land-use analysis on the bundled graph. */
export function analyzeProposedActivity(description: string, site: IntakeSite, parcel: ParcelFindings | null, overrides: { construction?: string | null; use?: string | null } = {}, graphs = bundledLandUseGraphs()): LandUseAnalysis {
  const a = parseProposedActivity(description, graphs.lu.landUses);
  if (overrides.use) { const n = graphs.lu.landUses.find((x) => x.id === overrides.use); if (n) { a.use = n.id; a.useName = String(n.name); } }
  if (overrides.construction) a.construction = overrides.construction as typeof a.construction;
  return analyzeLandUse(parcelFactsFor(site, parcel), a, graphs.lu, scenarioPathsForActivity(graphs.rg, a));
}
