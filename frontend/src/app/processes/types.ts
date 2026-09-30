// ============================================================================
// Regulatory process model — domain-agnostic types.
//
// SmartPR's original knowledge model is document/permit-centric: a KB rule maps
// a trigger to a required document. `RegulatoryProcess` generalizes that into
// any regulatory process (permit, license, registration, certification,
// interconnection, incentive, inspection, filing, approval) so that new domains
// (energy first; telecom, environmental, healthcare, utilities later) are pure
// KB data — no hardcoded workflows. Legacy documents stay valid via
// `legacy_document_ids` aliases on each process.
// ============================================================================

export type ProcessType =
  | "permit"
  | "license"
  | "registration"
  | "certification"
  | "interconnection"
  | "incentive"
  | "inspection"
  | "filing"
  | "approval";

/** Applicability of a compliance process to a project. */
export type ProcessState = "REQUIRED" | "NOT_REQUIRED" | "POTENTIALLY_REQUIRED" | "NEEDS_FACT";
/** Evidence state of one requirement. */
export type EvidenceState = "SATISFIED" | "MISSING";
/** Incentives are never requirements; they have their own category. */
export type IncentiveState = "POTENTIALLY_ELIGIBLE" | "NOT_ELIGIBLE" | "NEEDS_FACT";

export type Confidence = "high" | "medium" | "low";
export type SourceStatus =
  | "verified"
  | "partially_verified"
  | "proposed_rule"
  | "guidance"
  | "needs_expert_validation";

export type FactValue = string | number | boolean | string[];
export type FactMap = Record<string, FactValue | undefined>;
/** Optional provenance for each fact (quote from the user's description). */
export type FactEvidence = Record<string, { quote?: string; confidence?: number; origin?: string }>;

export type ConditionOp =
  | "eq" | "neq" | "in" | "gte" | "gt" | "lte" | "lt" | "contains" | "known"
  | "stated" | "stated_in" | "stated_contains" | "stated_gt" | "stated_gte";

export type Condition =
  | { fact: string; op: ConditionOp; value?: FactValue }
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition };

export interface RegulatorySource {
  id: string;
  title: string;
  authority: string;
  authority_agency_id?: string;
  source_type: string;
  citation?: string;
  url: string;
  quote_source_url?: string;
  effective_date?: string | null;
  version_date?: string | null;
  date_last_verified: string;
  confidence: Confidence;
  status: SourceStatus;
  notes?: string;
}

export interface SourceCitation {
  source_id: string;
  supporting_source_ids?: string[];
  locator?: string;
  controlling_language?: string;
  confidence: Confidence;
  status: SourceStatus;
  notes?: string;
}

export interface ApplicabilityRule extends SourceCitation {
  id: string;
  outcome: "REQUIRED" | "POTENTIALLY_REQUIRED";
  trigger_summary: string;
  trigger: Condition;
  ask?: string[];
}

export interface ProcessException extends SourceCitation {
  id: string;
  reason: string;
  when: Condition;
}

export interface Prerequisite {
  process_id: string;
  source_id?: string;
  locator?: string;
  controlling_language?: string;
  note?: string;
  /** The prerequisite only applies when this holds (unknown → shown as conditional). */
  when?: Condition;
}

export interface RegulatoryProcess {
  id: string;
  name: string;
  process_type: ProcessType;
  domain: string;
  administered_by: string[];
  oversight_by?: string[];
  legacy_document_ids?: string[];
  /** Legacy KB rules this process supersedes: a legacy card produced only by
   * these rules is rendered through the process instead (one source of truth). */
  legacy_rule_ids?: string[];
  source_ids: string[];
  jurisdiction_note?: string;
  gate?: Condition;
  gate_ask?: string[];
  gate_reason?: string;
  gate_source_id?: string;
  gate_locator?: string;
  gate_controlling_language?: string;
  /** Fallback clarifying facts when no rule decides. */
  ask?: string[];
  /** Voluntary program (e.g. net metering): never presented as mandatory and
   * excluded from overall readiness. */
  voluntary?: boolean;
  voluntary_note?: string;
  /** Only applicable when this other process is REQUIRED (e.g. ongoing compliance after registration). */
  follows_process?: string;
  /** Lifecycle stage id (ProcessKB.stages) — orders sequential processes in the UI. */
  stage?: string;
  applicability: ApplicabilityRule[];
  exceptions?: ProcessException[];
  requirement_ids: string[];
  prerequisites: Prerequisite[];
}

export interface Requirement extends SourceCitation {
  id: string;
  name: string;
  evidence_ids: string[];
  applies_when?: Condition;
  /** "agency_step" = performed by the agency; tracked but not scored. */
  kind?: "evidence" | "agency_step";
}

export interface EvidenceType { id: string; name: string; legacy?: boolean }

export interface ProjectType {
  id: string;
  name: string;
  classifier: Condition;
  signals?: Condition;
  /** Facts to ask when the type is only "possible" (classifier unknown, signals true). */
  ask?: string[];
  may_require: string[];
  may_qualify_for: string[];
}

export interface IncentiveLink {
  id: string;
  name: string;
  process_type: "incentive";
  program_id?: string;
  administered_by: string[];
  source_ids: string[];
  requires_incentive?: string;
  eligibility: Condition;
  ask?: string[];
  eligibility_summary: string;
  ineligible_reason?: string;
  locator?: string;
  controlling_language?: string;
  eligibility_requirement_ids: string[];
  confidence: Confidence;
  status: SourceStatus;
  notes?: string;
}

export interface FactDefinition {
  key: string;
  label: string;
  type: "enum" | "boolean" | "number" | "string" | "list";
  options?: string[];
  /** Plain-English labels for enum/list options. */
  option_labels?: Record<string, string>;
  question: string;
  /** Context-aware wording: the first variant whose `when` holds replaces
   * `question`; `{fact_key}` placeholders interpolate known fact values. */
  question_variants?: { when: Condition; question: string }[];
  why: string;
  /** Unit of a number fact ("kW", "MWh", "ft"): the intake validator converts stated units. */
  unit?: "kW" | "MWh" | "ft";
  /** Extraction hint for the intake model (EN/ES). Facts with a hint are
   * added to the interpretation prompt and accepted by the validator. */
  extraction?: { en: string; es: string };
  /** Tie-break when ranking clarifying questions of equal weight (higher first). */
  question_priority?: number;
  /** Chip text for the intake strip: `{value}` interpolates; `values` maps enum options. */
  chip?: { template?: string; values?: Record<string, string> };
}

/** A fact the engine derives from other facts (never asked, never extracted).
 * The first case whose `when` holds sets the value; when none holds the fact
 * stays unknown and questions are routed to `ask_via`. */
export interface DerivedFact {
  key: string;
  label: string;
  cases: { id: string; value: FactValue; when: Condition; summary: string; source_id: string; locator?: string; controlling_language?: string }[];
  ask_via: string[];
  notes?: string;
}

export interface ProcessStage { id: string; name: string; name_es?: string; order: number; description?: string }

export interface AgencyRef { id: string; name: string; url?: string | null }

export interface ProcessKB {
  version: string;
  domain: string;
  jurisdiction: string;
  agencies: AgencyRef[];
  facts: FactDefinition[];
  evidence_types: EvidenceType[];
  requirements: Requirement[];
  project_types: ProjectType[];
  processes: RegulatoryProcess[];
  incentives: IncentiveLink[];
  derived_facts?: DerivedFact[];
  stages?: ProcessStage[];
  /** Incentive-eligibility facts are asked only when this holds. */
  incentive_questions_when?: Condition;
}

// ---------------------------------------------------------------- graph ----

export type EdgeKind =
  | "has_project_type"
  | "may_require"
  | "administered_by"
  | "requires"
  | "satisfied_by"
  | "derived_from"
  | "prerequisite_for"
  | "may_qualify_for"
  | "has_eligibility_requirement"
  | "aliases_document";

export interface GraphEdge { from: string; kind: EdgeKind; to: string }
