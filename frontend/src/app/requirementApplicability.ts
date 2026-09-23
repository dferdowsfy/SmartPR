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
import { QUESTION_KEY_MAP } from "./ai/intake/questionKeyMap";

export type Applicability =
  | "required"
  | "likely_required"
  | "verify_existing"
  | "conditional"
  | "needs_more_information"
  | "supporting_evidence"
  | "recommended"
  | "not_applicable"
  | "blocked"
  | "completed";

/**
 * Regulatory applicability is conditional far more often than binary. These
 * statuses replace the old required/not-required bluntness:
 * - required: a verified rule's trigger is satisfied by known facts.
 * - likely_required: the trigger is satisfied but the rule itself is a
 *   heuristic (unverified against an authoritative source) — evaluate, don't
 *   assume.
 * - verify_existing: the obligation may already be satisfied (e.g. merchant
 *   registration for an operating business) — verify, don't re-file.
 * - conditional: depends on a fact that is not yet known but will resolve
 *   (e.g. entity type, a flag confirmation).
 * - needs_more_information: specific missing facts block the decision — the
 *   UI should ask for them, not guess.
 * - supporting_evidence: a document proving something for another filing,
 *   not an independent requirement.
 * - not_applicable / blocked / completed: as before.
 */
export function bucketForApplicability(a: Applicability): "required" | "attention" | "info" | "not_applicable" {
  switch (a) {
    case "required":
    case "likely_required":
      return "required";
    case "verify_existing":
    case "conditional":
    case "needs_more_information":
    case "blocked":
      return "attention";
    case "supporting_evidence":
    case "completed":
      return "info";
    case "recommended":
      return "info";
    case "not_applicable":
      return "not_applicable";
  }
}

/** Localized-badge copy is the caller's job; this is the canonical EN label. */
export function labelForApplicability(a: Applicability): string {
  switch (a) {
    case "required": return "Required";
    case "likely_required": return "Likely required";
    case "verify_existing": return "Verify existing";
    case "conditional": return "Needs verification";
    case "needs_more_information": return "More information needed";
    case "supporting_evidence": return "Supporting evidence";
    case "recommended": return "Recommended";
    case "not_applicable": return "Not applicable";
    case "blocked": return "Blocked";
    case "completed": return "Completed";
  }
}

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
  /**
   * Fact keys that must be known before this requirement can be decided.
   * The UI asks for these instead of guessing — a requirement is never
   * emitted whose only explanation is "Municipality selected."
   */
  missingFacts: string[];
  /**
   * 0–1 confidence in this classification: 0.9 verified rule + user-given
   * facts, 0.7 verified rule + derived facts, 0.5 heuristic rule (unverified
   * against an authoritative source), 0.4 unresolved basis. Never shown as
   * false precision — bands, not decimals, in UI copy.
   */
  confidence: number;
  /** Human-readable regulatory basis carried from the rule, when present. */
  triggerSummary?: string;
  /**
   * Resolved "where to file" metadata carried from the engine (rule-level
   * agency override wins — REG-PROFESSION-AGENCY-001). The UI prefers these
   * over the shared document's defaults.
   */
  agency_url?: string | null;
  agency_note?: string | null;
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
// RULE_0651 (validated review 2026-09-16) fires DOC_CERT_ORGANIZATION, the
// LLC certificate of organization — it belongs to the same unknown-entity
// downgrade family as DOC_ARTICLES_ORGANIZATION. A formation certificate is
// only required when the entity's legal form is known; an unknown ("other")
// form can never confirm a specific certificate as required.
const LLC_FORMATION_DOCS = new Set<string>([LLC_FORMATION, "DOC_CERT_ORGANIZATION"]);

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
    // The engine can emit the LLC certificate under either of its two
    // document ids (RULE_0651 fires DOC_CERT_ORGANIZATION; the augment path
    // uses DOC_ARTICLES_ORGANIZATION) — a corporation must never keep either
    // (live QA 2026-09-21 00:00: a stock corporation rendered both the
    // incorporation and the LLC certificate because the single-id filter
    // missed the engine's id).
    return requirements.filter((item) => !LLC_FORMATION_DOCS.has(item.document_id ?? ""));
  }
  if (NON_INCORPORATING_TYPES.has(type)) {
    // F01: these legal forms never incorporate in Puerto Rico — drop both
    // formation certificates rather than presenting incorporation as a
    // mandatory duty.
    return requirements.filter(
      (item) => item.document_id !== CORP_FORMATION && !LLC_FORMATION_DOCS.has(item.document_id ?? "")
    );
  }
  return requirements;
}

export function shouldAddLlcOrganization(
  existing: Array<{ document_id?: string }>,
  entityType: EntityType | string | null | undefined
): boolean {
  if (entityType !== "limited_liability_company") return false;
  return !existing.some((item) => LLC_FORMATION_DOCS.has(item.document_id ?? ""));
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
  /** Pre-buildEngineInput intake answers, keyed by KB question id — the only
   *  honest "was this question answered" signal. options.answers always
   *  carries a concrete boolean for legacy-mapped questions (false when
   *  unanswered), so it cannot distinguish an explicit No from a default.
   *  Used by REG-MFK-ANSWERED-001 to resolve missing-fact keys. */
  rawAnswers?: Record<string, unknown>;
  /** Relationship-resolved facts (buildEngineInput's `resolved`), keyed by KB
   *  question id — deterministically derived answers the engine treats as
   *  established. Also used by REG-MFK-ANSWERED-001. */
  resolvedAnswers?: Record<string, boolean | string>;
  potentialDecisions?: Record<string, PotentialDecision>;
  legacyCode?: Record<string, string>;
  recommendedIds?: Set<string>;
  /**
   * Project-first intent: drives verify_existing mapping for compliance-mode
   * rules. An existing/operating business verifies existing compliance
   * instead of filing anew; a new business files for the first time.
   */
  businessStatus?: "new" | "existing" | "project_only" | null;
}

const APPLICABILITY_RANK: Record<Applicability, number> = {
  required: 5,
  likely_required: 4,
  verify_existing: 3,
  conditional: 3,
  needs_more_information: 3,
  supporting_evidence: 2,
  recommended: 1,
  blocked: 3,
  not_applicable: 0,
  completed: 5,
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
    // Per-basis rule metadata: a document can aggregate several independent
    // bases (e.g. a verified hazard trigger + a heuristic coastal-flag
    // association). Each basis is judged on its own verification — a
    // verified basis is authoritative even when another basis is heuristic.
    // Rules without an explicit verification marker are legacy verified
    // rules, never heuristic.
    const basisRules = basisIds.map((id) => options.kb.rules.find((r) => r.id === id));
    const basisHeuristic = basisRules.map((r) => r?.verification === "heuristic");
    const anyHeuristic = basisHeuristic.some(Boolean);
    // REG-MFK-ANSWERED-001 (2026-09-22 QA, corrected after G07 drift): a
    // missing-fact key is established only when its question was actually
    // answered — the raw intake answers or relationship-resolved facts. The
    // answers the engine saw (options.answers) ALWAYS carry a concrete
    // boolean for legacy-mapped questions (false when unanswered), so
    // presence there proves nothing: v1 treated G07's default-false
    // Q_ALCOHOL_SOLD as answered and flipped a validated
    // needs_more_information to likely_required. Only the writeKey direction
    // is sound: answering Q_ALCOHOL_SERVED does not establish alcohol_sold
    // (kb.ts maps Q_ALCOHOL_SOLD: on("alcohol_sold") but Q_ALCOHOL_SERVED:
    // on("alcohol_served", "alcohol_sold")), but answering Q_ALCOHOL_SOLD
    // does. An explicit No counts — the fact is known, not missing.
    // Without this, a card displays "missing" facts the user already
    // provided (e.g. the alcohol chain naming alcohol_sold after
    // Q_ALCOHOL_SOLD=true, S121 Dorado restaurant).
    const explicitAnswers: Record<string, unknown> = {
      ...(options.rawAnswers ?? {}),
      ...(options.resolvedAnswers ?? {}),
    };
    const knownFactKeys = new Set<string>();
    for (const [qid, binding] of Object.entries(QUESTION_KEY_MAP)) {
      if ((explicitAnswers[qid] ?? undefined) !== undefined) {
        knownFactKeys.add(binding.writeKey);
      }
    }
    const stillMissing = (keys: readonly string[] | undefined | null) =>
      (keys ?? []).filter((k) => !knownFactKeys.has(k));
    const missingFacts = [
      ...new Set(
        basisRules.flatMap((r, i) =>
          basisHeuristic[i] && r?.missing_fact_keys?.length ? stillMissing(r.missing_fact_keys) : []
        )
      ),
    ];
    if (row.missing_fact_keys?.length) {
      for (const k of stillMissing(row.missing_fact_keys)) if (!missingFacts.includes(k)) missingFacts.push(k);
    }

    let applicability: Applicability = recommended ? "recommended" : "required";
    const triggerFacts: string[] = [];
    // Provenance: every requirement names the exact fact that triggered it
    // and the full triggering identity — where the fact was established
    // (source), what it describes (scope), and the session/business it
    // belongs to. A requirement can only use a fact with admissible
    // provenance; this is the receipt.
    for (const prov of row.triggerFactProvenance ?? []) {
      const src =
        prov.source === "passport"
          ? "business passport"
          : prov.source === "derived"
            ? "derived from your answers"
            : prov.source === "admin"
              ? "SmartPR data"
              : "current intake";
      const identity = [
        `source: ${src}`,
        `scope: ${prov.scope}`,
        ...(prov.sessionId ? [`session: ${prov.sessionId}`] : []),
        ...(prov.businessId ? [`business: ${prov.businessId}`] : []),
      ].join(", ");
      triggerFacts.push(`fact:${prov.key}=${String(prov.value)} [${identity}]`);
    }

    // Each basis is judged on its own verification: a verified required
    // basis stays required even when a sibling basis is heuristic. A
    // heuristic basis can only ever reach likely_required — unverified
    // rules are never treated as authoritative, no matter the rule order.
    const basisStates: Array<"required" | "likely_required" | "conditional" | "not_applicable"> = flags.map((flag, index) => {
      triggerFacts.push(flag ? `municipality_flag:${flag}` : `rule:${basisIds[index]}`);
      const confirmed = !basisHeuristic[index];
      // A rule marked is_conditional (e.g. a qualification/status program
      // rather than a blanket operating permit) is always conditional —
      // it applies only if the applicant seeks the status.
      if (basisRules[index]?.is_conditional) return "conditional";
      if (!flag) return confirmed ? "required" : "likely_required";
      const decision = decisionForFlag(options.potentialDecisions, flag);
      if (decision === "not_applies") return "not_applicable";
      if (decision === "applies") return confirmed ? "required" : "likely_required";
      return "conditional";
    });
    if (anyHeuristic) triggerFacts.push("heuristic:requires_regulatory_review");
    // Ground-truth principle (2026-09-16 validated review): a heuristic basis
    // that names the facts blocking the decision becomes "needs more
    // information" so the UI asks for them instead of guessing — for every
    // rule type, not just municipality-flag rules. A verified required basis
    // still wins over every heuristic basis. REG-MFK-ANSWERED-001: a basis
    // whose named facts are all already answered is not blocked — it must
    // not force needs_more_information over an answered question.
    const basisNeedsInfo = basisRules.map(
      (r, i) => basisHeuristic[i] && stillMissing(r?.missing_fact_keys).length > 0
    );
    if (basisStates.includes("required")) applicability = recommended ? "recommended" : "required";
    else if (basisNeedsInfo.some(Boolean)) applicability = "needs_more_information";
    else if (basisStates.includes("likely_required")) applicability = recommended ? "recommended" : "likely_required";
    else if (basisStates.includes("conditional")) {
      // An undecided heuristic basis that names its missing facts becomes
      // "needs more information" so the UI asks for them instead of
      // guessing; other undecided bases stay conditional.
      applicability = anyHeuristic && missingFacts.length ? "needs_more_information" : "conditional";
    }
    else applicability = "not_applicable";

    // Compliance posture follows the winning basis: the basis that
    // determined the outcome decides whether this is a new filing, a
    // verify-existing obligation, or supporting evidence. Existing
    // businesses verify; new businesses file; unknown status keeps the
    // obligation required (it is certain) while the reason text covers
    // both postures.
    //
    // Posture mapping applies only to an ASSERTED basis (required /
    // likely_required). When the winning basis is merely conditional — an
    // unconfirmed municipality flag — the engine has not established that
    // the obligation applies, so mapping it to verify_existing (existing)
    // or required (new) would assert applicability the engine deliberately
    // left undecided. Conditional stays conditional until the flag is
    // confirmed; needs_more_information likewise stays undecided.
    const winIdx = (() => {
      for (const s of ["required", "likely_required", "conditional"] as const) {
        const i = basisStates.indexOf(s);
        if (i >= 0) return i;
      }
      return 0;
    })();
    const winAsserted =
      basisStates[winIdx] === "required" || basisStates[winIdx] === "likely_required";
    const winCompliance = basisRules[winIdx]?.compliance_mode ?? row.compliance_mode ?? null;
    if (winCompliance === "verify_existing" && winAsserted && applicability !== "not_applicable") {
      if (options.businessStatus === "existing") applicability = "verify_existing";
      else if (options.businessStatus === "new") applicability = recommended ? "recommended" : "required";
    } else if (winCompliance === "supporting_evidence" && applicability !== "not_applicable") {
      applicability = "supporting_evidence";
    }

    // Project-first honesty: a formation requirement whose new+unformed basis
    // was never confirmed (intent unknown) is unresolved — conditional, never
    // presented as a confirmed requirement. Unknown never fires silently.
    if (row.formation_unresolved) {
      applicability = "conditional";
      triggerFacts.push("formationGate:unresolved");
    }

    if (row.document_id === CORP_FORMATION && options.entityType === "limited_liability_company") {
      continue;
    }
    const unknownEntity = !options.entityType || options.entityType === "other";
    // Unknown legal form: neither the corporation nor the LLC formation
    // certificate can be asserted as required. The F01 exclusion logic
    // already drops both for non-incorporating forms; for unknown forms both
    // stay conditional until the user confirms the legal form.
    if (unknownEntity && (row.document_id === CORP_FORMATION || LLC_FORMATION_DOCS.has(row.document_id))) {
      applicability = "conditional";
      triggerFacts.push("entityType:unknown");
    }
    // F02 + founder judgment 2026-09-16 (§29.1): an EIN is required when the
    // business will have employees, but a sole proprietor with no employees
    // and no other EIN trigger may operate on the owner's SSN for federal
    // purposes — the EIN is optional/conditional, never blocking. The only
    // modeled EIN triggers are the new-business baseline (RULE_0002) and
    // hiring employees (RULE_0620); an employee basis keeps it required.
    // Unknown entity stays conditional per F02 (the IRS single-owner
    // exception may apply).
    const einEmployeeBasis = basisIds.includes("RULE_0620");
    if (
      row.document_id === EIN_DOC &&
      !truthyAnswer(options.answers?.["Q_EMPLOYEES_HIRED"]) &&
      !einEmployeeBasis &&
      (unknownEntity || options.entityType === "sole_proprietorship")
    ) {
      applicability = "conditional";
      triggerFacts.push(
        unknownEntity ? "entityType:unknown" : "entityType:sole_proprietorship+no_employees"
      );
    }
    // Validated review 2026-09-16 (G09): a single-member LLC with no
    // employees can in some cases use the owner's SSN rather than a separate
    // EIN — the EIN is needs_more_information, not required.
    if (
      row.document_id === EIN_DOC &&
      !truthyAnswer(options.answers?.["Q_EMPLOYEES_HIRED"]) &&
      !einEmployeeBasis &&
      options.entityType === "limited_liability_company"
    ) {
      applicability = "needs_more_information";
      triggerFacts.push("entityType:llc+no_employees");
    }

    const selectedState = basisStates.includes("required") ? "required"
      : basisStates.includes("likely_required") ? "likely_required"
      : basisStates.includes("conditional") ? "conditional" : "not_applicable";
    // Provenance (REG-PROVENANCE-WINNER-001, QA 2026-09-21 21:00): the card's
    // reason/source_rule must come from a basis that actually produced the
    // winning applicability. A heuristic sibling with no geographic flag used
    // to win this slot by array order alone, so a card could show required
    // (from a verified basis) while citing the heuristic rule's legal basis
    // (e.g. professional-license cards sourcing RULE_0029 instead of the
    // winning verified RULE_0103). Prefer the first independent basis whose
    // state matches the winning state; fall back to the first winning-state
    // basis so municipality-flag wins are preserved.
    // Specificity tiebreak (REG-PROVENANCE-SPECIFICITY-001, QA 2026-09-22):
    // among independent bases that produced the winning state, a
    // business-type rule outranks a generic question-triggered fallback.
    // An insurance agency answering Q_PROFESSIONAL_LICENSES=yes fired both
    // RULE_0029 (generic question_trigger, "Juntas Examinadoras") and
    // RULE_0224 (business_type, OCS / Código de Seguros Art. 9.160(1)), and
    // array order let the generic rule win the card's legal basis — pointing
    // the user at the Dept of State examining boards instead of the OCS
    // (REG-CITATION-INSURANCE-001's citation never surfaced). Applicability
    // is untouched: this only selects which winning basis supplies
    // reason/source_rule. All other orderings keep the existing array-order
    // behavior.
    const isBusinessTypeBasis = (i: number) =>
      basisRules[i]?.rule_type === "business_type";
    const winningIndependent = basisStates
      .map((state, i) => i)
      .filter((i) => flags[i] === null && basisStates[i] === selectedState);
    const specificFirst = winningIndependent.find(isBusinessTypeBasis);
    const basis =
      bases[
        specificFirst !== undefined
          ? specificFirst
          : winningIndependent.length
            ? winningIndependent[0]
            : basisStates.indexOf(selectedState)
      ];
    const mandatory = applicability === "required" && !recommended;
    // Confidence bands (never false precision — UI renders bands, not decimals):
    // 0.9 verified winning basis + user-given facts; 0.7 verified + derived
    // facts; 0.5 heuristic winning basis; 0.4 unresolved basis. Lowest
    // applicable wins.
    let confidence = 0.9;
    if (basisHeuristic[winIdx]) confidence = Math.min(confidence, 0.5);
    if (row.formation_unresolved) confidence = Math.min(confidence, 0.4);
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
      missingFacts,
      confidence,
      ...(row.trigger_summary ? { triggerSummary: row.trigger_summary } : {}),
      ...(row.agency_url ? { agency_url: row.agency_url } : {}),
      ...(row.agency_note ? { agency_note: row.agency_note } : {}),
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
