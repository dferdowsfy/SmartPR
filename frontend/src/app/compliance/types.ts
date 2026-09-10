export const OBLIGATION_STATUSES = [
  "CURRENT",
  "UPCOMING",
  "DUE_SOON",
  "IN_PROGRESS",
  "NEEDS_ATTENTION",
  "MISSING",
  "OVERDUE",
  "COMPLETED",
  "UNKNOWN",
] as const;

export type ObligationStatus = (typeof OBLIGATION_STATUSES)[number];

export const DUE_DATE_SOURCES = [
  "REGULATORY_RULE",
  "DOCUMENT_EXTRACTED",
  "USER_PROVIDED",
  "EXTERNALLY_VERIFIED",
  "UNKNOWN",
] as const;

export type DueDateSource = (typeof DUE_DATE_SOURCES)[number];

export const MATTER_TYPES = [
  "NEW_BUSINESS_FORMATION",
  "ANNUAL_REPORT",
  "ANNUAL_FEE",
  "PERMISO_UNICO_RENEWAL",
  "HEALTH_LICENSE_RENEWAL",
  "MUNICIPAL_LICENSE_RENEWAL",
  "CHANGE_OF_ADDRESS",
  "CHANGE_OF_OWNER",
  "SECOND_LOCATION",
  "PERMIT_MODIFICATION",
  "OTHER",
] as const;

export type MatterType = (typeof MATTER_TYPES)[number];

export const MATTER_STATUSES = [
  "DRAFT",
  "IN_PROGRESS",
  "NEEDS_ATTENTION",
  "READY",
  "COMPLETED",
  "ARCHIVED",
] as const;

export type MatterStatus = (typeof MATTER_STATUSES)[number];

export interface ObligationBlueprint {
  requirementId: string;
  graphEntityId: string | null;
  name: string;
  agency: string;
  mandatory: boolean;
  source: "REGULATORY_GRAPH";
  sourceReference: string;
  renewalFrequencyMonths: number | null;
  renewalReference: string | null;
}

export interface ImportedEvidence {
  requirement_id?: string | null;
  original_filename: string;
  mime_type?: string | null;
  size_bytes?: number | null;
  storage_path?: string | null;
  extracted_fields?: Record<string, unknown>;
  extraction_confidence?: number | null;
  validation_result?: "PASS" | "NEEDS_REVIEW" | "FAIL";
  issue_date?: string | null;
  expiration_date?: string | null;
  due_date_source?: DueDateSource;
  source_reference?: string | null;
}

export const DUE_DATE_UNKNOWN_MESSAGE =
  "No due date set — upload current documentation or enter the date.";
