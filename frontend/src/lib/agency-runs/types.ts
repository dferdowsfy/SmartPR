/** Agency assistant run types — mock worker or Browser Use Cloud. */

export type AgencyFilingType =
  | "SURI_REGISTER_TAXPAYER"
  | "SURI_MERCHANT_REGISTRATION"
  | "DEPT_STATE_CORPORATE_FILING"
  | "OGPE_PERMISO_UNICO";

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

export type AgencyWorkerKind = "mock" | "browser_use";

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
  /** Which worker backs this run. */
  worker: AgencyWorkerKind;
  /** Browser Use Cloud session id (server-side; also returned for owner polling). */
  browser_use_session_id: string | null;
  /** Live preview URL from Browser Use (session-scoped; owner-only). */
  live_url: string | null;
  /** Authenticated owner when create ran under auth (gates live_url). */
  owner_user_id: string | null;
  /** Last synced Browser Use message id (cursor). */
  bu_message_cursor: string | null;
  /** Last lastStepSummary we already emitted as an event. */
  bu_last_step: string | null;
  /** Passport snapshot used for the task prompt (not returned publicly). */
  passport_snapshot: Record<string, unknown> | null;
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
  worker: AgencyWorkerKind;
  /** Present when Browser Use Cloud backs the run; embed in iframe. */
  live_url: string | null;
  browser_use_session_id: string | null;
}
