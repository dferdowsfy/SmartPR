// Unit tests for the monthly compliance digest (spec section 10).
// Run with: npx tsx --test src/lib/__tests__/compliance-digest.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  isMuted,
  setComplianceMailerForTests,
  type PreferenceRow,
} from "../compliance-reminders";
import {
  isDigestMuted,
  bucketDigestObligations,
  runComplianceDigestCron,
} from "../compliance-digest";
import {
  buildDigestEmail,
  bucketDigestItem,
  sortDigestSoonestFirst,
} from "../compliance-digest-emails";

// ---------------------------------------------------------------------------
// bucketDigestItem
// ---------------------------------------------------------------------------

test("bucketDigestItem: overdue..30 → dueSoon, 31..90 → dueLater, 91+ → null", () => {
  for (const d of [-30, -1, 0, 1, 7, 30]) assert.equal(bucketDigestItem(d), "dueSoon", String(d));
  for (const d of [31, 60, 90]) assert.equal(bucketDigestItem(d), "dueLater", String(d));
  for (const d of [91, 120, 365]) assert.equal(bucketDigestItem(d), null, String(d));
});

test("sortDigestSoonestFirst orders soonest first (overdue first)", () => {
  const items = [{ daysRemaining: 30 }, { daysRemaining: -5 }, { daysRemaining: 7 }];
  const sorted = sortDigestSoonestFirst(items);
  assert.deepEqual(sorted.map((i) => i.daysRemaining), [-5, 7, 30]);
});

// ---------------------------------------------------------------------------
// isDigestMuted — the digest has its OWN opt-out, global covers both
// ---------------------------------------------------------------------------

const prefsOf = (p: Partial<PreferenceRow> & { scope: PreferenceRow["scope"] }): PreferenceRow => ({
  business_id: null,
  obligation_id: null,
  muted: true,
  ...p,
});

test("isDigestMuted: digest mute and global mute stop the digest", () => {
  assert.equal(isDigestMuted([prefsOf({ scope: "digest" })]), true);
  assert.equal(isDigestMuted([prefsOf({ scope: "global" })]), true);
  assert.equal(isDigestMuted([prefsOf({ scope: "business", business_id: "b1" })]), false);
  assert.equal(isDigestMuted([prefsOf({ scope: "digest", muted: false })]), false);
  assert.equal(isDigestMuted([]), false);
});

test("digest opt-out is independent of transactional reminders (and vice versa)", () => {
  const target = { businessId: "b1", obligationId: "o1" };
  // A digest-only mute must NOT silence transactional reminders.
  assert.equal(isMuted([prefsOf({ scope: "digest" })], target), false);
  // A transactional business mute must NOT silence the digest.
  assert.equal(isDigestMuted([prefsOf({ scope: "business", business_id: "b1" })]), false);
  // Global mute silences both.
  assert.equal(isMuted([prefsOf({ scope: "global" })], target), true);
  assert.equal(isDigestMuted([prefsOf({ scope: "global" })]), true);
});

// ---------------------------------------------------------------------------
// buildDigestEmail
// ---------------------------------------------------------------------------

function dueItem(over: Partial<import("../compliance-digest-emails").DigestDueItem> = {}) {
  return {
    obligationId: "o1",
    name: "Patente Municipal",
    businessName: "Café Luna",
    businessRef: "abc123",
    agency: "Municipio de San Juan",
    dueDate: "2026-10-11",
    daysRemaining: 10,
    actionUrl: "https://www.getsmartpr.com/businesses/abc123#obligation-o1",
    ...over,
  };
}

test("buildDigestEmail: full digest has all four sections, soonest first", () => {
  const built = buildDigestEmail({
    lang: "en",
    monthLabel: "October 2026",
    userName: "Darius",
    dueSoon: [dueItem({ daysRemaining: 10 }), dueItem({ obligationId: "o0", name: "Marbete", dueDate: "2026-10-03", daysRemaining: 2 })],
    dueLater: [dueItem({ obligationId: "o2", name: "Merchant Registration", dueDate: "2026-11-15", daysRemaining: 45 })],
    stalled: [{ obligationId: "o3", name: "Permiso Único", businessName: "Café Luna", businessRef: "abc123", agency: "OGPe", daysStalled: 21, actionUrl: "https://x/#o3" }],
    missingDates: [{ obligationId: "o4", name: "Bomberos Cert", businessName: "Café Luna", businessRef: "abc123", agency: "Bomberos", actionUrl: "https://x/#o4" }],
    dashboardUrl: "https://www.getsmartpr.com/dashboard",
    manageUrl: "https://www.getsmartpr.com/settings",
    unsubscribeUrl: "https://www.getsmartpr.com/api/notifications/unsubscribe?token=t",
  });
  assert.match(built.subject, /October 2026/);
  for (const title of ["Due within 30 days", "Due in 1–3 months", "Needs your attention", "Missing dates"]) {
    assert.ok(built.html.includes(title), title);
    assert.ok(built.text.includes(title), `text: ${title}`);
  }
  // Soonest first: Marbete (2 days) renders before Patente (10 days).
  assert.ok(built.html.indexOf("Marbete") < built.html.indexOf("Patente Municipal"));
  // Deep links, manage + unsubscribe present.
  assert.ok(built.html.includes("https://www.getsmartpr.com/dashboard"));
  assert.ok(built.html.includes("https://www.getsmartpr.com/settings"));
  assert.ok(built.html.includes("unsubscribe?token=t"));
  assert.ok(built.text.includes("Unsubscribe from all reminder emails"));
});

test("buildDigestEmail: Spanish copy is boricua, not neutral", () => {
  const built = buildDigestEmail({
    lang: "es",
    monthLabel: "octubre de 2026",
    userName: null,
    dueSoon: [dueItem()],
    dueLater: [],
    stalled: [],
    missingDates: [],
    dashboardUrl: "https://x/d",
    manageUrl: "https://x/s",
    unsubscribeUrl: "https://x/u",
  });
  assert.match(built.subject, /Tu resumen de cumplimiento/);
  assert.ok(built.html.includes("Se vence en los próximos 30 días"));
  assert.ok(built.html.includes("Abrir SmartPR"));
  assert.ok(built.html.includes("Darme de baja de todos los avisos"));
  assert.ok(!built.html.includes("ordenador"), "no peninsular Spanish");
});

test("buildDigestEmail: all-clear variant when nothing is due or stalled", () => {
  for (const lang of ["en", "es"] as const) {
    const built = buildDigestEmail({
      lang,
      monthLabel: "October 2026",
      userName: null,
      dueSoon: [],
      dueLater: [],
      stalled: [],
      missingDates: [],
      dashboardUrl: "https://x/d",
      manageUrl: "https://x/s",
      unsubscribeUrl: "https://x/u",
    });
    assert.ok(built.html.includes(lang === "es" ? "Todo al día" : "all clear"), lang);
    assert.ok(!built.html.includes("Due within 30 days"), lang);
    assert.ok(!built.html.includes("Se vence en los próximos 30 días"), lang);
  }
});

test("buildDigestEmail: missing-dates section never shows a fabricated date", () => {
  const built = buildDigestEmail({
    lang: "en",
    monthLabel: "October 2026",
    userName: null,
    dueSoon: [],
    dueLater: [],
    stalled: [],
    missingDates: [
      { obligationId: "o4", name: "Bomberos Cert", businessName: "Café Luna", businessRef: "abc123", agency: "Bomberos", actionUrl: "https://x/#o4" },
    ],
    dashboardUrl: "https://x/d",
    manageUrl: "https://x/s",
    unsubscribeUrl: "https://x/u",
  });
  assert.ok(built.html.includes("Missing dates"));
  assert.ok(built.html.includes("Add date"));
  // The missing item must not carry any due-date text.
  const section = built.html.slice(built.html.indexOf("Missing dates"));
  assert.ok(!/\d{4}-\d{2}-\d{2}/.test(section), "no ISO date in missing-dates section");
});

// ---------------------------------------------------------------------------
// Cron (fake db)
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;
interface FakeTables {
  businesses: Row[];
  obligations: Row[];
  members: Row[];
  subscriptions: Record<string, string>;
  prefs: Row[];
  digestLog: Row[];
  users: Record<string, { email: string; lang: string; name: string }>;
}

function baseTables(): FakeTables {
  return {
    businesses: [
      { id: "b1", legal_name: "Café Luna", name: "Café Luna", workspace_id: "w-op", user_id: "u1", public_id: "abc123", archived: false, created_at: "2026-01-01T00:00:00Z" },
      { id: "b2", legal_name: "Taller Sol", name: "Taller Sol", workspace_id: "w-op", user_id: "u1", public_id: "def456", archived: false, created_at: "2026-06-01T00:00:00Z" },
    ],
    obligations: [
      { id: "o1", name: "Patente Municipal", agency: "Municipio", status: "DUE_SOON", due_date: "2026-10-11", due_date_source: "USER_PROVIDED", renewal_frequency_months: 12, updated_at: "2026-09-20T00:00:00Z", business_id: "b1" },
      { id: "o2", name: "Merchant Registration", agency: "Hacienda", status: "UPCOMING", due_date: "2026-11-15", due_date_source: "USER_PROVIDED", renewal_frequency_months: 24, updated_at: "2026-09-20T00:00:00Z", business_id: "b1" },
      { id: "o3", name: "Far-future thing", agency: null, status: "UPCOMING", due_date: "2027-03-01", due_date_source: "USER_PROVIDED", renewal_frequency_months: null, updated_at: "2026-09-20T00:00:00Z", business_id: "b1" },
      { id: "o4", name: "Permiso Único", agency: "OGPe", status: "IN_PROGRESS", due_date: null, due_date_source: "UNKNOWN", renewal_frequency_months: 12, updated_at: "2026-09-01T00:00:00Z", business_id: "b1" },
      { id: "o5", name: "Bomberos Cert", agency: "Bomberos", status: "CURRENT", due_date: null, due_date_source: "UNKNOWN", renewal_frequency_months: 12, updated_at: "2026-09-20T00:00:00Z", business_id: "b2" },
      { id: "o6", name: "No date no renewal", agency: null, status: "MISSING", due_date: null, due_date_source: "UNKNOWN", renewal_frequency_months: null, updated_at: "2026-09-20T00:00:00Z", business_id: "b1" },
      { id: "o7", name: "Done already", agency: null, status: "COMPLETED", due_date: "2026-10-05", due_date_source: "USER_PROVIDED", renewal_frequency_months: 12, updated_at: "2026-09-20T00:00:00Z", business_id: "b1" },
    ],
    members: [{ workspace_id: "w-op", user_id: "u1", role: "OWNER", created_at: "2026-01-01T00:00:00Z" }],
    subscriptions: { "w-op": "operator" },
    prefs: [],
    digestLog: [],
    users: { u1: { email: "owner@example.com", lang: "en", name: "Darius" } },
  };
}

function makeDb(t: FakeTables) {
  return {
    query: async (sql: string, params: unknown[] = []) => {
      const s = String(sql);
      const p = params as string[];
      // Candidate workspaces.
      if (s.includes("DISTINCT workspace_id")) {
        const ids = [...new Set(t.businesses.filter((b) => !b.archived && b.workspace_id).map((b) => String(b.workspace_id)))];
        return { rows: ids.map((id) => ({ workspace_id: id })) };
      }
      // Plan lookup.
      if (s.includes("FROM workspace_subscriptions")) {
        const plan = t.subscriptions[String(p[0])] || "free";
        return { rows: [{ plan, status: "active" }] };
      }
      // Digest already sent?
      if (s.includes("FROM compliance_digest_log")) {
        const hit = t.digestLog.some((l) => String(l.workspace_id) === String(p[0]) && String(l.period) === String(p[1]));
        return { rows: hit ? [{ "1": 1 }] : [] };
      }
      // Workspace owner.
      if (s.includes("FROM workspace_members")) {
        const m = t.members.find((x) => String(x.workspace_id) === String(p[0]) && x.role === "OWNER");
        if (m) return { rows: [{ user_id: m.user_id }] };
        const b = t.businesses.find((x) => String(x.workspace_id) === String(p[0]) && x.user_id);
        return { rows: b ? [{ user_id: b.user_id }] : [] };
      }
      // Preferences.
      if (s.includes("FROM notification_preferences")) {
        return {
          rows: t.prefs
            .filter((x) => String(x.user_id) === String(p[0]))
            .map((x) => ({ scope: x.scope, business_id: x.business_id ?? null, obligation_id: x.obligation_id ?? null, muted: x.muted })),
        };
      }
      // Core coverage: oldest business.
      if (s.includes("FROM businesses") && s.includes("ORDER BY created_at ASC")) {
        const match = t.businesses
          .filter((b) => String(b.workspace_id) === String(p[0]) && !b.archived)
          .sort((a, b2) => String(a.created_at).localeCompare(String(b2.created_at)))[0];
        return { rows: match ? [{ id: match.id }] : [] };
      }
      // Digest obligation load.
      if (s.includes("FROM obligations o") && s.includes("JOIN businesses b")) {
        const rows = t.obligations
          .filter((o) => {
            const b = t.businesses.find((x) => String(x.id) === String(o.business_id));
            return b && String(b.workspace_id) === String(p[0]) && !b.archived;
          })
          .map((o) => {
            const b = t.businesses.find((x) => String(x.id) === String(o.business_id))!;
            return {
              id: o.id,
              name: o.name,
              agency: o.agency ?? null,
              status: o.status,
              due_date: (o.due_date as string | null) ?? null,
              due_date_source: (o.due_date_source as string | null) ?? null,
              renewal_frequency_months: (o.renewal_frequency_months as number | null) ?? null,
              updated_at: (o.updated_at as string | null) ?? null,
              business_id: o.business_id,
              business_name: (b.legal_name as string) || (b.name as string),
              business_public_id: (b.public_id as string | null) ?? null,
            };
          });
        return { rows };
      }
      // auth.users.
      if (s.includes("FROM auth.users")) {
        const u = t.users[String(p[0])];
        if (s.includes("raw_user_meta_data->>'lang'")) return { rows: [{ lang: u?.lang || null }] };
        if (s.includes("full_name")) return { rows: [{ name: u?.name || null }] };
        return { rows: [{ email: u?.email || null }] };
      }
      // Digest log insert.
      if (s.includes("INSERT INTO compliance_digest_log")) {
        const exists = t.digestLog.some((l) => String(l.workspace_id) === String(p[0]) && String(l.period) === String(p[2]));
        if (exists) return { rows: [], rowCount: 0 };
        t.digestLog.push({ workspace_id: p[0], user_id: p[1], period: p[2], item_count: p[3] });
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`unhandled query in fake db: ${s.slice(0, 120)}`);
    },
  };
}

const FIRST_OF_OCT = new Date("2026-10-01T12:00:00Z");

test("cron sends the digest for a paid workspace and logs the period", async () => {
  const sent: Row[] = [];
  setComplianceMailerForTests({ sendMail: async (opts) => { sent.push(opts as Row); return {}; } });
  try {
    const t = baseTables();
    const db = makeDb(t);
    const s = await runComplianceDigestCron(db as never, FIRST_OF_OCT);
    assert.equal(s.digests_sent, 1);
    assert.equal(sent.length, 1);
    assert.match(String(sent[0].from), /alerts@getsmartpr\.com/);
    assert.match(String(sent[0].subject), /compliance snapshot/i);
    const html = String(sent[0].html);
    // Soonest first: o1 (10d) before o2 (45d); o3 (120d+) excluded.
    assert.ok(html.includes("Patente Municipal"));
    assert.ok(html.includes("Merchant Registration"));
    assert.ok(html.indexOf("Patente Municipal") < html.indexOf("Merchant Registration"));
    assert.ok(!html.includes("Far-future thing"));
    // Stalled + missing-dates sections.
    assert.ok(html.includes("Permiso Único"));
    assert.ok(html.includes("Bomberos Cert"));
    assert.ok(!html.includes("Done already"), "completed obligations excluded");
    // Idempotency: same month, no resend.
    const s2 = await runComplianceDigestCron(db as never, FIRST_OF_OCT);
    assert.equal(s2.digests_sent, 0);
    assert.equal(s2.skipped_already_sent, 1);
    assert.equal(sent.length, 1);
  } finally {
    setComplianceMailerForTests(null);
  }
});

test("cron skips free workspaces", async () => {
  setComplianceMailerForTests({ sendMail: async () => ({}) });
  try {
    const t = baseTables();
    t.subscriptions["w-op"] = "free";
    const db = makeDb(t);
    const s = await runComplianceDigestCron(db as never, FIRST_OF_OCT);
    assert.equal(s.digests_sent, 0);
    assert.equal(s.skipped_plan, 1);
  } finally {
    setComplianceMailerForTests(null);
  }
});

test("cron honors the digest-only opt-out", async () => {
  setComplianceMailerForTests({ sendMail: async () => ({}) });
  try {
    const t = baseTables();
    t.prefs.push({ user_id: "u1", scope: "digest", business_id: null, obligation_id: null, muted: true });
    const db = makeDb(t);
    const s = await runComplianceDigestCron(db as never, FIRST_OF_OCT);
    assert.equal(s.digests_sent, 0);
    assert.equal(s.skipped_optout, 1);
  } finally {
    setComplianceMailerForTests(null);
  }
});

test("cron honors the global opt-out for the digest", async () => {
  setComplianceMailerForTests({ sendMail: async () => ({}) });
  try {
    const t = baseTables();
    t.prefs.push({ user_id: "u1", scope: "global", business_id: null, obligation_id: null, muted: true });
    const db = makeDb(t);
    const s = await runComplianceDigestCron(db as never, FIRST_OF_OCT);
    assert.equal(s.digests_sent, 0);
    assert.equal(s.skipped_optout, 1);
  } finally {
    setComplianceMailerForTests(null);
  }
});

test("cron on core covers only the oldest business", async () => {
  const sent: Row[] = [];
  setComplianceMailerForTests({ sendMail: async (opts) => { sent.push(opts as Row); return {}; } });
  try {
    const t = baseTables();
    t.subscriptions["w-op"] = "core";
    const db = makeDb(t);
    const s = await runComplianceDigestCron(db as never, FIRST_OF_OCT);
    assert.equal(s.digests_sent, 1);
    const html = String(sent[0].html);
    assert.ok(html.includes("Patente Municipal"), "b1 item included");
    assert.ok(!html.includes("Bomberos Cert"), "b2-only item excluded on core");
  } finally {
    setComplianceMailerForTests(null);
  }
});

test("cron skips workspaces with no active obligations", async () => {
  setComplianceMailerForTests({ sendMail: async () => ({}) });
  try {
    const t = baseTables();
    t.obligations = [];
    const db = makeDb(t);
    const s = await runComplianceDigestCron(db as never, FIRST_OF_OCT);
    assert.equal(s.digests_sent, 0);
    assert.equal(s.skipped_empty, 1);
  } finally {
    setComplianceMailerForTests(null);
  }
});

test("bucketDigestObligations never invents dates: unknown-date items land in missing only", () => {
  const buckets = bucketDigestObligations(
    [
      {
        id: "o4", name: "Permiso Único", agency: "OGPe", status: "CURRENT",
        due_date: null, due_date_source: "UNKNOWN", renewal_frequency_months: 12,
        updated_at: "2026-09-20T00:00:00Z", business_id: "b1",
        business_name: "Café Luna", business_public_id: "abc123",
      },
    ],
    { now: FIRST_OF_OCT, planId: "operator", coveredBusinessId: null, prefs: [] }
  );
  assert.equal(buckets.dueSoon.length, 0);
  assert.equal(buckets.dueLater.length, 0);
  assert.equal(buckets.missingDates.length, 1);
  assert.equal(buckets.missingDates[0].name, "Permiso Único");
});
