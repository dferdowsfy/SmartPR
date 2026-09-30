// ============================================================================
// "What this location means" — location-driven requirements (server side).
//
// Runs the SAME deterministic rules engine and knowledge source as the
// obligation pipeline (published KB snapshot, else the bundled KB) with the
// location's AUTHORITATIVE municipality (Census boundary determination) and
// its location facts, then reports only what the location itself drives:
//
//   - triggered_by_location: requirements whose matched rule is a
//     municipality_flag rule (e.g. "tourism" municipio + hotel → PRTC
//     innkeeper registration) or a project_fact rule on a `location.*` fact.
//   - site_scoped: requirements issued for a specific premises or municipio
//     (use permit, fire/health certification, patente) — they follow the site.
//
// Nothing is concluded here and nothing is persisted: this is re-evaluated
// on every request against the current KB and boundary data.
// ============================================================================

import type { Pool } from "pg";
import { loadPublishedSnapshot } from "../compliance/server";
import { ACTIVE_JURISDICTION } from "../jurisdictions";
import { LOCATION_SCOPED_DOCUMENTS, MUNICIPALITY_SCOPED_DOCUMENTS } from "../kb";
import { runRulesEngine, type EngineInput, type KBRule, type KnowledgeBase } from "../rulesEngine";
import { currentGeography, normalizeMunicipio, type PassportLocationWithGeographies } from "./geo";
export { DESIGNATION_LABELS, normalizeMunicipio } from "./geo";
import { buildLocationContext, withLocationContext } from "./locationContext";

export interface LocationRequirement {
  document_id: string;
  name: string;
  agency: string;
  /** Why the location drives it, in engine terms. */
  basis: "municipality_flag" | "location_fact" | "site_scoped";
  /** The designation (flag) that triggered it, when basis=municipality_flag. */
  designation: string | null;
  reason: string;
  citation: string | null;
  citation_url: string | null;
  /** Already an obligation on this business's checklist. */
  tracked: boolean;
}

export interface LocationRequirementsView {
  location_id: string;
  municipality: {
    name: string;
    fips: string | null;
    source_name: string | null;
    source_version: string | null;
    near_boundary: boolean;
  } | null;
  barrio: { name: string; barrio_pueblo: boolean } | null;
  designations: string[];
  business_type: string | null;
  passport_municipality: string | null;
  /** null when either side is unknown. */
  passport_matches: boolean | null;
  triggered_by_location: LocationRequirement[];
  site_scoped: LocationRequirement[];
  knowledge_source: "PUBLISHED_SNAPSHOT" | "BUNDLED_KB";
}


export interface BusinessFacts {
  business_type: string | null;
  onboarding_mode: "NEW" | "EXISTING" | null;
  passport_municipality: string | null;
  tracked_requirement_ids: Set<string>;
}

/** Pure core (testable without a database). */
export function evaluateLocationRequirements(
  kb: KnowledgeBase,
  location: PassportLocationWithGeographies,
  business: BusinessFacts,
  knowledgeSource: LocationRequirementsView["knowledge_source"]
): LocationRequirementsView {
  const ctx = buildLocationContext(location, location.geographies);
  const muniGeo = ctx.municipality;
  const barrioGeo = currentGeography(location.geographies, "barrio");
  const kbMunicipality = muniGeo
    ? kb.municipalities.find((m) => normalizeMunicipio(m.name) === normalizeMunicipio(muniGeo.name))
    : undefined;

  const passportMuni = business.passport_municipality?.trim() || null;
  const view: LocationRequirementsView = {
    location_id: location.id,
    municipality: muniGeo?.name
      ? {
          name: kbMunicipality?.name ?? muniGeo.name,
          fips: muniGeo.code,
          source_name: muniGeo.source.name,
          source_version: muniGeo.source.version,
          near_boundary: Boolean(
            location.geographies.find((g) => g.geography_type === "municipality" && g.source_id === muniGeo.source.id)
              ?.metadata?.near_boundary
          ),
        }
      : null,
    barrio:
      barrioGeo?.geography_name && barrioGeo.determination_method === "SPATIAL_INTERSECTION"
        ? { name: barrioGeo.geography_name, barrio_pueblo: barrioGeo.metadata?.barrio_pueblo === true }
        : null,
    designations: kbMunicipality ? [...kbMunicipality.flags] : [],
    business_type: business.business_type,
    passport_municipality: passportMuni,
    passport_matches:
      passportMuni && muniGeo?.name ? normalizeMunicipio(passportMuni) === normalizeMunicipio(muniGeo.name) : null,
    triggered_by_location: [],
    site_scoped: [],
    knowledge_source: knowledgeSource,
  };
  // Without an authoritative municipality there is nothing location-driven
  // the engine can evaluate honestly.
  if (!kbMunicipality) return view;

  const base: EngineInput = {
    municipalityName: kbMunicipality.name,
    businessTypeName: business.business_type,
    // A saved Passport location is a physical site.
    answers: { Q_PHYSICAL_LOCATION: true, Q_HOME_BASED: false, Q_ONLINE_ONLY: false },
    businessStatus: business.onboarding_mode === "EXISTING" ? "existing" : business.onboarding_mode === "NEW" ? "new" : null,
  };
  const result = runRulesEngine(kb, withLocationContext(base, ctx));
  const rulesById = new Map<string, KBRule>(kb.rules.map((r) => [r.id, r]));
  const docById = new Map(kb.documents.map((d) => [d.id, d]));

  const cite = (rule: KBRule | undefined) => {
    const r = rule as (KBRule & { citation?: string; citation_url?: string }) | undefined;
    return { citation: r?.citation ?? null, citation_url: r?.citation_url ?? null };
  };

  const seen = new Set<string>();
  for (const match of result.debug.rulesMatched) {
    const rule = rulesById.get(match.rule_id);
    const locationFact = match.rule_type === "project_fact" && (rule?.fact_key ?? "").startsWith("location.");
    if (match.rule_type !== "municipality_flag" && !locationFact) continue;
    if (seen.has(match.document_id)) continue;
    seen.add(match.document_id);
    const req = result.requirements.find((r) => r.document_id === match.document_id);
    const doc = docById.get(match.document_id);
    const designation = rule?.municipality_flag ?? null;
    view.triggered_by_location.push({
      document_id: match.document_id,
      name: req?.document_name ?? doc?.name ?? match.document_id,
      agency: req?.agency ?? doc?.agency ?? "",
      basis: locationFact ? "location_fact" : "municipality_flag",
      designation,
      reason: designation
        ? `${kbMunicipality.name} is designated "${designation}" in SmartPR's knowledge base, and this rule applies to ${business.business_type ?? "this business type"} there.`
        : match.reason,
      ...cite(rule),
      tracked: business.tracked_requirement_ids.has(match.document_id),
    });
  }

  for (const req of result.requirements) {
    if (seen.has(req.document_id)) continue;
    const scoped = LOCATION_SCOPED_DOCUMENTS.has(req.document_id) || MUNICIPALITY_SCOPED_DOCUMENTS.has(req.document_id);
    if (!scoped) continue;
    seen.add(req.document_id);
    view.site_scoped.push({
      document_id: req.document_id,
      name: req.document_name,
      agency: req.agency,
      basis: "site_scoped",
      designation: null,
      reason: MUNICIPALITY_SCOPED_DOCUMENTS.has(req.document_id)
        ? `Filed with the Municipio de ${kbMunicipality.name}.`
        : `Issued for this specific premises in ${kbMunicipality.name}.`,
      ...cite(rulesById.get(req.source_rule_id)),
      tracked: business.tracked_requirement_ids.has(req.document_id),
    });
  }
  return view;
}

/** Load business facts + the active knowledge source, then evaluate. */
export async function locationRequirementsFor(
  pool: Pool,
  businessId: string,
  location: PassportLocationWithGeographies
): Promise<LocationRequirementsView> {
  const [biz, tracked, published] = await Promise.all([
    pool.query<{ business_type: string | null; onboarding_mode: "NEW" | "EXISTING" | null; passport_muni: string | null; municipality: string | null }>(
      `SELECT business_type, onboarding_mode, passport_json->'addresses'->>'municipality' AS passport_muni, municipality
         FROM businesses WHERE id=$1`,
      [businessId]
    ),
    pool.query<{ requirement_id: string }>(
      `SELECT DISTINCT requirement_id FROM obligations WHERE business_id=$1 AND requirement_id IS NOT NULL`,
      [businessId]
    ),
    loadPublishedSnapshot(pool),
  ]);
  const row = biz.rows[0];
  const kb = (published ?? ACTIVE_JURISDICTION.kb) as KnowledgeBase;
  return evaluateLocationRequirements(
    kb,
    location,
    {
      business_type: row?.business_type ?? null,
      onboarding_mode: row?.onboarding_mode ?? null,
      passport_municipality: row?.passport_muni || row?.municipality || null,
      tracked_requirement_ids: new Set(tracked.rows.map((r) => r.requirement_id)),
    },
    published ? "PUBLISHED_SNAPSHOT" : "BUNDLED_KB"
  );
}
