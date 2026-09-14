// Unit tests for the compliance-reminder engine (Phase 1).
// Run with: npx tsx --test src/lib/__tests__/compliance-reminders.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  planAllowsReminders,
  isMuted,
  selectDueNotifications,
  hasStoredDueDate,
  signUnsubscribeToken,
  verifyUnsubscribeToken,
  setComplianceMailerForTests,
  runComplianceReminderCron,
  type DueNotificationRow,
  type PreferenceRow,
} from "../compliance-reminders";
import {
  buildReminderEmail,
  tierFromNotificationType,
} from "../compliance-reminder-emails";

// ---------------------------------------------------------------------------
// tierFromNotificationType
// ---------------------------------------------------------------------------

test("tierFromNotificationType parses the 60/30/7 tiers and rejects the rest", () => {
  assert.equal(tierFromNotificationType("RENEWAL_60_DAY"), 60);
  assert.equal(tierFromNotificationType("RENEWAL_30_DAY"), 30);
  assert.equal(tierFromNotificationType("RENEWAL_7_DAY"), 7);
  assert.equal(tierFromNotificationType("RENEWAL_90_DAY"), null);
  assert.equal(tierFromNotificationType("OVERDUE_OR_DUE"), null);
  assert.equal(tierFromNotificationType("STALLED_NUDGE"), null);
  assert.equal(tierFromNotificationType("garbage"), null);
  assert.equal(tierFromNotificationType(""), null);
});

// ---------------------------------------------------------------------------
// planAllowsReminders
// ---------------------------------------------------------------------------

test("planAllowsReminders: free gets nothing, every paid plan gets reminders", () => {
  assert.equal(planAllowsReminders("free"), false);
  for (const plan of ["core", "operator", "partner", "pilot", "enterprise"]) {
    assert.equal(planAllowsReminders(plan), true, plan);
  }
});

// ---------------------------------------------------------------------------
// isMuted
// ---------------------------------------------------------------------------

const prefsOf = (p: Partial<PreferenceRow> & { scope: PreferenceRow["scope"] }): PreferenceRow => ({
  business_id: null,
  obligation_id: null,
  muted: true,
  ...p,
});

test("isMuted honors global, business, and obligation scopes", () => {
  const target = { businessId: "b1", obligationId: "o1" };
  assert.equal(isMuted([prefsOf({ scope: "global" })], target), true);
  assert.equal(
    isMuted([prefsOf({ scope: "business", business_id: "b1" })], target),
    true
  );
  assert.equal(
    isMuted([prefsOf({ scope: "business", business_id: "b2" })], target),
    false
  );
  assert.equal(
    isMuted([prefsOf({ scope: "obligation", obligation_id: "o1" })], target),
    true
  );
  assert.equal(
    isMuted([prefsOf({ scope: "obligation", obligation_id: "o9" })], target),
    false
  );
  // muted=false rows are inert
  assert.equal(
    isMuted([prefsOf({ scope: "global", muted: false })], target),
    false
  );
  assert.equal(isMuted([], target), false);
  // obligation mute with null obligation target does not match
  assert.equal(
    isMuted([prefsOf({ scope: "obligation", obligation_id: "o1" })], {
      businessId: "b1",
      obligationId: null,
    }),
    false
  );
});

// ---------------------------------------------------------------------------
// selectDueNotifications
// ---------------------------------------------------------------------------

const notif = (over: Partial<DueNotificationRow>): DueNotificationRow => ({
  id: "n1",
  user_id: "u1",
  workspace_id: "w1",
  business_id: "b1",
  obligation_id: "o1",
  type: "RENEWAL_30_DAY",
  scheduled_for: "2026-09-01T09:00:00.000Z",
  ...over,
});

test("selectDueNotifications picks due renewal tiers only", () => {
  const now = new Date("2026-09-14T12:00:00.000Z");
  const rows = [
    notif({ id: "due30", type: "RENEWAL_30_DAY", scheduled_for: "2026-09-14T09:00:00.000Z" }),
    notif({ id: "due7", type: "RENEWAL_7_DAY", scheduled_for: "2026-09-10T09:00:00.000Z" }),
    notif({ id: "future", type: "RENEWAL_60_DAY", scheduled_for: "2026-09-20T09:00:00.000Z" }),
    notif({ id: "stalled", type: "STALLED_NUDGE", scheduled_for: "2026-09-01T09:00:00.000Z" }),
    notif({ id: "legacy90", type: "RENEWAL_90_DAY", scheduled_for: "2026-09-01T09:00:00.000Z" }),
  ];
  const ids = selectDueNotifications(rows, now).map((r) => r.id);
  assert.deepEqual(ids, ["due30", "due7"]);
});

// ---------------------------------------------------------------------------
// hasStoredDueDate — the founder's no-estimates rule
// ---------------------------------------------------------------------------

const ctxOf = (over: Record<string, unknown>) => ({
  obligation_id: "o1",
  obligation_name: "Patente",
  business_id: "b1",
  business_name: "Biz",
  agency: null,
  workspace_id: "w1",
  due_date: "2027-01-31",
  due_date_source: "USER_PROVIDED",
  status: "DUE_SOON",
  business_public_id: null,
  ...over,
});

test("hasStoredDueDate requires a real stored date with provenance", () => {
  assert.equal(hasStoredDueDate(ctxOf({})), true);
  assert.equal(hasStoredDueDate(ctxOf({ due_date: null })), false);
  assert.equal(hasStoredDueDate(ctxOf({ due_date_source: "UNKNOWN" })), false);
  assert.equal(hasStoredDueDate(ctxOf({ due_date_source: null })), false);
  assert.equal(hasStoredDueDate(ctxOf({ status: "COMPLETED" })), false);
  assert.equal(hasStoredDueDate(ctxOf({ due_date_source: "DOCUMENT_EXTRACTED" })), true);
  assert.equal(hasStoredDueDate(ctxOf({ due_date_source: "REGULATORY_RULE" })), true);
});

// ---------------------------------------------------------------------------
// buildReminderEmail
// ---------------------------------------------------------------------------

test("buildReminderEmail renders EN renewal with tier in subject", () => {
  const built = buildReminderEmail({
    kind: "renewal",
    tier: 30,
    lang: "en",
    obligationName: "Patente Municipal",
    businessName: "Café Luna",
    agency: "Municipio de San Juan",
    dueDate: "2027-01-31",
    actionUrl: "https://x/y",
    unsubscribeUrl: "https://x/unsub",
  });
  assert.match(built.subject, /30 days/);
  assert.match(built.subject, /Patente Municipal/);
  assert.match(built.text, /Café Luna/);
  assert.match(built.html, /https:\/\/x\/unsub/);
});

test("buildReminderEmail renders boricua Spanish, not neutral Spanish", () => {
  const built = buildReminderEmail({
    kind: "renewal",
    tier: 7,
    lang: "es",
    obligationName: "Patente Municipal",
    businessName: "Café Luna",
    agency: null,
    dueDate: "2026-09-21",
    actionUrl: "https://x/y",
    unsubscribeUrl: "https://x/unsub",
  });
  assert.match(built.subject, /Se vence esta semana/);
  assert.match(built.text, /Radícalo esta semana/);
  assert.match(built.text, /Darme de baja/);
  // neutral-Spanish phrasing must not appear
  assert.doesNotMatch(built.text, /presentar la solicitud/i);
});

test("buildReminderEmail renders the stalled nudge in both languages", () => {
  const es = buildReminderEmail({
    kind: "stalled",
    lang: "es",
    obligationName: "Permiso Único",
    businessName: "Café Luna",
    agency: null,
    actionUrl: "https://x/y",
    unsubscribeUrl: "https://x/unsub",
  });
  assert.match(es.subject, /Retoma tu radicación/);
  const en = buildReminderEmail({
    kind: "stalled",
    lang: "en",
    obligationName: "Permiso Único",
    businessName: "Café Luna",
    agency: null,
    actionUrl: "https://x/y",
    unsubscribeUrl: "https://x/unsub",
  });
  assert.match(en.subject, /Pick up where you left off/);
});

test("buildReminderEmail throws when a renewal has no due date", () => {
  assert.throws(() =>
    buildReminderEmail({
      kind: "renewal",
      tier: 30,
      lang: "en",
      obligationName: "X",
      businessName: "Y",
      agency: null,
      actionUrl: "https://x",
      unsubscribeUrl: "https://x/u",
    })
  );
});

// ---------------------------------------------------------------------------
// Unsubscribe tokens
// ---------------------------------------------------------------------------

test("unsubscribe tokens round-trip and reject tampering", () => {
  const token = signUnsubscribeToken("user-123");
  assert.equal(verifyUnsubscribeToken(token), "user-123");
  assert.equal(verifyUnsubscribeToken(token + "x"), null);
  assert.equal(verifyUnsubscribeToken("not-a-token"), null);
  assert.equal(verifyUnsubscribeToken(""), null);
});

// ---------------------------------------------------------------------------
// runComplianceReminderCron — integration against a fake Db
// ---------------------------------------------------------------------------

interface FakeTable {
  notifications: Record<string, unknown>[];
  obligations: Record<string, unknown>[];
  businesses: Record<string, unknown>[];
  subscriptions: Record<string, string>;
  prefs: Record<string, unknown>[];
  users: Record<string, { email: string | null; lang: string }>;
}

function makeDb(t: FakeTable) {
  const sent: Record<string, unknown>[] = [];
  return {
    sent,
    async query(sql: string, params: unknown[] = []) {
      const s = sql.replace(/\s+/g, " ");
      // Due-notification sweep
      if (s.includes("FROM notifications") && s.includes("status = 'PENDING'")) {
        return {
          rows: t.notifications
            .filter((n) => n.status === "PENDING" && n.channel === "EMAIL")
            .map((n) => ({ ...n, scheduled_for: String(n.scheduled_for) })),
        };
      }
      // workspace plan
      if (s.includes("FROM workspace_subscriptions")) {
        const plan = t.subscriptions[String(params[0])] || "free";
        return { rows: [{ plan, status: plan === "free" ? "free" : "active" }] };
      }
      // preferences
      if (s.includes("FROM notification_preferences") && s.includes("SELECT")) {
        return {
          rows: t.prefs.filter((p) => String(p.user_id) === String(params[0])),
        };
      }
      // obligation context (the stalled sweep also selects FROM obligations o
      // JOIN businesses b, so exclude it here — it has its own branch below)
      if (s.includes("FROM obligations o") && s.includes("JOIN businesses b") && !s.includes("o.status = 'IN_PROGRESS'")) {
        const o = t.obligations.find((x) => String(x.id) === String(params[0]));
        if (!o) return { rows: [] };
        const b = t.businesses.find((x) => String(x.id) === String(o.business_id));
        return {
          rows: [
            {
              obligation_id: o.id,
              obligation_name: o.name,
              business_id: o.business_id,
              business_name: b?.legal_name || b?.name,
              agency: o.agency,
              workspace_id: b?.workspace_id,
              due_date: o.due_date,
              due_date_source: o.due_date_source,
              status: o.status,
              business_public_id: b?.public_id || null,
            },
          ],
        };
      }
      // auth.users email / lang
      if (s.includes("FROM auth.users")) {
        const u = t.users[String(params[0])];
        if (s.includes("raw_user_meta_data")) return { rows: [{ lang: u?.lang || null }] };
        return { rows: [{ email: u?.email || null }] };
      }
      // mark delivered / cancel
      if (s.includes("UPDATE notifications SET status = 'DELIVERED'")) {
        const n = t.notifications.find((x) => String(x.id) === String(params[0]));
        if (n && n.status === "PENDING") n.status = "DELIVERED";
        return { rows: [], rowCount: 1 };
      }
      if (s.includes("UPDATE notifications SET status = 'CANCELLED'") && s.includes("id = $1")) {
        const n = t.notifications.find((x) => String(x.id) === String(params[0]));
        if (n) n.status = "CANCELLED";
        return { rows: [], rowCount: 1 };
      }
      // stalled sweep (must precede the obligation-context branch: both
      // select FROM obligations o JOIN businesses b)
      if (s.includes("o.status = 'IN_PROGRESS'")) {
        const cutoff = Date.now() - 14 * 86400000;
        return {
          rows: t.obligations
            .filter((o) => {
              if (o.status !== "IN_PROGRESS") return false;
              if (new Date(String(o.updated_at)).getTime() > cutoff) return false;
              const recent = t.notifications.some(
                (n) =>
                  String(n.obligation_id) === String(o.id) &&
                  n.type === "STALLED_NUDGE" &&
                  new Date(String(n.created_at)).getTime() > cutoff
              );
              return !recent;
            })
            .map((o) => {
              const b = t.businesses.find((x) => String(x.id) === String(o.business_id));
              return {
                obligation_id: o.id,
                obligation_name: o.name,
                business_id: o.business_id,
                business_name: b?.legal_name,
                agency: o.agency,
                workspace_id: b?.workspace_id,
                user_id: b?.user_id,
                business_public_id: b?.public_id || null,
              };
            }),
        };
      }
      // stalled insert ('STALLED_NUDGE' is inline in the SQL, not in params)
      if (s.includes("INSERT INTO notifications") && s.includes("STALLED_NUDGE")) {
        t.notifications.push({
          id: params[0],
          user_id: params[1],
          workspace_id: params[2],
          business_id: params[3],
          obligation_id: params[4],
          type: "STALLED_NUDGE",
          channel: "EMAIL",
          status: params[6],
          created_at: new Date().toISOString(),
          scheduled_for: new Date().toISOString(),
        });
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`unhandled query in fake db: ${s.slice(0, 120)}`);
    },
  };
}

function baseTables(): FakeTable {
  return {
    notifications: [
      {
        id: "n-due",
        user_id: "u1",
        workspace_id: "w-paid",
        business_id: "b1",
        obligation_id: "o1",
        type: "RENEWAL_30_DAY",
        channel: "EMAIL",
        status: "PENDING",
        scheduled_for: "2026-09-10T09:00:00.000Z",
      },
    ],
    obligations: [
      {
        id: "o1",
        business_id: "b1",
        name: "Patente Municipal",
        agency: "Municipio",
        status: "DUE_SOON",
        due_date: "2026-10-14",
        due_date_source: "USER_PROVIDED",
        updated_at: "2026-09-01T00:00:00.000Z",
      },
    ],
    businesses: [
      { id: "b1", legal_name: "Café Luna", workspace_id: "w-paid", user_id: "u1", public_id: "abc123" },
    ],
    subscriptions: { "w-paid": "core", "w-free": "free" },
    prefs: [],
    users: { u1: { email: "owner@example.com", lang: "en" } },
  };
}

test("cron sends due renewal, marks DELIVERED, and is idempotent", async () => {
  const sent: Record<string, unknown>[] = [];
  setComplianceMailerForTests({
    sendMail: async (opts) => {
      sent.push(opts);
      return {};
    },
  });
  try {
    const t = baseTables();
    const db = makeDb(t);
    const s1 = await runComplianceReminderCron(db as never, new Date("2026-09-14T12:00:00Z"));
    assert.equal(s1.renewal_sent, 1);
    assert.equal(sent.length, 1);
    assert.match(String((sent[0] as Record<string, unknown>).from), /alerts@getsmartpr\.com/);
    assert.equal(t.notifications.find((n) => n.id === "n-due")!.status, "DELIVERED");
    // Second run: already DELIVERED, nothing re-sent.
    const s2 = await runComplianceReminderCron(db as never, new Date("2026-09-14T12:00:00Z"));
    assert.equal(s2.renewal_sent, 0);
    assert.equal(sent.length, 1);
  } finally {
    setComplianceMailerForTests(null);
  }
});

test("cron skips free workspaces", async () => {
  setComplianceMailerForTests({ sendMail: async () => ({}) });
  try {
    const t = baseTables();
    (t.notifications[0] as Record<string, unknown>).workspace_id = "w-free";
    (t.businesses[0] as Record<string, unknown>).workspace_id = "w-free";
    const db = makeDb(t);
    const s = await runComplianceReminderCron(db as never, new Date("2026-09-14T12:00:00Z"));
    assert.equal(s.renewal_sent, 0);
    assert.equal(s.skipped_plan, 1);
    assert.equal(t.notifications.find((n) => n.id === "n-due")!.status, "PENDING");
  } finally {
    setComplianceMailerForTests(null);
  }
});

test("cron honors the global opt-out", async () => {
  setComplianceMailerForTests({ sendMail: async () => ({}) });
  try {
    const t = baseTables();
    t.prefs.push({ user_id: "u1", scope: "global", business_id: null, obligation_id: null, muted: true });
    const db = makeDb(t);
    const s = await runComplianceReminderCron(db as never, new Date("2026-09-14T12:00:00Z"));
    assert.equal(s.renewal_sent, 0);
    assert.equal(s.skipped_optout, 1);
  } finally {
    setComplianceMailerForTests(null);
  }
});

test("cron cancels (never sends) reminders without a stored due date", async () => {
  setComplianceMailerForTests({ sendMail: async () => ({}) });
  try {
    const t = baseTables();
    const o = t.obligations[0] as Record<string, unknown>;
    o.due_date = null;
    o.due_date_source = "UNKNOWN";
    const db = makeDb(t);
    const s = await runComplianceReminderCron(db as never, new Date("2026-09-14T12:00:00Z"));
    assert.equal(s.renewal_sent, 0);
    assert.equal(s.skipped_no_date, 1);
    assert.equal(t.notifications.find((n) => n.id === "n-due")!.status, "CANCELLED");
  } finally {
    setComplianceMailerForTests(null);
  }
});

test("cron sends the stalled nudge once per 14 days", async () => {
  const sent: Record<string, unknown>[] = [];
  setComplianceMailerForTests({
    sendMail: async (opts) => {
      sent.push(opts);
      return {};
    },
  });
  try {
    const t = baseTables();
    t.notifications = [];
    (t.obligations[0] as Record<string, unknown>).status = "IN_PROGRESS";
    (t.obligations[0] as Record<string, unknown>).updated_at = "2026-08-01T00:00:00.000Z";
    const db = makeDb(t);
    const s1 = await runComplianceReminderCron(db as never, new Date("2026-09-14T12:00:00Z"));
    assert.equal(s1.stalled_sent, 1);
    assert.match(String((sent[0] as Record<string, unknown>).subject), /Pick up where you left off/);
    // Second run: the 14-day cap suppresses a repeat.
    const s2 = await runComplianceReminderCron(db as never, new Date("2026-09-14T12:00:00Z"));
    assert.equal(s2.stalled_sent, 0);
  } finally {
    setComplianceMailerForTests(null);
  }
});
