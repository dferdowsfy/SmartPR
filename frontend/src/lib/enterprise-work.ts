// ============================================================================
// Enterprise work queue + evidence approval — Phase 2 helpers.
//
// Server-side (and test-safe: all DB access goes through an injected
// `Queryable`, so node:test suites can supply fakes).
//
//   - Work-status state machine + transition guards (completion requires
//     approved evidence OR an audited exception).
//   - Evidence enterprise-state machine (8 states).
//   - getObligationContext(): resolve workspace/business/facility/project
//     for an obligation (obligations/evidence carry no workspace_id).
//   - enforceSeparationOfDuties(): uploader != approver when the workspace
//     has separation_of_duties enabled (default true).
//   - recomputeMatterReadiness(): readiness from APPROVED evidence only;
//     reuses the legacy readiness formula (import route) with enterprise
//     signals mapped onto it.
// ============================================================================

import { getPool } from "../app/graph/db";
import type { Queryable } from "./enterprise-permissions";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WorkStatus =
  | "not_started"
  | "in_progress"
  | "blocked"
  | "evidence_submitted"
  | "under_review"
  | "changes_requested"
  | "approved"
  | "completed";

export const WORK_STATUSES: WorkStatus[] = [
  "not_started",
  "in_progress",
  "blocked",
  "evidence_submitted",
  "under_review",
  "changes_requested",
  "approved",
  "completed",
];

export type EvidenceEnterpriseState =
  | "draft"
  | "submitted_for_review"
  | "under_review"
  | "changes_requested"
  | "approved"
  | "rejected"
  | "superseded"
  | "expired";

export const EVIDENCE_STATES: EvidenceEnterpriseState[] = [
  "draft",
  "submitted_for_review",
  "under_review",
  "changes_requested",
  "approved",
  "rejected",
  "superseded",
  "expired",
];

export type Priority = "low" | "medium" | "high" | "critical";
export const PRIORITIES: Priority[] = ["low", "medium", "high", "critical"];

export interface TransitionCheckInput {
  /** At least one evidence row in enterprise_state='approved' is linked. */
  hasApprovedEvidence: boolean;
  /** The caller supplied an audited exception (requires manage_exceptions). */
  hasException: boolean;
}

export interface TransitionResult {
  ok: boolean;
  reason?: string;
}

export function isUuid(v: unknown): v is string {
  return (
    typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  );
}

// ---------------------------------------------------------------------------
// Work-status state machine
// ---------------------------------------------------------------------------

const WORK_TRANSITIONS: Record<WorkStatus, WorkStatus[]> = {
  not_started: ["in_progress", "blocked", "evidence_submitted", "completed"],
  in_progress: ["not_started", "blocked", "evidence_submitted", "completed"],
  blocked: ["not_started", "in_progress"],
  evidence_submitted: ["under_review", "in_progress"],
  under_review: ["changes_requested", "approved", "in_progress"],
  changes_requested: ["evidence_submitted", "in_progress"],
  approved: ["completed", "in_progress"],
  completed: ["in_progress"],
};

/**
 * Guard for obligation_work.work_status transitions.
 * - 'completed' requires approved evidence OR an audited exception.
 * - 'approved' requires approved evidence (exceptions bypass completion,
 *   not approval).
 */
export function canTransitionTo(
  current: WorkStatus,
  next: WorkStatus,
  input: TransitionCheckInput
): TransitionResult {
  if (current === next) return { ok: true };
  const allowed = WORK_TRANSITIONS[current] ?? [];
  if (!allowed.includes(next)) {
    return { ok: false, reason: `Cannot move work from "${current}" to "${next}".` };
  }
  if (next === "approved" && !input.hasApprovedEvidence) {
    return { ok: false, reason: "Approval requires approved evidence." };
  }
  if (next === "completed" && !input.hasApprovedEvidence && !input.hasException) {
    return {
      ok: false,
      reason:
        "Completion requires approved evidence or an audited exception (manage_exceptions).",
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Evidence enterprise-state machine
// ---------------------------------------------------------------------------

const EVIDENCE_TRANSITIONS: Record<EvidenceEnterpriseState, EvidenceEnterpriseState[]> = {
  draft: ["submitted_for_review"],
  submitted_for_review: ["under_review", "draft"],
  under_review: ["approved", "changes_requested", "rejected"],
  changes_requested: ["submitted_for_review", "draft"],
  rejected: ["draft"],
  approved: ["superseded", "expired"],
  superseded: [],
  expired: ["draft"],
};

export function canEvidenceTransitionTo(
  current: EvidenceEnterpriseState,
  next: EvidenceEnterpriseState
): TransitionResult {
  if (current === next) return { ok: true };
  const allowed = EVIDENCE_TRANSITIONS[current] ?? [];
  if (!allowed.includes(next)) {
    return { ok: false, reason: `Cannot move evidence from "${current}" to "${next}".` };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Obligation context resolution
// ---------------------------------------------------------------------------

export interface ObligationContext {
  obligationId: string;
  workspaceId: string;
  businessId: string;
  matterId: string | null;
  /** Earliest facility linked to the business (may be null). */
  facilityId: string | null;
  obligationName: string;
}

/**
 * Resolve the workspace/business/facility/project chain for an obligation.
 * obligations and evidence carry no workspace_id, so tenant scoping always
 * resolves via obligations -> businesses -> workspace_members.
 */
export async function getObligationContext(
  obligationId: string,
  pool: Queryable | null = getPool()
): Promise<ObligationContext | null> {
  if (!pool || !isUuid(obligationId)) return null;
  try {
    const { rows } = await pool.query(
      `SELECT o.id::text AS obligation_id, o.business_id::text AS business_id,
              b.workspace_id::text AS workspace_id, o.matter_id::text AS matter_id,
              o.name AS name
         FROM obligations o
         JOIN businesses b ON b.id = o.business_id
        WHERE o.id = $1::uuid
        LIMIT 1`,
      [obligationId]
    );
    const row = rows[0] as
      | {
          obligation_id: string;
          business_id: string;
          workspace_id: string;
          matter_id: string | null;
          name: string | null;
        }
      | undefined;
    if (!row || !row.workspace_id) return null;
    let facilityId: string | null = null;
    try {
      const f = await pool.query(
        `SELECT id::text AS id FROM facilities
          WHERE business_id = $1::uuid
          ORDER BY created_at ASC
          LIMIT 1`,
        [row.business_id]
      );
      const frow = f.rows[0] as { id?: unknown } | undefined;
      facilityId = typeof frow?.id === "string" ? frow.id : null;
    } catch {
      // facilities table missing: facility stays null.
    }
    return {
      obligationId: row.obligation_id,
      workspaceId: row.workspace_id,
      businessId: row.business_id,
      matterId: row.matter_id,
      facilityId,
      obligationName: row.name ?? "",
    };
  } catch {
    return null;
  }
}

/** True when the evidence row has at least one approved enterprise version. */
export async function evidenceIsApproved(
  evidenceId: string,
  pool: Queryable
): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::text AS n FROM evidence
      WHERE id = $1::uuid AND enterprise_state = 'approved'`,
    [evidenceId]
  );
  return Number((rows[0] as { n?: unknown } | undefined)?.n ?? 0) > 0;
}

/** True when ANY evidence linked to the obligation is in approved state. */
export async function obligationHasApprovedEvidence(
  obligationId: string,
  pool: Queryable
): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::text AS n FROM evidence
      WHERE obligation_id = $1::uuid AND enterprise_state = 'approved'`,
    [obligationId]
  );
  return Number((rows[0] as { n?: unknown } | undefined)?.n ?? 0) > 0;
}

/** Next immutable version number for an evidence row (max+1, or 1). */
export async function getNextVersionNumber(
  evidenceId: string,
  pool: Queryable
): Promise<number> {
  const { rows } = await pool.query(
    `SELECT MAX(version_number) AS n FROM evidence_versions WHERE evidence_id = $1::uuid`,
    [evidenceId]
  );
  return Number((rows[0] as { n?: unknown } | undefined)?.n ?? 0) + 1;
}

// ---------------------------------------------------------------------------
// Separation of duties
// ---------------------------------------------------------------------------

export class SeparationOfDutiesError extends Error {
  constructor(message = "Separation of duties: the uploader cannot approve their own evidence.") {
    super(message);
    this.name = "SeparationOfDutiesError";
  }
}

/**
 * Enforce separation of duties: when the workspace has
 * workspace_branding.terminology.separation_of_duties enabled (default true
 * for new workspaces), the reviewer of evidence must differ from the
 * uploader. Throws SeparationOfDutiesError on violation.
 */
export async function enforceSeparationOfDuties(
  pool: Queryable,
  workspaceId: string,
  uploaderUserId: string | null | undefined,
  reviewerUserId: string
): Promise<void> {
  let enabled = true;
  try {
    const { rows } = await pool.query(
      `SELECT COALESCE(terminology->>'separation_of_duties', 'true') AS v
         FROM workspace_branding WHERE workspace_id = $1::uuid LIMIT 1`,
      [workspaceId]
    );
    const raw = (rows[0] as { v?: unknown } | undefined)?.v;
    enabled = raw === null || raw === undefined ? true : String(raw).toLowerCase() !== "false";
  } catch {
    enabled = true; // fail closed on DB errors.
  }
  if (enabled && uploaderUserId && reviewerUserId === uploaderUserId) {
    throw new SeparationOfDutiesError();
  }
}

// ---------------------------------------------------------------------------
// Matter readiness — full credit from APPROVED evidence only
// ---------------------------------------------------------------------------

interface ReadinessRow {
  obligation_id: string;
  mandatory: boolean;
  obligation_status: string;
  work_status: WorkStatus | null;
  has_approved_evidence: boolean;
  has_pending_evidence: boolean;
  has_evidence: boolean;
}

const LEGACY_FULL = new Set(["CURRENT", "UPCOMING", "DUE_SOON", "COMPLETED"]);
const LEGACY_PARTIAL = new Set(["UNKNOWN", "NEEDS_ATTENTION", "IN_PROGRESS"]);
const ENTERPRISE_FULL = new Set<WorkStatus>(["completed", "approved"]);
const ENTERPRISE_PARTIAL = new Set<WorkStatus>([
  "evidence_submitted",
  "under_review",
  "changes_requested",
]);
const PENDING_EVIDENCE_STATES = ["submitted_for_review", "under_review", "changes_requested"];

function pointsFor(row: ReadinessRow): number {
  if (row.has_approved_evidence) return 1;
  if (row.work_status && ENTERPRISE_FULL.has(row.work_status)) return 1;
  if (row.has_pending_evidence) return 0.5; // progress, no full credit
  if (row.work_status && ENTERPRISE_PARTIAL.has(row.work_status)) return 0.5;
  if (row.work_status || row.has_evidence) return 0; // enterprise-tracked, nothing approved
  // Legacy rows (no enterprise tracking): reuse the original formula.
  if (LEGACY_FULL.has(row.obligation_status)) return 1;
  if (LEGACY_PARTIAL.has(row.obligation_status)) return 0.5;
  return 0;
}

export interface ReadinessResult {
  matterId: string;
  score: number;
  mandatoryCount: number;
  fullCount: number;
  partialCount: number;
}

/**
 * Recompute a matter's readiness score. Full credit requires approved
 * evidence (enterprise_state='approved') or a completed/approved work
 * record; submitted/under_review/changes_requested evidence shows progress
 * (half credit), never full credit. Reuses the legacy formula from the
 * business-import readiness computation: round(points / mandatory * 100).
 */
export async function recomputeMatterReadiness(
  matterId: string,
  pool: Queryable | null = getPool()
): Promise<ReadinessResult | null> {
  if (!pool || !isUuid(matterId)) return null;
  const { rows: rawRows } = await pool.query(
    `SELECT o.id::text AS obligation_id,
            COALESCE(o.mandatory, false) AS mandatory,
            COALESCE(o.status, '') AS obligation_status,
            w.work_status AS work_status,
            EXISTS (SELECT 1 FROM evidence e
                     WHERE e.obligation_id = o.id AND e.enterprise_state = 'approved')
              AS has_approved_evidence,
            EXISTS (SELECT 1 FROM evidence e
                     WHERE e.obligation_id = o.id
                       AND e.enterprise_state = ANY($2::text[]))
              AS has_pending_evidence,
            EXISTS (SELECT 1 FROM evidence e WHERE e.obligation_id = o.id)
              AS has_evidence
       FROM obligations o
       LEFT JOIN obligation_work w ON w.obligation_id = o.id
      WHERE o.matter_id = $1::uuid`,
    [matterId, PENDING_EVIDENCE_STATES]
  );
  const rows = rawRows as unknown as ReadinessRow[];
  const mandatory = rows.filter((r) => r.mandatory);
  let fullCount = 0;
  let partialCount = 0;
  let points = 0;
  for (const row of mandatory) {
    const p = pointsFor(row);
    points += p;
    if (p === 1) fullCount += 1;
    else if (p === 0.5) partialCount += 1;
  }
  const score = mandatory.length ? Math.round((points / mandatory.length) * 100) : 100;
  await pool.query(
    `UPDATE matters m SET readiness_score = $2,
        status = CASE WHEN $2 >= 90 THEN 'READY'
                     WHEN m.status = 'DRAFT' THEN 'IN_PROGRESS'
                     ELSE m.status END,
        updated_at = now()
      WHERE m.id = $1::uuid`,
    [matterId, score]
  );
  return { matterId, score, mandatoryCount: mandatory.length, fullCount, partialCount };
}

export type { Queryable };
