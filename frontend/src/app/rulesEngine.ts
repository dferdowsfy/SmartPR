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
  rule_type: "business_type" | "question_trigger" | "municipality" | "municipality_flag";
  business_type_id: string | null;
  question_id: string | null;
  expected_answer: string | null;
  municipality_flag: Flag | null;
  requires_document_id: string;
  /**
   * Optional entity-type scoping: the rule never fires for these canonical
   * entity types (e.g. Certificate of Incorporation for sole proprietorships).
   * Data-driven — the engine interprets it, never hardcodes per-document law.
   */
  excluded_entity_types?: string[] | string | null;
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
export interface EngineInput {
  municipalityName?: string | null;
  businessTypeName?: string | null;
  answers: Record<string, boolean | string | undefined>;
  /** Canonical entity type (forms/engine EntityType); unknown -> null. Lets
   *  entity-scoped rules (excluded_entity_types) stay silent for legal forms
   *  they can never apply to, instead of emitting false mandatory duties. */
  entityType?: string | null;
  /** Date-only UTC (`YYYY-MM-DD`) the evaluation is "as of". Rules not in
   *  force at this date never fire. Defaults to today (UTC). */
  asOf?: string | Date | null;
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
}

export interface EngineDebug {
  municipalitySelected: string | null;
  municipalityFlags: Flag[];
  businessType: string | null;
  businessTypeId: string | null;
  questionsTriggered: { question_id: string; question: string; answer: boolean | string }[];
  rulesMatched: { rule_id: string; rule_type: string; document_id: string; reason: string }[];
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
  const matched = new Map<string, { rule: KBRule; reason: string }>();
  const rulesMatched: EngineDebug["rulesMatched"] = [];
  const triggered: EngineDebug["questionsTriggered"] = [];
  const triggeredSeen = new Set<string>();

  const add = (rule: KBRule, reason: string) => {
    rulesMatched.push({
      rule_id: rule.id,
      rule_type: rule.rule_type,
      document_id: rule.requires_document_id,
      reason,
    });
    if (!matched.has(rule.requires_document_id)) {
      matched.set(rule.requires_document_id, { rule, reason });
    }
  };

  // Temporal enforcement: only rules in force at input.asOf (default today UTC)
  // are evaluated. Undated rules are current law as modeled. Inverted
  // intervals and supersession cycles fail loud here, never silently.
  const effectiveRules = filterEffective(kb.rules, input.asOf);
  for (const rule of effectiveRules) {
    // Entity-scoped rules never fire for an excluded legal form (F01/F02:
    // e.g. incorporation for sole proprietorships, universal EIN for sole
    // props). An unknown entity type falls through; the classifier marks the
    // resulting items conditional rather than required.
    if (input.entityType && excludedEntityTypes(rule).includes(input.entityType)) {
      continue;
    }
    switch (rule.rule_type) {
      case "municipality":
        // Universal / municipality baseline — applies whenever a municipality
        // is selected (every PR business has one).
        if (municipality) add(rule, `Municipality selected (${municipality.name})`);
        break;

      case "municipality_flag":
        if (
          rule.municipality_flag &&
          flags.includes(rule.municipality_flag) &&
          (rule.business_type_id === null ||
            (businessType && rule.business_type_id === businessType.id))
        ) {
          const btPart = rule.business_type_id && businessType ? ` + Business Type = ${businessType.name}` : "";
          add(rule, `Municipality Flag = ${rule.municipality_flag}${btPart}`);
        }
        break;

      case "business_type":
        if (businessType && rule.business_type_id === businessType.id) {
          add(rule, `Business Type = ${businessType.name}`);
        }
        break;

      case "question_trigger":
        if (rule.question_id) {
          const ans = input.answers[rule.question_id];
          if (answerMatches(ans, rule.expected_answer)) {
            const q = qById.get(rule.question_id);
            // Report the answer that actually matched (select labels included),
            // not a blanket "Yes" — the matched basis is what review relies on.
            const answerText = typeof ans === "string" ? ans : "Yes";
            const reason = `Question: ${q ? q.question : rule.question_id} | Answer: ${answerText}`;
            add(rule, reason);
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
    }
  }

  const requirements: GeneratedRequirement[] = [...matched.entries()].map(([docId, { rule, reason }]) => {
    const d = docById.get(docId);
    return {
      document_id: docId,
      document_name: d ? d.name : docId,
      agency: d ? d.agency : "",
      category: d ? d.category : "",
      reason,
      source_rule_id: rule.id,
      matched_rules: rulesMatched.filter(match => match.document_id === docId).map(({ rule_id, reason }) => ({ rule_id, reason })),
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
      rulesMatched,
      documentsGenerated: requirements.map((r) => r.document_id),
    },
  };
}
