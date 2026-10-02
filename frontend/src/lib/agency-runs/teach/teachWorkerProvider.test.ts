/**
 * Teach vs. replay browser selection: a dedicated teach worker
 * (TEACH_WORKER_URL) takes Teach Clara sessions without moving strict replay
 * — or Clara's filing runs (AGENT_PROVIDER) — off Browser Use Cloud.
 */
import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  driveWorkerUrl,
  probeTeachWorker,
  replayAvailability,
  replayBrowserProvider,
  resetTeachProbeForTests,
  teachAvailability,
  teachBrowserProvider,
  teachWorkerUrl,
} from "./teachWorkerClient";
import { agentProvider } from "../browserUseClient";
import { secureFillDriveWorker, startWorkerDrive } from "../replay/workerDriver";

const KEYS = ["TEACH_WORKER_URL", "SELF_HOSTED_AGENT_URL", "WORKER_API_TOKEN", "BROWSER_USE_API_KEY", "TEACH_BROWSER_PROVIDER", "REPLAY_BROWSER_PROVIDER", "AGENT_PROVIDER"] as const;

describe("teach worker selection is independent of the run provider", () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    resetTeachProbeForTests();
    for (const k of KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("Browser Use Cloud runs + a teach worker: teach on the worker, replay and runs stay on Browser Use Cloud", () => {
    process.env.BROWSER_USE_API_KEY = "bu-key";
    process.env.TEACH_WORKER_URL = "https://teach.example/";
    process.env.WORKER_API_TOKEN = "tok";
    assert.equal(agentProvider(), "browser_use_cloud");
    assert.equal(teachBrowserProvider(), "self_hosted");
    assert.equal(teachAvailability().ok, true);
    assert.equal(teachWorkerUrl(), "https://teach.example");
    assert.equal(replayBrowserProvider(), "browser_use_cloud");
    assert.equal(replayAvailability().ok, true);
    // Explicit AGENT_PROVIDER doesn't change either choice.
    process.env.AGENT_PROVIDER = "browser_use_cloud";
    assert.equal(teachBrowserProvider(), "self_hosted");
    assert.equal(replayBrowserProvider(), "browser_use_cloud");
  });

  it("the teach worker needs WORKER_API_TOKEN; without it teach falls back to Browser Use Cloud", () => {
    process.env.BROWSER_USE_API_KEY = "bu-key";
    process.env.TEACH_WORKER_URL = "https://teach.example";
    assert.equal(teachBrowserProvider(), "browser_use_cloud");
    delete process.env.BROWSER_USE_API_KEY;
    assert.equal(teachBrowserProvider(), null);
    assert.deepEqual(teachAvailability(), { ok: false, reason: "config" });
  });

  it("only a teach worker (no Browser Use key): teach works, and replay can use the same worker", () => {
    process.env.TEACH_WORKER_URL = "https://teach.example";
    process.env.WORKER_API_TOKEN = "tok";
    assert.equal(teachBrowserProvider(), "self_hosted");
    assert.equal(replayBrowserProvider(), "self_hosted");
    assert.equal(driveWorkerUrl(), "https://teach.example");
  });

  it("TEACH_WORKER_URL wins over SELF_HOSTED_AGENT_URL for teach; replay drives SELF_HOSTED_AGENT_URL", () => {
    process.env.TEACH_WORKER_URL = "https://teach.example";
    process.env.SELF_HOSTED_AGENT_URL = "https://agent.example";
    process.env.WORKER_API_TOKEN = "tok";
    assert.equal(teachWorkerUrl(), "https://teach.example");
    assert.equal(driveWorkerUrl(), "https://agent.example");
  });

  it("legacy setups are unchanged: SELF_HOSTED_AGENT_URL alone keeps Browser Use Cloud for teach when its key is set", () => {
    process.env.BROWSER_USE_API_KEY = "bu-key";
    process.env.SELF_HOSTED_AGENT_URL = "https://agent.example";
    process.env.WORKER_API_TOKEN = "tok";
    assert.equal(teachBrowserProvider(), "browser_use_cloud");
    assert.equal(replayBrowserProvider(), "browser_use_cloud");
    process.env.TEACH_BROWSER_PROVIDER = "self_hosted";
    assert.equal(teachBrowserProvider(), "self_hosted");
    assert.equal(replayBrowserProvider(), "self_hosted", "legacy TEACH_BROWSER_PROVIDER still forces both");
  });

  it("with a teach worker, TEACH_BROWSER_PROVIDER no longer moves replay; REPLAY_BROWSER_PROVIDER does", () => {
    process.env.BROWSER_USE_API_KEY = "bu-key";
    process.env.TEACH_WORKER_URL = "https://teach.example";
    process.env.WORKER_API_TOKEN = "tok";
    process.env.TEACH_BROWSER_PROVIDER = "self_hosted";
    assert.equal(replayBrowserProvider(), "browser_use_cloud");
    process.env.TEACH_BROWSER_PROVIDER = "browser_use_cloud";
    assert.equal(teachBrowserProvider(), "browser_use_cloud", "forcing teach back to Browser Use Cloud still works");
    process.env.REPLAY_BROWSER_PROVIDER = "self_hosted";
    assert.equal(replayBrowserProvider(), "self_hosted");
  });

  it("the probe reaches the teach worker (not Browser Use) when TEACH_WORKER_URL is set, with the bearer token", async () => {
    process.env.BROWSER_USE_API_KEY = "bu-key";
    process.env.TEACH_WORKER_URL = "https://teach.example";
    process.env.WORKER_API_TOKEN = "tok";
    const seen: string[] = [];
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      seen.push(u);
      if (u.endsWith("/healthz")) return new Response("{}", { status: 200 });
      assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer tok");
      return new Response(JSON.stringify({ teach: true, drive: true, secureFill: true, protocol: 2, browser: true, liveView: true, busy: false }), { status: 200 });
    }) as typeof fetch;
    const p = await probeTeachWorker({ fresh: true, fetchImpl });
    assert.equal(p.ok, true);
    assert.deepEqual(seen, ["https://teach.example/healthz", "https://teach.example/api/v4/capabilities"]);
    assert.ok(!seen.some((u) => u.includes("browser-use.com")));
  });

  it("the self-hosted replay driver uses the drive worker URL helper (works with only TEACH_WORKER_URL) and the token", async () => {
    process.env.TEACH_WORKER_URL = "https://teach.example";
    process.env.WORKER_API_TOKEN = "tok";
    const real = globalThis.fetch;
    const seen: string[] = [];
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      seen.push(String(url));
      assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer tok");
      return new Response(JSON.stringify({ sessionId: "s1", liveUrl: null, ok: true }), { status: 200 });
    }) as typeof fetch;
    try {
      await startWorkerDrive({ startUrl: "https://example.com", allowedDomains: ["example.com"] });
      await secureFillDriveWorker("s1", { value: "x", selector: null });
    } finally {
      globalThis.fetch = real;
    }
    assert.deepEqual(seen, ["https://teach.example/api/v4/drive", "https://teach.example/api/v4/teach/s1/secure-fill"]);
  });
});
