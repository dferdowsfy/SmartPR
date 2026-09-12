// Enterprise reminder + escalation worker.
//
// POST /api/enterprise/cron/reminders
// Body: { workspace_id?: string } — omit to sweep every workspace.
//
// Auth: header `x-cron-secret: $ENTERPRISE_CRON_SECRET` (set this env var
// when scheduling the job; the value is never logged or committed), OR a
// signed-in user with assign_requirements for the target workspace_id
// (the test-run button in the admin UI uses this path).
//
// Idempotency: reminder/escalation notifications encode a composite dedupe
// key in notifications.type (`ENT_REMINDER:…` / `ENT_ESCALATION:…`); any
// item whose key was written in the last 24h is skipped, so repeated runs
// never double-notify. Escalation also advances obligation_work
// escalation_state monotonically (none → owner_notified → facility_manager
// → compliance_manager → executive_flagged); steps already applied are
// never re-fired.
import { getPool } from "../../../../graph/db";
import {
  requireEnterprisePermission,
  writeAuditEvent,
  getRequestMeta,
} from "../../../../../lib/enterprise-permissions";
import {
  listDueItems,
  offsetsHitToday,
  daysBetween,
  todayISO,
  parseStepAfter,
  escalationStepsDue,
  escalationStateIndex,
  stateAfterStep,
  reminderDedupeKey,
  escalationDedupeKey,
  recentNotificationExists,
  insertNotification,
  getWorkspaceMemberEmails,
  getRoleHolderEmails,
  sendReminderEmail,
  withTransaction,
  type DueItem,
  type EscalationStep,
} from "../../../../../lib/enterprise-reminders";
import { isUuid } from "../../../../../lib/enterprise-work";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cronAuthorized(req: Request): boolean {
  const secret = process.env.ENTERPRISE_CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("x-cron-secret") === secret;
}

interface WorkInfo {
  ownerUserId: string | null;
  ownerEmail: string | null;
  escalationState: string;
  priority: string | null;
  workStatus: string | null;
  obligationName: string;
  businessId: string | null;
  businessName: string | null;
}

type Q = {
  query: (t: string, p?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
};

interface RunSummary {
  workspaces: number;
  reminders_sent: number;
  escalations_fired: number;
  skipped_dedupe: number;
  errors: string[];
}

export async function POST(req: Request) {
  const pool = getPool();
  if (!pool) return Response.json({ error: "Database unavailable." }, { status: 503 });

  let body: { workspace_id?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* empty body is fine */
  }

  const viaCron = cronAuthorized(req);
  if (!viaCron) {
    if (!body.workspace_id) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    const gate = await requireEnterprisePermission("assign_requirements", body.workspace_id);
    if ("response" in gate) return gate.response;
  }

  const meta = getRequestMeta(req);
  const today = todayISO("America/New_York");
  const summary: RunSummary = {
    workspaces: 0,
    reminders_sent: 0,
    escalations_fired: 0,
    skipped_dedupe: 0,
    errors: [],
  };

  let workspaceIds: string[];
  if (body.workspace_id) {
    if (!isUuid(body.workspace_id)) {
      return Response.json({ error: "workspace_id must be a UUID" }, { status: 400 });
    }
    workspaceIds = [body.workspace_id];
  } else {
    try {
      const { rows } = await pool.query(
        `SELECT id::text AS id FROM workspaces
          WHERE id IN (SELECT workspace_id FROM reminder_rules WHERE active = true
                       UNION SELECT workspace_id FROM escalation_policies WHERE active = true)`
      );
      workspaceIds = rows.map((r) => String(r.id));
    } catch (e) {
      return Response.json({ error: "failed to list workspaces", detail: (e as Error).message }, { status: 500 });
    }
  }

  for (const ws of workspaceIds) {
    summary.workspaces += 1;
    try {
      await runWorkspace(pool, ws, today, meta, summary);
    } catch (e) {
      summary.errors.push(`${ws}: ${(e as Error).message}`);
    }
  }

  return Response.json({ today, via_cron: viaCron, ...summary });
}

// ---------------------------------------------------------------------------

async function runWorkspace(
  pool: Q & { connect: () => Promise<{ query: Q["query"]; release: () => void }> },
  workspaceId: string,
  today: string,
  meta: { ip: string | null; userAgent: string | null; correlationId: string },
  summary: RunSummary
): Promise<void> {
  const { rows: ruleRows } = await pool.query(
    `SELECT id::text AS id, obligation_id::text AS obligation_id,
            offsets_days, channels, active
       FROM reminder_rules WHERE workspace_id = $1 AND active = true`,
    [workspaceId]
  );
  const { rows: policyRows } = await pool.query(
    `SELECT id::text AS id, trigger, steps, active
       FROM escalation_policies WHERE workspace_id = $1 AND active = true`,
    [workspaceId]
  );
  if (ruleRows.length === 0 && policyRows.length === 0) return;

  const items = await listDueItems(workspaceId, pool as Q);
  const workInfo = await loadWorkInfo(pool as Q, workspaceId);
  const members = await getWorkspaceMemberEmails(pool as Q, workspaceId);

  // --- Reminders -----------------------------------------------------------
  for (const rule of ruleRows) {
    const offsets = (rule.offsets_days as number[] | null) ?? [];
    const channels = (rule.channels as string[] | null) ?? ["in_app"];
    const ruleId = String(rule.id);
    const obligationId = rule.obligation_id ? String(rule.obligation_id) : null;

    const targets = obligationId
      ? items.filter((i) => i.obligationId === obligationId)
      : items;

    for (const item of targets) {
      const hits = offsetsHitToday(item.effectiveDueDate, offsets, today);
      for (const offset of hits) {
        const key = reminderDedupeKey(ruleId, item.itemKey, offset);
        if (await recentNotificationExists(pool as Q, workspaceId, key)) {
          summary.skipped_dedupe += 1;
          continue;
        }
        const info = item.obligationId ? workInfo.get(item.obligationId) : undefined;
        const recipients = resolveReminderRecipients(info ?? null, members);
        const message = reminderMessage(item, offset, today);
        for (const r of recipients) {
          await insertNotification(pool as Q, {
            userId: r.userId,
            workspaceId,
            businessId: item.businessId,
            obligationId: item.obligationId,
            type: key,
            channel: "IN_APP",
            message,
          });
          summary.reminders_sent += 1;
          if (channels.includes("email") && r.email) {
            await sendReminderEmail(r.email, reminderSubject(item, offset, today), [
              { label: "What", value: item.label },
              { label: "Kind", value: item.badge },
              { label: "Due", value: item.effectiveDueDate },
              { label: "Business", value: info?.businessName ?? "—" },
              ...(item.verified && item.sourceNote
                ? [{ label: "Verified against", value: item.sourceNote }]
                : []),
            ]);
          }
        }
      }
    }
  }

  // --- Escalations ---------------------------------------------------------
  for (const policy of policyRows) {
    const policyId = String(policy.id);
    const trigger = String(policy.trigger);
    const steps = (policy.steps as EscalationStep[] | null) ?? [];
    if (steps.length === 0) continue;

    const candidates = selectEscalationCandidates(items, workInfo, trigger, today);
    for (const { item, info, triggerAge } of candidates) {
      if (!item.obligationId) continue; // escalation needs an obligation_work row
      const due = escalationStepsDue(triggerAge, steps);
      const current = escalationStateIndex(info.escalationState);
      if (due <= current) continue;

      for (let stepIndex = current; stepIndex < due; stepIndex += 1) {
        const key = escalationDedupeKey(policyId, item.obligationId, stepIndex);
        if (await recentNotificationExists(pool as Q, workspaceId, key)) {
          summary.skipped_dedupe += 1;
          continue;
        }
        const step = orderedSteps(steps)[stepIndex];
        const newState = stateAfterStep(stepIndex);
        const recipients = await resolveEscalationRecipients(pool as Q, workspaceId, step.action, info, members);
        const message =
          `Escalated (${trigger}, step ${stepIndex + 1}): ${item.label} — ` +
          `${item.badge}, due ${item.effectiveDueDate}. Action: ${step.action}.`;

        await withTransaction(pool, async (client) => {
          await client.query(
            `INSERT INTO obligation_work (obligation_id, escalation_state)
             VALUES ($1, $2)
             ON CONFLICT (obligation_id)
             DO UPDATE SET escalation_state = EXCLUDED.escalation_state, updated_at = now()`,
            [item.obligationId, newState]
          );
          for (const r of recipients) {
            await insertNotification(client, {
              userId: r.userId,
              workspaceId,
              businessId: item.businessId,
              obligationId: item.obligationId,
              type: key,
              channel: "IN_APP",
              message,
            });
            if (r.email) {
              await sendReminderEmail(r.email, `Escalated: ${item.label}`, [
                { label: "What", value: item.label },
                { label: "Kind", value: item.badge },
                { label: "Due", value: item.effectiveDueDate },
                { label: "Trigger", value: trigger },
                { label: "Step", value: `${stepIndex + 1}: ${step.action}` },
                { label: "New state", value: newState },
              ]);
            }
          }
          await writeAuditEvent(client, {
            actorUserId: null,
            workspaceId,
            action: "enterprise.obligation.escalated",
            targetType: "obligation",
            targetId: item.obligationId,
            before: { escalation_state: info.escalationState },
            after: {
              escalation_state: newState,
              policy_id: policyId,
              trigger,
              step_index: stepIndex,
              step,
            },
            ip: meta.ip,
            userAgent: meta.userAgent,
            correlationId: meta.correlationId,
            source: "automation",
            reason: `escalation policy ${policyId} (${trigger})`,
          });
        });

        info.escalationState = newState;
        summary.escalations_fired += 1;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Candidate selection per trigger
// ---------------------------------------------------------------------------

interface Candidate {
  item: DueItem;
  info: WorkInfo;
  triggerAge: number;
}

function orderedSteps(steps: EscalationStep[]): EscalationStep[] {
  return [...steps].sort(
    (a, b) => (parseStepAfter(a.after) ?? Infinity) - (parseStepAfter(b.after) ?? Infinity)
  );
}

const OPEN_WORK = new Set([
  "not_started",
  "in_progress",
  "blocked",
  "evidence_submitted",
  "under_review",
  "changes_requested",
]);

function isOpen(item: DueItem, info: WorkInfo | undefined): boolean {
  if (!info) return item.kind === "schedule"; // no work row yet: treat as open
  return OPEN_WORK.has(info.workStatus ?? "");
}

/** Days the trigger condition has held. Date-based for overdue; 0 when not yet due. */
function triggerAgeDays(item: DueItem, today: string): number {
  const remaining = daysBetween(today, item.effectiveDueDate);
  return remaining < 0 ? -remaining : 0;
}

function selectEscalationCandidates(
  items: DueItem[],
  workInfo: Map<string, WorkInfo>,
  trigger: string,
  today: string
): Candidate[] {
  const out: Candidate[] = [];
  for (const item of items) {
    if (!item.obligationId) continue;
    const info = workInfo.get(item.obligationId);
    if (!info || !isOpen(item, info)) continue;
    if (trigger === "overdue") {
      const age = triggerAgeDays(item, today);
      if (age <= 0) continue;
      out.push({ item, info, triggerAge: age });
    } else if (trigger === "unassigned") {
      if (info.ownerUserId) continue;
      out.push({ item, info, triggerAge: triggerAgeDays(item, today) });
    } else if (trigger === "critical_unreviewed") {
      if (info.priority !== "critical") continue;
      if (info.workStatus === "approved" || info.workStatus === "completed") continue;
      out.push({ item, info, triggerAge: triggerAgeDays(item, today) });
    }
  }
  return out;
}

async function loadWorkInfo(pool: Q, workspaceId: string): Promise<Map<string, WorkInfo>> {
  const map = new Map<string, WorkInfo>();
  const { rows } = await pool.query(
    `SELECT o.id::text AS obligation_id,
            o.name AS obligation_name,
            o.business_id::text AS business_id,
            b.name AS business_name,
            ow.owner_user_id::text AS owner_user_id,
            u.email AS owner_email,
            COALESCE(ow.escalation_state, 'none') AS escalation_state,
            ow.priority AS priority,
            ow.work_status AS work_status
       FROM obligations o
       JOIN businesses b ON b.id = o.business_id
       LEFT JOIN obligation_work ow ON ow.obligation_id = o.id
       LEFT JOIN auth.users u ON u.id = ow.owner_user_id
      WHERE b.workspace_id = $1 AND o.status <> 'COMPLETED'`,
    [workspaceId]
  );
  for (const r of rows) {
    map.set(String(r.obligation_id), {
      ownerUserId: r.owner_user_id ? String(r.owner_user_id) : null,
      ownerEmail: typeof r.owner_email === "string" ? r.owner_email : null,
      escalationState: String(r.escalation_state ?? "none"),
      priority: typeof r.priority === "string" ? r.priority : null,
      workStatus: typeof r.work_status === "string" ? r.work_status : null,
      obligationName: typeof r.obligation_name === "string" ? r.obligation_name : "Requirement",
      businessId: r.business_id ? String(r.business_id) : null,
      businessName: typeof r.business_name === "string" ? r.business_name : null,
    });
  }
  return map;
}

// ---------------------------------------------------------------------------
// Recipients & messaging
// ---------------------------------------------------------------------------

interface Recipient {
  userId: string | null;
  email: string | null;
}

function resolveReminderRecipients(
  info: WorkInfo | null,
  members: Array<{ userId: string; email: string | null }>
): Recipient[] {
  if (info?.ownerUserId) {
    return [{ userId: info.ownerUserId, email: info.ownerEmail }];
  }
  return members.map((m) => ({ userId: m.userId, email: m.email }));
}

async function resolveEscalationRecipients(
  pool: Q,
  workspaceId: string,
  action: string,
  info: WorkInfo,
  members: Array<{ userId: string; email: string | null }>
): Promise<Recipient[]> {
  const byUser = new Map<string, Recipient>();
  const add = (r: Recipient) => {
    if (r.userId) byUser.set(r.userId, r);
  };
  // The owner always hears about their own escalation.
  if (info.ownerUserId) add({ userId: info.ownerUserId, email: info.ownerEmail });

  const roleFor: Record<string, string[]> = {
    escalate_facility_manager: ["facility_manager"],
    escalate_compliance_manager: ["compliance_manager"],
    flag_executive: ["compliance_executive"],
  };
  const roleKeys = roleFor[action];
  if (roleKeys) {
    const holders = await getRoleHolderEmails(pool, workspaceId, roleKeys);
    if (holders.length > 0) holders.forEach(add);
    else members.forEach((m) => add({ userId: m.userId, email: m.email }));
  } else {
    // notify_owner: owner (or everyone when unassigned)
    if (!info.ownerUserId) members.forEach((m) => add({ userId: m.userId, email: m.email }));
  }
  return [...byUser.values()];
}

function daysLabel(item: DueItem, today: string): string {
  const remaining = daysBetween(today, item.effectiveDueDate);
  if (remaining > 0) return `due in ${remaining} day${remaining === 1 ? "" : "s"}`;
  if (remaining === 0) return "due today";
  const n = -remaining;
  return `${n} day${n === 1 ? "" : "s"} overdue`;
}

function reminderSubject(item: DueItem, offset: number, today: string): string {
  const remaining = daysBetween(today, item.effectiveDueDate);
  const when = remaining >= 0 ? `due ${item.effectiveDueDate}` : `overdue since ${item.effectiveDueDate}`;
  return offset < 0
    ? `Overdue reminder: ${item.label} (${when})`
    : `Reminder: ${item.label} ${when}`;
}

function reminderMessage(item: DueItem, _offset: number, today: string): string {
  const kind =
    item.badge === "verified deadline"
      ? "Verified deadline"
      : "Internal target (not a verified regulatory deadline)";
  return `${item.label} — ${daysLabel(item, today)}. ${kind}. Effective due date: ${item.effectiveDueDate}.`;
}
