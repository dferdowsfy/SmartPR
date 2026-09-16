// ============================================================================
// SmartPR database-driven rules engine (pure, dependency-injected).
//
// All requirement generation comes from the SmartPR Knowledge Base tables
// (municipalities, business_types, questions, documents, rules). NO business
// rules are hardcoded here — this module only *interprets* the rule rows.
//
// The KB is passed in (not imported) so the same engine runs unchanged in the
// Next.js app and in standalone Node tests.
// ============================================================================

import { filterEffective } from "./temporal.ts";

export type Flag = "tourism" | "coastal" | "historic" | "metro" | "island";

// `patente_rate` is the municipal gross-receipts tax rate as a decimal (e.g.
// 0.005 = 0.5%). Optional: when null the platform reports the rate is not yet
// captured rather than guessing — the framework is in place for KB enrichment
// without forcing made-up data.
export interface KBMunicipality { id: string; name: string; flags: Flag[]; patente_rate?: number | null }
export interface KBBusinessType { id: string; industry_id: string; name: string; description: string }
export interface KBQuestion { id: string; question: string; type: string; options?: string[] }
export interface KBDocument {
  id: string; name: string; agency: string; category: string; requirement_guidance?: unknown;
  /** Temporal validity, same semantics as KBRule (see temporal.ts). */
  effective_from?: string | null;
  effective_to?: string | null;
  supersedes?: string[] | null;
}
export interface KBRule {
  id: string;
  rule_type: "business_type" | "question_trigger" | "municipality" | "municipality_flag" | "project_fact";
  business_type_id: string | null;
  question_id: string | null;
  /**
   * For project_fact rules: the project-context fact key (e.g. "project_type",
   * "structural_work"). Kept separate from question_id so the knowledge graph
   * does not create dangling applies_to edges to non-question nodes.
   */
  fact_key?: string | null;
  expected_answer: string | null;
  municipality_flag: Flag | null;
  requires_document_id: string;
  /**
   * Project-first gate (data-driven): when true, the rule never fires for an
   * existing business, for a property/project with no business, or when the
   * entity is known to be formed. When the intent was never determined the
   * rule still fires but is marked formation-unresolved: the classifier
   * renders it as conditional ("more information needed"), never as a
   * confirmed requirement. Unknown never fires silently.
   */
  requires_new_unformed_business?: boolean | null;
  /**
   * Project-first gate (data-driven): when true, the rule fires only when a
   * business is actually involved (businessStatus "new" or "existing", or
   * unknown — preserving current behavior when intent was never determined).
   * Skips for "project_only": a property/project with no business generates
   * zero business requirements (construction permits still fire via
   * project_fact rules).
   */
  requires_business?: boolean | null;
  /**
   * Optional entity-type scoping: the rule never fires for these canonical
   * entity types (e.g. Certificate of Incorporation for sole proprietorships).
   * Data-driven — the engine interprets it, never hardcodes per-document law.
   */
  excluded_entity_types?: string[] | string | null;
  /**
   * Compliance posture for this rule's document — what the applicant must do
   * about an obligation that may already exist:
   * - "new_application" (default): a new filing the applicant must complete.
   * - "verify_existing": the obligation may already be satisfied (e.g. the
   *   merchant registration of an already-operating business). The applicant
   *   verifies existing compliance instead of filing anew.
   * - "supporting_evidence": the document is evidence for another filing
   *   (e.g. a lease proving site control), not an independent requirement.
   */
  compliance_mode?: "new_application" | "verify_existing" | "supporting_evidence" | null;
  /**
   * Rule verification level. "heuristic" rules are planning-level
   * associations (e.g. business-type + metro flag) that have NOT been verified
   * against an authoritative regulatory source. They may inform
   * "needs evaluation" guidance but can never present as confirmed
   * requirements — unverified rules are never treated as authoritative.
   */
  verification?: "verified" | "heuristic" | null;
  /**
   * Fact keys that must be known before this requirement can be decided
   * (e.g. land_disturbance_acres for stormwater). Surfaced to the caller as
   * missing facts so the UI can ask for them instead of guessing.
   */
  missing_fact_keys?: string[] | null;
  /**
   * Project-fact keys that actively SUPPRESS this rule when explicitly
   * false/zero (negative facts). E.g. site_work=false suppresses the
   * stormwater heuristic: interior-only work with no land disturbance does
   * not trigger construction stormwater coverage.
   */
  negated_fact_keys?: string[] | null;
  /**
   * Human-readable statement of WHY this rule exists (the regulatory basis).
   * Every requirement the engine emits must be explainable through this.
   */
  trigger_summary?: string | null;
  /** ISO date (YYYY-MM-DD) this rule was last reviewed. Audit traceability. */
  reviewed_at?: string | null;
  /**
   * Append-only audit trail for rule changes: { date, change, reason }.
   * Previous rule text is preserved here, never silently rewritten.
   */
  change_log?: Array<{ date: string; change: string; reason: string }> | null;
  /**
   * Temporal validity (date-only UTC `YYYY-MM-DD`). A rule is in force at
   * `asOf` when effective_from <= asOf and (effective_to is null or
   * asOf < effective_to — exclusive end). Undated rules are current law as
   * modeled. `supersedes` names retired rule ids: an effective superseding
   * rule excludes them. See temporal.ts.
   */
  effective_from?: string | null;
  effective_to?: string | null;
  supersedes?: string[] | null;
}

export interface KnowledgeBase {
  municipalities: KBMunicipality[];
  businessTypes: KBBusinessType[];
  questions: KBQuestion[];
  documents: KBDocument[];
  rules: KBRule[];
  /**
   * Optional bundled-pack extensions beyond the core rules-engine tables.
   * `renewals` marks a document as a RECURRING obligation distinct from the
   * one-time filing that unlocks it (e.g. a monthly Room Tax return vs. the
   * one-time Tourism/Innkeeper registration) — read by
   * compliance/server.ts's renewal lookup, which also accepts the same shape
   * from an admin-published snapshot, so this stays a loose record rather
   * than a stricter type both call sites would have to agree on.
   */
  extensions?: {
    renewals?: Record<string, unknown>[];
  };
}

// Engine inputs. `answers` maps KB question id -> answer value (boolean or string).
export type BusinessStatus = "new" | "existing" | "project_only";

export interface EngineInput {
  municipalityName?: string | null;
  businessTypeName?: string | null;
  answers: Record<string, boolean | string | undefined>;
  /** Canonical entity type (forms/engine EntityType); unknown -> null. Lets
   *  entity-scoped rules (excluded_entity_types) stay silent for legal forms
   *  they can never apply to, instead of emitting false mandatory duties. */
  entityType?: string | null;
  /**
   * Project-first gating: "new" = forming a new business, "existing" = the
   * business already exists, "project_only" = a property/project with no
   * business involved. Null/omitted = unknown (intent was never determined —
   * behaves exactly as before this gate existed). Rules carrying
   * requires_new_unformed_business stay silent for "existing", for
   * "project_only", and when the entity is known formed; rules carrying
   * requires_business fire for everything except "project_only".
   */
  businessStatus?: BusinessStatus | null;
  /**
   * Whether the entity is not yet formed. Null/omitted = unknown, and
   * formation-gated rules then fire as unresolved (conditional), never as
   * confirmed — unknown never fires silently.
   */
  entityNotFormed?: boolean | null;
  /**
   * Project-context facts (projectContext.ts fact key -> raw value) for
   * project_fact rules. Lets construction/renovation permits trigger from
   * project facts without any business being formed.
   */
  projectFacts?: Record<string, unknown> | null;
  /** Date-only UTC (`YYYY-MM-DD`) the evaluation is "as of". Rules not in
   *  force at this date never fire. Defaults to today (UTC). */
  asOf?: string | Date | null;
  /**
   * Answer provenance, set by `buildEngineInput` in kb.ts: "user" when the
   * value traces to something the user provided (profile, discovery answer,
   * or a direct translation of one), "derived" when the relationship
   * resolver determined it. Requirement-card reasons may only use "Answer:"
   * for user-provided answers — derived ones are labeled as derived.
   */
  answerProvenance?: Record<string, "user" | "derived">;
  /**
   * Fact metadata for audit traceability: every fact the engine reads
   * carries its source, its scope namespace (business vs project vs
   * property), and the confidence of the extraction. Project-specific
   * reasoning reads only project/property-scoped facts; business rules read
   * only business-scoped facts — a stale or out-of-scope fact can never
   * trigger a rule it does not belong to.
   */
  factMeta?: Record<string, FactMeta>;
}

/** Audit metadata for a single fact the engine consumed. */
export interface FactMeta {
  source: "user_intake" | "passport" | "derived" | "admin";
  scope: "business" | "project" | "property";
  confidence?: number;
  timestamp?: string;
}

export interface GeneratedRequirement {
  document_id: string;
  document_name: string;
  agency: string;
  category: string;
  reason: string;
  source_rule_id: string;
  /** All matched bases survive document deduplication, in evaluation order. */
  matched_rules?: { rule_id: string; reason: string }[];
  /**
   * Set when a requires_new_unformed_business rule matched but the
   * new+unformed basis was never confirmed (intent unknown). The
   * requirement is unresolved/conditional — never presented as confirmed.
   */
  formation_unresolved?: boolean;
  /**
   * Rule metadata carried through for the classifier: compliance posture,
   * verification level, missing facts, and the human-readable trigger
   * summary. The classifier renders these; it never re-derives them.
   */
  compliance_mode?: KBRule["compliance_mode"];
  verification?: KBRule["verification"];
  missing_fact_keys?: string[] | null;
  trigger_summary?: string | null;
}

export interface EngineDebug {
  municipalitySelected: string | null;
  municipalityFlags: Flag[];
  businessType: string | null;
  businessTypeId: string | null;
  questionsTriggered: { question_id: string; question: string; answer: boolean | string }[];
  /** Project-context facts that fired project_fact rules. */
  projectFactsTriggered: { fact_key: string; value: unknown }[];
  rulesMatched: { rule_id: string; rule_type: string; document_id: string; reason: string }[];
  /**
   * Rules suppressed by explicitly negative facts (e.g. site_work=false
   * suppressing the stormwater heuristic). Suppression is recorded, never
   * silent — the graph shows WHY a requirement did not apply.
   */
  rulesSuppressed: { rule_id: string; document_id: string; suppressed_by: string }[];
  documentsGenerated: string[];
}

export interface EngineResult {
  requirements: GeneratedRequirement[];
  debug: EngineDebug;
}

const truthy = (v: boolean | string | undefined): boolean =>
  v === true || v === "true" || v === "yes" || v === "Yes";

/** Normalize a rule's excluded_entity_types to a list (accepts arrays from
 *  the KB JSON and comma-separated strings from admin authoring). */
function excludedEntityTypes(rule: KBRule): string[] {
  const v = rule.excluded_entity_types;
  if (!v) return [];
  if (Array.isArray(v)) return v.map(String).map((s) => s.trim()).filter(Boolean);
  return String(v).split(",").map((s) => s.trim()).filter(Boolean);
}

// Compare an answer against a rule's expected_answer. For boolean triggers the
// expected_answer is "true"; otherwise an exact (case-insensitive) match.
function answerMatches(answer: boolean | string | undefined, expected: string | null): boolean {
  if (expected === null || expected === "true") return truthy(answer);
  if (answer === undefined) return false;
  return String(answer).toLowerCase() === expected.toLowerCase();
}

// Compare a project-context fact against a rule's expected_answer. For
// boolean triggers the expected_answer is "true"; numeric comparisons use
// ">=N", "<=N", ">N", "<N" (e.g. land_disturbance_acres >= 1); otherwise a
// case-insensitive substring match, so a project_type of
// "renovation and expansion" matches expected_answer "renovation".
function projectFactMatches(fact: unknown, expected: string | null): boolean {
  if (fact === undefined || fact === null || fact === "") return false;
  if (expected === null || expected === "true") {
    return (
      fact === true ||
      fact === "true" ||
      fact === "yes" ||
      fact === "Yes" ||
      (typeof fact === "number" && fact > 0)
    );
  }
  const cmp = /^\s*(>=|<=|>|<)\s*(-?\d+(?:\.\d+)?)\s*$/.exec(expected);
  if (cmp) {
    const n = typeof fact === "number" ? fact : Number(String(fact).replace(/,/g, ""));
    if (!Number.isFinite(n)) return false;
    const target = Number(cmp[2]);
    switch (cmp[1]) {
      case ">=": return n >= target;
      case "<=": return n <= target;
      case ">": return n > target;
      case "<": return n < target;
    }
  }
  return String(fact).toLowerCase().includes(expected.toLowerCase());
}

/**
 * True when a project fact is explicitly negative: false, "no"/"false", or
 * numeric zero. Negative facts actively suppress rules (e.g. site_work=false
 * suppresses the stormwater heuristic) instead of merely not triggering them.
 */
function isNegativeFact(fact: unknown): boolean {
  if (fact === false || fact === "false" || fact === "no" || fact === "No") return true;
  if (typeof fact === "number") return fact === 0;
  if (typeof fact === "string") {
    const n = Number(fact.replace(/,/g, ""));
    if (fact.trim() !== "" && Number.isFinite(n)) return n === 0;
  }
  return false;
}

export function runRulesEngine(kb: KnowledgeBase, input: EngineInput): EngineResult {
  const docById = new Map(kb.documents.map((d) => [d.id, d]));
  const qById = new Map(kb.questions.map((q) => [q.id, q]));

  const municipality = input.municipalityName
    ? kb.municipalities.find(
        (m) => m.name.toLowerCase() === String(input.municipalityName).toLowerCase()
      ) ?? null
    : null;
  const flags: Flag[] = municipality ? municipality.flags : [];

  const businessType = input.businessTypeName
    ? kb.businessTypes.find(
        (b) => b.name.toLowerCase() === String(input.businessTypeName).toLowerCase()
      ) ?? null
    : null;

  // documentId -> first matching rule (keep the strongest/earliest reason).
  const matched = new Map<string, { rule: KBRule; reason: string; formationUnresolved: boolean }>();
  const rulesMatched: EngineDebug["rulesMatched"] = [];
  const rulesSuppressed: EngineDebug["rulesSuppressed"] = [];
  const triggered: EngineDebug["questionsTriggered"] = [];
  const triggeredSeen = new Set<string>();
  const projectFactsTriggered: EngineDebug["projectFactsTriggered"] = [];
  const projectFactSeen = new Set<string>();

  const add = (rule: KBRule, reason: string, formationUnresolved = false) => {
    rulesMatched.push({
      rule_id: rule.id,
      rule_type: rule.rule_type,
      document_id: rule.requires_document_id,
      reason,
    });
    const existing = matched.get(rule.requires_document_id);
    if (!existing) {
      matched.set(rule.requires_document_id, { rule, reason, formationUnresolved });
    } else if (existing.formationUnresolved && !formationUnresolved) {
      // A confirmed basis outweighs an unresolved formation basis: the
      // requirement is genuinely triggered (e.g. an EIN for hiring), so the
      // unresolved flag is cleared even though the earliest reason is kept.
      existing.formationUnresolved = false;
    }
  };

  // Temporal enforcement: only rules in force at input.asOf (default today UTC)
  // are evaluated. Undated rules are current law as modeled. Inverted
  // intervals and supersession cycles fail loud here, never silently.
  const effectiveRules = filterEffective(kb.rules, input.asOf);
  for (const rule of effectiveRules) {
    // Negative-fact suppression: an explicitly negative fact (false / 0 /
    // "no") listed in the rule's negated_fact_keys suppresses the rule and
    // is recorded in debug — the graph shows WHY a requirement did not
    // apply. Unknown (undefined) never suppresses: absence of evidence is
    // not evidence of absence.
    if (rule.negated_fact_keys?.length) {
      const suppressing = rule.negated_fact_keys.find((key) => {
        const pf = input.projectFacts?.[key];
        if (pf !== undefined && isNegativeFact(pf)) return true;
        const ans = input.answers[key];
        return ans !== undefined && isNegativeFact(ans);
      });
      if (suppressing) {
        rulesSuppressed.push({
          rule_id: rule.id,
          document_id: rule.requires_document_id,
          suppressed_by: suppressing,
        });
        continue;
      }
    }
    // Reset per rule: set by the formation gate below when the rule carries it.
    let formationGateUnresolved = false;
    // Entity-scoped rules never fire for an excluded legal form (F01/F02:
    // e.g. incorporation for sole proprietorships, universal EIN for sole
    // props). An unknown entity type falls through; the classifier marks the
    // resulting items conditional rather than required.
    if (input.entityType && excludedEntityTypes(rule).includes(input.entityType)) {
      continue;
    }
    // Project-first gates (data-driven; the KB decides which rules carry them):
    // - requires_new_unformed_business: "form the entity" requirements fire
    //   confirmed only for a new business whose entity is not yet formed.
    //   They never fire for an existing business, for a property/project
    //   with no business, or when the entity is known to be formed. When the
    //   intent was never determined they still fire but are flagged
    //   formation-unresolved: the classifier renders them conditional, never
    //   confirmed. Unknown never fires silently.
    // - requires_business: business requirements (municipality baselines,
    //   EIN, etc.) fire for new/existing businesses and when the intent is
    //   unknown (current behavior), but never for project_only.
    if (rule.requires_new_unformed_business) {
      const excluded =
        input.businessStatus === "existing" ||
        input.businessStatus === "project_only" ||
        input.entityNotFormed === false;
      if (excluded) {
        continue;
      }
      formationGateUnresolved = !(
        input.businessStatus === "new" && input.entityNotFormed === true
      );
    }
    if (
      rule.requires_business &&
      input.businessStatus === "project_only"
    ) {
      continue;
    }
    switch (rule.rule_type) {
      case "municipality":
        // Universal / municipality baseline — applies whenever a municipality
        // is selected (every PR business has one).
        if (municipality) add(rule, `Municipality selected (${municipality.name})`, formationGateUnresolved);
        break;

      case "municipality_flag":
        if (
          rule.municipality_flag &&
          flags.includes(rule.municipality_flag) &&
          (rule.business_type_id === null ||
            (businessType && rule.business_type_id === businessType.id))
        ) {
          const btPart = rule.business_type_id && businessType ? ` + Business Type = ${businessType.name}` : "";
          add(rule, `Municipality Flag = ${rule.municipality_flag}${btPart}`, formationGateUnresolved);
        }
        break;

      case "business_type":
        if (businessType && rule.business_type_id === businessType.id) {
          add(rule, `Business Type = ${businessType.name}`, formationGateUnresolved);
        }
        break;

      case "question_trigger":
        if (rule.question_id) {
          const ans = input.answers[rule.question_id];
          if (answerMatches(ans, rule.expected_answer)) {
            const q = qById.get(rule.question_id);
            // Report the answer that actually matched (select labels included),
            // not a blanket "Yes" — the matched basis is what review relies on.
            // Honesty invariant: "Answer:" is reserved for answers the user
            // actually provided. Values the relationship resolver derived are
            // labeled as derived so the card never presents them as the
            // user's own answer.
            const answerText = typeof ans === "string" ? ans : "Yes";
            const userProvided = input.answerProvenance?.[rule.question_id] !== "derived";
            const reason = userProvided
              ? `Question: ${q ? q.question : rule.question_id} | Answer: ${answerText}`
              : `Question: ${q ? q.question : rule.question_id} | Derived answer: ${answerText}`;
            add(rule, reason, formationGateUnresolved);
            if (!triggeredSeen.has(rule.question_id)) {
              triggeredSeen.add(rule.question_id);
              triggered.push({
                question_id: rule.question_id,
                question: q ? q.question : rule.question_id,
                answer: ans as boolean | string,
              });
            }
          }
        }
        break;

      case "project_fact": {
        // Project-context facts trigger construction/renovation permits
        // without any business being formed. `fact_key` names the fact
        // key (e.g. "project_type", "structural_work").
        if (rule.fact_key) {
          const fact = input.projectFacts?.[rule.fact_key];
          if (projectFactMatches(fact, rule.expected_answer)) {
            add(rule, `Project fact: ${rule.fact_key} = ${String(fact)}`, formationGateUnresolved);
            if (!projectFactSeen.has(rule.fact_key)) {
              projectFactSeen.add(rule.fact_key);
              projectFactsTriggered.push({ fact_key: rule.fact_key, value: fact });
            }
          }
        }
        break;
      }
    }
  }

  const requirements: GeneratedRequirement[] = [...matched.entries()].map(([docId, { rule, reason, formationUnresolved }]) => {
    const d = docById.get(docId);
    return {
      document_id: docId,
      document_name: d ? d.name : docId,
      agency: d ? d.agency : "",
      category: d ? d.category : "",
      reason,
      source_rule_id: rule.id,
      matched_rules: rulesMatched.filter(match => match.document_id === docId).map(({ rule_id, reason }) => ({ rule_id, reason })),
      ...(formationUnresolved ? { formation_unresolved: true } : {}),
      ...(rule.compliance_mode ? { compliance_mode: rule.compliance_mode } : {}),
      ...(rule.verification ? { verification: rule.verification } : {}),
      ...(rule.missing_fact_keys?.length ? { missing_fact_keys: rule.missing_fact_keys } : {}),
      ...(rule.trigger_summary ? { trigger_summary: rule.trigger_summary } : {}),
    };
  });

  return {
    requirements,
    debug: {
      municipalitySelected: municipality ? municipality.name : null,
      municipalityFlags: flags,
      businessType: businessType ? businessType.name : null,
      businessTypeId: businessType ? businessType.id : null,
      questionsTriggered: triggered,
      projectFactsTriggered,
      rulesMatched,
      rulesSuppressed,
      documentsGenerated: requirements.map((r) => r.document_id),
    },
  };
}
