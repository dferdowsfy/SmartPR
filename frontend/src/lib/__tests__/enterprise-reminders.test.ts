// Unit tests for the Phase 4 reminders/escalation engine (pure helpers).
// Run with: npx tsx --test src/lib/__tests__/enterprise-reminders.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  parseISODate,
  addDaysISO,
  daysBetween,
  computeEffectiveDueDate,
  computeDueItems,
  offsetsHitToday,
  DEFAULT_REMINDER_OFFSETS,
  parseStepAfter,
  escalationStepsDue,
  stateAfterStep,
  escalationStateIndex,
  ESCALATION_STATES,
  reminderDedupeKey,
  escalationDedupeKey,
  validateReminderRuleInput,
  validateEscalationPolicyInput,
  validateDeadlineScheduleInput,
  type ScheduleRow,
  type WorkRow,
} from "../enterprise-reminders";

// ---------------------------------------------------------------------------
// Date math
// ---------------------------------------------------------------------------

test("parseISODate accepts valid dates and rejects junk", () => {
  assert.equal(parseISODate("2026-09-12"), "2026-09-12");
  assert.equal(parseISODate("2026-02-30"), null); // not a real date
  assert.equal(parseISODate("09/12/2026"), null);
  assert.equal(parseISODate(""), null);
  assert.equal(parseISODate(null), null);
});

test("addDaysISO crosses month boundaries", () => {
  assert.equal(addDaysISO("2026-09-12", -7), "2026-09-05");
  assert.equal(addDaysISO("2026-09-01", -1), "2026-08-31");
  assert.equal(addDaysISO("2026-12-31", 1), "2027-01-01");
});

test("daysBetween is signed and symmetric", () => {
  assert.equal(daysBetween("2026-09-12", "2026-09-19"), 7);
  assert.equal(daysBetween("2026-09-12", "2026-09-12"), 0);
  assert.equal(daysBetween("2026-09-12", "2026-09-05"), -7);
});

test("grace days shift the effective due date earlier", () => {
  assert.equal(computeEffectiveDueDate("2026-09-30", 7), "2026-09-23");
  assert.equal(computeEffectiveDueDate("2026-09-30", 0), "2026-09-30");
  assert.equal(computeEffectiveDueDate("2026-09-30", -5), "2026-09-30"); // clamped
});

// ---------------------------------------------------------------------------
// Due items + verified/internal-target labeling
// ---------------------------------------------------------------------------

function sched(partial: Partial<ScheduleRow> = {}): ScheduleRow {
  return {
    id: "sched-1",
    workspaceId: "ws",
    obligationId: "obl-1",
    businessId: "biz-1",
    label: "Informe Anual",
    dueDate: "2026-09-30",
    graceDays: 0,
    isVerified: false,
    sourceNote: null,
    ...partial,
  };
}

function work(partial: Partial<WorkRow> = {}): WorkRow {
  return {
    obligationId: "obl-2",
    businessId: "biz-1",
    obligationName: "Patente municipal",
    internalDueDate: "2026-10-15",
    workStatus: "in_progress",
    escalationState: "none",
    priority: "high",
    ownerUserId: "user-1",
    ...partial,
  };
}

test("unverified schedules are labeled 'internal target', never presented as regulatory", () => {
  const items = computeDueItems([sched()], [], "ws");
  assert.equal(items.length, 1);
  assert.equal(items[0].badge, "internal target");
  assert.equal(items[0].verified, false);
});

test("verified schedules are labeled 'verified deadline'", () => {
  const items = computeDueItems([sched({ isVerified: true, sourceNote: "OGPe portal" })], [], "ws");
  assert.equal(items[0].badge, "verified deadline");
  assert.equal(items[0].verified, true);
  assert.equal(items[0].sourceNote, "OGPe portal");
});

test("grace days are subtracted from schedule due dates", () => {
  const items = computeDueItems([sched({ graceDays: 10 })], [], "ws");
  assert.equal(items[0].effectiveDueDate, "2026-09-20");
});

test("obligation_work internal dates surface as internal targets", () => {
  const items = computeDueItems([], [work()], "ws");
  assert.equal(items.length, 1);
  assert.equal(items[0].badge, "internal target");
  assert.equal(items[0].itemKey, "work:obl-2");
  assert.equal(items[0].escalationState, "none");
});

test("completed/approved work rows are excluded", () => {
  assert.equal(computeDueItems([], [work({ workStatus: "completed" })], "ws").length, 0);
  assert.equal(computeDueItems([], [work({ workStatus: "approved" })], "ws").length, 0);
  assert.equal(computeDueItems([], [work({ workStatus: "blocked" })], "ws").length, 1);
});

test("a schedule row wins over an internal target for the same obligation", () => {
  const items = computeDueItems([sched({ obligationId: "obl-2" })], [work()], "ws");
  assert.equal(items.length, 1);
  assert.equal(items[0].itemKey, "schedule:sched-1");
});

test("items are sorted by effective due date", () => {
  const items = computeDueItems(
    [sched({ id: "late", dueDate: "2026-12-01" }), sched({ id: "early", dueDate: "2026-09-20" })],
    [],
    "ws"
  );
  assert.deepEqual(items.map((i) => i.id), ["early", "late"]);
});

// ---------------------------------------------------------------------------
// Reminder offsets
// ---------------------------------------------------------------------------

test("offsets fire on exact day matches only", () => {
  // due 2026-09-30; today 2026-08-01 => 60 days out
  assert.deepEqual(offsetsHitToday("2026-09-30", DEFAULT_REMINDER_OFFSETS, "2026-08-01"), [60]);
  assert.deepEqual(offsetsHitToday("2026-09-30", DEFAULT_REMINDER_OFFSETS, "2026-09-30"), [0]);
  assert.deepEqual(offsetsHitToday("2026-09-30", DEFAULT_REMINDER_OFFSETS, "2026-09-23"), [7]);
  assert.deepEqual(offsetsHitToday("2026-09-30", DEFAULT_REMINDER_OFFSETS, "2026-09-12"), []);
});

test("negative offsets cover overdue nudges", () => {
  assert.deepEqual(offsetsHitToday("2026-09-01", [-1, -7], "2026-09-02"), [-1]);
  assert.deepEqual(offsetsHitToday("2026-09-01", [-1, -7], "2026-09-08"), [-7]);
  assert.deepEqual(offsetsHitToday("2026-09-01", DEFAULT_REMINDER_OFFSETS, "2026-09-02"), []);
});

test("default offsets are the spec cadence 90/60/30/7/0, each firing on its own day only", () => {
  assert.deepEqual(DEFAULT_REMINDER_OFFSETS, [90, 60, 30, 7, 0]);
  const due = "2027-01-01";
  assert.deepEqual(offsetsHitToday(due, DEFAULT_REMINDER_OFFSETS, "2026-10-03"), [90]);
  assert.deepEqual(offsetsHitToday(due, DEFAULT_REMINDER_OFFSETS, "2026-11-02"), [60]);
  assert.deepEqual(offsetsHitToday(due, DEFAULT_REMINDER_OFFSETS, "2026-12-02"), [30]);
  assert.deepEqual(offsetsHitToday(due, DEFAULT_REMINDER_OFFSETS, "2026-12-25"), [7]);
  assert.deepEqual(offsetsHitToday(due, DEFAULT_REMINDER_OFFSETS, "2027-01-01"), [0]);
  // in-between days fire nothing (no fuzzy ranges)
  assert.deepEqual(offsetsHitToday(due, DEFAULT_REMINDER_OFFSETS, "2026-10-04"), []);
  assert.deepEqual(offsetsHitToday(due, DEFAULT_REMINDER_OFFSETS, "2026-12-31"), []);
});

// ---------------------------------------------------------------------------
// Escalation steps
// ---------------------------------------------------------------------------

test("parseStepAfter understands d/h/w", () => {
  assert.equal(parseStepAfter("1d"), 1);
  assert.equal(parseStepAfter("14d"), 14);
  assert.equal(parseStepAfter("12h"), 0.5);
  assert.equal(parseStepAfter("2w"), 14);
  assert.equal(parseStepAfter("0d"), 0);
  assert.equal(parseStepAfter("soon"), null);
  assert.equal(parseStepAfter("-1d"), null);
});

test("escalation steps fire when their duration has elapsed", () => {
  const steps = [
    { after: "1d", action: "notify_owner" },
    { after: "3d", action: "escalate_facility_manager" },
    { after: "7d", action: "escalate_compliance_manager" },
    { after: "14d", action: "flag_executive" },
  ];
  assert.equal(escalationStepsDue(0, steps), 0);
  assert.equal(escalationStepsDue(1, steps), 1);
  assert.equal(escalationStepsDue(3, steps), 2);
  assert.equal(escalationStepsDue(13, steps), 3);
  assert.equal(escalationStepsDue(30, steps), 4);
});

test("escalation steps tolerate unsorted input", () => {
  const steps = [
    { after: "7d", action: "escalate_compliance_manager" },
    { after: "1d", action: "notify_owner" },
  ];
  assert.equal(escalationStepsDue(2, steps), 1);
  assert.equal(escalationStepsDue(7, steps), 2);
});

test("step index advances the state chain in order", () => {
  assert.deepEqual([...ESCALATION_STATES], [
    "none",
    "owner_notified",
    "facility_manager",
    "compliance_manager",
    "executive_flagged",
  ]);
  assert.equal(stateAfterStep(0), "owner_notified");
  assert.equal(stateAfterStep(3), "executive_flagged");
  assert.equal(stateAfterStep(99), "executive_flagged"); // clamps at the top
  assert.equal(escalationStateIndex("none"), 0);
  assert.equal(escalationStateIndex("facility_manager"), 2);
  assert.equal(escalationStateIndex("bogus"), 0);
});

// ---------------------------------------------------------------------------
// Dedupe keys
// ---------------------------------------------------------------------------

test("dedupe keys are distinct per rule/item/offset and per policy/step", () => {
  assert.equal(reminderDedupeKey("r1", "work:o1", 7), "ENT_REMINDER:r1:work:o1:7");
  assert.notEqual(reminderDedupeKey("r1", "work:o1", 7), reminderDedupeKey("r1", "work:o1", 0));
  assert.notEqual(reminderDedupeKey("r1", "work:o1", 7), reminderDedupeKey("r2", "work:o1", 7));
  assert.equal(escalationDedupeKey("p1", "o1", 2), "ENT_ESCALATION:p1:o1:2");
  assert.notEqual(escalationDedupeKey("p1", "o1", 2), escalationDedupeKey("p1", "o1", 3));
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

test("reminder rule validation accepts defaults and rejects junk", () => {
  const ok = validateReminderRuleInput({ offsets_days: [30, 7], channels: ["in_app", "email"] });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.value!.offsets_days, [30, 7]);
  assert.deepEqual(validateReminderRuleInput({}).value!.offsets_days, [90, 60, 30, 7, 0]);
  assert.equal(validateReminderRuleInput({ offsets_days: [] }).ok, false);
  assert.equal(validateReminderRuleInput({ channels: ["sms"] }).ok, false);
  assert.equal(validateReminderRuleInput({ obligation_id: "nope" }).ok, false);
});

test("escalation policy validation enforces ordered steps and known actions", () => {
  const good = validateEscalationPolicyInput({
    trigger: "overdue",
    steps: [
      { after: "1d", action: "notify_owner" },
      { after: "3d", action: "escalate_facility_manager" },
    ],
  });
  assert.equal(good.ok, true);
  assert.equal(validateEscalationPolicyInput({ trigger: "whenever", steps: [] }).ok, false);
  assert.equal(
    validateEscalationPolicyInput({ trigger: "overdue", steps: [{ after: "1d", action: "nuke" }] }).ok,
    false
  );
  assert.equal(
    validateEscalationPolicyInput({
      trigger: "overdue",
      steps: [
        { after: "3d", action: "notify_owner" },
        { after: "1d", action: "notify_owner" },
      ],
    }).ok,
    false // not strictly increasing
  );
});

test("deadline schedule validation requires a source note for verified dates", () => {
  const base = { schedule_type: "one_time", due_date: "2026-10-01" };
  assert.equal(validateDeadlineScheduleInput(base).ok, true);
  assert.equal(validateDeadlineScheduleInput({ ...base, is_verified: true }).ok, false);
  assert.equal(
    validateDeadlineScheduleInput({ ...base, is_verified: true, source_note: "OGPe portal export 2026-09-12" }).ok,
    true
  );
  assert.equal(validateDeadlineScheduleInput({ ...base, due_date: "tomorrow" }).ok, false);
  assert.equal(validateDeadlineScheduleInput({ ...base, schedule_type: "someday" }).ok, false);
});
