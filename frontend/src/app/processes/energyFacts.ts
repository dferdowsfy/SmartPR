// ProjectContext (validated LLM extraction + guided answers) → engine fact map.
//
// Only facts at or above the "applies" confidence band (0.60) are used, and
// every fact keeps its evidence quote so explanations can show where it came
// from. Nothing is inferred here beyond two mechanical normalizations:
//   - `proposed_energy_services` arrives as a comma-separated string;
//   - `interconnection_required` is the plain-language form of
//     `parallel_operation` (both are read by the graph rules).
import type { ProjectContext } from "../ai/intake/projectContext.ts";
import type { FactEvidence, FactMap, FactValue, ProcessKB } from "./types.ts";

export const MIN_FACT_CONFIDENCE = 0.6;

function normalizeToken(s: string): string {
  return s.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export function energyFactsFromProjectContext(
  context: ProjectContext | null | undefined,
  kb: Pick<ProcessKB, "facts">,
  extra?: {
    municipality?: string | null;
    answers?: Record<string, unknown> | null;
    /**
     * `location.*` facts of the confirmed site (intake pin / Passport
     * location, locations/intakeLocation.siteEngineFacts) with their
     * explanations. Map layers answer the siting questions the description
     * left open: flood zone / coastal zone → site_flood_hazard_area / site_coastal_zone,
     * JP land classification / calificación → site_zoning.
     */
    location?: { facts: Record<string, unknown>; details?: Record<string, { en: string; es: string }> } | null;
  }
): { facts: FactMap; evidence: FactEvidence } {
  const facts: FactMap = {};
  const evidence: FactEvidence = {};
  const defs = new Map(kb.facts.map((f) => [f.key, f]));
  const raw = (context ?? {}) as Record<string, { value: string | number | boolean; confidence: number; evidence?: string } | undefined>;
  for (const [key, def] of defs) {
    const fact = raw[key];
    if (!fact || fact.value === undefined || fact.value === null || fact.value === "") continue;
    if (fact.confidence < MIN_FACT_CONFIDENCE) continue;
    let value: FactValue = fact.value;
    if (def.type === "list") {
      value = String(fact.value).split(/[,;/]| and /).map(normalizeToken).filter(Boolean);
    } else if (def.type === "enum" && typeof value === "string") {
      value = normalizeToken(value);
    } else if (def.type === "boolean" && typeof value === "string") {
      const l = value.trim().toLowerCase();
      if (l === "true" || l === "yes") value = true;
      else if (l === "false" || l === "no") value = false;
      else continue;
    }
    facts[key] = value;
    evidence[key] = { quote: fact.evidence, confidence: fact.confidence, origin: "project_context" };
  }
  if (facts.parallel_operation === undefined && typeof facts.interconnection_required === "boolean") {
    facts.parallel_operation = facts.interconnection_required;
    evidence.parallel_operation = { ...evidence.interconnection_required, origin: "alias:interconnection_required" };
  }
  // Answers to the legacy solar discovery questions are user-provided facts
  // too; they fill gaps the description left (never override it).
  const answer = (id: string): unknown => {
    const a = extra?.answers;
    if (!a) return undefined;
    return a[id] ?? a[id.replace(/^Q_/, "").toLowerCase()];
  };
  const battery = answer("Q_SOLAR_BATTERY");
  if (facts.battery_storage === undefined && typeof battery === "boolean") {
    facts.battery_storage = battery;
    evidence.battery_storage = { origin: "discovery_answer:Q_SOLAR_BATTERY" };
  }
  const mounting = answer("Q_SOLAR_MOUNTING");
  if (facts.mounting_type === undefined && typeof mounting === "string") {
    const m = /ground/i.test(mounting) ? "ground" : /roof/i.test(mounting) ? "roof" : null;
    if (m) {
      facts.mounting_type = m;
      evidence.mounting_type = { origin: "discovery_answer:Q_SOLAR_MOUNTING" };
    }
  }
  if (extra?.location) applyLocationFacts(facts, evidence, extra.location);
  if (facts.municipality === undefined && extra?.municipality) {
    facts.municipality = extra.municipality;
    evidence.municipality = { origin: "intake_field" };
  }
  return { facts, evidence };
}

/** True when the project context mentions anything energy-related at all. */
export function hasEnergySignal(facts: FactMap): boolean {
  return Object.keys(facts).some((k) => k !== "municipality" && facts[k] !== undefined);
}

/**
 * Site-zoning class of the pin, from the JP land classification and
 * calificación facts (locations/layers): industrial and agricultural
 * districts first (they decide the wind / solar hearing rules), then the
 * land class. Null when the layers did not resolve.
 */
export function siteZoningFromLocation(lf: Record<string, unknown>): string | null {
  if (lf["location.zoning.industrial"] === true) return "industrial";
  if (lf["location.zoning.agricultural"] === true) return "agricultural";
  if (lf["location.land_class.srep"] === true) return "specially_protected_rustic";
  if (lf["location.land_class.src"] === true) return "other_rustic";
  if (lf["location.land_class.su"] === true || lf["location.land_class.urbano"] === true) return "urban";
  return null;
}

function applyLocationFacts(
  facts: FactMap,
  evidence: FactEvidence,
  location: { facts: Record<string, unknown>; details?: Record<string, { en: string; es: string }> }
): void {
  const lf = location.facts;
  const detail = (key: string) => location.details?.[key]?.en;
  // The pin's flood and coastal zones are their own facts (the reviews key
  // on them alongside a stated environmental_sensitivity), so the user is
  // still asked about wetlands / habitat, which no loaded layer answers.
  // A layer that is unknown or says "outside" adds nothing.
  if (lf["location.flood_zone.sfha"] === true) {
    facts.site_flood_hazard_area = true;
    evidence.site_flood_hazard_area = { quote: detail("location.flood_zone.sfha"), origin: "location:location.flood_zone.sfha" };
  }
  if (lf["location.czm"] === true) {
    facts.site_coastal_zone = true;
    evidence.site_coastal_zone = { quote: detail("location.czm"), origin: "location:location.czm" };
  }
  // Site zoning only fills the gap the description left (never overrides it).
  if (facts.site_zoning === undefined) {
    const z = siteZoningFromLocation(lf);
    if (z) {
      facts.site_zoning = z;
      const key = z === "industrial" || z === "agricultural" ? "location.zoning" : "location.land_class";
      evidence.site_zoning = { quote: detail(key), origin: `location:${key}` };
    }
  }
}
