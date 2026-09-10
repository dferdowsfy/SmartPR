// Tests for lead capture + founder-notification deduplication, using an
// in-memory fake pool so no database is required. fetch (FormSubmit) is
// stubbed to observe notification attempts without hitting the network.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  convertLeadForUser,
  markLeadConverted,
  notifyFounder,
} from "../src/lib/leads.ts";

interface LeadRow {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  source: string;
  user_id: string | null;
  status: "CAPTURED" | "CONVERTED";
  notified_at: string | null;
  converted_at: string | null;
}

function makePool(initial: LeadRow[] = []) {
  const leads = new Map<string, LeadRow>();
  for (const row of initial) leads.set(row.id, { ...row });
  const byEmail = (email: string) =>
    [...leads.values()].find((r) => r.email.toLowerCase() === email.toLowerCase());

  return {
    leads,
    async query(text: string, params: unknown[]) {
      const normalized = text.replace(/\s+/g, " ").trim();
      if (normalized.startsWith("SELECT id, name, status FROM leads WHERE lower(email)")) {
        const hit = byEmail(String(params[0]));
        return { rows: hit ? [{ id: hit.id, name: hit.name, status: hit.status }] : [], rowCount: hit ? 1 : 0 };
      }
      if (normalized.startsWith("INSERT INTO leads (id, email, name, user_id, status, source, notified_at, converted_at)")) {
        const [id, email, name, user_id] = params as [string, string, string | null, string];
        leads.set(id, {
          id, email, name, phone: null, source: "signup_direct", user_id,
          status: "CONVERTED", notified_at: "now", converted_at: "now",
        });
        return { rows: [], rowCount: 1 };
      }
      if (normalized.startsWith("UPDATE leads SET user_id = COALESCE(user_id, $2) WHERE id = $1")) {
        const hit = leads.get(String(params[0]));
        if (hit && !hit.user_id) hit.user_id = String(params[1]);
        return { rows: [], rowCount: hit ? 1 : 0 };
      }
      if (normalized.includes("SET user_id = COALESCE(user_id, $2),") && normalized.includes("status = 'CONVERTED'")) {
        const hit = leads.get(String(params[0]));
        if (hit && hit.status === "CAPTURED") {
          if (!hit.user_id) hit.user_id = String(params[1]);
          hit.status = "CONVERTED";
          hit.converted_at = hit.converted_at ?? "now";
          hit.notified_at = "now";
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`unexpected query: ${normalized.slice(0, 80)}`);
    },
  };
}

type FakePool = ReturnType<typeof makePool>;

let notifyCalls: Array<{ subject: string; fields: Record<string, string> }>;
let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  notifyCalls = [];
  originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: unknown, init?: { body?: unknown }) => {
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
    const { _subject, ...fields } = body;
    notifyCalls.push({ subject: String(_subject).replace("[SmartPR] ", ""), fields });
    return { ok: true, status: 200 };
  }) as typeof globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function capturedLead(overrides: Partial<LeadRow> = {}): LeadRow {
  return {
    id: "lead-1", email: "guest@example.com", name: "Guest User", phone: null,
    source: "landing_start_assessment", user_id: null,
    status: "CAPTURED", notified_at: "now", converted_at: null,
    ...overrides,
  };
}

test("direct signup creates a CONVERTED lead and notifies once", async () => {
  const pool = makePool() as unknown as FakePool;
  await convertLeadForUser(pool as never, { id: "user-1", email: "new@example.com", user_metadata: { full_name: "New User" } });
  assert.equal(pool.leads.size, 1);
  const lead = [...pool.leads.values()][0];
  assert.equal(lead.status, "CONVERTED");
  assert.equal(lead.user_id, "user-1");
  assert.equal(notifyCalls.length, 1);
  assert.equal(notifyCalls[0].subject, "New signup");
  assert.equal(notifyCalls[0].fields.Email, "new@example.com");
});

test("guest lead converts to signup exactly once, even when called twice", async () => {
  const pool = makePool([capturedLead()]) as unknown as FakePool;
  const user = { id: "user-2", email: "Guest@Example.com", user_metadata: null };
  await convertLeadForUser(pool as never, user);
  await convertLeadForUser(pool as never, user);
  const lead = pool.leads.get("lead-1")!;
  assert.equal(lead.status, "CONVERTED");
  assert.equal(lead.user_id, "user-2");
  const conversions = notifyCalls.filter((c) => c.subject === "Lead converted to signup");
  assert.equal(conversions.length, 1);
  assert.equal(conversions[0].fields.Email, "guest@example.com");
});

test("already-converted lead only links the account, no new notification", async () => {
  const pool = makePool([capturedLead({ status: "CONVERTED", converted_at: "now", user_id: null })]) as unknown as FakePool;
  await convertLeadForUser(pool as never, { id: "user-3", email: "guest@example.com", user_metadata: null });
  assert.equal(pool.leads.get("lead-1")!.user_id, "user-3");
  assert.equal(notifyCalls.length, 0);
});

test("markLeadConverted is the single-winner guard under concurrent calls", async () => {
  const pool = makePool([capturedLead()]) as unknown as FakePool;
  const [first, second] = await Promise.all([
    markLeadConverted(pool as never, "lead-1", "user-a"),
    markLeadConverted(pool as never, "lead-1", "user-b"),
  ]);
  assert.equal([first, second].filter(Boolean).length, 1);
  assert.equal(pool.leads.get("lead-1")!.status, "CONVERTED");
});

test("notifyFounder never throws when delivery fails", async () => {
  globalThis.fetch = (async () => ({ ok: false, status: 500 })) as unknown as typeof globalThis.fetch;
  await notifyFounder("Broken pipe", { Email: "x@y.z" });
  globalThis.fetch = (async () => { throw new Error("network down"); }) as unknown as typeof globalThis.fetch;
  await notifyFounder("Broken pipe", { Email: "x@y.z" });
  // No assertion needed beyond "did not throw".
});
