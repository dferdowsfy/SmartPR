/**
 * Regression: after Fill & continue, Browser Use Cloud answers the queued
 * follow-up with runId=null until it dispatches. The store used to keep
 * polling the previous, finished turn — whose final message still read
 * PAUSE_USER_LOGIN — and re-paused, asking the human for the same values
 * twice. Also covers: markers mentioned mid-turn never pause the run, and a
 * new field set (login → SSN) is progress, not a stuck streak.
 *
 * Drives the real store against a stubbed Cloud API (global fetch).
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRun, getRun, resumeRun } from "./store";

type Turn = { status: string; result: string | null; events: string[] };

const turns: Record<string, Turn> = {};
const queue: { messageRunId: string | null; latestRunId: string } = {
  messageRunId: null,
  latestRunId: "run-1",
};

const LOGIN_PAUSE = [
  "PAUSE_USER_LOGIN",
  "REQUIRED_FIELDS:",
  "- id=email; label=Email; type=email; sensitive=false",
  "- id=password; label=Password; type=password; sensitive=true",
].join("\n");

const SSN_PAUSE = [
  "PAUSE_USER_LOGIN",
  "REQUIRED_FIELDS:",
  "- id=ssn; label=Social Security Number; type=text; sensitive=true; hint=9 digits",
].join("\n");

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function runSummary(id: string) {
  const t = turns[id];
  return {
    id,
    sessionId: "sess-1",
    status: t.status,
    result: t.result,
    error: null,
    title: null,
    totalCostUsd: "0",
  };
}

const realFetch = globalThis.fetch;
const savedEnv = { ...process.env };

before(() => {
  process.env.BROWSER_USE_API_KEY = "test-key";
  delete process.env.AGENT_PROVIDER;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const path = url.pathname.replace(/^\/api\/v4/, "");
    const method = (init?.method || "GET").toUpperCase();
    if (method === "POST" && path === "/runs") {
      turns["run-1"] = { status: "running", result: null, events: [] };
      return json({ id: "run-1", sessionId: "sess-1", status: "running", model: "m", workspaceId: "w", eventsUrl: "" });
    }
    if (path === "/browsers") return json({ items: [{ liveUrl: "https://live.browser-use.com/x" }] });
    let m = /^\/runs\/([^/]+)\/events$/.exec(path);
    if (m) {
      const t = turns[m[1]];
      return json({
        events: t.events.map((text, i) => ({ runId: m![1], id: i + 1, ts: "", type: "message", data: { text } })),
        nextAfter: null,
        hasMore: false,
      });
    }
    m = /^\/runs\/([^/]+)$/.exec(path);
    if (m) return json(runSummary(m[1]));
    if (method === "POST" && path === "/sessions/sess-1/queue") {
      return json({ id: 7, sessionId: "sess-1", runId: null, mode: "interrupt", status: "pending", text: "", createdAt: "" });
    }
    if (path === "/sessions/sess-1/queue/7") {
      return json({ id: 7, sessionId: "sess-1", runId: queue.messageRunId, mode: "interrupt", status: "pending", text: "", createdAt: "" });
    }
    if (path === "/sessions/sess-1") {
      return json({ sessionId: "sess-1", latestRunId: queue.latestRunId, status: "running", task: "", title: null, workspaceId: null, createdAt: "", updatedAt: "" });
    }
    throw new Error(`unexpected ${method} ${path}`);
  }) as typeof fetch;
});

after(() => {
  globalThis.fetch = realFetch;
  process.env = savedEnv;
});

describe("Browser Use follow-up turns", () => {
  it("never re-asks for values after Fill & continue while the next turn is queued", async () => {
    const run = await createRun({ business_id: "biz-stale", filing_type: "DEMO_REHEARSAL_PORTAL" });
    assert.equal(run.worker, "browser_use");

    // Mid-turn narration that merely MENTIONS a marker must not pause.
    turns["run-1"].events = ["Opening the portal. If a login form appears I will PAUSE_USER_LOGIN."];
    let pub = await getRun(run.id);
    assert.equal(pub?.status, "running");

    // Turn 1 finishes at the login gate.
    turns["run-1"] = { status: "completed", result: LOGIN_PAUSE, events: [] };
    pub = await getRun(run.id);
    assert.equal(pub?.status, "paused");
    assert.deepEqual(pub?.pending_fields.map((f) => f.id), ["email", "password"]);

    // Human fills the login once. Cloud has not dispatched the follow-up yet.
    pub = await resumeRun(run.id, { fields: { email: "a@b.co", password: "pw" } });
    assert.equal(pub?.status, "running", "must not re-read the finished login turn");
    pub = await getRun(run.id);
    assert.equal(pub?.status, "running", "still waiting on the queued turn — no second ask");
    assert.deepEqual(pub?.pending_fields, []);

    // Follow-up dispatches as run-2 and reaches the SSN step.
    queue.messageRunId = "run-2";
    queue.latestRunId = "run-2";
    turns["run-2"] = { status: "running", result: null, events: ["Filled login, continuing to the filing form."] };
    pub = await getRun(run.id);
    assert.equal(pub?.status, "running");

    turns["run-2"] = { status: "completed", result: SSN_PAUSE, events: [] };
    pub = await getRun(run.id);
    assert.equal(pub?.status, "paused");
    assert.deepEqual(pub?.pending_fields.map((f) => f.id), ["ssn"], "chat asks for exactly what the page shows");
    assert.equal(pub?.pause_streak, 1, "a new field set is progress, not a stuck loop");
  });
});
