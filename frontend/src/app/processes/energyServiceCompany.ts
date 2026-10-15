// Energy SERVICE company vs. an energy SYSTEM at this site (live Run 5 I2,
// 2026-10-15; same family as Run 3 F8 / #176 and #177).
//
// "Residential rooftop solar sales and installation company in Guayama"
// describes a company that sells and installs systems on its customers'
// roofs. The pin is its office / warehouse, not an array. The intake must not
// interrogate that office as if it were a solar plant (roof vs ground mount,
// kW/MW capacity, existing structure, Own/Lease/Customer property, LUMA
// grid connection). Those facts describe each customer's system, and are
// handled per customer job, not at the company's own premises.
//
// Intake-only scoping. No rule, permit card, threshold or citation changes:
//   - the installer company still gets every business-type rule (OPPE installer
//     registration, DACO contractor question, …) and, when the description
//     states the installer role, the energy graph's installer certification;
//   - a description that ALSO puts a system on the company's own site ("…and
//     we'll put panels on our office roof", "a 2 MW solar farm") is not a pure
//     service company, so nothing is scoped away;
//   - a user who answers a site-system question elsewhere still triggers the
//     same rules (this only stops the intake from asking / pre-filling them).
import type { ProjectContext, ProjectContextKey } from "../ai/intake/projectContext.ts";

const ENERGY_TERM = /\b(solar|photovoltaic|pv|placas solares|paneles solares|placas|paneles|energ[ií]a solar|fotovoltaic[oa]s?|batter(?:y|ies)|bater[ií]as?|energy storage|almacenamiento de energ[ií]a|renewable|renovable)\b/i;
// Selling / installing / servicing systems for others.
const SERVICE_TERM = /\b(sales|sell(?:s|ing)?|install(?:s|ing|ation|ations|er|ers)?|contractor|contratista|instalador(?:es|a)?|instalaci[oó]n(?:es)?|venta(?:s)?|vend(?:er|emos)|maintenance|mantenimiento|repair|reparaci[oó]n)\b/i;
// The described thing is a company / business, not a system.
const COMPANY_TERM = /\b(company|companies|business|firm|contractor|installer|installers|service|services|outfit|crew|compa[nñ][ií]a|empresa|negocio|contratista|instalador(?:es|a)?|servicios?)\b/i;

// A system at the company's OWN site (or a plant/project itself) — never scope away.
const OWN_SITE_SYSTEM: RegExp[] = [
  /\b(?:on|onto|atop|at|over)\s+(?:my|our|the|its|their)\s+(?:own\s+)?(?:\w+\s+){0,2}(?:roof|rooftop|building|warehouse|facility|property|home|house|land|farm|lot|plant|store|office|shop|parking|carport)\b/i,
  /\bfor\s+(?:my|our|its)\s+(?:own\s+)?(?:use|business|facility|warehouse|home|house|building|store|plant|farm|office|shop|operation|operations)\b/i,
  /\b(?:solar|energy|power|pv|battery|storage)\s+(?:farm|plant|park|project|facility|array)\b/i,
  /\b\d+(?:[.,]\d+)?\s*(?:mw|mwh|kw|kwh|kwp|mwp|megawatts?|kilowatts?)\b/i,
  /\butility[\s-]scale\b/i,
  /\bmicro[\s-]?grid\b/i,
  /\b(?:power purchase|ppa|sell(?:ing)?\s+(?:the\s+)?(?:power|electricity|energy))\b/i,
  /\b(?:en|sobre)\s+(?:mi|nuestro|nuestra|el|la)\s+(?:propio\s+)?(?:techo|edificio|almac[eé]n|finca|terreno|propiedad|casa|local|oficina)\b/i,
  /\bpara\s+(?:mi|nuestro|nuestra)\s+(?:propio\s+)?(?:uso|negocio|casa|edificio|almac[eé]n|finca|local|oficina)\b/i,
  /\b(?:parque|planta|granja)\s+(?:solar|fotovoltaic[oa]|de energ[ií]a)\b/i,
];

/**
 * True when the description is an energy sales / installation / service
 * COMPANY (systems on customers' property), with no system stated for the
 * company's own site. Conservative: "rooftop solar installation, Guaynabo"
 * (no company noun) stays a project.
 */
export function describesEnergyServiceCompany(description: string | null | undefined): boolean {
  const text = (description ?? "").trim();
  if (!text) return false;
  if (!ENERGY_TERM.test(text) || !SERVICE_TERM.test(text) || !COMPANY_TERM.test(text)) return false;
  return !OWN_SITE_SYSTEM.some((re) => re.test(text));
}

/**
 * Discovery questions about a system AT THIS SITE (KB ids and their intake
 * write keys). Not asked of an energy service company's office.
 */
export const SITE_SYSTEM_QUESTION_IDS: ReadonlySet<string> = new Set([
  "Q_SOLAR_MOUNTING", "solar_mounting",
  "Q_SOLAR_SIZE", "solar_size",
  "Q_SOLAR_STRUCTURE", "solar_existing_structure",
  "Q_SOLAR_OWNERSHIP", "solar_property_ownership",
  "Q_SOLAR_BATTERY", "solar_battery",
]);

export function isSiteSystemQuestion(id: string): boolean {
  return SITE_SYSTEM_QUESTION_IDS.has(id);
}

export function withoutSiteSystemQuestions<T extends { id: string }>(questions: readonly T[]): T[] {
  return questions.filter((q) => !isSiteSystemQuestion(q.id));
}

/** Answers with the site-system questions removed (they describe customers' systems). */
export function withoutSiteSystemAnswers<V>(answers: Record<string, V> | null | undefined): Record<string, V> {
  const out: Record<string, V> = {};
  for (const [k, v] of Object.entries(answers ?? {})) if (!isSiteSystemQuestion(k)) out[k] = v;
  return out;
}

/**
 * Project-context facts that describe the company itself and survive scoping:
 * its role, the services it offers, and incentive interest.
 */
const COMPANY_LEVEL_ENERGY_KEYS: ReadonlySet<string> = new Set([
  "energy_applicant_role",
  "proposed_energy_services",
  "energy_incentive_interest",
]);

/** Energy facts about a system at the site (capacity, mounting, grid tie, offtake, …). */
export const SITE_SYSTEM_ENERGY_KEYS: ReadonlySet<ProjectContextKey> = new Set<ProjectContextKey>([
  "generation_technology",
  "battery_storage",
  "generation_capacity_kw",
  "storage_capacity_kw",
  "mounting_type",
  "energy_project_status",
  "net_metering_requested",
  "parallel_operation",
  "interconnection_required",
  "interconnection_voltage",
  "microgrid_configuration",
  "sells_energy_to_third_parties",
  "sells_to_utility_under_ppa",
  "customer_class",
  "system_ownership",
  "properties_served",
  "common_ownership",
  "customers_served",
]);

/**
 * Project context for an energy service company: site-system facts the model
 * read off the company's service line ("rooftop" → mounting_type=roof) are
 * dropped, so the energy process graph does not open plant questions for the
 * office. Company-level facts (role, services) are kept. When the role is
 * unset, it is set to installer so the graph takes the trade path.
 */
export function scopeEnergyServiceCompanyContext(context: ProjectContext | null | undefined): ProjectContext {
  const out: ProjectContext = {};
  for (const [key, fact] of Object.entries(context ?? {}) as [ProjectContextKey, ProjectContext[ProjectContextKey]][]) {
    if (!fact) continue;
    if (SITE_SYSTEM_ENERGY_KEYS.has(key) && !COMPANY_LEVEL_ENERGY_KEYS.has(key)) continue;
    out[key] = fact;
  }
  const role = out.energy_applicant_role?.value;
  if (role !== "installer" && role !== "energy_service_provider") {
    out.energy_applicant_role = {
      value: "installer",
      confidence: 0.9,
      evidence: "sales / installation company (not a system at this site)",
    };
  }
  if (out.proposed_energy_services === undefined) {
    out.proposed_energy_services = {
      value: "installation",
      confidence: 0.85,
      evidence: "installation / sales company",
    };
  }
  return out;
}
