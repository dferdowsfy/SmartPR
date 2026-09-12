// ============================================================================
// Post-engine requirement classifier.
//
// The rules engine remains the only matcher of KB rows. This module never
// invents documents. It:
//   1. makes entity-formation certificates mutually exclusive;
//   2. keeps municipality-flag rules conditional until the user confirms the
//      flag actually applies to THIS location;
//   3. labels requirement kind vs applicability so review conditions are not
//      treated as uploadable official evidence.
// ============================================================================

import type { KnowledgeBase, GeneratedRequirement, KBRule } from "./rulesEngine";
import type { PotentialDecision } from "./potentialRequirements";
import type { EntityType } from "./forms/engine/types";

export type Applicability =
  | "required"
  | "conditional"
  | "recommended"
  | "not_applicable"
  | "completed";

export type RequirementKind =
  | "government_application"
  | "government_issued_document"
  | "supporting_evidence"
  | "inspection_or_certification"
  | "review_condition"
  | "informational_notice";

export type RequirementStage =
  | "entity_formation"
  | "tax_registration"
  | "property_zoning"
  | "operating_permits"
  | "health_safety"
  | "employment"
  | "municipal"
  | "conditional_reviews";

export interface ClassifiedRequirement {
  document_id: string;
  document_name: string;
  agency: string;
  category: string;
  reason: string;
  source_rule_id: string;
  code: string;
  mandatory: boolean;
  applicability: Applicability;
  kind: RequirementKind;
  stage: RequirementStage;
  triggerFacts: string[];
  acceptsOfficialUpload: boolean;
}

const CORPORATION_TYPES: EntityType[] = [
  "stock_corporation",
  "close_corporation",
  "professional_corporation",
  "nonprofit_nonstock_corporation",
];

const LLC_FORMATION = "DOC_ARTICLES_ORGANIZATION";
const CORP_FORMATION = "DOC_CERT_INCORPORATION";
const EIN_DOC = "DOC_EIN";

/**
 * Entity types that never file a Certificate of Incorporation (or Articles
 * of Organization): sole proprietorships and general partnerships are not
 * separate juridical persons, foreign corporations form in their home
 * jurisdiction (PR requires authorization, not incorporation), and LLPs
 * register under their own instrument. F01.
 */
const NON_INCORPORATING_TYPES = new Set([
  "sole_proprietorship",
  "partnership",
  "foreign_corporation",
  "limited_liability_partnership",
]);

const truthyAnswer = (v: boolean | string | undefined): boolean =>
  v === true || v === "true" || v === "yes" || v === "Yes";

const REVIEW_CONDITION_IDS = new Set([
  "DOC_HISTORIC_DISTRICT_REVIEW",
  "DOC_ADDITIONAL_MUNICIPAL_REVIEW",
  "DOC_SAN_JUAN_MUNICIPAL_REVIEW",
  "DOC_SIGN_VARIANCE_HISTORIC",
]);

const REVIEW_CONDITION_NAMES = [
  "additional municipal review",
  "historic district review",
  "san juan-specific municipal review",
  "san juan specific municipal review",
];

function isReviewName(name: string): boolean {
  const n = name.toLowerCase();
  return REVIEW_CONDITION_NAMES.some((item) => n.includes(item));
}

export function kindForDocument(documentId: string, name: string, category: string): RequirementKind {
  if (REVIEW_CONDITION_IDS.has(documentId) || isReviewName(name) || /review condition/i.test(category)) {
    return "review_condition";
  }
  if (/notice|informational/i.test(category) || /notice/i.test(name)) return "informational_notice";
  if (/health|fire|inspect|cfpm|waste|occupancy/i.test(name) || /health|safety|fire/i.test(category)) {
    return "inspection_or_certification";
  }
  if (/insurance|workers.?comp|cfse|bond|affidavit/i.test(name)) return "supporting_evidence";
  if (/certificate of (incorporation|organization)|ein|merchant|patente|permiso|license|registration/i.test(name)) {
    return "government_application";
  }
  if (/issued|certificate/i.test(name)) return "government_issued_document";
  return "government_application";
}

export function stageForDocument(documentId: string, name: string, category: string): RequirementStage {
  const n = `${documentId} ${name} ${category}`.toLowerCase();
  if (/incorp|organization|articles|charter|foreign.?corp|llp/.test(n)) return "entity_formation";
  if (/ein|merchant|hacienda|tax|ss-4|ss4/.test(n)) return "tax_registration";
  if (/zoning|use permit|permiso unico|ocupación|occupancy|parking|historic|facade/.test(n)) return "property_zoning";
  if (/health|fire|cfpm|waste|alcohol/.test(n)) return "health_safety";
  if (/employee|workers.?comp|cfse|payroll/.test(n)) return "employment";
  if (/patente|municipal registration|municipal tax|san juan/.test(n)) return "municipal";
  if (/traffic|stormwater|tourism|coastal|metro|review/.test(n)) return "conditional_reviews";
  if (/permit|license/.test(n)) return "operating_permits";
  return "operating_permits";
}

export function applyEntityFormationExclusivity<T extends { document_id?: string }>(
  requirements: T[],
  entityType: EntityType | string | null | undefined
): T[] {
  const type = entityType || "";
  if (type === "limited_liability_company") {
    return requirements.filter((item) => item.document_id !== CORP_FORMATION);
  }
  if (CORPORATION_TYPES.includes(type as EntityType)) {
    return requirements.filter((item) => item.document_id !== LLC_FORMATION);
  }
  if (NON_INCORPORATING_TYPES.has(type)) {
    // F01: these legal forms never incorporate in Puerto Rico — drop both
    // formation certificates rather than presenting incorporation as a
    // mandatory duty.
    return requirements.filter(
      (item) => item.document_id !== CORP_FORMATION && item.document_id !== LLC_FORMATION
    );
  }
  return requirements;
}

export function shouldAddLlcOrganization(
  existing: Array<{ document_id?: string }>,
  entityType: EntityType | string | null | undefined
): boolean {
  if (entityType !== "limited_liability_company") return false;
  return !existing.some((item) => item.document_id === LLC_FORMATION);
}

function flagForRule(kb: KnowledgeBase, ruleId: string | undefined): string | null {
  if (!ruleId) return null;
  const rule = kb.rules.find((row: KBRule) => row.id === ruleId);
  if (!rule || rule.rule_type !== "municipality_flag") return null;
  return rule.municipality_flag;
}

function decisionForFlag(
  decisions: Record<string, PotentialDecision> | undefined,
  flag: string | null
): PotentialDecision | undefined {
  if (!flag || !decisions) return undefined;
  return decisions[flag];
}

export interface ClassifyOptions {
  kb: KnowledgeBase;
  entityType?: EntityType | string | null;
  /** Same answers the engine saw, keyed by KB question id — needed for
   *  entity/employment-sensitive calls (e.g. EIN when the entity type is
   *  unknown but the user will hire employees). */
  answers?: Record<string, boolean | string | undefined>;
  potentialDecisions?: Record<string, PotentialDecision>;
  legacyCode?: Record<string, string>;
  recommendedIds?: Set<string>;
}

const APPLICABILITY_RANK: Record<Applicability, number> = {
  required: 3,
  conditional: 2,
  recommended: 1,
  not_applicable: 0,
  completed: 3,
};

export function classifyEngineRequirements(
  generated: GeneratedRequirement[],
  options: ClassifyOptions
): ClassifiedRequirement[] {
  const exclusive = applyEntityFormationExclusivity(generated, options.entityType);
  // One row per document: several rules can match the same document on
  // different bases (e.g. an EIN for every business AND for employers; an
  // environmental permit for hazardous materials AND a metro flag). The
  // checklist shows the document once, with the strongest present basis and
  // every matched rule kept in triggerFacts for provenance.
  const merged = new Map<string, ClassifiedRequirement>();

  for (const row of exclusive) {
    // A decision negates only its own matched basis. The same document can
    // have several independent triggers, including non-geographic ones.
    const bases = row.matched_rules?.length ? row.matched_rules : [{ rule_id: row.source_rule_id, reason: row.reason }];
    const basisIds = bases.map(basis => basis.rule_id);
    const flags = basisIds.map(id => {
      const flag = flagForRule(options.kb, id);
      // Preserve the existing facade review's site-historic confirmation:
      // a capital-city flag alone never established a historic property.
      return row.document_id === "DOC_FACADE_PRESERVATION" && flag === "capital" ? "historic" : flag;
    });
    const kind = kindForDocument(row.document_id, row.document_name, row.category);
    const recommended = options.recommendedIds?.has(row.document_id) ?? false;

    let applicability: Applicability = recommended ? "recommended" : "required";
    const triggerFacts: string[] = [];

    const basisStates = flags.map((flag, index) => {
      triggerFacts.push(flag ? `municipality_flag:${flag}` : `rule:${basisIds[index]}`);
      if (!flag) return "required";
      const decision = decisionForFlag(options.potentialDecisions, flag);
      return decision === "not_applies" ? "not_applicable" : decision === "applies" ? "required" : "conditional";
    });
    if (basisStates.includes("required")) applicability = recommended ? "recommended" : "required";
    else if (basisStates.includes("conditional")) applicability = "conditional";
    else applicability = "not_applicable";

    if (row.document_id === CORP_FORMATION && options.entityType === "limited_liability_company") {
      continue;
    }
    const unknownEntity = !options.entityType || options.entityType === "other";
    if (unknownEntity && row.document_id === CORP_FORMATION) {
      applicability = "conditional";
      triggerFacts.push("entityType:unknown");
    }
    // F02: an EIN is required when the business will have employees, but when
    // the entity type is still unknown we must not claim it as a definite
    // requirement — the IRS single-owner exception may apply.
    if (unknownEntity && row.document_id === EIN_DOC && !truthyAnswer(options.answers?.["Q_EMPLOYEES_HIRED"])) {
      applicability = "conditional";
      triggerFacts.push("entityType:unknown");
    }

    const selectedState = basisStates.includes("required") ? "required"
      : basisStates.includes("conditional") ? "conditional" : "not_applicable";
    const independentIndex = flags.findIndex(flag => flag === null);
    const basis = bases[independentIndex >= 0 ? independentIndex : basisStates.indexOf(selectedState)];
    const mandatory = applicability === "required" && !recommended;
    const classified: ClassifiedRequirement = {
      document_id: row.document_id,
      document_name: row.document_name,
      agency: row.agency,
      category: row.category,
      reason: basis.reason,
      source_rule_id: basis.rule_id,
      code: options.legacyCode?.[row.document_id] || row.document_id.toLowerCase(),
      mandatory,
      applicability,
      kind,
      stage: stageForDocument(row.document_id, row.document_name, row.category),
      triggerFacts: triggerFacts.length ? triggerFacts : [`rule:${row.source_rule_id}`],
      acceptsOfficialUpload: kind !== "review_condition" && kind !== "informational_notice" && applicability === "required",
    };

    const prior = merged.get(row.document_id);
    if (!prior) {
      merged.set(row.document_id, classified);
      continue;
    }
    // Merge: strongest applicability wins (a confirmed independent basis
    // outweighs an undecided or declined flag), triggerFacts accumulate,
    // distinct reasons are joined so every basis stays visible.
    if (APPLICABILITY_RANK[classified.applicability] > APPLICABILITY_RANK[prior.applicability]) {
      prior.applicability = classified.applicability;
      prior.mandatory = classified.mandatory;
      prior.acceptsOfficialUpload = classified.acceptsOfficialUpload;
    }
    for (const fact of classified.triggerFacts) {
      if (!prior.triggerFacts.includes(fact)) prior.triggerFacts.push(fact);
    }
    if (!prior.reason.includes(classified.reason)) {
      prior.reason = `${prior.reason} · ${classified.reason}`;
    }
  }

  return [...merged.values()];
}

export function classifyPotentialItem(name: string, flag: string, decision: PotentialDecision | undefined): {
  applicability: Applicability;
  kind: RequirementKind;
  acceptsOfficialUpload: boolean;
  stage: RequirementStage;
} {
  const kind = isReviewName(name) ? "review_condition" : kindForDocument("", name, "Potentially Required");
  let applicability: Applicability = "conditional";
  if (decision === "applies") applicability = "required";
  if (decision === "not_applies") applicability = "not_applicable";
  return {
    applicability,
    kind,
    acceptsOfficialUpload: kind !== "review_condition" && applicability === "required",
    stage: "conditional_reviews",
  };
}
