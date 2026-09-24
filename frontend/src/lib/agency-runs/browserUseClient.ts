/**
 * Server-only agent-provider client — Browser Use Cloud API v4 (official
 * TypeScript SDK) or the self-hosted browser-agent worker, which mirrors the
 * v4 run/session shapes. Never import from client components — keeps API keys
 * off the wire.
 *
 * Provider is chosen with AGENT_PROVIDER:
 *   "browser_use_cloud" (default) → https://api.browser-use.com/api/v4
 *   "self_hosted"               → SELF_HOSTED_AGENT_URL (the worker exposes
 *                                 /api/v4/* routes with the same shapes)
 *
 * v4 model: a *run* is one agent turn; a *session* is the conversation shared
 * by follow-up runs. SmartPR polls the run for status/events and steers via
 * the session queue endpoint.
 */

import { BrowserUse, type V4Types } from "browser-use-sdk/v4";

const CLOUD_BASE_URL = "https://api.browser-use.com/api/v4";

export type AgentProvider = "browser_use_cloud" | "self_hosted";

/** Which agent backend SmartPR talks to. Defaults to Browser Use Cloud. */
export function agentProvider(): AgentProvider {
  return process.env.AGENT_PROVIDER?.trim() === "self_hosted"
    ? "self_hosted"
    : "browser_use_cloud";
}

/** Human label for the active provider (UI copy). */
export function agentProviderLabel(): string {
  return agentProvider() === "self_hosted"
    ? "self-hosted agent (Grok)"
    : "Browser Use Cloud";
}

function selfHostedBase(): string {
  const url = process.env.SELF_HOSTED_AGENT_URL?.trim().replace(/\/$/, "");
  if (!url) {
    throw new Error("SELF_HOSTED_AGENT_URL is not set");
  }
  return url;
}

/** Default model per provider: cheapest Cloud pick, or your own xAI model. */
function defaultModel(): string {
  if (agentProvider() === "self_hosted") {
    return process.env.XAI_MODEL?.trim() || "grok-4.3";
  }
  // Cheapest reliable Cloud model per 2026-09 cost research: gpt-5.6-luna
  // (~2.5x cheaper than bu-mini on output tokens, 78% bench accuracy).
  // Override per environment with BROWSER_USE_MODEL if needed.
  return process.env.BROWSER_USE_MODEL?.trim() || "gpt-5.6-luna";
}

/**
 * Provider-native model params. v4 defaults gpt-5.6-luna to xhigh reasoning —
 * pin to the dashboard default ("low") to keep filing runs cheap. Only sent
 * for gpt-* models: other providers reject unknown param paths with 422.
 */
function modelParamsFor(model: string): Record<string, unknown> | undefined {
  if (/^gpt-/i.test(model)) return { reasoning: { effort: "low" } };
  return undefined;
}

/** Per-run spend cap (USD) — safety net; filing runs cost cents. */
function maxCostUsd(): number {
  const raw = Number(process.env.BROWSER_USE_MAX_COST_USD);
  return Number.isFinite(raw) && raw > 0 ? raw : 5;
}

export type BuRunStatus =
  | "queued"
  | "dispatching"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface BuRun {
  /** v4 run id (one agent turn). */
  id: string;
  /** v4 session id (the conversation; follow-up runs share it). */
  sessionId: string;
  status: BuRunStatus;
  liveUrl?: string | null;
  /** Latest step screenshot — worker only (v4 Cloud exposes no step screenshots). */
  screenshotUrl?: string | null;
  result?: string | null;
  error?: string | null;
  title?: string | null;
  totalCostUsd?: string | null;
  /** Latest agent text — worker only (Cloud: derive from events). */
  lastStepSummary?: string | null;
}

export interface BuEvent {
  id: string;
  type: string;
  text: string;
  createdAt?: string;
}

function apiKey(): string | null {
  const key = process.env.BROWSER_USE_API_KEY?.trim();
  return key ? key : null;
}

/** True when env has what the active provider needs (mock is fallback otherwise). */
export function isBrowserUseConfigured(): boolean {
  if (agentProvider() === "self_hosted") {
    return Boolean(
      process.env.SELF_HOSTED_AGENT_URL?.trim() && process.env.WORKER_API_TOKEN?.trim()
    );
  }
  return Boolean(apiKey());
}

function cloudClient(): BrowserUse {
  const key = apiKey();
  if (!key) throw new Error("BROWSER_USE_API_KEY is not set");
  return new BrowserUse({ apiKey: key });
}

function workerHeaders(): HeadersInit {
  const token = process.env.WORKER_API_TOKEN?.trim();
  if (!token) throw new Error("WORKER_API_TOKEN is not set");
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

/** Strip secrets from error text before logging. */
export function sanitizeError(err: unknown): string {
  let text = err instanceof Error ? err.message : String(err);
  const key = apiKey();
  if (key) text = text.split(key).join("[redacted]");
  const workerToken = process.env.WORKER_API_TOKEN?.trim();
  if (workerToken) text = text.split(workerToken).join("[redacted]");
  return text.slice(0, 500);
}

async function workerFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${selfHostedBase()}${path}`, {
    ...init,
    headers: { ...workerHeaders(), ...(init?.headers || {}) },
    cache: "no-store",
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Worker ${init?.method || "GET"} ${path} → ${response.status}: ${body.slice(0, 300)}`
    );
  }
  return (await response.json()) as T;
}

/**
 * Live-view URLs are session-scoped and stable for the session's lifetime —
 * cache them so each 900ms status poll costs one API call instead of three.
 */
const liveUrlCache = new Map<string, string>();

/**
 * Remote browser viewport. The live view scales the remote screen down to
 * fit the SmartPR panel, so a smaller viewport renders larger, legible text
 * in the embed (1920px shrinks to ~38% in a 730px panel; 1100px to ~66%).
 * Override per environment with BROWSER_USE_SCREEN_WIDTH / _HEIGHT.
 */
function screenSize(): { screenWidth: number; screenHeight: number } {
  const w = Number(process.env.BROWSER_USE_SCREEN_WIDTH);
  const h = Number(process.env.BROWSER_USE_SCREEN_HEIGHT);
  return {
    screenWidth: Number.isFinite(w) && w >= 800 ? Math.round(w) : 1100,
    screenHeight: Number.isFinite(h) && h >= 600 ? Math.round(h) : 820,
  };
}

/** Cloud v4 has no browsers.list in the SDK — one raw call for the live view URL. */
async function cloudLiveUrl(sessionId: string): Promise<string | null> {
  const cached = liveUrlCache.get(sessionId);
  if (cached) return cached;
  const key = apiKey();
  if (!key) return null;
  const res = await fetch(
    `${CLOUD_BASE_URL}/browsers?agentSessionId=${encodeURIComponent(sessionId)}&pageSize=1`,
    { headers: { "X-Browser-Use-API-Key": key, Accept: "application/json" }, cache: "no-store" }
  );
  if (!res.ok) return null;
  const body = (await res.json()) as { items?: Array<{ liveUrl?: string | null }> };
  const url = body.items?.[0]?.liveUrl ?? null;
  if (url) liveUrlCache.set(sessionId, url);
  return url;
}

/** Stop the session's browser — ends Cloud browser billing. Idempotent. */
export async function stopAgentBrowser(sessionId: string): Promise<void> {
  liveUrlCache.delete(sessionId);
  if (agentProvider() === "self_hosted") {
    await workerFetch(`/api/v3/sessions/${encodeURIComponent(sessionId)}/stop`, {
      method: "POST",
      body: JSON.stringify({ strategy: "session" }),
    });
    return;
  }
  await cloudClient().browsers.stop(sessionId);
}

/** Extract human-readable text from a v4 run event (defensive: types vary). */
function cloudEventText(ev: { type?: string; data?: unknown }): string | null {
  const t = String(ev.type || "").toLowerCase();
  if (/screenshot|token|browser_state|dom/.test(t)) return null;
  const d = ev.data;
  if (!d || typeof d !== "object") return null;
  const rec = d as Record<string, unknown>;
  for (const k of ["text", "summary", "message", "output", "content", "result"]) {
    const v = rec[k];
    if (typeof v === "string" && v.trim()) return v.trim().slice(0, 600);
  }
  return null;
}

function normalizeCloudRun(
  raw: V4Types["schemas"]["RunSummary"],
  liveUrl: string | null
): BuRun {
  return {
    id: raw.id,
    sessionId: raw.sessionId,
    status: raw.status as BuRunStatus,
    liveUrl,
    screenshotUrl: null, // v4 Cloud exposes no step screenshots via REST
    result: raw.result ?? null,
    error: raw.error ?? null,
    title: raw.title ?? null,
    totalCostUsd: raw.totalCostUsd ?? null,
    lastStepSummary: null,
  };
}

// ---------------------------------------------------------------------------
// Public API — provider-agnostic
// ---------------------------------------------------------------------------

export async function createAgentRun(input: {
  task: string;
  /** Deterministic domain allowlist — enforced by the self-hosted worker. */
  allowedDomains?: string[];
  /**
   * ISO country for the residential proxy; null runs without a proxy. A
   * proxy adds a hop to every page load — only use one where the portal
   * needs a local IP (the PR government portals), never for SmartPR's own
   * rehearsal portal.
   */
  proxyCountryCode?: string | null;
}): Promise<BuRun> {
  const model = defaultModel();
  if (agentProvider() === "self_hosted") {
    const raw = await workerFetch<{
      id: string;
      status: BuRunStatus;
      model: string;
      sessionId: string;
      liveUrl?: string | null;
    }>("/api/v4/runs", {
      method: "POST",
      body: JSON.stringify({
        task: input.task,
        model,
        allowedDomains: input.allowedDomains ?? [],
      }),
    });
    return {
      id: raw.id,
      sessionId: raw.sessionId,
      status: raw.status,
      liveUrl: raw.liveUrl ?? null,
    };
  }

  const client = cloudClient();
  const created = await client.runs.create({
    task: input.task,
    model: model as V4Types["schemas"]["RunCreateRequest"]["model"],
    modelParams: modelParamsFor(model),
    browserSettings: {
      // Puerto Rico government portals — US residential proxy is appropriate.
      proxyCountryCode:
        input.proxyCountryCode === null
          ? null
          : ((input.proxyCountryCode ?? "us") as V4Types["schemas"]["ProxyCountryCode"]),
      ...screenSize(),
    },
    maxCostUsd: maxCostUsd(),
  });
  return {
    id: created.id,
    sessionId: created.sessionId,
    status: created.status as BuRunStatus,
    liveUrl: null, // resolved on first poll via /browsers
  };
}

export async function getAgentRun(runId: string): Promise<BuRun> {
  if (agentProvider() === "self_hosted") {
    const raw = await workerFetch<{
      id: string;
      sessionId: string;
      status: BuRunStatus;
      liveUrl?: string | null;
      screenshotUrl?: string | null;
      result?: string | null;
      error?: string | null;
      title?: string | null;
      lastStepSummary?: string | null;
    }>(`/api/v4/runs/${encodeURIComponent(runId)}`);
    return {
      id: raw.id,
      sessionId: raw.sessionId,
      status: raw.status,
      liveUrl: raw.liveUrl ?? null,
      screenshotUrl: raw.screenshotUrl ?? null,
      result: raw.result ?? null,
      error: raw.error ?? null,
      title: raw.title ?? null,
      lastStepSummary: raw.lastStepSummary ?? null,
    };
  }
  const summary = await cloudClient().runs.get(runId);
  const liveUrl = await cloudLiveUrl(summary.sessionId);
  return normalizeCloudRun(summary, liveUrl);
}

/** Lightweight status poll (v4 status route — cheap, no result text). */
export async function getAgentRunStatus(runId: string): Promise<BuRunStatus> {
  if (agentProvider() === "self_hosted") {
    const raw = await workerFetch<{ status: BuRunStatus }>(
      `/api/v4/runs/${encodeURIComponent(runId)}/status`
    );
    return raw.status;
  }
  const res = await cloudClient().runs.status(runId);
  return res.status as BuRunStatus;
}

/** Cancel the run — idempotent; Cloud refuses further billing once cancelled. */
export async function cancelAgentRun(runId: string): Promise<BuRun> {
  if (agentProvider() === "self_hosted") {
    const raw = await workerFetch<{
      id: string;
      sessionId: string;
      status: BuRunStatus;
      result?: string | null;
      error?: string | null;
    }>(`/api/v4/runs/${encodeURIComponent(runId)}/cancel`, { method: "POST" });
    return {
      id: raw.id,
      sessionId: raw.sessionId,
      status: raw.status,
      result: raw.result ?? null,
      error: raw.error ?? null,
    };
  }
  const summary = await cloudClient().runs.cancel(runId);
  const liveUrl = await cloudLiveUrl(summary.sessionId);
  return normalizeCloudRun(summary, liveUrl);
}

/**
 * Steer the conversation: queues a follow-up message on the session. Starts a
 * new run when the session is idle. Returns the (possibly new) run id.
 *
 * Pass `interrupt: true` when the current run is still active (e.g. waiting on
 * a pause) so the agent stops waiting and applies FIELDS FILL immediately.
 * Default false preserves prior behavior for plain Resume / takeover handoff.
 */
export async function queueAgentMessage(
  sessionId: string,
  text: string,
  opts?: { interrupt?: boolean }
): Promise<{ runId: string | null; messageId: number | null }> {
  const interrupt = Boolean(opts?.interrupt);
  if (agentProvider() === "self_hosted") {
    const raw = await workerFetch<{ runId?: string | null }>(
      `/api/v4/sessions/${encodeURIComponent(sessionId)}/queue`,
      { method: "POST", body: JSON.stringify({ text, interrupt }) }
    );
    return { runId: raw.runId ?? null, messageId: null };
  }
  const queued = await cloudClient().sessions.sendMessage(sessionId, {
    text,
    interrupt,
  });
  // Cloud answers before the message is dispatched: runId is null until the
  // follow-up turn actually starts. Callers resolve it later with
  // resolveQueuedRunId — never keep polling the previous (finished) turn.
  return { runId: queued.runId ?? null, messageId: queued.id ?? null };
}

/**
 * Resolve the run a queued follow-up message started. Returns null while the
 * message is still pending. `previousRunId` is the turn that was active when
 * the message was queued — the session's latest run only counts once it is a
 * different one.
 */
export async function resolveQueuedRunId(
  sessionId: string,
  messageId: number | null,
  previousRunId: string | null
): Promise<string | null> {
  if (agentProvider() === "self_hosted") return null; // worker returns runId up front
  const client = cloudClient();
  if (messageId != null) {
    try {
      const msg = await client.sessions.getMessage(sessionId, messageId);
      if (msg.runId && msg.runId !== previousRunId) return msg.runId;
    } catch {
      // Fall through to the session's latest run.
    }
  }
  const info = await client.sessions.get(sessionId);
  return info.latestRunId && info.latestRunId !== previousRunId ? info.latestRunId : null;
}

export async function listAgentRunEvents(
  runId: string,
  opts?: { after?: string; limit?: number }
): Promise<{ events: BuEvent[]; nextAfter?: string | null }> {
  const limit = opts?.limit ?? 20;
  if (agentProvider() === "self_hosted") {
    const params = new URLSearchParams();
    if (opts?.after) params.set("after", opts.after);
    params.set("limit", String(limit));
    const qs = params.toString();
    const raw = await workerFetch<{
      events?: Array<{
        id: number;
        type: string;
        ts?: string;
        data?: { text?: string };
      }>;
      nextAfter?: number | null;
    }>(`/api/v4/runs/${encodeURIComponent(runId)}/events?${qs}`);
    const events: BuEvent[] = (raw.events || [])
      .map((e) => ({
        id: String(e.id),
        type: e.type,
        text: (e.data?.text || "").trim().slice(0, 600),
        createdAt: e.ts,
      }))
      .filter((e) => e.text.length > 0);
    return {
      events,
      nextAfter: raw.nextAfter != null ? String(raw.nextAfter) : null,
    };
  }

  const page = await cloudClient().runs.events(runId, {
    after: opts?.after ? Number(opts.after) : undefined,
    limit,
    // include_output is a documented REST param; the SDK's typed params omit
    // it but pass unknown keys straight through as query string.
    include_output: true,
  } as { after?: number; limit?: number });
  const events: BuEvent[] = [];
  for (const ev of page.events || []) {
    const text = cloudEventText(ev as { type?: string; data?: unknown });
    if (!text) continue;
    events.push({
      id: String((ev as { id?: number }).id ?? ""),
      type: String((ev as { type?: string }).type ?? "event"),
      text,
      createdAt: (ev as { ts?: string }).ts,
    });
  }
  return {
    events,
    nextAfter: page.nextAfter != null ? String(page.nextAfter) : null,
  };
}
