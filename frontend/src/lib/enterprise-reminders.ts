// ============================================================================
// Enterprise reminders, deadline schedules & escalation engine — Phase 4.
//
// Server-side library. PURE section (date math, offset/step evaluation,
// input validation) has no side effects and is fully unit-testable;
// the SERVER section below it needs a DB pool.
//
// INTEGRITY RULE (non-negotiable): SmartPR never invents regulatory
// deadlines. Only deadline_schedules rows with is_verified=true are
// presented as "verified deadline"; everything else — obligation_work
// internal_due_date rows and unverified schedules — is presented as
// "internal target" in every API response and UI surface.
// ============================================================================

import nodemailer from "nodemailer";
import type { Queryable } from "./enterprise-permissions";

// ---------------------------------------------------------------------------
// Date helpers (date-only, YYYY-MM-DD; pure)
// ---------------------------------------------------------------------------

/** Parse YYYY-MM-DD strictly; returns null when invalid. */
export function parseISODate(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/** Shift a YYYY-MM-DD date by whole days (UTC date arithmetic). */
export function addDaysISO(iso: string, days: number): string {
  const [y, mo, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  dt.setUTCDate(dt.getUTCDate() + Math.round(days));
  return dt.toISOString().slice(0, 10);
}

/** Whole days from `todayIso` to `targetIso` (target - today). Negative = past. */
export function daysBetween(todayIso: string, targetIso: string): number {
  const [ty, tm, td] = todayIso.split("-").map(Number);
  const [gy, gm, gd] = targetIso.split("-").map(Number);
  const a = Date.UTC(ty, tm - 1, td);
  const b = Date.UTC(gy, gm - 1, gd);
  return Math.round((b - a) / 86_400_000);
}

/** Today's date in a tz (default America/New_York) as YYYY-MM-DD. */
export function todayISO(tz = "America/New_York"): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

// ---------------------------------------------------------------------------
// Due items (pure)
// ---------------------------------------------------------------------------

export interface ScheduleRow {
  id: string;
  workspaceId: string;
  obligationId: string | null;
  businessId: string | null;
  label: string | null;
  dueDate: string; // YYYY-MM-DD
  graceDays: number;
  isVerified: boolean;
  sourceNote: string | null;
}

export interface WorkRow {
  obligationId: string;
  businessId: string;
  obligationName: string;
  internalDueDate: string | null; // YYYY-MM-DD
  workStatus: string;
  escalationState: string;
  priority: string | null;
  ownerUserId: string | null;
}

/** Work statuses that still count as "open" for reminder/escalation purposes. */
export const OPEN_WORK_STATUSES = new Set([
  "not_started",
  "in_progress",
  "blocked",
  "evidence_submitted",
  "under_review",
  "changes_requested",
]);

export type DueItemBadge = "verified deadline" | "internal target";

export interface DueItem {
  /** Stable key for dedupe: `schedule:<id>` or `work:<obligationId>`. */
  itemKey: string;
  kind: "schedule" | "internal";
  /** Schedule id, or obligation id for internal targets. */
  id: string;
  workspaceId: string;
  obligationId: string | null;
  businessId: string | null;
  label: string;
  /** Effective date after grace: due_date minus grace_days. */
  effectiveDueDate: string;
  verified: boolean;
  /** NEVER present an unverified date as regulatory — the badge is the label. */
  badge: DueItemBadge;
  sourceNote: string | null;
  escalationState: string;
  priority: string | null;
  ownerUserId: string | null;
  workStatus: string | null;
}

/** Effective due date = due_date shifted earlier by grace_days. */
export function computeEffectiveDueDate(dueDateISO: string, graceDays: number): string {
  const g = Math.max(0, Math.floor(graceDays || 0));
  return addDaysISO(dueDateISO, -g);
}

/**
 * Union of verified deadline_schedules (grace-adjusted) and
 * obligation_work.internal_due_date values for open items. Every item is
 * labeled "verified deadline" only when is_verified=true; everything else
 * is an "internal target".
 */
export function computeDueItems(
  schedules: ScheduleRow[],
  workRows: WorkRow[],
  workspaceId: string
): DueItem[] {
  const items: DueItem[] = [];

  for (const s of schedules) {
    const due = parseISODate(s.dueDate);
    if (!due) continue;
    items.push({
      itemKey: `schedule:${s.id}`,
      kind: "schedule",
      id: s.id,
      workspaceId,
      obligationId: s.obligationId,
      businessId: s.businessId,
      label: s.label || "Deadline",
      effectiveDueDate: computeEffectiveDueDate(due, s.graceDays),
      verified: s.isVerified,
      badge: s.isVerified ? "verified deadline" : "internal target",
      sourceNote: s.sourceNote,
      escalationState: "none",
      priority: null,
      ownerUserId: null,
      workStatus: null,
    });
  }

  for (const w of workRows) {
    if (!w.internalDueDate) continue;
    if (!OPEN_WORK_STATUSES.has(w.workStatus)) continue;
    const due = parseISODate(w.internalDueDate);
    if (!due) continue;
    // Skip when the same obligation already has a schedule row — the
    // schedule (verified or not) is the canonical entry.
    if (schedules.some((s) => s.obligationId === w.obligationId)) continue;
    items.push({
      itemKey: `work:${w.obligationId}`,
      kind: "internal",
      id: w.obligationId,
      workspaceId,
      obligationId: w.obligationId,
      businessId: w.businessId,
      label: w.obligationName || "Internal due date",
      effectiveDueDate: due,
      verified: false,
      badge: "internal target",
      sourceNote: null,
      escalationState: w.escalationState || "none",
      priority: w.priority,
      ownerUserId: w.ownerUserId,
      workStatus: w.workStatus,
    });
  }

  items.sort((a, b) => a.effectiveDueDate.localeCompare(b.effectiveDueDate));
  return items;
}

// ---------------------------------------------------------------------------
// Reminder schedule evaluation (pure)
// ---------------------------------------------------------------------------

/** Default offsets (days before the effective due date). 0 = due today. */
export const DEFAULT_REMINDER_OFFSETS = [90, 60, 30, 7, 0];

/** Channels the worker can deliver on. */
export const REMINDER_CHANNELS = ["in_app", "email"] as const;
export type ReminderChannel = (typeof REMINDER_CHANNELS)[number];

/**
 * Which offsets fire today: exact-day match on
 * `effectiveDueDate - today`. Positive offsets are days-before reminders;
 * 0 is due-today; negative offsets (e.g. -1, -7) are N-days-overdue
 * nudges. No fuzzy ranges — deterministic, idempotent per day.
 */
export function offsetsHitToday(
  effectiveDueDate: string,
  offsets: number[],
  today: string
): number[] {
  const remaining = daysBetween(today, effectiveDueDate);
  return offsets.filter((o) => o === remaining);
}

// ---------------------------------------------------------------------------
// Escalation (pure)
// ---------------------------------------------------------------------------

export interface EscalationStep {
  /** Duration after the trigger when this step fires, e.g. "1d", "12h", "2w". */
  after: string;
  /** One of ESCALATION_ACTIONS. */
  action: string;
}

export const ESCALATION_ACTIONS = [
  "notify_owner",
  "escalate_facility_manager",
  "escalate_compliance_manager",
  "flag_executive",
] as const;
export type EscalationAction = (typeof ESCALATION_ACTIONS)[number];

/** Escalation states in order; index 0 = no escalation yet. */
export const ESCALATION_STATES = [
  "none",
  "owner_notified",
  "facility_manager",
  "compliance_manager",
  "executive_flagged",
] as const;

/** Escalation triggers supported by escalation_policies.trigger. */
export const ESCALATION_TRIGGERS = ["overdue", "unassigned", "critical_unreviewed"] as const;

/** Parse "1d" / "12h" / "2w" into days. Returns null when unparseable. */
export function parseStepAfter(after: string): number | null {
  if (typeof after !== "string") return null;
  const m = /^\s*(\d+(?:\.\d+)?)\s*([dhw])\s*$/i.exec(after);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 0) return null;
  const unit = m[2].toLowerCase();
  return unit === "h" ? n / 24 : unit === "w" ? n * 7 : n;
}

/**
 * How many ordered steps are due given `daysOverdue` since the trigger.
 * Steps sort by their `after` duration ascending; a step fires when its
 * duration has fully elapsed.
 */
export function escalationStepsDue(daysOverdue: number, steps: EscalationStep[]): number {
  const sorted = steps
    .map((s) => ({ step: s, days: parseStepAfter(s.after) }))
    .filter((s): s is { step: EscalationStep; days: number } => s.days !== null)
    .sort((a, b) => a.days - b.days);
  let due = 0;
  for (const s of sorted) {
    if (daysOverdue >= s.days) due += 1;
    else break;
  }
  return due;
}

/** Escalation state after firing step `stepIndex` (0-based). */
export function stateAfterStep(stepIndex: number): string {
  const next = stepIndex + 1;
  return ESCALATION_STATES[Math.min(next, ESCALATION_STATES.length - 1)];
}

/** Index of a stored escalation_state in the state chain (unknown -> 0). */
export function escalationStateIndex(state: string | null | undefined): number {
  const i = (ESCALATION_STATES as readonly string[]).indexOf(state ?? "none");
  return i >= 0 ? i : 0;
}

// ---------------------------------------------------------------------------
// Dedupe keys (pure)
//
// The notifications table has no metadata column, so idempotency keys are
// encoded in the `type` column as a composite key:
//   ENT_REMINDER:<ruleId>:<itemKey>:<offset>
//   ENT_ESCALATION:<policyId>:<obligationId>:<stepIndex>
// The worker skips any item whose key exists in the last 24h, making
// repeated cron runs idempotent.
// ---------------------------------------------------------------------------

export function reminderDedupeKey(ruleId: string, itemKey: string, offsetDays: number): string {
  return `ENT_REMINDER:${ruleId}:${itemKey}:${offsetDays}`;
}

export function escalationDedupeKey(
  policyId: string,
  obligationId: string,
  stepIndex: number
): string {
  return `ENT_ESCALATION:${policyId}:${obligationId}:${stepIndex}`;
}

// ---------------------------------------------------------------------------
// Input validation (pure)
// ---------------------------------------------------------------------------

export interface ValidationResult<T> {
  ok: boolean;
  errors: string[];
  value: T | null;
}

function isUuid(v: unknown): v is string {
  return (
    typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  );
}

export interface ReminderRuleInput {
  obligation_id: string | null;
  offsets_days: number[];
  channels: string[];
  active: boolean;
}

export function validateReminderRuleInput(body: unknown): ValidationResult<ReminderRuleInput> {
  const errors: string[] = [];
  const b = (body ?? {}) as Record<string, unknown>;

  let obligationId: string | null = null;
  if (b.obligation_id !== undefined && b.obligation_id !== null) {
    if (!isUuid(b.obligation_id)) errors.push("obligation_id must be a UUID.");
    else obligationId = b.obligation_id;
  }

  let offsets = [...DEFAULT_REMINDER_OFFSETS];
  if (b.offsets_days !== undefined) {
    if (
      !Array.isArray(b.offsets_days) ||
      b.offsets_days.length === 0 ||
      !b.offsets_days.every((o) => Number.isInteger(o) && (o as number) >= -365 && (o as number) <= 365)
    ) {
      errors.push("offsets_days must be a non-empty array of integers between -365 and 365.");
    } else {
      offsets = [...new Set(b.offsets_days as number[])].sort((a, b2) => b2 - a);
    }
  }

  let channels: string[] = ["in_app"];
  if (b.channels !== undefined) {
    if (
      !Array.isArray(b.channels) ||
      b.channels.length === 0 ||
      !b.channels.every((c) => typeof c === "string" && (REMINDER_CHANNELS as readonly string[]).includes(c))
    ) {
      errors.push(`channels must be a non-empty array of: ${REMINDER_CHANNELS.join(", ")}.`);
    } else {
      channels = [...new Set(b.channels as string[])];
    }
  }

  let active = true;
  if (b.active !== undefined) {
    if (typeof b.active !== "boolean") errors.push("active must be a boolean.");
    else active = b.active;
  }

  return {
    ok: errors.length === 0,
    errors,
    value: errors.length ? null : { obligation_id: obligationId, offsets_days: offsets, channels, active },
  };
}

export interface EscalationPolicyInput {
  trigger: string;
  steps: EscalationStep[];
  active: boolean;
}

export function validateEscalationPolicyInput(body: unknown): ValidationResult<EscalationPolicyInput> {
  const errors: string[] = [];
  const b = (body ?? {}) as Record<string, unknown>;

  const trigger = b.trigger;
  if (typeof trigger !== "string" || !(ESCALATION_TRIGGERS as readonly string[]).includes(trigger)) {
    errors.push(`trigger must be one of: ${ESCALATION_TRIGGERS.join(", ")}.`);
  }

  const steps: EscalationStep[] = [];
  if (!Array.isArray(b.steps) || b.steps.length === 0) {
    errors.push("steps must be a non-empty ordered array of {after, action}.");
  } else if (b.steps.length > 8) {
    errors.push("steps supports at most 8 ordered steps.");
  } else {
    let prevDays = -1;
    b.steps.forEach((raw, i) => {
      const s = (raw ?? {}) as Record<string, unknown>;
      const days = parseStepAfter(s.after as string);
      if (days === null || days > 365) {
        errors.push(`steps[${i}].after must be like "1d", "12h" or "2w" (max 365d).`);
        return;
      }
      if (days <= prevDays) errors.push(`steps[${i}].after must be strictly increasing.`);
      prevDays = days;
      if (typeof s.action !== "string" || !(ESCALATION_ACTIONS as readonly string[]).includes(s.action)) {
        errors.push(`steps[${i}].action must be one of: ${ESCALATION_ACTIONS.join(", ")}.`);
        return;
      }
      steps.push({ after: s.after as string, action: s.action as string });
    });
  }

  let active = true;
  if (b.active !== undefined) {
    if (typeof b.active !== "boolean") errors.push("active must be a boolean.");
    else active = b.active;
  }

  return {
    ok: errors.length === 0,
    errors,
    value: errors.length ? null : { trigger: trigger as string, steps, active },
  };
}

export interface DeadlineScheduleInput {
  obligation_id: string | null;
  schedule_type: string;
  due_date: string;
  recurrence_rule: string | null;
  grace_days: number;
  is_verified: boolean;
  label: string | null;
  source_note: string | null;
}

const SCHEDULE_TYPES = ["one_time", "recurring", "expiration"] as const;

export function validateDeadlineScheduleInput(body: unknown): ValidationResult<DeadlineScheduleInput> {
  const errors: string[] = [];
  const b = (body ?? {}) as Record<string, unknown>;

  let obligationId: string | null = null;
  if (b.obligation_id !== undefined && b.obligation_id !== null) {
    if (!isUuid(b.obligation_id)) errors.push("obligation_id must be a UUID.");
    else obligationId = b.obligation_id;
  }

  const scheduleType = b.schedule_type;
  if (typeof scheduleType !== "string" || !(SCHEDULE_TYPES as readonly string[]).includes(scheduleType)) {
    errors.push(`schedule_type must be one of: ${SCHEDULE_TYPES.join(", ")}.`);
  }

  const dueDate = parseISODate(b.due_date);
  if (!dueDate) errors.push("due_date is required and must be YYYY-MM-DD.");

  let recurrenceRule: string | null = null;
  if (b.recurrence_rule !== undefined && b.recurrence_rule !== null) {
    if (typeof b.recurrence_rule !== "string" || b.recurrence_rule.length > 200) {
      errors.push("recurrence_rule must be a string up to 200 characters.");
    } else recurrenceRule = b.recurrence_rule;
  }

  let graceDays = 0;
  if (b.grace_days !== undefined) {
    if (!Number.isInteger(b.grace_days) || (b.grace_days as number) < 0 || (b.grace_days as number) > 365) {
      errors.push("grace_days must be an integer between 0 and 365.");
    } else graceDays = b.grace_days as number;
  }

  let isVerified = false;
  if (b.is_verified !== undefined) {
    if (typeof b.is_verified !== "boolean") errors.push("is_verified must be a boolean.");
    else isVerified = b.is_verified;
  }

  let label: string | null = null;
  if (b.label !== undefined && b.label !== null) {
    if (typeof b.label !== "string" || b.label.length > 200) {
      errors.push("label must be a string up to 200 characters.");
    } else label = b.label;
  }

  let sourceNote: string | null = null;
  if (b.source_note !== undefined && b.source_note !== null) {
    if (typeof b.source_note !== "string" || b.source_note.length > 500) {
      errors.push("source_note must be a string up to 500 characters.");
    } else sourceNote = b.source_note;
  }

  // A schedule can only be marked verified when the caller states the
  // authoritative source it was verified against. The route additionally
  // requires the approve_evidence permission for is_verified=true.
  if (isVerified && (!sourceNote || sourceNote.trim().length === 0)) {
    errors.push("source_note is required when is_verified is true (state the authoritative source).");
  }

  return {
    ok: errors.length === 0,
    errors,
    value: errors.length
      ? null
      : {
          obligation_id: obligationId,
          schedule_type: scheduleType as string,
          due_date: dueDate as string,
          recurrence_rule: recurrenceRule,
          grace_days: graceDays,
          is_verified: isVerified,
          label,
          source_note: sourceNote,
        },
  };
}

// ---------------------------------------------------------------------------
// SERVER section — DB + email (never import from client components)
// ---------------------------------------------------------------------------

/** Run fn inside a Postgres transaction; rolls back on any error. */
export async function withTransaction<T>(
  pool: Queryable & { connect: () => Promise<{ query: Queryable["query"]; release: () => void }> },
  fn: (client: Queryable) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* already broken */
    }
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Obligation ids in a workspace whose escalation_state is not 'none'.
 * Other phases (e.g. the Phase 2 work queue) import this to flag escalated
 * rows without touching obligation_work themselves.
 */
export async function getEscalatedObligationIds(
  workspaceId: string,
  pool: Queryable
): Promise<string[]> {
  try {
    const { rows } = await pool.query(
      `SELECT ow.obligation_id::text AS obligation_id
         FROM obligation_work ow
         JOIN obligations o ON o.id = ow.obligation_id
         JOIN businesses b ON b.id = o.business_id
        WHERE b.workspace_id = $1 AND ow.escalation_state <> 'none'`,
      [workspaceId]
    );
    return rows.map((r) => String(r.obligation_id)).filter(Boolean);
  } catch {
    return [];
  }
}

interface ScheduleRowDb {
  id: string;
  obligation_id: string | null;
  business_id: string | null;
  label: string | null;
  due_date: string | null;
  grace_days: number;
  is_verified: boolean;
  source_note: string | null;
}

interface WorkRowDb {
  obligation_id: string;
  business_id: string;
  obligation_name: string;
  internal_due_date: string | null;
  work_status: string;
  escalation_state: string;
  priority: string | null;
  owner_user_id: string | null;
}

/** Load every due item for a workspace (DB -> computeDueItems). */
export async function listDueItems(workspaceId: string, pool: Queryable): Promise<DueItem[]> {
  const { rows: sRows } = await pool.query(
    `SELECT id::text AS id,
            obligation_id::text AS obligation_id,
            (SELECT o.business_id::text FROM obligations o WHERE o.id = ds.obligation_id) AS business_id,
            label,
            due_date::text AS due_date,
            COALESCE(grace_days, 0) AS grace_days,
            is_verified,
            source_note
       FROM deadline_schedules ds
      WHERE workspace_id = $1`,
    [workspaceId]
  );
  const { rows: wRows } = await pool.query(
    `SELECT ow.obligation_id::text AS obligation_id,
            o.business_id::text AS business_id,
            o.name AS obligation_name,
            ow.internal_due_date::text AS internal_due_date,
            ow.work_status,
            ow.escalation_state,
            ow.priority,
            ow.owner_user_id::text AS owner_user_id
       FROM obligation_work ow
       JOIN obligations o ON o.id = ow.obligation_id
       JOIN businesses b ON b.id = o.business_id
      WHERE b.workspace_id = $1 AND o.status <> 'COMPLETED'`,
    [workspaceId]
  );

  const schedules: ScheduleRow[] = (sRows as unknown as ScheduleRowDb[])
    .filter((r) => r.due_date)
    .map((r) => ({
      id: r.id,
      workspaceId,
      obligationId: r.obligation_id,
      businessId: r.business_id,
      label: r.label,
      dueDate: r.due_date as string,
      graceDays: Number(r.grace_days) || 0,
      isVerified: Boolean(r.is_verified),
      sourceNote: r.source_note,
    }));

  const work: WorkRow[] = (wRows as unknown as WorkRowDb[]).map((r) => ({
    obligationId: r.obligation_id,
    businessId: r.business_id,
    obligationName: r.obligation_name || "Requirement",
    internalDueDate: r.internal_due_date,
    workStatus: r.work_status,
    escalationState: r.escalation_state,
    priority: r.priority,
    ownerUserId: r.owner_user_id,
  }));

  return computeDueItems(schedules, work, workspaceId);
}

/** True when a notification with this dedupe key exists in the last 24h. */
export async function recentNotificationExists(
  pool: Queryable,
  workspaceId: string,
  typeKey: string
): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM notifications
      WHERE workspace_id = $1 AND type = $2
        AND created_at >= now() - interval '24 hours'
      LIMIT 1`,
    [workspaceId, typeKey]
  );
  return rows.length > 0;
}

export interface NewNotification {
  userId: string | null;
  workspaceId: string;
  businessId: string | null;
  obligationId: string | null;
  type: string;
  channel: string;
  message: string;
}

/** Insert an in-app notification row (the same table NotificationBell reads). */
export async function insertNotification(
  db: Queryable,
  n: NewNotification
): Promise<string | null> {
  const { rows } = await db.query(
    `INSERT INTO notifications
       (user_id, workspace_id, business_id, obligation_id, type, channel,
        scheduled_for, status, message)
     VALUES ($1,$2,$3,$4,$5,$6, now(), 'PENDING', $7)
     RETURNING id::text AS id`,
    [n.userId, n.workspaceId, n.businessId, n.obligationId, n.type, n.channel, n.message]
  );
  const id = rows[0]?.id;
  return typeof id === "string" ? id : null;
}

/** Workspace member user ids + emails (via auth.users; service-role pool). */
export async function getWorkspaceMemberEmails(
  pool: Queryable,
  workspaceId: string
): Promise<Array<{ userId: string; email: string | null }>> {
  try {
    const { rows } = await pool.query(
      `SELECT wm.user_id::text AS user_id, u.email AS email
         FROM workspace_members wm
         LEFT JOIN auth.users u ON u.id = wm.user_id
        WHERE wm.workspace_id = $1`,
      [workspaceId]
    );
    return rows.map((r) => ({
      userId: String(r.user_id),
      email: typeof r.email === "string" ? r.email : null,
    }));
  } catch {
    return [];
  }
}

/**
 * Emails of users holding any of the given enterprise role keys (org scope)
 * in the workspace. Falls back to legacy workspace roles when the
 * enterprise role tables are absent: facility_manager -> ADMIN,
 * compliance_manager -> ADMIN, compliance_executive -> OWNER, owner -> OWNER.
 */
export async function getRoleHolderEmails(
  pool: Queryable,
  workspaceId: string,
  roleKeys: string[]
): Promise<Array<{ userId: string; email: string | null }>> {
  const legacyFor: Record<string, string[]> = {
    facility_manager: ["ADMIN", "OWNER"],
    compliance_manager: ["ADMIN", "OWNER"],
    compliance_executive: ["OWNER"],
    owner: ["OWNER"],
  };
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT ra.user_id::text AS user_id, u.email AS email
         FROM role_assignments ra
         JOIN enterprise_roles er ON er.id = ra.enterprise_role_id
         LEFT JOIN auth.users u ON u.id = ra.user_id
        WHERE ra.workspace_id = $1 AND er.key = ANY($2::text[])`,
      [workspaceId, roleKeys]
    );
    if (rows.length > 0) {
      return rows.map((r) => ({
        userId: String(r.user_id),
        email: typeof r.email === "string" ? r.email : null,
      }));
    }
  } catch {
    // enterprise tables missing: fall through to legacy roles
  }
  const legacyRoles = [...new Set(roleKeys.flatMap((k) => legacyFor[k] ?? []))];
  if (legacyRoles.length === 0) return [];
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT wm.user_id::text AS user_id, u.email AS email
         FROM workspace_members wm
         LEFT JOIN auth.users u ON u.id = wm.user_id
        WHERE wm.workspace_id = $1 AND wm.role = ANY($2::text[])`,
      [workspaceId, legacyRoles]
    );
    return rows.map((r) => ({
      userId: String(r.user_id),
      email: typeof r.email === "string" ? r.email : null,
    }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Email — reuses the existing Gmail SMTP infra (same transport config and
// env vars as src/lib/leads.ts: GMAIL_SMTP_USER / GMAIL_SMTP_APP_PASSWORD /
// GMAIL_FROM). Never throws: logs and skips on misconfiguration/failure.
// ---------------------------------------------------------------------------

const SMTP_USER = process.env.GMAIL_SMTP_USER || "darius@getsmartpr.com";
const MAIL_FROM = process.env.GMAIL_FROM || "SmartPR <darius@getsmartpr.com>";

let mailerOverride: { sendMail: (opts: Record<string, unknown>) => Promise<unknown> } | null = null;
/** Test seam (mirrors the one in src/lib/leads.ts). */
export function setReminderMailerForTests(
  mailer: { sendMail: (opts: Record<string, unknown>) => Promise<unknown> } | null
): void {
  mailerOverride = mailer;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

/** Send one reminder/escalation email. `to` is a single address; never throws. */
export async function sendReminderEmail(
  to: string,
  subject: string,
  lines: Array<{ label: string; value: string }>
): Promise<boolean> {
  if (!to || !to.includes("@")) return false;
  if (!process.env.GMAIL_SMTP_APP_PASSWORD && !mailerOverride) {
    console.error("[enterprise-reminders] email skipped: GMAIL_SMTP_APP_PASSWORD is not set");
    return false;
  }
  const text = [`SmartPR — ${subject}`, "", ...lines.map((l) => `${l.label}: ${l.value}`)].join("\n");
  const rows = lines
    .map(
      (l) =>
        `<tr><td style="padding:8px 12px;color:#5b6b7b;font-size:13px;width:38%;">${escapeHtml(l.label)}</td>` +
        `<td style="padding:8px 12px;color:#12212f;font-size:13px;">${escapeHtml(l.value)}</td></tr>`
    )
    .join("");
  const html =
    `<!DOCTYPE html><html><body style="margin:0;background:#f2f5f7;">` +
    `<div style="max-width:560px;margin:0 auto;padding:24px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">` +
    `<div style="background:#0f2a43;border-radius:12px 12px 0 0;padding:20px 24px;">` +
    `<div style="color:#fff;font-size:20px;font-weight:700;">SmartPR</div>` +
    `<div style="color:#9fb4c7;font-size:14px;margin-top:2px;">${escapeHtml(subject)}</div></div>` +
    `<div style="background:#fff;border-radius:0 0 12px 12px;padding:8px 12px 16px;">` +
    `<table role="presentation" style="width:100%;border-collapse:collapse;">${rows}</table></div>` +
    `</div></body></html>`;
  try {
    const mailer =
      mailerOverride ??
      nodemailer.createTransport({
        host: "smtp.gmail.com",
        port: 465,
        secure: true,
        auth: { user: SMTP_USER, pass: process.env.GMAIL_SMTP_APP_PASSWORD || "" },
      });
    await mailer.sendMail({ from: MAIL_FROM, to, subject: `[SmartPR] ${subject}`, text, html });
    return true;
  } catch (err) {
    console.error(`[enterprise-reminders] email delivery failed: ${(err as Error)?.message || err}`);
    return false;
  }
}
