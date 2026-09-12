#!/usr/bin/env npx tsx
/**
 * Converts the statically authored Act 60 incentive catalog
 * (src/app/incentives/prCatalog.ts) into jurisdiction-pack JSON seed files
 * for the knowledge graph, so incentive programs become real graph nodes:
 *
 *   src/kb/incentive_programs.json   -> tax_incentive nodes
 *   src/kb/eligibility_criteria.json -> eligibility_criterion nodes
 *   src/kb/benefits.json             -> benefit nodes
 *   src/kb/project_facts.json        -> project_fact nodes
 *   src/kb/incentive_sources.json    -> regulatory_source nodes
 *
 * Node ids match the static catalog's program ids exactly, so the graph
 * programs REPLACE the static entries via mergeProgramCatalogs (graph is
 * authoritative; static survives only for ids the graph doesn't define).
 *
 * Deterministic: re-running produces byte-identical output. Run after any
 * edit to prCatalog.ts:
 *   npx tsx scripts/build-incentive-seed.mts
 */
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PR_ACT60_CATALOG } from "../src/app/incentives/prCatalog.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const kbDir = join(root, "src", "kb");

/** Static catalog industry display name -> graph industry node id. */
const INDUSTRY_MAP: Record<string, string> = {
  "Accommodation & Tourism": "IND_TOURISM",
  "Agriculture & Farming": "IND_AGRICULTURE",
  "Arts, Entertainment & Recreation": "IND_ARTS",
  "Automotive": "IND_AUTOMOTIVE",
  "Beauty & Personal Care": "IND_BEAUTY",
  "Construction": "IND_CONSTRUCTION",
  "Education & Training": "IND_EDUCATION",
  "Energy & Utilities": "IND_ENERGY",
  "Finance & Insurance": "IND_FINANCE",
  "Food & Beverage": "IND_FOOD",
  "Healthcare": "IND_HEALTH",
  "Information Technology": "IND_IT",
  "Manufacturing": "IND_MANUFACTURING",
  "Professional Services": "IND_PROF",
  "Real Estate": "IND_REALESTATE",
  "Retail": "IND_RETAIL",
  "Transportation & Logistics": "IND_TRANSPORT",
  "Wholesale Distribution": "IND_WHOLESALE",
  "Government Contractor": "IND_GOVCON",
  "Nonprofit / Religious Organization": "IND_NONPROFIT",
};

/** Static catalog agency id -> graph agency node id (kb/agencies.json). */
const AGENCY_MAP: Record<string, string> = {
  AGENCY_DDEC: "ddec",
  AGENCY_OCIF: "ocif",
  AGENCY_ICP: "icp",
};

const programs: Record<string, unknown>[] = [];
const criteriaById = new Map<string, Record<string, unknown>>();
const benefits: Record<string, unknown>[] = [];
const factsByKey = new Map<string, Record<string, unknown>>();
const sourcesById = new Map<string, Record<string, unknown>>();

/**
 * Programs the graph cannot publish yet. PR_ACT60_RND has no modeled
 * eligibility criteria and no industry scope (the static catalog lists its
 * industry as "Other"), so a graph node would be vacuous — undiscoverable
 * and unevaluable. It stays static-only via mergeProgramCatalogs (F11) until
 * its real statutory criteria are researched. Never invent criteria to fill
 * the gap.
 */
const SKIP_PROGRAMS = new Set(["PR_ACT60_RND"]);

for (const p of PR_ACT60_CATALOG) {
  if (SKIP_PROGRAMS.has(p.id)) continue;
  const administering = AGENCY_MAP[p.administeringAgency.id];
  if (!administering) throw new Error(`unknown agency ${p.administeringAgency.id} for ${p.id}`);
  const application = p.applicationAgency ? AGENCY_MAP[p.applicationAgency.id] : undefined;

  const criterionIds: string[] = [];
  for (const c of p.criteria) {
    criterionIds.push(c.id);
    if (!criteriaById.has(c.id)) {
      const factId = `FACT_${c.factKey.toUpperCase()}`;
      criteriaById.set(c.id, {
        id: c.id,
        name: c.name,
        description: c.description,
        project_fact_id: factId,
        fact_key: c.factKey,
        operator: c.operator,
        ...(c.expectedValue !== undefined ? { expected_value: c.expectedValue } : {}),
        ...(c.expectedValues ? { expected_values: c.expectedValues } : {}),
        required: c.required,
        material: c.material,
        question: c.question ?? undefined,
        answer_type: c.answerType ?? undefined,
        answer_options: c.answerOptions?.length ? c.answerOptions : undefined,
        evidence_type_ids: [],
        evidence_can_satisfy: false,
        citation: c.citation,
      });
      if (!factsByKey.has(c.factKey)) {
        factsByKey.set(c.factKey, {
          id: factId,
          name: c.name,
          fact_key: c.factKey,
          value_type: "boolean",
          description: c.description,
        });
      }
    }
  }

  const benefitIds: string[] = [];
  for (const b of p.benefits) {
    const bid = `${p.id}_${b.id}`;
    benefitIds.push(bid);
    benefits.push({
      id: bid,
      name: b.name,
      description: b.description,
      benefit_type: "tax_incentive",
      amount_description: b.amountDescription ?? undefined,
      citation: b.citation,
    });
  }

  const sourceIds: string[] = [];
  for (const s of p.sources) {
    sourceIds.push(s.id);
    if (!sourcesById.has(s.id)) {
      sourcesById.set(s.id, {
        id: s.id,
        name: s.name,
        source_type: s.sourceType,
        legal_status: s.legalStatus,
        jurisdiction: s.jurisdiction,
        citation: s.citation,
        url: s.url,
        effective_date: s.effectiveDate ?? undefined,
        last_verified_at: s.lastVerifiedAt,
        source_version: s.sourceVersion,
      });
    }
  }

  const industryIds = p.applicableIndustries.names
    .map((n) => INDUSTRY_MAP[n])
    .filter((v): v is string => !!v);
  const unmapped = p.applicableIndustries.names.filter((n) => n !== "Other" && !INDUSTRY_MAP[n]);
  if (unmapped.length) throw new Error(`${p.id}: unmapped industries: ${unmapped.join(", ")}`);

  programs.push({
    id: p.id,
    name: p.name,
    description: p.description,
    administering_agency_id: administering,
    ...(application ? { application_agency_id: application } : {}),
    authorized_by_ids: sourceIds,
    industry_ids: industryIds,
    municipality_ids: [],
    geography_level: "Puerto Rico",
    criterion_ids: criterionIds,
    benefit_ids: benefitIds,
    application_process: p.applicationProcess ?? undefined,
    program_status: p.status,
    effective_from: p.effectiveFrom ?? undefined,
    effective_to: p.effectiveTo ?? undefined,
    last_verified_at: p.lastVerifiedAt,
    source_version: p.sourceVersion,
    automatic_eligibility: false,
  });
}

const write = (name: string, rows: Record<string, unknown>[]) => {
  writeFileSync(join(kbDir, name), JSON.stringify(rows, null, 2) + "\n");
  console.log(`${name}: ${rows.length} rows`);
};

write("incentive_programs.json", programs);
write("eligibility_criteria.json", [...criteriaById.values()]);
write("benefits.json", benefits);
write("project_facts.json", [...factsByKey.values()]);
write("incentive_sources.json", [...sourcesById.values()]);
