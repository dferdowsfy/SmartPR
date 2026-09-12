// ============================================================================
// Regulatory Knowledge Graph — node-type registry (CLIENT-SAFE, pure data).
//
// One registry drives three things so they can never drift:
//   1. The DetailPanel edit forms (FieldSpec[] per node type).
//   2. Server-side validation of node data on writes.
//   3. Edge derivation: edgesOf(data) — relationships are projections of ref
//      fields inside the canonical `data` jsonb, recomputed on every write.
// ============================================================================

import type { EdgeType, NodeType } from "./types";
import { validateGuidanceConcept, type GuidanceConcept } from "../guidance/model";

export type FieldKind =
  | "text"
  | "textarea"
  | "json"
  | "number"
  | "boolean"
  | "select"
  | "multiselect"
  | "flags"
  | "entity_ref"
  | "entity_ref_list";

export interface FieldSpec {
  key: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  /** for kind=select */
  options?: string[];
  /** for kind=entity_ref / entity_ref_list: which node type it points to */
  refType?: NodeType;
  /** Some relationships may target any incentive subtype. */
  refTypes?: NodeType[];
  help?: string;
  /** warn before renaming — the rules engine matches some entities by name */
  renameWarning?: boolean;
}

export interface DerivedEdge {
  edgeType: EdgeType;
  toEntity: string;
}

export interface NodeTypeConfig {
  type: NodeType;
  label: string;
  plural: string;
  color: string;
  fields: FieldSpec[];
  /** derive relationship edges from canonical data */
  edgesOf: (data: Record<string, unknown>) => DerivedEdge[];
  /** human label for a node from its data */
  labelOf: (data: Record<string, unknown>) => string;
}

// Municipality flags are open-ended strings (the bundled KB already uses more
// flags than the engine's TS union — treat as opaque, never validate the union).
export const KNOWN_FLAGS = [
  "tourism",
  "coastal",
  "historic",
  "metro",
  "island",
  "capital",
  "industrial_port",
  "airport_host",
];

export const DOC_KINDS = [
  "permit",
  "license",
  "registration",
  "certificate",
  "supporting_doc",
  "form",
  "other",
];

export const RULE_TYPES = [
  "business_type",
  "question_trigger",
  "municipality",
  "municipality_flag",
];

export const MANDATORINESS = ["mandatory", "conditional", "informational"];

export const INCENTIVE_NODE_TYPES: NodeType[] = [
  "incentive",
  "tax_incentive",
  "tax_credit",
  "tax_exemption",
  "grant",
  "reimbursement_program",
  "funding_program",
];

export const PROJECT_FACT_KEYS = [
  "business_type",
  "industry",
  "naics_code",
  "municipality",
  "physical_location",
  "business_stage",
  "entity_type",
  "ownership_structure",
  "number_of_employees",
  "planned_job_creation",
  "annual_payroll",
  "average_wage",
  "expected_revenue",
  "capital_investment",
  "property_tenure",
  "export_activity",
  "outside_pr_revenue_percentage",
  "tourism_activity",
  "manufacturing_activity",
  "research_and_development_activity",
  "renewable_energy_investment",
  "construction_or_rehabilitation_activity",
  "agricultural_activity",
  "business_size",
  "veteran_owned",
  "minority_owned",
  "woman_owned",
  "opportunity_zone",
  "project_start_date",
];

const s = (v: unknown): string => (typeof v === "string" ? v : "");
const list = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

// F18: edge emission dedupes on (edgeType, toEntity) — a duplicated ref id
// in a data list must not project a duplicated edge into the graph.
function pushRef(out: DerivedEdge[], edgeType: EdgeType, v: unknown) {
  const id = s(v);
  if (id && !out.some((e) => e.edgeType === edgeType && e.toEntity === id)) {
    out.push({ edgeType, toEntity: id });
  }
}

function pushRefs(out: DerivedEdge[], edgeType: EdgeType, v: unknown) {
  for (const id of list(v)) pushRef(out, edgeType, id);
}

/** Temporal validity fields shared by rule and document configs. Date-only UTC
 *  `YYYY-MM-DD`; enforced by temporal.ts at pack compilation and engine
 *  evaluation. Blank = current law as modeled (never invent dates). */
function temporalFields(refType: "rule" | "document"): FieldSpec[] {
  return [
    { key: "effective_from", label: "Effective from", kind: "text", help: "First day in force, YYYY-MM-DD. Blank = current law as modeled." },
    { key: "effective_to", label: "Effective to", kind: "text", help: "EXCLUSIVE end: first day no longer in force, YYYY-MM-DD. Blank = still in force." },
    { key: "supersedes", label: "Supersedes", kind: "entity_ref_list", refType, help: "Older records this one retires once it is itself effective." },
  ];
}

const INCENTIVE_PROGRAM_FIELDS: FieldSpec[] = [
  { key: "name", label: "Program name", kind: "text", required: true },  { key: "description", label: "Short description", kind: "textarea", required: true },
  { key: "administering_agency_id", label: "Administering agency", kind: "entity_ref", refType: "agency", required: true },
  { key: "application_agency_id", label: "Application agency", kind: "entity_ref", refType: "agency" },
  { key: "authorized_by_ids", label: "Authorizing law / regulation / public source", kind: "entity_ref_list", refType: "regulatory_source", required: true },
  { key: "industry_ids", label: "Applicable industries", kind: "entity_ref_list", refType: "industry" },
  { key: "municipality_ids", label: "Available in municipalities", kind: "entity_ref_list", refType: "municipality" },
  { key: "geography_level", label: "Geography level", kind: "select", options: ["Federal", "Puerto Rico", "Municipal", "Other"], required: true },
  { key: "geography_notes", label: "Geography notes", kind: "textarea" },
  { key: "criterion_ids", label: "Eligibility criteria", kind: "entity_ref_list", refType: "eligibility_criterion", help: "Required unless the program has industry/geography scope (scope-only programs are discovery-only and capped at potentially_eligible)." },
  { key: "evidence_type_ids", label: "Supporting evidence", kind: "entity_ref_list", refType: "evidence_type" },
  { key: "benefit_ids", label: "Benefits", kind: "entity_ref_list", refType: "benefit", required: true },
  { key: "application_window_id", label: "Application window", kind: "entity_ref", refType: "application_window" },
  { key: "application_process", label: "Application process", kind: "textarea" },
  { key: "compatible_incentive_ids", label: "Compatible incentives", kind: "entity_ref_list", refTypes: INCENTIVE_NODE_TYPES },
  { key: "conflicting_incentive_ids", label: "Conflicting incentives", kind: "entity_ref_list", refTypes: INCENTIVE_NODE_TYPES },
  { key: "prerequisite_for_incentive_ids", label: "Prerequisite for incentives", kind: "entity_ref_list", refTypes: INCENTIVE_NODE_TYPES },
  { key: "program_status", label: "Program status", kind: "select", options: ["active", "expired", "suspended", "proposed"], required: true },
  { key: "effective_from", label: "Effective from (YYYY-MM-DD)", kind: "text" },
  { key: "effective_to", label: "Effective to (YYYY-MM-DD)", kind: "text" },
  { key: "last_verified_at", label: "Last verified at (ISO date)", kind: "text", required: true },
  { key: "source_version", label: "Source version", kind: "text", required: true },
  { key: "supersedes", label: "Supersedes incentive", kind: "entity_ref", refTypes: INCENTIVE_NODE_TYPES },
  { key: "superseded_by", label: "Superseded by incentive", kind: "entity_ref", refTypes: INCENTIVE_NODE_TYPES },
  { key: "automatic_eligibility", label: "Official source establishes automatic eligibility", kind: "boolean", help: "Leave off unless the authoritative source explicitly states that eligibility is automatic." },
  { key: "notes", label: "Internal review notes", kind: "textarea" },
];

function incentiveConfig(
  type: NodeType,
  label: string,
  plural: string,
  color: string
): NodeTypeConfig {
  return {
    type,
    label,
    plural,
    color,
    labelOf: (d) => s(d.name) || s(d.id),
    fields: INCENTIVE_PROGRAM_FIELDS,
    edgesOf: (d) => {
      const out: DerivedEdge[] = [];
      pushRef(out, "administered_by", d.administering_agency_id);
      pushRef(out, "requires_application_to", d.application_agency_id);
      pushRefs(out, "authorized_by", d.authorized_by_ids);
      pushRefs(out, "applies_to", d.industry_ids);
      pushRefs(out, "available_in", d.municipality_ids);
      pushRefs(out, "requires", d.criterion_ids);
      pushRefs(out, "requires", d.evidence_type_ids);
      pushRefs(out, "provides", d.benefit_ids);
      pushRef(out, "has_deadline", d.application_window_id);
      pushRefs(out, "compatible_with", d.compatible_incentive_ids);
      pushRefs(out, "conflicts_with", d.conflicting_incentive_ids);
      pushRefs(out, "prerequisite_for", d.prerequisite_for_incentive_ids);
      pushRef(out, "supersedes", d.supersedes);
      pushRef(out, "superseded_by", d.superseded_by);
      return out;
    },
  };
}

export const NODE_TYPE_CONFIGS: Record<NodeType, NodeTypeConfig> = {
  municipality: {
    type: "municipality",
    label: "Municipality",
    plural: "Municipalities",
    color: "#06b6d4",
    labelOf: (d) => s(d.name) || s(d.id),
    fields: [
      { key: "name", label: "Name", kind: "text", required: true, renameWarning: true },
      { key: "flags", label: "Flags", kind: "flags", help: "Regulatory overlays (tourism, coastal, historic…) that activate flag rules." },
      { key: "patente_rate", label: "Patente rate (decimal)", kind: "number", help: "Municipal gross-receipts tax rate, e.g. 0.005 = 0.5%. Leave blank if unknown." },
      { key: "notes", label: "Internal notes", kind: "textarea" },
    ],
    edgesOf: () => [],
  },

  industry: {
    type: "industry",
    label: "Industry",
    plural: "Industries",
    color: "#8b5cf6",
    labelOf: (d) => s(d.name) || s(d.id),
    fields: [
      { key: "name", label: "Name", kind: "text", required: true },
      { key: "description", label: "Description", kind: "textarea" },
    ],
    edgesOf: () => [],
  },

  business_type: {
    type: "business_type",
    label: "Business Type",
    plural: "Business Types",
    color: "#3b82f6",
    labelOf: (d) => s(d.name) || s(d.id),
    fields: [
      { key: "name", label: "Name", kind: "text", required: true, renameWarning: true },
      { key: "industry_id", label: "Industry", kind: "entity_ref", refType: "industry", required: true },
      { key: "description", label: "Description", kind: "textarea" },
      { key: "question_ids", label: "Intake questions asked", kind: "entity_ref_list", refType: "intake_question", help: "Which intake questions this business type asks (order preserved)." },
      { key: "activity_ids", label: "Business activities", kind: "entity_ref_list", refType: "business_activity" },
      { key: "notes", label: "Internal notes", kind: "textarea" },
    ],
    edgesOf: (d) => {
      const out: DerivedEdge[] = [];
      pushRef(out, "belongs_to", d.industry_id);
      pushRefs(out, "asks", d.question_ids);
      pushRefs(out, "applies_to", d.activity_ids);
      return out;
    },
  },

  business_activity: {
    type: "business_activity",
    label: "Business Activity",
    plural: "Business Activities",
    color: "#14b8a6",
    labelOf: (d) => s(d.name) || s(d.id),
    fields: [
      { key: "name", label: "Name", kind: "text", required: true },
      { key: "description", label: "Description", kind: "textarea" },
    ],
    edgesOf: () => [],
  },

  intake_question: {
    type: "intake_question",
    label: "Intake Question",
    plural: "Intake Questions",
    color: "#f59e0b",
    labelOf: (d) => s(d.question) || s(d.id),
    fields: [
      { key: "question", label: "Question text", kind: "textarea", required: true },
      { key: "type", label: "Answer type", kind: "select", options: ["boolean", "single_select", "multi_select"], required: true },
      { key: "options", label: "Options (for selects)", kind: "multiselect", help: "Answer choices for single/multi select questions." },
      { key: "stage", label: "Stage", kind: "select", options: ["discovery", "profile"], help: "profile = derived from business basics, never asked directly." },
      { key: "ui_key", label: "Legacy UI key", kind: "text", help: "Answer key the intake wizard stores for this question (legacy compatibility). Leave blank for new questions." },
      { key: "guidance", label: "User guidance", kind: "textarea" },
    ],
    edgesOf: () => [],
  },

  document: {
    type: "document",
    label: "Document / Permit",
    plural: "Documents & Permits",
    color: "#10b981",
    labelOf: (d) => s(d.name) || s(d.id),
    fields: [
      { key: "name", label: "Name", kind: "text", required: true },
      { key: "doc_kind", label: "Kind", kind: "select", options: DOC_KINDS, help: "Permit / license / registration / certificate / supporting document." },
      { key: "agency", label: "Agency (display name)", kind: "text", required: true, help: "Shown to users; kept as text for engine compatibility." },
      { key: "agency_id", label: "Issuing agency", kind: "entity_ref", refType: "agency" },
      { key: "agency_ids", label: "All involved agencies", kind: "entity_ref_list", refType: "agency", help: "Primary first. For filings that genuinely involve two agencies (e.g. nonprofit: Estado registers, IRS grants exemption)." },
      { key: "category", label: "Category", kind: "select", options: ["State", "Federal", "Municipal", "Insurance", "Legal", "Health", "Safety", "Environmental", "Other"], required: true },
      { key: "recommended", label: "Recommended (not mandatory)", kind: "boolean", help: "Recommended documents don't block readiness." },
      { key: "score_weight", label: "Readiness score weight", kind: "number", help: "Relative weight in readiness scoring. Blank = equal weight." },
      { key: "order_hint", label: "Checklist order", kind: "number", help: "Lower numbers sort first in the checklist." },
      { key: "legacy_code", label: "Legacy requirement code", kind: "text", help: "Code used for upload matching / filenames. Blank = derived from id." },
      { key: "evidence_type_ids", label: "Accepted evidence types", kind: "entity_ref_list", refType: "evidence_type" },
      { key: "depends_on_document_ids", label: "Prerequisite documents", kind: "entity_ref_list", refType: "document", help: "Documents that must be obtained before this one." },
      { key: "guidance", label: "User guidance", kind: "textarea" },
      { key: "citation", label: "Regulatory citation", kind: "text" },
      { key: "requirement_guidance", label: "Structured regulatory guidance", kind: "json", help: "Versioned EN/ES concept, conditions, dependencies and cited sources. Only validated guidance is shown as a regulatory explanation. Null disables bundled guidance." },
      { key: "notes", label: "Internal notes", kind: "textarea" },
      ...temporalFields("document"),
    ],
    edgesOf: (d) => {
      const out: DerivedEdge[] = [];
      pushRefs(out, "issued_by", (d.agency_ids as unknown[] | undefined) ?? d.agency_id);
      pushRefs(out, "depends_on", d.depends_on_document_ids);
      pushRefs(out, "requires", d.evidence_type_ids);
      pushRefs(out, "supersedes", d.supersedes);
      const guidance = d.requirement_guidance as GuidanceConcept | undefined;
      if (guidance && typeof guidance === "object") {
        for (const src of Array.isArray(guidance.sources) ? guidance.sources : []) pushRef(out, "derived_from", src?.id);
        pushRefs(out, "depends_on", guidance.dependencies);
        for (const dep of Array.isArray(guidance.conditionalDependencies) ? guidance.conditionalDependencies : []) pushRef(out, "depends_on", dep?.documentId);
        for (const condition of Array.isArray(guidance.conditions) ? guidance.conditions.flat().filter(Boolean) : []) {
          if (condition.key?.startsWith("Q_")) pushRef(out, "evaluated_against", condition.key);
        }
      }
      return out;
    },
  },

  rule: {
    type: "rule",
    label: "Applicability Rule",
    plural: "Applicability Rules",
    color: "#ec4899",
    labelOf: (d) => {
      const name = s(d.requirement_name);
      if (name) return name;
      const doc = s(d.requires_document_id);
      const rt = s(d.rule_type);
      return doc ? `${rt || "rule"} → ${doc}` : s(d.id) || "rule";
    },
    fields: [
      { key: "requirement_name", label: "Requirement name", kind: "text", help: "Plain-language name shown in review screens." },
      { key: "rule_type", label: "Rule type", kind: "select", options: RULE_TYPES, required: true },
      { key: "requires_document_id", label: "Requires document", kind: "entity_ref", refType: "document", required: true },
      { key: "business_type_id", label: "Business type (business_type / flag rules)", kind: "entity_ref", refType: "business_type" },
      { key: "question_id", label: "Trigger question (question_trigger rules)", kind: "entity_ref", refType: "intake_question" },
      { key: "expected_answer", label: "Expected answer", kind: "text", help: "\"true\" for yes/no triggers, or an exact option value." },
      { key: "municipality_flag", label: "Municipality flag (flag rules)", kind: "select", options: KNOWN_FLAGS },
      { key: "mandatoriness", label: "Mandatory / conditional / informational", kind: "select", options: MANDATORINESS },
      { key: "conditions", label: "Conditions that trigger the requirement", kind: "textarea" },
      { key: "exemptions_note", label: "Exemptions", kind: "textarea" },
      { key: "guidance", label: "User guidance", kind: "textarea" },
      { key: "citation", label: "Regulatory citation", kind: "text", help: "e.g. \"PS 1173 Art. 4.2\" or \"Ley 216-2014 §3\"." },
      { key: "notes", label: "Internal notes", kind: "textarea" },
      ...temporalFields("rule"),
    ],
    edgesOf: (d) => {
      const out: DerivedEdge[] = [];
      pushRef(out, "requires", d.requires_document_id);
      pushRef(out, "applies_to", d.business_type_id);
      pushRef(out, "applies_to", d.question_id);
      pushRefs(out, "supersedes", d.supersedes);
      return out;
    },
  },

  agency: {
    type: "agency",
    label: "Agency",
    plural: "Agencies",
    color: "#64748b",
    labelOf: (d) => s(d.name) || s(d.id),
    fields: [
      { key: "name", label: "Name", kind: "text", required: true },
      { key: "acronym", label: "Acronym", kind: "text" },
      { key: "level", label: "Level", kind: "select", options: ["Commonwealth", "Federal", "Municipal", "Other"] },
      { key: "website", label: "Website", kind: "text" },
      { key: "description", label: "Description", kind: "textarea" },
    ],
    edgesOf: () => [],
  },

  exemption: {
    type: "exemption",
    label: "Exemption",
    plural: "Exemptions",
    color: "#f43f5e",
    labelOf: (d) => s(d.name) || s(d.id),
    fields: [
      { key: "name", label: "Name", kind: "text", required: true },
      { key: "description", label: "Description", kind: "textarea", required: true },
      { key: "exempts_entity_ids", label: "Exempts (rules/documents)", kind: "entity_ref_list", refType: "rule" },
      { key: "conditions", label: "Qualifying conditions", kind: "textarea" },
      { key: "citation", label: "Regulatory citation", kind: "text" },
    ],
    edgesOf: (d) => list(d.exempts_entity_ids).map((id) => ({ edgeType: "exempts" as EdgeType, toEntity: id })),
  },

  renewal: {
    type: "renewal",
    label: "Renewal",
    plural: "Renewals",
    color: "#0ea5e9",
    labelOf: (d) => s(d.name) || s(d.id),
    fields: [
      { key: "name", label: "Name", kind: "text", required: true },
      { key: "document_id", label: "Renews document", kind: "entity_ref", refType: "document", required: true },
      { key: "frequency_months", label: "Frequency (months)", kind: "number" },
      { key: "description", label: "Description", kind: "textarea" },
      { key: "citation", label: "Regulatory citation", kind: "text" },
    ],
    edgesOf: (d) => {
      const out: DerivedEdge[] = [];
      pushRef(out, "renews", d.document_id);
      return out;
    },
  },

  inspection: {
    type: "inspection",
    label: "Inspection",
    plural: "Inspections",
    color: "#d97706",
    labelOf: (d) => s(d.name) || s(d.id),
    fields: [
      { key: "name", label: "Name", kind: "text", required: true },
      { key: "document_id", label: "Related document", kind: "entity_ref", refType: "document" },
      { key: "agency_id", label: "Inspecting agency", kind: "entity_ref", refType: "agency" },
      { key: "description", label: "Description", kind: "textarea" },
      { key: "citation", label: "Regulatory citation", kind: "text" },
    ],
    edgesOf: (d) => {
      const out: DerivedEdge[] = [];
      pushRef(out, "inspects", d.document_id);
      pushRef(out, "issued_by", d.agency_id);
      return out;
    },
  },

  evidence_type: {
    type: "evidence_type",
    label: "Evidence Type",
    plural: "Evidence Types",
    color: "#a855f7",
    labelOf: (d) => s(d.name) || s(d.id),
    fields: [
      { key: "name", label: "Name", kind: "text", required: true },
      { key: "description", label: "Description", kind: "textarea" },
      { key: "satisfies_criterion_ids", label: "Satisfies eligibility criteria", kind: "entity_ref_list", refType: "eligibility_criterion" },
    ],
    edgesOf: (d) => list(d.satisfies_criterion_ids).map((id) => ({ edgeType: "satisfies" as EdgeType, toEntity: id })),
  },

  incentive: incentiveConfig("incentive", "Incentive", "Incentives", "#0f766e"),
  tax_incentive: incentiveConfig("tax_incentive", "Tax Incentive", "Tax Incentives", "#0d9488"),
  tax_credit: incentiveConfig("tax_credit", "Tax Credit", "Tax Credits", "#059669"),
  tax_exemption: incentiveConfig("tax_exemption", "Tax Exemption", "Tax Exemptions", "#16a34a"),
  grant: incentiveConfig("grant", "Grant", "Grants", "#2563eb"),
  reimbursement_program: incentiveConfig("reimbursement_program", "Reimbursement Program", "Reimbursement Programs", "#7c3aed"),
  funding_program: incentiveConfig("funding_program", "Funding Program", "Funding Programs", "#9333ea"),

  eligibility_criterion: {
    type: "eligibility_criterion",
    label: "Eligibility Criterion",
    plural: "Eligibility Criteria",
    color: "#d97706",
    labelOf: (d) => s(d.name) || s(d.description) || s(d.id),
    fields: [
      { key: "name", label: "Criterion name", kind: "text", required: true },
      { key: "description", label: "Plain-language criterion", kind: "textarea", required: true },
      { key: "project_fact_id", label: "Evaluated against project fact", kind: "entity_ref", refType: "project_fact", required: true },
      { key: "fact_key", label: "Normalized fact key", kind: "select", options: PROJECT_FACT_KEYS, required: true },
      { key: "operator", label: "Operator", kind: "select", options: ["equals", "not_equals", "in", "not_in", "contains", "gte", "lte", "gt", "lt", "truthy", "falsy", "exists", "date_on_or_after", "date_on_or_before"], required: true },
      { key: "expected_value", label: "Expected value", kind: "text", help: "For lists, enter one value per line in Expected values instead." },
      { key: "expected_values", label: "Expected values", kind: "multiselect" },
      { key: "required", label: "Required for eligibility", kind: "boolean" },
      { key: "material", label: "Material to classification", kind: "boolean", help: "Only material unknowns become adaptive follow-up questions." },
      { key: "question", label: "Adaptive follow-up question", kind: "textarea" },
      { key: "answer_type", label: "Answer type", kind: "select", options: ["boolean", "number", "text", "date", "single_select"] },
      { key: "answer_options", label: "Answer options", kind: "multiselect" },
      { key: "voluntary", label: "Voluntary disclosure", kind: "boolean" },
      { key: "legally_relevant", label: "Legally relevant", kind: "boolean", help: "Required before voluntary ownership-status questions can be surfaced." },
      { key: "evidence_type_ids", label: "Evidence that supports this criterion", kind: "entity_ref_list", refType: "evidence_type" },
      { key: "evidence_can_satisfy", label: "Verified evidence can satisfy this criterion", kind: "boolean", help: "Enable only when the official source allows this evidence to establish the criterion without an additional project fact." },
      { key: "citation", label: "Source citation", kind: "text", required: true },
    ],
    edgesOf: (d) => {
      const out: DerivedEdge[] = [];
      pushRef(out, "evaluated_against", d.project_fact_id);
      pushRefs(out, "requires", d.evidence_type_ids);
      return out;
    },
  },

  benefit: {
    type: "benefit",
    label: "Benefit",
    plural: "Benefits",
    color: "#0891b2",
    labelOf: (d) => s(d.name) || s(d.id),
    fields: [
      { key: "name", label: "Benefit name", kind: "text", required: true },
      { key: "description", label: "Benefit description", kind: "textarea", required: true },
      { key: "benefit_type", label: "Benefit type", kind: "select", options: ["credit", "exemption", "deduction", "grant", "reimbursement", "loan", "guarantee", "technical_assistance", "tax_incentive", "other"], required: true },
      { key: "amount_description", label: "Amount / value description", kind: "textarea", help: "Use only source-backed language. Do not estimate or invent amounts." },
      { key: "citation", label: "Source citation", kind: "text", required: true },
    ],
    edgesOf: () => [],
  },

  application_window: {
    type: "application_window",
    label: "Application Window",
    plural: "Application Windows",
    color: "#ea580c",
    labelOf: (d) => s(d.name) || s(d.id),
    fields: [
      { key: "name", label: "Window name", kind: "text", required: true },
      { key: "opens_at", label: "Opens at (ISO date)", kind: "text" },
      { key: "closes_at", label: "Closes at (ISO date)", kind: "text" },
      { key: "rolling", label: "Rolling application", kind: "boolean" },
      { key: "description", label: "Deadline / window guidance", kind: "textarea", required: true },
      { key: "last_verified_at", label: "Last verified at (ISO date)", kind: "text", required: true },
      { key: "citation", label: "Source citation", kind: "text", required: true },
    ],
    edgesOf: () => [],
  },

  project_fact: {
    type: "project_fact",
    label: "Project Fact",
    plural: "Project Facts",
    color: "#475569",
    labelOf: (d) => s(d.name) || s(d.fact_key) || s(d.id),
    fields: [
      { key: "name", label: "Fact name", kind: "text", required: true },
      { key: "fact_key", label: "Normalized fact key", kind: "select", options: PROJECT_FACT_KEYS, required: true },
      { key: "value_type", label: "Value type", kind: "select", options: ["boolean", "number", "text", "date", "string_list"], required: true },
      { key: "description", label: "Description", kind: "textarea" },
      { key: "sensitive", label: "Sensitive", kind: "boolean" },
      { key: "voluntary", label: "Voluntary", kind: "boolean" },
    ],
    edgesOf: () => [],
  },

  regulatory_source: {
    type: "regulatory_source",
    label: "Law / Regulation / Public Source",
    plural: "Laws, Regulations & Public Sources",
    color: "#be123c",
    labelOf: (d) => s(d.name) || s(d.title) || s(d.id),
    fields: [
      { key: "name", label: "Source name", kind: "text", required: true },
      { key: "source_type", label: "Source type", kind: "select", options: ["bill", "law", "regulation", "ordinance", "guidance", "program_page", "form", "announcement", "web", "other"], required: true },
      { key: "legal_status", label: "Legal status", kind: "select", options: ["proposed", "introduced", "under_review", "approved", "signed", "effective", "amended", "repealed", "superseded"], required: true },
      { key: "jurisdiction", label: "Jurisdiction", kind: "select", options: ["Federal", "Puerto Rico", "Municipal", "Other"], required: true },
      { key: "citation", label: "Citation", kind: "text", required: true },
      { key: "url", label: "Official source URL", kind: "text", required: true },
      { key: "effective_date", label: "Effective date", kind: "text" },
      { key: "last_verified_at", label: "Last verified at", kind: "text", required: true },
      { key: "source_version", label: "Source version", kind: "text", required: true },
      { key: "supports_incentive_ids", label: "Supports incentives", kind: "entity_ref_list", refTypes: INCENTIVE_NODE_TYPES },
      { key: "supports_document_ids", label: "Supports requirement guidance", kind: "entity_ref_list", refType: "document" },
    ],
    edgesOf: (d) => [...list(d.supports_incentive_ids), ...list(d.supports_document_ids)].map((id) => ({ edgeType: "supports" as EdgeType, toEntity: id })),
  },

  intake_fact: {
    type: "intake_fact",
    label: "Intake Fact",
    plural: "Intake Facts",
    color: "#64748b",
    labelOf: (d) => s(d.label) || s(d.fact_address) || s(d.id),
    fields: [
      { key: "fact_address", label: "Fact address", kind: "text", required: true, help: "Stable address, e.g. question:Q_EMPLOYEES_HIRED" },
      { key: "fact_type", label: "Fact type", kind: "select", options: ["profile", "question", "business_type"], required: true },
      { key: "fact_key", label: "Fact key", kind: "text", required: true },
      { key: "label", label: "Human label", kind: "text" },
    ],
    edgesOf: () => [],
  },

  fact_derivation: {
    type: "fact_derivation",
    label: "Fact Derivation",
    plural: "Fact Derivations",
    color: "#7c3aed",
    labelOf: (d) => s(d.id),
    fields: [
      { key: "relationship_id", label: "Parent relationship id", kind: "text", required: true, help: "INTAKE_RELATIONSHIPS id; one node per effect" },
      { key: "source_fact_id", label: "Source fact", kind: "entity_ref", refType: "intake_fact", required: true },
      { key: "condition_operator", label: "Condition operator", kind: "select", options: ["equals", "not_equals", "greater_than", "greater_than_or_equal", "less_than", "in", "not_in", "truthy", "falsy", "is_number", "non_empty"], required: true },
      { key: "condition_value", label: "Condition value (JSON)", kind: "textarea" },
      { key: "target_fact_id", label: "Target fact", kind: "entity_ref", refType: "intake_fact", required: true },
      { key: "target_value", label: "Target value (JSON)", kind: "textarea" },
      { key: "derive_kind", label: "Value derivation", kind: "select", options: ["literal", "count_bucket", "value_map", "kb_industry"] },
      { key: "derive_map", label: "Value map (JSON)", kind: "textarea" },
      { key: "certainty", label: "Certainty", kind: "select", options: ["deterministic", "strong_inference"], required: true },
      { key: "relationship", label: "Relationship kind", kind: "select", options: ["IMPLIES", "IMPLIES_FALSE", "REQUIRES_VALUE", "MUTUALLY_EXCLUSIVE", "PARENT_CHILD", "DERIVED_VALUE", "CONTRADICTS"], required: true },
      { key: "note", label: "Why this holds (provenance)", kind: "textarea", required: true },
    ],
    edgesOf: (d) => {
      const out: DerivedEdge[] = [];
      pushRef(out, "derived_from", d.source_fact_id);
      pushRef(out, "derives", d.target_fact_id);
      return out;
    },
  },

  fact_contradiction: {
    type: "fact_contradiction",
    label: "Fact Contradiction",
    plural: "Fact Contradictions",
    color: "#dc2626",
    labelOf: (d) => s(d.id),
    fields: [
      { key: "message", label: "Contradiction message", kind: "textarea", required: true },
      { key: "when", label: "Clauses (JSON)", kind: "textarea", required: true, help: "Array of {fact_address, operator, value}" },
      { key: "fact_ids", label: "Involved facts", kind: "entity_ref_list", refType: "intake_fact", required: true },
    ],
    edgesOf: (d) => list(d.fact_ids).map((id) => ({ edgeType: "contradicts" as EdgeType, toEntity: id })),
  },
};

export const NODE_TYPES = Object.keys(NODE_TYPE_CONFIGS) as NodeType[];

/** Allowed (from, edge, to) triples — powers the legend + write validation. */
const INCENTIVE_EDGE_RULES: { from: NodeType; edge: EdgeType; to: NodeType }[] = INCENTIVE_NODE_TYPES.flatMap((from) => [
  { from, edge: "administered_by" as EdgeType, to: "agency" as NodeType },
  { from, edge: "requires_application_to" as EdgeType, to: "agency" as NodeType },
  { from, edge: "authorized_by" as EdgeType, to: "regulatory_source" as NodeType },
  { from, edge: "applies_to" as EdgeType, to: "industry" as NodeType },
  { from, edge: "available_in" as EdgeType, to: "municipality" as NodeType },
  { from, edge: "requires" as EdgeType, to: "eligibility_criterion" as NodeType },
  { from, edge: "requires" as EdgeType, to: "evidence_type" as NodeType },
  { from, edge: "provides" as EdgeType, to: "benefit" as NodeType },
  { from, edge: "has_deadline" as EdgeType, to: "application_window" as NodeType },
  ...INCENTIVE_NODE_TYPES.flatMap((to) => [
    { from, edge: "compatible_with" as EdgeType, to },
    { from, edge: "conflicts_with" as EdgeType, to },
    { from, edge: "prerequisite_for" as EdgeType, to },
    { from, edge: "supersedes" as EdgeType, to },
    { from, edge: "superseded_by" as EdgeType, to },
  ]),
]);

export const EDGE_RULES: { from: NodeType; edge: EdgeType; to: NodeType }[] = [
  { from: "business_type", edge: "belongs_to", to: "industry" },
  { from: "business_type", edge: "asks", to: "intake_question" },
  { from: "business_type", edge: "applies_to", to: "business_activity" },
  { from: "rule", edge: "requires", to: "document" },
  { from: "rule", edge: "applies_to", to: "business_type" },
  { from: "rule", edge: "applies_to", to: "intake_question" },
  { from: "document", edge: "issued_by", to: "agency" },
  { from: "document", edge: "derived_from", to: "regulatory_source" },
  { from: "document", edge: "evaluated_against", to: "intake_question" },
  { from: "regulatory_source", edge: "supports", to: "document" },
  { from: "document", edge: "depends_on", to: "document" },
  { from: "document", edge: "requires", to: "evidence_type" },
  { from: "exemption", edge: "exempts", to: "rule" },
  { from: "renewal", edge: "renews", to: "document" },
  { from: "inspection", edge: "inspects", to: "document" },
  { from: "inspection", edge: "issued_by", to: "agency" },
  { from: "evidence_type", edge: "satisfies", to: "eligibility_criterion" },
  { from: "eligibility_criterion", edge: "evaluated_against", to: "project_fact" },
  { from: "eligibility_criterion", edge: "requires", to: "evidence_type" },
  { from: "fact_derivation", edge: "derived_from", to: "intake_fact" },
  { from: "fact_derivation", edge: "derives", to: "intake_fact" },
  { from: "fact_contradiction", edge: "contradicts", to: "intake_fact" },
  ...INCENTIVE_NODE_TYPES.map((to) => ({ from: "regulatory_source" as NodeType, edge: "supports" as EdgeType, to })),
  ...INCENTIVE_EDGE_RULES,
];

export function labelForNode(nodeType: NodeType, data: Record<string, unknown>): string {
  const cfg = NODE_TYPE_CONFIGS[nodeType];
  return cfg ? cfg.labelOf(data) : String(data.id ?? "");
}

/**
 * Validate node data against the registry. Returns a list of problems
 * (empty = valid). Shared by the server routes and (optionally) the client.
 */
export function validateNodeData(nodeType: NodeType, data: Record<string, unknown>): string[] {
  const cfg = NODE_TYPE_CONFIGS[nodeType];
  if (!cfg) return [`Unknown node type: ${nodeType}`];
  const problems: string[] = [];
  if (nodeType === "document" && data.requirement_guidance !== undefined && data.requirement_guidance !== null) {
    // Draft content can be retained for review, but is never served as validated.
    const guidance = data.requirement_guidance as GuidanceConcept;
    problems.push(...validateGuidanceConcept(guidance, String(data.id)).filter(p => p !== "GUIDANCE_NOT_VALIDATED"));
  }
  for (const f of cfg.fields) {
    if (!f.required) continue;
    // F06: criterion_ids is conditionally required for incentive programs —
    // scope-only (discovery) programs are valid; the explicit check below
    // enforces the "criteria OR scope" rule, so the generic check must skip it.
    if (INCENTIVE_NODE_TYPES.includes(nodeType) && f.key === "criterion_ids") continue;
    const v = data[f.key];
    if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) {
      problems.push(`Missing required field: ${f.label}`);
    }
  }
  if (nodeType === "rule") {
    const rt = s(data.rule_type);
    if (rt === "question_trigger" && !s(data.question_id)) {
      problems.push("question_trigger rules need a trigger question.");
    }
    if (rt === "business_type" && !s(data.business_type_id)) {
      problems.push("business_type rules need a business type.");
    }
    if (rt === "municipality_flag" && !s(data.municipality_flag)) {
      problems.push("municipality_flag rules need a flag.");
    }
  }
  if (INCENTIVE_NODE_TYPES.includes(nodeType)) {
    if (!list(data.authorized_by_ids).length) problems.push("Incentives need at least one authoritative source.");
    // F06 mirrors compileIncentiveCatalog: zero substantive criteria is valid
    // only when industry/geography scope exists (discovery-only program, capped
    // at potentially_eligible). A program with neither is vacuous and rejected.
    const hasScope = list(data.industry_ids).length > 0 || list(data.municipality_ids).length > 0;
    if (!list(data.criterion_ids).length && !hasScope) {
      problems.push("Incentives need at least one eligibility criterion or industry/geography scope.");
    }
    if (!list(data.benefit_ids).length) problems.push("Incentives need at least one source-backed benefit.");
    if (data.program_status === "active" && (!s(data.last_verified_at) || !s(data.source_version))) {
      problems.push("Active incentives need a last verified date and source version.");
    }
  }
  if (nodeType === "eligibility_criterion") {
    const factKey = s(data.fact_key);
    if (!PROJECT_FACT_KEYS.includes(factKey)) problems.push("Eligibility criteria must use a supported project fact key.");
    if (["veteran_owned", "minority_owned", "woman_owned"].includes(factKey)) {
      if (data.voluntary !== true || data.legally_relevant !== true) {
        problems.push("Ownership-status criteria must be voluntary and marked legally relevant.");
      }
    }
  }
  return problems;
}

/** New entity ids: slugified, prefixed per type, uppercase to match kb style. */
export function newEntityId(nodeType: NodeType, name: string): string {
  const prefix: Record<NodeType, string> = {
    municipality: "MUN",
    industry: "IND",
    business_type: "BT",
    business_activity: "ACT",
    intake_question: "Q",
    document: "DOC",
    rule: "RULE",
    agency: "AGY",
    exemption: "EXM",
    renewal: "RNW",
    inspection: "INSP",
    evidence_type: "EVD",
    incentive: "INC",
    tax_incentive: "TAXINC",
    tax_credit: "TAXCR",
    tax_exemption: "TAXEX",
    grant: "GRANT",
    reimbursement_program: "REIMB",
    funding_program: "FUND",
    eligibility_criterion: "CRIT",
    benefit: "BEN",
    application_window: "WIN",
    project_fact: "FACT",
    regulatory_source: "SRC",
    intake_fact: "IF",
    fact_derivation: "FDER",
    fact_contradiction: "FCON",
  };
  const slug = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return `${prefix[nodeType]}_${slug || Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

/** Minimal node shape for pure graph traversal (no DB access). */
export interface TraversalNode {
  entityId: string;
  nodeType: NodeType;
  data: Record<string, unknown>;
}

/**
 * Transitive prerequisite closure for a document: follows projected
 * `depends_on` edges (document → document) until fixpoint. Cycle-safe —
 * a dependency cycle returns each node once instead of looping forever.
 *
 * This is the graph actually being *used* for reasoning: callers get the
 * ordered list of documents that must be obtained before `documentId`.
 * Returns entity ids in breadth-first discovery order.
 */
export function prerequisiteClosure(
  nodes: TraversalNode[],
  documentId: string
): string[] {
  const edgesByFrom = new Map<string, string[]>();
  for (const n of nodes) {
    if (n.nodeType !== "document") continue;
    const cfg = NODE_TYPE_CONFIGS[n.nodeType];
    for (const e of cfg.edgesOf(n.data)) {
      if (e.edgeType !== "depends_on") continue;
      const list = edgesByFrom.get(n.entityId) ?? [];
      list.push(e.toEntity);
      edgesByFrom.set(n.entityId, list);
    }
  }
  const seen = new Set<string>([documentId]);
  const queue = [...(edgesByFrom.get(documentId) ?? [])];
  const out: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    for (const next of edgesByFrom.get(id) ?? []) {
      if (!seen.has(next)) queue.push(next);
    }
  }
  return out;
}
