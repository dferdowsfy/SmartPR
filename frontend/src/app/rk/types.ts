// ============================================================================
// Regulatory Knowledge Graph — shared types (CLIENT-SAFE: no pg imports).
//
// The graph is a versioned property graph:
//  - rk_nodes rows are VERSION rows; `entity_id` is the stable logical id (for
//    seeded rows it equals the kb JSON id, e.g. "DOC_EIN", "RULE_0001").
//  - `data` (jsonb) is the CANONICAL record. Edges are DERIVED projections of
//    ref fields inside `data` (see registry.ts edgesOf) — never authored.
//  - Nothing is hard-deleted: versions supersede, archival is a status.
// ============================================================================

export type NodeType =
  | "municipality"
  | "industry"
  | "business_type"
  | "business_activity"
  | "intake_question"
  | "document"
  | "rule"
  | "agency"
  | "exemption"
  | "renewal"
  | "inspection"
  | "evidence_type"
  | "incentive"
  | "tax_incentive"
  | "tax_credit"
  | "tax_exemption"
  | "grant"
  | "reimbursement_program"
  | "funding_program"
  | "eligibility_criterion"
  | "benefit"
  | "application_window"
  | "project_fact"
  | "regulatory_source"
  | "intake_fact"
  | "fact_derivation"
  | "fact_contradiction";

export type NodeStatus =
  | "draft"
  | "proposed"
  | "active"
  | "superseded"
  | "archived"
  | "rolled_back";

export type EdgeType =
  | "requires"
  | "applies_to"
  | "asks"
  | "belongs_to"
  | "issued_by"
  | "derived_from"
  | "exempts"
  | "renews"
  | "inspects"
  | "depends_on"
  | "administered_by"
  | "authorized_by"
  | "available_in"
  | "provides"
  | "requires_application_to"
  | "has_deadline"
  | "compatible_with"
  | "conflicts_with"
  | "prerequisite_for"
  | "evaluated_against"
  | "satisfies"
  | "supports"
  | "supersedes"
  | "superseded_by"
  | "derives"
  | "contradicts";

/** Runtime vocabulary of edge labels (mirrors the EdgeType union above). */
export const EDGE_TYPES: EdgeType[] = [
  "requires",
  "applies_to",
  "asks",
  "belongs_to",
  "issued_by",
  "derived_from",
  "exempts",
  "renews",
  "inspects",
  "depends_on",
  "administered_by",
  "authorized_by",
  "available_in",
  "provides",
  "requires_application_to",
  "has_deadline",
  "compatible_with",
  "conflicts_with",
  "prerequisite_for",
  "evaluated_against",
  "satisfies",
  "supports",
  "supersedes",
  "superseded_by",
  "derives",
  "contradicts",
];

export type SourceType =
  | "bill"
  | "law"
  | "regulation"
  | "ordinance"
  | "guidance"
  | "form"
  | "web"
  | "other";

/** Legal lifecycle of a regulatory source. Only ENACTED_STATUSES may publish. */
export type LegalStatus =
  | "proposed"
  | "introduced"
  | "under_review"
  | "approved"
  | "signed"
  | "effective"
  | "amended"
  | "repealed"
  | "superseded";

export const ENACTED_STATUSES: LegalStatus[] = ["approved", "signed", "effective", "amended"];

export type ProposalOrigin = "manual" | "ai_extraction";
export type ChangeKind = "create_node" | "update_node" | "archive_node";

export type ProposalStatus =
  | "draft"
  | "ai_extracted"
  | "under_review"
  | "legal_review"
  | "accepted"
  | "rejected"
  | "deferred"
  | "merged"
  | "conflict"
  | "published";

/** Spec classification of what a proposal does. */
export type ProposalClassification =
  | "new_requirement"
  | "modified_requirement"
  | "removed_requirement"
  | "new_exemption"
  | "changed_agency_responsibility"
  | "changed_form"
  | "changed_eligibility_rule"
  | "changed_deadline"
  | "new_incentive"
  | "modified_incentive"
  | "expired_incentive"
  | "changed_benefit"
  | "no_action_required"
  | "needs_legal_review";

export type BatchStatus = "draft" | "approved" | "scheduled" | "published" | "rolled_back";

/** Which state of the graph a view renders. */
export type GraphMode = "live" | "draft" | "proposed";

// ---------------------------------------------------------------------------
// Row shapes (as returned by the API; timestamps are ISO strings)
// ---------------------------------------------------------------------------

export interface RkNodeRow {
  id: string;
  entity_id: string;
  node_type: NodeType;
  label: string;
  data: Record<string, unknown>;
  status: NodeStatus;
  version: number;
  supersedes_row_id: string | null;
  source_id: string | null;
  citation_section: string | null;
  valid_from: string | null;
  valid_to: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface RkEdgeRow {
  id: string;
  from_node_id: string;
  from_entity: string;
  to_entity: string;
  edge_type: EdgeType;
  data: Record<string, unknown>;
}

export interface RegulatorySourceRow {
  id: string;
  title: string;
  source_type: SourceType;
  legal_status: LegalStatus;
  citation: string | null;
  url: string | null;
  jurisdiction: string;
  raw_text: string | null;
  checksum: string | null;
  effective_date: string | null;
  sections_json: SourceSection[] | null;
  metadata: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SourceSection {
  key: string;
  heading: string;
  text: string;
  /** business_permitting | incentive_program | construction_only | general | unknown */
  classification: string;
}

export interface ChangeProposalRow {
  id: string;
  origin: ProposalOrigin;
  change_kind: ChangeKind;
  node_type: NodeType;
  entity_id: string;
  base_row_id: string | null;
  current_json: Record<string, unknown> | null;
  proposed_json: Record<string, unknown> | null;
  reviewed_json: Record<string, unknown> | null;
  classification: ProposalClassification | null;
  confidence: number | null;
  ai_explanation: string | null;
  citation_section: string | null;
  source_id: string | null;
  extraction_run_id: string | null;
  status: ProposalStatus;
  merged_into_id: string | null;
  created_by: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
  updated_at: string;
  /** joined for display */
  source_title?: string | null;
  source_legal_status?: LegalStatus | null;
}

export interface PublicationBatchRow {
  id: string;
  name: string;
  notes: string | null;
  status: BatchStatus;
  effective_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  published_by: string | null;
  published_at: string | null;
  rolled_back_by: string | null;
  rolled_back_at: string | null;
  created_by: string | null;
  created_at: string;
  item_count?: number;
}

export interface KbSnapshotRow {
  id: string;
  version: number;
  compiled_from_batch: string | null;
  is_active: boolean;
  created_at: string;
}

export interface AuditEventRow {
  id: string;
  actor: string | null;
  action: string;
  entity_kind: string | null;
  entity_id: string | null;
  before_json: Record<string, unknown> | null;
  after_json: Record<string, unknown> | null;
  batch_id: string | null;
  proposal_id: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Graph API DTOs
// ---------------------------------------------------------------------------

export interface GraphNodeDTO {
  /** version row id (uuid) — null for overlay-only nodes not yet in the DB */
  rowId: string | null;
  entityId: string;
  nodeType: NodeType;
  label: string;
  status: NodeStatus;
  version: number;
  data: Record<string, unknown>;
  sourceId: string | null;
  /** true when this node's shown state comes from an open proposal overlay */
  overlaid?: boolean;
  proposalId?: string | null;
}

export interface GraphEdgeDTO {
  fromEntity: string;
  toEntity: string;
  edgeType: EdgeType;
}

export interface GraphResponse {
  enabled: boolean;
  mode: GraphMode;
  nodes: GraphNodeDTO[];
  edges: GraphEdgeDTO[];
  counts: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Compiled knowledge-base snapshot (superset of rulesEngine.KnowledgeBase —
// the engine reads only the five arrays and ignores extra keys).
// ---------------------------------------------------------------------------

export interface CompiledKb {
  municipalities: Record<string, unknown>[];
  businessTypes: Record<string, unknown>[];
  questions: Record<string, unknown>[];
  documents: Record<string, unknown>[];
  rules: Record<string, unknown>[];
  industries: Record<string, unknown>[];
  businessTypeQuestions: { business_type_id: string; question_id: string }[];
  docMeta: {
    recommended: string[];
    order: string[];
    weights: Record<string, number>;
    legacyCode: Record<string, string>;
  };
  extensions: {
    agencies: Record<string, unknown>[];
    businessActivities: Record<string, unknown>[];
    exemptions: Record<string, unknown>[];
    renewals: Record<string, unknown>[];
    inspections: Record<string, unknown>[];
    evidenceTypes: Record<string, unknown>[];
    incentives: Record<string, unknown>[];
    taxIncentives: Record<string, unknown>[];
    taxCredits: Record<string, unknown>[];
    taxExemptions: Record<string, unknown>[];
    grants: Record<string, unknown>[];
    reimbursementPrograms: Record<string, unknown>[];
    fundingPrograms: Record<string, unknown>[];
    eligibilityCriteria: Record<string, unknown>[];
    benefits: Record<string, unknown>[];
    applicationWindows: Record<string, unknown>[];
    projectFacts: Record<string, unknown>[];
    regulatorySources: Record<string, unknown>[];
  };
  meta: { version: number; compiledAt: string; batchId: string | null };
}
