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

/** Input type for Assistant-panel pending fields (labels/types only — never values). */
export type AgencyPendingFieldType = "text" | "email" | "password" | "tel" | "number";

/**
 * A field the human must provide in the Assistant panel while the agent is paused.
 * Values are never stored on the run — only id/label/type/sensitivity metadata.
 */
export interface AgencyPendingField {
  id: string;
  label: string;
  type: AgencyPendingFieldType;
  sensitive: boolean;
  optional?: boolean;
  /** Format / validation hint shown under the Assistant input (never a secret). */
  hint?: string;
  /** Exact on-screen portal validation message (never a secret). Prefer over burying errors in hint. */
  error?: string;
}

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
  /** Cloud/worker run id (one agent turn) for the active SmartPR run. */
  browser_use_run_id: string | null;
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
  /** Consecutive pauses for the same reason (loop detection). */
  pause_streak: number;
  /** Pause reason of the previous pause cycle (for streak comparison). */
  prev_pause_reason: AgencyPauseReason;
  /**
   * Fields the human must fill in the Assistant panel (metadata only).
   * Cleared when pause clears or on successful resume that supplied values.
   */
  pending_fields: AgencyPendingField[];
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
  /** Which agent backend actually ran this run — shown in the UI so there is
   * never confusion between Cloud and self-hosted. */
  provider: "browser_use_cloud" | "self_hosted" | "mock";
  /** Consecutive pauses for the same reason — drives the escalated "still
   * blocked" messaging when the user is stuck in a pause loop. */
  pause_streak: number;
  /** Required fields for the Assistant panel (ids/labels/types only — never values). */
  pending_fields: AgencyPendingField[];
  /**
   * Owner-only passport snapshot for Assistant-panel prefill (non-sensitive mapping
   * happens client-side). Never contains field values the user typed in Assistant.
   */
  passport_snapshot: Record<string, unknown> | null;
}
