// ============================================================================
// SmartPR intake relationship resolver.
//
// WHAT THIS IS
// Intake is a connected fact model, not a bag of independent questions. The AI
// extracts EXPLICIT facts from the user's sentence; this module derives the
// facts that are then LOGICALLY CERTAIN, so SmartPR never asks a question it
// can already answer.
//
//     user statement -> AI extracts explicit facts
//                    -> THIS MODULE resolves deterministic relationships
//                    -> only unresolved questions are asked
//                    -> the EXISTING rules engine determines requirements
//
// WHAT THIS IS NOT
// This module contains NO permitting logic. `Q_EMPLOYEES_HIRED = true` is where
// it stops; rules.json is what turns that into a Workers' Compensation
// requirement. Keep that separation intact.
//
// The relationships themselves live in ./relationshipRegistry.ts as data. This
// file is the generic machine that evaluates them: condition operators, value
// derivations (numeric -> select bucket, value maps, KB lookups), precedence,
// recursion to a fixpoint, provenance, and contradiction detection.
// ============================================================================

import type { KnowledgeBase } from "../../rulesEngine.ts";
import { INDUSTRY_NAME_ALIASES } from "./relationshipRegistry.ts";
import {
  compileGraphContradictions,
  compileGraphRelationships,
} from "./graphRelationships.ts";
import { questionIdForAnswerKey } from "./questionKeyMap.ts";

// --- Fact addressing --------------------------------------------------------

/** Where a fact lives. `business_type` is a source-only pseudo-fact. */
export type FactSourceRef =
  | { type: "profile"; key: string }
  | { type: "question"; key: string }
  | { type: "business_type"; key: string };

/** Relationships may only WRITE to the profile or to a KB question. */
export type FactTargetRef =
  | { type: "profile"; key: string }
  | { type: "question"; key: string };

export type FactRef = FactSourceRef | FactTargetRef;

/** Stable string address for a fact, e.g. "question:Q_EMPLOYEES_HIRED". */
export function factKey(ref: FactRef): string {
  return `${ref.type}:${ref.key}`;
}

// --- Relationship shape -----------------------------------------------------

export type ConditionOperator =
  | "equals"
  | "not_equals"
  | "greater_than"
  | "greater_than_or_equal"
  | "less_than"
  | "in"
  | "not_in"
  | "truthy"
  | "falsy"
  | "is_number"
  | "non_empty";

/**
 * The semantic label for an effect. Purely descriptive — the resolver behaves
 * the same for every kind; the label is what makes the registry readable and
 * what explainability surfaces report.
 */
export type RelationshipKind =
  | "IMPLIES"
  | "IMPLIES_FALSE"
  | "REQUIRES_VALUE"
  | "MUTUALLY_EXCLUSIVE"
  | "PARENT_CHILD"
  | "DERIVED_VALUE"
  | "CONTRADICTS";

/**
 * How sure we are that the source makes the target true.
 *
 * `deterministic` — logically certain given SmartPR's data model. Applied, and
 *   the question is never asked again.
 * `strong_inference` — likely but not guaranteed. Recorded for explainability
 *   and conflict detection, but NOT applied by default (see
 *   `applyStrongInference`), because an uncertain guess must never become a
 *   confirmed answer that silently changes requirements.
 */
export type Certainty = "deterministic" | "strong_inference";

/** How a target value is produced from the source value. */
export type EffectDerivation =
  /** Numeric source -> the matching bucket of the target question's options. */
  | { kind: "count_bucket" }
  /** String source -> a mapped target value (e.g. business_structure -> Q_BUSINESS_STRUCTURE). */
  | { kind: "value_map"; map: Record<string, string> }
  /** KB business-type id -> the industry name that type belongs to. */
  | { kind: "kb_industry" };

export interface RelationshipEffect {
  target: FactTargetRef;
  /** Literal value to write. Ignored when `derive` is present. */
  value?: unknown;
  /** Compute the value from the source instead of using a literal. */
  derive?: EffectDerivation;
  certainty: Certainty;
  relationship: RelationshipKind;
}

export interface IntakeRelationship {
  id: string;
  source: FactSourceRef;
  condition: { operator: ConditionOperator; value?: unknown };
  effects: RelationshipEffect[];
  /** Why this relationship is valid — read by humans, not by code. */
  note?: string;
}

/**
 * An impossible combination of facts. Unlike a relationship, a contradiction
 * derives nothing; it reports that the intake is in a state that cannot be true.
 */
export interface FactContradiction {
  id: string;
  when: Array<{ ref: FactRef; operator: ConditionOperator; value?: unknown }>;
  message: string;
}

// --- Provenance -------------------------------------------------------------

/**
 * Where a value came from, strongest first. A lower-priority source must NEVER
 * overwrite a higher-priority one.
 *
 *   explicit — the user said it in their own words (or typed it into the field)
 *   user     — an existing confirmed value already on the profile/answers
 *   derived  — deterministic derivation by this resolver
 *   inferred — strong (but not certain) inference
 */
export type FactOrigin = "explicit" | "user" | "derived" | "inferred";

export const ORIGIN_PRIORITY: Record<FactOrigin, number> = {
  explicit: 4,
  user: 3,
  derived: 2,
  inferred: 1,
};

/** Origins that represent something a human actually told us. */
const USER_ORIGINS = new Set<FactOrigin>(["explicit", "user"]);

export interface ResolvedFact {
  /** "question:Q_EMPLOYEES_HIRED" */
  key: string;
  ref: FactTargetRef;
  value: unknown;
  origin: FactOrigin;
  confidence: number;
  /** Fact key this was derived from (absent for seeds). */
  derivedFrom?: string;
  relationshipId?: string;
  certainty?: Certainty;
}

export interface FactConflict {
  id: string;
  message: string;
  /** True when two things the USER told us disagree — only they can settle it. */
  requiresUser: boolean;
  facts: Array<{ key: string; value: unknown; origin: FactOrigin; relationshipId?: string }>;
  resolution: "kept_higher_priority" | "needs_user";
}

export interface TraceEntry {
  relationshipId: string;
  from: string;
  to: string;
  value: unknown;
  certainty: Certainty;
  relationship: RelationshipKind;
  applied: boolean;
  reason?: string;
}

// --- Resolver inputs / outputs ---------------------------------------------

export interface SeedFact {
  ref: FactSourceRef;
  value: unknown;
  origin: FactOrigin;
  confidence?: number;
}

export interface ResolveOptions {
  kb: KnowledgeBase;
  /** Override the registry (tests supply focused sets). */
  relationships?: IntakeRelationship[];
  contradictions?: FactContradiction[];
  /** Industry names the app offers; a derived industry must be one of these. */
  allowedIndustries?: string[];
  /**
   * Apply `strong_inference` effects as real answers. OFF by default: an
   * uncertain inference must not silently become a confirmed fact.
   */
  applyStrongInference?: boolean;
  /** Loop guard. Deterministic registries settle in 3-4 passes. */
  maxIterations?: number;
}

export interface ResolutionResult {
  /** Every APPLIED fact, addressed by `factKey()`. */
  facts: Record<string, ResolvedFact>;
  /** Strong inferences that were computed but deliberately not applied. */
  inferred: ResolvedFact[];
  conflicts: FactConflict[];
  /** Applied KB question answers, ready for `buildEngineInput`'s third argument. */
  questionValues: Record<string, boolean | string>;
  /** Applied profile values (derived ones only appear when nothing stronger existed). */
  profileValues: Record<string, unknown>;
  /** Question ids that are known and must therefore not be asked again. */
  resolvedQuestionIds: Set<string>;
  trace: TraceEntry[];
  iterations: number;
}

// --- Condition evaluation ---------------------------------------------------

const isNum = (v: unknown): v is number =>
  typeof v === "number" ? Number.isFinite(v) : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v));

const asNum = (v: unknown): number => (typeof v === "number" ? v : Number(v));

/** Loose equality that treats "true"/"yes" the way the rules engine does. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === "boolean" || typeof b === "boolean") return toBool(a) === toBool(b) && toBool(a) !== undefined;
  if (isNum(a) && isNum(b)) return asNum(a) === asNum(b);
  return String(a).toLowerCase() === String(b).toLowerCase();
}

function toBool(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true" || s === "yes" || s === "si" || s === "sí") return true;
    if (s === "false" || s === "no") return false;
  }
  return undefined;
}

export function evaluateCondition(
  value: unknown,
  condition: { operator: ConditionOperator; value?: unknown }
): boolean {
  const { operator, value: expected } = condition;
  if (value === undefined || value === null) return false;

  switch (operator) {
    case "equals":
      return sameValue(value, expected);
    case "not_equals":
      return !sameValue(value, expected);
    case "greater_than":
      return isNum(value) && isNum(expected) && asNum(value) > asNum(expected);
    case "greater_than_or_equal":
      return isNum(value) && isNum(expected) && asNum(value) >= asNum(expected);
    case "less_than":
      return isNum(value) && isNum(expected) && asNum(value) < asNum(expected);
    case "in":
      return Array.isArray(expected) && expected.some((e) => sameValue(value, e));
    case "not_in":
      return (
        Array.isArray(expected) &&
        String(value).trim() !== "" &&
        !expected.some((e) => sameValue(value, e))
      );
    case "truthy":
      return value === true || (typeof value === "string" && toBool(value) === true) ||
        (typeof value !== "boolean" && typeof value !== "string" && Boolean(value));
    case "falsy":
      return value === false || toBool(value) === false;
    case "is_number":
      return isNum(value);
    case "non_empty":
      if (Array.isArray(value)) return value.length > 0;
      return String(value).trim() !== "";
    default:
      return false;
  }
}

// --- Reusable range mapping (numeric count -> select bucket) ----------------

interface Bucket {
  option: string;
  min: number;
  max: number;
}

/**
 * Parse a select option that expresses a count range. Handles the three shapes
 * the KB uses: exact ("0", "1"), closed range ("6-20"), open range ("50+").
 */
function parseBucket(option: string): Bucket | null {
  const s = option.trim();
  let m = /^(\d+)\s*[-–]\s*(\d+)$/.exec(s);
  if (m) return { option, min: Number(m[1]), max: Number(m[2]) };
  m = /^(\d+)\s*\+$/.exec(s);
  if (m) return { option, min: Number(m[1]), max: Number.POSITIVE_INFINITY };
  m = /^(\d+)$/.exec(s);
  if (m) return { option, min: Number(m[1]), max: Number(m[1]) };
  return null;
}

/**
 * Map a count onto the option that covers it. Shared by employees, fleet size
 * and rental units — the buckets come from the KB question, never from the UI.
 * Returns `undefined` when no option covers the count (e.g. 0 rental units in a
 * list that starts at 1), which correctly leaves the question unanswered.
 */
export function bucketForCount(options: string[] | undefined, count: number): string | undefined {
  if (!options || options.length === 0 || !Number.isFinite(count)) return undefined;
  for (const option of options) {
    const bucket = parseBucket(option);
    if (bucket && count >= bucket.min && count <= bucket.max) return bucket.option;
  }
  return undefined;
}

// --- The resolver -----------------------------------------------------------

const DEFAULT_MAX_ITERATIONS = 12;

class FactStore {
  readonly facts = new Map<string, ResolvedFact>();
  readonly conflicts: FactConflict[] = [];
  changed = false;

  get(key: string): ResolvedFact | undefined {
    return this.facts.get(key);
  }

  value(key: string): unknown {
    return this.facts.get(key)?.value;
  }

  /**
   * Write a fact, honouring precedence. Returns why the write was (not) made so
   * the trace can explain it.
   */
  put(candidate: ResolvedFact): { applied: boolean; reason?: string } {
    const existing = this.facts.get(candidate.key);
    if (!existing) {
      this.facts.set(candidate.key, candidate);
      this.changed = true;
      return { applied: true };
    }

    if (sameValue(existing.value, candidate.value)) {
      // Same conclusion from a stronger source: keep the stronger provenance.
      if (ORIGIN_PRIORITY[candidate.origin] > ORIGIN_PRIORITY[existing.origin]) {
        this.facts.set(candidate.key, candidate);
      }
      return { applied: true, reason: "already known" };
    }

    const existingRank = ORIGIN_PRIORITY[existing.origin];
    const candidateRank = ORIGIN_PRIORITY[candidate.origin];

    // Two things the user told us disagree. Neither can be discarded silently.
    if (
      existingRank === candidateRank &&
      USER_ORIGINS.has(existing.origin) &&
      USER_ORIGINS.has(candidate.origin)
    ) {
      this.conflict(candidate.key, existing, candidate, "needs_user");
      return { applied: false, reason: "conflicting user answers" };
    }

    if (candidateRank > existingRank) {
      this.conflict(candidate.key, existing, candidate, "kept_higher_priority");
      this.facts.set(candidate.key, candidate);
      this.changed = true;
      return { applied: true, reason: `overrode ${existing.origin} value` };
    }

    this.conflict(candidate.key, existing, candidate, "kept_higher_priority");
    return { applied: false, reason: `${existing.origin} value wins` };
  }

  private conflict(
    key: string,
    existing: ResolvedFact,
    candidate: ResolvedFact,
    resolution: FactConflict["resolution"]
  ) {
    const id = `CONFLICT_${key}`;
    if (this.conflicts.some((c) => c.id === id)) return;
    this.conflicts.push({
      id,
      requiresUser: resolution === "needs_user",
      resolution,
      message:
        resolution === "needs_user"
          ? `${key} was given two different answers (${format(existing.value)} and ${format(candidate.value)}).`
          : `${key} = ${format(candidate.value)} was discarded; the ${existing.origin} value ${format(existing.value)} takes precedence.`,
      facts: [
        { key, value: existing.value, origin: existing.origin, relationshipId: existing.relationshipId },
        { key, value: candidate.value, origin: candidate.origin, relationshipId: candidate.relationshipId },
      ],
    });
  }
}

const format = (v: unknown) => (typeof v === "string" ? `"${v}"` : String(v));

/**
 * Resolve every deterministic consequence of the seed facts.
 *
 * Runs relationships repeatedly until no NEW fact is produced (bounded by
 * `maxIterations`), so a derived fact can feed the next relationship — e.g.
 * `number_of_employees = 10` -> `Q_EMPLOYEE_COUNT = "6-20"` -> and any
 * relationship keyed off that bucket.
 */
export function resolveFacts(seeds: SeedFact[], options: ResolveOptions): ResolutionResult {
  const {
    kb,
    // The fixpoint machine executes the knowledge graph's reasoning nodes,
    // compiled from the versioned graph seed (which is the deterministic
    // projection of relationshipRegistry.ts). Explicit overrides remain for
    // tests and for callers that intentionally pin a relationship set.
    relationships = compileGraphRelationships(),
    contradictions = compileGraphContradictions(),
    allowedIndustries,
    applyStrongInference = false,
    maxIterations = DEFAULT_MAX_ITERATIONS,
  } = options;

  const questionById = new Map((kb.questions || []).map((q) => [q.id, q]));
  const businessTypeById = new Map((kb.businessTypes || []).map((b) => [b.id, b]));
  const store = new FactStore();
  const trace: TraceEntry[] = [];
  const inferred: ResolvedFact[] = [];
  const inferredSeen = new Set<string>();

  // --- Seeds ---------------------------------------------------------------
  for (const seed of seeds) {
    if (seed.value === undefined || seed.value === null) continue;
    if (seed.ref.type === "question" && !questionById.has(seed.ref.key)) continue;
    store.put({
      key: factKey(seed.ref),
      // `business_type` is source-only; store it under a ref the writer types
      // allow so the record shape stays uniform.
      ref: seed.ref.type === "business_type"
        ? { type: "profile", key: `business_type:${seed.ref.key}` }
        : seed.ref,
      value: seed.value,
      origin: seed.origin,
      confidence: seed.confidence ?? 1,
    });
  }

  // --- Fixpoint ------------------------------------------------------------
  let iterations = 0;
  for (; iterations < maxIterations; iterations++) {
    store.changed = false;

    for (const rel of relationships) {
      const sourceKey = factKey(rel.source);
      const sourceFact = store.get(sourceKey);
      if (!sourceFact) continue;
      if (rel.source.type === "question" && !questionById.has(rel.source.key)) continue;
      if (!evaluateCondition(sourceFact.value, rel.condition)) continue;

      for (const effect of rel.effects) {
        // Never write a question this jurisdiction's KB does not define.
        if (effect.target.type === "question" && !questionById.has(effect.target.key)) continue;

        const value = effectValue(effect, sourceFact.value, {
          questionById,
          businessTypeById,
          allowedIndustries,
        });
        if (value === undefined) continue;

        const certainty = effect.certainty;
        const origin: FactOrigin = certainty === "deterministic" ? "derived" : "inferred";
        const targetKey = factKey(effect.target);
        const candidate: ResolvedFact = {
          key: targetKey,
          ref: effect.target,
          value,
          origin,
          confidence: certainty === "deterministic" ? 1 : 0.75,
          derivedFrom: sourceKey,
          relationshipId: rel.id,
          certainty,
        };

        if (certainty === "strong_inference" && !applyStrongInference) {
          const seenKey = `${rel.id}|${targetKey}|${String(value)}`;
          if (!inferredSeen.has(seenKey)) {
            inferredSeen.add(seenKey);
            inferred.push(candidate);
            trace.push({
              relationshipId: rel.id,
              from: sourceKey,
              to: targetKey,
              value,
              certainty,
              relationship: effect.relationship,
              applied: false,
              reason: "strong inference is not applied automatically",
            });
          }
          continue;
        }

        const outcome = store.put(candidate);
        trace.push({
          relationshipId: rel.id,
          from: sourceKey,
          to: targetKey,
          value,
          certainty,
          relationship: effect.relationship,
          applied: outcome.applied,
          reason: outcome.reason,
        });
      }
    }

    if (!store.changed) break;
  }

  // --- Contradictions ------------------------------------------------------
  const conflicts = [...store.conflicts];
  for (const rule of contradictions) {
    const involved = rule.when.map((clause) => ({
      clause,
      fact: store.get(factKey(clause.ref)),
    }));
    const holds = involved.every(
      ({ clause, fact }) => fact !== undefined && evaluateCondition(fact.value, clause)
    );
    if (!holds) continue;
    const facts = involved.map(({ fact }) => ({
      key: fact!.key,
      value: fact!.value,
      origin: fact!.origin,
      relationshipId: fact!.relationshipId,
    }));
    // Only the user can settle a clash between two things the user stated.
    const requiresUser = facts.every((f) => USER_ORIGINS.has(f.origin));
    conflicts.push({
      id: rule.id,
      message: rule.message,
      requiresUser,
      resolution: requiresUser ? "needs_user" : "kept_higher_priority",
      facts,
    });
  }

  // --- Projections ---------------------------------------------------------
  const facts: Record<string, ResolvedFact> = {};
  const questionValues: Record<string, boolean | string> = {};
  const profileValues: Record<string, unknown> = {};
  const resolvedQuestionIds = new Set<string>();

  for (const [key, fact] of store.facts) {
    facts[key] = fact;
    if (fact.ref.type === "question") {
      resolvedQuestionIds.add(fact.ref.key);
      if (typeof fact.value === "boolean" || typeof fact.value === "string") {
        questionValues[fact.ref.key] = fact.value;
      }
    } else if (!fact.ref.key.startsWith("business_type:")) {
      profileValues[fact.ref.key] = fact.value;
    }
    void key;
  }

  return {
    facts,
    inferred,
    conflicts,
    questionValues,
    profileValues,
    resolvedQuestionIds,
    trace,
    iterations,
  };
}

interface EffectContext {
  questionById: Map<string, KnowledgeBase["questions"][number]>;
  businessTypeById: Map<string, KnowledgeBase["businessTypes"][number]>;
  allowedIndustries?: string[];
}

/** Compute the value an effect writes, or `undefined` to skip it. */
function effectValue(
  effect: RelationshipEffect,
  sourceValue: unknown,
  ctx: EffectContext
): unknown {
  if (!effect.derive) return effect.value;

  switch (effect.derive.kind) {
    case "count_bucket": {
      if (effect.target.type !== "question" || !isNum(sourceValue)) return undefined;
      const question = ctx.questionById.get(effect.target.key) as
        | { options?: string[] }
        | undefined;
      return bucketForCount(question?.options, asNum(sourceValue));
    }
    case "value_map": {
      const hit = effect.derive.map[String(sourceValue)];
      return hit === undefined ? undefined : hit;
    }
    case "kb_industry": {
      const bt = ctx.businessTypeById.get(String(sourceValue));
      if (!bt) return undefined;
      return industryNameFor(bt.industry_id, ctx.allowedIndustries);
    }
    default:
      return undefined;
  }
}

/**
 * KB industry id -> the industry label the intake actually offers.
 *
 * The KB and the intake dropdown name a few industries differently ("Tourism &
 * Hospitality" vs "Accommodation & Tourism"), so the alias table bridges them.
 * When the caller supplies the allowed list, anything that cannot be matched is
 * dropped rather than written as an unselectable value.
 */
function industryNameFor(industryId: string, allowedIndustries?: string[]): string | undefined {
  const candidate = INDUSTRY_NAME_ALIASES[industryId];
  if (!candidate) return undefined;
  if (!allowedIndustries || allowedIndustries.length === 0) return candidate;
  const hit = allowedIndustries.find(
    (name) => name.trim().toLowerCase() === candidate.trim().toLowerCase()
  );
  return hit;
}

// --- App-facing entry point -------------------------------------------------

export interface IntakeStateLike {
  /** BusinessProfile fields (business_type is the display NAME, as in the app). */
  profile: Record<string, unknown>;
  /** Discovery answers keyed by wizard key or KB question id. */
  answers?: Record<string, unknown>;
  /**
   * Keys the user stated in their own words (from the description). They rank
   * above values that merely sit on the profile. Accepts wizard keys, KB
   * question ids and profile field names.
   */
  explicitKeys?: Iterable<string>;
}

export interface ResolveIntakeOptions extends Omit<ResolveOptions, "kb"> {
  kb: KnowledgeBase;
}

/** Profile fields that participate in relationships. */
const PROFILE_FACT_KEYS = [
  "location_type",
  "industry",
  "business_structure",
  "number_of_employees",
  "number_of_vehicles",
  "number_of_rental_units",
] as const;

/**
 * Turn the live intake state into resolved facts.
 *
 * This is the single call the UI makes. It is a PURE function of
 * (profile, answers), so derived state can never go stale: change a source
 * value and every dependent fact is recomputed from scratch on the next render.
 */
export function resolveIntakeFacts(
  state: IntakeStateLike,
  options: ResolveIntakeOptions
): ResolutionResult {
  const { kb } = options;
  const profile = state.profile || {};
  const answers = state.answers || {};
  const explicit = new Set(state.explicitKeys ?? []);
  const originFor = (key: string): FactOrigin => (explicit.has(key) ? "explicit" : "user");

  const seeds: SeedFact[] = [];

  // Business type: the app stores the display name; relationships key off the id.
  const businessTypeName = String(profile.business_type ?? "").trim();
  if (businessTypeName) {
    const bt = (kb.businessTypes || []).find(
      (b) => b.name.trim().toLowerCase() === businessTypeName.toLowerCase()
    );
    if (bt) {
      seeds.push({ ref: { type: "business_type", key: bt.id }, value: true, origin: originFor("business_type") });
      seeds.push({ ref: { type: "profile", key: "business_type_id" }, value: bt.id, origin: originFor("business_type") });
    }
  }

  for (const key of PROFILE_FACT_KEYS) {
    const value = profile[key];
    if (value === undefined || value === null || value === "") continue;
    seeds.push({ ref: { type: "profile", key }, value, origin: originFor(key) });
  }

  // Discovery answers: wizard keys and raw KB question ids both land here.
  for (const [key, value] of Object.entries(answers)) {
    if (value === undefined || value === null) continue;
    const questionId = questionIdForAnswerKey(key);
    if (!questionId) continue;
    // Booleans, select values, and multi_select arrays are all facts. Anything
    // else (a number typed into a profile field, an object) is not an answer.
    const usable =
      typeof value === "boolean" ||
      (typeof value === "string" && value.trim() !== "") ||
      (Array.isArray(value) && value.length > 0);
    if (!usable) continue;
    seeds.push({ ref: { type: "question", key: questionId }, value, origin: originFor(key) });
  }

  return resolveFacts(seeds, options);
}
