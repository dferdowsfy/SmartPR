/** Agency assistant run types (Phase 2 UI skeleton). No real SURI browser automation. */

export type AgencyFilingType =
  | "SURI_REGISTER_TAXPAYER"
  | "SURI_MERCHANT_REGISTRATION";

export type AgencyRunStatus =
  | "queued"
  | "running"
  | "paused"
  | "review"
  | "stopped"
  | "failed";

export type AgencyPauseReason =
  | "USER_UPLOAD"
  | "USER_LOGIN"
  | "CAPTCHA"
  | "PAYMENT"
  | null;

export interface AgencyRunEvent {
  index: number;
  message: string;
  message_es: string;
  screenshot_url: string;
  created_at: string;
  kind?: "info" | "pause" | "review";
}

export interface AgencyRun {
  id: string;
  business_id: string;
  filing_type: AgencyFilingType;
  status: AgencyRunStatus;
  pause_reason: AgencyPauseReason;
  created_at: string;
  updated_at: string;
  /** Mock timeline cursor — how many scripted beats have been applied. */
  mock_cursor: number;
  /** Wall-clock when the current segment started (for poll-based advancement). */
  segment_started_at: string;
  events: AgencyRunEvent[];
}

export interface AgencyRunPublic {
  id: string;
  business_id: string;
  filing_type: AgencyFilingType;
  status: AgencyRunStatus;
  pause_reason: AgencyPauseReason;
  created_at: string;
  updated_at: string;
  events: AgencyRunEvent[];
}
