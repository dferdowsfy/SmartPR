// ============================================================================
// Shared types for the Requirement Monitoring & Fillable Documents system.
//
// These mirror the tables defined in data/requirements_schema.sql and the
// idempotent schema applied by ./schema.ts. They describe the four layers:
//   Requirement Knowledge Base · Form Template Engine · Source Monitoring Agent
//
// NOTE: the JSON rules engine remains authoritative for the existing intake
// flow. This layer adds preloaded, monitored, fillable requirements on top.
// ============================================================================

export type RuleStatus = "active" | "needs_review" | "deprecated" | "superseded";
export type DocumentStatus = RuleStatus;
export type TemplateStatus = "draft" | "active" | "needs_review" | "deprecated";
export type FormInstanceStatus =
  | "not_started"
  | "in_progress"
  | "needs_review"
  | "complete"
  | "approved"
  | "rejected";
export type MonitoringRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "needs_review";
export type ChangeEventStatus = "open" | "reviewed" | "accepted" | "rejected";
export type ChangeSeverity = "low" | "medium" | "high";
export type RenderMode = "native_ui" | "pdf_overlay" | "hybrid" | "external_only";

export type DocumentType =
  | "application"
  | "permit_form"
  | "license_form"
  | "inspection_request"
  | "certification_request"
  | "affidavit"
  | "checklist"
  | "guide"
  | "manual"
  | "instructions"
  | "renewal_form"
  | "supporting_document"
  | "regulation"
  | "circular_letter"
  | "administrative_order"
  | "policy"
  | "reference_material"
  // Legacy values kept for compatibility with previously seeded data.
  | "application_form"
  | "fee_schedule"
  | "zoning_document"
  | "tax_registration"
  | "license_requirement"
  | "inspection_requirement"
  | "supporting_document_template"
  | "portal_instruction"
  | "other";

export type ChangeType =
  | "document_update"
  | "document_removed"
  | "document_replaced"
  | "new_form_discovered"
  | "new_requirement"
  | "removed_requirement"
  | "form_updated"
  | "fee_updated"
  | "checklist_updated"
  | "source_unavailable"
  | "language_changed"
  | "manual_review_required";

// ---- Form schema (schema_json) ---------------------------------------------

export type FieldType =
  | "text"
  | "textarea"
  | "number"
  | "currency"
  | "date"
  | "email"
  | "phone"
  | "address"
  | "select"
  | "multiselect"
  | "checkbox"
  | "radio"
  | "file_upload"
  | "signature"
  | "declaration"
  | "hidden"
  | "calculated";

export interface FormFieldOption {
  value: string;
  label: string;
}

export interface FormField {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  /** Dot-path into intake data used for auto-fill, e.g. "intake.business.legal_name". */
  source?: string;
  options?: FormFieldOption[];
  placeholder?: string;
  help?: string;
  /** Show this field only when the referenced condition is met (PR 6). */
  visibleWhen?: { field: string; equals: string | number | boolean };
}

export interface FormSection {
  title: string;
  description?: string;
  fields: FormField[];
}

export interface FormSchema {
  sections: FormSection[];
}

// ---- Validation result (validation_result_json) ----------------------------

export interface ValidationResult {
  status: "complete" | "incomplete" | "needs_review";
  missingFields: string[];
  missingAttachments: string[];
  warnings: string[];
  blockingIssues: string[];
}

// ---- Submission package (PR 7) ---------------------------------------------

export interface PackagedForm {
  instanceId: string;
  templateName: string | null;
  requirementName: string | null;
  agency: string | null;
  status: string;
  formData: Record<string, unknown>;
  validation: ValidationResult | null;
  generatedPdfPath: string | null;
  source: { url: string | null; domain: string | null; lastCheckedAt: string | null };
}

export interface PackagedEvidenceFile {
  evidenceId: string;
  filename: string;
  zipPath: string;
  requirementCodes: string[];
  obligationIds: string[];
  inclusionReason: "obligation_link" | "requirement_tag" | "both";
  mimeType?: string | null;
  sizeBytes?: number | null;
}

export interface SubmissionPackage {
  tenantId: string;
  targetId: string;
  generatedAt: string;
  readiness: "ready" | "incomplete";
  forms: PackagedForm[];
  openIssues: string[];
  disclaimer: string;
  /** Locker files attached/tagged to package requirements (metadata; binaries optional). */
  evidenceFiles?: PackagedEvidenceFile[];
}

// ---- Row shapes ------------------------------------------------------------

export interface RequirementRule {
  id: string;
  tenant_id: string | null;
  jurisdiction_country: string;
  state_or_territory: string | null;
  municipality: string | null;
  county: string | null;
  agency_name: string | null;
  business_type: string | null;
  activity_type: string | null;
  entity_type: string | null;
  requirement_category: string | null;
  requirement_name: string | null;
  description: string | null;
  official_source_url: string | null;
  source_domain: string | null;
  confidence_score: number | null;
  status: RuleStatus;
  effective_date: string | null;
  last_checked_at: string | null;
  last_changed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RequirementDocument {
  id: string;
  requirement_rule_id: string | null;
  document_title: string | null;
  document_type: DocumentType | null;
  source_url: string | null;
  source_file_url: string | null;
  storage_path: string | null;
  extracted_text_path: string | null;
  generated_schema_path: string | null;
  rendered_template_path: string | null;
  checksum: string | null;
  file_type: string | null;
  language: string | null;
  version_label: string | null;
  detected_effective_date: string | null;
  detected_last_updated_date: string | null;
  last_modified: string | null;
  scope: "statewide" | "municipality_specific" | null;
  canonical_requirement_code: string | null;
  metadata_json: Record<string, unknown> | null;
  status: DocumentStatus;
  created_at: string;
  updated_at: string;
}

export interface FormTemplate {
  id: string;
  requirement_document_id: string | null;
  template_name: string | null;
  template_version: number;
  render_mode: RenderMode;
  schema_json: FormSchema;
  field_mappings_json: Record<string, string> | null;
  validation_rules_json: Record<string, unknown> | null;
  output_pdf_template_path: string | null;
  status: TemplateStatus;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserFormInstance {
  id: string;
  tenant_id: string;
  target_id: string;
  user_id: string;
  requirement_rule_id: string | null;
  form_template_id: string | null;
  status: FormInstanceStatus;
  form_data_json: Record<string, unknown>;
  validation_result_json: ValidationResult | null;
  generated_pdf_path: string | null;
  completed_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RequirementMonitoringRun {
  id: string;
  rule_id: string | null;
  status: MonitoringRunStatus;
  source_url: string | null;
  previous_checksum: string | null;
  new_checksum: string | null;
  change_detected: boolean;
  change_summary: string | null;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  created_at: string;
}

export interface RequirementChangeEvent {
  id: string;
  rule_id: string | null;
  document_id: string | null;
  monitoring_run_id: string | null;
  change_type: ChangeType;
  old_value: unknown;
  new_value: unknown;
  summary: string | null;
  severity: ChangeSeverity;
  status: ChangeEventStatus;
  created_at: string;
}
