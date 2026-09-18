/**
 * Voice auto-recap sweep tests.
 *
 * Proves the server-side recap backstop:
 * - only ENDED sessions are swept (never an active session)
 * - the per-user auto_recap_enabled toggle is honored
 * - no verified email -> skipped, not failed
 * - a manual email_my_summary during the call suppresses the auto-recap
 * - sessions with no account activity get no email
 * - delivery failures leave the session unmarked so the next sweep retries
 * - the recap content is derived from actual tool activity, never an account dump
 *
 * The database is a fake query router — no live Supabase needed.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { runAutoRecapSweep } from "./auto-recap";
import { setComplianceMailerForTests } from "../compliance-reminders";

/* ------------------------------------------------------------------ */
/* Fake database                                                       */
/* ------------------------------------------------------------------ */

interface FakeSession {
  id: string;
  user_id: string;
  phone_e164: string;
}

interface Scenario {
  /** Sessions the sweep candidate query returns (already filtered to "ended" — the SQL does that). */
  sessions: FakeSession[];
  autoRecapEnabled: boolean;
  email: string | null;
  /** Whether a manual email_my_summary succeeded during the call. */
  manualRecapSent: boolean;
  /** Session tool-call history for the deterministic recap. */
  activity: Array<{ tool_name: string; business_id: string | null }>;
  /** When false, the mailer reports a delivery failure. */
  mailDelivered?: boolean;
}

function makeFakeDb(scenario: Scenario) {
  const queries: Array<{ sql: string; params: unknown[] | undefined }> = [];
  const marked: string[] = [];
  const fake = {
    queries,
    marked,
    async query(sql: string, params?: unknown[]) {
      queries.push({ sql, params });
      const s = sql.replace(/\s+/g, " ");
      if (s.includes("FROM voice_sessions") && s.includes("recap_sent_at IS NULL")) {
        return { rows: scenario.sessions };
      }
      if (s.includes("FROM voice_access WHERE user_id")) {
        return {
          rows: [{ auto_recap_enabled: scenario.autoRecapEnabled, email: scenario.email }],
        };
      }
      if (s.includes("FROM voice_tool_calls") && s.includes("SELECT 1 AS n")) {
        return { rows: scenario.manualRecapSent ? [{ n: 1 }] : [] };
      }
      if (s.includes("FROM voice_tool_calls")) {
        return {
          rows: scenario.activity.map((a) => ({
            tool_name: a.tool_name,
            business_id: a.business_id,
          })),
        };
      }
      if (s.includes("FROM businesses")) {
        return { rows: [] };
      }
      if (s.includes("UPDATE voice_sessions SET recap_sent_at")) {
        marked.push(String(params?.[0]));
        return { rows: [] };
      }
      if (s.includes("INSERT INTO voice_audit_log") || s.includes("INSERT INTO voice_usage")) {
        return { rows: [] };
      }
      throw new Error(`unexpected query: ${s.slice(0, 120)}`);
    },
  };
  return fake;
}

function auditsOf(db: ReturnType<typeof makeFakeDb>) {
  return db.queries.filter((q) => q.sql.includes("INSERT INTO voice_audit_log"));
}

function auditDetails(db: ReturnType<typeof makeFakeDb>) {
  return auditsOf(db).map((q) => JSON.parse(String(q.params?.[3])));
}

/* ------------------------------------------------------------------ */
/* Mailer capture                                                      */
/* ------------------------------------------------------------------ */

let sentTo: string | null = null;
let sentSubject: string | null = null;
let sentText: string | null = null;
let mailDelivered = true;

beforeEach(() => {
  sentTo = null;
  sentSubject = null;
  sentText = null;
  mailDelivered = true;
  setComplianceMailerForTests({
    sendMail: async (opts: Record<string, unknown>) => {
      sentTo = opts.to as string;
      sentSubject = opts.subject as string;
      sentText = opts.text as string;
      if (!mailDelivered) throw new Error("smtp down");
    },
  });
});
afterEach(() => setComplianceMailerForTests(null));

function baseScenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    sessions: [{ id: "sess-1", user_id: "user-1", phone_e164: "+17870000001" }],
    autoRecapEnabled: true,
    email: "caller@getsmartpr.com",
    manualRecapSent: false,
    activity: [
      { tool_name: "get_requirements", business_id: null },
      { tool_name: "get_deadlines", business_id: null },
    ],
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe("voice auto-recap sweep", () => {
  it("sends a recap for an ended session with activity when the toggle is on", async () => {
    const db = makeFakeDb(baseScenario());
    const summary = await runAutoRecapSweep(db as never);

    assert.equal(summary.sessions_checked, 1);
    assert.equal(summary.recaps_sent, 1);
    assert.equal(summary.skipped, 0);
    assert.equal(summary.failed, 0);

    assert.equal(sentTo, "caller@getsmartpr.com");
    assert.match(String(sentSubject), /call recap/i);
    assert.match(String(sentText), /Checked requirements/);
    assert.match(String(sentText), /Sent automatically after your SmartPR voice call/);
    // Never an account dump.
    assert.doesNotMatch(String(sentText), /Missing evidence/);

    // Session marked exactly once.
    assert.deepEqual(db.marked, ["sess-1"]);

    // Audit trail carries the auto_recap scope and session id.
    const details = auditDetails(db);
    assert.ok(
      details.some((d) => d.scope === "auto_recap" && d.status === "sent" && d.session_id === "sess-1")
    );

    // Usage counter incremented.
    assert.ok(db.queries.some((q) => q.sql.includes("INSERT INTO voice_usage")));
  });

  it("sends nothing when no ended sessions are waiting", async () => {
    const db = makeFakeDb(baseScenario({ sessions: [] }));
    const summary = await runAutoRecapSweep(db as never);

    assert.equal(summary.sessions_checked, 0);
    assert.equal(summary.recaps_sent, 0);
    assert.equal(sentTo, null);
  });

  it("skips the session when the user turned automatic recaps off", async () => {
    const db = makeFakeDb(baseScenario({ autoRecapEnabled: false }));
    const summary = await runAutoRecapSweep(db as never);

    assert.equal(sentTo, null);
    assert.equal(summary.recaps_sent, 0);
    assert.equal(summary.skipped, 1);
    // Still marked so it is never revisited.
    assert.deepEqual(db.marked, ["sess-1"]);
    const details = auditDetails(db);
    assert.ok(details.some((d) => d.reason === "auto_recap_disabled"));
  });

  it("skips the session when there is no verified email on file", async () => {
    const db = makeFakeDb(baseScenario({ email: "not-an-email" }));
    const summary = await runAutoRecapSweep(db as never);

    assert.equal(sentTo, null);
    assert.equal(summary.skipped, 1);
    assert.deepEqual(db.marked, ["sess-1"]);
    const details = auditDetails(db);
    assert.ok(details.some((d) => d.reason === "no_verified_email"));
  });

  it("skips the session when the agent already sent a manual recap", async () => {
    const db = makeFakeDb(baseScenario({ manualRecapSent: true }));
    const summary = await runAutoRecapSweep(db as never);

    assert.equal(sentTo, null);
    assert.equal(summary.recaps_sent, 0);
    assert.equal(summary.skipped, 1);
    assert.deepEqual(db.marked, ["sess-1"]);
    const details = auditDetails(db);
    assert.ok(details.some((d) => d.reason === "manual_recap_sent"));
  });

  it("skips the session when the call had no account activity", async () => {
    const db = makeFakeDb(baseScenario({ activity: [] }));
    const summary = await runAutoRecapSweep(db as never);

    assert.equal(sentTo, null);
    assert.equal(summary.skipped, 1);
    assert.deepEqual(db.marked, ["sess-1"]);
    const details = auditDetails(db);
    assert.ok(details.some((d) => d.reason === "no_activity"));
  });

  it("leaves the session unmarked on delivery failure so the next sweep retries", async () => {
    mailDelivered = false;
    const db = makeFakeDb(baseScenario());
    const summary = await runAutoRecapSweep(db as never);

    assert.equal(summary.recaps_sent, 0);
    assert.equal(summary.failed, 1);
    assert.deepEqual(db.marked, []);
    const details = auditDetails(db);
    assert.ok(details.some((d) => d.scope === "auto_recap" && d.status === "failed"));
  });

  it("processes multiple sessions independently", async () => {
    const db = makeFakeDb(
      baseScenario({
        sessions: [
          { id: "sess-1", user_id: "user-1", phone_e164: "+17870000001" },
          { id: "sess-2", user_id: "user-1", phone_e164: "+17870000001" },
        ],
      })
    );
    const summary = await runAutoRecapSweep(db as never);

    assert.equal(summary.sessions_checked, 2);
    assert.equal(summary.recaps_sent, 2);
    assert.deepEqual(db.marked, ["sess-1", "sess-2"]);
  });
});
