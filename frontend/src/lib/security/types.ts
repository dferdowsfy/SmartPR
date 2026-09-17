/**
 * Typed security-control registry types for SOC 2 readiness.
 * Not a compliance claim — status reflects repository evidence only.
 */

export type ControlStatus =
  | "implemented"
  | "partial"
  | "documented_only"
  | "missing"
  | "requires_verification";

export type ControlCategory =
  | "access_control"
  | "isolation"
  | "logging"
  | "secrets"
  | "change_management"
  | "vulnerability"
  | "availability"
  | "incident"
  | "data_governance"
  | "governance"
  | "risk";

export type Enforcement = "server" | "process" | "infra" | "ui_only";

export interface SecurityControl {
  id: string;
  name: string;
  category: ControlCategory;
  tsc_mapping: string[];
  status: ControlStatus;
  enforcement: Enforcement;
  evidence_types: string[];
  owners: string[];
  repo_refs: string[];
  notes?: string;
}

export interface SecurityControlsRegistry {
  version: number;
  updated_at: string;
  disclaimer: string;
  controls: SecurityControl[];
}

export type EvidenceKind =
  | "code_review"
  | "automated_test"
  | "config_screenshot"
  | "access_review"
  | "audit_log"
  | "ci_run"
  | "ticket"
  | "scan_report"
  | "vendor_report"
  | "restore_test"
  | "incident_record"
  | "postmortem"
  | "policy"
  | "risk_record"
  | "db_schema"
  | "test_result"
  | "other";

export type IncidentSeverity = "low" | "medium" | "high" | "critical";
export type IncidentStatus = "open" | "investigating" | "contained" | "resolved" | "closed";
export type RiskStatus = "open" | "accepted" | "mitigating" | "closed";
export type PolicyStatus = "draft" | "active" | "retired";
